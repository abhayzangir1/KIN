const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const ARTIFACTS_DIR = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\076e17ed-edc4-4b04-9573-018c8bacc8ab';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://127.0.0.1:5173';
const API_URL = 'http://127.0.0.1:54321';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveScreenshot(page, filename) {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
  const p = path.join(ARTIFACTS_DIR, filename);
  return page.screenshot({ path: p }).catch((err) => {
    console.error(`Failed to save screenshot ${filename}:`, err.message);
  });
}

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const u = new URL(urlPath, API_URL);
    const req = http.request(
      u,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, API_URL);
    const req = http.request(u, { method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getBinary(urlPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, API_URL);
    const req = http.request(u, { method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runComprehensiveVerification() {
  console.log('================================================================');
  console.log('🛡️ KIN OS COMPREHENSIVE MULTI-AGENT, CONCURRENCY & CHROME AUDIT');
  console.log('================================================================\n');

  const results = {};

  // Import core modules for unit/engine verification
  const { AgentLoopRunner } = require('./core/dist/kernel/agent_loop.js');
  const { ToolGateway } = require('./core/dist/execution/tool_gateway.js');

  // -------------------------------------------------------------------------
  // TEST 1: Windows Path & Unicode Tool Call Parsing Edge Cases
  // -------------------------------------------------------------------------
  console.log('[TEST 1] Testing Tool Call Parser with complex Windows paths & escape sequences...');
  try {
    const tcUsers = `<tool_call>
{"name": "readFile", "parameters": {"path": "C:\\users\\abhay\\project\\test.ts"}}
</tool_call>`;
    const parsedUsers = AgentLoopRunner.extractToolCall(tcUsers);
    if (!parsedUsers || parsedUsers.name !== 'readFile' || !parsedUsers.params.path.includes('users/abhay')) {
      throw new Error(`Failed on users path: ${JSON.stringify(parsedUsers)}`);
    }

    const tcNotes = `<tool_call>
{"name": "readFile", "parameters": {"path": "C:\\test\\notes\\todo.txt"}}
</tool_call>`;
    const parsedNotes = AgentLoopRunner.extractToolCall(tcNotes);
    if (!parsedNotes || parsedNotes.params.path.includes('\t') || parsedNotes.params.path.includes('\n')) {
      throw new Error(`Path was corrupted with control chars: ${JSON.stringify(parsedNotes)}`);
    }

    const tcCodeFence = `<tool_call>
\`\`\`json
{
  "name": "executeShell",
  "parameters": {
    "command": "dir C:\\users\\desktop"
  }
}
\`\`\`
</tool_call>`;
    const parsedFence = AgentLoopRunner.extractToolCall(tcCodeFence);
    if (!parsedFence || parsedFence.name !== 'executeShell') {
      throw new Error(`Failed on code fence: ${JSON.stringify(parsedFence)}`);
    }

    console.log('  -> Parsed users path:', parsedUsers.params.path);
    console.log('  -> Parsed notes path:', parsedNotes.params.path);
    console.log('  -> Parsed fenced command:', parsedFence.params.command);
    console.log('✅ TEST 1 PASSED: Robust Windows path and escape handling verified.\n');
    results.test1_windowsPathAndEscapeParsing = 'PASSED';
  } catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
    results.test1_windowsPathAndEscapeParsing = `FAILED: ${err.message}`;
  }

  // -------------------------------------------------------------------------
  // TEST 2: ToolGateway Edge Cases: Safe classifyRisk, Read Directory & Write Directory Collisions
  // -------------------------------------------------------------------------
  console.log('[TEST 2] Testing ToolGateway edge cases: undefined params & directory collisions...');
  try {
    const gateway = new ToolGateway(null);

    // Test undefined params in classifyRisk
    const riskComp = gateway.classifyRisk('computer', undefined);
    const riskShell = gateway.classifyRisk('executeShell', undefined);
    const riskRead = gateway.classifyRisk('readFile', undefined);
    console.log(`  -> Classify risk with undefined params: computer=${riskComp}, shell=${riskShell}, read=${riskRead}`);

    // Test readFile on a directory
    const testDir = path.resolve(process.cwd(), 'temp_test_dir_' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'file.txt'), 'hello');

    const readDirResult = await gateway.executeTool('readFile', { path: '.' }, {
      runId: 'r1',
      agentId: 'a1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: testDir,
      autonomyMode: 'FULL_ACCESS',
      allowedCapabilities: ['readFile'],
    });

    if (readDirResult.success) {
      throw new Error('readFile on directory unexpectedly succeeded!');
    }
    console.log('  -> readFile on directory safely returned error:', readDirResult.error);

    // Test writeFile with directory collision
    const writeCollResult = await gateway.executeTool('writeFile', { path: '.', content: 'test' }, {
      runId: 'r2',
      agentId: 'a1',
      projectId: 'p1',
      channelId: 'c1',
      worktreeRoot: testDir,
      autonomyMode: 'FULL_ACCESS',
      allowedCapabilities: ['writeFile'],
    });
    if (writeCollResult.success) {
      throw new Error('writeFile on existing directory unexpectedly succeeded!');
    }
    console.log('  -> writeFile on directory safely returned error:', writeCollResult.error);

    // Clean up temp dir
    fs.rmSync(testDir, { recursive: true, force: true });

    console.log('✅ TEST 2 PASSED: ToolGateway undefined params and directory collisions verified.\n');
    results.test2_toolGatewayEdgeCases = 'PASSED';
  } catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
    results.test2_toolGatewayEdgeCases = `FAILED: ${err.message}`;
  }

  // -------------------------------------------------------------------------
  // TEST 3: Multi-Channel Concurrency, Hiring & Channel Isolation
  // -------------------------------------------------------------------------
  console.log('[TEST 3] Testing multi-channel parallel concurrency & agent hiring...');
  try {
    const projRes = await getJson('/api/projects');
    const projectId = projRes.data.activeProjectId || 'proj-kin';

    // Create 3 parallel channels
    const c1Name = `chan-alpha-${Date.now().toString().slice(-4)}`;
    const c2Name = `chan-beta-${Date.now().toString().slice(-4)}`;
    const c3Name = `chan-gamma-${Date.now().toString().slice(-4)}`;

    const c1 = await postJson('/api/channels', { projectId, name: c1Name });
    const c2 = await postJson('/api/channels', { projectId, name: c2Name });
    const c3 = await postJson('/api/channels', { projectId, name: c3Name });

    const chan1Id = c1.data.channel.id;
    const chan2Id = c2.data.channel.id;
    const chan3Id = c3.data.channel.id;

    console.log(`  -> Created channels: #${c1Name} (${chan1Id}), #${c2Name} (${chan2Id}), #${c3Name} (${chan3Id})`);

    // Dispatch messages concurrently across all 3 channels
    const [m1, m2, m3] = await Promise.all([
      postJson(`/api/channels/${chan1Id}/messages`, { content: 'Channel Alpha status report request' }),
      postJson(`/api/channels/${chan2Id}/messages`, { content: '/hire @DevSpecialist Frontend Engineer' }),
      postJson(`/api/channels/${chan3Id}/messages`, { content: 'Channel Gamma architecture review' }),
    ]);

    if (m1.status !== 201 || m2.status !== 201 || m3.status !== 201) {
      throw new Error(`Message creation failed: ${m1.status}, ${m2.status}, ${m3.status}`);
    }

    // Verify channel messages are strictly isolated
    const feed1 = await getJson(`/api/channels/${chan1Id}/messages`);
    const feed2 = await getJson(`/api/channels/${chan2Id}/messages`);
    const feed3 = await getJson(`/api/channels/${chan3Id}/messages`);

    const f1HasF2 = feed1.data.messages.some((m) => m.content.includes('@DevSpecialist'));
    const f3HasF1 = feed3.data.messages.some((m) => m.content.includes('Channel Alpha'));

    if (f1HasF2 || f3HasF1) {
      throw new Error('Cross-channel message leakage detected!');
    }

    console.log(`  -> Channel Alpha message count: ${feed1.data.messages.length}`);
    console.log(`  -> Channel Beta message count: ${feed2.data.messages.length}`);
    console.log(`  -> Channel Gamma message count: ${feed3.data.messages.length}`);
    console.log('✅ TEST 3 PASSED: Multi-channel concurrency and isolation verified.\n');
    results.test3_multiChannelConcurrencyAndIsolation = 'PASSED';
  } catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
    results.test3_multiChannelConcurrencyAndIsolation = `FAILED: ${err.message}`;
  }

  // -------------------------------------------------------------------------
  // TEST 4: Untracked Directory Revert & Large File Diff Safeguards
  // -------------------------------------------------------------------------
  console.log('[TEST 4] Testing untracked directory revert & git diff safeguards...');
  try {
    const projRes = await getJson('/api/projects');
    const projectId = projRes.data.activeProjectId || 'proj-kin';

    // 1. Create untracked test directory in workspace
    const tempDirRel = 'test_untracked_dir_' + Date.now();
    const tempDirAbs = path.resolve(process.cwd(), tempDirRel);
    fs.mkdirSync(tempDirAbs, { recursive: true });
    fs.writeFileSync(path.join(tempDirAbs, 'sample.txt'), 'sample untracked content');

    // 2. Call revert endpoint on untracked directory
    const revertRes = await postJson(`/api/projects/${projectId}/git/revert`, { path: tempDirRel });
    if (revertRes.status !== 200) {
      throw new Error(`Revert failed with status ${revertRes.status}: ${JSON.stringify(revertRes.data)}`);
    }

    if (fs.existsSync(tempDirAbs)) {
      throw new Error('Untracked directory was not deleted by revert!');
    }
    console.log('  -> Successfully reverted untracked directory without EISDIR error.');

    // 3. Test large untracked file diff safeguard
    const largeFileRel = 'test_large_untracked_' + Date.now() + '.txt';
    const largeFileAbs = path.resolve(process.cwd(), largeFileRel);
    // Create 1.5MB file
    const largeBuffer = Buffer.alloc(1.5 * 1024 * 1024, 'a\n');
    fs.writeFileSync(largeFileAbs, largeBuffer);

    const diffRes = await getJson(`/api/projects/${projectId}/git/diff?path=${largeFileRel}`);
    if (diffRes.status !== 200 || !diffRes.data.diff.includes('Preview of first 100KB')) {
      fs.unlinkSync(largeFileAbs);
      throw new Error(`Large file diff did not return preview: ${JSON.stringify(diffRes.data)}`);
    }
    console.log('  -> Large untracked file (>1MB) safely previewed with memory protection.');

    // Clean up large test file
    fs.unlinkSync(largeFileAbs);

    console.log('✅ TEST 4 PASSED: Untracked directory revert and diff safeguards verified.\n');
    results.test4_untrackedDirRevertAndDiffSafeguard = 'PASSED';
  } catch (err) {
    console.error('❌ TEST 4 FAILED:', err.message);
    results.test4_untrackedDirRevertAndDiffSafeguard = `FAILED: ${err.message}`;
  }

  // -------------------------------------------------------------------------
  // TEST 5: Terminal Jail Confinement & ExitCode Verification
  // -------------------------------------------------------------------------
  console.log('[TEST 5] Testing terminal execution: jail confinement & numeric exitCode...');
  try {
    // 1. Valid command within project
    const validRes = await postJson('/api/system/terminal', {
      command: 'Write-Output "KIN_SAFE_TERMINAL"',
    });
    if (validRes.status !== 200 || validRes.data.exitCode !== 0 || typeof validRes.data.exitCode !== 'number') {
      throw new Error(`Terminal valid command failed: ${JSON.stringify(validRes.data)}`);
    }

    // 2. Directory traversal attempt
    const jailEscapeRes = await postJson('/api/system/terminal', {
      command: 'dir',
      cwd: 'C:\\Windows',
    });
    if (jailEscapeRes.status !== 403) {
      throw new Error(`Expected 403 on jail escape, got ${jailEscapeRes.status}`);
    }
    console.log('  -> Jail escape outside project rejected with HTTP 403.');

    // 3. Command timeout exitCode check
    const timeoutRes = await postJson('/api/system/terminal', {
      command: 'Start-Sleep -Seconds 5; Write-Output "done"',
      timeoutMs: 1000,
    });
    if (typeof timeoutRes.data.exitCode !== 'number') {
      throw new Error(`Expected numeric exitCode on timeout, got ${typeof timeoutRes.data.exitCode}`);
    }
    console.log(`  -> Timeout command exitCode is number: ${timeoutRes.data.exitCode}`);

    console.log('✅ TEST 5 PASSED: Terminal jail confinement and exitCode verified.\n');
    results.test5_terminalJailAndExitCode = 'PASSED';
  } catch (err) {
    console.error('❌ TEST 5 FAILED:', err.message);
    results.test5_terminalJailAndExitCode = `FAILED: ${err.message}`;
  }

  // -------------------------------------------------------------------------
  // TEST 6: Real Google Chrome Physical UI Verification
  // -------------------------------------------------------------------------
  console.log('[TEST 6] Launching real Google Chrome to test live UI & interactions...');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    await page.goto(UI_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);
    await saveScreenshot(page, '01_final_chrome_loaded.png');

    // 1. Verify HeaderBar Settings button activates Agent tab in Right Panel
    console.log('  -> Testing HeaderBar Settings button click...');
    const settingsBtn = await page.waitForSelector('button[title*="Settings"]', { timeout: 5000 });
    await settingsBtn.click();
    await sleep(1000);
    await saveScreenshot(page, '02_settings_opened_agent_tab.png');

    // Verify Agent Inspector tab is visible
    const inspectorVisible = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Model Selection') || text.includes('Lead Orchestrator') || text.includes('Specialist');
    });
    if (!inspectorVisible) {
      throw new Error('Agent settings inspector was not rendered after clicking Settings!');
    }
    console.log('  -> Settings button opened Agent Inspector configuration successfully.');

    // 2. Test /plan command in real Chrome input
    console.log('  -> Testing /plan execution in real Chrome UI...');
    const planChip = await page.waitForSelector('button:has-text("📋 /plan")', { timeout: 5000 }).catch(() => null);
    if (planChip) {
      await planChip.click();
    } else {
      await page.type('input[type="text"]', '/plan Autonomous Workforce Hardening');
      await page.keyboard.press('Enter');
    }
    await sleep(3000);
    await saveScreenshot(page, '03_plan_dag_rendered.png');

    // Verify /plan generated a DAG plan
    const planRendered = await page.evaluate(() => {
      return document.body.innerText.includes('Execution Plan Initialized') || document.body.innerText.includes('Milestone Breakdown');
    });
    if (!planRendered) {
      throw new Error('/plan output was not rendered in Chrome chat feed!');
    }
    console.log('  -> /plan multi-phase DAG rendered in Chrome feed.');

    // 3. Test /teamwork-preview command in real Chrome
    console.log('  -> Testing /teamwork-preview execution in real Chrome...');
    await page.type('input[type="text"]', '/teamwork-preview');
    await page.keyboard.press('Enter');
    await sleep(3000);
    await saveScreenshot(page, '04_teamwork_preview_rendered.png');

    const teamworkRendered = await page.evaluate(() => {
      return document.body.innerText.includes('Workforce Collaboration Matrix') || document.body.innerText.includes('Project Pulse');
    });
    if (!teamworkRendered) {
      throw new Error('/teamwork-preview matrix was not rendered in Chrome!');
    }
    console.log('  -> /teamwork-preview matrix rendered successfully.');

    // 4. Test /boost command in real Chrome
    console.log('  -> Testing /boost command execution in real Chrome...');
    await page.type('input[type="text"]', '/boost');
    await page.keyboard.press('Enter');
    await sleep(3000);
    await saveScreenshot(page, '05_boost_mode_engaged.png');

    const boostRendered = await page.evaluate(() => {
      return document.body.innerText.includes('Boost Mode Engaged') || document.body.innerText.includes('Maximum Autonomy');
    });
    if (!boostRendered) {
      throw new Error('/boost directive was not rendered in Chrome!');
    }
    console.log('  -> /boost mode engaged and displayed with full telemetry.');

    // 5. Test message quoting hover & click
    console.log('  -> Testing message quoting hover button in Chrome...');
    const messageRows = await page.$$('.group');
    if (messageRows.length > 0) {
      await messageRows[messageRows.length - 1].hover();
      await sleep(500);
      const quoteBtn = await page.$('button[title*="Quote this message"]');
      if (quoteBtn) {
        await quoteBtn.click();
        await sleep(500);
        await saveScreenshot(page, '06_quote_prefilled.png');
        const prefillVal = await page.evaluate(() => {
          const inp = document.querySelector('input[type="text"]');
          return inp ? inp.value : '';
        });
        if (!prefillVal.includes('> [Quote')) {
          throw new Error(`Quote was not prefilled in input box: "${prefillVal}"`);
        }
        console.log('  -> Message quoting prefilled successfully: ' + prefillVal.slice(0, 60) + '...');
      }
    }

    console.log('✅ TEST 6 PASSED: Real Google Chrome UI, Settings, and Commands verified.\n');
    results.test6_realGoogleChromeUIAndInteractions = 'PASSED';
  } catch (err) {
    console.error('❌ TEST 6 FAILED:', err.message);
    results.test6_realGoogleChromeUIAndInteractions = `FAILED: ${err.message}`;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('================================================================');
  console.log('📊 FINAL COMPREHENSIVE VERIFICATION RESULTS');
  console.log('================================================================');
  let passCount = 0;
  let totalCount = 0;
  for (const [k, v] of Object.entries(results)) {
    totalCount++;
    const isPass = v === 'PASSED';
    if (isPass) passCount++;
    console.log(`${isPass ? '✅' : '❌'} ${k}: ${v}`);
  }
  console.log(`\nFinal Score: ${passCount}/${totalCount} (${Math.round((passCount / totalCount) * 100)}%)`);
  console.log('================================================================\n');

  if (passCount !== totalCount) {
    process.exit(1);
  }
}

runComprehensiveVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
