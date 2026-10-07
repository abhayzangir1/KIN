import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutputSpiller } from '../src/context/output_spiller.js';
import { ContextCompactor } from '../src/context/context_compactor.js';
import { ContextCompiler } from '../src/context/context_compiler.js';
import { AgentDefinition, AgentIdentity, Message } from '../src/domain/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Phase 5: Context Compiler, Spiller & Compactor Engine', () => {
  let tempSpillDir: string;
  let spiller: OutputSpiller;
  let compactor: ContextCompactor;
  let compiler: ContextCompiler;

  beforeEach(() => {
    tempSpillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-spill-test-'));
    spiller = new OutputSpiller({ spillDir: tempSpillDir, thresholdBytes: 2048 });
    compactor = new ContextCompactor();
    compiler = new ContextCompiler();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempSpillDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows file lock delays
    }
  });

  it('keeps outputs <= 2KB inline without disk write', () => {
    const smallOutput = 'Build successful: 4 tests passed, 0 failures.';
    const result = spiller.processOutput(smallOutput);

    expect(result.isSpilled).toBe(false);
    expect(result.content).toBe(smallOutput);
    expect(result.spillUri).toBeUndefined();
    expect(fs.readdirSync(tempSpillDir)).toHaveLength(0);
  });

  it('spills outputs > 2KB to disk and generates bounded preview with URI pointer', () => {
    // Generate a 10KB build log with 200 lines
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: Compiling module_xyz_${i}.ts [info: compiling]`);
    const largeOutput = lines.join('\n');
    expect(Buffer.byteLength(largeOutput, 'utf-8')).toBeGreaterThan(2048);

    const result = spiller.processOutput(largeOutput, 'npm run build');

    expect(result.isSpilled).toBe(true);
    expect(result.spillUri).toBeDefined();
    expect(result.hash).toBeDefined();

    // Verify file written to disk
    const files = fs.readdirSync(tempSpillDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${result.hash}.log`);

    // Verify preview contains head, tail, and pointer
    expect(result.content).toContain('[Command: npm run build]');
    expect(result.content).toContain('Line 1: Compiling');
    expect(result.content).toContain('Line 200: Compiling');
    expect(result.content).toContain('spilled to disk');
    expect(result.content).toContain(result.spillUri!);

    // Verify reading raw content back from disk matches original exactly
    const rawOnDisk = spiller.readSpillFile(result.hash!);
    expect(rawOnDisk).toBe(largeOutput);
  });

  it('triggers structured auto-compaction and observation masking when token threshold exceeded', () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        channelId: 'chan-1',
        senderId: 'user-1',
        senderType: 'human',
        content: 'Build the auth API and database schema.',
        mentions: [],
        productivityScore: 10,
        createdAt: 1000,
      },
      {
        id: 'msg-2',
        channelId: 'chan-1',
        senderId: 'agent-1',
        senderType: 'agent',
        content: 'Inspecting repo files and planning schema.',
        mentions: [],
        productivityScore: 20,
        createdAt: 2000,
      },
      {
        id: 'msg-3',
        channelId: 'chan-1',
        senderId: 'agent-1',
        senderType: 'agent',
        content: '[Command: git status]\nM src/api.ts\n[Full raw output (4500 bytes) persisted at: file:///spill/abc.log]',
        mentions: [],
        productivityScore: 40,
        createdAt: 3000,
      },
      {
        id: 'msg-4',
        channelId: 'chan-1',
        senderId: 'agent-1',
        senderType: 'agent',
        content: 'Running database migrations and checking test suites.',
        mentions: [],
        productivityScore: 50,
        createdAt: 4000,
      },
      {
        id: 'msg-5',
        channelId: 'chan-1',
        senderId: 'agent-1',
        senderType: 'agent',
        content: 'Ready to write the authentication endpoint.',
        mentions: [],
        productivityScore: 60,
        createdAt: 5000,
      },
    ];

    const compaction = compactor.evaluateAndCompact({
      messages,
      currentTokens: 8500,
      maxTokens: 10000, // 85% > 75% threshold
      snapshotState: {
        goalId: 'goal-101',
        primaryObjective: 'Build auth API',
        completedTasks: [{ id: 'task-1', title: 'Database schema created', evidenceUri: 'file:///evidence/1.log' }],
        activeTask: { id: 'task-2', title: 'Build auth endpoint', currentStep: 'Implementing JWT handler' },
        modifiedFiles: [{ path: 'src/schema.sql', gitHash: 'a1b2c3d' }],
        encounteredErrorsAndResolutions: [{ error: 'Port in use', fixApplied: 'Killed stale test process' }],
        immutableDecisions: [{ key: 'AuthFormat', decision: 'JWT bearer tokens' }],
        pendingTaskDag: [{ id: 'task-3', title: 'Add auth tests', dependsOn: ['task-2'] }],
      },
    });

    expect(compaction.didCompact).toBe(true);
    expect(compaction.snapshot).toBeDefined();
    expect(compaction.snapshot?.primaryObjective).toBe('Build auth API');
    expect(compaction.tokensAfter).toBeLessThan(compaction.tokensBefore);

    // Verify messages: should have first message, snapshot message, and recent messages
    expect(compaction.compactedMessages.length).toBeLessThan(messages.length);
    expect(compaction.compactedMessages[0].content).toContain('Build the auth API');
    expect(compaction.compactedMessages[1].content).toContain('SYSTEM COMPACTION SNAPSHOT');
  });

  it('compiles prefix-stable 5-block prompt for 90%+ KV cache hit rate', () => {
    const def: AgentDefinition = {
      id: 'def-1',
      name: 'Architect',
      role: 'System Architect',
      systemPrompt: 'Design scalable, decoupled distributed systems.',
      defaultModelId: 'claude-3-5-sonnet',
      domainAuthority: ['architecture', 'api'],
      capabilities: ['fs_read'],
      createdAt: 100,
    };

    const identity: AgentIdentity = {
      id: 'agent-arch',
      workspaceId: 'ws-1',
      definitionId: 'def-1',
      displayName: '@Architect',
      activeModelId: 'anthropic/claude-3-5-sonnet',
      isOrchestrator: true,
      isEphemeral: false,
      createdAt: 100,
      updatedAt: 100,
    };

    const tools = [
      { name: 'writeFile', description: 'Writes a file', parameters: {} },
      { name: 'executeShell', description: 'Runs command', parameters: {} },
      { name: 'readFile', description: 'Reads a file', parameters: {} },
    ];

    const decisions = [{ key: 'DB_MODE', decision: 'SQLite WAL mode' }];

    const turn1 = compiler.compile({
      agentDefinition: def,
      agentIdentity: identity,
      toolSchemas: tools,
      projectDecisions: decisions,
      trajectoryMessages: [
        {
          id: 'm1',
          channelId: 'c1',
          senderId: 'u1',
          senderType: 'human',
          content: 'Hello agent.',
          mentions: [],
          productivityScore: 0,
          createdAt: 1,
        },
      ],
    });

    const turn2 = compiler.compile({
      agentDefinition: def,
      agentIdentity: identity,
      toolSchemas: tools,
      projectDecisions: decisions,
      trajectoryMessages: [
        {
          id: 'm1',
          channelId: 'c1',
          senderId: 'u1',
          senderType: 'human',
          content: 'Hello agent.',
          mentions: [],
          productivityScore: 0,
          createdAt: 1,
        },
        {
          id: 'm2',
          channelId: 'c1',
          senderId: 'agent-arch',
          senderType: 'agent',
          content: 'How can I assist you with the architecture today?',
          mentions: [],
          productivityScore: 0,
          createdAt: 2,
        },
      ],
    });

    // Invariant: Prefix blocks (1, 2, 3) must be strictly byte-for-byte identical across turns
    expect(turn1.systemPromptBlock).toBe(turn2.systemPromptBlock);
    expect(turn1.toolSchemasBlock).toBe(turn2.toolSchemasBlock);
    expect(turn1.projectGroundingBlock).toBe(turn2.projectGroundingBlock);

    // Verify tools are sorted deterministically (executeShell, readFile, writeFile)
    expect(turn1.toolSchemasBlock.indexOf('executeShell')).toBeLessThan(turn1.toolSchemasBlock.indexOf('readFile'));
    expect(turn1.toolSchemasBlock.indexOf('readFile')).toBeLessThan(turn1.toolSchemasBlock.indexOf('writeFile'));
  });

  it('compiles cross-channel awareness and peer presence in Block 1', () => {
    const def: AgentDefinition = {
      id: 'def-res',
      name: 'ResearchAgent',
      role: 'Research Specialist',
      systemPrompt: 'Conduct deep technical research.',
      defaultModelId: 'qwen2.5-coder:3b',
      domainAuthority: ['research'],
      capabilities: ['read'],
      createdAt: 100,
    };

    const identity: AgentIdentity = {
      id: 'agent-res',
      workspaceId: 'ws-1',
      projectId: 'proj-kin',
      definitionId: 'def-res',
      displayName: '@ResearchAgent',
      activeModelId: 'ollama/qwen2.5-coder:3b',
      isOrchestrator: false,
      isEphemeral: false,
      createdAt: 100,
      updatedAt: 100,
    };

    const compiled = compiler.compile({
      agentDefinition: def,
      agentIdentity: identity,
      toolSchemas: [],
      projectDecisions: [],
      trajectoryMessages: [],
      activeChannel: { id: 'chan-b', name: 'channel-b', topic: 'Testing' },
      channelPeers: ['@Boss'],
      assignedChannels: ['#channel-a', '#channel-b'],
      projectAgents: ['@Boss', '@ResearchAgent'],
    });

    expect(compiled.systemPromptBlock).toContain('Current Channel / Context: #channel-b');
    expect(compiled.systemPromptBlock).toContain('Peers in this channel: @Boss');
    expect(compiled.systemPromptBlock).toContain('Channels you are assigned to: #channel-a, #channel-b');
    expect(compiled.systemPromptBlock).toContain('All Agents in this project: @Boss, @ResearchAgent');
  });

  it('compiles cross-channel operational memory from prior assigned channels in Block 1', () => {
    const def: AgentDefinition = {
      id: 'def-res',
      name: 'ResearchAgent',
      role: 'Research Specialist',
      systemPrompt: 'Conduct deep technical research.',
      defaultModelId: 'qwen2.5-coder:3b',
      domainAuthority: ['research'],
      capabilities: ['read'],
      createdAt: 100,
    };

    const identity: AgentIdentity = {
      id: 'agent-res',
      workspaceId: 'ws-1',
      projectId: 'proj-kin',
      definitionId: 'def-res',
      displayName: '@ResearchAgent',
      activeModelId: 'ollama/qwen2.5-coder:3b',
      isOrchestrator: false,
      isEphemeral: false,
      createdAt: 100,
      updatedAt: 100,
    };

    const compiled = compiler.compile({
      agentDefinition: def,
      agentIdentity: identity,
      toolSchemas: [],
      projectDecisions: [],
      trajectoryMessages: [],
      activeChannel: { id: 'chan-b', name: 'channel-b', topic: 'Testing' },
      channelPeers: ['@Boss'],
      assignedChannels: ['#channel-a', '#channel-b'],
      projectAgents: ['@Boss', '@ResearchAgent'],
      crossChannelSummaries: [
        {
          channelName: 'channel-a',
          topic: 'Architecture Research',
          recentMessages: [
            { senderName: 'Human', content: 'What is the SQLite database design?' },
            { senderName: '@ResearchAgent', content: 'Identified 22 tables with strict foreign keys.' },
          ],
        },
      ],
    });

    expect(compiled.systemPromptBlock).toContain('Cross-Channel Operational Memory:');
    expect(compiled.systemPromptBlock).toContain('- Channel #channel-a (Architecture Research):');
    expect(compiled.systemPromptBlock).toContain('• [Human]: What is the SQLite database design?');
    expect(compiled.systemPromptBlock).toContain('• [@ResearchAgent]: Identified 22 tables with strict foreign keys.');
    expect(compiled.systemPromptBlock).toContain('Channel Scoping Rule:');
  });
});
