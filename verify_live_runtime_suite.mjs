import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const BASE_URL = 'http://127.0.0.1:54321';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const token = fs.readFileSync('core/.kin/ipc_auth.token', 'utf-8').trim();
const headers = {
  'Authorization': 'Bearer ' + token,
  'Content-Type': 'application/json',
};

const results = [];

function record(section, name, passed, details = {}) {
  const item = { section, name, passed, details, timestamp: new Date().toISOString() };
  results.push(item);
  const statusEmoji = passed ? '✅' : '❌';
  console.log(`${statusEmoji} [${section}] ${name}`);
  if (!passed || Object.keys(details).length > 0) {
    console.log(`   Details:`, JSON.stringify(details, null, 2));
  }
}

async function api(path, options = {}) {
  const opts = {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  };
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data: json };
}

async function runLiveVerification() {
  console.log('================================================================');
  console.log('🚀 STARTING COMPREHENSIVE KIN RUNTIME VERIFICATION SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // 1. Local AI & Engine Initialization
  // -------------------------------------------------------------
  try {
    const ollamaTagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
    const ollamaTags = await ollamaTagsRes.json();
    const modelNames = (ollamaTags.models || []).map(m => m.name);
    const hasQwen = modelNames.some(m => m.includes('qwen2.5-coder'));
    const hasGemma = modelNames.some(m => m.includes('gemma'));

    record('1. Local AI & Engine', 'Ollama daemon responsive with required local models', hasQwen && hasGemma, {
      models: modelNames,
    });
  } catch (err) {
    record('1. Local AI & Engine', 'Ollama daemon responsive with required local models', false, { error: err.message });
  }

  try {
    const health = await api('/api/system/health');
    const comp = health.data?.components || {};
    const passed = health.ok && comp.ollama?.status === 'ok' && comp.sqlite?.status === 'ok' && comp.git?.status === 'ok';
    record('1. Local AI & Engine', 'System health reports all core components OK', passed, {
      ollamaStatus: comp.ollama?.status,
      sqliteStatus: comp.sqlite?.status,
      gitStatus: comp.git?.status,
      concurrencyTier: comp.memory?.concurrencyTier,
    });
  } catch (err) {
    record('1. Local AI & Engine', 'System health reports all core components OK', false, { error: err.message });
  }

  try {
    const db = new DatabaseSync('core/kin_storage.sqlite');
    const journalMode = db.prepare('PRAGMA journal_mode;').get();
    const isWal = journalMode && Object.values(journalMode)[0]?.toString().toLowerCase() === 'wal';
    record('1. Local AI & Engine', 'SQLite storage configured in WAL mode', Boolean(isWal), {
      journalMode: Object.values(journalMode || {})[0],
    });
  } catch (err) {
    record('1. Local AI & Engine', 'SQLite storage configured in WAL mode', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 2. Dynamic Model Discovery & Local Provider Configuration
  // -------------------------------------------------------------
  try {
    const modelsRes = await api('/api/models');
    const models = modelsRes.data?.models || [];
    const ollamaModels = models.filter(m => m.provider === 'ollama');
    const qwenModel = ollamaModels.find(m => m.name.includes('qwen2.5-coder'));
    record('2. Model Discovery', 'Discover local Ollama models with validated status', Boolean(qwenModel?.validated), {
      discoveredCount: ollamaModels.length,
      sample: qwenModel,
    });

    // Assign default model to @Boss
    const bossUpdate = await api('/api/agents/agent-boss/model', {
      method: 'PATCH',
      body: JSON.stringify({ model: 'ollama/qwen2.5-coder:3b' }),
    });
    record('2. Model Discovery', 'Configure agent model to local Ollama runtime', bossUpdate.ok, {
      res: bossUpdate.data,
    });
  } catch (err) {
    record('2. Model Discovery', 'Dynamic model discovery & configuration', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 3. Projects, Channels, and Direct Messages
  // -------------------------------------------------------------
  let testProjectId = 'proj-kin';
  let testChannelId = 'chan-general';

  try {
    const projectsRes = await api('/api/projects');
    const projects = projectsRes.data?.projects || [];
    record('3. Projects & Channels', 'List workspace projects', projects.length > 0, {
      projectCount: projects.length,
      defaultProject: projects[0]?.id,
    });

    const createProj = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: `Live Verification Project ${Date.now()}`,
        description: 'Automated live testing project',
        repoPath: process.cwd(),
      }),
    });
    if (createProj.ok && createProj.data?.project?.id) {
      testProjectId = createProj.data.project.id;
    }
    record('3. Projects & Channels', 'Create new isolated project workspace', createProj.ok, {
      projectId: testProjectId,
    });

    const createChan = await api('/api/channels', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'proj-kin',
        name: `live-verification-${Date.now().toString().slice(-4)}`,
        topic: 'Automated live test channel',
      }),
    });
    if (createChan.ok && createChan.data?.channel?.id) {
      testChannelId = createChan.data.channel.id;
    }
    record('3. Projects & Channels', 'Create dedicated project channel', createChan.ok, {
      channelId: testChannelId,
      channelName: createChan.data?.channel?.name,
    });

    const listChans = await api('/api/channels');
    record('3. Projects & Channels', 'List channels via GET /api/channels', listChans.ok && listChans.data?.channels?.length > 0, {
      count: listChans.data?.channels?.length,
    });

    // Post test message
    const postMsg = await api(`/api/channels/${testChannelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        senderId: 'user-operator',
        senderType: 'user',
        content: 'System audit live ping message',
      }),
    });
    record('3. Projects & Channels', 'Send message to project channel', postMsg.ok, {
      messageId: postMsg.data?.message?.id,
    });

    // Retrieve messages
    const getMsgs = await api(`/api/channels/${testChannelId}/messages`);
    const foundMsg = (getMsgs.data?.messages || []).some(m => m.content.includes('System audit live ping message'));
    record('3. Projects & Channels', 'Retrieve channel messages from SQLite storage', foundMsg, {
      retrievedCount: getMsgs.data?.messages?.length,
    });
  } catch (err) {
    record('3. Projects & Channels', 'Project & channel operations', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 4. Agent Swarm & Specialist Directory
  // -------------------------------------------------------------
  let hiredAgentId = null;
  try {
    const hireRes = await api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'proj-kin',
        displayName: 'SecAuditor_' + Date.now().toString().slice(-4),
        role: 'Security & Integrity Auditor',
        capabilities: ['read_file', 'inspect_tokens'],
        systemPrompt: 'You are a meticulous security auditor checking local permissions.',
        model: 'ollama/qwen2.5-coder:3b',
        color: '#10b981',
      }),
    });
    if (hireRes.ok && hireRes.data?.agent?.id) {
      hiredAgentId = hireRes.data.agent.id;
    }
    record('4. Agent Swarm', 'Hire specialist agent into project swarm', hireRes.ok, {
      agentId: hiredAgentId,
      agentName: hireRes.data?.agent?.displayName,
    });

    if (hiredAgentId) {
      // Add agent to test channel
      const addMember = await api(`/api/channels/${testChannelId}/members`, {
        method: 'POST',
        body: JSON.stringify({ agentId: hiredAgentId }),
      });
      record('4. Agent Swarm', 'Assign specialist agent to channel membership', addMember.ok, {
        channelId: testChannelId,
        agentId: hiredAgentId,
      });

      // Get execution details
      const execDetails = await api(`/api/agents/${hiredAgentId}/execution-details`);
      record('4. Agent Swarm', 'Fetch agent contract and execution details', execDetails.ok, {
        model: execDetails.data?.model,
        capabilities: execDetails.data?.capabilities,
      });
    }
  } catch (err) {
    record('4. Agent Swarm', 'Agent swarm & hiring', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 5. Live Model Inference & Inter-Agent Coordination
  // -------------------------------------------------------------
  try {
    console.log('\n--- Triggering Live Ollama Inference (qwen2.5-coder:3b) ---');
    const userPrompt = `@SecurityAuditor State 1 sentence explaining why local IPC tokens must be verified.`;
    const promptRes = await api(`/api/channels/${testChannelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        senderId: 'user-operator',
        senderType: 'user',
        content: userPrompt,
      }),
    });

    console.log('Message sent. Polling for agent reply from local Ollama runtime...');
    let agentReplies = [];
    let allMsgs = [];
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 4000));
      const pollMsgs = await api(`/api/channels/${testChannelId}/messages`);
      allMsgs = pollMsgs.data?.messages || [];
      agentReplies = allMsgs.filter(m => m.senderType === 'agent');
      if (agentReplies.length > 0) break;
    }

    const hasLiveReply = agentReplies.length > 0;
    record('5. Live Inference', 'Live local Ollama LLM inference without mock data', hasLiveReply, {
      totalMessagesInChannel: allMsgs.length,
      agentRepliesCount: agentReplies.length,
      sampleReplyContent: agentReplies[0]?.content?.slice(0, 160),
    });
  } catch (err) {
    record('5. Live Inference', 'Live model inference', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 6. Goals, Tasks, and Dependency DAG
  // -------------------------------------------------------------
  let goalId = null;
  let taskId = null;
  try {
    const createGoalRes = await api('/api/projects/proj-kin/goals', {
      method: 'POST',
      body: JSON.stringify({
        title: `Security Hardening Verification ${Date.now()}`,
        description: 'Verify HMAC token verification and DAG execution',
        acceptanceCriteria: ['All tests pass with exit code 0', 'HMAC verified'],
      }),
    });
    goalId = createGoalRes.data?.goal?.id;
    taskId = createGoalRes.data?.initialTask?.id;

    record('6. Goals & DAG', 'Create project goal and auto-provision initial task', createGoalRes.ok && Boolean(goalId), {
      goalId,
      initialTaskId: taskId,
    });

    if (goalId) {
      // Create sub-task with dependency
      const subTaskRes = await api(`/api/goals/${goalId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Sub-task: Verify cryptographic sign-off',
          description: 'Ensure operator HMAC signatures prevent unauthorized completion',
          dependencies: taskId ? [taskId] : [],
        }),
      });
      record('6. Goals & DAG', 'Create dependent task establishing DAG linkage', subTaskRes.ok, {
        subTaskId: subTaskRes.data?.task?.id,
        dependencies: subTaskRes.data?.task?.dependencies,
      });

      // Query goals and tasks
      const goalsRes = await api('/api/goals');
      const tasksRes = await api('/api/tasks');
      record('6. Goals & DAG', 'Query project goals and tasks via REST endpoints', goalsRes.ok && tasksRes.ok, {
        goalsCount: goalsRes.data?.goals?.length,
        tasksCount: tasksRes.data?.tasks?.length,
      });

      if (taskId) {
        // Step A: Attempt completion WITHOUT operator signoff or evidence -> should be placed in review or rejected
        const unverifiedRes = await api(`/api/tasks/${taskId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' }),
        });
        const rejectedOrReviewed = unverifiedRes.status === 400 || unverifiedRes.status === 401 || unverifiedRes.status === 403 || unverifiedRes.data?.status === 'review';
        record('6. Goals & DAG', 'Reject unverified task completion without cryptographic evidence', rejectedOrReviewed, {
          status: unverifiedRes.status,
          responseStatus: unverifiedRes.data?.status,
          error: unverifiedRes.data?.error,
        });

        // Step B: Submit cryptographically verified HMAC-SHA256 signature
        const operatorId = 'operator-admin';
        const expectedHmacCompact = crypto.createHmac('sha256', token).update(`${taskId}:completed`).digest('hex');
        const signoffRes = await api(`/api/tasks/${taskId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'completed',
            operatorSignoff: {
              operatorId,
              signature: expectedHmacCompact,
              justification: 'Verified cryptographic sign-off in runtime audit',
            },
          }),
        });
        const completedCleanly = signoffRes.ok && (signoffRes.data?.status === 'completed' || signoffRes.data?.success === true);
        record('6. Goals & DAG', 'Accept cryptographically signed task completion (HMAC-SHA256)', completedCleanly, {
          status: signoffRes.data?.status,
          evidenceBundleId: signoffRes.data?.evidenceBundleId,
        });
      }
    }
  } catch (err) {
    record('6. Goals & DAG', 'Goals and DAG execution', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 7. Security Gate, Approvals, and Secret Vault
  // -------------------------------------------------------------
  try {
    // SecretVault
    const testSecretKey = `TEST_VAULT_KEY_${Date.now()}`;
    const testSecretVal = 'super-secret-password-xyz';
    const storeCredRes = await api('/api/settings/credentials', {
      method: 'POST',
      body: JSON.stringify({
        key: testSecretKey,
        value: testSecretVal,
        provider: 'custom',
      }),
    });
    record('7. Security & Vault', 'Store encrypted credential in SecretVault (AES-256-GCM)', storeCredRes.ok, {
      key: testSecretKey,
    });

    const listCredsRes = await api('/api/settings/credentials');
    const storedCred = (listCredsRes.data?.credentials || []).find(c => c.keyName === testSecretKey || c.keyAlias === testSecretKey);
    const isMasked = storedCred && storedCred.maskedKey !== testSecretVal;
    record('7. Security & Vault', 'Redact vault secrets in API responses', Boolean(isMasked), {
      maskedKey: storedCred?.maskedKey,
    });

    // Approvals Gate
    const createApprRes = await api('/api/approvals', {
      method: 'POST',
      body: JSON.stringify({
        toolName: 'execute_shell',
        actionPayload: { command: 'echo "Runtime Gate Authorized"' },
        riskLevel: 'HIGH',
      }),
    });
    const createdApprId = createApprRes.data?.approval?.id;
    record('7. Security & Vault', 'Create pending approval gate in SQLite', createApprRes.ok && Boolean(createdApprId), {
      approvalId: createdApprId,
    });

    if (createdApprId) {
      // Query approvals
      const listApprs = await api('/api/approvals?status=pending');
      const foundPending = (listApprs.data?.approvals || []).some(a => a.id === createdApprId);
      record('7. Security & Vault', 'Query pending approvals via GET /api/approvals', foundPending, {
        pendingCount: listApprs.data?.approvals?.length,
      });

      // Resolve approval with { approved: true }
      const resolveRes = await api(`/api/approvals/${createdApprId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ approved: true }),
      });
      record('7. Security & Vault', 'Authorize and resolve approval gate', resolveRes.ok && resolveRes.data?.status === 'approved', {
        resolvedStatus: resolveRes.data?.status,
        result: resolveRes.data?.result,
      });
    }
  } catch (err) {
    record('7. Security & Vault', 'Security gate & SecretVault', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 8. Proactive Automations & Scheduler
  // -------------------------------------------------------------
  try {
    const createSchedRes = await api('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'proj-kin',
        name: `Health Check Schedule ${Date.now()}`,
        intervalSeconds: 600,
        action: 'run_health_check',
      }),
    });
    const schedId = createSchedRes.data?.schedule?.id;
    record('8. Automations & Scheduler', 'Create automated interval schedule', createSchedRes.ok && Boolean(schedId), {
      scheduleId: schedId,
    });

    const createCronRes = await api('/api/projects/proj-kin/routines', {
      method: 'POST',
      body: JSON.stringify({
        name: `Daily Security Sweep ${Date.now()}`,
        cronExpression: '0 12 * * *',
        prompt: 'Perform midday system telemetry scan',
      }),
    });
    record('8. Automations & Scheduler', 'Create POSIX calendar cron routine', createCronRes.ok, {
      routineId: createCronRes.data?.routine?.id,
      cronExpression: '0 12 * * *',
    });

    if (schedId) {
      // Trigger schedule manually
      const triggerRes = await api(`/api/schedules/${schedId}/trigger`, {
        method: 'POST',
      });
      record('8. Automations & Scheduler', 'Manually trigger scheduled automation', triggerRes.ok, {
        triggerResult: triggerRes.data,
      });

      // Query attempts
      const attemptsRes = await api(`/api/schedules/${schedId}/attempts`);
      record('8. Automations & Scheduler', 'Query automation execution attempts history', attemptsRes.ok, {
        attemptsCount: attemptsRes.data?.attempts?.length ?? 0,
      });
    }
  } catch (err) {
    record('8. Automations & Scheduler', 'Automations & scheduler', false, { error: err.message });
  }

  // -------------------------------------------------------------
  // 9. Persistent Skill Engine
  // -------------------------------------------------------------
  try {
    const skillsRes = await api('/api/skills');
    record('9. Skill Engine', 'Query installed skills catalog', skillsRes.ok, {
      skillsCount: skillsRes.data?.skills?.length,
    });

    // Record skill experience with real provenance from agent_runs
    const db = new DatabaseSync('core/kin_storage.sqlite');
    const latestRun = db.prepare('SELECT id FROM agent_runs ORDER BY created_at DESC LIMIT 1').get();
    const runId = latestRun?.id;

    const expRes = await api('/api/skills/experiences', {
      method: 'POST',
      body: JSON.stringify({
        runId,
        skillId: 'skill-security-boundary-auditing',
        objective: 'Test commit message generation',
        outcome: 'success',
      }),
    });
    record('9. Skill Engine', 'Record skill learning experience in SQLite', expRes.ok, {
      experienceId: expRes.data?.experienceId,
      runId,
    });

    // Query learning metrics
    const metricsRes = await api('/api/learning/metrics');
    record('9. Skill Engine', 'Query system learning metrics', metricsRes.ok, {
      metrics: metricsRes.data,
    });
  } catch (err) {
    record('9. Skill Engine', 'Skill engine operations', false, { error: err.message });
  }

  console.log('\n================================================================');
  console.log('📊 VERIFICATION SUMMARY');
  console.log('================================================================');
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = total - passedCount;
  console.log(`Total checks: ${total}`);
  console.log(`Passed:       ${passedCount}`);
  console.log(`Failed:       ${failedCount}`);
  console.log(`Success rate: ${Math.round((passedCount / total) * 100)}%`);

  fs.writeFileSync('core/test/live_runtime_verification_report.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    total,
    passed: passedCount,
    failed: failedCount,
    results,
  }, null, 2));

  return { total, passedCount, failedCount };
}

runLiveVerification().catch(err => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});
