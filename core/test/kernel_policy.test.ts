import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { AgentKernel } from '../src/kernel/agent_kernel.js';
import { PolicyEngine } from '../src/policy/policy_engine.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Phase 1/3: Agent Kernel Lifecycle, Heartbeats, Quotas & Policy Engine', () => {
  let db: KinDatabase;
  let tempDbPath: string;
  let kernel: AgentKernel;
  let policyEngine: PolicyEngine;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-kernel-test-'));
    tempDbPath = path.join(tempDir, 'kin_kernel.sqlite');
    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    kernel = new AgentKernel(db);
    policyEngine = new PolicyEngine();

    // Seed agent
    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      'ws-1', 'Test WS', '/ws', 'AUTO', now, now
    );
    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      'def-lead', 'Lead', 'Lead Dev', 'System Lead', 'claude-3-5-sonnet', now
    );
    db.execute(
      `INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'agent-lead', 'ws-1', 'def-lead', '@LeadDev', 'claude-3-5-sonnet', now, now
    );
  });

  afterEach(() => {
    db.close();
    try {
      const dir = path.dirname(tempDbPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows lock delay
    }
  });

  it('manages run state transitions, heartbeats, and terminal state invariants', () => {
    const run = kernel.spawnRun({ agentId: 'agent-lead' });
    expect(run.state).toBe('running');
    expect(run.heartbeatAt).toBeDefined();

    // Heartbeat update
    const initialHeartbeat = run.heartbeatAt;
    kernel.heartbeat(run.id);
    const updatedRun = kernel.getRun(run.id);
    expect(updatedRun?.heartbeatAt).toBeGreaterThanOrEqual(initialHeartbeat);

    // State machine transitions
    kernel.transitionState(run.id, 'waiting_for_tool', 'Invoking compiler tool');
    expect(kernel.getRun(run.id)?.state).toBe('waiting_for_tool');

    kernel.transitionState(run.id, 'running', 'Compiler finished');
    expect(kernel.getRun(run.id)?.state).toBe('running');

    kernel.transitionState(run.id, 'completed', 'All tasks done');
    const completedRun = kernel.getRun(run.id);
    expect(completedRun?.state).toBe('completed');
    expect(completedRun?.completedAt).toBeDefined();

    // Invariant: cannot transition out of terminal state
    expect(() => {
      kernel.transitionState(run.id, 'running');
    }).toThrow('Cannot transition run from terminal state');
  });

  it('recovers abandoned/stale runs upon app restart', () => {
    const run = kernel.spawnRun({ agentId: 'agent-lead' });

    // Simulate an abrupt app crash where heartbeat was abandoned 60 seconds ago
    const staleTime = Date.now() - 60000;
    db.execute('UPDATE agent_runs SET heartbeat_at = ? WHERE id = ?', staleTime, run.id);

    // Application restarts and calls recoverStaleRuns()
    const recovered = kernel.recoverStaleRuns(45000);
    expect(recovered).toContain(run.id);

    const recoveredRun = kernel.getRun(run.id);
    expect(recoveredRun?.state).toBe('recovering');
  });

  it('enforces hard swarm quotas (max delegation depth = 3 and max concurrent runs = 8)', () => {
    // 1. Test delegation depth quota
    const rootRun = kernel.spawnRun({ agentId: 'agent-lead' }); // Depth 1
    const childRun = kernel.spawnRun({ agentId: 'agent-lead', parentRunId: rootRun.id }); // Depth 2
    const grandChildRun = kernel.spawnRun({ agentId: 'agent-lead', parentRunId: childRun.id }); // Depth 3

    expect(kernel.calculateDelegationDepth(rootRun.id)).toBe(1);
    expect(kernel.calculateDelegationDepth(childRun.id)).toBe(2);
    expect(kernel.calculateDelegationDepth(grandChildRun.id)).toBe(3);

    // Depth 4 must exceed quota
    expect(() => {
      kernel.spawnRun({ agentId: 'agent-lead', parentRunId: grandChildRun.id });
    }).toThrow('QUOTA EXCEEDED: Maximum delegation depth (3) reached');

    // 2. Test active concurrency quota (max 8)
    // Currently active: 3 runs. Spawn 5 more to reach 8.
    for (let i = 0; i < 5; i++) {
      kernel.spawnRun({ agentId: 'agent-lead' });
    }
    expect(kernel.getActiveRunCount()).toBe(8);

    // 9th concurrent run must be rejected
    expect(() => {
      kernel.spawnRun({ agentId: 'agent-lead' });
    }).toThrow('QUOTA EXCEEDED: Maximum active concurrent runs (8) reached');
  });

  it('enforces monotonic capability attenuation and pre-authorized action leases in PolicyEngine', () => {
    // 1. Monotonic capability attenuation: child attempting capability parent lacks -> DENIED
    const attenuationDenial = policyEngine.evaluateAction({
      agentId: 'agent-child',
      parentRunId: 'parent-run-1',
      toolName: 'executeShell',
      commandOrPath: 'npm test',
      riskLevel: 'MEDIUM',
      autonomyMode: 'AUTO',
      agentCapabilities: ['fs_read', 'network_egress'], // Child requests network
      parentCapabilities: ['fs_read'],                  // Parent only has fs_read
    });
    expect(attenuationDenial.allowed).toBe(false);
    expect(attenuationDenial.reason).toContain('Monotonic capability attenuation violated');

    // 2. Pre-authorized subagent whitelist in parent's approved plan -> EXECUTES without approval prompt
    const preAuthorized = policyEngine.evaluateAction({
      agentId: 'agent-db-worker',
      parentRunId: 'parent-run-1',
      toolName: 'executeShell',
      commandOrPath: 'npm run build:cache',
      riskLevel: 'MEDIUM',
      autonomyMode: 'AUTO',
      agentCapabilities: ['shell'],
      parentCapabilities: ['shell'],
      subagentApprovedWhitelist: {
        permittedCommands: ['npm run build:cache'],
      },
    });
    expect(preAuthorized.allowed).toBe(true);
    expect(preAuthorized.requiresInteractiveApproval).toBe(false);
    expect(preAuthorized.reason).toContain('pre-authorized by parent');

    // 3. Undeclared high-risk action (rm -rf /cache) -> MANDATORY interactive human approval gate
    const undeclaredHighRisk = policyEngine.evaluateAction({
      agentId: 'agent-db-worker',
      parentRunId: 'parent-run-1',
      toolName: 'executeShell',
      commandOrPath: 'rm -rf /cache',
      riskLevel: 'HIGH',
      autonomyMode: 'AUTO',
      agentCapabilities: ['shell'],
      parentCapabilities: ['shell'],
      subagentApprovedWhitelist: {
        permittedCommands: ['npm run build:cache'], // rm -rf is NOT whitelisted
      },
    });
    expect(undeclaredHighRisk.allowed).toBe(true);
    expect(undeclaredHighRisk.requiresInteractiveApproval).toBe(true);
    expect(undeclaredHighRisk.reason).toContain('mandatory human approval gate');
  });
});
