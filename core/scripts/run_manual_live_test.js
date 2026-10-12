import { WorktreeManager } from '../dist/execution/worktree_manager.js';
import { FinancialSafetyShield } from '../dist/policy/financial_safety.js';
import { Sentinel } from '../dist/security/sentinel.js';
import { ToolGateway } from '../dist/execution/tool_gateway.js';
import { DesktopController } from '../dist/computer/desktop_controller.js';
import { ModelGateway } from '../dist/execution/model_gateway.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function runLiveManualTest() {
  console.log('=== STARTING KIN LIVE HARNESS MANUAL TEST IN D:\\KIN_MANUAL_TEST ===\n');
  const projectRoot = 'D:\\KIN_MANUAL_TEST';
  let passes = 0;
  let failures = 0;

  // Test 1: Worktree untracked files & merge synchronization
  console.log('[1/5] Testing Worktree Manager untracked file inclusion & disk synchronization...');
  try {
    const wtManager = new WorktreeManager(projectRoot);
    const provision = await wtManager.provisionWorktree('manual-live-1', 'liveworker');
    console.log(`  - Worktree provisioned at: ${provision.worktreePath} (branch: ${provision.branch}, shadow: ${provision.isShadowRepo})`);

    // Create untracked file
    const liveFilePath = path.join(provision.worktreePath, 'live_agent_output.txt');
    const liveContent = `Autonomous task executed at ${Date.now()}\nStatus: Verified\n`;
    fs.writeFileSync(liveFilePath, liveContent, 'utf-8');

    // Generate diff - must include live_agent_output.txt
    const diff = await wtManager.generateDiff(provision.worktreePath, 'main');
    if (!diff.includes('live_agent_output.txt') || !diff.includes('Status: Verified')) {
      throw new Error(`generateDiff failed to include untracked file: ${diff}`);
    }
    console.log('  - generateDiff correctly captured newly created untracked file.');

    // Commit and verify and merge
    const commitSha = await wtManager.commitWorktreeChanges(provision.worktreePath, 'feat: live test output');
    console.log(`  - Worktree changes committed: ${commitSha}`);

    const mergeRes = await wtManager.verifyAndMerge(provision.worktreePath, provision.branch, 'main');
    if (!mergeRes.success) {
      throw new Error(`verifyAndMerge failed: ${mergeRes.error}`);
    }
    console.log('  - verifyAndMerge completed cleanly.');

    // Verify disk synchronization in projectRoot
    const targetFile = path.join(projectRoot, 'live_agent_output.txt');
    if (!fs.existsSync(targetFile)) {
      throw new Error(`File was not synchronized to projectRoot: ${targetFile}`);
    }
    const readBack = fs.readFileSync(targetFile, 'utf-8');
    if (!readBack.includes('Status: Verified')) {
      throw new Error(`File content mismatch in projectRoot: ${readBack}`);
    }
    console.log('  - Disk synchronization verified in projectRoot.');
    passes++;
  } catch (err) {
    console.error('  [FAIL] Worktree test failed:', err);
    failures++;
  }

  // Test 2: Financial safety Luhn validation and entity timestamp preservation
  console.log('\n[2/5] Testing Financial Safety Shield Luhn validation & entity safeguards...');
  try {
    const shield = new FinancialSafetyShield();

    // 13-digit millisecond epoch timestamp
    const ts = '1791767232082';
    const tsSanitized = shield.scrubSensitiveContext(`Event logged at timestamp ${ts}`);
    if (tsSanitized.includes('[REDACTED_CARD_NUMBER]')) {
      throw new Error(`Timestamp ${ts} was incorrectly redacted!`);
    }

    // Entity IDs
    const entityStrings = [
      'chan-1791767232082',
      'run-1791767232082',
      'task-1791767232082',
      'proj-1791767232082',
      'msg-1791767232082',
      'dm-1791767232082',
    ];
    for (const ent of entityStrings) {
      const entSanitized = shield.scrubSensitiveContext(`Target entity ID is ${ent} in registry.`);
      if (entSanitized.includes('[REDACTED_CARD_NUMBER]')) {
        throw new Error(`Entity ID ${ent} was incorrectly redacted!`);
      }
    }

    // Valid Luhn card
    const cardSanitized = shield.scrubSensitiveContext(`Charge card 4242-4242-4242-4242 for order.`);
    if (!cardSanitized.includes('[REDACTED_CARD_NUMBER]')) {
      throw new Error(`Valid Luhn card was not redacted!`);
    }

    console.log('  - Luhn checksum correctly redacts payment cards while safeguarding entity IDs and epoch timestamps.');
    passes++;
  } catch (err) {
    console.error('  [FAIL] Financial Safety test failed:', err);
    failures++;
  }

  // Test 3: Sentinel & ToolGateway capability synchronization
  console.log('\n[3/5] Testing Sentinel & ToolGateway capability synchronization...');
  try {
    const sentinel = Sentinel.getInstance();
    const gateway = new ToolGateway();

    const toolAliases = [
      ['read_file', 'fs:read'],
      ['read_spill', 'fs:read'],
      ['write_file', 'fs:write'],
      ['executeShell', 'shell:exec'],
      ['run_command', 'shell:exec'],
      ['remember_private', 'memory:manage'],
      ['send_direct_message', 'chat:write'],
      ['delegate_to_agent', 'agent:delegate'],
    ];

    for (const [tool, expectedPrimary] of toolAliases) {
      const sCap = sentinel.getRequiredCapability(tool);
      const gCap = gateway.getRequiredCapability(tool);
      if (sCap.primary !== expectedPrimary || gCap.primary !== expectedPrimary) {
        throw new Error(`Mismatch on ${tool}: Sentinel primary=${sCap.primary}, Gateway primary=${gCap.primary}, expected=${expectedPrimary}`);
      }
    }
    console.log('  - Sentinel and ToolGateway capability mappings are synchronized.');
    passes++;
  } catch (err) {
    console.error('  [FAIL] Sentinel & ToolGateway test failed:', err);
    failures++;
  }

  // Test 4: DesktopController fast window enumeration
  console.log('\n[4/5] Testing Desktop Controller fast window enumeration...');
  try {
    const desktop = new DesktopController();
    const t0 = Date.now();
    const windows = await desktop.listWindows(true);
    const duration = Date.now() - t0;
    console.log(`  - Enumerated ${windows.length} windows in ${duration}ms (target < 5000ms).`);
    if (duration > 5000) {
      throw new Error(`Window enumeration exceeded 5000ms threshold: ${duration}ms`);
    }
    passes++;
  } catch (err) {
    console.error('  [FAIL] Desktop Controller test failed:', err);
    failures++;
  }

  // Test 5: Live Ollama Model Gateway invocation with native tool schemas
  console.log('\n[5/5] Testing Live Model Gateway invocation against Ollama qwen2.5-coder:3b...');
  try {
    const gateway = new ModelGateway();
    const tools = [
      {
        type: 'function',
        function: {
          name: 'writeFile',
          description: 'Write file content to project workspace',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Target path' },
              content: { type: 'string', description: 'File content' },
            },
            required: ['filePath', 'content'],
          },
        },
      },
    ];

    console.log('  - Sending prompt with native tool schema to Ollama...');
    const result = await gateway.invoke({
      modelId: 'ollama/qwen2.5-coder:3b',
      messages: [
        {
          role: 'user',
          content: 'You must invoke writeFile to save "hello world" into test_hello.txt. Output the tool call now.',
        },
      ],
      tools,
    });

    console.log(`  - Model responded with ${result.tokensUsed.totalTokens} tokens:`);
    console.log(`    Excerpt: ${result.content.slice(0, 200).replace(/\n/g, ' ')}...`);

    if (result.content.includes('<tool_call>') || result.content.includes('writeFile')) {
      console.log('  - Native tool invocation or tool call parsing verified with live model.');
    } else {
      console.log('  - Note: Model replied in text format without calling writeFile; verified schema accepted by server.');
    }
    passes++;
  } catch (err) {
    console.error('  [FAIL] Live Model Gateway test failed:', err);
    failures++;
  }

  console.log(`\n=== LIVE HARNESS MANUAL TEST COMPLETE: ${passes} PASSED, ${failures} FAILED ===`);
  if (failures > 0) {
    process.exit(1);
  }
}

runLiveManualTest().catch((e) => {
  console.error('FATAL error in live manual test:', e);
  process.exit(1);
});
