const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://localhost:5173';
const OUTPUT_DIR = path.resolve(__dirname, '../../docs/assets/screenshots');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('[SCREENSHOT CAPTURE] Launching Chrome in 1920x1080 viewport...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  console.log(`[SCREENSHOT CAPTURE] Navigating to ${UI_URL}...`);
  await page.goto(UI_URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !!(window.kinStore && window.kinStore.getState));
  await sleep(1500);

  // 1. App Interface / Workbench
  console.log('[1/8] Capturing 01_app_interface_workbench.png...');
  await page.evaluate(() => {
    const state = window.kinStore.getState();
    state.setSwarmMapOpen?.(false);
    state.setSettingsModalOpen?.(false);
    state.setSkillsModalOpen?.(false);
    state.setDesktopControlModalOpen?.(false);
    state.setDecisionsModalOpen?.(false);
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '01_app_interface_workbench.png') });

  // 2. Swarm Map Topology
  console.log('[2/8] Capturing 02_swarm_map_topology.png...');
  await page.evaluate(() => {
    const state = window.kinStore.getState();
    state.setSwarmMapOpen?.(true);
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '02_swarm_map_topology.png') });
  await page.evaluate(() => {
    window.kinStore.getState().setSwarmMapOpen?.(false);
  });
  await sleep(400);

  // 3. Settings & BYOK Credentials
  console.log('[3/8] Capturing 03_settings_and_credentials.png...');
  await page.evaluate(() => {
    const state = window.kinStore.getState();
    state.setSettingsModalOpen?.(true);
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '03_settings_and_credentials.png') });
  await page.evaluate(() => {
    window.kinStore.getState().setSettingsModalOpen?.(false);
  });
  await sleep(400);

  // 4. Agent Inspector Teamwork Topology
  console.log('[4/8] Capturing 04_agent_inspector_teamwork.png...');
  await page.evaluate(() => {
    const state = window.kinStore.getState();
    state.setActiveRightTab?.('Agent');
    state.setActiveInspectorTab?.('Teamwork');
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '04_agent_inspector_teamwork.png') });

  // 5. Crash Recovery Banner
  console.log('[5/8] Capturing 05_crash_recovery_banner.png...');
  await page.evaluate(() => {
    window.kinStore.setState({
      pendingRecovery: [
        {
          id: 'rec-demonstration',
          agentId: 'agent-boss',
          agentName: 'Boss',
          model: 'qwen2.5-coder:3b',
          projectId: 'proj-kin',
          taskTitle: 'Milestone 3: Core Resilience Verification & Checkpoint Integrity',
          interruptedTurn: 4,
          checkpointReason: 'turn_checkpoint',
          checkpoint: { activeAction: 'Verifying atomic task lease status' },
          interruptedAt: Date.now() - 120000,
        },
      ],
    });
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '05_crash_recovery_banner.png') });
  await page.evaluate(() => {
    window.kinStore.setState({ pendingRecovery: [] });
  });
  await sleep(400);

  // 6. Quota Pause Banner
  console.log('[6/8] Capturing 06_quota_pause_banner.png...');
  await page.evaluate(() => {
    window.kinStore.setState({
      activeQuotaPause: {
        id: 'pause-demo',
        provider: 'OpenRouter / Claude-3.5',
        resumesAt: Date.now() + 180000,
        secondsRemaining: 180,
        runId: 'run-demo-quota',
        checkpointReason: 'RESOURCE_EXHAUSTED (429)',
      },
    });
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '06_quota_pause_banner.png') });
  await page.evaluate(() => {
    window.kinStore.setState({ activeQuotaPause: null });
  });
  await sleep(400);

  // 7. Decisions and ADR
  console.log('[7/8] Capturing 07_decisions_and_adr.png...');
  await page.evaluate(() => {
    const state = window.kinStore.getState();
    state.setDecisionsModalOpen?.(true);
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '07_decisions_and_adr.png') });
  await page.evaluate(() => {
    window.kinStore.getState().setDecisionsModalOpen?.(false);
  });
  await sleep(400);

  // 8. Desktop & Web Control
  console.log('[8/8] Capturing 08_desktop_and_web_control.png...');
  await page.evaluate(() => {
    const state = window.kinStore.getState();
    state.setDesktopControlModalOpen?.(true);
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '08_desktop_and_web_control.png') });
  await page.evaluate(() => {
    window.kinStore.getState().setDesktopControlModalOpen?.(false);
  });
  await sleep(400);

  console.log('[SCREENSHOT CAPTURE] All 8 pristine screenshots captured successfully!');
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error('[SCREENSHOT CAPTURE ERROR]', err);
  process.exit(1);
});
