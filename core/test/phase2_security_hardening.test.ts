import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { Sentinel } from '../src/security/sentinel.js';

describe('Phase 2 Security Hardening: EventLedger & SecretVault Modernization', () => {
  let db: KinDatabase;
  let tempDir: string;

  beforeEach(() => {
    db = new KinDatabase(':memory:');
    new MigrationRunner(db).runMigrations();
    EventLedger.initialize(db);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-vault-phase2-'));
  });

  afterEach(() => {
    db.close();
    SecretVault.resetInstance();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('EventLedger Hash Chain Accumulator', () => {
    it('maintains unbroken hash chain integrity across sequential records', () => {
      const ledger = EventLedger.getInstance();

      ledger.record({
        eventType: 'USER_REQUEST',
        entityType: 'run',
        entityId: 'run-1',
        payload: { text: 'Initial request' },
      });

      ledger.record({
        eventType: 'PLAN_CREATED',
        entityType: 'run',
        entityId: 'run-1',
        payload: { steps: 3 },
      });

      ledger.record({
        eventType: 'TOOL_STARTED',
        entityType: 'tool',
        entityId: 'readFile',
        payload: { path: 'package.json' },
      });

      const verification = ledger.verifyChainIntegrity();
      expect(verification.valid).toBe(true);
      expect(verification.verifiedCount).toBe(3);
    });
  });

  describe('SecretVault Two-Phase Key Promotion & Multi-Key Ring', () => {
    it('stages next candidate key and maintains decryption capability for existing secrets', () => {
      const keyFile = path.join(tempDir, 'vault.key');
      const vault = new SecretVault({ keyFilePath: keyFile });

      const secretText = 'sk-ant-test-secret-api-key-12345';
      const token = vault.encrypt(secretText);
      expect(token.startsWith('vault:v1:')).toBe(true);
      expect(vault.decrypt(token)).toBe(secretText);

      // Stage a new key
      const stagedHex = vault.stageNextKey();
      expect(stagedHex).toHaveLength(64);
      expect(fs.existsSync(keyFile + '.next')).toBe(true);

      // Original token is still decryptable using candidate key ring
      expect(vault.decrypt(token)).toBe(secretText);

      // Promote the staged key
      const promoted = vault.promoteStagedKey();
      expect(promoted).toBe(true);
      expect(fs.existsSync(keyFile)).toBe(true);
      expect(fs.existsSync(keyFile + '.next')).toBe(false);

      // New key is in place, and old token is STILL decryptable via retired key in ring
      expect(vault.decrypt(token)).toBe(secretText);

      // Encrypt new token with the newly promoted master key
      const token2 = vault.encrypt('second-secret-content');
      expect(vault.decrypt(token2)).toBe('second-secret-content');
      expect(vault.decrypt(token)).toBe(secretText);
    });
  });

  describe('Sentinel Fast-Path Screening', () => {
    it('fast-paths safe commands without regex penalty', () => {
      const sentinel = Sentinel.getInstance();
      const safe = sentinel.isDestructiveAction('executeShell', { command: 'git status' });
      expect(safe.isDestructive).toBe(false);

      const safeDiff = sentinel.isDestructiveAction('executeShell', { command: 'git diff HEAD' });
      expect(safeDiff.isDestructive).toBe(false);

      const safeEcho = sentinel.isDestructiveAction('executeShell', { command: 'echo "hello world"' });
      expect(safeEcho.isDestructive).toBe(false);
    });

    it('still catches destructive chained commands starting with safe prefix', () => {
      const sentinel = Sentinel.getInstance();
      const chained = sentinel.isDestructiveAction('executeShell', { command: 'echo safe && rm -rf /' });
      expect(chained.isDestructive).toBe(true);
    });
  });
});
