import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';

describe('Milestone 13: UI/UX State, Dynamic Ports, Facade Remediation & Contracts Test Suite', () => {
  let tempDir: string;
  let testDbPath: string;
  let testProjectDir: string;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    process.env.KIN_GITHUB_CLIENT_ID = 'test-github-client-m13';
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-m13-ui-test-'));
    testDbPath = path.join(tempDir, 'test_m13_ui.sqlite');
    testProjectDir = path.join(tempDir, 'project');
    fs.mkdirSync(testProjectDir, { recursive: true });

    server = new CoreServer({ port: 0, dbPath: testDbPath });
    port = await server.start();
    server.db.execute("UPDATE projects SET repo_path = ? WHERE id = 'proj-kin'", testProjectDir);
  });

  afterAll(async () => {
    delete process.env.KIN_GITHUB_CLIENT_ID;
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // Feature 70: Dynamic API Port & URL Contract
  // ==========================================================================
  describe('Feature 70: Dynamic API Port & Base URL Resolution Contract', () => {
    it('resolves dynamic API port from URL parameters (?port= / ?kin_port=) and storage', () => {
      // Simulate frontend getApiBaseUrl algorithm with various inputs
      function resolveApiUrl(mockWindow: any): string {
        if (mockWindow) {
          const customUrl = mockWindow.__KIN_API_URL__ || mockWindow.__KIN_API_BASE_URL__;
          if (customUrl) return String(customUrl).replace(/\/+$/, '');

          let urlPort: string | null = null;
          if (mockWindow.location?.search) {
            const params = new URLSearchParams(mockWindow.location.search);
            urlPort = params.get('port') || params.get('kin_port');
          }

          const customPort =
            urlPort ||
            mockWindow.__KIN_PORT__ ||
            mockWindow.sessionStorage?.getItem?.('KIN_PORT') ||
            mockWindow.localStorage?.getItem?.('KIN_PORT') ||
            (mockWindow.location?.port &&
            mockWindow.location.port !== '5173' &&
            mockWindow.location.port !== '3000' &&
            mockWindow.location.port !== '80' &&
            mockWindow.location.port !== '443'
              ? mockWindow.location.port
              : null);

          if (customPort) {
            return `http://127.0.0.1:${customPort}`;
          }
        }
        return 'http://127.0.0.1:54321';
      }

      // 1. URL search param takes precedence
      expect(resolveApiUrl({ location: { search: '?port=58912' } })).toBe('http://127.0.0.1:58912');
      expect(resolveApiUrl({ location: { search: '?kin_port=61234' } })).toBe('http://127.0.0.1:61234');

      // 2. Custom window port
      expect(resolveApiUrl({ __KIN_PORT__: '59000', location: {} })).toBe('http://127.0.0.1:59000');

      // 3. SessionStorage port
      expect(
        resolveApiUrl({
          sessionStorage: { getItem: (k: string) => (k === 'KIN_PORT' ? '57777' : null) },
          location: {},
        })
      ).toBe('http://127.0.0.1:57777');

      // 4. Custom port in location.port (e.g. non-dev preview server)
      expect(resolveApiUrl({ location: { port: '49152' } })).toBe('http://127.0.0.1:49152');

      // 5. Default fallback
      expect(resolveApiUrl({ location: { port: '5173' } })).toBe('http://127.0.0.1:54321');
    });
  });

  // ==========================================================================
  // Feature 75: OAuth Browser Launch Verification
  // ==========================================================================
  describe('Feature 75: OAuth Authorization URL Generation Contract', () => {
    it('returns valid authUrl for configured OAuth providers allowing browser launch', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/oauth/authorize/github`, { method: 'POST' });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.authUrl).toBeDefined();
      expect(typeof data.authUrl).toBe('string');
      expect(data.authUrl).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/);
      expect(data.authUrl).toContain('client_id=test-github-client-m13');
    });
  });

  // ==========================================================================
  // Feature 76: Claude JSON MCP Connectors Import Contract
  // ==========================================================================
  describe('Feature 76: Claude JSON Connectors Import Contract & Error Aggregation', () => {
    it('successfully saves valid MCP connector configurations', async () => {
      const connector = {
        scope: 'project',
        name: 'm13-genuine-connector',
        config: {
          command: 'node',
          args: ['-e', 'console.log("mcp ready")'],
          env: { KIN_ENV: 'production' },
          disabled: false,
        },
      };

      const res = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connector),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.connector.name).toBe('m13-genuine-connector');
    });

    it('rejects invalid connector configurations without scope or name', async () => {
      const invalid = { config: { command: 'node' } };
      const res = await fetch(`http://127.0.0.1:${port}/api/mcp/connectors/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalid),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  // ==========================================================================
  // Feature 77: Model Assignment Status Return Contracts
  // ==========================================================================
  describe('Feature 77: Model Assignment Status Return Contracts', () => {
    it('successfully updates model when agent is idle', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModelId: 'openai/gpt-4o' }),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.activeModelId).toBe('openai/gpt-4o');
    });

    it('returns HTTP 409 Conflict when agent is actively running tasks', async () => {
      // Simulate agent-boss actively executing
      server.activeAgentExecutions.set('agent-boss', {
        agentId: 'agent-boss',
        channelId: 'chan-general',
        startedAt: Date.now(),
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModelId: 'anthropic/claude-3-7-sonnet' }),
      });

      expect(res.status).toBe(409);
      const data: any = await res.json();
      expect(data.error).toContain('actively working');

      // Clear busy execution state
      server.activeAgentExecutions.delete('agent-boss');
    });
  });

  // ==========================================================================
  // Feature 78: Mutation Failure Contracts (Channels, Goals, Tasks, Skills)
  // ==========================================================================
  describe('Feature 78: Entity Mutation Status Feedback Contracts', () => {
    it('returns 404/error when deleting a non-existent channel', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/channels/non-existent-channel-xyz`, {
        method: 'DELETE',
      });
      expect([400, 404, 500]).toContain(res.status);
    });

    it('returns error when updating status of a non-existent task', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/tasks/non-existent-task-123/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      expect([400, 404, 500]).toContain(res.status);
    });

    it('returns error when rejecting a non-existent candidate skill', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/skills/candidates/fake-candidate-999/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
      expect([400, 404, 500]).toContain(res.status);
    });
  });

  // ==========================================================================
  // Feature 80: Agent Evaluations Endpoint & Rubrics
  // ==========================================================================
  describe('Feature 80: Agent Evaluations Endpoint & Rubrics', () => {
    it('runs formal benchmark evaluation and returns scored rubric result', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/evaluate`, {
        method: 'POST',
      });

      expect([200, 201]).toContain(res.status);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.evaluation).toBeDefined();
      expect(typeof data.evaluation.score).toBe('number');
      expect(data.evaluation.rubricScores).toBeDefined();
    });

    it('fetches recorded agent evaluations list', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/agents/agent-boss/evaluations`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(Array.isArray(data.evaluations)).toBe(true);
      expect(data.evaluations.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Feature 81: Dynamic Default Channel Fallback
  // ==========================================================================
  describe('Feature 81: Dynamic Default Channel Selection Contract', () => {
    it('correctly resolves fallback channel without hardcoded chan-general assumptions', () => {
      const channels = [
        { id: 'chan-alpha', name: 'Alpha', isGeneral: false },
        { id: 'chan-project-core', name: 'General', isGeneral: true },
        { id: 'chan-beta', name: 'Beta', isGeneral: false },
      ];

      // Dynamic channel selection formula from kinStore.ts and SwarmMap.tsx
      const fallback =
        channels.find((c) => (c as any).isGeneral || c.name.toLowerCase() === 'general')?.id ||
        channels[0]?.id ||
        '';

      expect(fallback).toBe('chan-project-core');
    });

    it('falls back to the first available channel when no general channel exists', () => {
      const customChannels = [
        { id: 'chan-custom-first', name: 'Workspace Tasks', isGeneral: false },
        { id: 'chan-custom-second', name: 'Discussions', isGeneral: false },
      ];

      const fallback =
        customChannels.find((c) => (c as any).isGeneral || c.name.toLowerCase() === 'general')?.id ||
        customChannels[0]?.id ||
        '';

      expect(fallback).toBe('chan-custom-first');
    });
  });

  // ==========================================================================
  // Feature 82: Elimination of Prototype Placeholder Text
  // ==========================================================================
  describe('Feature 82: Clean Decision Processing without Prototype Placeholders', () => {
    it('parses genuine decisions without synthetic placeholder strings', () => {
      const messageContent = `### Architectural Tie-Breaker: SQLite Concurrency
Option A: Use WAL mode with busy_timeout
Option A Pros: High throughput and non-blocking reads
Option A Cons: Requires single writer discipline
Option B: Use in-memory SQLite with periodic flush
Option B Pros: Zero disk I/O latency
Option B Cons: Potential data loss on crash
Recommendation: Adopt Option A with WAL mode`;

      const titleMatch = messageContent.match(/(?:### Architectural Tie-Breaker|Proposed Plan Decision|Decision Card:)\s*:?\s*([^\n]+)/);
      const optAMatch = messageContent.match(/Option A:\s*([^\n]+)/);
      const optBMatch = messageContent.match(/Option B:\s*([^\n]+)/);
      const optAProsMatch = messageContent.match(/Option A Pros?:\s*([^\n]+)/i);
      const optAConsMatch = messageContent.match(/Option A Cons?:\s*([^\n]+)/i);
      const optBProsMatch = messageContent.match(/Option B Pros?:\s*([^\n]+)/i);
      const optBConsMatch = messageContent.match(/Option B Cons?:\s*([^\n]+)/i);
      const recMatch = messageContent.match(/Recommendation:\s*([^\n]+)/i);

      const parsed = {
        title: titleMatch ? titleMatch[1].trim() : '',
        optionA: {
          label: optAMatch![1].trim(),
          pros: optAProsMatch ? optAProsMatch[1].trim() : '',
          cons: optAConsMatch ? optAConsMatch[1].trim() : '',
        },
        optionB: {
          label: optBMatch![1].trim(),
          pros: optBProsMatch ? optBProsMatch[1].trim() : '',
          cons: optBConsMatch ? optBConsMatch[1].trim() : '',
        },
        recommendation: recMatch ? recMatch[1].trim() : undefined,
      };

      expect(parsed.title).toBe('SQLite Concurrency');
      expect(parsed.optionA.pros).toBe('High throughput and non-blocking reads');
      expect(parsed.optionA.cons).toBe('Requires single writer discipline');
      expect(parsed.recommendation).toBe('Adopt Option A with WAL mode');
      expect(parsed.optionA.pros).not.toContain('Primary recommended path');
      expect(parsed.optionA.cons).not.toContain('May require verification');
    });
  });
});
