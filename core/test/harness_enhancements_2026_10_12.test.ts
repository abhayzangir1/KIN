import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FinancialSafetyShield } from '../src/policy/financial_safety.js';
import { Sentinel } from '../src/security/sentinel.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { DesktopController } from '../src/computer/desktop_controller.js';
import { WorktreeManager } from '../src/execution/worktree_manager.js';
import { ModelGateway } from '../src/execution/model_gateway.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('KIN Agent Harness Enhancements & Hardening Suite (2026-10-12)', () => {
  let tempBaseDir: string;

  beforeEach(() => {
    const tmp = process.env.TEMP || process.env.TMP || '/tmp';
    tempBaseDir = path.join(tmp, `kin-enhancement-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(tempBaseDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempBaseDir)) {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Financial Safety: Luhn Checksum & Entity Timestamp Safeguards', () => {
    const shield = new FinancialSafetyShield();

    it('redacts valid Luhn card numbers while leaving non-card digit strings intact', () => {
      // 4242424242424242 is a valid Luhn test card
      const validCard = '4242424242424242';
      expect(FinancialSafetyShield.isValidLuhn(validCard)).toBe(true);
      const textWithValidCard = `Payment received with card ${validCard}.`;
      const scrubbed = shield.scrubSensitiveContext(textWithValidCard);
      expect(scrubbed).toContain('[REDACTED_CARD_NUMBER]');
      expect(scrubbed).not.toContain(validCard);

      // Non-Luhn number without card formatting or context is not redacted
      const nonLuhnNum = '9876543210987654';
      if (!FinancialSafetyShield.isValidLuhn(nonLuhnNum)) {
        const textWithNonCard = `Order reference number is ${nonLuhnNum} confirmed.`;
        const scrubbedNonCard = shield.scrubSensitiveContext(textWithNonCard);
        expect(scrubbedNonCard).toContain(nonLuhnNum);
      }
    });

    it('safeguards 13-digit millisecond epoch timestamps from accidental redaction', () => {
      const timestamp = '1791767232082';
      const sample = `Execution started at ${timestamp} for scheduled heartbeat.`;
      const result = shield.scrubSensitiveContext(sample);
      expect(result).toBe(sample);
      expect(result).not.toContain('[REDACTED_CARD_NUMBER]');
    });

    it('rejects all-zero candidate strings from Luhn validation', () => {
      const allZeros = '0000000000000000';
      expect(FinancialSafetyShield.isValidLuhn(allZeros)).toBe(false);
      const sample = `Buffer mask: ${allZeros}`;
      const result = shield.scrubSensitiveContext(sample);
      expect(result).toBe(sample);
      expect(result).not.toContain('[REDACTED_CARD_NUMBER]');
    });

    it('preserves channel, run, task, project, message, and dm entity identifiers across diverse separators', () => {
      const entityIds = [
        'chan-1791767232082',
        'run-1791767232082',
        'task-1791767232082',
        'proj-1791767232082',
        'msg-1791767232082',
        'dm-1791767232082',
        'task:1791767232082',
        'taskId=1791767232082',
      ];

      for (const id of entityIds) {
        const text = `Processing event for entity ${id} in background queue.`;
        const sanitized = shield.scrubSensitiveContext(text);
        expect(sanitized).toBe(text);
        expect(sanitized).not.toContain('[REDACTED_CARD_NUMBER]');
      }
    });
  });

  describe('2. Sentinel & ToolGateway Capability Alignment & Aliases', () => {
    const sentinel = Sentinel.getInstance();
    const gateway = new ToolGateway();

    it('synchronizes required capabilities across Sentinel and ToolGateway', () => {
      const toolsToTest = [
        'read_spill',
        'read_file',
        'readFile',
        'write_file',
        'writeFile',
        'executeShell',
        'shell',
        'execute',
        'terminal',
        'bash',
        'cmd',
        'run_command',
        'remember_private',
        'rememberPrivate',
        'send_direct_message',
        'sendDirectMessage',
        'delegate_to_agent',
        'delegateToAgent',
      ];

      for (const tool of toolsToTest) {
        const sentinelCap = sentinel.getRequiredCapability(tool);
        const gatewayCap = gateway.getRequiredCapability(tool);
        expect(sentinelCap.primary).toBe(gatewayCap.primary);
      }
    });

    it('authorizes tool aliases cleanly through ToolGateway', () => {
      const checkShell = gateway.checkCapabilityAuthorized('run_command', ['shell:exec']);
      expect(checkShell.authorized).toBe(true);

      const checkRead = gateway.checkCapabilityAuthorized('read_file', ['fs:read']);
      expect(checkRead.authorized).toBe(true);

      const checkWrite = gateway.checkCapabilityAuthorized('write_file', ['fs:write']);
      expect(checkWrite.authorized).toBe(true);

      const checkChat = gateway.checkCapabilityAuthorized('send_direct_message', ['chat:write']);
      expect(checkChat.authorized).toBe(true);

      const checkDelegate = gateway.checkCapabilityAuthorized('delegate_to_agent', ['agent:delegate']);
      expect(checkDelegate.authorized).toBe(true);
    });
  });

  describe('3. Desktop Controller Fast Process Enumeration', () => {
    it('executes listWindows and returns structured window entries or empty fallback', async () => {
      const controller = new DesktopController();
      const windows = await controller.listWindows(true);
      expect(Array.isArray(windows)).toBe(true);
      for (const win of windows) {
        expect(win.handle).toBeDefined();
        expect(win.title).toBeDefined();
        expect(win.processName).toBeDefined();
        expect(typeof win.pid).toBe('number');
      }
    });
  });

  describe('4. Worktree Untracked File Inclusion & Merge Synchronization', () => {
    it('includes newly created untracked files in generateDiff via intent-to-add', async () => {
      // 1. Initialize git repo
      await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: tempBaseDir });
      await execFileAsync('git', ['config', 'user.name', 'Harness Tester'], { cwd: tempBaseDir });
      await execFileAsync('git', ['config', 'user.email', 'tester@local'], { cwd: tempBaseDir });

      fs.writeFileSync(path.join(tempBaseDir, 'base.txt'), 'Initial root file\n');
      await execFileAsync('git', ['add', 'base.txt'], { cwd: tempBaseDir });
      await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempBaseDir });

      const manager = new WorktreeManager(tempBaseDir);
      const provision = await manager.provisionWorktree('test-untracked-1', 'worker');

      // 2. Create brand new file without git add
      const untrackedFile = path.join(provision.worktreePath, 'untracked_new.txt');
      fs.writeFileSync(untrackedFile, 'Brand new untracked content\n');

      // 3. Diff must detect untracked file
      const diff = await manager.generateDiff(provision.worktreePath, 'main');
      expect(diff).toContain('untracked_new.txt');
      expect(diff).toContain('+Brand new untracked content');

      // 4. Commit and merge
      await manager.commitWorktreeChanges(provision.worktreePath, 'feat: add untracked file');
      const mergeRes = await manager.verifyAndMerge(provision.worktreePath, provision.branch, 'main');
      expect(mergeRes.success).toBe(true);

      // 5. Working tree in tempBaseDir must now contain the merged file on disk
      const mergedFilePath = path.join(tempBaseDir, 'untracked_new.txt');
      expect(fs.existsSync(mergedFilePath)).toBe(true);
      expect(fs.readFileSync(mergedFilePath, 'utf-8').trim()).toBe('Brand new untracked content');
    });

    it('synchronizes shadow repo merges faithfully to projectRoot', async () => {
      // Non-git directory
      const shadowTestDir = path.join(tempBaseDir, 'non_git_project');
      fs.mkdirSync(shadowTestDir, { recursive: true });
      fs.writeFileSync(path.join(shadowTestDir, 'source.txt'), 'Original source content\n');

      const manager = new WorktreeManager(shadowTestDir);
      const provision = await manager.provisionWorktree('shadow-task-1', 'coder');
      expect(provision.isShadowRepo).toBe(true);

      // Create new file in shadow worktree
      const createdFile = path.join(provision.worktreePath, 'created_in_worktree.txt');
      fs.writeFileSync(createdFile, 'Hello from shadow worktree\n');

      const diff = await manager.generateDiff(provision.worktreePath, 'main');
      expect(diff).toContain('created_in_worktree.txt');

      await manager.commitWorktreeChanges(provision.worktreePath, 'feat: shadow worktree file');
      const mergeRes = await manager.verifyAndMerge(provision.worktreePath, provision.branch, 'main');
      expect(mergeRes.success).toBe(true);

      // File must be synchronized back to shadowTestDir
      const syncedFile = path.join(shadowTestDir, 'created_in_worktree.txt');
      expect(fs.existsSync(syncedFile)).toBe(true);
      expect(fs.readFileSync(syncedFile, 'utf-8').trim()).toBe('Hello from shadow worktree');
    });
    it('captures both modified tracked files and newly created untracked files in generateDiff simultaneously', async () => {
      const mixedDir = path.join(tempBaseDir, 'mixed_git_repo');
      fs.mkdirSync(mixedDir, { recursive: true });
      await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: mixedDir });
      await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: mixedDir });
      await execFileAsync('git', ['config', 'user.email', 'tester@local'], { cwd: mixedDir });

      fs.writeFileSync(path.join(mixedDir, 'existing.txt'), 'version 1\n');
      await execFileAsync('git', ['add', 'existing.txt'], { cwd: mixedDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: mixedDir });

      const manager = new WorktreeManager(mixedDir);
      const provision = await manager.provisionWorktree('mixed-task-1', 'worker');

      // Modify existing file
      fs.writeFileSync(path.join(provision.worktreePath, 'existing.txt'), 'version 2 modified\n');
      // Create new untracked file
      fs.writeFileSync(path.join(provision.worktreePath, 'brand_new.txt'), 'newly created content\n');

      const diff = await manager.generateDiff(provision.worktreePath, 'main');
      expect(diff).toContain('existing.txt');
      expect(diff).toContain('version 2 modified');
      expect(diff).toContain('brand_new.txt');
      expect(diff).toContain('newly created content');
    });
  });

  describe('5. Native Tool Calling Schema in Model Gateway', () => {
    it('passes tools parameter to Ollama and converts tool_calls into canonical XML blocks', async () => {
      const gateway = new ModelGateway({ ollamaHost: 'http://127.0.0.1:9999' });

      // Mock global fetch
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
          const body = JSON.parse(init.body);
          expect(body.tools).toBeDefined();
          expect(body.tools.length).toBe(1);
          expect(body.tools[0].function.name).toBe('writeFile');

          // Return stream chunks with tool_calls
          const chunk1 = JSON.stringify({
            message: {
              role: 'assistant',
              content: 'Creating file now.',
              tool_calls: [
                {
                  function: {
                    name: 'writeFile',
                    arguments: { filePath: 'src/main.ts', content: 'console.log("ready");' },
                  },
                },
              ],
            },
            done: true,
          }) + '\n';

          return {
            ok: true,
            status: 200,
            text: async () => chunk1,
            body: null,
          } as any;
        });

        const result = await gateway.invoke({
          modelId: 'ollama/qwen2.5-coder:3b',
          messages: [{ role: 'user', content: 'Create src/main.ts' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'writeFile',
                description: 'Write file to disk',
                parameters: { type: 'object', properties: { filePath: { type: 'string' } } },
              },
            },
          ],
        });

        expect(result.content).toContain('<tool_call>');
        expect(result.content).toContain('"name": "writeFile"');
        expect(result.content).toContain('src/main.ts');
        expect(result.content).toContain('</tool_call>');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deduplicates tool calls when streamed across multiple chunks without repeating XML blocks', async () => {
      const gateway = new ModelGateway({ ollamaHost: 'http://127.0.0.1:9999' });
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
          // Chunk 1 and chunk 2 both contain the identical tool_call
          const chunk1 = JSON.stringify({
            message: {
              role: 'assistant',
              content: 'Thinking...',
              tool_calls: [
                {
                  id: 'call_1',
                  function: {
                    name: 'readFile',
                    arguments: { filePath: 'package.json' },
                  },
                },
              ],
            },
            done: false,
          }) + '\n';
          const chunk2 = JSON.stringify({
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  function: {
                    name: 'readFile',
                    arguments: { filePath: 'package.json' },
                  },
                },
              ],
            },
            done: true,
          }) + '\n';

          return {
            ok: true,
            status: 200,
            text: async () => chunk1 + chunk2,
            body: null,
          } as any;
        });

        const result = await gateway.invoke({
          modelId: 'ollama/qwen2.5-coder:3b',
          messages: [{ role: 'user', content: 'Read package.json' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'readFile',
                parameters: { type: 'object' },
              },
            },
          ],
        });

        // Must contain exactly one <tool_call> block, not two
        const toolCallCount = (result.content.match(/<tool_call>/g) || []).length;
        expect(toolCallCount).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
