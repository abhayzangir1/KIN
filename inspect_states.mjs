import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('core/kin_storage.sqlite');

const runStats = db.prepare('SELECT state, COUNT(*) as count FROM agent_runs GROUP BY state').all();
console.log('--- Agent Run States ---');
console.log(JSON.stringify(runStats, null, 2));

const taskStats = db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all();
console.log('--- Task Statuses ---');
console.log(JSON.stringify(taskStats, null, 2));

const pendingApprovals = db.prepare("SELECT COUNT(*) as count FROM approvals WHERE status = 'pending'").get();
console.log('--- Pending Approvals ---');
console.log(JSON.stringify(pendingApprovals, null, 2));

const recentRuns = db.prepare('SELECT id, agent_id, state, created_at, completed_at FROM agent_runs ORDER BY created_at DESC LIMIT 5').all();
console.log('--- Recent Runs ---');
console.log(JSON.stringify(recentRuns, null, 2));

const runningTasks = db.prepare("SELECT id, status, lease_expires_at, claimed_by_run_id FROM tasks WHERE status = 'running'").all();
console.log('--- Running Tasks Leases ---');
console.log(JSON.stringify(runningTasks, null, 2));
