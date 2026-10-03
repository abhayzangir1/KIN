const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://localhost:5173';
const API_URL = 'http://127.0.0.1:54321';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postJson(endpoint, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const url = new URL(endpoint, API_URL);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null });
          } catch {
            resolve({ statusCode: res.statusCode, body });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getJson(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_URL);
    const req = http.request(url, { method: 'GET', timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null });
        } catch {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('================================================================');
  console.log('KIN OS: MASTER ROBUSTNESS, CONCURRENCY & CHROME STRESS TEST');
  console.log('Testing live Core (:54321) & live UI (:5173)');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, desc) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test 1: Core Health & Diagnostics
  // -------------------------------------------------------------
  console.log('\n--- 1. REST API Telemetry & Health Diagnostics ---');
  const healthRes = await getJson('/api/system/health');
  assert(healthRes.statusCode === 200, 'GET /api/system/health returns 200');
  assert(healthRes.body?.status === 'healthy', 'Health status is healthy');
  assert(healthRes.body?.components?.sqlite?.status === 'ok', 'SQLite component status is ok');
  assert(healthRes.body?.components?.ollama?.online === true, 'Ollama is online');

  // -------------------------------------------------------------
  // Test 2: Rapid Concurrent Burst Requests
  // -------------------------------------------------------------
  console.log('\n--- 2. High Concurrency Burst (30 Parallel Requests) ---');
  const burstEndpoints = [
    '/api/state',
    '/api/system/health',
    '/api/system/governor',
    '/api/projects',
    '/api/system/actions',
    '/api/automations',
  ];
  const promises = [];
  for (let i = 0; i < 30; i++) {
    const ep = burstEndpoints[i % burstEndpoints.length];
    promises.push(getJson(ep));
  }
  const results = await Promise.all(promises);
  const all200 = results.every((r) => r.statusCode === 200);
  assert(all200, 'All 30 concurrent burst requests returned HTTP 200 without lock contention');

  // -------------------------------------------------------------
  // Test 3: SSE Connection Stress & Abrupt Disconnects
  // -------------------------------------------------------------
  console.log('\n--- 3. SSE Stream Stress (10 Concurrent Client Connections) ---');
  const sseClients = [];
  for (let i = 0; i < 10; i++) {
    const req = http.request('http://127.0.0.1:54321/api/events', (res) => {
      assert(res.statusCode === 200, `SSE client #${i + 1} connected with HTTP 200`);
    });
    req.end();
    sseClients.push(req);
  }
  await sleep(1000);
  // Abruptly destroy all connections
  sseClients.forEach((c) => c.destroy());
  await sleep(500);
  // Verify server is completely healthy and responsive after client disconnect flood
  const postSseHealth = await getJson('/api/system/health');
  assert(postSseHealth.statusCode === 200, 'Server remains healthy after abrupt SSE disconnect flood');

  // -------------------------------------------------------------
  // Test 4: Compound Slash Command with Leading Slashes Strip
  // -------------------------------------------------------------
  console.log('\n--- 4. Compound Slash Command Execution & Objective Parsing ---');
  const compoundPayload = {
    content: '/plan /boost /teamwork-preview /goal //verify system robustness and zero flaws',
  };
  const compoundRes = await postJson('/api/channels/chan-general/messages', compoundPayload);
  assert([200, 201].includes(compoundRes.statusCode), 'Compound slash command returns HTTP 200 or 201');
  assert(compoundRes.body?.triggeredCount >= 1, 'Compound command dispatched execution directive');

  const t4Start = Date.now() - 500;
  let lastCompound = null;
  for (let i = 0; i < 60; i++) {
    const msgsRes = await getJson('/api/channels/chan-general/messages');
    lastCompound = msgsRes.body?.messages
      ?.slice()
      ?.reverse()
      ?.find(
        (m) =>
          m.senderId === 'agent-boss' &&
          m.createdAt >= t4Start &&
          m.content.includes('Compound Pipeline Engaged') &&
          m.content.includes('verify system robustness and zero flaws')
      );
    if (lastCompound) break;
    await sleep(500);
  }
  assert(!!lastCompound, 'Boss generated master compound response card');
  assert(
    lastCompound?.content.includes('**Target Objective**: **verify system robustness and zero flaws**'),
    'Compound parser cleanly stripped leading slashes from objective'
  );

  // -------------------------------------------------------------
  // Test 5: /btw Ephemeral Side-Query (Zero DAG Pollution)
  // -------------------------------------------------------------
  console.log('\n--- 5. /btw Ephemeral Side-Query Testing ---');
  const preBtwGoals = await getJson('/api/projects/proj-kin/goals');
  const initialTaskCount = preBtwGoals.body?.tasks?.length || 0;

  const t5Start = Date.now() - 500;
  const btwRes = await postJson('/api/channels/chan-general/messages', {
    content: '/btw what is the current SQLite journal mode and RAM threshold?',
  });
  assert([200, 201].includes(btwRes.statusCode), 'POST /btw returns HTTP 200 or 201');

  let btwAnswer = null;
  for (let i = 0; i < 60; i++) {
    const btwMsgsRes = await getJson('/api/channels/chan-general/messages');
    btwAnswer = btwMsgsRes.body?.messages
      ?.slice()
      ?.reverse()
      ?.find(
        (m) =>
          m.createdAt >= t5Start &&
          (m.content.includes('Side Query / BTW') || m.content.includes('WAL mode'))
      );
    if (btwAnswer) break;
    await sleep(500);
  }
  assert(!!btwAnswer, '/btw ephemeral response generated in channel');

  const postBtwGoals = await getJson('/api/projects/proj-kin/goals');
  const finalTaskCount = postBtwGoals.body?.tasks?.length || 0;
  assert(finalTaskCount === initialTaskCount, '/btw did NOT pollute active project tasks or DAG');

  // -------------------------------------------------------------
  // Test 6: Physical Google Chrome Automation via Puppeteer
  // -------------------------------------------------------------
  console.log('\n--- 6. Physical Google Chrome End-to-End Verification ---');
  if (!fs.existsSync(CHROME_PATH)) {
    console.error('Chrome executable not found at', CHROME_PATH);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1600, height: 950 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2500);

    const isHydrated = await page.evaluate(() => typeof window.kinStore !== 'undefined');
    assert(isHydrated, 'React 18 UI loaded and window.kinStore is hydrated');

    // Test input typing and slash command popup visibility
    const inputSelector = 'input[type="text"]';
    await page.waitForSelector(inputSelector);
    await page.click(inputSelector);

    // Type /plan with trailing space
    await page.type(inputSelector, '/plan ');
    await sleep(400);

    // Verify commands overlay remains visible even with space
    const commandsOverlay = await page.evaluate(() => {
      const el = document.querySelector('div.bg-\\[\\#0f172a\\]');
      return !!el;
    });
    assert(commandsOverlay, 'Slash commands overlay renders when space is typed (/plan )');

    // Clear input
    await page.evaluate(() => {
      const inp = document.querySelector('input[type="text"]');
      if (inp) inp.value = '';
    });

    // Test interactive modals: Skills modal
    const skillsBtn = await page.$('button[title*="Skills"]');
    if (skillsBtn) {
      await skillsBtn.click();
      await sleep(600);
      const skillsModalOpen = await page.evaluate(
        () => !!document.body.innerText.includes('Self-Improvement & Skills Engine')
      );
      assert(skillsModalOpen, 'Skills Modal opens on click');
      // Close modal
      const closeBtn = await page.$('button[title*="Close"]');
      if (closeBtn) await closeBtn.click();
      await sleep(300);
    } else {
      console.log('[SKIP] Skills button not found on top bar');
    }

    // Verify zero fatal browser console errors
    const fatalErrors = consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('ERR_CONNECTION_REFUSED'));
    assert(fatalErrors.length === 0, `Browser console free of fatal runtime errors (found ${fatalErrors.length})`);

    console.log('\n================================================================');
    console.log(`STRESS TEST VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');

    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Puppeteer test encountered error:', err);
    await browser.close();
    process.exit(1);
  }
})();
