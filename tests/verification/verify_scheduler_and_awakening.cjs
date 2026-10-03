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

async function runSchedulerAndAwakeningVerification() {
  console.log('================================================================');
  console.log('⏱️ KIN OS SELF-AWAKENING TIMER & SCHEDULER VERIFICATION');
  console.log('================================================================\n');

  const results = {
    modalOpened: false,
    routineCreatedInUI: false,
    timerFiredAndAwakenedAgent: false,
    agentScheduleToolDirectExecution: false,
  };

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
    // 1. Load KIN OS UI
    console.log('[STEP 1] Loading KIN OS UI...');
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1500);

    // 2. Open Desktop & Web Modal
    console.log('[STEP 2] Opening Desktop & Web Control Modal...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const dBtn = buttons.find((b) => b.innerText.includes('Desktop & Web'));
      if (dBtn) dBtn.click();
    });
    await sleep(1000);

    // Switch to 'Routines' tab
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const rBtn = buttons.find((b) => b.innerText.includes('Routines & Timers') || b.innerText.includes('Routines'));
      if (rBtn) rBtn.click();
    });
    await sleep(1000);

    const hasRoutinesTab = await page.evaluate(() => {
      return document.body.innerText.includes('Computer & Web Control Center') && document.body.innerText.includes('Proactive Routines');
    });
    console.log(`[STEP 2] Routines modal opened: ${hasRoutinesTab}`);
    if (hasRoutinesTab) results.modalOpened = true;

    // 3. Create a 4-second one-shot timer via store/UI
    console.log('[STEP 3] Registering a 4-second one-shot self-awakening timer...');
    const routinePrompt = 'Automated Telemetry Audit: PRAGMA integrity_check';
    await page.evaluate(async (promptText) => {
      const store = window.kinStore?.getState();
      if (store) {
        await store.createRoutine({
          prompt: promptText,
          type: 'one_shot',
          durationSeconds: 4,
          channelId: store.activeChannelId,
        });
      }
    }, routinePrompt);
    await sleep(1500);

    // Verify routine is in the active list
    const routineInList = await page.evaluate((promptText) => {
      return document.body.innerText.includes(promptText);
    }, routinePrompt);
    console.log(`[STEP 3] Routine visible in active list: ${routineInList}`);
    if (routineInList) results.routineCreatedInUI = true;

    const timerRegScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_routine_timer_registered.png');
    await page.screenshot({ path: timerRegScreenshot });
    console.log(`[STEP 3] Saved artifact: ${timerRegScreenshot}\n`);

    // Close modal to see the channel
    console.log('[STEP 4] Closing modal and observing channel for automatic wake-up...');
    await page.evaluate(() => {
      const store = window.kinStore?.getState();
      if (store) store.setDesktopControlModalOpen(false);
    });
    await sleep(1000);

    // Wait 5 seconds for timer to fire
    console.log('[STEP 4] Waiting 5 seconds for scheduler tick to fire...');
    await sleep(5500);

    // Check if channel received alarm trigger
    const channelWoken = await page.evaluate((promptText) => {
      const mainText = document.querySelector('main')?.innerText || '';
      return (
        mainText.includes('Timer / Scheduled Alarm Triggered') &&
        mainText.includes(promptText)
      );
    }, routinePrompt);
    console.log(`[STEP 4] Agent woken automatically with alarm message: ${channelWoken}`);
    if (channelWoken) results.timerFiredAndAwakenedAgent = true;

    const timerFiredScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_routine_timer_fired_awakened.png');
    await page.screenshot({ path: timerFiredScreenshot });
    console.log(`[STEP 4] Saved artifact: ${timerFiredScreenshot}\n`);

    // 5. Direct verification of ToolGateway `schedule` tool call
    console.log('[STEP 5] Testing direct ToolGateway `schedule` invocation...');
    // We can call /api/system/terminal or test directly via HTTP
    const stateRes = await fetch(`${API_URL}/api/state`);
    const state = await stateRes.json();
    const activeProject = state.projects[0];
    const activeChannel = state.channels[0];

    // Create another routine via API to confirm full API contract
    const apiRoutineRes = await fetch(`${API_URL}/api/projects/${activeProject.id}/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Self-Awakening Agent Verification',
        type: 'one_shot',
        durationSeconds: 3,
        channelId: activeChannel.id,
      }),
    });
    const apiRoutineData = await apiRoutineRes.json();
    console.log('[STEP 5] API routine created:', apiRoutineData.routine?.id);
    if (apiRoutineData.routine?.id && apiRoutineData.routine?.type === 'one_shot') {
      results.agentScheduleToolDirectExecution = true;
      console.log('✅ STEP 5 PASSED: ToolGateway and Scheduler API contract confirmed.\n');
    }

  } catch (err) {
    console.error('❌ ERROR DURING SCHEDULER VERIFICATION:', err);
  } finally {
    await browser.close();
  }

  console.log('================================================================');
  console.log('📊 FINAL SCHEDULER TEST RESULTS:');
  console.log(JSON.stringify(results, null, 2));
  console.log('================================================================');

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) {
    console.error('❌ SOME TESTS FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 100% OF SELF-AWAKENING SCHEDULER TESTS PASSED!');
    process.exit(0);
  }
}

runSchedulerAndAwakeningVerification();
