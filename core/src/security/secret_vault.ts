// ============================================================================
// KIN SECRET VAULT
// AES-256-GCM credential encryption and zero-knowledge key storage.
// Encrypts managed credentials stored at rest in SQLite.
// ============================================================================

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SecretVaultOptions {
  masterKey?: string | Buffer;
  keyFilePath?: string;
}

export class SecretVault {
  private static instance: SecretVault | null = null;
  private masterKey: Buffer;
  private keyFilePath: string;

  constructor(options?: SecretVaultOptions) {
    const cwd = process.cwd();
    const homeDir = process.env.USERPROFILE || process.env.HOME || process.env.APPDATA || cwd;
    const homeKeyPath = path.resolve(homeDir, '.kin', 'vault.key');
    const localKeyPath = path.resolve(cwd, '.kin', 'vault.key');

    if (options?.keyFilePath) {
      this.keyFilePath = options.keyFilePath;
    } else if (fs.existsSync(homeKeyPath)) {
      this.keyFilePath = homeKeyPath;
    } else if (fs.existsSync(localKeyPath)) {
      this.keyFilePath = localKeyPath;
    } else {
      this.keyFilePath = homeKeyPath;
    }

    if (options?.masterKey) {
      if (Buffer.isBuffer(options.masterKey)) {
        if (options.masterKey.length === 32) {
          this.masterKey = options.masterKey;
        } else {
          this.masterKey = crypto.createHash('sha256').update(options.masterKey).digest();
        }
      } else {
        this.masterKey = this.deriveKeyFromString(options.masterKey);
      }
    } else if (process.env.KIN_VAULT_KEY) {
      this.masterKey = this.deriveKeyFromString(process.env.KIN_VAULT_KEY);
    } else {
      this.masterKey = this.loadOrGenerateKeyFile(this.keyFilePath);
    }
  }

  public static getInstance(options?: SecretVaultOptions): SecretVault {
    if (!SecretVault.instance) {
      SecretVault.instance = new SecretVault(options);
    }
    return SecretVault.instance;
  }

  public static resetInstance(): void {
    SecretVault.instance = null;
  }

  public getKeyFilePath(): string {
    return this.keyFilePath;
  }

  private deriveKeyFromString(rawKey: string): Buffer {
    const trimmed = rawKey.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    return crypto.createHash('sha256').update(trimmed, 'utf-8').digest();
  }

  private loadOrGenerateKeyFile(filePath: string): Buffer {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8').trim();
        if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
          return Buffer.from(raw, 'hex');
        }
        return this.deriveKeyFromString(raw);
      }

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const generated = crypto.randomBytes(32);
      try {
        fs.writeFileSync(filePath, generated.toString('hex'), { mode: 0o600 });
      } catch {
        fs.writeFileSync(filePath, generated.toString('hex'));
      }
      return generated;
    } catch {
      // Fallback in-memory master key if filesystem access is restricted
      return crypto.randomBytes(32);
    }
  }

  /**
   * Encrypts plaintext string using AES-256-GCM.
   * Returns a versioned vault token: vault:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
   */
  public encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
      throw new Error('Plaintext must be a string');
    }

    if (this.isEncrypted(plaintext)) {
      return plaintext; // Already encrypted
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return `vault:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts a vault ciphertext token.
   * If the input is not encrypted with the vault prefix, transparently returns it unchanged.
   */
  public decrypt(ciphertext: string): string {
    if (!ciphertext || typeof ciphertext !== 'string') {
      return '';
    }

    if (!this.isEncrypted(ciphertext)) {
      return ciphertext; // Transparent backward-compatibility for plaintext credentials
    }

    const parts = ciphertext.split(':');
    if (parts.length !== 5 || parts[0] !== 'vault' || parts[1] !== 'v1') {
      throw new Error('Invalid vault token format');
    }

    const ivHex = parts[2];
    const tagHex = parts[3];
    const cipherHex = parts[4];

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const encryptedText = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedText),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  }

  /**
   * Checks whether a given string is a valid vault ciphertext token.
   */
  public isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith('vault:v1:');
  }
}
