import * as crypto from 'node:crypto';
// ============================================================================
// KIN AUTHORITATIVE UNIFIED EVENT LEDGER
// Append-only structured audit recorder capturing end-to-end lifecycle provenance
// directly into the persistent event_journal table.
// ============================================================================

import { KinDatabase } from '../storage/db.js';
import { SecretBroker } from './secret_broker.js';

export type LedgerEventType =
  | 'USER_REQUEST'
  | 'PLAN_CREATED'
  | 'TASK_CREATED'
  | 'RUN_CREATED'
  | 'DELEGATION_GRANTED'
  | 'CAPABILITY_GRANTED'
  | 'POLICY_EVALUATED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'SECRET_ACCESSED'
  | 'TOOL_STARTED'
  | 'TOOL_COMPLETED'
  | 'OBSERVATION_RECORDED'
  | 'VERIFICATION_COMPLETED'
  | 'EVIDENCE_RECORDED'
  | 'TASK_COMPLETED'
  | 'RUN_FAILED'
  | 'RUN_RECOVERED'
  | (string & {});

export interface LedgerEventParams {
  eventType: LedgerEventType;
  entityType: 'agent' | 'run' | 'task' | 'goal' | 'channel' | 'tool' | 'approval' | 'system' | (string & {});
  entityId: string;
  runId?: string;
  payload: Record<string, any>;
}

export class EventLedger {
  private static instance: EventLedger;
  private db: KinDatabase;
  private secretBroker: SecretBroker;

  private constructor(db: KinDatabase) {
    this.db = db;
    this.secretBroker = SecretBroker.getInstance();
  }

  public static initialize(db: KinDatabase): EventLedger {
    EventLedger.instance = new EventLedger(db);
    return EventLedger.instance;
  }

  public static isInitialized(): boolean {
    return Boolean(EventLedger.instance);
  }

  public static ensureInitialized(db: KinDatabase): EventLedger {
    if (!EventLedger.instance) {
      EventLedger.instance = new EventLedger(db);
    } else if (db && (EventLedger.instance.db !== db || (EventLedger.instance.db as any).isClosed)) {
      EventLedger.instance.db = db;
    }
    return EventLedger.instance;
  }

  public static getInstance(): EventLedger {
    if (!EventLedger.instance) {
      throw new Error('EventLedger has not been initialized with KinDatabase.');
    }
    return EventLedger.instance;
  }

  /**
   * Appends an authoritative, sanitized lifecycle event into event_journal.
   */
  public record(params: LedgerEventParams): number {
    const sanitizedPayload = this.secretBroker.sanitizePayload(params.payload);
    const payloadJson = JSON.stringify(sanitizedPayload);
    const now = Date.now();

    return this.db.transactionSync(() => {
      let prevHash = 'GENESIS_HASH_0000000000000000';
      try {
        const lastRow = this.db.queryOne<{
          record_hash?: string;
        }>('SELECT record_hash FROM event_journal WHERE record_hash IS NOT NULL ORDER BY id DESC LIMIT 1');
        if (lastRow?.record_hash) {
          prevHash = lastRow.record_hash;
        }
      } catch {}

      const recordHash = crypto
        .createHash('sha256')
        .update(`${prevHash}:${params.eventType}:${params.entityType}:${params.entityId}:${params.runId || ''}:${payloadJson}:${now}`)
        .digest('hex');

      const result = this.db.execute(
        `INSERT INTO event_journal (event_type, entity_type, entity_id, run_id, payload_json, record_hash, prev_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params.eventType,
        params.entityType,
        params.entityId,
        params.runId || null,
        payloadJson,
        recordHash,
        prevHash,
        now
      );

      return Number(result.lastInsertRowid);
    });
  }

  /**
   * Retrieves recent audit events for a specific run or entity.
   */
  public getEventsForRun(runId: string, limit: number = 50): Array<{
    id: number;
    eventType: string;
    entityType: string;
    entityId: string;
    runId: string | null;
    payload: Record<string, any>;
    createdAt: number;
  }> {
    const rows = this.db.query<{
      id: number;
      event_type: string;
      entity_type: string;
      entity_id: string;
      run_id: string | null;
      payload_json: string;
      created_at: number;
    }>(
      `SELECT id, event_type, entity_type, entity_id, run_id, payload_json, created_at
       FROM event_journal
       WHERE run_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
      runId,
      limit
    );

    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      entityType: r.entity_type,
      entityId: r.entity_id,
      runId: r.run_id,
      payload: JSON.parse(r.payload_json || '{}'),
      createdAt: r.created_at,
    }));
  }
  /**
   * Verifies cryptographic hash chain integrity across all journal records.
   */
  public verifyChainIntegrity(): {
    valid: boolean;
    verifiedCount: number;
    compromisedId?: number;
    error?: string;
  } {
    const rows = this.db.query<{
      id: number;
      event_type: string;
      entity_type: string;
      entity_id: string;
      run_id: string | null;
      payload_json: string;
      record_hash: string | null;
      prev_hash: string | null;
      created_at: number;
    }>('SELECT id, event_type, entity_type, entity_id, run_id, payload_json, record_hash, prev_hash, created_at FROM event_journal ORDER BY id ASC');

    let expectedPrevHash = 'GENESIS_HASH_0000000000000000';
    let verifiedCount = 0;

    for (const row of rows) {
      if (!row.record_hash) continue;
      if (row.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          verifiedCount,
          compromisedId: row.id,
          error: `Broken chain link at event ID ${row.id}: expected prev_hash '${expectedPrevHash}', found '${row.prev_hash}'`,
        };
      }
      const expectedHash = crypto
        .createHash('sha256')
        .update(`${row.prev_hash}:${row.event_type}:${row.entity_type}:${row.entity_id}:${row.run_id || ''}:${row.payload_json}:${row.created_at}`)
        .digest('hex');
      if (row.record_hash !== expectedHash) {
        return {
          valid: false,
          verifiedCount,
          compromisedId: row.id,
          error: `Tampered event record detected at ID ${row.id}: hash mismatch`,
        };
      }
      expectedPrevHash = row.record_hash;
      verifiedCount++;
    }
    return { valid: true, verifiedCount };
  }
}
