import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CoreServer } from '../src/server/core_server.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('KIN Phase 1/2: Core IPC Server Integration & Authoritative State', () => {
  const testDbPath = path.resolve(process.cwd(), 'kin_test_server.sqlite');
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }

    server = new CoreServer({ port: 0, dbPath: testDbPath }); // port 0 selects free ephemeral port
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('GET /api/state returns authoritative SQLite state and single default agent @Boss', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(data.workspace.id).toBe('ws-default');
    expect(data.activeProject.name).toBe('KIN');
    expect(data.autonomyMode).toBe('AUTO');
    expect(data.channels.length).toBe(1);
    expect(data.channels[0].name).toBe('general');

    // ONLY ONE default agent: @Boss
    expect(data.agents.length).toBe(1);
    const boss = data.agents[0];
    expect(boss.displayName).toBe('@Boss');
    expect(boss.role).toBe('Workspace Orchestrator');
    expect(boss.isOrchestrator).toBe(true);

    expect(data.messages.length).toBeGreaterThan(0);
    expect(data.messages[0].senderName).toBe('@Boss');
  });

  it('GET /api/system/models detects local Ollama status and installed models', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/models`);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(typeof data.online).toBe('boolean');
    expect(Array.isArray(data.models)).toBe(true);
  });

  it('POST /api/projects creates a new independent workspace project', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test01',
        repoPath: 'D:\\test01',
      }),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.project.name).toBe('test01');
    expect(data.project.repoPath).toBe('D:\\test01');

    // Verify in projects list
    const listRes = await fetch(`http://127.0.0.1:${port}/api/projects`);
    const listData: any = await listRes.json();
    expect(listData.projects.length).toBe(2);
    expect(listData.projects.some((p: any) => p.name === 'test01')).toBe(true);
  });

  it('POST /api/system/terminal executes shell command in project directory', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/system/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'echo KIN_TERMINAL_ONLINE',
      }),
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.stdout).toContain('KIN_TERMINAL_ONLINE');
    expect(data.exitCode).toBe(0);
  });

  it('POST /api/channels/:id/messages persists message and activates @Boss', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state`);
    const state: any = await stateRes.json();
    const channelId = state.channels[0].id;

    const res = await fetch(`http://127.0.0.1:${port}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'create a txt file and write something in it.',
      }),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.message.content).toBe('create a txt file and write something in it.');
    expect(data.triggeredCount).toBe(1);

    // Verify persisted directly in SQLite
    const db = server.getDatabase();
    const rows = db.query<{ content: string }>(
      `SELECT content FROM messages WHERE channel_id = ? AND sender_type = 'human'`,
      channelId
    );
    expect(rows.some((r) => r.content.includes('create a txt file'))).toBe(true);
  });

  it('PATCH /api/agents/:id/contract updates role title and active model in SQLite', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/contract`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleTitle: 'boss',
        activeModelId: 'ollama/qwen2.5-coder:3b',
        systemPrompt: 'You are the boss of this workspace.',
      }),
    });

    expect(res.status).toBe(200);

    // Verify in SQLite
    const db = server.getDatabase();
    const identity = db.queryOne<{ active_model_id: string }>(
      "SELECT active_model_id FROM agent_identities WHERE id = 'agent-boss'"
    );
    expect(identity?.active_model_id).toBe('ollama/qwen2.5-coder:3b');

    const def = db.queryOne<{ role: string; system_prompt: string }>(
      "SELECT role, system_prompt FROM agent_definitions WHERE id = 'def-boss'"
    );
    expect(def?.role).toBe('boss');
    expect(def?.system_prompt).toBe('You are the boss of this workspace.');
  });

  it('POST /api/agents hires a specialist and enforces unique display_name per project', async () => {
    // 1. Hire @ResearchAgent
    const res = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-kin',
        displayName: '@ResearchAgent',
        roleTitle: 'Research Specialist',
        systemPrompt: 'You specialize in research.',
        activeModelId: 'ollama/qwen2.5-coder:3b',
      }),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.agent.displayName).toBe('@ResearchAgent');
    expect(data.agent.role).toBe('Research Specialist');

    // 2. Attempt duplicate hire with same display_name in same project (case-insensitive) -> must fail with 409
    const dupRes = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-kin',
        displayName: 'researchagent', // lowercase without @ -> case-insensitive collision
        roleTitle: 'Another Researcher',
      }),
    });

    expect(dupRes.status).toBe(409);

    // 3. Verify GET /api/projects/proj-kin/agents lists both @Boss and @ResearchAgent
    const listRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/agents`);
    expect(listRes.status).toBe(200);
    const listData: any = await listRes.json();
    expect(listData.agents.length).toBe(2);
    expect(listData.agents.some((a: any) => a.displayName === '@Boss')).toBe(true);
    expect(listData.agents.some((a: any) => a.displayName === '@ResearchAgent')).toBe(true);
  });

  it('POST /api/agents with channelId immediately assigns hired specialist to channel', async () => {
    // 1. Create temporary channel
    const chanRes = await fetch(`http://127.0.0.1:${port}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-kin',
        name: 'security-audit',
      }),
    });
    const chanData: any = await chanRes.json();
    const chanId = chanData.channel.id;

    // 2. Hire specialist with channelId
    const hireRes = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-kin',
        displayName: '@SecOps',
        roleTitle: 'Security Specialist',
        channelId: chanId,
      }),
    });
    expect(hireRes.status).toBe(201);
    const hireData: any = await hireRes.json();
    expect(hireData.agent.assignedChannels).toContain(chanId);

    // 3. Verify channel members include @SecOps
    const membersRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/members`);
    const membersData: any = await membersRes.json();
    expect(membersData.members.some((m: any) => m.displayName === '@SecOps')).toBe(true);
  });

  it('POST /api/channels creates channel with strictly ONE default agent: @Boss', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-kin',
        name: 'research-lab',
        topic: 'Deep research experiments',
      }),
    });

    expect(res.status).toBe(201);
    const data: any = await res.json();
    const newChanId = data.channel.id;
    expect(data.channel.name).toBe('research-lab');

    // Verify channel members: strictly @Boss
    const membersRes = await fetch(`http://127.0.0.1:${port}/api/channels/${newChanId}/members`);
    expect(membersRes.status).toBe(200);
    const membersData: any = await membersRes.json();
    expect(membersData.members.length).toBe(1);
    expect(membersData.members[0].displayName).toBe('@Boss');
  });

  it('POST /api/channels/:id/members assigns agent to channel, and DELETE rejects removing @Boss', async () => {
    // 1. Get channel and agents for proj-kin
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?projectId=proj-kin`);
    const state: any = await stateRes.json();
    const channel = state.channels.find((c: any) => c.name === 'research-lab');
    expect(channel).toBeDefined();

    const researcher = state.agents.find((a: any) => a.displayName === '@ResearchAgent');
    expect(researcher).toBeDefined();

    // 2. Assign @ResearchAgent to #research-lab
    const assignRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channel.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: researcher.id }),
    });
    expect(assignRes.status).toBe(200);

    // 3. Verify members now include both @Boss and @ResearchAgent
    const membersRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channel.id}/members`);
    const membersData: any = await membersRes.json();
    expect(membersData.members.length).toBe(2);
    expect(membersData.members.some((m: any) => m.displayName === '@ResearchAgent')).toBe(true);

    // 4. Invariant: Attempting to remove @Boss must fail with 400
    const boss = state.agents.find((a: any) => a.isOrchestrator);
    const removeBossRes = await fetch(
      `http://127.0.0.1:${port}/api/channels/${channel.id}/members/${boss.id}`,
      { method: 'DELETE' }
    );
    expect(removeBossRes.status).toBe(400);

    // 5. Removing @ResearchAgent succeeds
    const removeRes = await fetch(
      `http://127.0.0.1:${port}/api/channels/${channel.id}/members/${researcher.id}`,
      { method: 'DELETE' }
    );
    expect(removeRes.status).toBe(200);

    const afterRemoveRes = await fetch(`http://127.0.0.1:${port}/api/channels/${channel.id}/members`);
    const afterData: any = await afterRemoveRes.json();
    expect(afterData.members.length).toBe(1);
    expect(afterData.members[0].displayName).toBe('@Boss');
  });

  it('POST /api/channels/dm-:agentId/messages routes directly to target recipient agent', async () => {
    // 1. Get @ResearchAgent id
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?projectId=proj-kin`);
    const state: any = await stateRes.json();
    const researcher = state.agents.find((a: any) => a.displayName === '@ResearchAgent');
    expect(researcher).toBeDefined();

    // 2. Post DM to @ResearchAgent
    const dmChannelId = `dm-${researcher.id}`;
    const dmRes = await fetch(`http://127.0.0.1:${port}/api/channels/${dmChannelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Hey researcher, what are your findings?',
      }),
    });

    expect(dmRes.status).toBe(201);
    const dmData: any = await dmRes.json();
    expect(dmData.message.content).toBe('Hey researcher, what are your findings?');
    // Target agent woke up directly
    expect(dmData.triggeredCount).toBe(1);
  });

  it('@Boss safety net: hires a new specialist directly when requested in chat', async () => {
    // 1. Create a channel with only @Boss
    const chanRes = await fetch(`http://127.0.0.1:${port}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-kin',
        name: 'ui-workspace',
      }),
    });
    const chanData: any = await chanRes.json();
    const chanId = chanData.channel.id;

    // 2. Ask @Boss to hire @FrontendDev
    const hireMsgRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Boss, please hire a frontend specialist named @FrontendDev',
      }),
    });
    expect(hireMsgRes.status).toBe(201);

    // Wait for asynchronous execution
    await new Promise((r) => setTimeout(r, 250));

    // 3. Verify @FrontendDev was created in SQLite and added to channel members
    const membersRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/members`);
    const membersData: any = await membersRes.json();
    expect(membersData.members.some((m: any) => m.displayName === '@FrontendDev')).toBe(true);

    // 4. Verify message history contains confirmation from @Boss and response from @FrontendDev
    const msgsRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`);
    const msgsData: any = await msgsRes.json();
    expect(msgsData.messages.some((m: any) => m.content.includes('I have hired and provisioned @FrontendDev'))).toBe(true);
  });

  it('@Boss safety net: auto-assigns existing project specialist when relevant domain question is asked', async () => {
    // 1. Create a new channel (has only @Boss)
    const chanRes = await fetch(`http://127.0.0.1:${port}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-kin',
        name: 'pentest-lab',
      }),
    });
    const chanData: any = await chanRes.json();
    const chanId = chanData.channel.id;

    // 2. Ask a security question where @SecOps (hired in earlier test) is in the project but not in this channel
    const secMsgRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Can someone perform a security audit of our API endpoints?',
      }),
    });
    expect(secMsgRes.status).toBe(201);

    // Wait for asynchronous execution
    await new Promise((r) => setTimeout(r, 250));

    // 3. Verify @SecOps was auto-enrolled in #pentest-lab
    const membersRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/members`);
    const membersData: any = await membersRes.json();
    expect(membersData.members.some((m: any) => m.displayName === '@SecOps')).toBe(true);

    // 4. Verify message history has @Boss delegation message
    const msgsRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`);
    const msgsData: any = await msgsRes.json();
    expect(msgsData.messages.some((m: any) => m.content.includes('I noticed we have @SecOps in this project'))).toBe(true);
  });

  it('GET /api/projects/:id/git/status returns live git status breakdown', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/git/status`);
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.isGitRepo).toBe(true);
    expect(data.summary).toBeDefined();
    expect(typeof data.summary.totalChanged).toBe('number');
    expect(Array.isArray(data.files)).toBe(true);
  });

  it('GET /api/projects/:id/git/diff and stage/revert lifecycle', async () => {
    // 1. Create a dummy untracked file in the project directory
    const testFile = path.resolve(process.cwd(), 'test_sample_diff.txt');
    fs.writeFileSync(testFile, 'Hello world line 1\nHello world line 2\n');

    try {
      // 2. Fetch git diff for this untracked file
      const diffRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/git/diff?path=test_sample_diff.txt`);
      expect(diffRes.status).toBe(200);
      const diffData: any = await diffRes.json();
      expect(diffData.isUntracked).toBe(true);
      expect(diffData.additions).toBe(2);
      expect(diffData.diff).toContain('+Hello world line 1');

      // 3. Stage the file
      const stageRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/git/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test_sample_diff.txt', stage: true }),
      });
      expect(stageRes.status).toBe(200);

      // 4. Unstage the file
      const unstageRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/git/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test_sample_diff.txt', stage: false }),
      });
      expect(unstageRes.status).toBe(200);

      // 5. Revert the file (untracked deletion)
      const revertRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/git/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test_sample_diff.txt' }),
      });
      expect(revertRes.status).toBe(200);
      expect(fs.existsSync(testFile)).toBe(false);
    } finally {
      if (fs.existsSync(testFile)) {
        try { fs.unlinkSync(testFile); } catch {}
      }
    }
  });

  it('POST /api/projects/:id/uploads persists file and metadata in SQLite and disk', async () => {
    const fileContent = 'Attachment test file content for KIN Platform';
    const base64 = Buffer.from(fileContent).toString('base64');

    // 1. Upload
    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'notes.txt',
        contentBase64: base64,
        mimeType: 'text/plain',
      }),
    });
    expect(uploadRes.status).toBe(201);
    const uploadData: any = await uploadRes.json();
    expect(uploadData.upload.originalName).toBe('notes.txt');
    const uploadId = uploadData.upload.id;

    // 2. List uploads
    const listRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/uploads`);
    expect(listRes.status).toBe(200);
    const listData: any = await listRes.json();
    expect(listData.uploads.some((u: any) => u.id === uploadId)).toBe(true);

    // 3. Download upload
    const dlRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/uploads/${uploadId}/download`);
    expect(dlRes.status).toBe(200);
    const dlText = await dlRes.text();
    expect(dlText).toBe(fileContent);

    // 4. Delete upload
    const delRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/uploads/${uploadId}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);

    // 5. Verify deleted from list
    const afterDelRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/uploads`);
    const afterDelData: any = await afterDelRes.json();
    expect(afterDelData.uploads.some((u: any) => u.id === uploadId)).toBe(false);
  });

  it('Slash commands /goal, /teamwork-preview, /plan operate correctly in chat', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?projectId=proj-kin`);
    const state: any = await stateRes.json();
    const chanId = state.channels[0].id;

    // 1. /goal command
    const goalRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/goal Build Live File Review Hub',
      }),
    });
    expect(goalRes.status).toBe(201);

    const goalsRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/goals`);
    const goalsData: any = await goalsRes.json();
    expect(goalsData.goals.some((g: any) => g.title === 'Build Live File Review Hub')).toBe(true);

    // 2. /teamwork-preview command
    const twRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/teamwork-preview',
      }),
    });
    expect(twRes.status).toBe(201);

    // 3. /plan command
    const planRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/plan Antigravity Right Panel Enhancements',
      }),
    });
    expect(planRes.status).toBe(201);

    const afterPlanGoalsRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/goals`);
    const afterPlanGoalsData: any = await afterPlanGoalsRes.json();
    expect(afterPlanGoalsData.goals.some((g: any) => g.title.includes('Antigravity Right Panel'))).toBe(true);
    expect(afterPlanGoalsData.tasks.length).toBeGreaterThan(0);

    // 4. GET /api/projects/:id/teamwork-preview endpoint
    const twEndpointRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/teamwork-preview`);
    expect(twEndpointRes.status).toBe(200);
    const twData: any = await twEndpointRes.json();
    expect(twData.projectId).toBe('proj-kin');
    expect(Array.isArray(twData.agents)).toBe(true);
    expect(twData.metrics).toBeDefined();
    expect(twData.metrics.goalsCount).toBeGreaterThan(0);
  });

  it('Artifacts API enforces jail confinement and filters build artifacts', async () => {
    // 1. List artifacts
    const artRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/artifacts`);
    expect(artRes.status).toBe(200);
    const artData: any = await artRes.json();
    expect(Array.isArray(artData.artifacts)).toBe(true);
    // Verify no node_modules or .sqlite files leaked into artifacts
    expect(artData.artifacts.some((a: any) => a.relativePath.includes('node_modules'))).toBe(false);
    expect(artData.artifacts.some((a: any) => a.relativePath.endsWith('.sqlite'))).toBe(false);

    // 2. Reject directory traversal attempt
    const jailRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/artifacts/file?path=../../../../etc/passwd`);
    expect(jailRes.status).toBe(403);
    const jailData: any = await jailRes.json();
    expect(jailData.error).toContain('Forbidden');
  });

  it('Slash command /boost triggers autonomous audit directive and model execution', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?projectId=proj-kin`);
    const state: any = await stateRes.json();
    const chanId = state.channels[0].id;

    const boostRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/boost verify core architecture and database integrity',
      }),
    });

    expect(boostRes.status).toBe(201);
    const boostData: any = await boostRes.json();
    expect(boostData.triggeredCount).toBeGreaterThan(0);

    // Wait 100ms for agent execution
    await new Promise((r) => setTimeout(r, 100));

    // Verify messages contain responses
    const msgsRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`);
    const msgsData: any = await msgsRes.json();
    expect(msgsData.messages.some((m: any) => m.content.includes('/boost'))).toBe(true);
  });

  it('Slash command /goal handles empty input with usage instructions and parses multi-part arguments', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?projectId=proj-kin`);
    const state: any = await stateRes.json();
    const chanId = state.channels[0].id;

    // 1. Empty /goal -> returns usage
    const emptyGoalRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '/goal' }),
    });
    expect(emptyGoalRes.status).toBe(201);

    const msgsRes1 = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`);
    const msgsData1: any = await msgsRes1.json();
    expect(msgsData1.messages.some((m: any) => m.content.includes('/goal <title>'))).toBe(true);

    // 2. Multi-part /goal
    const multiGoalRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/goal Release KIN Platform v1.0 | Full autonomous local workforce | Zero bugs, complete test suite passing',
      }),
    });
    expect(multiGoalRes.status).toBe(201);

    const goalsRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/goals`);
    const goalsData: any = await goalsRes.json();
    const createdGoal = goalsData.goals.find((g: any) => g.title === 'Release KIN Platform v1.0');
    expect(createdGoal).toBeDefined();
    expect(createdGoal.description).toBe('Full autonomous local workforce');
    expect(createdGoal.acceptanceCriteria).toContain('Zero bugs');
  });

  it('Slash command /plan supports custom phase step breakdown', async () => {
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?projectId=proj-kin`);
    const state: any = await stateRes.json();
    const chanId = state.channels[0].id;

    const planRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '/plan Custom Workflow | Phase A: Design | Phase B: Implement | Phase C: Verify',
      }),
    });
    expect(planRes.status).toBe(201);

    const goalsRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/goals`);
    const goalsData: any = await goalsRes.json();
    expect(goalsData.tasks.some((t: any) => t.title.includes('Phase A: Design'))).toBe(true);
    expect(goalsData.tasks.some((t: any) => t.title.includes('Phase B: Implement'))).toBe(true);
    expect(goalsData.tasks.some((t: any) => t.title.includes('Phase C: Verify'))).toBe(true);
  });

  it('POST /api/projects/:id/git/review triggers AI code review of changed files', async () => {
    const reviewRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/git/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'package.json' }),
    });
    expect(reviewRes.status).toBe(200);
    const reviewData: any = await reviewRes.json();
    expect(reviewData.review).toBeDefined();
  }, 90000);

  it('Rejects prefix-collision directory traversal attempts outside project jail', async () => {
    // Attempt to access path that starts with project root string but is actually another path
    const fakeTraversal = `../${path.basename(process.cwd())}_other/secret.txt`;
    const jailRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/artifacts/file?path=${encodeURIComponent(fakeTraversal)}`);
    expect(jailRes.status).toBe(403);
  });

  it('Detects binary files in git diff and reports isBinary flag', async () => {
    const binFile = path.resolve(process.cwd(), 'sample_test_asset.png');
    // Write 100 bytes containing null bytes to simulate a binary image
    const binBuf = Buffer.alloc(100);
    binBuf[0] = 0x89;
    binBuf[1] = 0x50; // PNG magic
    fs.writeFileSync(binFile, binBuf);

    try {
      const diffRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/git/diff?path=sample_test_asset.png`);
      expect(diffRes.status).toBe(200);
      const diffData: any = await diffRes.json();
      expect(diffData.isBinary).toBe(true);
      expect(diffData.diff).toContain('Binary file');
    } finally {
      if (fs.existsSync(binFile)) {
        try { fs.unlinkSync(binFile); } catch {}
      }
    }
  });

  it('manages Architecture Decision Records (ADR) via REST and slash commands', async () => {
    // 1. POST /api/projects/:id/decisions
    const createDecRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Use SQLite WAL Mode',
        rationale: 'Provides concurrency for multi-agent read/write without table locks',
        alternativesConsidered: ['PostgreSQL', 'DuckDB'],
        status: 'authoritative',
      }),
    });
    expect(createDecRes.status).toBe(201);
    const createDecData: any = await createDecRes.json();
    expect(createDecData.decision.id).toBeDefined();
    expect(createDecData.decision.title).toBe('Use SQLite WAL Mode');
    const decId = createDecData.decision.id;

    // 2. GET /api/projects/:id/decisions
    const listDecRes = await fetch(`http://127.0.0.1:${port}/api/projects/proj-kin/decisions`);
    expect(listDecRes.status).toBe(200);
    const listDecData: any = await listDecRes.json();
    expect(listDecData.decisions.some((d: any) => d.id === decId)).toBe(true);

    // 3. PATCH /api/decisions/:id/status
    const patchDecRes = await fetch(`http://127.0.0.1:${port}/api/decisions/${decId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'superseded' }),
    });
    expect(patchDecRes.status).toBe(200);
    const patchDecData: any = await patchDecRes.json();
    expect(patchDecData.decision.status).toBe('superseded');

    // 4. Slash command /skills
    const stateRes = await fetch(`http://127.0.0.1:${port}/api/state?projectId=proj-kin`);
    const state: any = await stateRes.json();
    const chanId = state.channels[0].id;

    const skillsCmdRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '/skills' }),
    });
    expect(skillsCmdRes.status).toBe(201);

    // 5. Slash command /decisions list
    const decCmdRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '/decisions' }),
    });
    expect(decCmdRes.status).toBe(201);

    // 6. Slash command /schedule usage fallback
    const schedEmptyRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '/schedule' }),
    });
    expect(schedEmptyRes.status).toBe(201);

    // 7. Slash command /routine usage fallback
    const routineEmptyRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '/routine' }),
    });
    expect(routineEmptyRes.status).toBe(201);

    const msgsRes = await fetch(`http://127.0.0.1:${port}/api/channels/${chanId}/messages`);
    const msgsData: any = await msgsRes.json();
    expect(msgsData.messages.some((m: any) => m.content.includes('Registered Agent Skills'))).toBe(true);
    expect(msgsData.messages.some((m: any) => m.content.includes('Project Architectural Decisions'))).toBe(true);
    expect(msgsData.messages.some((m: any) => m.content.includes('/schedule <duration>'))).toBe(true);
    expect(msgsData.messages.some((m: any) => m.content.includes('/routine <interval-seconds'))).toBe(true);
  });
});
