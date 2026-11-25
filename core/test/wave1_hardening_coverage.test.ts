import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { MemoryRepository } from '../src/domain/memory_repository.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { Sentinel } from '../src/security/sentinel.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { isPathWithinRoot } from '../src/security/path_jail.js';
import { CoreServer } from '../src/server/core_server.js';

function httpRequest(
  port: number,
  method: string,
  urlPath: string,
  body?: Buffer,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Wave 1 Hardening & Audit Remediation Verification', () => {
  let tmpDir: string;
  let db: KinDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-wave1-hardening-'));
    db = new KinDatabase({ dbPath: path.join(tmpDir, 'test.sqlite') });
    new MigrationRunner(db).runMigrations();
  });

  afterEach(() => {
    try { db.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('MemoryRepository: hybridSearch fuses FTS5 BM25 + Float32 cosine (including unaligned buffers) & respects bi-temporal validity', () => {
    const memRepo = new MemoryRepository(db);
    const now = Date.now();

    // Active memory with embedding
    memRepo.setMemory({
      scope: 'project',
      scopeId: 'proj-kin',
      type: 'semantic',
      key: 'auth-architecture',
      value: { note: 'Use bearer token headers instead of cookies on localhost' },
      embedding: [1, 0, 0, 0],
      importance: 0.9,
      validFrom: now - 10000,
      validTo: now + 100000,
    });

    // Future memory (validFrom in the future) should be filtered out
    memRepo.setMemory({
      scope: 'project',
      scopeId: 'proj-kin',
      type: 'semantic',
      key: 'future-migration',
      value: { note: 'bearer token rotation schedule next year' },
      validFrom: now + 500000,
    });

    // Soft-invalidated memory must not appear in getMemory or hybridSearch
    memRepo.setMemory({
      scope: 'project',
      scopeId: 'proj-kin',
      type: 'semantic',
      key: 'deprecated-cookie-rule',
      value: { note: 'old bearer cookie fallback' },
    });
    expect(memRepo.invalidateMemory('project', 'proj-kin', 'deprecated-cookie-rule')).toBe(true);
    expect(memRepo.getMemory('project', 'proj-kin', 'deprecated-cookie-rule')).toBeUndefined();

    // Force an unaligned Buffer slice into DB embedding column to verify Float32Array alignment guard
    const rawVec = Buffer.alloc(17);
    new Float32Array([0.9, 0.1, 0, 0]).forEach((v, idx) => rawVec.writeFloatLE(v, 1 + idx * 4));
    const unalignedSlice = rawVec.subarray(1, 17);
    expect(unalignedSlice.byteOffset % 4).not.toBe(0);
    db.execute(`UPDATE memories SET embedding = ? WHERE key = 'auth-architecture'`, unalignedSlice);

    const results = memRepo.hybridSearch({
      query: 'bearer token',
      scope: 'project',
      scopeId: 'proj-kin',
      queryEmbedding: [1, 0, 0, 0],
      limit: 5,
    });
    expect(results.length).toBe(1);
    expect(results[0].memory.key).toBe('auth-architecture');
    expect(results[0].vectorScore).toBeGreaterThan(0.9);
  });

  it('TaskRepository: enforces monotonic fence_token on renewTaskLease and completeTask', () => {
    const taskRepo = new TaskRepository(db);
    const now = Date.now();
    db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-1', 'WS', ?, 'AUTO', ?, ?)`, tmpDir, now, now);
    db.execute(`INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-1', 'ws-1', 'P1', ?, ?, ?)`, tmpDir, now, now);
    db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-1', 'Bot', 'Dev', 'help', 'ollama/qwen', ?)`, now);
    db.execute(`INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, created_at, updated_at) VALUES ('ag-1', 'ws-1', 'proj-1', 'def-1', '@Bot', 'ollama/qwen', ?, ?)`, now, now);
    taskRepo.createGoal({ id: 'goal-1', projectId: 'proj-1', title: 'G', description: 'D', status: 'active', createdAt: now, updatedAt: now });
    taskRepo.createTask({ id: 'task-1', goalId: 'goal-1', title: 'T', description: 'D', status: 'ready', retryCount: 0, createdAt: now, updatedAt: now });

    expect(taskRepo.claimTaskWithLease('task-1', 'ag-1', 'run-1', 60000)).toBe(true);
    const token1 = taskRepo.getFenceToken('task-1');
    expect(token1).toBe(1);

    // Stale fence token must fail renewal
    expect(taskRepo.renewTaskLease('task-1', 'run-1', 60000, token1 - 1)).toBe(false);
    expect(taskRepo.renewTaskLease('task-1', 'run-1', 60000, token1)).toBe(true);

    // Seed verified analysis_summary evidence
    db.execute(
      `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, created_at)
       VALUES ('ev-1', 'task-1', 'run-1', 'analysis_summary', 'memo://analysis/run/run-1?sha256=abc', 1, ?)`,
      now
    );

    // Stale fence token must fail task completion; current fence token succeeds and increments fence_token
    expect(() => taskRepo.completeTask('task-1', 'ev-1', 'run-1', token1 - 1)).toThrow(/Fence check failed/i);
    taskRepo.completeTask('task-1', 'ev-1', 'run-1', token1);
    expect(taskRepo.getFenceToken('task-1')).toBe(token1 + 1);
  });

  it('ToolGateway & Sentinel: maps Wave 1 capabilities, enforces path jail on editFile/grep/glob, rejects ReDoS, & replays stepKey', async () => {
    const sentinel = Sentinel.getInstance();
    expect(sentinel.getRequiredCapability('editFile').primary).toBe('fs:write');
    expect(sentinel.getRequiredCapability('grep').primary).toBe('fs:read');
    expect(sentinel.getRequiredCapability('glob').primary).toBe('fs:read');
    expect(sentinel.getRequiredCapability('execute_command').primary).toBe('shell:exec');
    expect(sentinel.isDestructiveAction('execute_command', { command: 'rm -rf /tmp/x' }).isDestructive).toBe(true);

    const workDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(workDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'src', 'hello.ts'), 'export const x = 1;\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'outside.txt'), 'SECRET_OUTSIDE', 'utf-8');

    const nowTs = Date.now();
    db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-gw', 'WS', ?, 'AUTO', ?, ?)`, workDir, nowTs, nowTs);
    db.execute(`INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-kin', 'ws-gw', 'KIN', ?, ?, ?)`, workDir, nowTs, nowTs);

    const gateway = new ToolGateway({ db });
    const ctx = {
      runId: 'run-gw-1',
      agentId: 'ag-specialist',
      projectId: 'proj-kin',
      worktreeRoot: workDir,
      autonomyMode: 'AUTO' as const,
      allowedCapabilities: ['fs:read', 'fs:write'],
    };

    // Compact toolset bounded <= 22 base tools
    expect(gateway.getCompactToolSchemas().length).toBeLessThanOrEqual(22);

    // Path jail rejects escaping worktreeRoot
    const escapeEdit = await gateway.executeTool('editFile', { filePath: '../outside.txt', target: 'SECRET', replacement: 'OWNED' }, ctx);
    expect(escapeEdit.success).toBe(false);
    expect(escapeEdit.error).toMatch(/SECURITY JAIL/i);

    // Valid editFile updates content + records step_key idempotency
    const okEdit = await gateway.executeTool(
      'editFile',
      { filePath: 'src/hello.ts', target: 'x = 1', replacement: 'x = 42' },
      { ...ctx, stepKey: 'step-edit-1' }
    );
    expect(okEdit.success).toBe(true);
    expect(fs.readFileSync(path.join(workDir, 'src', 'hello.ts'), 'utf-8')).toContain('x = 42');

    // Replaying same stepKey returns cached success even if target would no longer match
    const replayEdit = await gateway.executeTool(
      'editFile',
      { filePath: 'src/hello.ts', target: 'x = 1', replacement: 'x = 999' },
      { ...ctx, stepKey: 'step-edit-1' }
    );
    expect(replayEdit.success).toBe(true);
    expect(fs.readFileSync(path.join(workDir, 'src', 'hello.ts'), 'utf-8')).toContain('x = 42');

    // grep rejects catastrophic regex & skips escapes
    const badRegex = await gateway.executeTool('grep', { pattern: '(a+)+b', isRegex: true }, ctx);
    expect(badRegex.success).toBe(false);
    expect(badRegex.error).toMatch(/catastrophic/i);

    const globRes = await gateway.executeTool<any>('glob', { pattern: '**/*.ts' }, ctx);
    expect(globRes.success).toBe(true);
    expect(globRes.output.files).toContain('src/hello.ts');

    // isPathWithinRoot blocks traversal outside root
    expect(isPathWithinRoot(path.join(workDir, 'src', 'hello.ts'), workDir)).toBe(true);
    expect(isPathWithinRoot(path.join(tmpDir, 'outside.txt'), workDir)).toBe(false);
  });

  it('System Backup & Restore: streams VACUUM INTO backup, rejects invalid/foreign restore, & swaps .pending_restore on restart', async () => {
    const dbPath = path.join(tmpDir, 'live.sqlite');
    const server = new CoreServer({ dbPath, port: 0, requireIpcAuth: false });
    const port = await server.start();
    try {
      // Seed marker row
      server.getDatabase().execute(
        `INSERT INTO memories (id, scope, scope_id, type, key, value_json, version, created_at, updated_at)
         VALUES ('mem-bkp-1', 'project', 'proj-kin', 'semantic', 'backup-marker', '"before_restore"', 1, ?, ?)`,
        Date.now(),
        Date.now()
      );

      // 1. Download consistent VACUUM INTO backup
      const bkpRes = await httpRequest(port, 'GET', '/api/system/backup');
      expect(bkpRes.status).toBe(200);
      expect(bkpRes.body.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\0');

      // Mutate database after backup
      server.getDatabase().execute(
        `UPDATE memories SET value_json = '"after_mutation"' WHERE id = 'mem-bkp-1'`
      );

      // 2. Reject missing CSRF intent header and invalid header
      const noHdr = await httpRequest(port, 'POST', '/api/system/restore', bkpRes.body);
      expect(noHdr.status).toBe(403);

      const badSqlite = await httpRequest(port, 'POST', '/api/system/restore', Buffer.from('NOT_SQLITE_BYTES'.repeat(10)), {
        'x-kin-restore': '1',
      });
      expect(badSqlite.status).toBe(400);

      // 3. Stage verified backup
      const restoreRes = await httpRequest(port, 'POST', '/api/system/restore', bkpRes.body, {
        'x-kin-restore': '1',
        'Content-Type': 'application/octet-stream',
      });
      expect(restoreRes.status).toBe(200);
      expect(fs.existsSync(`${dbPath}.pending_restore`)).toBe(true);
    } finally {
      await server.stop();
    }

    // 4. Simulate restart: opening KinDatabase swaps .pending_restore cleanly
    const reopened = new KinDatabase({ dbPath });
    try {
      const row = reopened.queryOne<{ value_json: string }>(`SELECT value_json FROM memories WHERE id = 'mem-bkp-1'`);
      expect(row?.value_json).toBe('"before_restore"');
      expect(fs.existsSync(`${dbPath}.pending_restore`)).toBe(false);
    } finally {
      reopened.close();
    }
  });

  it('Schema v2 Operational Tables: exception_queue API, artifacts registry, and wakeup_outbox sweeper', async () => {
    const dbPath = path.join(tmpDir, 'ops.sqlite');
    const server = new CoreServer({ dbPath, port: 0, requireIpcAuth: false });
    const port = await server.start();
    try {
      const liveDb = server.getDatabase();
      const now = Date.now();

      // Seed exception & overdue wakeup_outbox row with >= 5 failed attempts
      liveDb.execute(
        `INSERT INTO exception_queue (id, project_id, category, severity, title, details_json, status, created_at)
         VALUES ('exc-test-1', 'proj-kin', 'run_failed', 'HIGH', 'Test exception', '{}', 'open', ?)`,
        now
      );
      liveDb.execute(
        `INSERT INTO wakeup_outbox (id, target_type, target_id, payload_json, status, attempts, next_retry_at, created_at)
         VALUES ('wkp-dead-1', 'board_wait', 'agent-boss', '{}', 'pending', 5, ?, ?)`,
        now - 1000,
        now - 10000
      );

      // Run supervisor self-healing sweep: should mark >=5-attempt outbox row as failed and enqueue exception
      server.runSupervisorSelfHealing(300000, true);
      const outboxRow = liveDb.queryOne<{ status: string }>(`SELECT status FROM wakeup_outbox WHERE id = 'wkp-dead-1'`);
      expect(outboxRow?.status).toBe('failed');

      const excList = await httpRequest(port, 'GET', '/api/exceptions?projectId=proj-kin');
      expect(excList.status).toBe(200);
      const parsedExc = JSON.parse(excList.body.toString('utf-8'));
      expect(parsedExc.exceptions.some((e: any) => e.id === 'exc-test-1')).toBe(true);
      expect(parsedExc.exceptions.some((e: any) => e.category === 'wakeup_failed')).toBe(true);

      const resolveRes = await httpRequest(port, 'POST', '/api/exceptions/exc-test-1/resolve', Buffer.from(JSON.stringify({ status: 'resolved' })), {
        'Content-Type': 'application/json',
      });
      expect(resolveRes.status).toBe(200);

      // Seed an artifact via SQLite artifacts endpoint
      liveDb.execute(
        `INSERT INTO artifacts (id, project_id, kind, uri, sha256, metadata_json, created_at)
         VALUES ('art-test-1', 'proj-kin', 'file_write', 'file:///test.ts', 'deadbeef', '{}', ?)`,
        now
      );
      const artList = await httpRequest(port, 'GET', '/api/artifacts?projectId=proj-kin');
      expect(artList.status).toBe(200);
      expect(JSON.parse(artList.body.toString('utf-8')).artifacts.some((a: any) => a.id === 'art-test-1')).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
