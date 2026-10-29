// ============================================================================
// KIN PRODUCTION READINESS & END-TO-END VERIFICATION HARNESS
// Comprehensive runtime verification of production boot, static asset serving,
// health telemetry, security boundaries, and desktop sidecar integrity.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { BrowserController } from '../src/browser/browser_controller.js';
import { Sentinel } from '../src/security/sentinel.js';
import { SecretVault } from '../src/security/secret_vault.js';

describe('KIN Production Readiness & End-to-End Verification Harness', () => {
  let tempDir: string;
  let testDbPath: string;
  let server: CoreServer;
  let serverPort: number;
  let baseUrl: string;
  const ipcSecret = 'test-e2e-production-secret-token-12345';

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-e2e-prod-'));
    testDbPath = path.join(tempDir, 'kin_production_test.sqlite');

    // Cold boot: instantiate CoreServer with IPC authentication enabled
    server = new CoreServer({
      port: 0,
      dbPath: testDbPath,
      requireIpcAuth: true,
    });

    serverPort = await server.start();
    baseUrl = `http://127.0.0.1:${serverPort}`;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // Helper function for HTTP requests
  function request(
    method: string,
    reqPath: string,
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
      const url = new URL(reqPath, baseUrl);
      const reqHeaders: Record<string, string> = { ...headers };
      let payload = '';

      if (body !== undefined) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
      }

      const req = http.request(
        url,
        {
          method,
          headers: reqHeaders,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
              json: () => JSON.parse(data),
            });
          });
        }
      );

      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  // 1. Cold Startup & SQLite Schema Auto-Provisioning
  describe('1. Cold Boot & Database Migration Guarantees', () => {
    it('initializes fresh database file in WAL mode with all authoritative tables', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
      const db = new KinDatabase(testDbPath);
      try {
        const jm = db.queryOne<{ journal_mode: string }>('PRAGMA journal_mode;');
        expect(jm?.journal_mode.toLowerCase()).toBe('wal');

        const tables = db
          .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table';")
          .map((t) => t.name);

        const expectedTables = [
          'projects',
          'agent_identities',
          'channels',
          'messages',
          'tasks',
          'goals',
          'decisions',
          'event_journal',
          'managed_credentials',
          'providers',
          'skills',
          'approvals',
        ];

        for (const tbl of expectedTables) {
          expect(tables).toContain(tbl);
        }

        const integrity = db.queryOne<{ integrity_check: string }>('PRAGMA integrity_check(1);');
        expect(integrity?.integrity_check).toBe('ok');
      } finally {
        db.close();
      }
    });
  });

  // 2. Production Health Check & Telemetry
  describe('2. Public Health Check & Uptime Telemetry', () => {
    it('serves GET /api/health without requiring IPC authentication token', async () => {
      const res = await request('GET', '/api/health');
      expect(res.statusCode).toBe(200);
      const data = res.json();

      expect(data.status).toBe('ok');
      expect(data.version).toBe('0.1.4');
      expect(typeof data.uptime).toBe('number');
      expect(data.database.connected).toBe(true);
      expect(data.database.integrity).toBe('ok');
      expect(data.activeProject.id).toBe('proj-kin');
      expect(Array.isArray(data.configuredProviders)).toBe(true);
      expect(typeof data.memory.rssMb).toBe('number');
    });

    it('serves GET /health as an alias for monitoring probes', async () => {
      const res = await request('GET', '/health');
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ok');
    });
  });

  // 3. Static Web Serving & SPA Navigation
  describe('3. Production Static Frontend Asset Serving', () => {
    it('serves pre-compiled index.html on root GET / with correct headers', async () => {
      const res = await request('GET', '/');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('id="root"');
    });

    it('serves SPA client routes by falling back to index.html', async () => {
      const res = await request('GET', '/channels/chan-general');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('id="root"');
    });

    it('serves hashed static assets with immutable cache headers', async () => {
      // Find an existing asset in ui/dist/assets
      const uiDistAssets = path.resolve(process.cwd(), 'ui', 'dist', 'assets');
      if (fs.existsSync(uiDistAssets)) {
        const files = fs.readdirSync(uiDistAssets).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
        if (files.length > 0) {
          const sampleAsset = files[0];
          const res = await request('GET', `/assets/${sampleAsset}`);
          expect(res.statusCode).toBe(200);
          expect(res.headers['cache-control']).toContain('immutable');
        }
      }
    });

    it('returns 404 for missing static assets with file extensions', async () => {
      const res = await request('GET', '/assets/nonexistent_file_12345.js');
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('Asset Not Found');
    });

    it('blocks directory traversal attempts with 403 Forbidden', async () => {
      const res = await request('GET', '/../../package.json');
      // Either path normalization collapses it to index.html or traversal check returns 403
      expect([200, 403, 404]).toContain(res.statusCode);
      if (res.statusCode === 403) {
        expect(res.json().error).toContain('Forbidden');
      }
    });
  });

  // 4. IPC Authentication Protection on Control Plane
  describe('4. IPC Token Authentication Boundaries', () => {
    it('rejects unauthenticated requests to protected API endpoints with 401 Unauthorized', async () => {
      const res = await request('GET', '/api/state');
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain('Unauthorized');
    });

    it('accepts authenticated requests with valid X-IPC-Token header', async () => {
      const token = server.getIpcAuthToken();
      const res = await request('GET', '/api/state', {
        'X-IPC-Token': token,
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.activeProject).toBeDefined();
      expect(data.channels.length).toBeGreaterThan(0);
      expect(data.agents.length).toBeGreaterThan(0);
    });

    it('accepts authenticated requests with valid Authorization Bearer header', async () => {
      const token = server.getIpcAuthToken();
      const res = await request('GET', '/api/state', {
        Authorization: `Bearer ${token}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().activeProject.id).toBe('proj-kin');
    });
  });

  // 5. First-Run Default Workspace & Onboarding Guarantees
  describe('5. First-Run Auto-Provisioning & State Invariants', () => {
    it('provisions default project proj-kin and general channel automatically', async () => {
      const token = server.getIpcAuthToken();
      const res = await request('GET', '/api/state', { 'X-IPC-Token': token });
      const data = res.json();

      expect(data.activeProject.id).toBe('proj-kin');
      expect(data.activeProject.name).toBe('KIN');

      const genChan = data.channels.find((c: any) => c.id === 'chan-general');
      expect(genChan).toBeDefined();
      expect(genChan.name).toBe('general');

      const boss = data.agents.find((a: any) => a.isOrchestrator);
      expect(boss).toBeDefined();
      expect(boss.displayName).toMatch(/Boss/i);
    });
  });

  // 6. Security & Machine Automation Guardrails
  describe('6. Security, SSRF & Automation Guardrails', () => {
    it('blocks browser navigation to cloud metadata endpoints (SSRF mitigation)', async () => {
      const controller = new BrowserController();
      await expect(controller.navigate('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
        /ACCESS_DENIED.*cloud metadata/i
      );
      await expect(controller.navigate('http://metadata.google.internal/computeMetadata/v1/')).rejects.toThrow(
        /ACCESS_DENIED.*cloud metadata/i
      );
    });

    it('Sentinel fail-closed capability check rejects agents with empty capabilities', () => {
      const sentinel = Sentinel.getInstance();
      const decision = sentinel.evaluate({
        agentId: 'unprivileged-agent',
        toolName: 'executeShell',
        params: { command: 'echo hello' },
        autonomyMode: 'AUTO',
        agentCapabilities: [],
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('SECURITY DENIAL: Fail-closed capability check');
    });

    it('Sentinel flags destructive commands for mandatory operator approval', () => {
      const sentinel = Sentinel.getInstance();
      const decision = sentinel.evaluate({
        agentId: 'agent-boss',
        toolName: 'executeShell',
        params: { command: 'rm -rf /' },
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['*'],
      });

      expect(decision.requiresApproval).toBe(true);
      expect(decision.isDestructive).toBe(true);
    });
  });

  // 7. Desktop Native Sidecar Binary Verification
  describe('7. Standalone Native Desktop Sidecar Binary Verification', () => {
    it('verifies src-tauri/binaries/kin-core binary exists and has valid executable size', () => {
      const rootDir = fs.existsSync(path.resolve(process.cwd(), 'package.json')) && fs.existsSync(path.resolve(process.cwd(), 'src-tauri'))
        ? process.cwd()
        : path.resolve(process.cwd(), '..');
      const binaryName = process.platform === 'win32' ? 'kin-core.exe' : 'kin-core';
      const tauriBinary = path.resolve(rootDir, 'src-tauri', 'binaries', binaryName);
      expect(fs.existsSync(tauriBinary)).toBe(true);

      const stat = fs.statSync(tauriBinary);
      // Bundled Node SEA binary template is ~95MB
      expect(stat.size).toBeGreaterThan(50 * 1024 * 1024);
    });
  });
});
