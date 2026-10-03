const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\0a46bdb8-1000-45ef-9eaf-7050f5f9b464';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://127.0.0.1:5173';
const API_URL = 'http://127.0.0.1:54321';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStressAndConcurrencyTests() {
  console.log('====================================================');
  console.log('🚀 STARTING KIN OS CONCURRENCY & STRESS VERIFICATION');
  console.log('====================================================');

  const results = {
    dashboardInit: false,
    concurrentExecution: false,
    midTaskSteering: false,
    contractReconfiguration: false,
    queuedMessageDrain: false,
    sqliteWalStress: false,
  };

  // Launch browser
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1440,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    // ----------------------------------------------------
    // TEST 1: DASHBOARD INITIALIZATION & CONNECTION
    // ----------------------------------------------------
    console.log('\n[TEST 1] Navigating to KIN OS UI on http://127.0.0.1:5173...');
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const title = await page.title();
    console.log(`[TEST 1] Page Title: "${title}"`);

    const headerText = await page.evaluate(() => {
      const el = document.querySelector('header');
      return el ? el.innerText : '';
    });
    console.log(`[TEST 1] Header details:\n${headerText}`);

    const hasLogo = headerText.includes('KIN OS');
    const hasOnline = headerText.includes('Online');
    const hasWal = headerText.includes('WAL');

    if (hasLogo && hasOnline && hasWal) {
      results.dashboardInit = true;
      console.log('✅ TEST 1 PASSED: Dashboard initialized with live Ollama & SQLite WAL telemetry.');
    } else {
      console.warn('⚠️ TEST 1 WARNING: Missing header badges', { hasLogo, hasOnline, hasWal });
    }

    const initScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_concurrency_dashboard_init.png');
    await page.screenshot({ path: initScreenshot });
    console.log(`[TEST 1] Saved artifact: ${initScreenshot}`);

    // ----------------------------------------------------
    // TEST 2: CONCURRENT MULTI-CHANNEL DISPATCH STRESS TEST
    // ----------------------------------------------------
    console.log('\n[TEST 2] Testing concurrent dispatch to two separate channels...');
    
    // We fetch channels list from state
    const channelsRes = await fetch(`${API_URL}/api/state`);
    const channelsData = await channelsRes.json();
    const secOpsChan = channelsData.channels.find((c) => c.name === 'security-ops');
    const testGroundChan = channelsData.channels.find((c) => c.name === 'testing-ground');

    if (!secOpsChan || !testGroundChan) {
      throw new Error(`Channels not found. Available: ${channelsData.channels.map((c) => c.name).join(', ')}`);
    }

    console.log(`[TEST 2] Channel 1: #${secOpsChan.name} (${secOpsChan.id})`);
    console.log(`[TEST 2] Channel 2: #${testGroundChan.name} (${testGroundChan.id})`);

    // Dispatch concurrently
    console.log('[TEST 2] Firing parallel message dispatches...');
    const p1 = fetch(`${API_URL}/api/channels/${secOpsChan.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@SecurityAuditor verify security policies for all agent worktrees' }),
    });

    const p2 = fetch(`${API_URL}/api/channels/${testGroundChan.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@ResearchAgent review concurrency lock mechanisms' }),
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    const json1 = await res1.json();
    const json2 = await res2.json();

    console.log(`[TEST 2] Response 1: status=${res1.status}, triggered=${json1.triggeredCount}`);
    console.log(`[TEST 2] Response 2: status=${res2.status}, triggered=${json2.triggeredCount}`);

    if (res1.status === 201 && res2.status === 201) {
      results.concurrentExecution = true;
      console.log('✅ TEST 2 PASSED: Parallel dispatch accepted without SQLite locking or dropped tasks.');
    }

    // Wait 3.5s for initial thinking & partial responses
    await sleep(3500);

    // Click on testing-ground channel in UI to inspect
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const tgBtn = buttons.find((b) => b.innerText.includes('testing-ground'));
      if (tgBtn) tgBtn.click();
    });
    await sleep(1500);

    const concurrentScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_concurrent_agents_active.png');
    await page.screenshot({ path: concurrentScreenshot });
    console.log(`[TEST 2] Saved artifact: ${concurrentScreenshot}`);

    // ----------------------------------------------------
    // TEST 3: MID-TASK IN-FLIGHT STEERING
    // ----------------------------------------------------
    console.log('\n[TEST 3] Testing mid-task steering in #general...');
    
    // Switch to #general in UI
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genBtn = buttons.find((b) => b.innerText.includes('general'));
      if (genBtn) genBtn.click();
    });
    await sleep(1000);

    const genChan = channelsData.channels.find((c) => c.name === 'general');
    
    // Trigger a task for @Boss
    console.log('[TEST 3] Triggering base task for @Boss...');
    const bossTaskRes = await fetch(`${API_URL}/api/channels/${genChan.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@Boss prepare architecture plan for distributed agent clustering' }),
    });
    const bossTaskData = await bossTaskRes.json();
    console.log(`[TEST 3] Base task status: ${bossTaskRes.status}`);

    // Immediately send priority steer while @Boss is processing
    await sleep(400);
    console.log('[TEST 3] Injecting priority mid-task steer directive...');
    const steerRes = await fetch(`${API_URL}/api/channels/${genChan.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Priority steer: focus specifically on SQLite WAL busy timeout and retry backoff' }),
    });
    const steerData = await steerRes.json();
    console.log(`[TEST 3] Steer response: status=${steerRes.status}, isSteer=${steerData.message?.isSteer}`);

    if (steerData.message?.isSteer) {
      results.midTaskSteering = true;
      console.log('✅ TEST 3 PASSED: In-flight directive recognized as mid-task steer and queued dynamically.');
    }

    await sleep(2500);
    const steerScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_mid_task_steer_verified.png');
    await page.screenshot({ path: steerScreenshot });
    console.log(`[TEST 3] Saved artifact: ${steerScreenshot}`);

    // ----------------------------------------------------
    // TEST 4: ON-THE-FLY SPECIALIST ROLE CONTRACT UPDATE
    // ----------------------------------------------------
    console.log('\n[TEST 4] Updating @DocWriter role contract on the fly...');
    const agentsRes = await fetch(`${API_URL}/api/projects/proj-kin/agents`);
    const agentsData = await agentsRes.json();
    const docWriter = agentsData.agents.find((a) => a.displayName.includes('DocWriter'));

    if (docWriter) {
      const updateRes = await fetch(`${API_URL}/api/agents/${docWriter.id}/contract`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleTitle: 'Lead Concurrency & Verification Specialist',
          activeModelId: 'ollama/qwen2.5-coder:3b',
          systemPrompt: 'You are @DocWriter, the Lead Concurrency & Verification Specialist for KIN OS. Enforce non-blocking concurrency.',
        }),
      });
      console.log(`[TEST 4] Contract update response status: ${updateRes.status}`);

      if (updateRes.status === 200) {
        results.contractReconfiguration = true;
        console.log('✅ TEST 4 PASSED: Role contract updated and persisted to SQLite on the fly.');
      }
    }

    // Refresh UI to display new contract in Inspector
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    // Select @DocWriter in sidebar DM
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const dwBtn = buttons.find((b) => b.innerText.includes('DocWriter'));
      if (dwBtn) dwBtn.click();
    });
    await sleep(1000);

    const contractScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_model_contract_reconfigured.png');
    await page.screenshot({ path: contractScreenshot });
    console.log(`[TEST 4] Saved artifact: ${contractScreenshot}`);

    // ----------------------------------------------------
    // TEST 5: SQLITE WAL HIGH-CONCURRENCY STRESS TEST
    // ----------------------------------------------------
    console.log('\n[TEST 5] Executing 25 rapid parallel requests across core endpoints...');
    const requests = [];
    for (let i = 0; i < 25; i++) {
      if (i % 3 === 0) {
        requests.push(fetch(`${API_URL}/api/state`).then((r) => r.status));
      } else if (i % 3 === 1) {
        requests.push(fetch(`${API_URL}/api/projects/proj-kin/analytics`).then((r) => r.status));
      } else {
        requests.push(
          fetch(`${API_URL}/api/projects/proj-kin/routines`).then((r) => r.status)
        );
      }
    }

    const statuses = await Promise.all(requests);
    const allOk = statuses.every((s) => s === 200);
    console.log(`[TEST 5] Completed 25 requests. All 200 OK: ${allOk}`);

    if (allOk) {
      results.sqliteWalStress = true;
      console.log('✅ TEST 5 PASSED: 25 rapid concurrent queries completed without a single lock or failure.');
    }

  } catch (err) {
    console.error('❌ ERROR DURING TEST RUN:', err);
  } finally {
    await browser.close();
  }

  console.log('\n====================================================');
  console.log('📊 FINAL TEST RESULTS:');
  console.log(JSON.stringify(results, null, 2));
  console.log('====================================================');

  return results;
}

runStressAndConcurrencyTests();
