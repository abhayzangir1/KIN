// ============================================================================
// KIN HOST CREDENTIAL AUTO-DETECTION SCANNER
// Scans local developer environment (gh CLI, gcloud, .env, environment variables)
// to enable 1-click frictionless credential import without manual token typing.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { SecretVault } from './secret_vault.js';

export interface DiscoveredCredential {
  id: string;
  provider: 'github' | 'gcloud' | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'deepseek' | 'slack' | 'notion';
  source: 'cli' | 'env' | 'dotenv';
  identifier: string; // e.g. "developer (gh CLI)" or "OPENAI_API_KEY (env)"
  maskedKey: string;
  token: string;
  alreadyImported: boolean;
}

export class CredentialScanner {
  /**
   * Scans the host environment for existing developer credentials.
   * Compares against SQLite managed_credentials to mark already-imported keys.
   */
  public static scanHostCredentials(projectRoot?: string, existingFingerprints: Set<string> = new Set()): DiscoveredCredential[] {
    const discovered: DiscoveredCredential[] = [];
    const seenTokens = new Set<string>();

    const mask = (token: string): string => {
      if (!token || token.length < 8) return '••••••••';
      return `${token.slice(0, 4)}••••${token.slice(-4)}`;
    };

    const addCred = (
      provider: DiscoveredCredential['provider'],
      source: DiscoveredCredential['source'],
      identifier: string,
      token: string
    ) => {
      const cleanToken = token.trim();
      if (!cleanToken || cleanToken.length < 8 || seenTokens.has(cleanToken)) return;
      seenTokens.add(cleanToken);

      const fp = crypto.createHash('sha256').update(cleanToken).digest('hex');
      const alreadyImported = existingFingerprints.has(fp);

      discovered.push({
        id: `${provider}-${source}-${fp.slice(0, 8)}`,
        provider,
        source,
        identifier,
        maskedKey: mask(cleanToken),
        token: cleanToken,
        alreadyImported,
      });
    };

    // 1. Scan GitHub CLI (`gh`)
    try {
      const homeDir = os.homedir();
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      const possibleGhPaths = [
        path.join(appData, 'GitHub CLI', 'hosts.yml'),
        path.join(homeDir, '.config', 'gh', 'hosts.yml'),
      ];

      for (const ghPath of possibleGhPaths) {
        if (fs.existsSync(ghPath)) {
          const content = fs.readFileSync(ghPath, 'utf-8');
          // Parse basic YAML: oauth_token: "..." and user: "..."
          const tokenMatch = content.match(/oauth_token:\s*["']?([a-zA-Z0-9_]+)["']?/);
          const userMatch = content.match(/user:\s*["']?([^"'\r\n]+)["']?/);
          if (tokenMatch && tokenMatch[1]) {
            const username = userMatch ? userMatch[1].trim() : 'local-user';
            addCred('github', 'cli', `${username} (GitHub CLI)`, tokenMatch[1].trim());
            break;
          }
        }
      }

      // If hosts.yml wasn't readable, attempt quick `gh auth token` execution (with strict 1500ms timeout)
      if (!discovered.some((c) => c.provider === 'github' && c.source === 'cli')) {
        try {
          const output = execSync('gh auth token', {
            timeout: 1500,
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf-8',
          }).trim();
          if (output && output.length > 10) {
            addCred('github', 'cli', 'GitHub CLI session', output);
          }
        } catch (err) { console.debug("[credential_scanner] Suppressed exception in catch block:", err); }
      }
    } catch (err) { console.debug("[credential_scanner] Suppressed exception in catch block:", err); }

    // 2. Scan Process Environment Variables
    const envMappings: Array<{ key: string; provider: DiscoveredCredential['provider']; name: string }> = [
      { key: 'GITHUB_TOKEN', provider: 'github', name: 'GITHUB_TOKEN' },
      { key: 'GH_TOKEN', provider: 'github', name: 'GH_TOKEN' },
      { key: 'OPENAI_API_KEY', provider: 'openai', name: 'OPENAI_API_KEY' },
      { key: 'ANTHROPIC_API_KEY', provider: 'anthropic', name: 'ANTHROPIC_API_KEY' },
      { key: 'GEMINI_API_KEY', provider: 'gemini', name: 'GEMINI_API_KEY' },
      { key: 'GROQ_API_KEY', provider: 'groq', name: 'GROQ_API_KEY' },
      { key: 'DEEPSEEK_API_KEY', provider: 'deepseek', name: 'DEEPSEEK_API_KEY' },
      { key: 'SLACK_BOT_TOKEN', provider: 'slack', name: 'SLACK_BOT_TOKEN' },
      { key: 'NOTION_API_KEY', provider: 'notion', name: 'NOTION_API_KEY' },
    ];

    for (const mapping of envMappings) {
      const val = process.env[mapping.key];
      if (val && val.trim().length > 8) {
        addCred(mapping.provider, 'env', `${mapping.name} (Environment)`, val.trim());
      }
    }

    // 3. Scan Project .env / .env.local if projectRoot exists
    if (projectRoot && fs.existsSync(projectRoot)) {
      const dotenvFiles = ['.env', '.env.local'];
      for (const file of dotenvFiles) {
        const fullPath = path.join(projectRoot, file);
        if (fs.existsSync(fullPath)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx <= 0) continue;
              const k = trimmed.slice(0, eqIdx).trim();
              let v = trimmed.slice(eqIdx + 1).trim();
              if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1);
              }
              const match = envMappings.find((m) => m.key.toLowerCase() === k.toLowerCase());
              if (match && v.length > 8) {
                addCred(match.provider, 'dotenv', `${k} (${file})`, v);
              }
            }
          } catch (err) { console.debug("[credential_scanner] Suppressed exception in catch block:", err); }
        }
      }
    }

    return discovered;
  }

  /**
   * Imports a discovered credential into SQLite managed_credentials using AES-256-GCM encryption.
   */
  public static importCredential(
    db: any,
    cred: { provider: string; keyAlias: string; token: string; baseUrl?: string }
  ): { success: boolean; id: string; error?: string } {
    try {
      const vault = SecretVault.getInstance();
      const secretHash = vault.encrypt(cred.token);
      const keyFingerprint = crypto.createHash('sha256').update(cred.token.trim()).digest('hex');
      const maskedKey = `${cred.token.slice(0, 4)}••••${cred.token.slice(-4)}`;
      const id = `cred-${cred.provider}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();

      // Check if duplicate exists
      const existing = db.queryOne(
        'SELECT id FROM managed_credentials WHERE key_fingerprint = ? OR (provider = ? AND key_alias = ?)',
        keyFingerprint,
        cred.provider,
        cred.keyAlias
      );

      if (existing) {
        db.execute(
          'UPDATE managed_credentials SET secret_hash = ?, masked_key = ?, is_active = 1, updated_at = ? WHERE id = ?',
          secretHash,
          maskedKey,
          now,
          existing.id
        );
        return { success: true, id: existing.id };
      }

      db.execute(
        `INSERT INTO managed_credentials (
          id, provider, key_alias, secret_hash, masked_key, key_fingerprint,
          base_url, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL, 0, 1, ?, ?)`,
        id,
        cred.provider,
        cred.keyAlias,
        secretHash,
        maskedKey,
        keyFingerprint,
        cred.baseUrl || null,
        now,
        now
      );

      return { success: true, id };
    } catch (err: any) {
      return { success: false, id: '', error: err?.message || 'Failed to import credential' };
    }
  }
}
