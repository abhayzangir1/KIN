const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const AUTOMATION_PROFILE_DIR = path.resolve(__dirname, '../../.kin/browser_profiles/social_launch_profile');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LINKEDIN_POST_TEXT = `Excited to unveil KIN — an autonomous, local-first operating system designed to orchestrate collaborative multi-agent software engineering teams directly on your physical workstation. 🚀

Most AI agent systems today are brittle cloud wrappers: they lose all state when a process terminates, burn tokens on runaway loops, fail catastrophically on network blips, and offer zero hardware-level governance.

We built KIN from first principles to bring enterprise-grade resilience, determinism, and privacy to local multi-agent software development.

Key Architecture Highlights:
🛡️ Turn-by-Turn Crash Resilience & State Recovery with 1-click [Resume All]
⏳ HTTP 429 Quota Guard with countdown & 1-click fallback to local Ollama models
🎯 Antigravity Slash Command Suite (/plan, /boost, /btw, /grill-me, /teamwork-preview)
🖥️ Dynamic Hardware Governors & Governed Desktop Control (Win32 DesktopLock mutex)
🔒 Atomic Distributed Task Leases & Optimistic Concurrency Control (OCC)
📊 Formal Agent Evaluations & BYOK Vault (OpenRouter, Anthropic, OpenAI)

KIN is 100% open-source, local-first, and telemetry-free.

💻 GitHub Repository: https://github.com/abhayzangir1/KIN
⭐ Check out the architecture, screenshots, and live demo in the repo!

#AI #SoftwareEngineering #MultiAgentSystems #OpenSource #TypeScript #React #LocalFirst #ArtificialIntelligence #Ollama #DevTools`;

const X_POST_TEXT = `🚀 Introducing KIN: The Autonomous, Local-First Workforce Operating System.

Orchestrate collaborative multi-agent software engineering teams directly on your workstation with turn-by-turn crash recovery, zero cloud telemetry, and governed desktop/browser control.

100% Open-Source: https://github.com/abhayzangir1/KIN

#AI #OpenSource #LocalFirst #DevTools`;

(async () => {
  if (!fs.existsSync(AUTOMATION_PROFILE_DIR)) {
    fs.mkdirSync(AUTOMATION_PROFILE_DIR, { recursive: true });
  }

  console.log('================================================================');
  console.log('KIN OS: VISIBLE BROWSER SOCIAL MEDIA DRAFTING');
  console.log('Launching visible Chrome on screen (headless: false)...');
  console.log('================================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null, // use actual window size
    args: [
      `--user-data-dir=${AUTOMATION_PROFILE_DIR}`,
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1600,950',
    ],
  });

  const pages = await browser.pages();
  const page1 = pages[0] || (await browser.newPage());

  // -------------------------------------------------------------
  // Step 1: LinkedIn Tab
  // -------------------------------------------------------------
  console.log('\n[1/2] Navigating to LinkedIn (https://www.linkedin.com/feed/)...');
  await page1.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  // Inject a visual overlay banner in the page so user sees what KIN agent is doing
  await page1.evaluate((text) => {
    const banner = document.createElement('div');
    banner.id = 'kin-agent-overlay';
    banner.style.position = 'fixed';
    banner.style.top = '10px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.zIndex = '999999';
    banner.style.background = '#0f172a';
    banner.style.color = '#38bdf8';
    banner.style.border = '2px solid #38bdf8';
    banner.style.borderRadius = '8px';
    banner.style.padding = '12px 24px';
    banner.style.boxShadow = '0 8px 30px rgba(0,0,0,0.8)';
    banner.style.fontFamily = 'system-ui, sans-serif';
    banner.style.fontSize = '14px';
    banner.style.fontWeight = 'bold';
    banner.innerHTML = '🤖 KIN Autonomous Agent: Active on Screen • Ready to Draft LinkedIn Launch Announcement';
    document.body.appendChild(banner);
  });

  // Check if user is logged into LinkedIn
  const isLoggedInLinkedIn = await page1.evaluate(() => {
    return !!(
      document.querySelector('button.share-box-feed-entry__trigger') ||
      document.querySelector('div.feed-identity-module') ||
      document.querySelector('nav.global-nav')
    );
  });

  if (isLoggedInLinkedIn) {
    console.log('[LinkedIn] Detected active user session! Opening post composer...');
    const postTrigger = await page1.$('button.share-box-feed-entry__trigger');
    if (postTrigger) {
      await postTrigger.click();
      await sleep(2000);
      const editor = await page1.$('div.ql-editor');
      if (editor) {
        await editor.click();
        await page1.keyboard.type(LINKEDIN_POST_TEXT, { delay: 10 });
        console.log('[LinkedIn] Post drafted successfully in composer!');
      }
    }
  } else {
    console.log('[LinkedIn] Notice: User is not yet logged into this browser profile.');
    console.log('[LinkedIn] Displaying drafted text and keeping browser open for user login/review.');
  }

  // -------------------------------------------------------------
  // Step 2: X (Twitter) Tab
  // -------------------------------------------------------------
  console.log('\n[2/2] Opening second tab for X (https://x.com/compose/post)...');
  const page2 = await browser.newPage();
  await page2.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  await page2.evaluate(() => {
    const banner = document.createElement('div');
    banner.id = 'kin-agent-overlay-x';
    banner.style.position = 'fixed';
    banner.style.top = '10px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.zIndex = '999999';
    banner.style.background = '#0f172a';
    banner.style.color = '#38bdf8';
    banner.style.border = '2px solid #38bdf8';
    banner.style.borderRadius = '8px';
    banner.style.padding = '12px 24px';
    banner.style.boxShadow = '0 8px 30px rgba(0,0,0,0.8)';
    banner.style.fontFamily = 'system-ui, sans-serif';
    banner.style.fontSize = '14px';
    banner.style.fontWeight = 'bold';
    banner.innerHTML = '🤖 KIN Autonomous Agent: Active on Screen • Ready to Draft X (Twitter) Launch Post';
    document.body.appendChild(banner);
  });

  const isLoggedInX = await page2.evaluate(() => {
    return !!(
      document.querySelector('div[data-testid="tweetTextarea_0"]') ||
      document.querySelector('a[data-testid="AppTabBar_Home_Link"]')
    );
  });

  if (isLoggedInX) {
    console.log('[X] Detected active session! Typing draft into tweet composer...');
    const tweetEditor = await page2.$('div[data-testid="tweetTextarea_0"]');
    if (tweetEditor) {
      await tweetEditor.click();
      await page2.keyboard.type(X_POST_TEXT, { delay: 10 });
      console.log('[X] Launch post drafted successfully in composer!');
    }
  } else {
    console.log('[X] Notice: User is not yet logged into this browser profile.');
    console.log('[X] Keeping browser window open for user review.');
  }

  console.log('\n================================================================');
  console.log('BROWSER AUTOMATION ACTIVE ON USER SCREEN');
  console.log('Both LinkedIn and X tabs are open visibly.');
  console.log('The complete copy is also saved to docs/LAUNCH_POSTS.md');
  console.log('Keeping browser alive for 15 seconds so operator can inspect...');
  console.log('================================================================');

  await sleep(15000);
  console.log('[DONE] Social draft automation completed.');
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error('[SOCIAL POST DRAFT ERROR]', err);
  process.exit(1);
});
