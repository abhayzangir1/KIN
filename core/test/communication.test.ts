import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { ChannelService } from '../src/communication/channel_service.js';
import { LoopBreaker } from '../src/communication/loop_breaker.js';
import { ActivationEngine } from '../src/communication/activation_engine.js';
import { AgentIdentity, Message } from '../src/domain/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('KIN Phase 2: Communication Engine, Mentions & Selective Activation', () => {
  let db: KinDatabase;
  let tempDbPath: string;
  let channelService: ChannelService;
  let loopBreaker: LoopBreaker;
  let activationEngine: ActivationEngine;

  const mockAgentFrontend: AgentIdentity = {
    id: 'agent-fe',
    workspaceId: 'ws-1',
    definitionId: 'def-fe',
    displayName: '@FrontendLead',
    activeModelId: 'anthropic/claude-3-5-sonnet',
    isOrchestrator: false,
    isEphemeral: false,
    createdAt: 100,
    updatedAt: 100,
  };

  const mockAgentBackend: AgentIdentity = {
    id: 'agent-be',
    workspaceId: 'ws-1',
    definitionId: 'def-be',
    displayName: '@BackendLead',
    activeModelId: 'openai/gpt-4o',
    isOrchestrator: false,
    isEphemeral: false,
    createdAt: 100,
    updatedAt: 100,
  };

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-comm-test-'));
    tempDbPath = path.join(tempDir, 'kin_comm.sqlite');
    db = new KinDatabase({ dbPath: tempDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    channelService = new ChannelService(db);
    loopBreaker = new LoopBreaker();
    activationEngine = new ActivationEngine();

    // Seed workspace, project, channel
    const now = Date.now();
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      'ws-1',
      'Test WS',
      '/ws',
      'AUTO',
      now,
      now
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      'proj-1',
      'ws-1',
      'Project Alpha',
      '/repo',
      now,
      now
    );
    db.execute(
      `INSERT INTO channels (id, project_id, name, created_at) VALUES (?, ?, ?, ?)`,
      'chan-arch',
      'proj-1',
      'architecture',
      now
    );
  });

  afterEach(() => {
    db.close();
    try {
      const dir = path.dirname(tempDbPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows file lock delays
    }
  });

  it('persists messages, extracts mentions, and scores initial productivity', () => {
    const msg = channelService.sendMessage({
      channelId: 'chan-arch',
      senderId: 'user-1',
      senderType: 'human',
      content: 'Hey @FrontendLead and @BackendLead, please review the API contract.',
    });

    expect(msg.id).toBeDefined();
    expect(msg.mentions).toEqual(['FrontendLead', 'BackendLead']);

    // Check message retrieval
    const messages = channelService.getMessages('chan-arch');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('Hey @FrontendLead');

    // Check event journal recording
    const events = db.query<{ event_type: string; entity_id: string }>(
      'SELECT event_type, entity_id FROM event_journal WHERE event_type = ?',
      'message.created'
    );
    expect(events).toHaveLength(1);
    expect(events[0].entity_id).toBe(msg.id);
  });

  it('enforces Selective Activation: only mentioned agents wake up for inference', () => {
    // 1. Message mentioning ONLY @FrontendLead
    const msg1: Message = {
      id: 'm1',
      channelId: 'chan-arch',
      senderId: 'user-1',
      senderType: 'human',
      content: 'Can @FrontendLead fix the CSS rendering glitch?',
      mentions: ['FrontendLead'],
      productivityScore: 0,
      createdAt: 1000,
    };

    const decFrontend1 = activationEngine.evaluateActivation(mockAgentFrontend, {
      type: 'message',
      message: msg1,
    });
    const decBackend1 = activationEngine.evaluateActivation(mockAgentBackend, {
      type: 'message',
      message: msg1,
    });

    // Frontend MUST wake up; Backend MUST stay idle
    expect(decFrontend1.shouldActivate).toBe(true);
    expect(decFrontend1.triggerReason).toBe('explicit_mention:m1');
    expect(decBackend1.shouldActivate).toBe(false);

    // 2. Generic channel message without any mentions
    const msg2: Message = {
      id: 'm2',
      channelId: 'chan-arch',
      senderId: 'user-1',
      senderType: 'human',
      content: 'The weather is great today.',
      mentions: [],
      productivityScore: 0,
      createdAt: 2000,
    };

    const decFrontend2 = activationEngine.evaluateActivation(mockAgentFrontend, {
      type: 'message',
      message: msg2,
    });
    const decBackend2 = activationEngine.evaluateActivation(mockAgentBackend, {
      type: 'message',
      message: msg2,
    });

    // BOTH MUST REMAIN IDLE (Zero bot storm)
    expect(decFrontend2.shouldActivate).toBe(false);
    expect(decBackend2.shouldActivate).toBe(false);
  });

  it('trips the 3-Turn Dynamic Stagnation Breaker during unassisted peer debates', () => {
    // Simulate debate between FrontendLead and BackendLead without state changes
    const turn1: Message = {
      id: 't1',
      channelId: 'chan-arch',
      senderId: 'agent-fe',
      senderType: 'agent',
      content: 'We need flat JSON for rendering speed.',
      mentions: [],
      productivityScore: 0,
      createdAt: 1000,
    };

    const eval1 = loopBreaker.evaluateThread([turn1]);
    expect(eval1.action).toBe('continue');

    const turn2: Message = {
      id: 't2',
      channelId: 'chan-arch',
      senderId: 'agent-be',
      senderType: 'agent',
      content: 'No, flat JSON breaks relational normalization.',
      mentions: [],
      productivityScore: 0,
      createdAt: 2000,
    };

    // Turn 2: Soft warning hint
    const eval2 = loopBreaker.evaluateThread([turn1, turn2]);
    expect(eval2.action).toBe('warn');
    expect(eval2.warningMessage).toContain('2 consecutive turns');

    const turn3: Message = {
      id: 't3',
      channelId: 'chan-arch',
      senderId: 'agent-fe',
      senderType: 'agent',
      content: 'I still insist on flat JSON because normalization creates selector lag.',
      mentions: [],
      productivityScore: 0,
      createdAt: 3000,
    };

    // Turn 3: Hard stalemate halt and Conflict Dossier generation
    const eval3 = loopBreaker.evaluateThread([turn1, turn2, turn3]);
    expect(eval3.action).toBe('halt_and_escalate');
    expect(eval3.conflictDossier).toBeDefined();
    expect(eval3.conflictDossier?.participants).toContain('agent-fe');
    expect(eval3.conflictDossier?.participants).toContain('agent-be');
    expect(eval3.conflictDossier?.recommendedEscalation).toBe('domain_authority_check');
  });
});
