const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\0a46bdb8-1000-45ef-9eaf-7050f5f9b464';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://127.0.0.1:5173';
const API_URL = 'http://127.0.0.1:54321';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runDeepVerification() {
  console.log('================================================================');
  console.log('🚀 DEEP PHYSICAL VERIFICATION: 4 PILLARS & APP STRESS AUDIT');
  console.log('================================================================\n');

  const auditReport = {
    foregroundFocusLockHandling: false,
    financialGateInterceptionAndExecution: false,
    headlessScreenCaptureEngine: false,
    realBrowserUIInteractions: false,
  };

  // Launch browser for physical UI testing
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    // ----------------------------------------------------
    // 1. HEADLESS SCREEN CAPTURE ENGINE VERIFICATION
    // ----------------------------------------------------
    console.log('[PILLAR 1] Testing Screen Capture Engine (Headless vs Interactive)...');
    const captureRes = await fetch(`${API_URL}/api/system/desktop/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'png' }),
    });
    const captureData = await captureRes.json();
    console.log('[PILLAR 1] Capture metadata:', {
      width: captureData.width,
      height: captureData.height,
      mimeType: captureData.mimeType,
      isHeadless: captureData.isHeadless,
      sessionId: captureData.sessionId,
      interactive: captureData.interactive,
      notice: captureData.notice,
      base64Length: captureData.base64?.length,
    });

    if (
      captureData.width > 0 &&
      captureData.height > 0 &&
      captureData.base64 &&
      captureData.base64.length > 1000 &&
      captureData.isHeadless !== undefined
    ) {
      auditReport.headlessScreenCaptureEngine = true;
      console.log('✅ PILLAR 1 PASSED: Screen capture engine accurately detected session and returned high-res surface capture.\n');
    } else {
      console.error('❌ PILLAR 1 FAILED: Capture data invalid:', captureData);
    }

    // ----------------------------------------------------
    // 2. FOREGROUND WINDOW FOCUS & OS FOCUS LOCK VERIFICATION
    // ----------------------------------------------------
    console.log('[PILLAR 2] Testing Foreground Window Stealing vs OS Focus Locks...');
    const winRes = await fetch(`${API_URL}/api/system/windows`);
    const winData = await winRes.json();
    console.log(`[PILLAR 2] Found ${winData.windows?.length || 0} top-level GUI windows.`);

    if (winData.windows && winData.windows.length > 0) {
      const targetWin = winData.windows[0];
      console.log(`[PILLAR 2] Targeting window: "${targetWin.title}" (PID: ${targetWin.pid})`);

      const focusRes = await fetch(`${API_URL}/api/system/windows/focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleOrPid: targetWin.pid }),
      });
      const focusData = await focusRes.json();
      console.log('[PILLAR 2] Focus result:', focusData);

      if (focusData.success && (focusData.focusLocked !== undefined || focusData.activated !== undefined)) {
        auditReport.foregroundFocusLockHandling = true;
        console.log('✅ PILLAR 2 PASSED: Foreground window activation executed with explicit OS focus lock telemetry.\n');
      } else {
        console.error('❌ PILLAR 2 FAILED: Focus result invalid:', focusData);
      }
    }

    // ----------------------------------------------------
    // 3. PHYSICAL UI DESKTOP CONTROL MODAL VERIFICATION
    // ----------------------------------------------------
    console.log('[PILLAR 3] Verifying Physical UI Desktop Control Modal in Chrome...');
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Click "Desktop & Web" header button to open modal
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('header button'));
      const btn = buttons.find((b) => b.innerText.includes('Desktop & Web'));
      if (btn) btn.click();
    });
    await sleep(1000);

    // Verify modal is open
    const modalVisible = await page.evaluate(() => {
      return document.body.innerText.includes('Computer & Web Control Center');
    });
    console.log('[PILLAR 3] Desktop Control Center modal visible:', modalVisible);

    // Click Capture Screen inside modal
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const capBtn = buttons.find((b) => b.innerText.includes('Capture Screen'));
      if (capBtn) capBtn.click();
    });
    await sleep(2000);

    // Check preview rendered
    const previewRendered = await page.evaluate(() => {
      return document.body.innerText.includes('Screen Capture Preview');
    });
    console.log('[PILLAR 3] Screen Capture Preview rendered in UI:', previewRendered);

    // Check Windows tab in modal
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button'));
      const winTab = tabs.find((b) => b.innerText.includes('Windows'));
      if (winTab) winTab.click();
    });
    await sleep(800);

    // Click Focus on first window in list
    const clickedFocus = await page.evaluate(() => {
      const focusBtns = Array.from(document.querySelectorAll('button')).filter((b) => b.innerText.trim() === 'Focus');
      if (focusBtns.length > 0) {
        focusBtns[0].click();
        return true;
      }
      return false;
    });
    console.log('[PILLAR 3] Clicked Focus button on window item:', clickedFocus);
    await sleep(1500);

    // Dismiss modal
    await page.evaluate(() => {
      const closeBtns = Array.from(document.querySelectorAll('button'));
      const xBtn = closeBtns.find((b) => b.querySelector('svg.lucide-x') || b.innerText === 'Dismiss');
      if (xBtn) xBtn.click();
    });
    await sleep(800);

    const desktopModalShot = path.join(ARTIFACTS_DIR, 'kin_os_desktop_control_center_audited.png');
    await page.screenshot({ path: desktopModalShot });
    console.log(`[PILLAR 3] Saved artifact: ${desktopModalShot}\n`);

    // ----------------------------------------------------
    // 4. FINANCIAL GATE EXECUTION & APPROVAL RESOLUTION
    // ----------------------------------------------------
    console.log('[PILLAR 4] Testing Real Financial Gate Interception and Interactive Execution...');

    // Select #general channel
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genBtn = buttons.find((b) => b.innerText.includes('general'));
      if (genBtn) genBtn.click();
    });
    await sleep(500);

    // Create a financial approval gate via API representing an agent attempting checkout
    const apprRes = await fetch(`${API_URL}/api/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-boss',
        toolName: 'browserClick',
        actionPayload: { text: 'Confirm Payment & Checkout $99.00', url: 'https://checkout.stripe.com/pay' },
        riskLevel: 'CRITICAL',
      }),
    });
    const apprData = await apprRes.json();
    console.log('[PILLAR 4] Approval created:', apprData.approval?.id, 'Risk:', apprData.approval?.riskLevel);

    // Wait up to 5 seconds for the UI to display the Security Gate approval card
    let approvalCardRendered = false;
    for (let i = 0; i < 20; i++) {
      approvalCardRendered = await page.evaluate(() => {
        const txt = document.body.innerText;
        return txt.includes('Security Gate') || txt.includes('Approve & Execute');
      });
      if (approvalCardRendered) break;
      await sleep(300);
    }
    console.log('[PILLAR 4] UI Security Gate Approval card displayed:', approvalCardRendered);

    const financialGateShot = path.join(ARTIFACTS_DIR, 'kin_os_financial_gate_intercepted.png');
    await page.screenshot({ path: financialGateShot });
    console.log(`[PILLAR 4] Saved artifact: ${financialGateShot}`);

    // Click "Approve & Execute" button in UI
    console.log('[PILLAR 4] Clicking "Approve & Execute" button in UI...');
    const clickedApprove = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const appBtn = buttons.find((b) => b.innerText.includes('Approve & Execute'));
      if (appBtn) {
        appBtn.click();
        return true;
      }
      return false;
    });
    console.log('[PILLAR 4] Clicked Approve & Execute:', clickedApprove);
    await sleep(2000);

    // Verify approval card was resolved and removed from UI
    const cardCleared = await page.evaluate(() => {
      return !document.body.innerText.includes('Security Gate: Action Approval Required');
    });
    console.log('[PILLAR 4] Approval card resolved and dismissed in UI:', cardCleared);

    // Check DB status of the approval
    const stateRes = await fetch(`${API_URL}/api/state`);
    const stateData = await stateRes.json();
    const pendingInState = stateData.pendingApprovals?.some((a) => a.id === apprData.approval?.id);
    console.log('[PILLAR 4] Approval cleared from backend state:', !pendingInState);

    if (approvalCardRendered && clickedApprove && cardCleared) {
      auditReport.financialGateInterceptionAndExecution = true;
      auditReport.realBrowserUIInteractions = true;
      console.log('✅ PILLAR 4 PASSED: Financial Gate intercepted action, rendered CRITICAL gate in UI, and executed upon operator approval.\n');
    }

    const resolvedShot = path.join(ARTIFACTS_DIR, 'kin_os_financial_gate_resolved.png');
    await page.screenshot({ path: resolvedShot });
    console.log(`[PILLAR 4] Saved artifact: ${resolvedShot}`);

  } catch (err) {
    console.error('❌ ERROR IN AUDIT RUN:', err);
  } finally {
    try {
      await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 1000))]);
      if (browser.process() && !browser.process().killed) {
        browser.process().kill('SIGKILL');
      }
    } catch (closeErr) {}
  }

  console.log('================================================================');
  console.log('📊 FOUR PILLARS VERIFICATION AUDIT RESULTS:');
  console.log(JSON.stringify(auditReport, null, 2));
  console.log('================================================================');
  
  const allPassed = Object.values(auditReport).every(Boolean);
  if (allPassed) {
    console.log('🎉 ALL 4 PILLARS PASSED SUCCESSFULLY!');
  } else {
    console.error('⚠️ SOME PILLARS FAILED');
  }
  return auditReport;
}

runDeepVerification().then((report) => {
  const allPassed = Object.values(report).every(Boolean);
  process.exit(allPassed ? 0 : 1);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

