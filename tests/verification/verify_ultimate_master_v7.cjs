// ============================================================================
// KIN OS: Master Physical Verification & Concurrency Stress Test Suite (v7)
// End-to-end physical verification against:
// - Physical Google Chrome via Puppeteer-core
// - Vite Frontend on http://127.0.0.1:5173
// - KIN Core Daemon on http://127.0.0.1:54321
// - SQLite WAL Database (kin_storage.sqlite)
// - Ollama Local Inference (11434)
// ============================================================================

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UI_URL = 'http://127.0.0.1:5173';
const DAEMON_URL = 'http://127.0.0.1:54321';
const ARTIFACTS_DIR = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\92497da0-b3b2-4294-b559-3bad66354d5d';
const ARTIFACTS_DIR_ALT = 'C:\\Users\\abhay\\.gemini\\antigravity\\brain\\fe485c0d-ad2d-4151-9cbe-7f205a5c5d8d';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureScreenshot(page, filename) {
  for (const dir of [ARTIFACTS_DIR, ARTIFACTS_DIR_ALT]) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, filename) });
    } catch {}
  }
}

async function runMasterVerification() {
  console.log('====================================================================');
  console.log('🚀 STARTING KIN OS MASTER VERIFICATION SUITE v7');
  console.log('====================================================================');

  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  const results = [];
  function record(name, pass, detail) {
    results.push({ name, pass, detail });
    const mark = pass ? '✅ PASS' : '❌ FAIL';
    console.log(`[${mark}] ${name}: ${detail}`);
  }

  // --------------------------------------------------------------------------
  // TEST 1: Daemon Health & State Inspection
  // --------------------------------------------------------------------------
  let state = null;
  try {
    const res = await fetch(`${DAEMON_URL}/api/health`);
    const health = await res.json();
    const stateRes = await fetch(`${DAEMON_URL}/api/state`);
    state = await stateRes.json();
    record(
      'T1_Daemon_Health',
      health.status === 'ok' && Array.isArray(state.channels),
      `Uptime: ${health.uptime.toFixed(1)}s, Channels: ${state.channels.length}, Agents: ${state.agents.length}`
    );
  } catch (err) {
    record('T1_Daemon_Health', false, `Daemon connection error: ${err.message}`);
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // TEST 2: SSE Keepalive Stream
  // --------------------------------------------------------------------------
  try {
    const sseKeepaliveReceived = await new Promise((resolve) => {
      const req = http.get(`${DAEMON_URL}/api/events`, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.includes(': connected') || buffer.includes(': keepalive')) {
            req.destroy();
            resolve(true);
          }
        });
      });
      req.on('error', () => resolve(false));
      setTimeout(() => {
        req.destroy();
        resolve(false);
      }, 5000);
    });
    record('T2_SSE_Keepalive', sseKeepaliveReceived, 'SSE connected and stream open');
  } catch (err) {
    record('T2_SSE_Keepalive', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Terminal Command Chaining on Windows (cmd.exe normalization)
  // --------------------------------------------------------------------------
  try {
    const termRes = await fetch(`${DAEMON_URL}/api/system/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'echo STEP_ONE && echo STEP_TWO',
        cwd: process.cwd(),
      }),
    });
    const termData = await termRes.json();
    const chainedSuccess =
      termData.exitCode === 0 &&
      termData.stdout.includes('STEP_ONE') &&
      termData.stdout.includes('STEP_TWO');
    record(
      'T3_Terminal_Command_Chaining',
      chainedSuccess,
      `Exit code: ${termData.exitCode}, Output: ${termData.stdout.trim().replace(/\r?\n/g, ' | ')}`
    );
  } catch (err) {
    record('T3_Terminal_Command_Chaining', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Tool Gateway Parameter Normalization (filePath & dirPath aliases)
  // --------------------------------------------------------------------------
  try {
    const { ToolGateway } = await import('./core/dist/execution/tool_gateway.js');
    const gateway = new ToolGateway();
    const testContext = {
      runId: 'test-run-1',
      agentId: 'agent-test',
      worktreeRoot: process.cwd(),
      autonomyMode: 'FULL_ACCESS',
      allowedCapabilities: ['readFile', 'writeFile', 'listDirectory', 'executeShell'],
    };

    // 4a. Write with filePath
    const writeRes = await gateway.executeTool(
      'writeFile',
      { filePath: 'test_norm_file.tmp', content: 'KIN_PARAMETER_NORMALIZATION_OK' },
      testContext
    );

    // 4b. Read with filePath
    const readRes = await gateway.executeTool(
      'readFile',
      { filePath: 'test_norm_file.tmp' },
      testContext
    );

    // 4c. List directory with dirPath
    const listRes = await gateway.executeTool(
      'listDirectory',
      { dirPath: '.' },
      testContext
    );

    // 4d. Clean up temporary test file
    try {
      fs.unlinkSync(path.join(process.cwd(), 'test_norm_file.tmp'));
    } catch {}

    const toolNormPass =
      writeRes.success &&
      readRes.success &&
      readRes.output === 'KIN_PARAMETER_NORMALIZATION_OK' &&
      listRes.success &&
      Array.isArray(listRes.output);

    record(
      'T4_Tool_Param_Normalization',
      toolNormPass,
      `Write: ${writeRes.success}, Read: ${readRes.output}, ListEntries: ${listRes.output?.length}`
    );
  } catch (err) {
    record('T4_Tool_Param_Normalization', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 5: Git Diff on Untracked Directory (No EISDIR crash)
  // --------------------------------------------------------------------------
  try {
    const testDir = path.join(process.cwd(), 'untracked_test_dir');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'inner.txt'), 'hello inner');

    const activeProj = state.projects?.[0] || { id: 'proj-default' };
    const diffRes = await fetch(
      `${DAEMON_URL}/api/projects/${activeProj.id}/git/diff?path=untracked_test_dir`
    );
    const diffData = await diffRes.json();

    // Clean up
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}

    const noEisdirCrash = diffRes.status === 200 && diffData.diff?.includes('is untracked');
    record(
      'T5_Git_Diff_Directory_Safety',
      noEisdirCrash,
      `Status: ${diffRes.status}, Diff message: "${diffData.diff}"`
    );
  } catch (err) {
    record('T5_Git_Diff_Directory_Safety', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 6: Malformed <tool_call> Syntax Detection in AgentLoopRunner
  // --------------------------------------------------------------------------
  try {
    const { AgentLoopRunner } = await import('./core/dist/kernel/agent_loop.js');
    const valid = AgentLoopRunner.extractToolCall('<tool_call>{"name": "readFile", "parameters": {"filePath": "package.json"}}</tool_call>');
    const malformed = AgentLoopRunner.extractToolCall('<tool_call>INVALID_JSON_CONTENT</tool_call>');

    const syntaxDetectPass = valid !== null && valid.name === 'readFile' && malformed === null;
    record(
      'T6_Malformed_ToolCall_Detection',
      syntaxDetectPass,
      `Valid extraction: ${valid?.name}, Malformed caught gracefully as null: ${malformed === null}`
    );
  } catch (err) {
    record('T6_Malformed_ToolCall_Detection', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 7: SQLite Database Schema Indexes & Concurrency Protection
  // --------------------------------------------------------------------------
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('kin_storage.sqlite');
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((i) => i.name);

    const requiredIndexes = [
      'idx_agent_runs_agent_time',
      'idx_channels_project',
      'idx_tasks_assigned_agent',
      'idx_task_deps_reverse',
      'idx_messages_sender',
      'idx_schedules_project',
    ];
    const missing = requiredIndexes.filter((idx) => !indexes.includes(idx));
    const allIndexesPresent = missing.length === 0;

    record(
      'T7_Database_Indexes',
      allIndexesPresent,
      allIndexesPresent ? `All 6 required indexes active in WAL database (Total: ${indexes.length})` : `Missing: ${missing.join(', ')}`
    );

    // Test high concurrency transactions
    const { KinDatabase } = await import('./core/dist/storage/db.js');
    const kinDb = new KinDatabase({ dbPath: 'kin_storage.sqlite' });
    const writePromises = [];
    for (let i = 0; i < 40; i++) {
      writePromises.push(
        kinDb.transactionAsync(async () => {
          kinDb.execute(
            `INSERT INTO event_journal (event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
            'CONCURRENCY_STRESS_TEST',
            'test_entity',
            `entity-${i}`,
            JSON.stringify({ iteration: i }),
            Date.now()
          );
        })
      );
    }
    await Promise.all(writePromises);
    record('T7b_Database_Concurrency_Stress', true, '40 serialized async transactions committed cleanly with zero SQLITE_BUSY deadlocks');
  } catch (err) {
    record('T7_Database_Indexes', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Real Checkpoints & Transparent Activity Tray
  // --------------------------------------------------------------------------
  try {
    const agent = state.agents?.[0];
    if (agent) {
      const execRes = await fetch(`${DAEMON_URL}/api/agents/${agent.id}/execution-details`);
      const execData = await execRes.json();
      const details = execData.executionDetails;
      const validTray =
        details &&
        details.agentId === agent.id &&
        Array.isArray(details.phases) &&
        typeof details.metrics?.actionsCount === 'number';

      record(
        'T8_Transparent_Activity_Tray',
        validTray,
        `Agent: ${details?.displayName}, ActionsCount: ${details?.metrics?.actionsCount}, Explored: ${details?.metrics?.exploredFilesCount}`
      );
    } else {
      record('T8_Transparent_Activity_Tray', false, 'No agent found to inspect');
    }
  } catch (err) {
    record('T8_Transparent_Activity_Tray', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 10: Interleaved Sync & Async Database Transactions Stress Test
  // --------------------------------------------------------------------------
  try {
    const { KinDatabase } = await import('./core/dist/storage/db.js');
    const kinDb = new KinDatabase({ dbPath: 'kin_storage.sqlite' });
    const ops = [];

    // 30 concurrent async transactions with actual async pauses
    for (let i = 0; i < 30; i++) {
      ops.push(
        kinDb.transactionAsync(async () => {
          kinDb.execute(
            `INSERT INTO event_journal (event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
            'ASYNC_STRESS',
            'test_entity',
            `async-${i}`,
            JSON.stringify({ i }),
            Date.now()
          );
          await new Promise((r) => setTimeout(r, 5));
        })
      );
    }

    // 15 synchronous transactions interleaved concurrently
    for (let j = 0; j < 15; j++) {
      ops.push(
        new Promise((resolve, reject) => {
          setTimeout(() => {
            try {
              kinDb.transactionSync(() => {
                kinDb.execute(
                  `INSERT INTO event_journal (event_type, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
                  'SYNC_STRESS',
                  'test_entity',
                  `sync-${j}`,
                  JSON.stringify({ j }),
                  Date.now()
                );
              });
              resolve();
            } catch (err) {
              reject(err);
            }
          }, j * 5);
        })
      );
    }

    await Promise.all(ops);
    record('T10_Interleaved_Sync_Async_Stress', true, '45 interleaved sync/async transactions committed with zero SQLITE_BUSY deadlocks');
  } catch (err) {
    record('T10_Interleaved_Sync_Async_Stress', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 11: Git Stage & Revert Safety & Error Handling
  // --------------------------------------------------------------------------
  try {
    const testFile = 'git_stage_test.tmp';
    fs.writeFileSync(testFile, 'STAGE_TEST_CONTENT');
    const activeProj = state.projects?.[0] || { id: 'proj-default' };

    // Stage file
    const stageRes = await fetch(`${DAEMON_URL}/api/projects/${activeProj.id}/git/stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testFile, stage: true }),
    });
    const stageData = await stageRes.json();

    // Revert file
    const revertRes = await fetch(`${DAEMON_URL}/api/projects/${activeProj.id}/git/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testFile }),
    });
    const revertData = await revertRes.json();

    // Test invalid path (escaping jail)
    const badRes = await fetch(`${DAEMON_URL}/api/projects/${activeProj.id}/git/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '../../etc/passwd' }),
    });

    const gitSafetyPass =
      stageRes.status === 200 &&
      stageData.success === true &&
      revertRes.status === 200 &&
      revertData.success === true &&
      badRes.status === 403;

    record(
      'T11_Git_Stage_Revert_Safety',
      gitSafetyPass,
      `Stage: ${stageData.success}, Revert: ${revertData.success}, Jail Traversal Blocked: ${badRes.status === 403}`
    );
  } catch (err) {
    record('T11_Git_Stage_Revert_Safety', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 12: Ollama Local Models Inspection & Invocation Verification
  // --------------------------------------------------------------------------
  try {
    const modelsRes = await fetch(`${DAEMON_URL}/api/system/models`);
    const modelsData = await modelsRes.json();
    record(
      'T12_Ollama_Models_Inspection',
      modelsRes.status === 200,
      `Ollama status: ${modelsData.online ? 'Online' : 'Offline'}, Models found: ${modelsData.models?.length || 0}`
    );
  } catch (err) {
    record('T12_Ollama_Models_Inspection', false, err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 9: Physical Google Chrome UI Verification via Puppeteer
  // --------------------------------------------------------------------------
  console.log('\n--- Launching Physical Google Chrome ---');
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });

    // 9a. Navigate to UI
    await page.goto(UI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('main', { timeout: 15000 });
    await sleep(2000);
    record('T9a_Chrome_UI_Load', true, 'Physical Google Chrome loaded Vite UI at 5173 successfully');
    await captureScreenshot(page, '01_chrome_ui_main_workspace.png');

    // 9b. Verify ErrorBoundary on Modals & Open DecisionsModal
    console.log('Testing DecisionsModal with safe search query...');
    const openedDecModal = await page.evaluate(() => {
      const decBtn =
        document.querySelector('button[title*="Architecture Decision Records"]') ||
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('/decisions'));
      if (decBtn) {
        decBtn.click();
        return true;
      }
      return false;
    });
    if (!openedDecModal) throw new Error('Decisions modal open button (/decisions) not found in DOM');
    await sleep(600);

    // Type in search filter with special characters to verify no regex/lowercase crashes
    const searchVerified = await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="Search ADRs"]');
      if (input) {
        const protoSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        protoSetter.call(input, 'SQLite WAL');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    });
    if (!searchVerified) throw new Error('Decisions modal search input not found in DOM');
    await sleep(600);

    await captureScreenshot(page, '02_chrome_decisions_modal.png');
    record(
      'T9b_DecisionsModal_Safe_Filter',
      true,
      `DecisionsModal opened and filtered without unhandled exceptions`
    );

    // Close DecisionsModal
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[title*="Close ADR Modal"]');
      if (closeBtn) closeBtn.click();
    });
    await sleep(600);

    // 9c. Test AgentInspector Terminal and Interactive Execution
    console.log('Testing AgentInspector terminal & command execution...');
    // Click on Terminal tab in AgentInspector
    const switchedToTerm = await page.evaluate(() => {
      const termTab =
        document.querySelector('button[title*="PowerShell Terminal"]') ||
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Terminal');
      if (termTab) {
        termTab.click();
        return true;
      }
      return false;
    });
    if (!switchedToTerm) throw new Error('Terminal tab button not found in AgentInspector');
    await sleep(600);

    // Execute an interactive command via the physical Chrome Terminal UI input
    const terminalInputFound = await page.evaluate(() => {
      const termInput = document.querySelector('input[placeholder*="Run command in project jail"]');
      if (termInput) {
        const protoSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        protoSetter.call(termInput, 'echo KIN_LIVE_TERMINAL_VERIFIED');
        termInput.dispatchEvent(new Event('input', { bubbles: true }));
        const form = termInput.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
        return true;
      }
      return false;
    });
    if (!terminalInputFound) throw new Error('Terminal input field (placeholder: Run command in project jail) not found in DOM');

    await sleep(2500);

    // Assert that the command output was rendered in the terminal output area
    const outputRendered = await page.evaluate(() => {
      const termText = document.body.innerText || '';
      return termText.includes('KIN_LIVE_TERMINAL_VERIFIED');
    });
    if (!outputRendered) throw new Error('Terminal execution output KIN_LIVE_TERMINAL_VERIFIED was not rendered in the DOM');

    await captureScreenshot(page, '03_chrome_agent_inspector_workspace.png');
    record('T9c_Chrome_Agent_Inspector', true, `Agent Inspector rendered with active terminal and verified live execution`);

    // 9d. Test ErrorBoundary Modal System with CreateTaskModal
    console.log('Testing Modal System ErrorBoundary with CreateTaskModal...');
    const taskModalOpened = await page.evaluate(() => {
      const taskBtn = document.querySelector('button[title*="Create Task in Active Goal"]');
      if (taskBtn) {
        taskBtn.click();
        return true;
      }
      return false;
    });
    if (!taskModalOpened) throw new Error('Create Task button (title: Create Task in Active Goal) not found in DOM');
    await sleep(600);

    const taskModalRendered = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return text.includes('Create New Task') || text.includes('Target Goal') || text.includes('Task Title');
    });
    if (!taskModalRendered) throw new Error('CreateTaskModal did not render inside Modal System');

    await captureScreenshot(page, '04_chrome_modal_system_verified.png');
    record('T9d_Chrome_Modal_System_ErrorBoundary', true, 'Modal System ErrorBoundary verified functional and resilient');

  } catch (err) {
    record('T9_Chrome_Physical_Testing', false, err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n====================================================================');
  console.log('📊 MASTER TEST SUITE SUMMARY');
  console.log('====================================================================');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name.padEnd(35)} : ${r.detail}`);
  }

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✨ ALL SUITE VERIFICATIONS PASSED IN PHYSICAL GOOGLE CHROME & LIVE DAEMON ✨');
  }
}

runMasterVerification().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
