import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CoreServer } from '../src/server/core_server.js';

describe('Approval Loop Resumption & Task Lease Management', () => {
  const testDbPath = path.resolve(process.cwd(), 'kin_test_approval.sqlite');
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }

    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('POST /api/approvals/:approvalId/resolve with approved: true marks approval approved and executes tool', async () => {
    const db = server.getDatabase();
    const defaultAgent = db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1');
    expect(defaultAgent).toBeDefined();

    const approvalId = server.createApprovalRecord(
      'workspace_tree',
      { depth: 1 },
      'Operator inspection test',
      defaultAgent!.id,
      'MEDIUM'
    );

    // Verify approval starts pending
    const initialApproval = db.queryOne<{ status: string; run_id: string }>(
      'SELECT status, run_id FROM approvals WHERE id = ?',
      approvalId
    );
    expect(initialApproval?.status).toBe('pending');

    const res = await fetch(`http://127.0.0.1:${port}/api/approvals/${approvalId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.approvalId).toBe(approvalId);

    // Verify status updated in database
    const resolvedApproval = db.queryOne<{ status: string; decided_at: number }>(
      'SELECT status, decided_at FROM approvals WHERE id = ?',
      approvalId
    );
    expect(resolvedApproval?.status).toBe('approved');
    expect(resolvedApproval?.decided_at).toBeGreaterThan(0);

    // Verify run transitioned to running
    const run = db.queryOne<{ state: string }>(
      'SELECT state FROM agent_runs WHERE id = ?',
      initialApproval!.run_id
    );
    expect(run?.state).toBe('running');
  });

  it('POST /api/approvals/:approvalId/resolve with approved: false cancels run and releases task lease', async () => {
    const db = server.getDatabase();
    const defaultAgent = db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1');
    const now = Date.now();

    // Create a goal and a task
    const goalId = 'goal-lease-test';
    const taskId = 'task-lease-test';
    db.execute(
      `INSERT OR REPLACE INTO goals (id, project_id, title, description, acceptance_criteria_json, status, created_at, updated_at)
       VALUES (?, 'proj-kin', 'Approval Rejection Goal', 'Test goal description', '[]', 'active', ?, ?)`,
      goalId, now, now
    );

    const approvalId = server.createApprovalRecord(
      'file_delete',
      { path: 'critical.dat' },
      'Dangerous deletion requiring signoff',
      defaultAgent!.id,
      'CRITICAL'
    );

    const initialApproval = db.queryOne<{ status: string; run_id: string }>(
      'SELECT status, run_id FROM approvals WHERE id = ?',
      approvalId
    );

    // Attach task to the run and claim it
    db.execute(
      `INSERT OR REPLACE INTO tasks (id, goal_id, title, description, status, claimed_by_run_id, lease_expires_at, created_at, updated_at)
       VALUES (?, ?, 'Dangerous task', 'Dangerous task description', 'running', ?, ?, ?, ?)`,
      taskId, goalId, initialApproval!.run_id, now + 60000, now, now
    );
    db.execute(
      `UPDATE agent_runs SET task_id = ? WHERE id = ?`,
      taskId, initialApproval!.run_id
    );

    // Reject the approval
    const res = await fetch(`http://127.0.0.1:${port}/api/approvals/${approvalId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false, decision: 'reject' }),
    });

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);

    // Verify approval marked rejected
    const rejectedApproval = db.queryOne<{ status: string }>(
      'SELECT status FROM approvals WHERE id = ?',
      approvalId
    );
    expect(rejectedApproval?.status).toBe('rejected');

    // Verify agent run transitioned to cancelled
    const run = db.queryOne<{ state: string }>(
      'SELECT state FROM agent_runs WHERE id = ?',
      initialApproval!.run_id
    );
    expect(run?.state).toBe('cancelled');

    // Verify task lease was released and status set to blocked
    const task = db.queryOne<{ status: string; claimed_by_run_id: string | null }>(
      'SELECT status, claimed_by_run_id FROM tasks WHERE id = ?',
      taskId
    );
    expect(task?.status).toBe('blocked');
    expect(task?.claimed_by_run_id).toBeNull();
  });

  it('handles tool execution error on approval by recording error and resuming loop for self-correction', async () => {
    const db = server.getDatabase();
    const defaultAgent = db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1');

    // Create approval for a non-existent or failing tool invocation
    const approvalId = server.createApprovalRecord(
      'non_existent_tool_xyz',
      { param: 'value' },
      'Failing tool test',
      defaultAgent!.id,
      'HIGH'
    );

    const initialApproval = db.queryOne<{ status: string; run_id: string }>(
      'SELECT status, run_id FROM approvals WHERE id = ?',
      approvalId
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/approvals/${approvalId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });

    expect(res.status).toBe(200);

    // Approval is marked approved in database even though tool failed
    const resolvedApproval = db.queryOne<{ status: string }>(
      'SELECT status FROM approvals WHERE id = ?',
      approvalId
    );
    expect(resolvedApproval?.status).toBe('approved');

    // Agent run is transitioned to running so the loop can self-correct
    const run = db.queryOne<{ state: string }>(
      'SELECT state FROM agent_runs WHERE id = ?',
      initialApproval!.run_id
    );
    expect(run?.state).toBe('running');
  });
});
