// ============================================================================
// KIN SECRET VAULT
// AES-256-GCM credential encryption and zero-knowledge key storage.
// Encrypts managed credentials stored at rest in SQLite.
// ============================================================================

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDataDirectory } from '../storage/data_directory.js';

function restrictKeyFilePermissions(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
  if (process.platform === 'win32') {
    try {
      const user = process.env.USERNAME || process.env.USER;
      if (user) {
        execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${user}:F`], {
          stdio: 'ignore',
          timeout: 3000,
        });
      }
    } catch {}
  }
}

export interface SecretVaultOptions {
  masterKey?: string | Buffer;
  keyFilePath?: string;
}

export class SecretVault {
  private static instance: SecretVault | null = null;
  private masterKey: Buffer;
  private legacyMasterKey?: Buffer;
  private keyFilePath: string;
  private keyRing: Buffer[] = [];
  private passphraseRaw?: string;

  constructor(options?: SecretVaultOptions) {
    const cwd = process.cwd();
    const dataDir = getDataDirectory();
    const dataKeyPath = path.resolve(dataDir, 'vault.key');
    const homeDir = process.env.USERPROFILE || process.env.HOME || process.env.APPDATA || cwd;
    const homeKeyPath = path.resolve(homeDir, '.kin', 'vault.key');
    const localKeyPath = path.resolve(cwd, '.kin', 'vault.key');

    if (options?.keyFilePath) {
      this.keyFilePath = options.keyFilePath;
    } else if (process.env.KIN_DATA_DIR && process.env.KIN_DATA_DIR.trim().length > 0) {
      this.keyFilePath = dataKeyPath;
    } else if (fs.existsSync(homeKeyPath)) {
      this.keyFilePath = homeKeyPath;
    } else if (fs.existsSync(dataKeyPath)) {
      this.keyFilePath = dataKeyPath;
    } else if (fs.existsSync(localKeyPath)) {
      this.keyFilePath = localKeyPath;
    } else {
      this.keyFilePath = dataKeyPath;
    }

    if (options?.masterKey) {
      if (Buffer.isBuffer(options.masterKey)) {
        if (options.masterKey.length === 32) {
          this.masterKey = options.masterKey;
        } else {
          this.legacyMasterKey = crypto.createHash('sha256').update(options.masterKey).digest();
          this.masterKey = crypto.scryptSync(options.masterKey, 'kin-vault-salt-v1', 32, { N: 16384, r: 8, p: 1 });
        }
      } else {
        this.masterKey = this.deriveKeyFromString(options.masterKey);
      }
    } else if (process.env.KIN_VAULT_KEY) {
      this.masterKey = this.deriveKeyFromString(process.env.KIN_VAULT_KEY);
    } else {
      this.masterKey = this.loadOrGenerateKeyFile(this.keyFilePath);
    }

    const nextKeyPath = this.keyFilePath + '.next';
    if (fs.existsSync(nextKeyPath)) {
      try {
        const rawNext = fs.readFileSync(nextKeyPath, 'utf-8').trim();
        if (rawNext.length === 64 && /^[0-9a-fA-F]+$/.test(rawNext)) {
          this.keyRing.push(Buffer.from(rawNext, 'hex'));
        }
      } catch (err) {
        console.debug("[secret_vault] Suppressed exception loading next key:", err);
      }
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

  public getMasterKey(): Buffer {
    return this.masterKey;
  }

  private deriveKeyFromString(rawKey: string): Buffer {
    const trimmed = rawKey.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    this.passphraseRaw = trimmed;
    this.legacyMasterKey = crypto.createHash('sha256').update(trimmed, 'utf-8').digest();
    return crypto.scryptSync(trimmed, 'kin-vault-salt-v1', 32, { N: 16384, r: 8, p: 1 });
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
      restrictKeyFilePermissions(filePath);
      return generated;
    } catch (err: any) {
      throw new Error(`Failed to persist or load vault key at '${filePath}': ${err?.message || String(err)}`);
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

    if (this.passphraseRaw) {
      const salt = crypto.randomBytes(16);
      const derivedKey = crypto.scryptSync(this.passphraseRaw, salt, 32, { N: 16384, r: 8, p: 1 });
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return `vault:v2:${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
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
    if (parts[0] === 'vault' && parts[1] === 'v2' && parts.length === 6) {
      const salt = Buffer.from(parts[2], 'hex');
      const iv = Buffer.from(parts[3], 'hex');
      const authTag = Buffer.from(parts[4], 'hex');
      const encryptedText = Buffer.from(parts[5], 'hex');
      if (!this.passphraseRaw) {
        throw new Error('vault:v2 token requires a string passphrase master key');
      }
      const derivedKey = crypto.scryptSync(this.passphraseRaw, salt, 32, { N: 16384, r: 8, p: 1 });
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encryptedText), decipher.final()]).toString('utf-8');
    }

    if (parts.length !== 5 || parts[0] !== 'vault' || parts[1] !== 'v1') {
      throw new Error('Invalid vault token format');
    }

    const ivHex = parts[2];
    const tagHex = parts[3];
    const cipherHex = parts[4];

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const encryptedText = Buffer.from(cipherHex, 'hex');

    const tryDecrypt = (key: Buffer): string => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(encryptedText),
        decipher.final(),
      ]);
      return decrypted.toString('utf-8');
    };

    try {
      return tryDecrypt(this.masterKey);
    } catch (err) {
      for (const candidate of this.keyRing) {
        try {
          return tryDecrypt(candidate);
        } catch { /* continue candidate check */ }
      }
      if (this.legacyMasterKey) {
        try {
          return tryDecrypt(this.legacyMasterKey);
        } catch (err) { console.debug("[secret_vault] Suppressed exception in catch block:", err); }
      }
      throw err;
    }
  }

  /**
   * Checks whether a given string is a valid vault ciphertext token.
   */
  public isEncrypted(value: string): boolean {
    return typeof value === 'string' && (value.startsWith('vault:v1:') || value.startsWith('vault:v2:'));
  }

  public stageNextKey(newKey?: Buffer): string {
    const nextKeyPath = this.keyFilePath + '.next';
    const keyBuf = newKey || crypto.randomBytes(32);
    const hex = keyBuf.toString('hex');
    const dir = path.dirname(nextKeyPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(nextKeyPath, hex, { mode: 0o600 });
    } catch {
      fs.writeFileSync(nextKeyPath, hex);
    }
    restrictKeyFilePermissions(nextKeyPath);
    this.keyRing.unshift(keyBuf);
    return hex;
  }

  public promoteStagedKey(): boolean {
    const nextKeyPath = this.keyFilePath + '.next';
    if (!fs.existsSync(nextKeyPath)) return false;
    const rawNext = fs.readFileSync(nextKeyPath, 'utf-8').trim();
    if (rawNext.length === 64 && /^[0-9a-fA-F]+$/.test(rawNext)) {
      const newKey = Buffer.from(rawNext, 'hex');
      this.keyRing.unshift(this.masterKey);
      this.masterKey = newKey;
      this.passphraseRaw = undefined;
      try {
        fs.renameSync(nextKeyPath, this.keyFilePath);
      } catch {
        fs.copyFileSync(nextKeyPath, this.keyFilePath);
        fs.unlinkSync(nextKeyPath);
      }
      restrictKeyFilePermissions(this.keyFilePath);
      return true;
    }
    return false;
  }
}
