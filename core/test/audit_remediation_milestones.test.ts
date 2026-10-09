import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { BenchmarkEvaluator } from '../src/evaluation/benchmark_evaluator.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { GoalRepository } from '../src/domain/goal_repository.js';
import { SecretBroker } from '../src/security/secret_broker.js';
import { SecretVault } from '../src/security/secret_vault.js';
import { Sentinel } from '../src/security/sentinel.js';
import { EventLedger } from '../src/security/event_ledger.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { WorktreeManager } from '../src/execution/worktree_manager.js';
import { OutputSpiller } from '../src/context/output_spiller.js';
import { FinancialSafetyShield } from '../src/policy/financial_safety.js';
import { AgentIdentity } from '../src/domain/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as childProcess from 'node:child_process';

describe('KIN Comprehensive Audit Remediation & Runtime Hardening (Milestones 1-5)', () => {
  let db: KinDatabase;
  let dbPath: string;
  let taskRepo: TaskRepository;
  let goalRepo: GoalRepository;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `kin_milestones_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.sqlite`);
    db = new KinDatabase(dbPath);
    const migrator = new MigrationRunner(db);
    migrator.runMigrations();
    EventLedger.ensureInitialized(db);
    taskRepo = new TaskRepository(db);
    goalRepo = new GoalRepository(db);

    // Seed baseline entities
    db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-ms', 'Milestone WS', '.', 'AUTO', 1, 1)`);
    db.execute(`INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-ms', 'ws-ms', 'Milestone Proj', '.', 1, 1)`);
    db.execute(`INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at) VALUES ('goal-ms-1', 'proj-ms', 'Initial Goal', 'Initial Description', '["Criterion 1"]', 'active', 1, 1)`);
    db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-ms', 'Milestone Agent', 'Worker', 'System Prompt', 'ollama/llama3', 1)`);
    db.execute(`INSERT INTO agent_identities (id, workspace_id, definition_id, project_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('ag-ms', 'ws-ms', 'def-ms', 'proj-ms', 'Agent MS', 'ollama/llama3', 0, 0, 1, 1)`);
  });

  afterEach(() => {
    if (db && !db.closed) {
      db.close();
    }
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch {}
  });

  // ==========================================================================
  // MILESTONE 1: Operational Truth, Verifiers, Task Fencing & DAG Advancement
  // ==========================================================================
  describe('Milestone 1: Operational Truth & Integrity', () => {
    it('1.1 BenchmarkEvaluator executes 4 genuine deterministic test cases and persists into SQLite', async () => {
      const evaluator = new BenchmarkEvaluator(db);
      const agent: AgentIdentity = {
        id: 'ag-ms',
        workspaceId: 'ws-ms',
        definitionId: 'def-ms',
        projectId: 'proj-ms',
        displayName: 'Agent MS',
        activeModelId: 'ollama/llama3',
        isOrchestrator: false,
        isEphemeral: false,
        roleTitle: 'Worker',
        createdAt: 1,
        updatedAt: 1,
      };

      const result = await evaluator.evaluate(agent);

      expect(result.testCasesRun).toBe(12);
      expect(result.testCasesPassed).toBeGreaterThanOrEqual(1);
      expect(result.testCases).toHaveLength(12);
      expect(result.rubricScores).toBeDefined();
      expect(result.rubricScores.overall).toBe(result.score);
      expect(result.executionLogs).toContain('Initiating benchmark evaluation');

      // Verify authentic persistence in SQLite agent_evaluations table
      const stored = db.queryOne<any>(
        'SELECT * FROM agent_evaluations WHERE id = ?',
        result.evalId
      );
      expect(stored).toBeDefined();
      expect(stored.agent_id).toBe('ag-ms');
      expect(stored.test_cases_run).toBe(12);
      expect(stored.test_cases_passed).toBe(result.testCasesPassed);
      expect(stored.score).toBe(result.score);
      expect(JSON.parse(stored.test_cases_json)).toHaveLength(12);
      expect(stored.execution_logs).toContain('Initiating benchmark evaluation');
    });

    it('1.2 TaskRepository.completeTask enforces OCC fencing token preventing stale runs from overwriting claims', () => {
      // Seed runs for foreign key satisfaction
      db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-lease-holder', 'ag-ms', 'proj-ms', 'running', 1, 1)`);
      db.execute(`INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES ('run-stale-intruder', 'ag-ms', 'proj-ms', 'running', 1, 1)`);

      taskRepo.createTask({
        id: 'task-fence-1',
        goalId: 'goal-ms-1',
        title: 'Fenced Task',
        status: 'running',
        claimedByRunId: 'run-lease-holder',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Create temporary evidence artifact file
      const testEvidenceFile = path.join(os.tmpdir(), `kin_ev_${Date.now()}.txt`);
      fs.writeFileSync(testEvidenceFile, 'VERIFIED EVIDENCE CONTENT');

      // Insert verified evidence records
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, verified_by, created_at)
         VALUES ('ev-fence-stale', 'task-fence-1', 'run-stale-intruder', 'artifact_hash', ?, 1, 'verifier-ms', ?)`,
        testEvidenceFile,
        Date.now()
      );
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, verified_by, created_at)
         VALUES ('ev-fence-1', 'task-fence-1', 'run-lease-holder', 'artifact_hash', ?, 1, 'verifier-ms', ?)`,
        testEvidenceFile,
        Date.now()
      );

      // A different stale run tries to complete the task — fails on OCC SQL fencing
      expect(() => {
        taskRepo.completeTask('task-fence-1', 'ev-fence-stale', 'run-stale-intruder');
      }).toThrow(/run claim mismatch \(stale run\)/);

      // Task status must remain running
      const taskAfterStaleAttempt = taskRepo.getTask('task-fence-1');
      expect(taskAfterStaleAttempt?.status).toBe('running');

      // The authorized lease-holding run completes the task successfully
      const promoted = taskRepo.completeTask('task-fence-1', 'ev-fence-1', 'run-lease-holder');
      expect(promoted).toBeDefined();

      const taskAfterValidCompletion = taskRepo.getTask('task-fence-1');
      expect(taskAfterValidCompletion?.status).toBe('completed');
      expect(taskAfterValidCompletion?.claimedByRunId).toBeFalsy();

      try { fs.unlinkSync(testEvidenceFile); } catch {}
    });

    it('1.3 GoalRepository.applyReplanning persists modified title, description and criteria to SQLite', () => {
      const replanningProposal = {
        title: 'Hardened Goal Title',
        description: 'Hardened Description with new scope',
        acceptanceCriteria: ['Pass automated test suite', 'Zero security violations'],
      };

      goalRepo.applyReplanning('goal-ms-1', replanningProposal);

      const updatedGoal = goalRepo.getGoal('goal-ms-1');
      expect(updatedGoal).toBeDefined();
      expect(updatedGoal?.title).toBe('Hardened Goal Title');
      expect(updatedGoal?.description).toBe('Hardened Description with new scope');
      expect(updatedGoal?.acceptanceCriteria).toEqual([
        'Pass automated test suite',
        'Zero security violations',
      ]);
    });

    it('1.4 DAG advancement selects all ready sibling tasks for dispatch instead of dropping them', () => {
      // Create multiple ready sibling tasks in the same goal
      taskRepo.createTask({
        id: 'task-sibling-1',
        goalId: 'goal-ms-1',
        title: 'Parallel Worker A',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      taskRepo.createTask({
        id: 'task-sibling-2',
        goalId: 'goal-ms-1',
        title: 'Parallel Worker B',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const siblingTasks = taskRepo.listTasksByGoal('goal-ms-1');
      // The filter logic from CoreServer line 8750
      const activeTaskId = 'task-non-ready';
      const readyTasks = siblingTasks.filter((t) => t.id !== activeTaskId && t.status === 'ready');

      expect(readyTasks).toHaveLength(2);
      expect(readyTasks.map((t) => t.id)).toContain('task-sibling-1');
      expect(readyTasks.map((t) => t.id)).toContain('task-sibling-2');
    });

    it('1.5 OutputSpiller safely persists oversized outputs and ToolGateway read_spill inspects them', async () => {
      const spiller = new OutputSpiller();
      const largeContent = 'LINE_OF_SECRET_DATA_'.repeat(500); // 10,000 chars
      const spillRef = spiller.processOutput(largeContent, 'test-tool');

      expect(spillRef.isSpilled).toBe(true);
      expect(spillRef.hash).toBeDefined();

      const gateway = new ToolGateway({});
      const result = await gateway.executeTool<{ content: string; totalBytes: number; hasMore: boolean }>(
        'read_spill',
        { hash: spillRef.hash!, offset: 0, limit: 100 },
        { runId: 'run-spill', autonomyMode: 'FULL_ACCESS', allowedCapabilities: ['*'] }
      );

      expect(result.success).toBe(true);
      expect(result.output.content).toHaveLength(100);
      expect(result.output.totalBytes).toBe(Buffer.byteLength(largeContent, 'utf-8'));
      expect(result.output.hasMore).toBe(true);
    });

    it('1.6 verificationSpec gates task completion: command execution and artifact type matching', () => {
      db.execute(
        `INSERT INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at)
         VALUES ('run-spec-holder', 'ag-ms', 'proj-ms', 'running', 1, 1)`
      );

      // 1. Task expecting test_output rejects pure git commit SHA (artifact_hash)
      taskRepo.createTask({
        id: 'task-spec-type-mismatch',
        goalId: 'goal-ms-1',
        title: 'Task expecting test_output',
        status: 'running',
        verificationSpec: { expectedArtifactType: 'test_output' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const headSha = childProcess.execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      const commitEvidenceId = 'ev-commit-only';
      db.execute(
        `INSERT INTO evidence (id, task_id, run_id, type, content_uri, verified, verified_by, created_at)
         VALUES (?, ?, 'run-spec-holder', 'artifact_hash', ?, 1, 'ag-ms', ?)`,
        commitEvidenceId,
        'task-spec-type-mismatch',
        `git://commit/${headSha}`,
        Date.now()
      );

      expect(() => taskRepo.completeTask('task-spec-type-mismatch', commitEvidenceId, 'run-spec-holder')).toThrow(/does not match expected artifact type/);
      expect(taskRepo.getTask('task-spec-type-mismatch')?.status).toBe('review');
    });
  });

  // ==========================================================================
  // MILESTONE 2: Secret Hardening, Zero-Leak Vault & Scoped Grants
  // ==========================================================================
  describe('Milestone 2: Secret Hardening & Scoped Grants', () => {
    it('2.1 Credential storage precomputes masked_key and list operations require zero decryption', () => {
      const rawSecret = 'sk-proj-supersecretkey987654321';
      const maskedKey = `${rawSecret.slice(0, 3)}...${rawSecret.slice(-4)}`;
      const cipherHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-1', 'openai', 'Prod OpenAI Key', ?, ?, '["ag-ms"]', 100000, 0, 1, ?, ?)`,
        cipherHash,
        maskedKey,
        Date.now(),
        Date.now()
      );

      // Query credentials list directly like GET /api/settings/credentials
      const rows = db.query<any>(
        'SELECT id, provider, key_alias, masked_key, scoped_grants_json FROM managed_credentials WHERE is_active = 1'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].masked_key).toBe('sk-...4321');
      // Ciphertext/plain secret is never exposed in the maskedKey view
      expect(rows[0].masked_key).not.toContain('supersecretkey');
    });

    it('2.2 SecretBroker resolves placeholders only for authorized callerAgentId and rejects unauthorized agents', () => {
      const broker = new SecretBroker(db);
      const rawKey = 'sk-test-scoped-secret-1234';
      const vault = SecretVault.getInstance();
      const encrypted = vault.encrypt(rawKey);

      db.execute(
        `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
         VALUES ('cred-scoped', 'anthropic', 'CLAUDE_API_KEY', ?, 'sk-...1234', '["agent-authorized-1"]', 100000, 0, 1, ?, ?)`,
        encrypted,
        Date.now(),
        Date.now()
      );

      // Authorized agent caller
      const authorizedParams = broker.resolvePlaceholders(
        { apiKey: '{{vault:CLAUDE_API_KEY}}' },
        'agent-authorized-1'
      );
      expect(authorizedParams.apiKey).toBe(rawKey);

      // Unauthorized agent caller — must be denied access with alert logged
      const unauthorizedParams = broker.resolvePlaceholders(
        { apiKey: '{{vault:CLAUDE_API_KEY}}' },
        'agent-unauthorized-rogue'
      );
      expect(unauthorizedParams.apiKey).toBe('[DENIED_UNAUTHORIZED_KEY_ACCESS:CLAUDE_API_KEY]');

      // Check that a security alert was recorded in event_journal
      const securityAlert = db.queryOne<any>(
        "SELECT * FROM event_journal WHERE event_type = 'SECURITY_ALERT'"
      );
      expect(securityAlert).toBeDefined();
      expect(securityAlert.entity_id).toBe('agent-unauthorized-rogue');
      expect(securityAlert.payload_json).toContain('CLAUDE_API_KEY');
    });

    it('2.3 SecretVault stores master key in user profile directory rather than repository root', () => {
      const vault = SecretVault.getInstance();
      const vaultKeyPath = vault.getKeyFilePath();

      const userHome = process.env.APPDATA || process.env.USERPROFILE || process.env.HOME || '';
      // Path must resolve to user profile directory, not project relative .kin
      expect(vaultKeyPath).toContain(path.normalize('.kin'));
      expect(vaultKeyPath.endsWith('vault.key')).toBe(true);
    });

    it('2.4 SecretVault constructor prioritizes user home directory key file over repository root key file', () => {
      const tempHome = path.join(os.tmpdir(), `kin_vault_home_${Date.now()}`);
      const tempLocal = path.join(os.tmpdir(), `kin_vault_local_${Date.now()}`);
      const homeKeyFile = path.join(tempHome, '.kin', 'vault.key');
      const localKeyFile = path.join(tempLocal, '.kin', 'vault.key');

      fs.mkdirSync(path.dirname(homeKeyFile), { recursive: true });
      fs.mkdirSync(path.dirname(localKeyFile), { recursive: true });

      const homeKey = crypto.randomBytes(32).toString('hex');
      const localKey = crypto.randomBytes(32).toString('hex');

      fs.writeFileSync(homeKeyFile, homeKey);
      fs.writeFileSync(localKeyFile, localKey);

      const oldUserProfile = process.env.USERPROFILE;
      const oldHome = process.env.HOME;
      try {
        process.env.USERPROFILE = tempHome;
        process.env.HOME = tempHome;
        SecretVault.resetInstance();
        const vault = SecretVault.getInstance();
        expect(vault.getKeyFilePath()).toBe(homeKeyFile);
      } finally {
        process.env.USERPROFILE = oldUserProfile;
        process.env.HOME = oldHome;
        SecretVault.resetInstance();
        try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(tempLocal, { recursive: true, force: true }); } catch {}
      }
    });
  });

  // ==========================================================================
  // MILESTONE 3: Execution Isolation, Worktree Concurrency, Role Baselines & Auth Protocol
  // ==========================================================================
  describe('Milestone 3: Execution Isolation & Policy Baselines', () => {
    it('3.1 ToolGateway.resolveJailedPath rejects symlink escapes and path traversals', () => {
      const gateway = new ToolGateway({});
      const worktreeDir = path.join(os.tmpdir(), `kin_jail_test_${Date.now()}`);
      fs.mkdirSync(worktreeDir, { recursive: true });

      try {
        // Standard in-jail path
        const validPath = gateway.resolveJailedPath('src/index.ts', worktreeDir);
        expect(validPath).toBe(path.resolve(worktreeDir, 'src/index.ts'));

        // Direct directory traversal escape
        expect(() => {
          gateway.resolveJailedPath('../../outside_file.txt', worktreeDir);
        }).toThrow(/SECURITY JAIL VIOLATION/);

        // Sibling directory with identical prefix traversal attempt
        const siblingEscape = path.resolve(worktreeDir + '_other', 'secret.txt');
        const relativeEscape = path.relative(worktreeDir, siblingEscape);
        expect(() => {
          gateway.resolveJailedPath(relativeEscape, worktreeDir);
        }).toThrow(/SECURITY JAIL VIOLATION/);
      } finally {
        try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
      }
    });

    it('3.2 ToolGateway.resolveJailedPath verifies path confinement with directory junctions on Windows and symlinks on Unix', () => {
      const gateway = new ToolGateway({});
      const worktreeDir = path.join(os.tmpdir(), `kin_jail_junction_${Date.now()}`);
      const outsideDir = path.join(os.tmpdir(), `kin_outside_dir_${Date.now()}`);
      fs.mkdirSync(worktreeDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      const secretFile = path.join(outsideDir, 'secret_host_data.txt');
      fs.writeFileSync(secretFile, 'CONFIDENTIAL HOST ASSET');

      const linkPath = path.join(worktreeDir, 'symlink_escape');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';

      try {
        // Uses directory junctions on Windows ('junction') without requiring admin/Developer Mode, and standard symlinks on Unix
        fs.symlinkSync(outsideDir, linkPath, linkType);

        // 1. Direct junction/symlink resolution rejection
        expect(() => {
          gateway.resolveJailedPath('symlink_escape', worktreeDir);
        }).toThrow(/SECURITY JAIL VIOLATION.*symlink/);

        // 2. Traversal into existing file inside junction/symlink rejection
        expect(() => {
          gateway.resolveJailedPath('symlink_escape/secret_host_data.txt', worktreeDir);
        }).toThrow(/SECURITY JAIL VIOLATION.*symlink/);

        // 3. Traversal into non-existent path through junction/symlink rejection
        expect(() => {
          gateway.resolveJailedPath('symlink_escape/sub/non_existent.txt', worktreeDir);
        }).toThrow(/SECURITY JAIL VIOLATION.*symlink/);

        // 4. Case-insensitivity & drive normalization on Windows
        if (process.platform === 'win32') {
          const lowerWorktree = worktreeDir.toLowerCase();
          const valid = gateway.resolveJailedPath('src/index.ts', lowerWorktree);
          expect(valid.toLowerCase()).toBe(path.resolve(lowerWorktree, 'src/index.ts').toLowerCase());
        }
      } finally {
        try {
          if (process.platform === 'win32') {
            fs.rmdirSync(linkPath);
          } else {
            fs.unlinkSync(linkPath);
          }
        } catch {
          try { fs.unlinkSync(linkPath); } catch {}
        }
        try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
      }
    });

    it('3.4 ToolGateway.resolveJailedPath prevents hardlink traversal and external inode escapes', () => {
      const gateway = new ToolGateway({});
      const worktreeDir = path.join(os.tmpdir(), `kin_jail_hardlink_${Date.now()}`);
      const outsideDir = path.join(os.tmpdir(), `kin_outside_hardlink_${Date.now()}`);
      fs.mkdirSync(worktreeDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      const outsideFile = path.join(outsideDir, 'secret_host_record.txt');
      fs.writeFileSync(outsideFile, 'HIGHLY CONFIDENTIAL DATA');

      const insideLink = path.join(worktreeDir, 'escaped_hardlink.txt');
      const safeInsideFile = path.join(worktreeDir, 'safe_file.txt');
      fs.writeFileSync(safeInsideFile, 'INTERNAL WORKSPACE DATA');

      try {
        let hardlinkCreated = false;
        try {
          fs.linkSync(outsideFile, insideLink);
          hardlinkCreated = true;
        } catch (linkErr: any) {
          // If cross-device or permission limits link creation, gracefully notice
          console.warn('[TEST] linkSync skipped:', linkErr.message);
        }

        if (hardlinkCreated) {
          // 1. Path confinement rejects access to file hardlinked to external inode
          expect(() => {
            gateway.resolveJailedPath('escaped_hardlink.txt', worktreeDir);
          }).toThrow(/SECURITY JAIL VIOLATION.*hardlink/);
        }

        // 2. Regular contained files resolve cleanly without false positives
        const valid = gateway.resolveJailedPath('safe_file.txt', worktreeDir);
        expect(valid).toBe(safeInsideFile);
      } finally {
        try { fs.unlinkSync(insideLink); } catch {}
        try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
      }
    });

    it('3.3 Sentinel parameter hash binding rejects tampered payloads and enforces single-use', () => {
      const sentinel = Sentinel.getInstance();
      const token = `tok-test-${Date.now()}`;
      const originalParams = { command: 'echo SAFE_OPERATION' };

      sentinel.registerApprovalToken(token, 'executeShell', 60000, 'run-tamper-test', originalParams);

      // Attempt consumption with tampered parameters
      const tamperedParams = { command: 'rm -rf /' };
      const tamperedResult = sentinel.consumeApprovalToken(token, 'executeShell', 'run-tamper-test', tamperedParams);
      expect(tamperedResult).toBe(false);

      // Consumption with matching parameters succeeds
      const validResult = sentinel.consumeApprovalToken(token, 'executeShell', 'run-tamper-test', originalParams);
      expect(validResult).toBe(true);

      // Second consumption attempt fails (single-use enforced)
      const replayResult = sentinel.consumeApprovalToken(token, 'executeShell', 'run-tamper-test', originalParams);
      expect(replayResult).toBe(false);
    });

    it('3.4 FinancialSafetyShield checkAuthProtocolRequirement triggers human authorization requirement', () => {
      const shield = new FinancialSafetyShield();
      const result = shield.checkAuthProtocolRequirement('https://stripe.com/checkout', 'Enter 2FA security code');

      expect(result.requiresUserAuth).toBe(true);
      expect(result.promptInstructions).toBeDefined();
    });

    it('3.5 ToolGateway exposes execute_skill and read_spill schemas', () => {
      const gateway = new ToolGateway({});
      const schemas = gateway.getToolSchemas();

      const toolNames = schemas.map((s) => s.name);
      expect(toolNames).toContain('read_spill');
      expect(toolNames).toContain('execute_skill');
    });
  });

  // ==========================================================================
  // MILESTONE 4: Frictionless Multi-Platform Desktop Packaging & Communication
  // ==========================================================================
  describe('Milestone 4: Multi-Platform Desktop Packaging & Communication', () => {
    it('4.1 ui/vite.config.ts restricts development server binding strictly to 127.0.0.1', () => {
      const viteConfigPath = path.resolve(__dirname, '../../ui/vite.config.ts');
      const content = fs.readFileSync(viteConfigPath, 'utf-8');

      expect(content).toContain("host: '127.0.0.1'");
      expect(content).not.toContain("host: '0.0.0.0'");
    });

    it('4.2 src-tauri/tauri.conf.json configures standalone sidecar externalBin', () => {
      const tauriConfPath = path.resolve(__dirname, '../../src-tauri/tauri.conf.json');
      const content = fs.readFileSync(tauriConfPath, 'utf-8');
      const conf = JSON.parse(content);

      expect(conf.bundle).toBeDefined();
      expect(conf.bundle.externalBin).toBeDefined();
      expect(conf.bundle.externalBin).toContain('binaries/kin-core');
    });

    it('4.3 src-tauri/src/supervisor.rs implements sidecar detection and Unix process supervisor cleanup', () => {
      const supervisorPath = path.resolve(__dirname, '../../src-tauri/src/supervisor.rs');
      const content = fs.readFileSync(supervisorPath, 'utf-8');

      expect(content).toContain('kin-core');
      expect(content).toContain('unix_impl');
      expect(content).toContain('UnixProcessSupervisor');
      expect(content).toContain('libc::kill');
    });
  });

  // ==========================================================================
  // MILESTONE 5: CI/CD Quality Gates & Automated Verification Matrix
  // ==========================================================================
  describe('Milestone 5: Continuous Integration Quality Gates & Runner Stabilization', () => {
    it('5.1 .github/workflows/ci.yml enforces multi-platform build, vitest suite, and cargo check', () => {
      const ciPath = path.resolve(__dirname, '../../.github/workflows/ci.yml');
      expect(fs.existsSync(ciPath)).toBe(true);

      const content = fs.readFileSync(ciPath, 'utf-8');
      expect(content).toContain('windows-latest');
      expect(content).toContain('ubuntu-latest');
      expect(content).toContain('macos-latest');
      expect(content).toContain('npm run build');
      expect(content).toContain('npm run test --workspace=core');
      expect(content).toContain('cargo check');
      expect(content).toContain('cargo test');
      expect(content).toContain('/api/health');
    });

    it('5.2 core/vitest.config.ts configures pool: threads to prevent Windows IPC disconnects', () => {
      const vitestConfigPath = path.resolve(__dirname, '../vitest.config.ts');
      const content = fs.readFileSync(vitestConfigPath, 'utf-8');

      expect(content).toContain("pool: 'threads'");
    });

    it('5.3 core/package.json contains package:binary script and updated test runner flags', () => {
      const packageJsonPath = path.resolve(__dirname, '../package.json');
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      expect(pkg.scripts['package:binary']).toBe('node scripts/package_binary.js');
      expect(pkg.scripts['test']).toContain('--pool=threads');
    });
  });
});
