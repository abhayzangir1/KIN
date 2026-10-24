// ============================================================================
// KIN SECRET BROKER
// Resolves {{vault:NAME}} placeholders strictly at invocation time and
// sanitizes tool observations, logs, and checkpoints to prevent secret leakage.
// ============================================================================

import { SecretVault } from './secret_vault.js';
import { KinDatabase } from '../storage/db.js';
import { EventLedger } from './event_ledger.js';

export class SecretBroker {
  private static instance: SecretBroker;
  private vault: SecretVault;
  private db?: KinDatabase;
  private knownSecrets: Set<string> = new Set();

  private constructor(db?: KinDatabase) {
    this.vault = SecretVault.getInstance();
    this.db = db;
  }

  public static getInstance(db?: KinDatabase): SecretBroker {
    if (!SecretBroker.instance) {
      SecretBroker.instance = new SecretBroker(db);
    } else if (db && !SecretBroker.instance.db) {
      SecretBroker.instance.db = db;
    }
    return SecretBroker.instance;
  }

  public setDatabase(db: KinDatabase): void {
    this.db = db;
  }

  /**
   * Registers a known secret value in memory to ensure it is redacted from all output traces.
   */
  public registerSecretForRedaction(secret: string): void {
    if (secret && typeof secret === 'string' && secret.trim().length >= 4) {
      this.knownSecrets.add(secret.trim());
    }
  }

  /**
   * Recursively scans an object or string and substitutes {{vault:KEY}} placeholders with decrypted values.
   */
  public resolvePlaceholders<T = any>(input: T, callerAgentId?: string): T {
    if (typeof input === 'string') {
      return this.resolveString(input, callerAgentId) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.resolvePlaceholders(item, callerAgentId)) as unknown as T;
    }

    if (input !== null && typeof input === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(input)) {
        result[key] = this.resolvePlaceholders(value, callerAgentId);
      }
      return result as T;
    }

    return input;
  }

  private resolveString(str: string, callerAgentId?: string): string {
    const vaultPattern = /\{\{vault:([a-zA-Z0-9_\-.:]+)\}\}/g;
    return str.replace(vaultPattern, (_match, keyName) => {
      // 1. If keyName is already a vault ciphertext (e.g. vault:v1:...), decrypt directly
      if (keyName.startsWith('vault:v1:')) {
        if (callerAgentId && callerAgentId !== 'system' && callerAgentId !== 'operator') {
          return `[DENIED_UNAUTHORIZED_KEY_ACCESS:${keyName}]`;
        }
        const decrypted = this.vault.decrypt(keyName);
        if (decrypted && decrypted !== keyName) {
          this.registerSecretForRedaction(decrypted);
          return decrypted;
        }
      }

      // 2. Otherwise query managed_credentials where key_alias = keyName, id = keyName, or provider = keyName
      let ciphertextToDecrypt = keyName;
      if (this.db) {
        try {
          const row = this.db.queryOne<{
            secret_hash: string;
            scoped_grants_json?: string;
            max_spend_tokens?: number;
            current_spend_tokens?: number;
          }>(
            `SELECT secret_hash, scoped_grants_json, max_spend_tokens, current_spend_tokens FROM managed_credentials 
             WHERE (key_alias = ? OR id = ? OR provider = ?) AND is_active = 1 
             ORDER BY CASE WHEN key_alias = ? THEN 1 WHEN id = ? THEN 2 ELSE 3 END, updated_at DESC LIMIT 1`,
            keyName,
            keyName,
            keyName,
            keyName,
            keyName
          );
          if (row?.secret_hash) {
            // Check spend cap
            if (
              typeof row.max_spend_tokens === 'number' &&
              row.max_spend_tokens > 0 &&
              typeof row.current_spend_tokens === 'number' &&
              row.current_spend_tokens >= row.max_spend_tokens
            ) {
              try {
                EventLedger.getInstance().record({
                  eventType: 'SECURITY_ALERT',
                  entityType: 'credential',
                  entityId: keyName,
                  payload: {
                    reason: `Spend cap exceeded for key '${keyName}' (${row.current_spend_tokens}/${row.max_spend_tokens})`,
                    keyName,
                    currentSpend: row.current_spend_tokens,
                    maxSpend: row.max_spend_tokens,
                  },
                });
              } catch {}
              return `[DENIED_SPEND_CAP_EXCEEDED:${keyName}]`;
            }

            // Enforce default-deny scoped authorization: caller agents must be explicitly granted access or '*'
            let grants: string[] = [];
            if (row.scoped_grants_json && row.scoped_grants_json.trim()) {
              try {
                const parsed = JSON.parse(row.scoped_grants_json);
                if (Array.isArray(parsed)) grants = parsed;
              } catch {}
            }

            if (callerAgentId && callerAgentId !== 'system' && callerAgentId !== 'operator') {
              const isGranted = grants.includes('*') || grants.includes(callerAgentId);
              if (!isGranted) {
                try {
                  EventLedger.getInstance().record({
                    eventType: 'SECURITY_ALERT',
                    entityType: 'agent',
                    entityId: callerAgentId,
                    payload: {
                      reason: `Unauthorized secret placeholder access attempt for key '${keyName}' (scoped grants violated)`,
                      keyName,
                    },
                  });
                } catch {}
                return `[DENIED_UNAUTHORIZED_KEY_ACCESS:${keyName}]`;
              }
            }
            ciphertextToDecrypt = row.secret_hash;
          }
        } catch {}
      }

      const decrypted = this.vault.decrypt(ciphertextToDecrypt);
      if (decrypted && decrypted !== ciphertextToDecrypt) {
        this.registerSecretForRedaction(decrypted);
        return decrypted;
      }
      return keyName;
    });
  }

  /**
   * Redacts all registered secret material from output strings, error traces, and observation objects.
   */
  public redactSecrets(content: string): string {
    if (!content || typeof content !== 'string') return content;

    let sanitized = content;

    // 1. Redact explicit known registered secrets
    for (const secret of this.knownSecrets) {
      if (secret.length >= 4 && sanitized.includes(secret)) {
        sanitized = sanitized.split(secret).join('[REDACTED][REDACTED_SECRET]');
      }
    }

    // 2. Redact typical Bearer tokens and API key patterns
    sanitized = sanitized.replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]{16,}/gi, '$1[REDACTED][REDACTED_TOKEN]');
    sanitized = sanitized.replace(/(sk-[a-zA-Z0-9_\-]{20,})/gi, '[REDACTED][REDACTED_KEY]');
    sanitized = sanitized.replace(/(gh[pousr]_[a-zA-Z0-9_]{20,})/gi, '[REDACTED][REDACTED_GITHUB_TOKEN]');
    sanitized = sanitized.replace(/(AIza[0-9A-Za-z\-_]{35})/g, '[REDACTED][REDACTED_GOOGLE_KEY]');
    sanitized = sanitized.replace(/(xox[baprs]-[0-9a-zA-Z\-]{10,})/gi, '[REDACTED][REDACTED_SLACK_TOKEN]');
    sanitized = sanitized.replace(/(Bot\s+)?([a-zA-Z0-9_\-]{24,28}\.[a-zA-Z0-9_\-]{6}\.[a-zA-Z0-9_\-]{27,38})/gi, (_m, botPrefix) => (botPrefix || '') + '[REDACTED][REDACTED_DISCORD_TOKEN]');
    sanitized = sanitized.replace(/(bot)?(\d{8,12}:[a-zA-Z0-9_-]{35})/gi, (_m, b) => (b ? 'bot' : '') + '[REDACTED][REDACTED_TELEGRAM_TOKEN]');
    sanitized = sanitized.replace(/(AKIA[0-9A-Z]{16})/g, '[REDACTED][REDACTED_AWS_KEY]');
    sanitized = sanitized.replace(/(glpat-[0-9a-zA-Z\-_]{20,})/gi, '[REDACTED][REDACTED_GITLAB_TOKEN]');
    sanitized = sanitized.replace(/(eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,})/g, '[REDACTED][REDACTED_JWT]');

    return sanitized;
  }

  /**
   * Recursively redacts secrets in any arbitrary payload (object, array, or string).
   */
  public sanitizePayload<T = any>(payload: T): T {
    if (typeof payload === 'string') {
      return this.redactSecrets(payload) as unknown as T;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.sanitizePayload(item)) as unknown as T;
    }

    if (payload !== null && typeof payload === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (typeof value === 'string') {
          const redacted = this.redactSecrets(value);
          if (redacted !== value) {
            sanitized[key] = redacted;
          } else if (/apiKey|api_key/i.test(key)) {
            sanitized[key] = '[REDACTED][REDACTED_KEY]';
          } else if (
            /auth_?header|auth_?token|bearer_?token|access_?token|refresh_?token|session_?token|jwt_?token|secret_?token|ipc_?token/i.test(key) ||
            (key.toLowerCase() === 'auth') ||
            (key.toLowerCase() === 'token' && !('runId' in (payload as any) || 'agentId' in (payload as any) || 'channelId' in (payload as any)))
          ) {
            sanitized[key] = '[REDACTED][REDACTED_TOKEN]';
          } else if (/secret|password/i.test(key)) {
            sanitized[key] = '[REDACTED][REDACTED_SECRET]';
          } else {
            sanitized[key] = redacted;
          }
        } else {
          sanitized[key] = this.sanitizePayload(value);
        }
      }
      return sanitized as T;
    }

    return payload;
  }
}
