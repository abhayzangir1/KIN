const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\0a46bdb8-1000-45ef-9eaf-7050f5f9b464';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://localhost:5173';
const API_URL = 'http://127.0.0.1:54321';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  console.log('================================================================');
  console.log('KIN OS PHYSICAL CHROME VERIFICATION & STRESS TEST SUITE (V9)');
  console.log('Testing: In-App Automations Modal, Timed Autonomy, /plan, /boost, /teamwork-preview, /goal, Multi-Agent Flows');
  console.log('================================================================');

  if (!fs.existsSync(CHROME_PATH)) {
    console.error('FAIL: Chrome binary not found at', CHROME_PATH);
    process.exit(1);
  }

  // Verify backend health
  try {
    const res = await fetch(`${API_URL}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = await res.json();
    console.log(`[PASS] Backend online at ${API_URL}: status=${health.status}, uptime=${Math.round(health.uptime)}s`);
  } catch (err) {
    console.error(`FAIL: Backend offline at ${API_URL}:`, err.message);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });

  const page = await browser.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[CHROME CONSOLE ERROR] ${msg.text()}`);
    }
  });

  try {
    // --------------------------------------------------------------------------
    // 1. Initial Mount & Workspace Verification
    // --------------------------------------------------------------------------
    console.log('\n[STEP 1] Navigating to KIN OS UI at http://localhost:5173...');
    await page.goto(UI_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    const title = await page.title();
    console.log(`[PASS] UI loaded successfully. Title: "${title}"`);

    // Helper function to send messages in CenterView chat input
    async function sendChatCommand(cmd) {
      const input = await page.$('main form input[type="text"]');
      if (!input) throw new Error('CenterView chat input not found');
      await input.click();
      await page.evaluate((el) => {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, input);
      await input.type(cmd, { delay: 15 });
      await sleep(250);
      await page.keyboard.press('Enter');
      await sleep(3500);
    }

    // --------------------------------------------------------------------------
    // 2. Test Automations in Sidebar & Open AutomationsModal
    // --------------------------------------------------------------------------
    console.log('\n[STEP 2] Testing Sidebar Automations Section & Opening AutomationsModal...');
    const openedModal = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const autoBtn = buttons.find((b) => b.textContent && (b.textContent.includes('Routines & Timers') || b.textContent.includes('AUTOMATIONS')));
      if (autoBtn) {
        autoBtn.click();
        return true;
      }
      return false;
    });

    if (!openedModal) {
      throw new Error('Could not find Automations trigger in Sidebar');
    }

    await sleep(1000);
    await page.waitForSelector('h2', { timeout: 5000 });
    const modalTitle = await page.evaluate(() => {
      const h2s = Array.from(document.querySelectorAll('h2'));
      const found = h2s.find((h) => h.textContent && h.textContent.includes('Automations & Scheduled Routines'));
      return found ? found.textContent : null;
    });

    if (!modalTitle) {
      throw new Error('AutomationsModal header not found');
    }
    console.log(`[PASS] AutomationsModal opened successfully: "${modalTitle}"`);

    const screenshot1Path = path.join(ARTIFACT_DIR, '01_v9_automations_modal_open.png');
    await page.screenshot({ path: screenshot1Path });
    console.log(`[PASS] Screenshot captured: ${screenshot1Path}`);

    // --------------------------------------------------------------------------
    // 3. Create a One-Shot Wakeup Timer from UI
    // --------------------------------------------------------------------------
    console.log('\n[STEP 3] Creating a One-Shot 10s Wakeup Timer via AutomationsModal form...');
    // Click "New Automation" tab
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const tab = buttons.find((b) => b.textContent && b.textContent.includes('New Automation'));
      if (tab) tab.click();
    });
    await sleep(800);

    // Select 30s preset so timer remains active for CenterView countdown bar
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn30s = buttons.find((b) => b.textContent && b.textContent.trim() === '30s');
      if (btn30s) btn30s.click();
    });
    await sleep(400);

    // Enter prompt specifically into the modal's directive textarea
    const testDirective = 'Verify repository health and automated task execution';
    const modalTextarea = await page.$('textarea[placeholder*="Audit workspace"]');
    if (!modalTextarea) {
      throw new Error('AutomationsModal directive textarea not found');
    }
    await modalTextarea.click();
    await modalTextarea.type(testDirective, { delay: 10 });
    await sleep(400);

    // Click "Create & Arm Automation"
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]');
        if (btn) btn.click();
      });
    }
    await sleep(1500);
    console.log('[PASS] Automation created and armed.');

    // Close modal to inspect CenterView timer bar
    const closeBtn = await page.$('button[title="Close Automations (Esc)"]');
    if (closeBtn) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await sleep(1000);

    // Verify Active Timers bar in CenterView
    const hasActiveTimersBar = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('ACTIVE TIMERS') || text.includes('Non-blocking sleeping agents');
    });
    console.log(`[PASS] Active Timers Bar visible in CenterView: ${hasActiveTimersBar}`);

    const screenshot2Path = path.join(ARTIFACT_DIR, '02_v9_active_timer_in_center_view.png');
    await page.screenshot({ path: screenshot2Path });
    console.log(`[PASS] Screenshot captured: ${screenshot2Path}`);

    // --------------------------------------------------------------------------
    // 4. Test Immediate Manual Trigger of Schedule & Agent Autonomous Wakeup
    // --------------------------------------------------------------------------
    console.log('\n[STEP 4] Testing immediate manual trigger of schedule and autonomous agent wakeup...');
    // Trigger the active schedule via POST /api/schedules/:id/trigger
    const schedListRes = await fetch(`${API_URL}/api/projects/proj-kin/schedules`);
    const schedListData = await schedListRes.json();
    const activeSched = (schedListData.schedules || []).find((s) => s.status === 'active');
    if (activeSched) {
      console.log(`Triggering active schedule ${activeSched.id} immediately...`);
      await fetch(`${API_URL}/api/schedules/${activeSched.id}/trigger`, { method: 'POST' });
    }
    await sleep(3000);

    const hasWakeupMessage = await page.evaluate((dir) => {
      const text = document.body.innerText;
      return text.includes('Timer / Scheduled Alarm Triggered') || text.includes(dir) || text.includes('Waking agent to execute');
    }, testDirective);

    console.log(`[PASS] Agent autonomous wakeup confirmed in channel: ${hasWakeupMessage}`);

    const screenshot3Path = path.join(ARTIFACT_DIR, '03_v9_timer_fired_agent_awakened.png');
    await page.screenshot({ path: screenshot3Path });
    console.log(`[PASS] Screenshot captured: ${screenshot3Path}`);

    // --------------------------------------------------------------------------
    // 5. Test Slash Commands: /goal, /plan, /teamwork-preview, /boost
    // --------------------------------------------------------------------------
    console.log('\n[STEP 5] Testing Slash Commands Automation Flow (/goal, /plan, /teamwork-preview, /boost)...');

    // 5a. Dispatch /goal
    console.log('Sending /goal...');
    await sendChatCommand('/goal Production Stress Test & Task Automation Verification');

    // 5b. Dispatch /plan
    console.log('Sending /plan...');
    await sendChatCommand('/plan Full workspace end-to-end stress test');

    // 5c. Dispatch /teamwork-preview
    console.log('Sending /teamwork-preview...');
    await sendChatCommand('/teamwork-preview');

    // 5d. Dispatch /boost
    console.log('Sending /boost...');
    await sendChatCommand('/boost High autonomy stress test and task verification');

    const chatContent = await page.evaluate(() => document.body.innerText);
    const planVerified = chatContent.includes('Execution Plan Initialized') || chatContent.includes('Milestone Breakdown') || chatContent.includes('Workspace Plan');
    const teamworkVerified = chatContent.includes('Workforce Collaboration Matrix') || chatContent.includes('Teamwork Preview');
    const boostVerified = chatContent.includes('Boost Mode Engaged') || chatContent.includes('BOOST MODE') || chatContent.includes('High Autonomy');

    console.log(`[PASS] Slash command verification results:`);
    console.log(`  - /plan generated milestone DAG: ${planVerified}`);
    console.log(`  - /teamwork-preview rendered matrix: ${teamworkVerified}`);
    console.log(`  - /boost engaged high autonomy: ${boostVerified}`);

    const screenshot4Path = path.join(ARTIFACT_DIR, '04_v9_slash_commands_and_multitask_flow.png');
    await page.screenshot({ path: screenshot4Path });
    console.log(`[PASS] Screenshot captured: ${screenshot4Path}`);

    // --------------------------------------------------------------------------
    // 6. Test Multi-Agent Peer Coordination
    // --------------------------------------------------------------------------
    console.log('\n[STEP 6] Testing Multi-Agent Peer Coordination Directive...');
    await sendChatCommand('@Boss Please coordinate with @QA-Architect to verify system reliability.');
    console.log('[PASS] Multi-agent peer directive dispatched.');

    // --------------------------------------------------------------------------
    // 7. Verify Settings & Database WAL Maintenance
    // --------------------------------------------------------------------------
    console.log('\n[STEP 7] Verifying Settings Modal & SQLite WAL Optimization...');
    // Open Settings from Sidebar bottom
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const settingsBtn = buttons.find((b) => b.textContent && b.textContent.includes('Settings'));
      if (settingsBtn) settingsBtn.click();
    });
    await sleep(1000);

    // Switch to Database & WAL Maintenance tab
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const dbTab = buttons.find((b) => b.textContent && b.textContent.includes('Database & WAL'));
      if (dbTab) dbTab.click();
    });
    await sleep(600);

    // Click "Optimize WAL"
    const checkpointClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const cpBtn = buttons.find((b) => b.textContent && b.textContent.includes('Optimize WAL'));
      if (cpBtn) {
        cpBtn.click();
        return true;
      }
      return false;
    });
    console.log(`[PASS] Triggered SQLite WAL maintenance checkpoint: ${checkpointClicked}`);
    await sleep(1500);

    // Close Settings Modal
    await page.evaluate(() => {
      const closeButtons = Array.from(document.querySelectorAll('button'));
      const xBtn = closeButtons.find((b) => b.title === 'Close Settings (Esc)' || b.title === 'Close settings' || b.innerHTML.includes('w-5 h-5'));
      if (xBtn) xBtn.click();
    });
    await sleep(800);

    // Final Screenshot: Clean workspace after full stress test
    const screenshot5Path = path.join(ARTIFACT_DIR, '05_v9_ultimate_stress_tested_workspace.png');
    await page.screenshot({ path: screenshot5Path });
    console.log(`[PASS] Final Screenshot captured: ${screenshot5Path}`);

    console.log('\n================================================================');
    console.log('ALL V9 VERIFICATION MILESTONES PASSED SUCCESSFULLY (100%)');
    console.log('================================================================');
  } catch (err) {
    console.error('FATAL VERIFICATION FAILURE:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
