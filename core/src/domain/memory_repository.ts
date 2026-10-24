// ============================================================================
// KIN MEMORY REPOSITORY
// Scoped memory fabric (semantic, episodic, procedural, decision, preference)
// with Optimistic Concurrency Control (OCC) and version history snapshots.
// ============================================================================

import { KinDatabase, safeJsonParse } from '../storage/db.js';
import { Memory, MemoryScope, MemoryType } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export interface SetMemoryParams {
  scope: MemoryScope;
  scopeId: string;
  type: MemoryType;
  key: string;
  value: unknown;
  expectedVersion?: number;
  evidenceRef?: string;
  updatedByRunId?: string;
}

export interface MemoryVersionEntry {
  id: string;
  memoryId: string;
  version: number;
  value: unknown;
  updatedByRunId?: string;
  createdAt: number;
}

export class OCCConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OCCConflictError';
  }
}

export class MemoryRepository {
  private db: KinDatabase;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  /**
   * Sets or updates a scoped memory entry with OCC protection.
   */
  public setMemory(params: SetMemoryParams): Memory {
    const now = Date.now();
    return this.db.transactionSync(() => {
      const existing = this.getMemory(params.scope, params.scopeId, params.key);

      if (existing) {
        if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
          throw new OCCConflictError(
            `OCC CONFLICT: Memory key '${params.key}' version mismatch (expected ${params.expectedVersion}, got ${existing.version})`
          );
        }

        const nextVersion = existing.version + 1;
        const valJson = JSON.stringify(params.value);

        // Archive current snapshot into memory_versions
        this.db.execute(
          `INSERT INTO memory_versions (id, memory_id, version, value_json, updated_by_run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          `mver-${uuidv4()}`,
          existing.id,
          existing.version,
          JSON.stringify(existing.value),
          params.updatedByRunId ?? null,
          now
        );

        // Update memories table with OCC SQL fencing
        const result = this.db.execute(
          `UPDATE memories SET type = ?, value_json = ?, version = ?, evidence_ref = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
          params.type,
          valJson,
          nextVersion,
          params.evidenceRef ?? existing.evidenceRef ?? null,
          now,
          existing.id,
          existing.version
        );

        if (Number(result.changes) === 0) {
          throw new OCCConflictError(
            `OCC CONFLICT: Concurrent update detected for memory key '${params.key}' (version ${existing.version})`
          );
        }

        return {
          ...existing,
          type: params.type,
          value: params.value,
          version: nextVersion,
          evidenceRef: params.evidenceRef ?? existing.evidenceRef,
          updatedAt: now,
        };
      } else {
        if (params.expectedVersion !== undefined && params.expectedVersion !== 0) {
          throw new OCCConflictError(
            `OCC CONFLICT: Memory key '${params.key}' does not exist (expected version ${params.expectedVersion})`
          );
        }

        const id = `mem-${uuidv4()}`;
        const valJson = JSON.stringify(params.value);

        this.db.execute(
          `INSERT INTO memories (id, scope, scope_id, type, key, value_json, version, evidence_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          id,
          params.scope,
          params.scopeId,
          params.type,
          params.key,
          valJson,
          params.evidenceRef ?? null,
          now,
          now
        );

        return {
          id,
          scope: params.scope,
          scopeId: params.scopeId,
          type: params.type,
          key: params.key,
          value: params.value,
          version: 1,
          evidenceRef: params.evidenceRef,
          createdAt: now,
          updatedAt: now,
        };
      }
    });
  }

  /**
   * Retrieves a memory entry by scope and key.
   */
  public getMemory(scope: MemoryScope, scopeId: string, key: string): Memory | undefined {
    const row = this.db.queryOne<any>(
      `SELECT * FROM memories WHERE scope = ? AND scope_id = ? AND key = ?`,
      scope,
      scopeId,
      key
    );

    return row ? this.mapRowToMemory(row) : undefined;
  }

  /**
   * Retrieves a memory entry by ID.
   */
  public getMemoryById(id: string): Memory | undefined {
    const row = this.db.queryOne<any>(`SELECT * FROM memories WHERE id = ?`, id);
    return row ? this.mapRowToMemory(row) : undefined;
  }

  /**
   * Lists memories by scope and optionally by type.
   */
  public listMemories(scope: MemoryScope, scopeId: string, type?: MemoryType): Memory[] {
    let sql = `SELECT * FROM memories WHERE scope = ? AND scope_id = ?`;
    const params: any[] = [scope, scopeId];
    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }
    sql += ` ORDER BY updated_at DESC`;

    const rows = this.db.query<any>(sql, ...params);
    return rows.map(this.mapRowToMemory);
  }

  /**
   * Deletes a memory entry.
   */
  public deleteMemory(scope: MemoryScope, scopeId: string, key: string): boolean {
    const row = this.db.queryOne<{ id: string }>(
      `SELECT id FROM memories WHERE scope = ? AND scope_id = ? AND key = ?`,
      scope,
      scopeId,
      key
    );
    if (!row) return false;

    this.db.execute(`DELETE FROM memories WHERE id = ?`, row.id);
    return true;
  }

  /**
   * Retrieves version history for a given memory.
   */
  public getVersionHistory(memoryId: string): MemoryVersionEntry[] {
    const rows = this.db.query<any>(
      `SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version DESC`,
      memoryId
    );

    return rows.map((r) => {
      const val = safeJsonParse(r.value_json, r.value_json);
      return {
        id: r.id,
        memoryId: r.memory_id,
        version: r.version,
        value: val,
        updatedByRunId: r.updated_by_run_id ?? undefined,
        createdAt: r.created_at,
      };
    });
  }

  private mapRowToMemory(row: any): Memory {
    const val = safeJsonParse(row.value_json, row.value_json);
    return {
      id: row.id,
      scope: row.scope,
      scopeId: row.scope_id,
      type: row.type,
      key: row.key,
      value: val,
      version: row.version,
      evidenceRef: row.evidence_ref ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
