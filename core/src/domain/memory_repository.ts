// ============================================================================
// KIN MEMORY REPOSITORY
// Scoped memory fabric (semantic, episodic, procedural, decision, preference)
// with Optimistic Concurrency Control (OCC) and version history snapshots.
// ============================================================================

import { KinDatabase, safeJsonParse } from '../storage/db.js';
import { SecretBroker } from '../security/secret_broker.js';
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
  validFrom?: number;
  validTo?: number;
  embedding?: number[] | Float32Array;
  importance?: number;
}

export interface HybridSearchOptions {
  query: string;
  scope?: MemoryScope;
  scopeId?: string;
  queryEmbedding?: number[] | Float32Array;
  limit?: number;
  includeInvalidated?: boolean;
}

export interface HybridSearchResult {
  memory: Memory;
  score: number;
  bm25Rank?: number;
  vectorScore?: number;
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
    const safeValue = SecretBroker.getInstance().sanitizePayload(params.value);
    const valJson = JSON.stringify(safeValue);
    return this.db.transactionSync(() => {
      const existing = this.getMemory(params.scope, params.scopeId, params.key);

      if (existing) {
        if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
          throw new OCCConflictError(
            `OCC CONFLICT: Memory key '${params.key}' version mismatch (expected ${params.expectedVersion}, got ${existing.version})`
          );
        }

        const nextVersion = existing.version + 1;

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

        const embeddingBuf = params.embedding
          ? Buffer.from(
              params.embedding instanceof Float32Array
                ? params.embedding.buffer.slice(params.embedding.byteOffset, params.embedding.byteOffset + params.embedding.byteLength)
                : new Float32Array(params.embedding).buffer
            )
          : null;

        // Update memories table with OCC SQL fencing
        const result = this.db.execute(
          `UPDATE memories SET type = ?, value_json = ?, version = ?, evidence_ref = ?,
             valid_from = COALESCE(?, valid_from), valid_to = COALESCE(?, valid_to),
             embedding = COALESCE(?, embedding), importance = COALESCE(?, importance),
             invalidated_at = NULL, updated_at = ?
           WHERE id = ? AND version = ?`,
          params.type,
          valJson,
          nextVersion,
          params.evidenceRef ?? existing.evidenceRef ?? null,
          params.validFrom ?? null,
          params.validTo ?? null,
          embeddingBuf,
          params.importance ?? null,
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
          value: safeValue,
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
        const embeddingBuf = params.embedding
          ? Buffer.from(
              params.embedding instanceof Float32Array
                ? params.embedding.buffer.slice(params.embedding.byteOffset, params.embedding.byteOffset + params.embedding.byteLength)
                : new Float32Array(params.embedding).buffer
            )
          : null;

        this.db.execute(
          `INSERT INTO memories (id, scope, scope_id, type, key, value_json, version, evidence_ref, valid_from, valid_to, embedding, importance, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          params.scope,
          params.scopeId,
          params.type,
          params.key,
          valJson,
          params.evidenceRef ?? null,
          params.validFrom ?? now,
          params.validTo ?? null,
          embeddingBuf,
          params.importance ?? 0.5,
          now,
          now
        );

        return {
          id,
          scope: params.scope,
          scopeId: params.scopeId,
          type: params.type,
          key: params.key,
          value: safeValue,
          version: 1,
          evidenceRef: params.evidenceRef,
          createdAt: now,
          updatedAt: now,
        };
      }
    });
  }

  /**
   * Retrieves an active memory entry by scope and key (respecting bi-temporal validity unless includeInvalidated is true).
   */
  public getMemory(scope: MemoryScope, scopeId: string, key: string, includeInvalidated: boolean = false): Memory | undefined {
    const now = Date.now();
    const row = includeInvalidated
      ? this.db.queryOne<any>(
          `SELECT * FROM memories WHERE scope = ? AND scope_id = ? AND key = ?`,
          scope,
          scopeId,
          key
        )
      : this.db.queryOne<any>(
          `SELECT * FROM memories WHERE scope = ? AND scope_id = ? AND key = ?
             AND invalidated_at IS NULL
             AND (valid_from IS NULL OR valid_from <= ?)
             AND (valid_to IS NULL OR valid_to >= ?)`,
          scope,
          scopeId,
          key,
          now,
          now
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
   * Lists active memories by scope and optionally by type.
   */
  public listMemories(scope: MemoryScope, scopeId: string, type?: MemoryType, includeInvalidated: boolean = false): Memory[] {
    const now = Date.now();
    let sql = `SELECT * FROM memories WHERE scope = ? AND scope_id = ?`;
    const params: any[] = [scope, scopeId];
    if (!includeInvalidated) {
      sql += ` AND invalidated_at IS NULL AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)`;
      params.push(now, now);
    }
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
   * Soft-invalidates a memory entry (bi-temporal tombstone) without deleting version history.
   */
  public invalidateMemory(scope: MemoryScope, scopeId: string, key: string): boolean {
    const now = Date.now();
    const res = this.db.execute(
      `UPDATE memories SET invalidated_at = ?, valid_to = COALESCE(valid_to, ?), updated_at = ?
       WHERE scope = ? AND scope_id = ? AND key = ? AND invalidated_at IS NULL`,
      now,
      now,
      now,
      scope,
      scopeId,
      key
    );
    return Number(res.changes) > 0;
  }

  /**
   * Hybrid BM25 (FTS5) + Float32 vector cosine similarity search fused via Reciprocal Rank Fusion (RRF).
   */
  public hybridSearch(options: HybridSearchOptions): HybridSearchResult[] {
    const limit = Math.max(1, Math.min(100, options.limit ?? 10));
    const trimmed = (options.query || '').trim();
    const candidates = new Map<string, { memory: Memory; bm25Rank?: number; vectorScore?: number; importance: number }>();

    const now = Date.now();
    // 1. FTS5 BM25 lexical retrieval
    if (trimmed.length > 0) {
      const ftsTokens = trimmed
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1)
        .map((t) => `"${t.replace(/"/g, '')}"`);

      if (ftsTokens.length > 0) {
        const matchExpr = ftsTokens.join(' OR ');
        const params: any[] = [matchExpr];
        let sql = `
          SELECT m.*, bm25(memories_fts) AS rank_score
          FROM memories_fts f
          JOIN memories m ON m.id = f.memory_id
          WHERE memories_fts MATCH ?
        `;
        if (!options.includeInvalidated) {
          sql += ` AND m.invalidated_at IS NULL AND (m.valid_from IS NULL OR m.valid_from <= ?) AND (m.valid_to IS NULL OR m.valid_to >= ?)`;
          params.push(now, now);
        }
        if (options.scope) {
          sql += ` AND m.scope = ?`;
          params.push(options.scope);
        }
        if (options.scopeId) {
          sql += ` AND m.scope_id = ?`;
          params.push(options.scopeId);
        }
        sql += ` ORDER BY rank_score ASC LIMIT ?`;
        params.push(limit * 3);

        try {
          const rows = this.db.query<any>(sql, ...params);
          rows.forEach((row, idx) => {
            candidates.set(row.id, {
              memory: this.mapRowToMemory(row),
              bm25Rank: idx + 1,
              importance: typeof row.importance === 'number' ? row.importance : 0.5,
            });
          });
        } catch (err) {
          console.debug('[MEMORY_REPO] FTS5 query fallback notice:', err);
        }
      }
    }

    // 2. Float32 BLOB cosine vector similarity (when queryEmbedding is supplied)
    if (options.queryEmbedding && options.queryEmbedding.length > 0) {
      const params: any[] = [];
      let vecSql = `SELECT * FROM memories WHERE embedding IS NOT NULL`;
      if (!options.includeInvalidated) {
        vecSql += ` AND invalidated_at IS NULL AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to >= ?)`;
        params.push(now, now);
      }
      if (options.scope) {
        vecSql += ` AND scope = ?`;
        params.push(options.scope);
      }
      if (options.scopeId) {
        vecSql += ` AND scope_id = ?`;
        params.push(options.scopeId);
      }
      vecSql += ` ORDER BY updated_at DESC LIMIT 500`;

      const vecRows = this.db.query<any>(vecSql, ...params);
      const qVec = options.queryEmbedding;
      let qNorm = 0;
      for (let i = 0; i < qVec.length; i++) qNorm += qVec[i] * qVec[i];
      qNorm = Math.sqrt(qNorm) || 1;

      const scoredVec: Array<{ row: any; sim: number }> = [];
      for (const row of vecRows) {
        const buf: Uint8Array | Buffer = row.embedding;
        if (!buf || buf.byteLength !== qVec.length * 4) continue;
        let f32: Float32Array;
        if (buf.byteOffset % 4 === 0) {
          f32 = new Float32Array(buf.buffer, buf.byteOffset, qVec.length);
        } else {
          const aligned = new Uint8Array(buf.byteLength);
          aligned.set(buf);
          f32 = new Float32Array(aligned.buffer);
        }
        let dot = 0;
        let dNorm = 0;
        for (let i = 0; i < f32.length; i++) {
          dot += qVec[i] * f32[i];
          dNorm += f32[i] * f32[i];
        }
        const denom = qNorm * (Math.sqrt(dNorm) || 1);
        const sim = dot / denom;
        if (sim > 0) scoredVec.push({ row, sim });
      }
      scoredVec.sort((a, b) => b.sim - a.sim);
      scoredVec.slice(0, limit * 3).forEach(({ row, sim }, idx) => {
        const existing = candidates.get(row.id);
        if (existing) {
          existing.vectorScore = sim;
          (existing as any).vecRank = idx + 1;
        } else {
          candidates.set(row.id, {
            memory: this.mapRowToMemory(row),
            vectorScore: sim,
            importance: typeof row.importance === 'number' ? row.importance : 0.5,
            ...( { vecRank: idx + 1 } as any ),
          });
        }
      });
    }

    // 3. Reciprocal Rank Fusion (k=60) weighted by importance
    const results: HybridSearchResult[] = [];
    for (const item of candidates.values()) {
      const rrfBm25 = item.bm25Rank ? 1 / (60 + item.bm25Rank) : 0;
      const vecRank = (item as any).vecRank as number | undefined;
      const rrfVec = vecRank ? 1 / (60 + vecRank) : 0;
      const score = (rrfBm25 + rrfVec) * (0.75 + 0.5 * item.importance);
      results.push({
        memory: item.memory,
        score,
        bm25Rank: item.bm25Rank,
        vectorScore: item.vectorScore,
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
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
