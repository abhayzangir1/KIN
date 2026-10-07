// ============================================================================
// KIN SECRET BROKER
// Resolves {{vault:NAME}} placeholders strictly at invocation time and
// sanitizes tool observations, logs, and checkpoints to prevent secret leakage.
// ============================================================================

import { SecretVault } from './secret_vault.js';
import { KinDatabase } from '../storage/db.js';

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
  public resolvePlaceholders<T = any>(input: T): T {
    if (typeof input === 'string') {
      return this.resolveString(input) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.resolvePlaceholders(item)) as unknown as T;
    }

    if (input !== null && typeof input === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(input)) {
        result[key] = this.resolvePlaceholders(value);
      }
      return result as T;
    }

    return input;
  }

  private resolveString(str: string): string {
    const vaultPattern = /\{\{vault:([a-zA-Z0-9_\-.:]+)\}\}/g;
    return str.replace(vaultPattern, (_match, keyName) => {
      // 1. If keyName is already a vault ciphertext (e.g. vault:v1:...), decrypt directly
      if (keyName.startsWith('vault:v1:')) {
        const decrypted = this.vault.decrypt(keyName);
        if (decrypted && decrypted !== keyName) {
          this.registerSecretForRedaction(decrypted);
          return decrypted;
        }
      }

      // 2. Otherwise query managed_credentials where key_alias = keyName
      let ciphertextToDecrypt = keyName;
      if (this.db) {
        try {
          const row = this.db.queryOne<{ secret_hash: string }>(
            `SELECT secret_hash FROM managed_credentials WHERE key_alias = ? OR id = ? OR provider = ? LIMIT 1`,
            keyName,
            keyName,
            keyName
          );
          if (row?.secret_hash) {
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
    sanitized = sanitized.replace(/(ghp_[a-zA-Z0-9]{20,})/gi, '[REDACTED][REDACTED_GITHUB_TOKEN]');

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
          } else if (/token|auth/i.test(key)) {
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
