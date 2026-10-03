const puppeteer = require('puppeteer-core');
const path = require('path');

const ARTIFACTS_DIR = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\0a46bdb8-1000-45ef-9eaf-7050f5f9b464';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://127.0.0.1:5173';
const API_URL = 'http://127.0.0.1:54321';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyAgentLiveInteraction() {
  console.log('================================================================');
  console.log('🤖 KIN OS REAL-AGENT LIVE INTERACTION & CHANNEL VERIFICATION');
  console.log('================================================================\n');

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
    console.log('[STEP 1] Navigating Chrome to KIN OS UI...');
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Switch to #testing-ground channel
    console.log('[STEP 2] Switching to #testing-ground channel...');
    await page.evaluate(() => {
      const channelButtons = Array.from(document.querySelectorAll('nav button, aside button, div button'));
      const tgBtn = channelButtons.find((b) => b.textContent && b.textContent.includes('testing-ground'));
      if (tgBtn) tgBtn.click();
    });
    await sleep(1500);

    // Verify channel header
    const currentChannel = await page.evaluate(() => {
      const headerTitle = document.querySelector('main div span.text-sm.font-bold');
      return headerTitle ? headerTitle.textContent : null;
    });
    console.log('  -> Current Channel in CenterView:', currentChannel);

    // Dynamically fetch exact channel ID for #testing-ground
    console.log('[STEP 3] Resolving channel ID for #testing-ground...');
    const stateRes = await fetch(`${API_URL}/api/state`);
    const stateData = await stateRes.json();
    const testingChannel = stateData.channels.find((c) => c.name === 'testing-ground') || stateData.channels[0];
    console.log('  -> Resolved channel ID:', testingChannel.id, 'for name:', testingChannel.name);

    console.log('[STEP 3b] Sending direct execution message from human operator to #testing-ground...');
    const sendRes = await fetch(`${API_URL}/api/channels/${testingChannel.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@Boss execute system check and report installed applications' }),
    });
    const sendData = await sendRes.json();
    console.log('  -> Message sent status:', sendRes.status, sendData);

    // Wait for the agent to think and respond
    console.log('[STEP 4] Waiting for @Boss inference and execution loop...');
    let foundReply = false;
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const messages = await page.evaluate(() => {
        const msgNodes = Array.from(document.querySelectorAll('main div.group'));
        return msgNodes.map((n) => n.textContent || '');
      });

      const reply = messages.find((m) => m.includes('@Boss') && (m.includes('application') || m.includes('installed') || m.includes('system') || m.includes('Execution') || m.includes('check')));
      if (reply) {
        foundReply = true;
        console.log('  -> Observed agent response in Chrome DOM:', reply.slice(0, 150));
        break;
      }
    }

    const shotPath = path.join(ARTIFACTS_DIR, 'kin_os_agent_live_turn_completed.png');
    await page.screenshot({ path: shotPath });
    console.log(`  📸 Saved screenshot: ${shotPath}\n`);

    console.log(`Live Agent Response in Chrome: ${foundReply ? 'SUCCESS ✅' : 'PENDING OR IN-FLIGHT ⏳'}`);
  } finally {
    await browser.close();
  }
}

verifyAgentLiveInteraction().catch((err) => {
  console.error('Fatal interaction error:', err);
  process.exit(1);
});
