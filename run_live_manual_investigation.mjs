import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:54321';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const token = fs.readFileSync('core/.kin/ipc_auth.token', 'utf-8').trim();
const headers = {
  'Authorization': 'Bearer ' + token,
  'Content-Type': 'application/json',
};

const TARGET_MODEL = 'ollama/gemma4:e2b';
const TEST_WORKSPACE = 'D:\\KIN_TEST_WORKSPACE';

const log = (msg, obj = null) => {
  console.log(`[${new Date().toISOString()}] ${msg}`);
  if (obj) console.log(JSON.stringify(obj, null, 2));
};

async function api(endpoint, options = {}) {
  const opts = {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  };
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runInvestigation() {
  log('Starting Live End-to-End Manual Verification with ' + TARGET_MODEL);
  const results = {};

  // 1. Verify Ollama Model Availability
  log('Checking local Ollama for ' + TARGET_MODEL);
  const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
  const tagsJson = await tagsRes.json();
  const models = (tagsJson.models || []).map(m => m.name);
  log('Available models in Ollama:', models);
  if (!models.includes('gemma4:e2b')) {
    throw new Error('Model gemma4:e2b not found in Ollama!');
  }
  results.ollama_model_verified = true;

  // 2. Project (Organization) Creation
  log('Creating Organization Project: AcmeCorp at ' + TEST_WORKSPACE);
  const projRes = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: 'AcmeCorp',
      description: 'Enterprise Multi-Department Workforce Workspace',
      repoPath: TEST_WORKSPACE,
    }),
  });
  log('Project creation response:', projRes.data);
  const projectId = projRes.data?.project?.id;
  if (!projectId) throw new Error('Failed to create project: ' + JSON.stringify(projRes.data));
  results.projectId = projectId;

  // Check default #general channel and @Boss agent
  const stateRes = await api('/api/state');
  const project = stateRes.data?.projects?.find(p => p.id === projectId);
  const channels = (stateRes.data?.channels || []).filter(c => c.projectId === projectId);
  const agents = (stateRes.data?.agents || []).filter(a => a.projectId === projectId);
  log('Provisioned channels in AcmeCorp:', channels.map(c => ({ id: c.id, name: c.name })));
  log('Provisioned agents in AcmeCorp:', agents.map(a => ({ id: a.id, name: a.displayName, isOrchestrator: a.isOrchestrator })));

  const generalChan = channels.find(c => c.name === 'general');
  const bossAgent = agents.find(a => a.isOrchestrator);
  results.generalChannelId = generalChan?.id;
  results.bossAgentId = bossAgent?.id;

  // 3. Configure @Boss Model to TARGET_MODEL
  if (bossAgent) {
    log('Setting @Boss model to ' + TARGET_MODEL);
    const updateBoss = await api(`/api/agents/${bossAgent.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activeModelId: TARGET_MODEL }),
    });
    log('Boss model update:', updateBoss.data);
  }

  // 4. Create Departments (Channels): #engineering and #marketing
  log('Creating department #engineering');
  const engChanRes = await api('/api/channels', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      name: 'engineering',
      topic: 'Software Engineering and Architecture Department',
    }),
  });
  const engChanId = engChanRes.data?.channel?.id;
  log('Engineering channel:', engChanRes.data);

  log('Creating department #marketing');
  const mktChanRes = await api('/api/channels', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      name: 'marketing',
      topic: 'Product Marketing and Growth Department',
    }),
  });
  const mktChanId = mktChanRes.data?.channel?.id;
  log('Marketing channel:', mktChanRes.data);

  results.engChanId = engChanId;
  results.mktChanId = mktChanId;

  // 5. Boss hires Coworkers: @DevLead and @Marketer
  log('Hiring Coworker: @DevLead');
  const devLeadRes = await api('/api/agents', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      displayName: 'DevLead',
      role: 'Staff Software Engineer & Technical Lead',
      capabilities: ['readFile', 'writeFile', 'executeShell', 'hireSpecialist', 'sendDirectMessage', 'rememberPrivate', 'recallPrivate', 'rememberProject', 'rememberChannel', 'recallChannel'],
      systemPrompt: 'You are @DevLead, Staff Software Engineer. You write clean code, audit architectures, and coordinate with coworkers.',
      model: TARGET_MODEL,
      color: '#3b82f6',
    }),
  });
  const devLeadId = devLeadRes.data?.agent?.id;
  log('DevLead agent:', devLeadRes.data);

  log('Hiring Coworker: @Marketer');
  const mktRes = await api('/api/agents', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      displayName: 'Marketer',
      role: 'Product Marketing Manager',
      capabilities: ['readFile', 'writeFile', 'sendDirectMessage', 'rememberPrivate', 'recallPrivate', 'rememberChannel'],
      systemPrompt: 'You are @Marketer, Product Marketing Manager. You communicate launch plans and marketing strategies.',
      model: TARGET_MODEL,
      color: '#ec4899',
    }),
  });
  const marketerId = mktRes.data?.agent?.id;
  log('Marketer agent:', mktRes.data);

  results.devLeadId = devLeadId;
  results.marketerId = marketerId;

  // 6. Assign Agents to Departments & Multi-Channel Assignment
  log('Assigning @DevLead to #engineering');
  await api(`/api/channels/${engChanId}/members`, {
    method: 'POST',
    body: JSON.stringify({ agentId: devLeadId }),
  });

  log('Assigning @Marketer to #marketing');
  await api(`/api/channels/${mktChanId}/members`, {
    method: 'POST',
    body: JSON.stringify({ agentId: marketerId }),
  });

  log('Assigning @DevLead to #marketing (Multi-department assignment!)');
  await api(`/api/channels/${mktChanId}/members`, {
    method: 'POST',
    body: JSON.stringify({ agentId: devLeadId }),
  });

  // Verify rosters
  const engMembers = await api(`/api/channels/${engChanId}/members`);
  const mktMembers = await api(`/api/channels/${mktChanId}/members`);
  log('Engineering roster:', engMembers.data);
  log('Marketing roster:', mktMembers.data);

  // 7. Memory Hierarchy Verification
  log('Storing Tier 1: Project Decision Memory');
  const tier1Res = await api('/api/memories', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      scope: 'project',
      scopeId: projectId,
      key: 'Primary_Language_Standard',
      value: 'Python 3.12 with strict type hinting and PEP 8 formatting.',
      type: 'decision',
    }),
  });
  log('Tier 1 Memory result:', tier1Res.data);

  log('Storing Tier 2: Channel Working Memory in #engineering');
  const tier2Res = await api('/api/memories', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      channelId: engChanId,
      scope: 'channel',
      scopeId: engChanId,
      key: 'Sprint_Objective',
      value: 'Develop and verify core calculation engine with automated validation.',
      type: 'working_state',
    }),
  });
  log('Tier 2 Memory result:', tier2Res.data);

  log('Storing Tier 3: Agent-Private Memory for @DevLead');
  const tier3Res = await api('/api/memories', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      agentId: devLeadId,
      scope: 'agent_private',
      scopeId: devLeadId,
      key: 'Personal_Note',
      value: 'Review algorithm performance benchmarks before final release.',
      type: 'semantic',
    }),
  });
  log('Tier 3 Memory result:', tier3Res.data);

  // 8. Test Live Inference in #engineering with @DevLead: Tool Calling (writeFile)
  log('--- Triggering Live Tool Execution with @DevLead in #engineering ---');
  const filePrompt = '@DevLead please create a python script named math_engine.py with a function add(a, b) that returns a + b and subtract(a, b) that returns a - b using the writeFile tool.';
  const sendPromptRes = await api(`/api/channels/${engChanId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: 'user-operator',
      senderType: 'human',
      content: filePrompt,
    }),
  });
  log('Send message response:', sendPromptRes.data);

  log('Waiting for @DevLead to execute tool and reply...');
  let toolSuccess = false;
  for (let i = 0; i < 20; i++) {
    await sleep(4000);
    const msgsRes = await api(`/api/channels/${engChanId}/messages`);
    const msgs = msgsRes.data?.messages || [];
    const agentMsgs = msgs.filter(m => m.senderId === devLeadId || m.senderType === 'agent');
    log(`Poll ${i+1}: total messages=${msgs.length}, agent messages=${agentMsgs.length}`);
    if (agentMsgs.length > 0) {
      log('Latest agent message:', agentMsgs[agentMsgs.length - 1].content);
      // Check if file was written to disk
      const targetFilePath = path.join(TEST_WORKSPACE, 'math_engine.py');
      if (fs.existsSync(targetFilePath)) {
        log('Found written file on disk! Content:\n' + fs.readFileSync(targetFilePath, 'utf-8'));
        toolSuccess = true;
        break;
      }
    }
  }
  results.toolSuccess = toolSuccess;

  // 9. Multi-Channel Cognitive Expansion Test:
  // In #marketing, ask @DevLead what language standard was decided in the project
  log('--- Querying @DevLead in #marketing about project and cross-channel knowledge ---');
  const crossPrompt = '@DevLead in 1 concise sentence, what is our project Primary_Language_Standard and what was the Sprint_Objective in engineering?';
  const crossRes = await api(`/api/channels/${mktChanId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: 'user-operator',
      senderType: 'human',
      content: crossPrompt,
    }),
  });
  log('Cross-channel message posted:', crossRes.data);

  let crossAnswer = '';
  for (let i = 0; i < 20; i++) {
    await sleep(4000);
    const msgsRes = await api(`/api/channels/${mktChanId}/messages`);
    const msgs = msgsRes.data?.messages || [];
    const agentMsgs = msgs.filter(m => m.senderId === devLeadId || (m.senderType === 'agent' && m.content.toLowerCase().includes('python')));
    if (agentMsgs.length > 0) {
      crossAnswer = agentMsgs[agentMsgs.length - 1].content;
      log('Received cross-channel response from @DevLead:\n' + crossAnswer);
      break;
    }
  }
  results.crossChannelAnswer = crossAnswer;

  // 10. Human-to-Agent Direct Messaging
  log('--- Testing Human-to-Agent Direct Message with @DevLead ---');
  const dmChannelId = `dm-${devLeadId}`;
  const dmRes = await api(`/api/channels/${dmChannelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: 'user-operator',
      senderType: 'human',
      content: 'Hello DevLead, this is a private 1-on-1 direct message. Please reply with the word: CONFIDENTIAL_ACK.',
    }),
  });
  log('Human DM post result:', dmRes.data);

  let dmReply = '';
  for (let i = 0; i < 15; i++) {
    await sleep(3000);
    const msgsRes = await api(`/api/channels/${dmChannelId}/messages`);
    const msgs = msgsRes.data?.messages || [];
    const agentMsgs = msgs.filter(m => m.senderType === 'agent');
    if (agentMsgs.length > 0) {
      dmReply = agentMsgs[agentMsgs.length - 1].content;
      log('Received private DM reply:\n' + dmReply);
      break;
    }
  }
  results.dmReply = dmReply;

  // 11. Agent Spawning / Subagent Hiring via API / Tool
  log('--- Testing Subagent Spawning (@DevLead spawns @JuniorDev) ---');
  const hireSubagentRes = await api('/api/agents', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      displayName: 'JuniorDev',
      role: 'Junior Frontend Developer (Subagent of DevLead)',
      capabilities: ['readFile', 'writeFile'],
      systemPrompt: 'You are @JuniorDev, assisting @DevLead with frontend implementation.',
      model: TARGET_MODEL,
      color: '#10b981',
      parentAgentId: devLeadId,
    }),
  });
  log('Subagent hire response:', hireSubagentRes.data);
  const juniorDevId = hireSubagentRes.data?.agent?.id;
  results.juniorDevId = juniorDevId;

  if (juniorDevId) {
    await api(`/api/channels/${engChanId}/members`, {
      method: 'POST',
      body: JSON.stringify({ agentId: juniorDevId }),
    });
    log('Added @JuniorDev to #engineering');
  }

  // 12. Agent-to-Agent Direct Message
  log('--- Testing Agent-to-Agent Direct Message (@DevLead to @JuniorDev) ---');
  const a2aDmChanId = `dm-${devLeadId}-${juniorDevId}`;
  // Directly simulate agent sending DM message
  const a2aRes = await api(`/api/channels/${a2aDmChanId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: devLeadId,
      senderType: 'agent',
      content: '@JuniorDev Welcome to the team! Please reply with your status.',
    }),
  });
  log('Agent-to-agent DM result:', a2aRes.data);

  let a2aReply = '';
  for (let i = 0; i < 15; i++) {
    await sleep(3000);
    const msgsRes = await api(`/api/channels/${a2aDmChanId}/messages`);
    const msgs = msgsRes.data?.messages || [];
    const juniorMsgs = msgs.filter(m => m.senderId === juniorDevId);
    if (juniorMsgs.length > 0) {
      a2aReply = juniorMsgs[juniorMsgs.length - 1].content;
      log('Received Agent-to-Agent DM reply from @JuniorDev:\n' + a2aReply);
      break;
    }
  }
  results.a2aReply = a2aReply;

  // 13. Mid-Execution Steer Test
  log('--- Testing Mid-Execution Steer on @DevLead ---');
  const longPrompt = '@DevLead Please write a 500-word comprehensive architectural essay on distributed database consensus algorithms.';
  await api(`/api/channels/${engChanId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: 'user-operator',
      senderType: 'human',
      content: longPrompt,
    }),
  });

  // Wait 1.5 seconds so generation begins, then fire steer directive
  await sleep(1500);
  log('Injecting mid-execution steer directive!');
  const steerRes = await api(`/api/channels/${engChanId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: 'user-operator',
      senderType: 'human',
      content: 'STEER: Disregard the essay immediately. Acknowledge this steer and reply strictly with the word: STEER_PIVOT_SUCCESS.',
      isSteer: true,
    }),
  });
  log('Steer injection result:', steerRes.data);

  let steerReply = '';
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const msgsRes = await api(`/api/channels/${engChanId}/messages`);
    const msgs = msgsRes.data?.messages || [];
    const agentMsgs = msgs.filter(m => m.senderId === devLeadId);
    if (agentMsgs.length > 0) {
      const lastMsg = agentMsgs[agentMsgs.length - 1].content;
      if (lastMsg.includes('STEER_PIVOT_SUCCESS') || lastMsg.toLowerCase().includes('pivot') || lastMsg.toLowerCase().includes('steer')) {
        steerReply = lastMsg;
        log('Steer reply captured:\n' + steerReply);
        break;
      }
    }
  }
  results.steerReply = steerReply;

  // 14. Autonomous Scheduling: One-shot Timer & POSIX Cron
  log('--- Testing Autonomous Scheduling ---');
  const timerRes = await api('/api/schedules', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      name: 'OneShotHealthPing',
      intervalSeconds: 3,
      action: 'run_health_check',
    }),
  });
  log('One-shot timer schedule result:', timerRes.data);
  results.timerScheduleId = timerRes.data?.schedule?.id;

  const cronRes = await api(`/api/projects/${projectId}/routines`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'MiddaySecurityAudit',
      cronExpression: '*/5 * * * *',
      prompt: 'Perform 5-minute health check sweep.',
    }),
  });
  log('POSIX cron routine result:', cronRes.data);
  results.cronRoutineId = cronRes.data?.routine?.id;

  // 15. Shell Execution in Test Workspace
  log('--- Testing Workspace Shell Execution ---');
  const termRes = await api('/api/terminal/exec', {
    method: 'POST',
    body: JSON.stringify({
      command: 'python --version',
      projectId,
    }),
  });
  log('Terminal execution result:', termRes.data);
  results.terminalOutput = termRes.data;

  // Summary
  log('====================================================');
  log('INVESTIGATION EXECUTION COMPLETED');
  log('Results summary:', results);
  log('====================================================');

  fs.writeFileSync('manual_test_results.json', JSON.stringify(results, null, 2));
}

runInvestigation().catch((err) => {
  console.error('[FATAL ERROR IN INVESTIGATION]', err);
  process.exit(1);
});
