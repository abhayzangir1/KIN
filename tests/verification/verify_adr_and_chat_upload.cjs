// ============================================================================
// KIN OS: Verification Script for Architecture Decisions (ADR), Chat File Upload,
// and Scheduler Interval Hardening
// Verifies real Google Chrome against live Vite UI (5173), Core Daemon (54321),
// and SQLite WAL Database (kin_storage.sqlite).
// ============================================================================

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://127.0.0.1:5173';
const DAEMON_URL = 'http://127.0.0.1:54321';
const ARTIFACTS_DIR = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\0a46bdb8-1000-45ef-9eaf-7050f5f9b464';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAdrAndUploadVerification() {
  console.log('====================================================================');
  console.log('🚀 STARTING KIN OS ADR, CHAT UPLOAD & SCHEDULER VERIFICATION');
  console.log('====================================================================');

  const testResults = [];
  function recordTest(name, passed, detail) {
    testResults.push({ name, passed, detail });
    const badge = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${badge}] ${name}: ${detail}`);
  }

  // 1. Verify Daemon Health & ADR Endpoint
  let initialDecisions = [];
  try {
    const res = await fetch(`${DAEMON_URL}/api/decisions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    initialDecisions = await res.json();
    recordTest(
      'test1_daemonAdrEndpoint',
      Array.isArray(initialDecisions),
      `Successfully reached GET /api/decisions. Found ${initialDecisions.length} existing decisions.`
    );
  } catch (err) {
    recordTest('test1_daemonAdrEndpoint', false, `Failed to reach /api/decisions: ${err.message}`);
    process.exit(1);
  }

  // 2. Launch Google Chrome
  console.log('Launching Google Chrome at', CHROME_PATH);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[KIN') || text.includes('Error') || text.includes('Decision')) {
      console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${text}`);
    }
  });

  page.on('pageerror', (err) => {
    console.error(`[BROWSER UNCAUGHT ERROR] ${err.message}`);
  });

  try {
    // 3. Navigate to UI
    console.log(`Navigating to ${UI_URL}...`);
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const uiLoaded = await page.evaluate(() => {
      return document.body.innerText.includes('KIN OS') || document.body.innerText.includes('general');
    });
    recordTest('test2_uiInitialLoad', uiLoaded, 'Vite React UI successfully rendered.');

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'adr_01_ui_loaded.png'),
      fullPage: false,
    });

    // 4. Verify Sidebar Architecture Decisions Item
    const sidebarAdrExists = await page.evaluate(() => {
      const el = document.querySelector('button[title*="Architecture Decision Records"]') ||
                 Array.from(document.querySelectorAll('button, div')).find(e => e.innerText && e.innerText.includes('Architecture Decisions'));
      return !!el;
    });
    recordTest('test3_sidebarAdrItem', sidebarAdrExists, 'Architecture Decisions entry found in Sidebar.');

    // 5. Open Decisions Modal via Quick Chip in CenterView
    console.log('Clicking Decisions quick chip...');
    const chipClicked = await page.evaluate(() => {
      const chip = Array.from(document.querySelectorAll('button')).find((b) => b.innerText && b.innerText.includes('/decisions'));
      if (chip) {
        chip.click();
        return true;
      }
      return false;
    });

    await sleep(1000);

    const modalOpen = await page.evaluate(() => {
      return document.body.innerText.includes('Architecture Decision Records') &&
             document.body.innerText.includes('Block 3');
    });
    recordTest('test4_decisionsModalOpen', modalOpen, 'DecisionsModal opened and rendered title.');

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'adr_02_modal_open.png'),
      fullPage: false,
    });

    // 6. Expand Propose ADR Form
    const proposeBtnClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText && b.innerText.includes('Propose ADR'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    recordTest('test5_proposeFormExpand', proposeBtnClicked, 'Clicked Propose ADR button to open drawer.');
    await sleep(600);

    // 7. Fill in the ADR Proposal Form
    const adrTimestamp = Date.now();
    const adrUniqueTitle = `ADR-007: SQLite WAL Concurrency Ledger (${adrTimestamp})`;
    const titleInput = await page.$('input[placeholder*="SQLite WAL mode"]');
    if (titleInput) {
      await titleInput.click();
      await titleInput.type(adrUniqueTitle);
    }

    const textareas = await page.$$('form textarea');
    if (textareas.length >= 2) {
      await textareas[0].click();
      await textareas[0].type('Ensure all parallel autonomous agents write to SQLite with WAL mode and busy timeout to prevent database locks.');

      await textareas[1].click();
      await textareas[1].type('JSON flat file per agent\nIn-memory cache only\nPostgres server');
    }

    const formFilled = !!titleInput && textareas.length >= 2;
    recordTest('test6_adrFormFilled', formFilled, 'Filled in Title, Rationale, and Alternatives in ADR form.');

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'adr_03_form_filled.png'),
      fullPage: false,
    });

    // 8. Submit the ADR Form
    console.log('Submitting ADR proposal...');
    const submitClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.innerText && b.innerText.includes('Commit Decision to SQLite')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    await sleep(2500);

    // 9. Verify the ADR is Rendered in the List
    const adrInList = await page.evaluate((title) => {
      return document.body.innerText.includes(title);
    }, adrUniqueTitle);

    recordTest('test7_adrRenderedInUi', adrInList, `ADR "${adrUniqueTitle}" rendered in UI decision list.`);

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'adr_04_recorded_in_list.png'),
      fullPage: false,
    });

    // 10. Verify Physical Persistence in Backend / SQLite
    let createdDecisionId = null;
    const decisionsRes = await fetch(`${DAEMON_URL}/api/decisions`);
    const allDecisions = await decisionsRes.json();
    const persisted = allDecisions.find((d) => d.title === adrUniqueTitle);
    if (persisted) {
      createdDecisionId = persisted.id;
    }

    recordTest(
      'test8_adrPersistedInSqlite',
      !!persisted && persisted.status === 'proposed',
      `ADR verified in SQLite DB. ID: ${createdDecisionId}, Status: ${persisted ? persisted.status : 'NOT_FOUND'}`
    );

    // 11. Authorize the Decision in the UI (Accept Authoritative button)
    console.log('Resolving status to authoritative in the UI...');
    const authorizedInUi = await page.evaluate((title) => {
      // Find the card containing our title
      const cards = Array.from(document.querySelectorAll('.rounded-xl'));
      const targetCard = cards.find((c) => c.innerText && c.innerText.includes(title));
      if (!targetCard) return false;

      const authBtn = Array.from(targetCard.querySelectorAll('button')).find(
        (b) => b.innerText && b.innerText.includes('Accept Authoritative')
      );
      if (authBtn) {
        authBtn.click();
        return true;
      }
      return false;
    }, adrUniqueTitle);

    await sleep(1500);

    // Verify status updated in UI and backend
    const updatedDecisionsRes = await fetch(`${DAEMON_URL}/api/decisions`);
    const updatedDecisions = await updatedDecisionsRes.json();
    const authoritativeDecision = updatedDecisions.find((d) => d.id === createdDecisionId);

    const isAuthoritative = authoritativeDecision && authoritativeDecision.status === 'authoritative';
    recordTest(
      'test9_adrAuthorized',
      isAuthoritative,
      `Decision status successfully updated to authoritative. Current status: ${authoritativeDecision ? authoritativeDecision.status : 'UNKNOWN'}`
    );

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'adr_05_status_authoritative.png'),
      fullPage: false,
    });

    // 12. Close Decisions Modal
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[title*="Close ADR Modal"]');
      if (closeBtn) closeBtn.click();
    });
    await sleep(600);

    // 13. Test Chat File Upload Attachment Wiring
    console.log('Testing chat file upload attachment...');
    const tempFilePath = path.join(process.cwd(), 'temp_test_artifact.md');
    fs.writeFileSync(tempFilePath, '# Kin Architecture Test Artifact\nVerification of file upload and paperclip attachment.\nTimestamp: ' + Date.now(), 'utf-8');

    const fileInput = await page.$('input[type="file"][multiple]');
    if (fileInput) {
      await fileInput.uploadFile(tempFilePath);
      console.log('Uploaded temp file to file input.');
      await sleep(2000);

      const inputHasAttachment = await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Message"]') || document.querySelector('input[placeholder*="channel"]');
        return input && input.value.includes('temp_test_artifact.md');
      });

      recordTest(
        'test10_chatFileUploadAttachment',
        inputHasAttachment,
        'File uploaded and attached to composer input with link: [📎 temp_test_artifact.md]'
      );
    } else {
      recordTest('test10_chatFileUploadAttachment', false, 'Hidden file input not found in DOM.');
    }

    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'adr_06_file_attached_in_chat.png'),
      fullPage: false,
    });

    // 14. Test Bare-Seconds Scheduler (/schedule 5s ADR verification heartbeat)
    console.log('Testing scheduler bare-seconds parsing...');
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="Message"]') || document.querySelector('input[placeholder*="channel"]');
      if (input) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, '/schedule 5s ADR verification heartbeat');
        input.dispatchEvent(new Event('input', { bubbles: true }));

        const form = input.closest('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    await sleep(1500);

    const timerActive = await page.evaluate(() => {
      return document.body.innerText.includes('ACTIVE TIMERS') &&
             document.body.innerText.includes('ADR verification heartbeat');
    });

    recordTest(
      'test11_schedulerBareSeconds',
      timerActive,
      'Active timer registered and countdown visible in UI for "5s" duration.'
    );

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'adr_07_scheduler_timer_active.png'),
      fullPage: false,
    });

    // Final summary
    console.log('====================================================================');
    console.log('📊 VERIFICATION SUMMARY');
    console.log('====================================================================');
    const passedCount = testResults.filter((t) => t.passed).length;
    console.log(`Total Tests: ${testResults.length} | Passed: ${passedCount} | Failed: ${testResults.length - passedCount}`);
    testResults.forEach((t) => {
      console.log(`- [${t.passed ? 'PASS' : 'FAIL'}] ${t.name}: ${t.detail}`);
    });

    if (passedCount === testResults.length) {
      console.log('🎉 ALL TESTS PASSED WITH 100% SUCCESS IN REAL CHROME BROWSER!');
    } else {
      console.error('⚠️ SOME TESTS FAILED. PLEASE REVIEW DETAILS ABOVE.');
      process.exitCode = 1;
    }

  } catch (err) {
    console.error('UNHANDLED TEST RUNNER ERROR:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runAdrAndUploadVerification();
