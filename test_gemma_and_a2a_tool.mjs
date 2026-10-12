import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:54321';
const token = fs.readFileSync('core/.kin/ipc_auth.token', 'utf-8').trim();
const headers = {
  'Authorization': 'Bearer ' + token,
  'Content-Type': 'application/json',
};

const GEMMA_MODEL = 'ollama/gemma4:e2b';
const TEST_WORKSPACE = 'D:\\KIN_TEST_WORKSPACE';

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

async function runGemmaTest() {
  console.log('[GEMMA TEST] Loading state from previous run...');
  const prevResults = JSON.parse(fs.readFileSync('manual_test_results.json', 'utf-8'));
  const { devLeadId, juniorDevId, engChanId, projectId } = prevResults;

  console.log(`[GEMMA TEST] Setting @DevLead (${devLeadId}) model explicitly to ${GEMMA_MODEL}`);
  const updateModelRes = await api(`/api/agents/${devLeadId}/model`, {
    method: 'PATCH',
    body: JSON.stringify({ activeModelId: GEMMA_MODEL }),
  });
  console.log('[GEMMA TEST] Model update result:', updateModelRes.data);

  console.log(`[GEMMA TEST] Setting @JuniorDev (${juniorDevId}) model explicitly to ${GEMMA_MODEL}`);
  await api(`/api/agents/${juniorDevId}/model`, {
    method: 'PATCH',
    body: JSON.stringify({ activeModelId: GEMMA_MODEL }),
  });

  // Verify execution details
  const execDetails = await api(`/api/agents/${devLeadId}/execution-details`);
  console.log('[GEMMA TEST] Verified active model for DevLead:', execDetails.data?.model);

  // 1. Tool execution with Gemma 4
  console.log('\n--- Test 1: Real Tool Execution (writeFile) with Gemma 4:e2b ---');
  const gemmaPrompt = '@DevLead please create a python file named stats_utils.py with a function mean(nums) and variance(nums) using the writeFile tool.';
  const sendRes = await api(`/api/channels/${engChanId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: 'user-operator',
      senderType: 'human',
      content: gemmaPrompt,
    }),
  });
  console.log('[GEMMA TEST] Prompt sent:', sendRes.data);

  let gemmaFileSuccess = false;
  let gemmaReply = '';
  for (let i = 0; i < 25; i++) {
    await sleep(4000);
    const msgsRes = await api(`/api/channels/${engChanId}/messages`);
    const msgs = msgsRes.data?.messages || [];
    const agentMsgs = msgs.filter(m => m.senderId === devLeadId);
    console.log(`[GEMMA TEST] Poll ${i+1}: agent messages=${agentMsgs.length}`);
    if (agentMsgs.length > 0) {
      gemmaReply = agentMsgs[agentMsgs.length - 1].content;
      console.log('[GEMMA TEST] Agent response:', gemmaReply.slice(0, 200));
      const targetFilePath = path.join(TEST_WORKSPACE, 'stats_utils.py');
      if (fs.existsSync(targetFilePath)) {
        console.log('[GEMMA TEST] SUCCESS: stats_utils.py written to disk by Gemma!');
        console.log('[GEMMA TEST] File content:\n' + fs.readFileSync(targetFilePath, 'utf-8'));
        gemmaFileSuccess = true;
        break;
      }
    }
  }

  // 2. Real Agent-to-Agent DM via the sendDirectMessage tool
  console.log('\n--- Test 2: Agent-to-Agent DM via sendDirectMessage tool ---');
  const a2aToolPrompt = '@DevLead please send a direct message to @JuniorDev using the sendDirectMessage tool saying: "JuniorDev please acknowledge this direct message with ACK_JUNIOR_RECEIVED"';
  const a2aSendRes = await api(`/api/channels/${engChanId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderId: 'user-operator',
      senderType: 'human',
      content: a2aToolPrompt,
    }),
  });
  console.log('[GEMMA TEST] A2A delegation prompt sent:', a2aSendRes.data);

  let a2aSuccess = false;
  let dmChannelId = '';
  for (let i = 0; i < 25; i++) {
    await sleep(4000);
    // Find any DM channel between DevLead and JuniorDev
    const stateRes = await api('/api/state');
    const dmChans = (stateRes.data?.channels || []).filter(c => c.name?.includes('DM:') || c.id?.includes('dm-'));
    console.log(`[GEMMA TEST] Poll ${i+1}: found ${dmChans.length} DM channels`);
    const targetDm = dmChans.find(c => c.id.includes(devLeadId) && c.id.includes(juniorDevId));
    if (targetDm) {
      dmChannelId = targetDm.id;
      console.log('[GEMMA TEST] Found A2A DM channel:', dmChannelId);
      const dmMessagesRes = await api(`/api/channels/${dmChannelId}/messages`);
      const dmMessages = dmMessagesRes.data?.messages || [];
      console.log(`[GEMMA TEST] DM channel message count: ${dmMessages.length}`);
      for (const m of dmMessages) {
        console.log(`  [${m.senderId} (${m.senderType})]: ${m.content.slice(0, 150)}`);
      }
      const juniorReply = dmMessages.find(m => m.senderId === juniorDevId);
      if (juniorReply) {
        console.log('[GEMMA TEST] SUCCESS: JuniorDev replied to DevLead in DM:\n', juniorReply.content);
        a2aSuccess = true;
        break;
      }
    }
  }

  const finalResults = {
    ...prevResults,
    gemmaFileSuccess,
    gemmaReply,
    a2aSuccess,
    dmChannelId,
  };
  fs.writeFileSync('manual_test_results_gemma.json', JSON.stringify(finalResults, null, 2));
  console.log('\n[GEMMA TEST] COMPLETED. Final summary:\n', JSON.stringify(finalResults, null, 2));
}

runGemmaTest().catch((err) => {
  console.error('[GEMMA TEST ERROR]', err);
  process.exit(1);
});
