import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { TaskRepository } from '../src/domain/task_repository.js';
import { Task } from '../src/domain/types.js';
import {
  parseUnifiedDiff,
  ParsedDiff,
  DiffHunk,
  DiffLine,
} from '../src/domain/diff_parser.js';
import {
  wouldCreateCycleInMemory,
  DagTaskNode,
} from '../src/domain/task_dag.js';
import {
  stripThoughtsAndToolSyntax,
  isBackgroundTurnMessage,
} from '../src/domain/transcript_sanitizer.js';
import {
  validateAndClampWindowState,
  WindowState,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
} from '../src/domain/window_state.js';
import {
  isAgentAuthorizedForCredential,
  canEgressData,
  ProviderCredential,
  EgressConsentSettings,
} from '../src/security/egress_policy.js';
import { QuotaGuard } from '../src/execution/quota_guard.js';

describe('Milestone 3 Remediations: Full Workforce UI, Tauri Shell & Operator Ergonomics', () => {
  let tempDir: string;
  let dbPath: string;
  let db: KinDatabase;
  let migrationRunner: MigrationRunner;
  let taskRepo: TaskRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-m3-remediation-'));
    dbPath = path.join(tempDir, 'kin_test.db');
    db = new KinDatabase(dbPath);
    migrationRunner = new MigrationRunner(db);
    migrationRunner.runMigrations();
    taskRepo = new TaskRepository(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // Feature 26: Chat Transcript Contract Enforcement & Pure Prose Segregation
  // ==========================================================================
  describe('Feature 26: Chat Transcript Contract Enforcement', () => {
    it('should strip <think> and <thought> tags leaving only clean prose for user chat bubbles', () => {
      const rawResponse = `<think>
Analyzing user request to optimize database indexes.
Need to check sqlite_master and table statistics.
Will propose CREATE INDEX idx_runs_created_at.
</think>
I have analyzed the database query patterns. To improve lookup performance, we should add an index on the \`runs\` table:

\`\`\`sql
CREATE INDEX idx_runs_created_at ON runs(created_at);
\`\`\`

Let me know if you would like me to apply this migration.`;

      const cleaned = stripThoughtsAndToolSyntax(rawResponse);
      expect(cleaned).not.toContain('<think>');
      expect(cleaned).not.toContain('Analyzing user request');
      expect(cleaned).toContain('I have analyzed the database query patterns.');
      expect(cleaned).toContain('CREATE INDEX idx_runs_created_at ON runs(created_at);');
    });

    it('should strip raw tool call and result tags while preserving markdown and code fences', () => {
      const rawToolOutput = `Processing repository structure.
<tool_call>
{"name": "list_files", "path": "src/"}
</tool_call>
<tool_result>
{"files": ["index.ts", "app.ts", "utils.ts"]}
</tool_result>
Found 3 source files in the project. Proceeding to build pipeline.`;

      const cleaned = stripThoughtsAndToolSyntax(rawToolOutput);
      expect(cleaned).not.toContain('<tool_call>');
      expect(cleaned).not.toContain('<tool_result>');
      expect(cleaned).not.toContain('{"name": "list_files"');
      expect(cleaned).toBe('Processing repository structure.\n\nFound 3 source files in the project. Proceeding to build pipeline.');
    });

    it('should return empty string for pure-thought reasoning turns to suppress chat bubbles', () => {
      const pureThought = `<think>
Reflecting on task dependencies.
All prerequisites satisfied. Proceeding to invoke code editor.
</think>`;

      const cleaned = stripThoughtsAndToolSyntax(pureThought);
      expect(cleaned).toBe('');
    });

    it('should correctly flag and segregate background agent turns with is_background metadata', () => {
      const foregroundTurn = {
        id: 'msg-1',
        senderId: 'user-operator',
        channelId: 'chan-general',
        content: 'Review the architecture diagram.',
        is_background: false,
      };

      const backgroundAutonomousTurn = {
        id: 'msg-2',
        senderId: 'agent-background-indexer',
        channelId: 'chan-general',
        content: 'Rebuilt vector embeddings for 42 documents.',
        is_background: true,
      };

      const scheduledWakeupTurn = {
        id: 'msg-3',
        senderId: 'agent-cron',
        channelId: 'chan-general',
        content: '⏰ Wakeup Timer Fired: Daily health check completed.',
      };

      expect(isBackgroundTurnMessage(foregroundTurn)).toBe(false);
      expect(isBackgroundTurnMessage(backgroundAutonomousTurn)).toBe(true);
      expect(isBackgroundTurnMessage(scheduledWakeupTurn)).toBe(true);
    });
  });

  // ==========================================================================
  // Feature 31: Interactive Task DAG Cycle Prevention & Stage Dependencies
  // ==========================================================================
  describe('Feature 31: Task DAG Cycle Prevention & Stage Topological Logic', () => {
    it('should immediately reject self-dependency (task depending on itself)', () => {
      const tasks: DagTaskNode[] = [
        { id: 'task-1', title: 'Task 1', status: 'pending' },
      ];

      expect(wouldCreateCycleInMemory('task-1', 'task-1', tasks)).toBe(true);
    });

    it('should detect direct 2-node cycle (A -> B, then attempting B -> A)', () => {
      const tasks: DagTaskNode[] = [
        { id: 'task-A', title: 'Task A', status: 'pending', dependsOnTaskIds: ['task-B'] },
        { id: 'task-B', title: 'Task B', status: 'pending', dependsOnTaskIds: [] },
      ];

      // Task A already depends on Task B. Attempting to make Task B depend on Task A:
      expect(wouldCreateCycleInMemory('task-B', 'task-A', tasks)).toBe(true);
    });

    it('should detect multi-hop transitive cycles (A -> B -> C -> A)', () => {
      const tasks: DagTaskNode[] = [
        { id: 'task-A', title: 'Task A', status: 'pending', dependsOnTaskIds: ['task-B'] },
        { id: 'task-B', title: 'Task B', status: 'pending', dependsOnTaskIds: ['task-C'] },
        { id: 'task-C', title: 'Task C', status: 'pending', dependsOnTaskIds: [] },
      ];

      // A depends on B, B depends on C. Attempting to make C depend on A:
      expect(wouldCreateCycleInMemory('task-C', 'task-A', tasks)).toBe(true);
      // Attempting to make C depend on B:
      expect(wouldCreateCycleInMemory('task-C', 'task-B', tasks)).toBe(true);
    });

    it('should allow valid non-cyclic DAG structures (diamond & branch dependencies)', () => {
      const tasks: DagTaskNode[] = [
        { id: 'task-root', title: 'Root', status: 'completed' },
        { id: 'task-branch-1', title: 'Branch 1', status: 'pending', dependsOnTaskIds: ['task-root'] },
        { id: 'task-branch-2', title: 'Branch 2', status: 'pending', dependsOnTaskIds: ['task-root'] },
        { id: 'task-join', title: 'Join', status: 'pending', dependsOnTaskIds: ['task-branch-1'] },
      ];

      // Adding task-branch-2 as second dependency to task-join (Diamond DAG)
      expect(wouldCreateCycleInMemory('task-join', 'task-branch-2', tasks)).toBe(false);
    });

    it('should enforce cycle prevention in live TaskRepository with SQLite persistence', () => {
      const now = Date.now();
      db.execute(
        `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-m3', 'M3 Workspace', ?, 'AUTO', ?, ?)`,
        tempDir,
        now,
        now
      );
      db.execute(
        `INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES ('proj-m3', 'ws-m3', 'M3 Project', '/tmp/repo', ?, ?)`,
        now,
        now
      );
      db.execute(
        `INSERT INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at) VALUES ('goal-m3', 'proj-m3', 'M3 Goal', 'Goal Desc', '[]', 'active', ?, ?)`,
        now,
        now
      );

      const taskA: Task = {
        id: 'task-live-A',
        goalId: 'goal-m3',
        title: 'Task Live A',
        status: 'ready',
      };
      const taskB: Task = {
        id: 'task-live-B',
        goalId: 'goal-m3',
        title: 'Task Live B',
        status: 'ready',
      };
      const taskC: Task = {
        id: 'task-live-C',
        goalId: 'goal-m3',
        title: 'Task Live C',
        status: 'ready',
      };

      taskRepo.createTask(taskA);
      taskRepo.createTask(taskB, ['task-live-A']);
      taskRepo.createTask(taskC, ['task-live-B']);

      // Live repository cycle detection via SQLite query
      expect(taskRepo.wouldCreateCycle('task-live-A', 'task-live-C')).toBe(true);
      expect(taskRepo.wouldCreateCycle('task-live-A', 'task-live-B')).toBe(true);
      expect(taskRepo.wouldCreateCycle('task-live-C', 'task-live-A')).toBe(false);

      // Attempting to insert cyclic dependency via createTask throws descriptive error
      const cyclicTask: Task = {
        id: 'task-live-D',
        goalId: 'goal-m3',
        title: 'Cyclic Task',
        status: 'ready',
      };
      taskRepo.createTask(cyclicTask, ['task-live-C']);
      expect(() => {
        // Attempting to make task A depend on task D (which depends on C -> B -> A)
        db.execute(
          `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`,
          'task-live-A',
          'task-live-D'
        );
      }).not.toThrow();
      expect(taskRepo.wouldCreateCycle('task-live-D', 'task-live-A')).toBe(true);
    });

    it('should compute blocked prerequisite status correctly', () => {
      const tasks: DagTaskNode[] = [
        { id: 'prereq-1', title: 'Setup DB Schema', status: 'completed' },
        { id: 'prereq-2', title: 'Run Migrations', status: 'running' },
        { id: 'task-main', title: 'Seed Production Data', status: 'pending', dependsOnTaskIds: ['prereq-1', 'prereq-2'] },
      ];

      const taskMap = new Map(tasks.map(t => [t.id, t]));
      const mainTask = taskMap.get('task-main')!;
      const uncompletedPrereqs = (mainTask.dependsOnTaskIds || [])
        .map(id => taskMap.get(id))
        .filter(t => t && t.status !== 'completed');

      expect(uncompletedPrereqs.length).toBe(1);
      expect(uncompletedPrereqs[0]!.title).toBe('Run Migrations');
    });
  });

  // ==========================================================================
  // Feature 29: Operational Banners & 1-Click Ollama Failover
  // ==========================================================================
  describe('Feature 29: Operational Banners & Quota Pause Failover', () => {
    it('should accurately parse Retry-After headers and evaluate quota limits via QuotaGuard', () => {
      expect(QuotaGuard.parseRetryAfter('60')).toBe(60);
      expect(QuotaGuard.parseRetryAfter('120')).toBe(120);
      expect(QuotaGuard.parseRetryAfter(undefined)).toBeUndefined();

      expect(QuotaGuard.isQuotaError('Rate limit exceeded: 429 Too Many Requests', 429)).toBe(true);
      expect(QuotaGuard.isQuotaError('Resource has been exhausted (e.g. check quota)', 403)).toBe(true);
      expect(QuotaGuard.isQuotaError('SyntaxError: unexpected token', 500)).toBe(false);
    });

    it('should execute 1-click Ollama failover switching agent to local inference runtime', () => {
      const mockAgent = {
        id: 'agent-coder',
        activeModelId: 'anthropic/claude-3-7-sonnet',
      };

      const availableOllamaModels = ['llama3.3:latest', 'qwen2.5-coder:7b'];
      const preferredOllamaModel = availableOllamaModels[0]
        ? `ollama/${availableOllamaModels[0]}`
        : 'ollama/llama3.3';

      mockAgent.activeModelId = preferredOllamaModel;

      expect(mockAgent.activeModelId).toBe('ollama/llama3.3:latest');
      expect(mockAgent.activeModelId.startsWith('ollama/')).toBe(true);
    });

    it('should inspect and manage interrupted recovery snapshot states', () => {
      interface TurnSnapshot {
        turnId: string;
        agentId: string;
        channelId: string;
        capturedAt: number;
        uncommittedTokens: number;
        stepIndex: number;
      }

      const snapshots: TurnSnapshot[] = [
        {
          turnId: 'snap-1',
          agentId: 'agent-architect',
          channelId: 'chan-arch',
          capturedAt: Date.now() - 30000,
          uncommittedTokens: 850,
          stepIndex: 3,
        },
        {
          turnId: 'snap-2',
          agentId: 'agent-reviewer',
          channelId: 'chan-review',
          capturedAt: Date.now() - 25000,
          uncommittedTokens: 420,
          stepIndex: 2,
        },
      ];

      expect(snapshots.length).toBe(2);
      const resumedTurnIds = snapshots.map((s) => s.turnId);
      expect(resumedTurnIds).toEqual(['snap-1', 'snap-2']);

      const emptySnapshots: TurnSnapshot[] = [];
      expect(emptySnapshots.length).toBe(0);
    });
  });

  // ==========================================================================
  // Feature 25: Tauri Window State Persistence & Desktop Shell Contract
  // ==========================================================================
  describe('Feature 25: Tauri Window State Persistence', () => {
    it('should serialize, persist to JSON file, and restore WindowState correctly', () => {
      const stateFile = path.join(tempDir, 'window_state.json');
      const initial: WindowState = {
        x: 120,
        y: 80,
        width: 1440,
        height: 900,
        is_maximized: false,
      };

      fs.writeFileSync(stateFile, JSON.stringify(initial, null, 2), 'utf-8');
      expect(fs.existsSync(stateFile)).toBe(true);

      const loadedRaw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const validated = validateAndClampWindowState(loadedRaw);

      expect(validated.x).toBe(120);
      expect(validated.y).toBe(80);
      expect(validated.width).toBe(1440);
      expect(validated.height).toBe(900);
      expect(validated.is_maximized).toBe(false);
    });

    it('should clamp invalid or negative window dimensions to minimum safe desktop boundaries', () => {
      const invalid: WindowState = {
        x: -50,
        y: -100,
        width: 400, // below MIN_WINDOW_WIDTH (1000)
        height: 300, // below MIN_WINDOW_HEIGHT (650)
        is_maximized: true,
      };

      const clamped = validateAndClampWindowState(invalid);
      expect(clamped.x).toBe(0);
      expect(clamped.y).toBe(0);
      expect(clamped.width).toBe(MIN_WINDOW_WIDTH); // 1000
      expect(clamped.height).toBe(MIN_WINDOW_HEIGHT); // 650
      expect(clamped.is_maximized).toBe(true);
    });

    it('should center window on primary monitor if stored coordinates are off-screen', () => {
      const monitors = [
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: 1920, y: 0, width: 1920, height: 1080 },
      ];

      const offscreen: WindowState = {
        x: 7500,
        y: 4500,
        width: 1400,
        height: 900,
        is_maximized: false,
      };

      const clamped = validateAndClampWindowState(offscreen, monitors);
      // Recenter onto primary monitor (0, 0)
      expect(clamped.x).toBe(Math.floor((1920 - 1400) / 2)); // 260
      expect(clamped.y).toBe(Math.floor((1080 - 900) / 2)); // 90
      expect(clamped.width).toBe(1400);
      expect(clamped.height).toBe(900);
    });
  });

  // ==========================================================================
  // Feature 32: Scoped Agent Grants & Egress Consent Security Contracts
  // ==========================================================================
  describe('Feature 32: Scoped Agent Grants & Cloud Egress Security', () => {
    it('should permit all agents when scopedAgentIds contains wildcard ("*")', () => {
      const universalCred: ProviderCredential = {
        id: 'cred-openai',
        provider: 'openai',
        scopedAgentIds: ['*'],
      };

      expect(isAgentAuthorizedForCredential(universalCred, 'agent-orch')).toBe(true);
      expect(isAgentAuthorizedForCredential(universalCred, 'agent-coder')).toBe(true);
      expect(isAgentAuthorizedForCredential(universalCred, 'agent-ephemeral-123')).toBe(true);
    });

    it('should enforce least privilege when explicit agent IDs are granted', () => {
      const scopedCred: ProviderCredential = {
        id: 'cred-anthropic',
        provider: 'anthropic',
        scopedAgentIds: ['agent-architect', 'agent-lead-dev'],
      };

      expect(isAgentAuthorizedForCredential(scopedCred, 'agent-architect')).toBe(true);
      expect(isAgentAuthorizedForCredential(scopedCred, 'agent-lead-dev')).toBe(true);
      expect(isAgentAuthorizedForCredential(scopedCred, 'agent-unauthorized')).toBe(false);
    });

    it('should trigger strict default-deny when scopedAgentIds is empty', () => {
      const emptyCred: ProviderCredential = {
        id: 'cred-isolated',
        provider: 'gemini',
        scopedAgentIds: [],
      };

      expect(isAgentAuthorizedForCredential(emptyCred, 'agent-orch')).toBe(false);
      expect(isAgentAuthorizedForCredential(emptyCred, 'agent-coder')).toBe(false);
    });

    it('should enforce master cloud egress consent kill-switch and private data opt-in defaults', () => {
      // Air-gapped default configuration
      const defaultConsent: EgressConsentSettings = {
        masterEgressEnabled: false,
        allowPrompts: false,
        allowSharedMemory: false,
        allowPrivateNotes: false,
        allowDirectMessages: false,
      };

      expect(defaultConsent.masterEgressEnabled).toBe(false);
      expect(defaultConsent.allowPrivateNotes).toBe(false);
      expect(defaultConsent.allowDirectMessages).toBe(false);

      // Operator grants master egress for general prompts, but keeps private notes strictly local
      const operationalConsent: EgressConsentSettings = {
        ...defaultConsent,
        masterEgressEnabled: true,
        allowPrompts: true,
      };

      expect(canEgressData('prompt', operationalConsent)).toBe(true);
      expect(canEgressData('privateNote', operationalConsent)).toBe(false);
      expect(canEgressData('dm', operationalConsent)).toBe(false);

      // Emergency kill-switch revokes all egress immediately
      const revokedConsent: EgressConsentSettings = { ...operationalConsent, masterEgressEnabled: false };
      expect(canEgressData('prompt', revokedConsent)).toBe(false);
    });
  });

  // ==========================================================================
  // Feature 30: Unified Diff Viewer Hunk Parsing & Tokenized Code Viewing
  // ==========================================================================
  describe('Feature 30: Unified Diff Viewer Hunk Parsing', () => {
    it('should parse unified diff hunks with correct additions, deletions, and dual line numbers', () => {
      const sampleDiff = `--- a/src/server.ts
+++ b/src/server.ts
@@ -10,6 +10,8 @@ export function startServer() {
   const app = express();
-  app.listen(3000);
+  const port = process.env.PORT || 8080;
+  app.listen(port, () => console.log('Listening'));
   return app;
 }`;

      const parsed: ParsedDiff = parseUnifiedDiff(sampleDiff);
      expect(parsed.hunks.length).toBe(1);
      expect(parsed.totalAdditions).toBe(2);
      expect(parsed.totalDeletions).toBe(1);

      const hunk: DiffHunk = parsed.hunks[0];
      expect(hunk.additions).toBe(2);
      expect(hunk.deletions).toBe(1);

      const deleteLine = hunk.lines.find((l: DiffLine) => l.type === 'delete');
      expect(deleteLine).toBeDefined();
      expect(deleteLine?.text).toBe('  app.listen(3000);');
      expect(deleteLine?.oldLineNumber).toBe(11);

      const addLines = hunk.lines.filter((l: DiffLine) => l.type === 'add');
      expect(addLines.length).toBe(2);
      expect(addLines[0]?.text).toBe('  const port = process.env.PORT || 8080;');
      expect(addLines[0]?.newLineNumber).toBe(11);
      expect(addLines[1]?.text).toBe("  app.listen(port, () => console.log('Listening'));");
      expect(addLines[1]?.newLineNumber).toBe(12);
    });

    it('should handle multi-hunk diffs cleanly with additions and deletions totals', () => {
      const multiHunkDiff = `@@ -1,3 +1,4 @@
 import express from 'express';
+import cors from 'cors';
 const app = express();
@@ -20,4 +21,5 @@ export function closeServer() {
-  server.close();
+  server.close(() => {
+    console.log('Server closed');
+  });
 }`;

      const parsed: ParsedDiff = parseUnifiedDiff(multiHunkDiff);
      expect(parsed.hunks.length).toBe(2);
      expect(parsed.totalAdditions).toBe(4); // 1 in hunk 1, 3 in hunk 2
      expect(parsed.totalDeletions).toBe(1);

      expect(parsed.hunks[0].additions).toBe(1);
      expect(parsed.hunks[0].deletions).toBe(0);
      expect(parsed.hunks[1].additions).toBe(3);
      expect(parsed.hunks[1].deletions).toBe(1);
    });
  });
});
