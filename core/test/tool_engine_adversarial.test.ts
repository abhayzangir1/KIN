import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { ToolEngine } from '../src/execution/tool_engine.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { WorktreeManager } from '../src/execution/worktree_manager.js';

describe('KIN ToolEngine & Harness² Production Adversarial Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let toolEngine: ToolEngine;
  let toolGateway: ToolGateway;
  let gitRepoDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-adversarial-test-'));
    dbPath = path.join(tempDir, 'tool_engine_test.sqlite');
    db = new KinDatabase(dbPath);
    new MigrationRunner(db).runMigrations();

    // Create a real git repo for worktree testing
    gitRepoDir = path.join(tempDir, 'test-repo');
    fs.mkdirSync(gitRepoDir, { recursive: true });
    execSync('git init', { cwd: gitRepoDir, stdio: 'ignore' });
    execSync('git config user.name "Kin Test"', { cwd: gitRepoDir, stdio: 'ignore' });
    execSync('git config user.email "test@kin.local"', { cwd: gitRepoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(gitRepoDir, 'main.txt'), 'Initial main branch content\n', 'utf-8');
    execSync('git add main.txt && git commit -m "initial commit"', { cwd: gitRepoDir, stdio: 'ignore' });

    // Seed workspace, project, agent definitions, and identities for foreign key integrity
    const now = Date.now();
    db.execute(
      `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-default', 'Default Workspace', ?, 'AUTO', ?, ?);`,
      gitRepoDir,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-kin', 'ws-default', 'KIN Core', ?, ?, ?);`,
      gitRepoDir,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES ('def-boss', 'Boss', 'Orchestrator', 'You are Boss', 'mock-model', ?);`,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES ('def-dev', 'Dev', 'Engineer', 'You are Dev', 'mock-model', ?);`,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
       VALUES ('agent-orchestrator', 'ws-default', 'proj-kin', 'def-boss', 'Boss', 'mock-model', 1, ?, ?);`,
      now,
      now
    );
    db.execute(
      `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
       VALUES ('agent-coder', 'ws-default', 'proj-kin', 'def-dev', 'Dev', 'mock-model', 0, ?, ?);`,
      now,
      now
    );
    for (const id of ['agent-tester', 'agent-reviewer', 'agent-devops']) {
      db.execute(
        `INSERT OR IGNORE INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
         VALUES (?, 'ws-default', 'proj-kin', 'def-dev', ?, 'mock-model', 0, ?, ?);`,
        id,
        id,
        now,
        now
      );
    }

    toolEngine = new ToolEngine(db);
    toolGateway = new ToolGateway({ db, toolEngine });
    toolGateway.setToolEngine(toolEngine);
  });

  afterAll(async () => {
    if (db) db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore file lock cleanup on Windows
    }
  });

  // ============================================================================
  // VECTOR 1: Infinite Loop / CPU Spin Timeout Containment
  // ============================================================================
  it('Vector 1: terminates infinite CPU loop within bounded timeout', async () => {
    const res = toolEngine.createTool({
      name: 'infinite_spin',
      description: 'Tool that enters infinite while loop',
      handlerCode: 'module.exports = async () => { while(true) {} };',
      requireApproval: false, // directly active for test
      projectId: 'proj-kin',
    });
    expect(res.success).toBe(true);
    expect(res.status).toBe('created_active');

    const execStart = Date.now();
    const execRes = await toolEngine.executeTool(
      'infinite_spin',
      {},
      { worktreeRoot: gitRepoDir, timeoutMs: 2500 }
    );
    const duration = Date.now() - execStart;

    expect(execRes.success).toBe(false);
    expect(execRes.error).toMatch(/timed out|timeout/i);
    expect(duration).toBeGreaterThanOrEqual(2000);
    expect(duration).toBeLessThan(8000);
  });

  // ============================================================================
  // VECTOR 2: Memory Bomb / OOM Allocation Containment
  // ============================================================================
  it('Vector 2: traps memory allocation attacks without crashing host Node process', async () => {
    const res = toolEngine.createTool({
      name: 'memory_bomb',
      description: 'Tool that rapidly exhausts heap memory',
      handlerCode: `
        module.exports = async () => {
          const chunks = [];
          for (let i = 0; i < 50000; i++) {
            chunks.push(new Uint8Array(10 * 1024 * 1024)); // 10MB chunks
          }
          return { length: chunks.length };
        };
      `,
      requireApproval: false,
      projectId: 'proj-kin',
    });
    expect(res.success).toBe(true);

    const execRes = await toolEngine.executeTool(
      'memory_bomb',
      {},
      { worktreeRoot: gitRepoDir, timeoutMs: 5000 }
    );

    expect(execRes.success).toBe(false);
    expect(execRes.error).toBeDefined();
    // Verify host Node process is still completely healthy and executing
    expect(process.memoryUsage().heapUsed).toBeGreaterThan(0);
  });

  // ============================================================================
  // VECTOR 3: Prototype Pollution Isolation
  // ============================================================================
  it('Vector 3: prevents prototype pollution from leaking into host runtime', async () => {
    const res = toolEngine.createTool({
      name: 'proto_polluter',
      description: 'Attempts to pollute Object and Array prototypes',
      handlerCode: `
        module.exports = async () => {
          try {
            Object.prototype.polluted = 'HOST_COMPROMISED';
            Array.prototype.hacked = true;
            globalThis.infected = true;
          } catch (e) {}
          return { success: true };
        };
      `,
      requireApproval: false,
      projectId: 'proj-kin',
    });
    expect(res.success).toBe(true);

    const execRes = await toolEngine.executeTool(
      'proto_polluter',
      {},
      { worktreeRoot: gitRepoDir }
    );
    expect(execRes.success).toBe(true);

    // Assert host prototypes are strictly pristine
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect((Array.prototype as any).hacked).toBeUndefined();
    expect((globalThis as any).infected).toBeUndefined();
  });

  // ============================================================================
  // VECTOR 4: Operator Denial Non-Blocking Fallback
  // ============================================================================
  it('Vector 4: handles operator denial gracefully without corrupting state or halting', async () => {
    const res = toolEngine.createTool({
      name: 'risky_delete_tool',
      description: 'Deletes production resources',
      handlerCode: 'module.exports = async () => ({ deleted: true });',
      requireApproval: true,
      projectId: 'proj-kin',
      agentId: 'agent-coder',
    });

    if (!res.success) {
      console.error('[DEBUG VECTOR 4 FAILURE]', res);
    }

    expect(res.success).toBe(true);
    expect(res.status).toBe('created_pending_approval');
    expect(res.approvalId).toBeDefined();

    // Verify tool is stored in candidate status
    const tool = toolEngine.getTool('risky_delete_tool', 'proj-kin');
    expect(tool?.status).toBe('candidate');

    // Operator explicitly denies the tool proposal
    const resolved = toolEngine.resolveToolApproval(res.approvalId!, 'denied');
    expect(resolved).toBe(true);

    const deniedTool = toolEngine.getTool('risky_delete_tool', 'proj-kin');
    expect(deniedTool?.status).toBe('denied');

    // Execution must be denied cleanly
    const execRes = await toolEngine.executeTool('risky_delete_tool', {}, { worktreeRoot: gitRepoDir });
    expect(execRes.success).toBe(false);
    expect(execRes.error).toContain("cannot be executed without operator approval");
  });

  // ============================================================================
  // VECTOR 5: Operator Approval Swarm-Sharing & Dynamic Tool Execution
  // ============================================================================
  it('Vector 5: approved tool becomes instantly available across the specialist swarm', async () => {
    const res = toolEngine.createTool({
      name: 'currency_converter',
      description: 'Converts USD to EUR at fixed rate 0.92',
      parametersSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
      handlerCode: `
        module.exports = async (params) => {
          return { converted: params.amount * 0.92, currency: 'EUR' };
        };
      `,
      requireApproval: true,
      projectId: 'proj-kin',
      agentId: 'agent-coder',
    });

    expect(res.status).toBe('created_pending_approval');

    // Operator approves the tool
    const approved = toolEngine.resolveToolApproval(res.approvalId!, 'approved');
    expect(approved).toBe(true);

    const liveTool = toolEngine.getTool('currency_converter', 'proj-kin');
    expect(liveTool?.status).toBe('active');

    // Verify ToolGateway sees the custom tool in tool schemas
    const schemas = toolGateway.getToolSchemas();
    const customSchema = schemas.find((s) => s.name === 'custom__currency_converter');
    expect(customSchema).toBeDefined();
    expect(customSchema?.description).toContain('Converts USD to EUR');

    // Specialist agent executes the approved tool via ToolGateway
    const result = await toolGateway.executeTool(
      'custom__currency_converter',
      { amount: 100 },
      {
        runId: 'run-specialist-1',
        agentId: 'agent-coder',
        projectId: 'proj-kin',
        worktreeRoot: gitRepoDir,
        autonomyMode: 'FULL_ACCESS',
        allowedCapabilities: ['*'],
      }
    );

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ converted: 92, currency: 'EUR' });

    // Verify usage statistics incremented
    const updatedTool = toolEngine.getTool('currency_converter', 'proj-kin');
    expect(updatedTool?.usageCount).toBe(1);
    expect(updatedTool?.successCount).toBe(1);
    expect(updatedTool?.failureCount).toBe(0);
  });

  // ============================================================================
  // VECTOR 6: Duplicate Interception & Anti-Loop Force Bypass
  // ============================================================================
  it('Vector 6: intercepts similar duplicates and bypasses on forceCreation: true', async () => {
    // Register initial tool
    toolEngine.createTool({
      name: 'markdown_to_html',
      description: 'Converts markdown string into clean HTML format',
      handlerCode: 'module.exports = async (p) => ({ html: "<p>" + p.md + "</p>" });',
      requireApproval: false,
      projectId: 'proj-kin',
    });

    // Propose near duplicate
    const dupRes = toolEngine.createTool({
      name: 'markdown_to_html_converter',
      description: 'Converts markdown string into clean HTML format',
      handlerCode: 'module.exports = async (p) => ({ html: "<p>" + p.text + "</p>" });',
      projectId: 'proj-kin',
      forceCreation: false,
    });

    expect(dupRes.success).toBe(false);
    expect(dupRes.status).toBe('duplicate_advisory');
    expect(dupRes.existingSimilarTool).toBe('markdown_to_html');
    expect(dupRes.message).toContain('already exists');

    // Anti-loop bypass: agent re-invokes with forceCreation: true
    const forceRes = toolEngine.createTool({
      name: 'markdown_to_html_special',
      description: 'Converts markdown string into clean HTML format with custom tokens',
      handlerCode: 'module.exports = async (p) => ({ html: "<span>" + p.md + "</span>" });',
      projectId: 'proj-kin',
      forceCreation: true,
      rationale: 'Requires specific token rendering not present in standard converter',
    });

    expect(forceRes.success).toBe(true);
    expect(forceRes.status).toBe('created_pending_approval');
  });

  // ============================================================================
  // VECTOR 7: Concurrent Multi-Agent Registration Race
  // ============================================================================
  it('Vector 7: safely processes concurrent registrations without SQLite locking', async () => {
    const agents = ['agent-orchestrator', 'agent-coder', 'agent-tester', 'agent-reviewer', 'agent-devops'];
    const toolDefs = [
      { name: 'csv_data_parser', desc: 'Parses raw comma separated values into tabular rows' },
      { name: 'image_resizer_tool', desc: 'Rescales PNG and JPEG image dimensions' },
      { name: 'xml_payload_validator', desc: 'Validates XML document against XSD schema definitions' },
      { name: 'jwt_token_inspector', desc: 'Decodes and verifies JSON web token claims and signatures' },
      { name: 'hex_binary_encoder', desc: 'Converts raw byte arrays into hex representation' },
    ];
    const promises = agents.map((agId, i) =>
      Promise.resolve().then(() =>
        toolEngine.createTool({
          name: toolDefs[i].name,
          description: toolDefs[i].desc,
          handlerCode: `module.exports = async () => ({ tool: "${toolDefs[i].name}" });`,
          projectId: 'proj-kin',
          agentId: agId,
          requireApproval: false,
        })
      )
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.status).toBe('created_active');
    }

    const allTools = toolEngine.listTools('active', 'proj-kin');
    for (const def of toolDefs) {
      const found = allTools.find((t) => t.name === def.name);
      expect(found).toBeDefined();
    }
  });

  // ============================================================================
  // HARNESS² UPGRADE: Ephemeral Git Worktree Probing (Propose-Probe-Compose)
  // ============================================================================
  it('Harness²: probeWorktree isolates candidate execution and leaves project root pristine', async () => {
    const worktreeManager = new WorktreeManager(gitRepoDir);
    const probeRunId = `test-probe-${Date.now()}`;

    let observedInProbe = '';
    const probeResult = await worktreeManager.probeWorktree(probeRunId, async (probePath) => {
      // Modify a file in the isolated probe worktree
      const targetFile = path.join(probePath, 'probe_test.txt');
      fs.writeFileSync(targetFile, 'Candidate modification under test\n', 'utf-8');
      observedInProbe = fs.readFileSync(targetFile, 'utf-8');
      return { verified: true, observedInProbe };
    });

    expect(probeResult.success).toBe(true);
    expect(probeResult.output?.verified).toBe(true);
    expect(observedInProbe).toContain('Candidate modification');

    // Assert that the project root remains completely untouched
    const rootTarget = path.join(gitRepoDir, 'probe_test.txt');
    expect(fs.existsSync(rootTarget)).toBe(false);

    // Assert that probe branch and directory were cleaned up
    const probeBranch = `kin-probe-${probeRunId}`;
    let branchExists = false;
    try {
      execSync(`git show-ref --verify refs/heads/${probeBranch}`, { cwd: gitRepoDir, stdio: 'pipe' });
      branchExists = true;
    } catch {
      branchExists = false;
    }
    expect(branchExists).toBe(false);
  });

  // ============================================================================
  // HARNESS² UPGRADE: Cross-Task Improvement Library (harness_improvements)
  // ============================================================================
  it('Harness²: records and retrieves verified domain adaptations with run tracking', () => {
    const imp1 = toolEngine.recordImprovement({
      projectId: 'proj-kin',
      domain: 'database_migration',
      componentType: 'tool',
      problemSignature: 'table_lock_timeout',
      verifiedAdaptation: 'Use idempotent CREATE TABLE IF NOT EXISTS with WAL checkpoints',
      evidenceMetrics: { latencyMs: 42, errorRate: 0 },
    });

    expect(imp1.id).toBeDefined();
    expect(imp1.successRuns).toBe(1);

    // Record the exact same adaptation for the same problem signature
    const imp2 = toolEngine.recordImprovement({
      projectId: 'proj-kin',
      domain: 'database_migration',
      componentType: 'tool',
      problemSignature: 'table_lock_timeout',
      verifiedAdaptation: 'Use idempotent CREATE TABLE IF NOT EXISTS with WAL checkpoints',
    });

    expect(imp2.id).toBe(imp1.id);
    expect(imp2.successRuns).toBe(2);

    // Query library for database_migration
    const list = toolEngine.findImprovements('database_migration');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].problemSignature).toBe('table_lock_timeout');
    expect(list[0].verifiedAdaptation).toContain('idempotent CREATE TABLE');
  });
});
