import { DatabaseSync, StatementSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface DatabaseConfig {
  dbPath?: string; // If undefined or ':memory:', runs in memory
  busyTimeoutMs?: number;
}

export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

interface TransactionContext {
  transactionId: string;
  savepointLevel: number;
}

export class KinDatabase {
  private db: DatabaseSync;
  private readonly dbPath: string;
  private isClosed: boolean = false;
  private writeLock: Promise<void> = Promise.resolve();
  private txContext = new AsyncLocalStorage<TransactionContext>();
  private syncTxDepth: number = 0;

  constructor(config: DatabaseConfig | string = {}) {
    const rawPath = typeof config === 'string' ? config : (config.dbPath || ':memory:');
    this.dbPath = rawPath;

    if (rawPath !== ':memory:') {
      const dir = path.dirname(rawPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(rawPath, {
      open: true,
      readOnly: false,
      enableForeignKeyConstraints: true,
    });

    const busyTimeoutMs = typeof config === 'string' ? 10000 : (config.busyTimeoutMs ?? 10000);
    this.initializePragmas(busyTimeoutMs);
  }

  private initializePragmas(busyTimeoutMs: number): void {
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }
    this.db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  public get isTransactionActive(): boolean {
    return this.txContext.getStore() !== undefined || this.syncTxDepth > 0;
  }

  private isBusyError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const msg = (err as any).message || '';
    const code = (err as any).code || '';
    return msg.includes('locked') || msg.includes('busy') || code === 'SQLITE_BUSY';
  }

  public getRawDb(): DatabaseSync {
    if (this.isClosed) {
      throw new Error('Database connection is closed.');
    }
    return this.db;
  }

  public exec(sql: string): void {
    if (this.isClosed) throw new Error('Database connection is closed.');
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.db.exec(sql);
        return;
      } catch (err: unknown) {
        if (this.isBusyError(err) && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }
  }

  public prepare(sql: string): StatementSync {
    if (this.isClosed) throw new Error('Database connection is closed.');
    return this.db.prepare(sql);
  }

  public query<T = Record<string, unknown>>(sql: string, ...params: (string | number | bigint | Buffer | null)[]): T[] {
    if (this.isClosed) throw new Error('Database connection is closed.');
    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params);
    return results as unknown as T[];
  }

  public queryOne<T = Record<string, unknown>>(sql: string, ...params: (string | number | bigint | Buffer | null)[]): T | undefined {
    if (this.isClosed) throw new Error('Database connection is closed.');
    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params);
    return result as unknown as T | undefined;
  }

  public execute(sql: string, ...params: (string | number | bigint | Buffer | null)[]): RunResult {
    if (this.isClosed) throw new Error('Database connection is closed.');
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const stmt = this.db.prepare(sql);
        return stmt.run(...params);
      } catch (err: unknown) {
        if (this.isBusyError(err) && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }
    throw new Error('Database execute failed after busy retries.');
  }

  /**
   * Asynchronous execute with non-blocking backoff.
   * Completely avoids blocking the Node.js event loop during SQLITE_BUSY contention.
   */
  public async executeAsync(
    sql: string,
    ...params: (string | number | bigint | Buffer | null)[]
  ): Promise<RunResult> {
    if (this.isClosed) throw new Error('Database connection is closed.');
    const maxRetries = 10;
    let delay = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const stmt = this.db.prepare(sql);
        return stmt.run(...params);
      } catch (err: unknown) {
        if (this.isBusyError(err) && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 15);
          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
          delay = Math.min(delay * 2, 200);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Database executeAsync failed after busy retries.');
  }

  /**
   * Serialized transaction runner.
   * Uses AsyncLocalStorage to track transaction context per asynchronous execution flow.
   * Top-level transactions are queued sequentially across async tasks via writeLock.
   * Nested calls within the same async context create isolated SQLite SAVEPOINTs.
   */
  public async transactionAsync<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.isClosed) throw new Error('Database connection is closed.');

    const currentTx = this.txContext.getStore();
    if (currentTx) {
      // Nested transaction inside an active async execution flow.
      // Use SQLite SAVEPOINT to provide nested transactional isolation without deadlock
      // or attempting an illegal nested BEGIN TRANSACTION.
      currentTx.savepointLevel++;
      const savepointName = `sp_async_${currentTx.transactionId}_${currentTx.savepointLevel}`;
      this.db.exec(`SAVEPOINT ${savepointName};`);
      try {
        const result = await fn();
        this.db.exec(`RELEASE ${savepointName};`);
        return result;
      } catch (error) {
        try {
          this.db.exec(`ROLLBACK TO ${savepointName};`);
          this.db.exec(`RELEASE ${savepointName};`);
        } catch {
          // Ignore rollback error
        }
        throw error;
      } finally {
        currentTx.savepointLevel--;
      }
    }

    // Top-level async transaction: serialize with writeLock
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.writeLock;
    this.writeLock = nextLock;

    // Always await previous lock safely, even if previous transaction failed
    await previousLock.catch(() => {});

    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const context: TransactionContext = {
      transactionId: txId,
      savepointLevel: 0,
    };

    return this.txContext.run(context, async () => {
      try {
        let delay = 10;
        for (let attempt = 1; attempt <= 10; attempt++) {
          try {
            this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
            break;
          } catch (err) {
            if (this.isBusyError(err) && attempt < 10) {
              await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 15)));
              delay = Math.min(delay * 2, 200);
              continue;
            }
            throw err;
          }
        }
        const result = await fn();
        this.db.exec('COMMIT;');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Rollback error ignored if transaction was already aborted
        }
        throw error;
      } finally {
        releaseLock();
      }
    });
  }

  /**
   * Synchronous transaction for immediate synchronous batches.
   * Uses SAVEPOINT if an outer transaction is already active to prevent illegal nested BEGIN.
   */
  public transactionSync<T>(fn: () => T): T {
    if (this.isClosed) throw new Error('Database connection is closed.');

    const currentTx = this.txContext.getStore();
    if (currentTx || this.syncTxDepth > 0) {
      const txId = currentTx ? currentTx.transactionId : 'sync';
      const level = currentTx ? ++currentTx.savepointLevel : ++this.syncTxDepth;
      const savepointName = `sp_sync_${txId}_${level}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      this.db.exec(`SAVEPOINT ${savepointName};`);
      try {
        const result = fn();
        this.db.exec(`RELEASE ${savepointName};`);
        return result;
      } catch (error) {
        try {
          this.db.exec(`ROLLBACK TO ${savepointName};`);
          this.db.exec(`RELEASE ${savepointName};`);
        } catch {
          // Ignore rollback error
        }
        throw error;
      } finally {
        if (currentTx) {
          currentTx.savepointLevel--;
        } else {
          this.syncTxDepth--;
        }
      }
    }

    const txId = `tx_sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const context: TransactionContext = {
      transactionId: txId,
      savepointLevel: 0,
    };

    return this.txContext.run(context, () => {
      this.syncTxDepth++;
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
            break;
          } catch (err) {
            if (this.isBusyError(err) && attempt < 3) {
              continue;
            }
            throw err;
          }
        }
        try {
          const result = fn();
          this.db.exec('COMMIT;');
          return result;
        } catch (error) {
          try {
            this.db.exec('ROLLBACK;');
          } catch {
            // Rollback error ignored
          }
          throw error;
        }
      } finally {
        this.syncTxDepth--;
      }
    });
  }

  public close(): void {
    if (!this.isClosed) {
      this.isClosed = true;
      this.db.close();
    }
  }

  public get closed(): boolean {
    return this.isClosed;
  }
}

/**
 * Safely parses a JSON string into an object, falling back to a default object if null, invalid, or non-object.
 * Guarantees return value is a non-null, non-array object.
 */
export function safeJsonParseObject<T extends Record<string, unknown> = Record<string, unknown>>(
  raw: unknown,
  fallback: T = {} as T
): T {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as T;
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Safely parses a JSON string into an array, falling back to a default array if null, invalid, or non-array.
 * Guarantees return value satisfies Array.isArray().
 */
export function safeJsonParseArray<T = unknown>(
  raw: unknown,
  fallback: T[] = []
): T[] {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  if (Array.isArray(raw)) {
    return raw as T[];
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Generic safe JSON parse with fallback for arbitrary types.
 */
export function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) {
      return fallback;
    }
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      return fallback;
    }
    if (
      typeof fallback === 'object' &&
      fallback !== null &&
      !Array.isArray(fallback) &&
      (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null)
    ) {
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

