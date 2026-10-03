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

async function runUnifiedMachineControlVerification() {
  console.log('================================================================');
  console.log('🖥️ KIN OS UNIFIED MACHINE CONTROL & LIVE INDICATOR VERIFICATION');
  console.log('================================================================\n');

  const results = {
    browserSessionLaunched: false,
    headerBarIndicatorActive: false,
    centerViewIndicatorActive: false,
    inspectSessionModalOpened: false,
    browserSessionCleanedUp: false,
    unifiedToolGatewayPassing: false,
  };

  // Step 1: Direct ToolGateway Unified Capability Verification
  console.log('[STEP 1] Testing ToolGateway Unified Routing (computer, application, browser)...');
  try {
    const { ToolGateway } = await import('./core/dist/execution/tool_gateway.js');
    const gateway = new ToolGateway();
    const ctx = {
      runId: 'test-run-unified',
      agentId: 'agent-boss',
      worktreeRoot: 'd:\\KIN',
      autonomyMode: 'FULL_ACCESS',
      allowedCapabilities: ['computer', 'application', 'browser'],
    };

    // 1a. Computer action screenshot (read-only, LOW risk)
    const compRes = await gateway.executeTool('computer', { action: 'screenshot' }, ctx);
    console.log('  -> computer action screenshot success:', compRes.success, 'riskLevel:', compRes.riskLevel);
    if (!compRes.success || compRes.riskLevel !== 'LOW') {
      throw new Error(`Computer screenshot failed or risk incorrect: ${compRes.error}`);
    }

    // 1b. Application action list (read-only, LOW risk)
    const appRes = await gateway.executeTool('application', { action: 'list' }, ctx);
    console.log('  -> application action list apps count:', Array.isArray(appRes.output) ? appRes.output.length : 0, 'riskLevel:', appRes.riskLevel);
    if (!appRes.success || appRes.riskLevel !== 'LOW') {
      throw new Error(`Application list failed: ${appRes.error}`);
    }

    // 1c. Browser action status (read-only, LOW risk)
    const brRes = await gateway.executeTool('browser', { action: 'status' }, ctx);
    console.log('  -> browser action status success:', brRes.success, 'riskLevel:', brRes.riskLevel);
    if (!brRes.success || brRes.riskLevel !== 'LOW') {
      throw new Error(`Browser status failed: ${brRes.error}`);
    }

    results.unifiedToolGatewayPassing = true;
    console.log('  ✅ ToolGateway unified routing & risk classification passed!\n');
  } catch (err) {
    console.error('  ❌ ToolGateway verification failed:', err.message);
  }

  // Step 2: Launch Real Browser Session via Daemon API
  console.log('[STEP 2] Launching persistent browser session via /api/browser/navigate...');
  try {
    const navRes = await fetch(`${API_URL}/api/browser/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'about:blank' }),
    });
    const navData = await navRes.json();
    console.log('  -> Navigation response:', navData);

    const statusRes = await fetch(`${API_URL}/api/browser/status`);
    const statusData = await statusRes.json();
    console.log('  -> Browser status:', statusData);
    if (statusData.active) {
      results.browserSessionLaunched = true;
      console.log('  ✅ Persistent browser session active!\n');
    }
  } catch (err) {
    console.error('  ❌ Failed to launch browser session:', err.message);
  }

  // Step 3: Launch Google Chrome and Inspect the Real App UI
  console.log('[STEP 3] Launching Google Chrome to inspect live machine control indicators...');
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
    console.log('  -> Navigating Chrome to http://127.0.0.1:5173...');
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Verify HeaderBar Glowing Badge
    const headerIndicator = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('header *')).find((node) =>
        node.textContent && node.textContent.includes('Controlling Local Machine')
      );
      return el ? el.textContent.trim() : null;
    });

    console.log('  -> HeaderBar Indicator Text:', headerIndicator);
    if (headerIndicator && headerIndicator.includes('Controlling Local Machine')) {
      results.headerBarIndicatorActive = true;
      console.log('  ✅ HeaderBar live glowing indicator verified!');
    }

    // Verify CenterView Indicator
    const centerIndicator = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('main *')).find((node) =>
        node.textContent && node.textContent.includes('Controlling Local Machine')
      );
      return el ? el.textContent.trim() : null;
    });

    console.log('  -> CenterView Indicator Text:', centerIndicator);
    if (centerIndicator && centerIndicator.includes('Controlling Local Machine')) {
      results.centerViewIndicatorActive = true;
      console.log('  ✅ CenterView machine control banner verified!');
    }

    // Capture screenshot of the live indicators
    const shotPath1 = path.join(ARTIFACTS_DIR, 'kin_os_machine_control_indicator_active.png');
    await page.screenshot({ path: shotPath1 });
    console.log(`  📸 Saved screenshot: ${shotPath1}\n`);

    // Step 4: Click [Inspect Session] and Verify DesktopControlModal
    console.log('[STEP 4] Clicking [Inspect Session] button in CenterView...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const inspectBtn = buttons.find((b) => b.innerText.includes('Inspect Session') || b.innerText.includes('Inspect'));
      if (inspectBtn) inspectBtn.click();
    });
    await sleep(1500);

    // Verify DesktopControlModal is open and inspect tab
    const modalTitle = await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('div, h2, h3')).find((node) =>
        node.textContent && (node.textContent.includes('Desktop GUI & System Control') || node.textContent.includes('Desktop & Web'))
      );
      return modal ? modal.textContent.slice(0, 100).trim() : null;
    });

    console.log('  -> Modal Title / Content:', modalTitle);
    if (modalTitle) {
      results.inspectSessionModalOpened = true;
      console.log('  ✅ DesktopControlModal opened successfully via Inspect trigger!');
    }

    const shotPath2 = path.join(ARTIFACTS_DIR, 'kin_os_machine_control_inspect_modal.png');
    await page.screenshot({ path: shotPath2 });
    console.log(`  📸 Saved screenshot: ${shotPath2}\n`);

    // Step 5: Close Desktop Control Modal in Chrome
    console.log('[STEP 5] Closing Desktop Control Modal in UI...');
    await page.evaluate(() => {
      const closeButtons = Array.from(document.querySelectorAll('button'));
      const closeBtn = closeButtons.find((b) => b.title && b.title.includes('Close') || b.querySelector('svg.lucide-x'));
      if (closeBtn) closeBtn.click();
    });
    await sleep(1000);

    // Step 6: Close Browser Session via API and Verify Badge Clears
    console.log('[STEP 6] Closing browser session via /api/browser/close and verifying indicator auto-clears...');
    await fetch(`${API_URL}/api/browser/close`, { method: 'POST' });
    await sleep(2000);

    const clearedCheck = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('header *')).find((node) =>
        node.textContent && node.textContent.includes('Controlling Local Machine')
      );
      return !!el;
    });

    console.log('  -> Machine control indicator still present in header?', clearedCheck);
    if (!clearedCheck) {
      results.browserSessionCleanedUp = true;
      console.log('  ✅ Indicator cleanly cleared once browser session closed!');
    }

    const shotPath3 = path.join(ARTIFACTS_DIR, 'kin_os_machine_control_session_closed.png');
    await page.screenshot({ path: shotPath3 });
    console.log(`  📸 Saved screenshot: ${shotPath3}\n`);

  } finally {
    await browser.close();
  }

  // Summary
  console.log('================================================================');
  console.log('📊 UNIFIED MACHINE CONTROL & INDICATOR VERIFICATION RESULTS:');
  console.log('================================================================');
  console.log(`  1. ToolGateway Unified Routing:    ${results.unifiedToolGatewayPassing ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  2. Browser Session Launch:         ${results.browserSessionLaunched ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  3. HeaderBar Glowing Indicator:    ${results.headerBarIndicatorActive ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  4. CenterView Live Control Banner: ${results.centerViewIndicatorActive ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  5. Inspect Session Modal Trigger:  ${results.inspectSessionModalOpened ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  6. Auto-Cleanup On Session Close:  ${results.browserSessionCleanedUp ? 'PASS ✅' : 'FAIL ❌'}`);

  const allPassed = Object.values(results).every(Boolean);
  console.log(`\nOverall Verdict: ${allPassed ? 'ALL TESTS PASSED (100%)' : 'SOME TESTS FAILED'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runUnifiedMachineControlVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
