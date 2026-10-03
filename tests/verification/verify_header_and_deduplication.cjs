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

async function verifyHeaderAndDeduplication() {
  console.log('================================================================');
  console.log('🔍 VERIFYING CHANNEL HEADER FIX & GOAL DEDUPLICATION IN REAL CHROME');
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

  const results = {
    channelHeaderNotTruncated: false,
    goalDeduplicationWorking: false,
    teamworkPreviewClean: false,
    leftSidebarGoalsClean: false,
  };

  try {
    console.log('[STEP 1] Navigating to KIN OS UI on http://127.0.0.1:5173...');
    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Switch to #testing-ground
    console.log('[STEP 2] Switching to #testing-ground channel...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const tgBtn = buttons.find((b) => b.innerText.includes('testing-ground'));
      if (tgBtn) tgBtn.click();
    });
    await sleep(1500);

    // Inspect the channel header text in CenterView
    const headerInfo = await page.evaluate(() => {
      // Find the channel header container in CenterView (inside main)
      const mainHeader = document.querySelector('main > div:first-child');
      if (!mainHeader) return { found: false, text: '' };
      const hashSpan = Array.from(mainHeader.querySelectorAll('span')).find(
        (s) => s.innerText.trim() === '#' && s.className.includes('text-emerald-400')
      );
      if (!hashSpan) return { found: false, text: '' };
      const titleSpan = hashSpan.nextElementSibling;
      return {
        found: true,
        hash: hashSpan.innerText,
        title: titleSpan?.innerText || '',
        parentHtml: hashSpan.parentElement?.outerHTML || '',
      };
    });

    console.log('[STEP 2] Channel header inspection:', headerInfo);
    if (headerInfo.title === 'testing-ground') {
      results.channelHeaderNotTruncated = true;
      console.log('✅ PASS: #testing-ground channel header renders full title without truncation!\n');
    } else {
      console.error(`❌ FAIL: Expected "testing-ground" but got "${headerInfo.title}"`);
    }

    const headerScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_channel_header_untruncated.png');
    await page.screenshot({ path: headerScreenshot });
    console.log(`[STEP 2] Saved artifact: ${headerScreenshot}\n`);

    // Verify deduplication: submit existing /goal in #testing-ground
    console.log('[STEP 3] Testing /goal deduplication with existing title...');
    const goalTitle = 'Self-Healing Process Supervisor';
    const goalPrompt = `/goal ${goalTitle} | Updated supervisor with watchdog loop | Zero downtime`;

    // Type and send
    const input = await page.$('main input[type="text"]');
    if (input) {
      await input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await input.type(goalPrompt, { delay: 10 });
      await sleep(300);
      await page.keyboard.press('Enter');
      await sleep(2500);
    }

    // Check goals count in SQLite database via API
    const goalsRes = await fetch(`${API_URL}/api/projects/proj-kin/goals`);
    const goalsData = await goalsRes.json();
    const matchingGoals = goalsData.goals.filter(
      (g) => g.title.toLowerCase().trim() === goalTitle.toLowerCase().trim()
    );

    console.log(`[STEP 3] Matching goals with title "${goalTitle}": ${matchingGoals.length}`);
    if (matchingGoals.length === 1) {
      results.goalDeduplicationWorking = true;
      console.log('✅ PASS: Exactly 1 goal exists in database. Deduplication successfully updated existing goal without duplicates!\n');
    } else {
      console.error(`❌ FAIL: Found ${matchingGoals.length} goals with title "${goalTitle}"`);
    }

    // Inspect Left Sidebar Goals List in DOM
    const sidebarGoals = await page.evaluate(() => {
      const titles = Array.from(
        document.querySelectorAll('span.font-semibold.text-kin-text')
      )
        .map((el) => el.innerText.trim())
        .filter(Boolean);
      return titles;
    });

    console.log('[STEP 4] Sidebar goal titles in DOM:', sidebarGoals);
    // Count exact occurrences of Self-Healing Process Supervisor
    const supervisorOccurrences = sidebarGoals.filter((t) => t === 'Self-Healing Process Supervisor').length;
    console.log(`[STEP 4] Exact occurrences of "Self-Healing Process Supervisor" in sidebar: ${supervisorOccurrences}`);
    if (supervisorOccurrences === 1) {
      results.leftSidebarGoalsClean = true;
      console.log('✅ PASS: Sidebar renders single deduplicated goal item without duplicate stacking!\n');
    }

    // Test /teamwork-preview
    console.log('[STEP 5] Testing /teamwork-preview output in #testing-ground...');
    if (input) {
      await input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await input.type('/teamwork-preview', { delay: 10 });
      await sleep(300);
      await page.keyboard.press('Enter');
      await sleep(2500);
    }

    const teamworkCheck = await page.evaluate(() => {
      const text = document.querySelector('main')?.innerText || '';
      return {
        hasMatrix: text.includes('Workforce Collaboration Matrix'),
        hasPulse: text.includes('Project Pulse'),
        hasEngine: text.includes('Engine Status'),
      };
    });

    console.log('[STEP 5] /teamwork-preview check:', teamworkCheck);
    if (teamworkCheck.hasMatrix && teamworkCheck.hasPulse && teamworkCheck.hasEngine) {
      results.teamworkPreviewClean = true;
      console.log('✅ PASS: /teamwork-preview output cleanly rendered!\n');
    }

    const finalScreenshot = path.join(ARTIFACTS_DIR, 'kin_os_verified_clean_teamwork.png');
    await page.screenshot({ path: finalScreenshot });
    console.log(`[STEP 5] Saved artifact: ${finalScreenshot}\n`);

  } catch (err) {
    console.error('❌ Error during verification:', err);
  } finally {
    await browser.close();
  }

  console.log('================================================================');
  console.log('📊 VERIFICATION SUMMARY:');
  console.log(JSON.stringify(results, null, 2));
  console.log('================================================================');

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

verifyHeaderAndDeduplication();
