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

  public getRawDb(): DatabaseSync {
    if (this.isClosed) {
      throw new Error('Database connection is closed.');
    }
    return this.db;
  }

  public exec(sql: string): void {
    if (this.isClosed) throw new Error('Database connection is closed.');
    this.db.exec(sql);
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
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  /**
   * Serialized transaction runner.
   * Guarantees that concurrent in-process write calls are queued sequentially,
   * completely avoiding SQLITE_BUSY deadlocks.
   */
  public async transactionAsync<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.isClosed) throw new Error('Database connection is closed.');

    // Chain onto the write lock promise
    let releaseLock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.writeLock;
    this.writeLock = nextLock;

    await previousLock;

    try {
      this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
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
  }

  /**
   * Synchronous transaction for immediate synchronous batches.
   */
  public transactionSync<T>(fn: () => T): T {
    if (this.isClosed) throw new Error('Database connection is closed.');
    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
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
  }

  public close(): void {
    if (!this.isClosed) {
      this.isClosed = true;
      this.db.close();
    }
  }
}
