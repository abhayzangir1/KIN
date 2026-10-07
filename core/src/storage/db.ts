import { DatabaseSync, StatementSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DatabaseConfig {
  dbPath?: string; // If undefined or ':memory:', runs in memory
  busyTimeoutMs?: number;
}

export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export class KinDatabase {
  private db: DatabaseSync;
  private readonly dbPath: string;
  private isClosed: boolean = false;
  private writeLock: Promise<void> = Promise.resolve();
  private isTransactionActive: boolean = false;

  constructor(config: DatabaseConfig = {}) {
    const rawPath = config.dbPath || ':memory:';
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

    this.initializePragmas(config.busyTimeoutMs ?? 10000);
  }

  private initializePragmas(busyTimeoutMs: number): void {
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    }
    this.db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  private sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

  private sleepSync(ms: number): void {
    try {
      Atomics.wait(this.sleepBuffer, 0, 0, ms);
    } catch {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        // Fallback spin wait if Atomics is unavailable
      }
    }
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
    const maxRetries = 10;
    let delay = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.db.exec(sql);
        return;
      } catch (err: unknown) {
        if (this.isBusyError(err) && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 15);
          this.sleepSync(delay + jitter);
          delay = Math.min(delay * 2, 200);
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
    const maxRetries = 10;
    let delay = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const stmt = this.db.prepare(sql);
        return stmt.run(...params);
      } catch (err: unknown) {
        if (this.isBusyError(err) && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 15);
          this.sleepSync(delay + jitter);
          delay = Math.min(delay * 2, 200);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Database execute failed after busy retries.');
  }

  /**
   * Serialized transaction runner.
   * Ensures that concurrent in-process write calls are queued sequentially,
   * completely avoiding SQLITE_BUSY deadlocks.
   */
  public async transactionAsync<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.isClosed) throw new Error('Database connection is closed.');

    if (this.isTransactionActive) {
      // Nested transaction inside an active transaction.
      // Use SQLite SAVEPOINT to provide nested transactional isolation without deadlock
      // or attempting an illegal nested BEGIN TRANSACTION.
      const savepointName = `sp_async_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
      }
    }

    // Chain onto the write lock promise
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.writeLock;
    this.writeLock = nextLock;

    // Always await previous lock safely, even if previous transaction failed
    await previousLock.catch(() => {});

    this.isTransactionActive = true;

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
      this.isTransactionActive = false;
      releaseLock();
    }
  }

  /**
   * Synchronous transaction for immediate synchronous batches.
   * Uses SAVEPOINT if an outer transaction is already active to prevent illegal nested BEGIN
   * or single-threaded event loop deadlocks.
   */
  public transactionSync<T>(fn: () => T): T {
    if (this.isClosed) throw new Error('Database connection is closed.');

    if (this.isTransactionActive) {
      // An outer transaction (either async or sync) is already active on this connection.
      // Use SQLite SAVEPOINT to provide nested transactional isolation without deadlock
      // or attempting an illegal nested BEGIN TRANSACTION.
      const savepointName = `sp_sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
      }
    }

    this.isTransactionActive = true;

    try {
      let delay = 10;
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
          break;
        } catch (err) {
          if (this.isBusyError(err) && attempt < 10) {
            this.sleepSync(delay + Math.floor(Math.random() * 10));
            delay = Math.min(delay * 2, 200);
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
      this.isTransactionActive = false;
    }
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
