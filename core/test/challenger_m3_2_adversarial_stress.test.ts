// ============================================================================
// EMPIRICAL CHALLENGER STRESS HARNESS: MILESTONE 3 (CHALLENGER M3-2)
// Adversarial stress test suite covering:
// 1. Settings BYOK Vault & Scoped Grants:
//    - Wildcard ('*') vs explicit agent grants vs empty default-deny fail-closed.
//    - [DENIED_UNAUTHORIZED_KEY_ACCESS] enforcement across placeholders & ciphertexts.
//    - Spend cap token exhaustion ([DENIED_SPEND_CAP_EXCEEDED]) and EventLedger SECURITY_ALERT logging.
//    - Malformed scoped_grants_json fail-closed resilience.
// 2. Scoped Egress Consent:
//    - Master cloud egress toggle kill-switch (instant revocation of in-flight external transmissions).
//    - Data classification opt-in boundaries (private memory / notes & DM history blocked even when cloud enabled).
//    - Web search context boundary enforcement.
// 3. Operational Banners & Desktop Window State:
//    - HTTP 429 countdown interval under rapid clock changes, negative diffs, expired reset times, and jitter.
//    - Desktop Window State JSON persistence resilience (malformed JSON, out-of-bounds, oversized, sub-minimum).
// 4. Diff Hunk Parsing:
//    - Malformed diff strings, multi-hunk diffs with overlapping line offsets, additions-only, deletions-only, empty files, and EOF markers.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { SecretBroker } from '../src/security/secret_broker.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { QuotaGuard } from '../src/execution/quota_guard.js';
import { parseUnifiedDiff, ParsedDiff } from '../../ui/src/components/code/UnifiedDiffViewer.js';
import { parseUnifiedDiff as parseCoreUnifiedDiff, ParsedDiff as CoreParsedDiff } from '../src/domain/diff_parser.js';
import {
  validateAndClampWindowState as validateAndClampProductionWindowState,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  WindowState,
  MonitorBounds,
} from '../src/domain/window_state.js';
import {
  isAgentAuthorizedForCredential,
  canEgressData,
  ProviderCredential,
  EgressConsentSettings,
} from '../src/security/egress_policy.js';

describe('Adversarial Challenger M3-2: BYOK Vault, Scoped Egress, Banners & Diff Hunk Stress Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let migrationRunner: MigrationRunner;
  let vault: SecretVault;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-challenger-m3-2-'));
    dbPath = path.join(tempDir, 'challenger_m3_2.db');
    db = new KinDatabase(dbPath);
    migrationRunner = new MigrationRunner(db);
    migrationRunner.runMigrations();
    EventLedger.ensureInitialized(db);
    vault = SecretVault.getInstance();
    SecretBroker.getInstance(db).setDatabase(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // 1. Settings BYOK Vault & Scoped Grants
  // ==========================================================================
  describe('1. Settings BYOK Vault & Scoped Grants Adversarial Challenge', () => {
    it('should enforce strict default-deny when scoped_grants_json is empty array "[]"', () => {
      const rawKey = 'sk-ant-adversarial-secret-99999';
      const encrypted = vault.encrypt(rawKey);
      const now = Date.now();

      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-empty-grants', 'anthropic', 'CLAUDE_PROD_KEY', ?, 'sk-ant...9999', '[]', 500000, 0, 1, ?, ?)`,
        encrypted,
        now,
        now
      );

      const broker = SecretBroker.getInstance(db);

      // 1. Unauthorized agent access must fail-closed with [DENIED_UNAUTHORIZED_KEY_ACCESS]
      const rogueResult = broker.resolvePlaceholders(
        { key: '{{vault:CLAUDE_PROD_KEY}}' },
        'agent-unauthorized-rogue'
      );
      expect(rogueResult.key).toBe('[DENIED_UNAUTHORIZED_KEY_ACCESS:CLAUDE_PROD_KEY]');

      // 2. Multiple different unauthorized agents must all fail-closed
      const agentIds = ['agent-coder', 'agent-evaluator', 'agent-qa', 'agent-hacker'];
      for (const agentId of agentIds) {
        const res = broker.resolvePlaceholders({ token: '{{vault:CLAUDE_PROD_KEY}}' }, agentId);
        expect(res.token).toBe('[DENIED_UNAUTHORIZED_KEY_ACCESS:CLAUDE_PROD_KEY]');
      }

      // 3. Verify security alert was recorded in event_journal
      const alerts = db.query<any>(
        "SELECT * FROM event_journal WHERE event_type = 'SECURITY_ALERT' ORDER BY id DESC"
      );
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const lastAlert = alerts[0];
      expect(lastAlert.payload_json).toContain('Unauthorized secret placeholder access attempt');
    });

    it('should grant access to all agents when scoped_grants_json contains wildcard "*"', () => {
      const rawKey = 'sk-proj-universal-wildcard-key-12345';
      const encrypted = vault.encrypt(rawKey);
      const now = Date.now();

      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-wildcard', 'openai', 'OPENAI_SHARED_KEY', ?, 'sk-pr...2345', '["*"]', 1000000, 0, 1, ?, ?)`,
        encrypted,
        now,
        now
      );

      const broker = SecretBroker.getInstance(db);

      // Any agent should successfully resolve decrypted secret
      const testAgents = ['agent-architect', 'agent-coder', 'agent-ephemeral-test', 'agent-any'];
      for (const agentId of testAgents) {
        const res = broker.resolvePlaceholders({ key: '{{vault:OPENAI_SHARED_KEY}}' }, agentId);
        expect(res.key).toBe(rawKey);
      }

      // System / operator also resolves
      const sysRes = broker.resolvePlaceholders({ key: '{{vault:OPENAI_SHARED_KEY}}' });
      expect(sysRes.key).toBe(rawKey);
    });

    it('should strictly isolate explicit specialist grants and reject non-granted agents', () => {
      const rawKey = 'sk-deepseek-specialist-secret-88888';
      const encrypted = vault.encrypt(rawKey);
      const now = Date.now();

      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-explicit-specialists', 'deepseek', 'DEEPSEEK_SPECIALIST_KEY', ?, 'sk-de...8888', '["agent-architect", "agent-lead-dev"]', 500000, 0, 1, ?, ?)`,
        encrypted,
        now,
        now
      );

      const broker = SecretBroker.getInstance(db);

      // Granted agents get decrypted key
      expect(
        broker.resolvePlaceholders({ k: '{{vault:DEEPSEEK_SPECIALIST_KEY}}' }, 'agent-architect').k
      ).toBe(rawKey);
      expect(
        broker.resolvePlaceholders({ k: '{{vault:DEEPSEEK_SPECIALIST_KEY}}' }, 'agent-lead-dev').k
      ).toBe(rawKey);

      // Non-granted agents are rejected
      expect(
        broker.resolvePlaceholders({ k: '{{vault:DEEPSEEK_SPECIALIST_KEY}}' }, 'agent-qa').k
      ).toBe('[DENIED_UNAUTHORIZED_KEY_ACCESS:DEEPSEEK_SPECIALIST_KEY]');
      expect(
        broker.resolvePlaceholders({ k: '{{vault:DEEPSEEK_SPECIALIST_KEY}}' }, 'agent-external').k
      ).toBe('[DENIED_UNAUTHORIZED_KEY_ACCESS:DEEPSEEK_SPECIALIST_KEY]');
    });

    it('should block direct raw vault ciphertext injection by agent callers', () => {
      const rawKey = 'sk-gemini-confidential-77777';
      const encrypted = vault.encrypt(rawKey);

      const broker = SecretBroker.getInstance(db);

      // Non-operator agent injecting raw ciphertext must be denied
      const injectionRes = broker.resolvePlaceholders(
        { leak: `{{vault:${encrypted}}}` },
        'agent-malicious-prober'
      );
      expect(injectionRes.leak).toBe(`[DENIED_UNAUTHORIZED_KEY_ACCESS:${encrypted}]`);

      // Operator caller can resolve
      const opRes = broker.resolvePlaceholders({ leak: `{{vault:${encrypted}}}` }, 'operator');
      expect(opRes.leak).toBe(rawKey);
    });

    it('should enforce spend cap token limit exhaustion and trigger EventLedger alerts', () => {
      const rawKey = 'sk-groq-capped-token-33333';
      const encrypted = vault.encrypt(rawKey);
      const now = Date.now();

      // Insert credential with max_spend_tokens = 50,000 and current_spend_tokens = 50,000 (exhausted)
      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-capped-exhausted', 'groq', 'GROQ_CAPPED_KEY', ?, 'sk-gr...3333', '["*"]', 50000, 50000, 1, ?, ?)`,
        encrypted,
        now,
        now
      );

      const broker = SecretBroker.getInstance(db);

      // Resolution must return [DENIED_SPEND_CAP_EXCEEDED]
      const res = broker.resolvePlaceholders({ key: '{{vault:GROQ_CAPPED_KEY}}' }, 'agent-coder');
      expect(res.key).toBe('[DENIED_SPEND_CAP_EXCEEDED:GROQ_CAPPED_KEY]');

      // Exceeded current_spend > max_spend (e.g. 50,001)
      db.execute(
        'UPDATE managed_credentials SET current_spend_tokens = 50001 WHERE id = ?',
        'cred-capped-exhausted'
      );
      const resExceeded = broker.resolvePlaceholders({ key: '{{vault:GROQ_CAPPED_KEY}}' }, 'agent-coder');
      expect(resExceeded.key).toBe('[DENIED_SPEND_CAP_EXCEEDED:GROQ_CAPPED_KEY]');

      // Spend below cap (e.g. 49,999) must allow resolution
      db.execute(
        'UPDATE managed_credentials SET current_spend_tokens = 49999 WHERE id = ?',
        'cred-capped-exhausted'
      );
      const resAllowed = broker.resolvePlaceholders({ key: '{{vault:GROQ_CAPPED_KEY}}' }, 'agent-coder');
      expect(resAllowed.key).toBe(rawKey);

      // Verify EventLedger alert was recorded
      const alert = db.queryOne<any>(
        "SELECT * FROM event_journal WHERE event_type = 'SECURITY_ALERT' AND entity_id = 'GROQ_CAPPED_KEY'"
      );
      expect(alert).toBeDefined();
      expect(alert.payload_json).toContain('Spend cap exceeded');
    });

    it('should fail-closed when scoped_grants_json is corrupted or malformed', () => {
      const rawKey = 'sk-corrupted-grants-11111';
      const encrypted = vault.encrypt(rawKey);
      const now = Date.now();

      const corruptedPayloads = [
        '{not_an_array: true}',
        'corrupted string',
        '12345',
        'null',
        '',
        '{"grant": "*"}',
      ];

      for (let i = 0; i < corruptedPayloads.length; i++) {
        const credId = `cred-corrupt-${i}`;
        const keyAlias = `CORRUPT_KEY_${i}`;
        db.execute(
          `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
           VALUES (?, 'openai', ?, ?, 'sk-co...1111', ?, 500000, 0, 1, ?, ?)`,
          credId,
          keyAlias,
          encrypted,
          corruptedPayloads[i],
          now,
          now
        );

        const broker = SecretBroker.getInstance(db);
        const res = broker.resolvePlaceholders({ k: `{{vault:${keyAlias}}}` }, 'agent-test');
        expect(res.k).toBe(`[DENIED_UNAUTHORIZED_KEY_ACCESS:${keyAlias}]`);
      }
    });

    it('should enforce exact agent ID matching and reject prefix/suffix substring confusion', () => {
      const rawKey = 'sk-exact-match-only-44444';
      const encrypted = vault.encrypt(rawKey);
      const now = Date.now();

      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-exact-agent', 'openai', 'EXACT_AGENT_KEY', ?, 'sk-ex...4444', '["agent-dev"]', 500000, 0, 1, ?, ?)`,
        encrypted,
        now,
        now
      );

      const broker = SecretBroker.getInstance(db);

      // Exact match succeeds
      expect(
        broker.resolvePlaceholders({ k: '{{vault:EXACT_AGENT_KEY}}' }, 'agent-dev').k
      ).toBe(rawKey);

      // Substring, superstring, and case variations must fail-closed
      const nonMatchingAgents = [
        'agent-dev-senior',
        'senior-agent-dev',
        'agent-de',
        'dev',
        'agent',
        'AGENT-DEV',
        'agent-dev ',
        ' agent-dev',
      ];

      for (const nonMatch of nonMatchingAgents) {
        expect(
          broker.resolvePlaceholders({ k: '{{vault:EXACT_AGENT_KEY}}' }, nonMatch).k
        ).toBe('[DENIED_UNAUTHORIZED_KEY_ACCESS:EXACT_AGENT_KEY]');
      }
    });

    it('should enforce key_alias precedence over provider name in managed_credentials lookup', () => {
      const aliasKey = 'sk-alias-specific-key-55555';
      const providerKey = 'sk-provider-generic-key-66666';
      const encAlias = vault.encrypt(aliasKey);
      const encProvider = vault.encrypt(providerKey);
      const now = Date.now();

      // Row 1: provider = 'openai', key_alias = 'OPENAI_KEY'
      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-alias', 'openai', 'OPENAI_KEY', ?, 'sk-al...5555', '["*"]', 500000, 0, 1, ?, ?)`,
        encAlias,
        now,
        now
      );

      // Row 2: provider = 'OPENAI_KEY', key_alias = 'fallback_alias' (provider match)
      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-prov', 'OPENAI_KEY', 'fallback_alias', ?, 'sk-pr...6666', '["*"]', 500000, 0, 1, ?, ?)`,
        encProvider,
        now - 1000,
        now - 1000
      );

      const broker = SecretBroker.getInstance(db);
      // Querying OPENAI_KEY must resolve row 1 (key_alias match), not row 2
      const res = broker.resolvePlaceholders({ k: '{{vault:OPENAI_KEY}}' }, 'agent-test');
      expect(res.k).toBe(aliasKey);
    });
  });

  // ==========================================================================
  // 2. Scoped Egress Consent & Data Classification
  // ==========================================================================
  describe('2. Scoped Egress Consent & Data Classification Adversarial Challenge', () => {
    interface EgressConsentState {
      masterEgressEnabled: boolean;
      allowPrompts: boolean;
      allowSharedMemory: boolean;
      allowPrivateNotes: boolean;
      allowDirectMessages: boolean;
      allowWebSearchContext: boolean;
    }

    interface OutboundTransmissionPayload {
      destination: 'cloud_llm' | 'web_search' | 'local_model';
      dataClass: 'prompt' | 'shared_memory' | 'private_note' | 'dm_history' | 'web_query';
      content: string;
      agentId: string;
    }

    /**
     * Policy evaluation oracle for PRD § 8 Scoped Egress Consent
     */
    function evaluateEgressConsent(
      payload: OutboundTransmissionPayload,
      consent: EgressConsentState
    ): { allowed: boolean; denialReason?: string } {
      // Local destinations never require cloud egress
      if (payload.destination === 'local_model') {
        return { allowed: true };
      }

      // Master cloud egress kill-switch check
      if (!consent.masterEgressEnabled) {
        return {
          allowed: false,
          denialReason: '[EGRESS_DENIED_MASTER_KILL_SWITCH] Cloud egress is globally revoked.',
        };
      }

      // Granular data classification opt-in checks
      switch (payload.dataClass) {
        case 'prompt':
          if (!consent.allowPrompts) {
            return {
              allowed: false,
              denialReason: '[EGRESS_DENIED_DATA_CLASSIFICATION] User prompt egress not opted-in.',
            };
          }
          break;

        case 'shared_memory':
          if (!consent.allowSharedMemory) {
            return {
              allowed: false,
              denialReason: '[EGRESS_DENIED_DATA_CLASSIFICATION] Project shared memory egress not opted-in.',
            };
          }
          break;

        case 'private_note':
          // PRD § 8: Global cloud enabled NEVER authorizes private memory automatically
          if (!consent.allowPrivateNotes) {
            return {
              allowed: false,
              denialReason: '[EGRESS_DENIED_DATA_CLASSIFICATION] Agent-private notes egress strictly prohibited without explicit opt-in.',
            };
          }
          break;

        case 'dm_history':
          // PRD § 8: Global cloud enabled NEVER authorizes DM content automatically
          if (!consent.allowDirectMessages) {
            return {
              allowed: false,
              denialReason: '[EGRESS_DENIED_DATA_CLASSIFICATION] Direct message history egress strictly prohibited without explicit opt-in.',
            };
          }
          break;

        case 'web_query':
          if (!consent.allowWebSearchContext) {
            return {
              allowed: false,
              denialReason: '[EGRESS_DENIED_DATA_CLASSIFICATION] Attaching project/DM context to web search query is disabled.',
            };
          }
          break;

        default:
          return { allowed: false, denialReason: '[EGRESS_DENIED_UNKNOWN_CLASS] Unknown data classification.' };
      }

      return { allowed: true };
    }

    it('should enforce air-gapped default consent denying all external transmissions', () => {
      const airGappedDefaults: EgressConsentState = {
        masterEgressEnabled: false,
        allowPrompts: false,
        allowSharedMemory: false,
        allowPrivateNotes: false,
        allowDirectMessages: false,
        allowWebSearchContext: false,
      };

      const payloads: OutboundTransmissionPayload[] = [
        { destination: 'cloud_llm', dataClass: 'prompt', content: 'Design architecture', agentId: 'agent-1' },
        { destination: 'cloud_llm', dataClass: 'shared_memory', content: 'Database schema v2', agentId: 'agent-1' },
        { destination: 'cloud_llm', dataClass: 'private_note', content: 'Personal agent draft', agentId: 'agent-1' },
        { destination: 'cloud_llm', dataClass: 'dm_history', content: 'Confidential chat between human and agent', agentId: 'agent-1' },
        { destination: 'web_search', dataClass: 'web_query', content: 'Search with project context', agentId: 'agent-1' },
      ];

      for (const p of payloads) {
        const decision = evaluateEgressConsent(p, airGappedDefaults);
        expect(decision.allowed).toBe(false);
        expect(decision.denialReason).toContain('EGRESS_DENIED_MASTER_KILL_SWITCH');
      }

      // Local models are still permitted under air-gapped mode
      const localPayload: OutboundTransmissionPayload = {
        destination: 'local_model',
        dataClass: 'prompt',
        content: 'Local Ollama inference',
        agentId: 'agent-1',
      };
      expect(evaluateEgressConsent(localPayload, airGappedDefaults).allowed).toBe(true);
    });

    it('should block private memory and DM history even when cloud egress is enabled', () => {
      // Standard cloud-enabled state (master on, prompts & shared memory on, private data OFF)
      const cloudEnabledDefaultPrivacy: EgressConsentState = {
        masterEgressEnabled: true,
        allowPrompts: true,
        allowSharedMemory: true,
        allowPrivateNotes: false, // PRD § 8: Default false
        allowDirectMessages: false, // PRD § 8: Default false
        allowWebSearchContext: false,
      };

      // 1. Prompts and shared memory pass
      expect(
        evaluateEgressConsent(
          { destination: 'cloud_llm', dataClass: 'prompt', content: 'Public prompt', agentId: 'agent-orch' },
          cloudEnabledDefaultPrivacy
        ).allowed
      ).toBe(true);

      expect(
        evaluateEgressConsent(
          { destination: 'cloud_llm', dataClass: 'shared_memory', content: 'Project goals', agentId: 'agent-orch' },
          cloudEnabledDefaultPrivacy
        ).allowed
      ).toBe(true);

      // 2. Private notes are blocked fail-closed
      const privateNoteDecision = evaluateEgressConsent(
        { destination: 'cloud_llm', dataClass: 'private_note', content: 'Confidential reasoning notes', agentId: 'agent-orch' },
        cloudEnabledDefaultPrivacy
      );
      expect(privateNoteDecision.allowed).toBe(false);
      expect(privateNoteDecision.denialReason).toContain('Agent-private notes egress strictly prohibited');

      // 3. DM history is blocked fail-closed
      const dmDecision = evaluateEgressConsent(
        { destination: 'cloud_llm', dataClass: 'dm_history', content: 'Secret DM messages', agentId: 'agent-orch' },
        cloudEnabledDefaultPrivacy
      );
      expect(dmDecision.allowed).toBe(false);
      expect(dmDecision.denialReason).toContain('Direct message history egress strictly prohibited');
    });

    it('should simulate in-flight master kill-switch instantly aborting active streams', async () => {
      // Simulated in-flight streaming transmission
      const consentState: EgressConsentState = {
        masterEgressEnabled: true,
        allowPrompts: true,
        allowSharedMemory: true,
        allowPrivateNotes: false,
        allowDirectMessages: false,
        allowWebSearchContext: false,
      };

      const emittedChunks: string[] = [];
      let transmissionAborted = false;
      const abortController = new AbortController();

      async function streamOutboundTokens(tokens: string[]): Promise<void> {
        for (let i = 0; i < tokens.length; i++) {
          if (abortController.signal.aborted || !consentState.masterEgressEnabled) {
            transmissionAborted = true;
            throw new Error('[EGRESS_KILL_SWITCH_TRIGGERED] Immediate transmission abort.');
          }
          emittedChunks.push(tokens[i]);
          await new Promise((r) => setTimeout(r, 10));

          // Simulate operator triggering emergency master kill-switch halfway through transmission
          if (i === 2) {
            consentState.masterEgressEnabled = false;
            abortController.abort();
          }
        }
      }

      const testTokens = ['Token1', 'Token2', 'Token3', 'SensitiveToken4', 'SensitiveToken5'];

      await expect(streamOutboundTokens(testTokens)).rejects.toThrow('EGRESS_KILL_SWITCH_TRIGGERED');
      expect(transmissionAborted).toBe(true);
      // Chunks after kill-switch must never have been transmitted
      expect(emittedChunks).toEqual(['Token1', 'Token2', 'Token3']);
      expect(emittedChunks).not.toContain('SensitiveToken4');
      expect(emittedChunks).not.toContain('SensitiveToken5');
    });

    it('should verify production egress_policy.ts module with air-gap defaults, classification bounds, and emergency kill-switch', () => {
      // 1. Default air-gapped configuration
      const airGapped: EgressConsentSettings = {
        masterEgressEnabled: false,
        allowPrompts: false,
        allowSharedMemory: false,
        allowPrivateNotes: false,
        allowDirectMessages: false,
      };

      expect(canEgressData('prompt', airGapped)).toBe(false);
      expect(canEgressData('privateNote', airGapped)).toBe(false);
      expect(canEgressData('dm', airGapped)).toBe(false);
      expect(canEgressData('sharedMemory', airGapped)).toBe(false);

      // 2. Selective opt-in (prompts allowed, but private notes & DMs strictly blocked)
      const selectiveConsent: EgressConsentSettings = {
        masterEgressEnabled: true,
        allowPrompts: true,
        allowSharedMemory: true,
        allowPrivateNotes: false,
        allowDirectMessages: false,
      };

      expect(canEgressData('prompt', selectiveConsent)).toBe(true);
      expect(canEgressData('sharedMemory', selectiveConsent)).toBe(true);
      expect(canEgressData('privateNote', selectiveConsent)).toBe(false);
      expect(canEgressData('dm', selectiveConsent)).toBe(false);

      // 3. Emergency revocation (kill-switch instantly blocks all categories)
      const emergencyRevoked: EgressConsentSettings = {
        ...selectiveConsent,
        masterEgressEnabled: false,
      };

      expect(canEgressData('prompt', emergencyRevoked)).toBe(false);
      expect(canEgressData('sharedMemory', emergencyRevoked)).toBe(false);
      expect(canEgressData('privateNote', emergencyRevoked)).toBe(false);
      expect(canEgressData('dm', emergencyRevoked)).toBe(false);
    });

    it('should verify production egress_policy.ts credential scoping with wildcard, explicit agents, and empty default-deny', () => {
      // Wildcard '*'
      const wildcardCred: ProviderCredential = {
        id: 'cred-1',
        provider: 'openai',
        scopedAgentIds: ['*'],
      };
      expect(isAgentAuthorizedForCredential(wildcardCred, 'agent-1')).toBe(true);
      expect(isAgentAuthorizedForCredential(wildcardCred, 'agent-random-xyz')).toBe(true);

      // Explicit agent IDs
      const explicitCred: ProviderCredential = {
        id: 'cred-2',
        provider: 'anthropic',
        scopedAgentIds: ['agent-dev', 'agent-tester'],
      };
      expect(isAgentAuthorizedForCredential(explicitCred, 'agent-dev')).toBe(true);
      expect(isAgentAuthorizedForCredential(explicitCred, 'agent-tester')).toBe(true);
      expect(isAgentAuthorizedForCredential(explicitCred, 'agent-other')).toBe(false);

      // Empty scopedAgentIds: strict default-deny
      const emptyCred: ProviderCredential = {
        id: 'cred-3',
        provider: 'groq',
        scopedAgentIds: [],
      };
      expect(isAgentAuthorizedForCredential(emptyCred, 'agent-dev')).toBe(false);
      expect(isAgentAuthorizedForCredential(emptyCred, 'agent-1')).toBe(false);
    });
  });

  // ==========================================================================
  // 3. Operational Banners & Desktop Window State
  // ==========================================================================
  describe('3. Operational Banners & Desktop Window State Adversarial Challenge', () => {
    /**
     * Oracle for HTTP 429 countdown interval computation
     */
    function compute429SecondsRemaining(targetTime: number | null | undefined, currentNow: number): number {
      if (typeof targetTime !== 'number' || isNaN(targetTime) || !isFinite(targetTime) || targetTime <= 0) {
        return 0;
      }
      if (typeof currentNow !== 'number' || isNaN(currentNow) || !isFinite(currentNow)) {
        return 0;
      }
      const diffMs = targetTime - currentNow;
      if (diffMs <= 0) return 0;
      return Math.max(0, Math.ceil(diffMs / 1000));
    }

    it('should clamp HTTP 429 countdown strictly to 0 on expired reset times and negative diffs', () => {
      const now = Date.now();

      // Expired reset times (past)
      expect(compute429SecondsRemaining(now - 1, now)).toBe(0);
      expect(compute429SecondsRemaining(now - 15000, now)).toBe(0);
      expect(compute429SecondsRemaining(now - 3600000, now)).toBe(0);

      // Boundary values
      expect(compute429SecondsRemaining(now, now)).toBe(0);
      expect(compute429SecondsRemaining(null, now)).toBe(0);
      expect(compute429SecondsRemaining(undefined, now)).toBe(0);
      expect(compute429SecondsRemaining(NaN, now)).toBe(0);
      expect(compute429SecondsRemaining(-5000, now)).toBe(0);

      // Valid future intervals
      expect(compute429SecondsRemaining(now + 1000, now)).toBe(1);
      expect(compute429SecondsRemaining(now + 45000, now)).toBe(45);
      expect(compute429SecondsRemaining(now + 60000, now)).toBe(60);
    });

    it('should maintain monotonicity and non-negativity under rapid clock changes and NTP jitter', () => {
      let simulatedNow = 1700000000000;
      const targetTime = simulatedNow + 30000; // 30 seconds ahead

      // Run 500 iterations of rapid clock fluctuations (NTP jumps, backward steps)
      for (let i = 0; i < 500; i++) {
        // Random step between -500ms (backward time jump) and +1500ms (forward step)
        const delta = Math.floor(Math.random() * 2000) - 500;
        simulatedNow += delta;

        const remaining = compute429SecondsRemaining(targetTime, simulatedNow);
        expect(remaining).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(remaining)).toBe(true);

        if (simulatedNow >= targetTime) {
          expect(remaining).toBe(0);
        }
      }
    });

    it('should verify QuotaGuard RFC 7231 HTTP-Date parsing and exponential jitter bounds', () => {
      // 1. Integer Retry-After header
      expect(QuotaGuard.parseRetryAfter('120')).toBe(120);
      expect(QuotaGuard.parseRetryAfter('0')).toBe(0);
      expect(QuotaGuard.parseRetryAfter('')).toBeUndefined();
      expect(QuotaGuard.parseRetryAfter(null)).toBeUndefined();
      expect(QuotaGuard.parseRetryAfter('not-a-number-or-date')).toBeUndefined();
      // In JS engines Date.parse('-5') parses as BC year, resulting in min clamp 1s
      expect(QuotaGuard.parseRetryAfter('-5')).toBe(1);

      // 2. RFC 7231 HTTP-Date in the past
      const pastHttpDate = 'Sun, 06 Nov 1994 08:49:37 GMT';
      expect(QuotaGuard.parseRetryAfter(pastHttpDate)).toBe(1); // Clamps to min 1 second

      // 3. RFC 7231 HTTP-Date in future
      const futureHttpDate = new Date(Date.now() + 65000).toUTCString();
      const parsedFuture = QuotaGuard.parseRetryAfter(futureHttpDate);
      expect(parsedFuture).toBeGreaterThanOrEqual(60);
      expect(parsedFuture).toBeLessThanOrEqual(70);

      // 4. Exponential jitter backoff bounds
      for (let retry = 0; retry < 10; retry++) {
        const backoff = QuotaGuard.computeExponentialJitterBackoff(retry);
        expect(backoff).toBeGreaterThanOrEqual(750); // baseMs/2 = 750
        expect(backoff).toBeLessThanOrEqual(60000 + 750);
      }

      // 5. Instructed delay with jitter
      const instructedBackoff = QuotaGuard.computeExponentialJitterBackoff(0, 10);
      expect(instructedBackoff).toBeGreaterThanOrEqual(10000); // 10s base
      expect(instructedBackoff).toBeLessThanOrEqual(13000); // 10s + 25% jitter
    });

    interface DesktopWindowState {
      x: number;
      y: number;
      width: number;
      height: number;
      is_maximized: boolean;
    }

    /**
     * Defensive WindowState validator and clamper
     */
    function validateAndClampWindowState(raw: any): DesktopWindowState {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { x: 100, y: 100, width: 1400, height: 900, is_maximized: false };
      }

      const x = typeof raw.x === 'number' && !isNaN(raw.x) ? Math.max(0, Math.floor(raw.x)) : 100;
      const y = typeof raw.y === 'number' && !isNaN(raw.y) ? Math.max(0, Math.floor(raw.y)) : 100;
      // Clamping: width min 800, max 3840; height min 600, max 2160
      const width = typeof raw.width === 'number' && !isNaN(raw.width)
        ? Math.min(3840, Math.max(800, Math.floor(raw.width)))
        : 1400;
      const height = typeof raw.height === 'number' && !isNaN(raw.height)
        ? Math.min(2160, Math.max(600, Math.floor(raw.height)))
        : 900;
      const is_maximized = Boolean(raw.is_maximized);

      return { x, y, width, height, is_maximized };
    }

    it('should withstand corrupted and malformed window state JSON payloads gracefully', () => {
      const stateFile = path.join(tempDir, 'window_state.json');

      const corruptedPayloads = [
        '',
        '   ',
        '{"x": 100, "y": ',
        '{"x": "string_val", "width": null}',
        '[]',
        'null',
        '12345',
        '{unquoted_key: 123}',
      ];

      for (const badJson of corruptedPayloads) {
        fs.writeFileSync(stateFile, badJson, 'utf-8');
        let parsed: any = null;
        try {
          parsed = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        } catch {
          parsed = null;
        }

        const safeState = validateAndClampWindowState(parsed);
        expect(safeState.width).toBeGreaterThanOrEqual(800);
        expect(safeState.height).toBeGreaterThanOrEqual(600);
        expect(safeState.x).toBeGreaterThanOrEqual(0);
        expect(safeState.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('should clamp out-of-bounds, negative, sub-minimum, and oversized window dimensions', () => {
      // Negative coordinates & sub-minimum dimensions
      const negativeInput = {
        x: -500,
        y: -300,
        width: 150, // below 800
        height: 200, // below 600
        is_maximized: false,
      };
      const clampedMin = validateAndClampWindowState(negativeInput);
      expect(clampedMin.x).toBe(0);
      expect(clampedMin.y).toBe(0);
      expect(clampedMin.width).toBe(800);
      expect(clampedMin.height).toBe(600);

      // Oversized dimensions (e.g. 100,000x50,000)
      const hugeInput = {
        x: 0,
        y: 0,
        width: 100000,
        height: 50000,
        is_maximized: true,
      };
      const clampedMax = validateAndClampWindowState(hugeInput);
      expect(clampedMax.width).toBe(3840);
      expect(clampedMax.height).toBe(2160);
      expect(clampedMax.is_maximized).toBe(true);
    });

    it('should verify production validateAndClampProductionWindowState under sub-minimum (400x300, 0x0), offscreen (6000, 3000), and empty monitors', () => {
      const monitors: MonitorBounds[] = [
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: 1920, y: 0, width: 1920, height: 1080 },
      ];

      // 1. Sub-minimum dimensions (400x300) clamped to MIN_WINDOW_WIDTH (1000) and MIN_WINDOW_HEIGHT (650)
      const tinyState: WindowState = {
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        is_maximized: false,
      };
      const clampedTiny = validateAndClampProductionWindowState(tinyState, monitors);
      expect(clampedTiny.width).toBe(MIN_WINDOW_WIDTH); // 1000
      expect(clampedTiny.height).toBe(MIN_WINDOW_HEIGHT); // 650
      expect(clampedTiny.x).toBe(100);
      expect(clampedTiny.y).toBe(100);

      // 1b. Absolute zero dimensions (0x0) clamped to >= 1000x650
      const zeroState: WindowState = {
        x: 50,
        y: 50,
        width: 0,
        height: 0,
        is_maximized: false,
      };
      const clampedZero = validateAndClampProductionWindowState(zeroState, monitors);
      expect(clampedZero.width).toBe(MIN_WINDOW_WIDTH);
      expect(clampedZero.height).toBe(MIN_WINDOW_HEIGHT);
      expect(clampedZero.x).toBe(50);
      expect(clampedZero.y).toBe(50);

      // 2. Disconnected external monitor coordinates (e.g. x: 6000, y: 3000) repositioned onto primary monitor
      const offscreenState: WindowState = {
        x: 6000,
        y: 3000,
        width: 1400,
        height: 900,
        is_maximized: false,
      };
      const clampedOffscreen = validateAndClampProductionWindowState(offscreenState, monitors);
      // Primary monitor is 1920x1080, centered: x = (1920-1400)/2 = 260, y = (1080-900)/2 = 90
      expect(clampedOffscreen.x).toBe(260);
      expect(clampedOffscreen.y).toBe(90);
      expect(clampedOffscreen.width).toBe(1400);
      expect(clampedOffscreen.height).toBe(900);

      // 3. Empty monitor array fallback
      const emptyMonitorsFallback = validateAndClampProductionWindowState(
        {
          x: -100,
          y: -50,
          width: 500,
          height: 350,
          is_maximized: true,
        },
        []
      );
      expect(emptyMonitorsFallback.x).toBe(0);
      expect(emptyMonitorsFallback.y).toBe(0);
      expect(emptyMonitorsFallback.width).toBe(MIN_WINDOW_WIDTH);
      expect(emptyMonitorsFallback.height).toBe(MIN_WINDOW_HEIGHT);
      expect(emptyMonitorsFallback.is_maximized).toBe(true);

      // Undefined monitors parameter fallback
      const undefinedMonitors = validateAndClampProductionWindowState({
        x: 200,
        y: 150,
        width: 1200,
        height: 800,
        is_maximized: false,
      });
      expect(undefinedMonitors.width).toBe(1200);
      expect(undefinedMonitors.height).toBe(800);
      expect(undefinedMonitors.x).toBe(200);
      expect(undefinedMonitors.y).toBe(150);
    });
  });

  // ==========================================================================
  // 4. Diff Hunk Parsing
  // ==========================================================================
  describe('4. Diff Hunk Parsing Adversarial Challenge', () => {
    it('should handle empty, whitespace-only, and non-diff text gracefully', () => {
      // Empty string
      const emptyRes = parseUnifiedDiff('');
      expect(emptyRes.hunks.length).toBe(0);
      expect(emptyRes.totalAdditions).toBe(0);
      expect(emptyRes.totalDeletions).toBe(0);

      // Whitespace
      const wsRes = parseUnifiedDiff('   \n\n\t  \n   ');
      expect(wsRes.hunks.length).toBe(0);
      expect(wsRes.totalAdditions).toBe(0);
      expect(wsRes.totalDeletions).toBe(0);

      // Garbage non-diff text
      const garbageRes = parseUnifiedDiff('Lorem ipsum dolor sit amet\nNot a diff at all\n{"key": "value"}');
      expect(garbageRes.hunks.length).toBe(0);
      expect(garbageRes.totalAdditions).toBe(0);
      expect(garbageRes.totalDeletions).toBe(0);
    });

    it('should parse additions-only diffs accurately with dual line numbering', () => {
      const additionsDiff = [
        '--- /dev/null',
        '+++ b/src/new_module.ts',
        '@@ -0,0 +1,5 @@',
        '+export interface UserProfile {',
        '+  id: string;',
        '+  name: string;',
        '+  email: string;',
        '+}',
      ].join('\n');

      const parsed = parseUnifiedDiff(additionsDiff);
      expect(parsed.hunks.length).toBe(1);
      expect(parsed.totalAdditions).toBe(5);
      expect(parsed.totalDeletions).toBe(0);

      const hunk = parsed.hunks[0];
      expect(hunk.newStart).toBe(1);
      expect(hunk.newCount).toBe(5);
      expect(hunk.lines.length).toBe(5);

      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        expect(line.type).toBe('add');
        expect(line.newLineNumber).toBe(1 + i);
        expect(line.oldLineNumber).toBeUndefined();
      }
    });

    it('should parse deletions-only diffs accurately with dual line numbering', () => {
      const deletionsDiff = [
        '--- a/src/deprecated.ts',
        '+++ /dev/null',
        '@@ -1,4 +0,0 @@',
        '-export function obsoleteMethod() {',
        '-  console.warn("Deprecated");',
        '-  return null;',
        '-}',
      ].join('\n');

      const parsed = parseUnifiedDiff(deletionsDiff);
      expect(parsed.hunks.length).toBe(1);
      expect(parsed.totalAdditions).toBe(0);
      expect(parsed.totalDeletions).toBe(4);

      const hunk = parsed.hunks[0];
      expect(hunk.oldStart).toBe(1);
      expect(hunk.oldCount).toBe(4);
      expect(hunk.lines.length).toBe(4);

      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        expect(line.type).toBe('delete');
        expect(line.oldLineNumber).toBe(1 + i);
        expect(line.newLineNumber).toBeUndefined();
      }
    });

    it('should handle multi-hunk diffs with overlapping line offsets cleanly', () => {
      // Overlapping offsets from cherry-pick or complex conflict merge
      const overlappingHunkDiff = `--- a/src/pipeline.ts
+++ b/src/pipeline.ts
@@ -10,4 +10,5 @@ function init() {
  const a = 1;
- const b = 2;
+ const b = 20;
+ const c = 30;
  return a + b;
 }
@@ -12,5 +13,6 @@ function cleanup() {
  const x = 10;
- const y = 20;
+ const y = 200;
+ const z = 300;
  return x + y;
 }
`;

      const parsed = parseUnifiedDiff(overlappingHunkDiff);
      expect(parsed.hunks.length).toBe(2);
      expect(parsed.totalAdditions).toBe(4);
      expect(parsed.totalDeletions).toBe(2);

      const hunk1 = parsed.hunks[0];
      expect(hunk1.oldStart).toBe(10);
      expect(hunk1.newStart).toBe(10);

      const hunk2 = parsed.hunks[1];
      expect(hunk2.oldStart).toBe(12);
      expect(hunk2.newStart).toBe(13);

      // Verify hunk 1 lines
      const h1Adds = hunk1.lines.filter((l) => l.type === 'add');
      expect(h1Adds.length).toBe(2);
      expect(h1Adds[0].newLineNumber).toBe(11);
      expect(h1Adds[1].newLineNumber).toBe(12);

      // Verify hunk 2 lines
      const h2Adds = hunk2.lines.filter((l) => l.type === 'add');
      expect(h2Adds.length).toBe(2);
      expect(h2Adds[0].newLineNumber).toBe(14);
      expect(h2Adds[1].newLineNumber).toBe(15);
    });

    it('should handle "\\ No newline at end of file" marker without corrupting line numbers', () => {
      const noNewlineDiff = `--- a/src/test.txt
+++ b/src/test.txt
@@ -1,2 +1,3 @@
 line 1
-line 2
\\ No newline at end of file
+line 2 updated
+line 3 added
\\ No newline at end of file
`;

      const parsed = parseUnifiedDiff(noNewlineDiff);
      expect(parsed.hunks.length).toBe(1);
      expect(parsed.totalAdditions).toBe(2);
      expect(parsed.totalDeletions).toBe(1);

      const hunk = parsed.hunks[0];
      const eofMarkers = hunk.lines.filter((l) => l.text.startsWith('\\'));
      expect(eofMarkers.length).toBe(2);
    });

    it('should withstand 100 generated adversarial diff payloads without crashing', () => {
      for (let i = 0; i < 100; i++) {
        const oldStart = Math.floor(Math.random() * 500) + 1;
        const newStart = Math.floor(Math.random() * 500) + 1;
        const adds = Math.floor(Math.random() * 10);
        const dels = Math.floor(Math.random() * 10);

        let mockDiff = `@@ -${oldStart},${dels + 2} +${newStart},${adds + 2} @@ heading\n`;
        mockDiff += ' context before\n';
        for (let a = 0; a < adds; a++) {
          mockDiff += `+added line ${a}\n`;
        }
        for (let d = 0; d < dels; d++) {
          mockDiff += `-deleted line ${d}\n`;
        }
        mockDiff += ' context after\n';

        const result = parseUnifiedDiff(mockDiff);
        expect(result.hunks.length).toBe(1);
        expect(result.totalAdditions).toBe(adds);
        expect(result.totalDeletions).toBe(dels);
      }
    });

    it('should parse multi-file diff streams separating file headers and hunks cleanly', () => {
      const multiFileDiff = [
        'diff --git a/src/file_a.ts b/src/file_a.ts',
        'index 1111111..2222222 100644',
        '--- a/src/file_a.ts',
        '+++ b/src/file_a.ts',
        '@@ -1,3 +1,4 @@',
        ' export const A = 1;',
        '+export const B = 2;',
        ' export const C = 3;',
        'diff --git a/src/file_b.ts b/src/file_b.ts',
        'index 3333333..4444444 100644',
        '--- a/src/file_b.ts',
        '+++ b/src/file_b.ts',
        '@@ -10,3 +10,3 @@',
        '-export const X = 10;',
        '+export const X = 100;',
        ' export const Y = 20;',
      ].join('\n');

      const parsed = parseUnifiedDiff(multiFileDiff);
      expect(parsed.hunks.length).toBe(2);
      expect(parsed.totalAdditions).toBe(2); // +B=2, +X=100
      expect(parsed.totalDeletions).toBe(1); // -X=10

      // First file hunk
      expect(parsed.hunks[0].newStart).toBe(1);
      expect(parsed.hunks[0].lines.some((l) => l.text === 'export const B = 2;')).toBe(true);

      // Second file hunk
      expect(parsed.hunks[1].newStart).toBe(10);
      expect(parsed.hunks[1].lines.some((l) => l.text === 'export const X = 100;')).toBe(true);
    });

    it('should stress-test production core parseCoreUnifiedDiff across multi-file, additions-only, deletions-only, overlapping offsets, and randomized diffs', () => {
      // 1. Empty / non-string inputs
      expect(parseCoreUnifiedDiff('').hunks.length).toBe(0);
      expect(parseCoreUnifiedDiff('   \n\t\n  ').hunks.length).toBe(0);
      expect(parseCoreUnifiedDiff(null as any).hunks.length).toBe(0);
      expect(parseCoreUnifiedDiff(undefined as any).hunks.length).toBe(0);

      // 2. Additions-only
      const addsDiff = [
        '--- /dev/null',
        '+++ b/src/new_feature.ts',
        '@@ -0,0 +1,4 @@',
        '+line 1',
        '+line 2',
        '+line 3',
        '+line 4',
      ].join('\n');
      const parsedAdds = parseCoreUnifiedDiff(addsDiff);
      expect(parsedAdds.hunks.length).toBe(1);
      expect(parsedAdds.totalAdditions).toBe(4);
      expect(parsedAdds.totalDeletions).toBe(0);
      expect(parsedAdds.hunks[0].additions).toBe(4);
      expect(parsedAdds.hunks[0].deletions).toBe(0);
      expect(parsedAdds.hunks[0].lines.every((l) => l.type === 'add' && l.oldLineNumber === undefined && l.newLineNumber! >= 1)).toBe(true);

      // 3. Deletions-only
      const delsDiff = [
        '--- a/src/old_feature.ts',
        '+++ /dev/null',
        '@@ -1,3 +0,0 @@',
        '-old line 1',
        '-old line 2',
        '-old line 3',
      ].join('\n');
      const parsedDels = parseCoreUnifiedDiff(delsDiff);
      expect(parsedDels.hunks.length).toBe(1);
      expect(parsedDels.totalAdditions).toBe(0);
      expect(parsedDels.totalDeletions).toBe(3);
      expect(parsedDels.hunks[0].additions).toBe(0);
      expect(parsedDels.hunks[0].deletions).toBe(3);
      expect(parsedDels.hunks[0].lines.every((l) => l.type === 'delete' && l.newLineNumber === undefined && l.oldLineNumber! >= 1)).toBe(true);

      // 4. Overlapping offsets multi-hunk
      const overlapDiff = [
        '--- a/src/overlap.ts',
        '+++ b/src/overlap.ts',
        '@@ -5,4 +5,5 @@',
        ' unchanged',
        '-old',
        '+new1',
        '+new2',
        ' unchanged',
        '@@ -8,4 +9,5 @@',
        ' unchanged',
        '-old2',
        '+new3',
        '+new4',
        ' unchanged',
      ].join('\n');
      const parsedOverlap = parseCoreUnifiedDiff(overlapDiff);
      expect(parsedOverlap.hunks.length).toBe(2);
      expect(parsedOverlap.totalAdditions).toBe(4);
      expect(parsedOverlap.totalDeletions).toBe(2);
      expect(parsedOverlap.hunks[0].oldStart).toBe(5);
      expect(parsedOverlap.hunks[0].newStart).toBe(5);
      expect(parsedOverlap.hunks[1].oldStart).toBe(8);
      expect(parsedOverlap.hunks[1].newStart).toBe(9);

      // 5. Multi-file diff stream
      const multiFile = [
        'diff --git a/file1.ts b/file1.ts',
        '--- a/file1.ts',
        '+++ b/file1.ts',
        '@@ -1,2 +1,3 @@',
        ' line1',
        '+line1.5',
        ' line2',
        'diff --git a/file2.ts b/file2.ts',
        '--- a/file2.ts',
        '+++ b/file2.ts',
        '@@ -10,3 +10,2 @@',
        ' line10',
        '-line11',
        ' line12',
      ].join('\n');
      const parsedMulti = parseCoreUnifiedDiff(multiFile);
      expect(parsedMulti.hunks.length).toBe(2);
      expect(parsedMulti.totalAdditions).toBe(1);
      expect(parsedMulti.totalDeletions).toBe(1);

      // 6. 100 randomized diff stress iterations
      for (let i = 0; i < 100; i++) {
        const oStart = Math.floor(Math.random() * 200) + 1;
        const nStart = Math.floor(Math.random() * 200) + 1;
        const adds = Math.floor(Math.random() * 8);
        const dels = Math.floor(Math.random() * 8);

        let randomDiff = `@@ -${oStart},${dels + 2} +${nStart},${adds + 2} @@ section\n`;
        randomDiff += ' ctx_before\n';
        for (let a = 0; a < adds; a++) randomDiff += `+add_${a}\n`;
        for (let d = 0; d < dels; d++) randomDiff += `-del_${d}\n`;
        randomDiff += ' ctx_after\n';

        const res = parseCoreUnifiedDiff(randomDiff);
        expect(res.hunks.length).toBe(1);
        expect(res.totalAdditions).toBe(adds);
        expect(res.totalDeletions).toBe(dels);
        expect(res.hunks[0].additions).toBe(adds);
        expect(res.hunks[0].deletions).toBe(dels);
      }
    });
  });
});
