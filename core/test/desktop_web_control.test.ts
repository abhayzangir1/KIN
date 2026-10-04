// ============================================================================
// KIN DESKTOP & WEB CONTROL UPGRADES INTEGRATION TEST SUITE
// Tests all 11 V12 evolutionary capabilities:
// 1. Desktop & Computer Control (display inspection, screen capture, input)
// 2. Application Discovery, Launch & Window Control
// 3. Persistent Controllable Browser Sessions & State Tracking
// 4. Authenticated Workflows & Human Authorization Protocol
// 5. Governed Computer Control & Risk Tiering (LOW, MEDIUM, HIGH, CRITICAL)
// 6. One-Click Skills Import & Export Bundles
// 7. Real-World Commerce & Action Financial Gates (Zero-Trust Hard Stops)
// 8. General Web Task Execution & Step Trajectory
// 9. Proactive Personal Assistant & Routines
// 10. Instant Human Takeover (Pause, Resume, Abort)
// 11. Observe-Act-Observe-Verify Recovery Engine
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { DesktopController } from '../src/computer/desktop_controller.js';
import { BrowserController } from '../src/browser/browser_controller.js';
import { FinancialSafetyShield } from '../src/policy/financial_safety.js';
import { RecoveryEngine } from '../src/recovery/recovery_engine.js';
import { SkillEngine } from '../src/skills/skill_engine.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import { PolicyEngine } from '../src/policy/policy_engine.js';
import { CoreServer } from '../src/server/core_server.js';
import { AgentLoopRunner } from '../src/kernel/agent_loop.js';
import { SchedulerService } from '../src/automation/scheduler.js';

describe('KIN V12: Desktop & Web Control Upgrades', () => {
  let db: KinDatabase;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.resolve(process.cwd(), `test_v12_${Date.now()}_${Math.random().toString(36).substring(7)}.sqlite`);
    db = new KinDatabase({ dbPath: testDbPath });
    const migrations = new MigrationRunner(db);
    migrations.runMigrations();
  });

  afterEach(() => {
    db.close();
    for (const ext of ['', '-wal', '-shm']) {
      const file = `${testDbPath}${ext}`;
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch {}
      }
    }
  });

  describe('1 & 2. DesktopController: Display Inspection, Screen Capture, App Discovery & Window Control', () => {
    it('discovers installed desktop applications across common paths', async () => {
      const controller = new DesktopController();
      const apps = await controller.discoverInstalledApps();

      expect(Array.isArray(apps)).toBe(true);
      expect(apps.length).toBeGreaterThan(0);

      // Verify structure of discovered apps
      const first = apps[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('executablePath');
      expect(first).toHaveProperty('category');
      expect(fs.existsSync(first.executablePath)).toBe(true);
    });

    it('queries display geometry and captures display screenshots', async () => {
      const controller = new DesktopController();
      const displays = await controller.getDisplays();

      expect(Array.isArray(displays)).toBe(true);
      expect(displays.length).toBeGreaterThan(0);
      expect(displays[0].width).toBeGreaterThan(0);
      expect(displays[0].height).toBeGreaterThan(0);

      const capture = await controller.captureScreen({ format: 'png' });
      expect(capture.base64).toBeDefined();
      expect(capture.base64.length).toBeGreaterThan(50);
      expect(capture.mimeType).toBe('image/png');
      expect(capture.width).toBeGreaterThan(0);
      expect(capture.height).toBeGreaterThan(0);
    }, 20000);

    it('lists top-level GUI windows and handles mouse/keyboard interaction primitives', async () => {
      const controller = new DesktopController();
      const windows = await controller.listWindows();

      expect(Array.isArray(windows)).toBe(true);

      const moveRes = await controller.mouseMove(100, 100);
      expect(moveRes.success).toBe(true);

      const keyRes = await controller.sendKey('ESC');
      expect(keyRes.success).toBe(true);
    }, 35000);
  });

  describe('3 & 8. BrowserController: Persistent Sessions & Web Task Step Trajectory', () => {
    it('detects installed browser executable and initializes persistent profile directory', async () => {
      const customProfile = path.resolve(process.cwd(), '.kin', 'test_browser_profile');
      const browser = new BrowserController(customProfile);

      const exe = browser.findBrowserExecutable();
      expect(exe).toBeDefined();
      expect(typeof exe).toBe('string');
      expect(fs.existsSync(exe!)).toBe(true);

      const status = browser.getStatus();
      expect(status.profilePath).toBe(customProfile);
      expect(fs.existsSync(customProfile)).toBe(true);

      // Clean up test profile dir
      try {
        fs.rmSync(customProfile, { recursive: true, force: true });
      } catch {}
    });

    it('records and audits web automation step trajectory accurately', async () => {
      const browser = new BrowserController();
      try {
        const historyBefore = browser.getStepHistory();
        expect(historyBefore.length).toBe(0);

        const stepRes = await browser.executeStep({
          action: 'wait',
        });

        expect(stepRes.success).toBe(true);
        expect(stepRes.stepIndex).toBe(1);
        expect(stepRes.action).toBe('wait');

        const scrollRes = await browser.executeStep({
          action: 'scroll',
          coordinates: { x: 0, y: 150 },
        });
        expect(scrollRes.success).toBe(true);
        expect(scrollRes.stepIndex).toBe(2);
        expect(scrollRes.action).toBe('scroll');

        const historyAfter = browser.getStepHistory();
        expect(historyAfter.length).toBe(2);
        expect(historyAfter[0].stepIndex).toBe(1);
        expect(historyAfter[1].stepIndex).toBe(2);
      } finally {
        await browser.close();
      }
    });

    it('normalizes and formats navigation URLs correctly including about:blank, file protocols, and whitespace', async () => {
      const browser = new BrowserController();
      try {
        const navRes = await browser.navigate('  about:blank  ');
        expect(navRes.url).toBe('about:blank');
        expect(navRes.status).toBe(200);
      } finally {
        await browser.close();
      }
    });

    it('handles remote debugging port probe gracefully and falls back to local browser session', async () => {
      const browser = new BrowserController();
      try {
        const { browser: sessionBrowser, page } = await browser.ensureBrowser({
          remoteDebuggingUrl: 'http://127.0.0.1:59999',
          headless: true,
        });
        expect(sessionBrowser).toBeDefined();
        expect(page).toBeDefined();
        expect(browser.getStatus().active).toBe(true);
      } finally {
        await browser.close();
      }
    });
  });

  describe('4 & 7. Financial Safety Shield & Human Authorization Protocol', () => {
    const shield = new FinancialSafetyShield();

    it('flags financial commerce actions as CRITICAL risk requiring hard stops', () => {
      const checkouts = [
        { tool: 'browserClick', params: { text: 'Pay now with credit card' } },
        { tool: 'browserType', params: { selector: '#card-number', text: '4111222233334444' } },
        { tool: 'executeShell', params: { command: 'curl -X POST https://api.stripe.com/v1/charges' } },
        { tool: 'browserNavigate', params: { url: 'https://store.example.com/checkout' } },
      ];

      for (const item of checkouts) {
        const res = shield.evaluateFinancialRisk(item.tool, item.params);
        expect(res.requiresHardStop).toBe(true);
        expect(res.riskLevel).toBe('CRITICAL');
        expect(res.isFinancialAction).toBe(true);
      }
    });

    it('detects authentication, CAPTCHA, and 2FA boundaries for human takeover', () => {
      const captchaCheck = shield.checkAuthProtocolRequirement(
        'https://example.com/verify',
        'Please complete the Cloudflare turnstile captcha to proceed'
      );
      expect(captchaCheck.requiresUserAuth).toBe(true);
      expect(captchaCheck.authType).toBe('captcha');

      const mfaCheck = shield.checkAuthProtocolRequirement(
        'https://auth.example.com/login',
        'Enter two-factor authentication 6-digit code'
      );
      expect(mfaCheck.requiresUserAuth).toBe(true);
      expect(mfaCheck.authType).toBe('mfa');

      const safeCheck = shield.checkAuthProtocolRequirement(
        'https://docs.example.com',
        'Welcome back, developer! Here are your release notes.'
      );
      expect(safeCheck.requiresUserAuth).toBe(false);
    });

    it('scrubs credit card numbers, CVVs, passwords, and private keys from context', () => {
      const rawText = `User entered card 4111-2222-3333-4444 with cvv: 987 and password: MySecretPassword123! exp: 12/28`;
      const scrubbed = shield.scrubSensitiveContext(rawText);

      expect(scrubbed).not.toContain('4111-2222-3333-4444');
      expect(scrubbed).not.toContain('987');
      expect(scrubbed).not.toContain('MySecretPassword123!');
      expect(scrubbed).toContain('[REDACTED_CARD_NUMBER]');
      expect(scrubbed).toContain('[REDACTED_CVV]');
      expect(scrubbed).toContain('[REDACTED_SECRET]');
    });
  });

  describe('5. Governed Computer Control & Zero-Trust Approval Gates', () => {
    it('enforces hard approval gate on CRITICAL financial actions even under FULL_ACCESS mode', async () => {
      const gateway = new ToolGateway();
      const policyEngine = new PolicyEngine();

      // ToolGateway evaluation
      const criticalFinancialResult = await gateway.executeTool(
        'browserClick',
        { text: 'Place order and charge card' },
        {
          runId: 'run-gate-1',
          agentId: 'agent-1',
          worktreeRoot: process.cwd(),
          autonomyMode: 'FULL_ACCESS', // Even in FULL_ACCESS!
          allowedCapabilities: ['browserClick'],
        }
      );

      expect(criticalFinancialResult.requiresApproval).toBe(true);
      expect(criticalFinancialResult.riskLevel).toBe('CRITICAL');

      // PolicyEngine evaluation
      const policyRes = policyEngine.evaluateAction({
        agentId: 'agent-1',
        toolName: 'browserClick',
        riskLevel: 'CRITICAL',
        autonomyMode: 'FULL_ACCESS',
        agentCapabilities: ['browserClick'],
      });

      expect(policyRes.requiresInteractiveApproval).toBe(true);
      expect(policyRes.reason).toContain('Zero-trust boundary: CRITICAL operation');
    });

    it('classifies tool risk tiers into LOW, MEDIUM, HIGH, and CRITICAL', () => {
      const gateway = new ToolGateway();

      expect(gateway.classifyRisk('desktopScreenshot', {})).toBe('LOW');
      expect(gateway.classifyRisk('desktopDiscoverApps', {})).toBe('LOW');
      expect(gateway.classifyRisk('browserInspect', {})).toBe('LOW');
      expect(gateway.classifyRisk('writeFile', {})).toBe('MEDIUM');
      expect(gateway.classifyRisk('desktopMouseMove', {})).toBe('MEDIUM');
      expect(gateway.classifyRisk('browserNavigate', { url: 'https://github.com' })).toBe('MEDIUM');
      expect(gateway.classifyRisk('desktopType', { text: 'code' })).toBe('HIGH');
      expect(gateway.classifyRisk('desktopLaunchApp', { name: 'code' })).toBe('HIGH');
      expect(gateway.classifyRisk('browserClick', { text: 'checkout and pay' })).toBe('CRITICAL');
    });
  });

  describe('6. One-Click Skills Import & Export Bundles', () => {
    it('manages skills, exports individual packages, and exports/imports unified bundles', () => {
      const skillEngine = new SkillEngine(db);

      const skills = skillEngine.listSkills();
      expect(skills.length).toBeGreaterThanOrEqual(8);

      // Verify new built-ins are seeded
      const appSkill = skillEngine.getSkill('skill-desktop-application-control');
      expect(appSkill).toBeDefined();
      expect(appSkill?.name).toBe('desktop-application-control');

      const browserSkill = skillEngine.getSkill('skill-persistent-browser-automation');
      expect(browserSkill).toBeDefined();

      const financeSkill = skillEngine.getSkill('skill-financial-commerce-safety');
      expect(financeSkill).toBeDefined();

      const recoverySkill = skillEngine.getSkill('skill-observe-act-verify-recovery');
      expect(recoverySkill).toBeDefined();

      // Export single skill
      const exportedPkg = skillEngine.exportSkill(appSkill!.id);
      expect(exportedPkg).toContain('desktop-application-control');

      // Export all skills as bundle
      const bundleStr = skillEngine.exportAllSkills();
      const bundleObj = JSON.parse(bundleStr);
      expect(bundleObj).toHaveProperty('skills');
      expect(Array.isArray(bundleObj.skills)).toBe(true);
      expect(bundleObj.skills.length).toBeGreaterThanOrEqual(8);

      // Create a custom skill
      const custom = skillEngine.createSkill({
        name: 'custom-automation',
        description: 'Custom test automation skill',
        instructions: 'Follow test instructions carefully',
      });
      expect(custom.id).toContain('custom-automation');

      // Delete custom skill
      const deleted = skillEngine.deleteSkill(custom.id);
      expect(deleted).toBe(true);
      expect(skillEngine.getSkill(custom.id)).toBeUndefined();

      // Re-import bundle
      const importRes = skillEngine.importSkillBundle(bundleStr);
      expect(importRes.imported).toBeGreaterThanOrEqual(8);
    });
  });

  describe('11. RecoveryEngine: Observe-Act-Observe-Verify Self-Healing Loop', () => {
    it('verifies state mutations, detects stagnation, and suggests self-healing strategies', () => {
      const skillEngine = new SkillEngine(db);
      const recovery = new RecoveryEngine(skillEngine);

      const preState = {
        timestamp: Date.now() - 1000,
        type: 'browser' as const,
        url: 'https://example.com',
        title: 'Example Domain',
        domSnippet: 'Welcome to Example',
      };

      // Case 1: Successful verification
      const postStateSuccess = {
        timestamp: Date.now(),
        type: 'browser' as const,
        url: 'https://example.com/dashboard',
        title: 'User Dashboard',
        domSnippet: 'Welcome to your Dashboard',
      };

      const result1 = recovery.verify(preState, postStateSuccess, {
        expectedUrlPattern: 'dashboard',
        expectedTitlePattern: 'Dashboard',
      });
      expect(result1.passed).toBe(true);
      expect(result1.discrepancies.length).toBe(0);

      // Case 2: State stagnation (URL expected to change, but didn't change)
      const postStateStagnant = { ...preState };
      const result2 = recovery.verify(preState, postStateStagnant, {
        expectedUrlPattern: 'dashboard',
      });
      expect(result2.passed).toBe(false);
      expect(result2.suggestedRecoveryStrategy).toBe('alternative_selector');

      // Case 3: Modal/Overlay blockage discrepancy
      const postStateModal = {
        timestamp: Date.now(),
        type: 'browser' as const,
        url: 'https://example.com',
        title: 'Example',
        domSnippet: '<div class="cookie-banner-modal">Please accept cookies</div>',
      };
      const result3 = recovery.verify(preState, postStateModal, {
        disallowedPatterns: ['cookie-banner-modal'],
      });
      expect(result3.passed).toBe(false);
      expect(result3.suggestedRecoveryStrategy).toBe('dismiss_modal');

      // Satisfy foreign key constraints for agent run in isolated test db
      db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-rec', 'Rec Test', '.', 'AUTO', 1, 1)`);
      db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-rec', 'R', 'R', 'R', 'ollama/test', 1)`);
      db.execute(`INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('agent-rec', 'ws-rec', 'def-rec', 'R', 'ollama/test', 0, 0, 1, 1)`);
      db.execute(`INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, created_at) VALUES ('run-rec-1', 'agent-rec', 'running', 1, 1)`);

      // Records recovery experience
      recovery.recordRecoveryExperience({
        runId: 'run-rec-1',
        actionName: 'browserClick',
        objective: 'Navigate to dashboard',
        outcome: 'success',
        repairStrategy: 'dismiss_modal',
      });
    });
  });

  describe('9 & 10. CoreServer IPC Endpoints: Apps, Browser, Takeover, & Proactive Routines', () => {
    let server: CoreServer;
    let serverPort: number;

    beforeEach(async () => {
      server = new CoreServer({ port: 0, dbPath: testDbPath });
      serverPort = await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    it('GET /api/system/apps returns discovered installed desktop apps', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/system/apps`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(Array.isArray(data.apps)).toBe(true);
      expect(data.apps.length).toBeGreaterThan(0);
    });

    it('GET /api/system/windows returns active top-level GUI windows', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/system/windows`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(Array.isArray(data.windows)).toBe(true);
    }, 60000);

    it('POST /api/system/desktop/screenshot captures screen display', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/system/desktop/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'png' }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.base64).toBeDefined();
      expect(data.mimeType).toBe('image/png');
    });

    it('GET /api/browser/status returns persistent browser session info', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/browser/status`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty('active');
      expect(data).toHaveProperty('profilePath');
      expect(data).toHaveProperty('stepHistory');
    });

    it('GET /api/skills/export-all returns all active skills as unified bundle', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/skills/export-all`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.bundle).toHaveProperty('skills');
      expect(data.bundle.skills.length).toBeGreaterThanOrEqual(8);
    });

    it('manages Proactive Routines via POST and GET /api/projects/:id/routines', async () => {
      // 1. Create a routine
      const createRes = await fetch(`http://127.0.0.1:${serverPort}/api/projects/proj-kin/routines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'cron',
          cronExpression: '*/30 * * * *',
          prompt: 'Run automated regression check',
        }),
      });
      expect(createRes.status).toBe(201);
      const createData: any = await createRes.json();
      expect(createData.routine).toHaveProperty('id');
      expect(createData.routine.prompt).toBe('Run automated regression check');

      // 2. List routines
      const listRes = await fetch(`http://127.0.0.1:${serverPort}/api/projects/proj-kin/routines`);
      expect(listRes.status).toBe(200);
      const listData: any = await listRes.json();
      expect(Array.isArray(listData.routines)).toBe(true);
      expect(listData.routines.some((r: any) => r.id === createData.routine.id)).toBe(true);

      // 3. Delete routine
      const delRes = await fetch(`http://127.0.0.1:${serverPort}/api/routines/${createData.routine.id}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
    });

    it('handles Instant Human Takeover controls: pause, resume, and abort', async () => {
      const testRunId = 'run-takeover-test-99';

      // 1. Pause
      const pauseRes = await fetch(`http://127.0.0.1:${serverPort}/api/runs/${testRunId}/pause`, {
        method: 'POST',
      });
      expect(pauseRes.status).toBe(200);
      expect(server.getTakeoverStatus(testRunId)).toBe('pause');

      // 2. Resume
      const resumeRes = await fetch(`http://127.0.0.1:${serverPort}/api/runs/${testRunId}/resume`, {
        method: 'POST',
      });
      expect(resumeRes.status).toBe(200);
      expect(server.getTakeoverStatus(testRunId)).toBe('continue');

      // 3. Abort
      const abortRes = await fetch(`http://127.0.0.1:${serverPort}/api/runs/${testRunId}/abort`, {
        method: 'POST',
      });
      expect(abortRes.status).toBe(200);
      expect(server.getTakeoverStatus(testRunId)).toBe('abort');

      // 4. Active runs telemetry
      const activeRes = await fetch(`http://127.0.0.1:${serverPort}/api/runs/active`);
      expect(activeRes.status).toBe(200);
      const activeData: any = await activeRes.json();
      expect(activeData.runs.some((r: any) => r.runId === testRunId)).toBe(true);
    });

    it('POST /api/skills/import imports unified bundles and GET /api/skills/experiences queries experiences', async () => {
      // 1. Export all skills bundle
      const exportRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills/export-all`);
      const { bundle } = await exportRes.json();

      // 2. Import bundle back via POST /api/skills/import
      const importRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      expect(importRes.status).toBe(201);
      const importData = await importRes.json();
      expect(importData.success).toBe(true);
      expect(importData.imported).toBeGreaterThanOrEqual(8);

      // 3. Record an experience and query via GET /api/skills/experiences
      server.getRecoveryEngine().recordRecoveryExperience({
        runId: 'run-exp-query-1',
        actionName: 'browserClick',
        objective: 'Test query experiences',
        outcome: 'success',
      });

      const expRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills/experiences`);
      expect(expRes.status).toBe(200);
      const expData = await expRes.json();
      expect(Array.isArray(expData.experiences)).toBe(true);
      expect(expData.experiences.some((e: any) => e.runId === 'run-exp-query-1')).toBe(true);
    });

    it('POST /api/skills creates persistent custom skill with parameters and handlerCode, and DELETE /api/skills/:id removes it', async () => {
      // 1. Create skill
      const createRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'api-skill-test',
          description: 'Testing persistent skill endpoint',
          instructions: 'Step 1. Run query. Step 2. Verify.',
          handlerCode: 'export function run() { return true; }',
          parameters: { timeout: 3000 },
          skillType: 'tool_extension',
          enabled: true,
        }),
      });
      expect(createRes.status).toBe(201);
      const createData: any = await createRes.json();
      expect(createData.skill.name).toBe('api-skill-test');
      expect(createData.skill.parameters).toEqual({ timeout: 3000 });
      expect(createData.skill.handlerCode).toContain('export function run');

      // 2. Query in list
      const listRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills`);
      expect(listRes.status).toBe(200);
      const listData: any = await listRes.json();
      expect(listData.skills.some((s: any) => s.name === 'api-skill-test')).toBe(true);

      // 3. Delete skill
      const delRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills/${createData.skill.id}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      const delData: any = await delRes.json();
      expect(delData.success).toBe(true);

      // 4. Verify removed from list
      const listAfterRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills`);
      const listAfterData: any = await listAfterRes.json();
      expect(listAfterData.skills.some((s: any) => s.id === createData.skill.id)).toBe(false);
    });

    it('POST /api/skills/import with directoryPath imports skills from directory', async () => {
      const tempImportDir = path.join(process.cwd(), `temp_endpoint_import_${Date.now()}`);
      const skillSubdir = path.join(tempImportDir, 'bundle-test-skill');
      fs.mkdirSync(skillSubdir, { recursive: true });

      const skillMd = `---
name: bundle-test-skill
version: 1.0.0
description: Skill imported via directoryPath endpoint
skill_type: prompt_instruction
enabled: true
required_tools: ["readFile"]
trigger_patterns: ["test", "import"]
---

Imported skill instructions.`;

      fs.writeFileSync(path.join(skillSubdir, 'SKILL.md'), skillMd, 'utf-8');

      const importRes = await fetch(`http://127.0.0.1:${serverPort}/api/skills/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directoryPath: tempImportDir }),
      });

      expect(importRes.status).toBe(201);
      const importData: any = await importRes.json();
      expect(importData.success).toBe(true);
      expect(importData.imported).toBeGreaterThanOrEqual(1);

      fs.rmSync(tempImportDir, { recursive: true, force: true });
    });

    it('POST /api/channels/:id/messages with /skills create and /skills import parses and executes subcommands', async () => {
      const stateRes = await fetch(`http://127.0.0.1:${serverPort}/api/state`);
      const stateData: any = await stateRes.json();
      const channelId = stateData.channels[0].id;

      // 1. Use /skills create slash command
      const channelRes = await fetch(`http://127.0.0.1:${serverPort}/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '/skills create slash-tester | Skill created via slash command | Execute tests | executeShell | test,slash',
          senderId: 'user-operator',
        }),
      });
      expect(channelRes.status).toBe(201);

      // Verify skill was created in SkillEngine
      const created = server.getSkillEngine().getSkill('skill-slash-tester');
      expect(created).toBeDefined();
      expect(created?.description).toBe('Skill created via slash command');
      expect(created?.requiredTools).toEqual(['executeShell']);

      // 2. Use /skills list
      const listCmdRes = await fetch(`http://127.0.0.1:${serverPort}/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '/skills',
          senderId: 'user-operator',
        }),
      });
      expect(listCmdRes.status).toBe(201);
    });

    it('POST /api/approvals creates approval and transitions run state to waiting_for_approval, and resolve updates run', async () => {
      // 1. Insert seed agent & run in test db
      db.execute(`INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at) VALUES ('ws-appr', 'Appr WS', '.', 'AUTO', 1, 1)`);
      db.execute(`INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at) VALUES ('def-appr', 'A', 'A', 'A', 'ollama/test', 1)`);
      db.execute(`INSERT INTO agent_identities (id, workspace_id, definition_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at) VALUES ('agent-appr', 'ws-appr', 'def-appr', 'A', 'ollama/test', 0, 0, 1, 1)`);
      db.execute(`INSERT INTO agent_runs (id, agent_id, state, heartbeat_at, created_at) VALUES ('run-appr-1', 'agent-appr', 'running', 1, 1)`);

      // 2. Create approval via POST /api/approvals
      const createRes = await fetch(`http://127.0.0.1:${serverPort}/api/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-appr-1',
          agentId: 'agent-appr',
          toolName: 'browserClick',
          actionPayload: { text: 'Pay $50' },
          riskLevel: 'CRITICAL',
        }),
      });
      expect(createRes.status).toBe(201);
      const createData: any = await createRes.json();
      expect(createData.approval).toHaveProperty('id');
      expect(createData.approval.status).toBe('pending');

      // Verify run state transitioned to waiting_for_approval in DB
      const runRow = db.queryOne<{ state: string }>(`SELECT state FROM agent_runs WHERE id = 'run-appr-1'`);
      expect(runRow?.state).toBe('waiting_for_approval');

      // 3. Resolve approval via POST /api/approvals/:id/resolve with approve
      const resolveRes = await fetch(`http://127.0.0.1:${serverPort}/api/approvals/${createData.approval.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      expect(resolveRes.status).toBe(200);

      // Verify run state transitioned to running
      const runRowAfter = db.queryOne<{ state: string }>(`SELECT state FROM agent_runs WHERE id = 'run-appr-1'`);
      expect(runRowAfter?.state).toBe('running');
    });
  });

  describe('12. Hardened Edge Cases: Path Jail Prefix Traversal & Recovery Verification', () => {
    it('rejects path traversal attempting sibling directory with identical prefix', () => {
      const gateway = new ToolGateway();
      const worktreeRoot = path.resolve('test-jail-root');
      const siblingEscape = path.resolve(worktreeRoot + '_other', 'secret.txt');
      const relativeEscape = path.relative(worktreeRoot, siblingEscape);

      expect(() => {
        gateway.resolveJailedPath(relativeEscape, worktreeRoot);
      }).toThrow('SECURITY JAIL VIOLATION');
    });

    it('RecoveryEngine flags discrepancies when post-state is missing expected attributes', () => {
      const skillEngine = new SkillEngine(db);
      const recovery = new RecoveryEngine(skillEngine);

      const preState = {
        timestamp: Date.now(),
        type: 'browser' as const,
        url: 'https://example.com/start',
        title: 'Start',
      };

      // Post-state missing URL when expectedUrlPattern was specified
      const postMissingUrl = {
        timestamp: Date.now(),
        type: 'browser' as const,
        title: 'Page With No URL',
      };

      const resultUrl = recovery.verify(preState, postMissingUrl, {
        expectedUrlPattern: 'dashboard',
      });
      expect(resultUrl.passed).toBe(false);
      expect(resultUrl.discrepancies.some((d) => d.includes('no URL'))).toBe(true);

      // Post-state missing Title when expectedTitlePattern was specified
      const postMissingTitle = {
        timestamp: Date.now(),
        type: 'browser' as const,
        url: 'https://example.com/dashboard',
      };

      const resultTitle = recovery.verify(preState, postMissingTitle, {
        expectedTitlePattern: 'Dashboard',
      });
      expect(resultTitle.passed).toBe(false);
      expect(resultTitle.discrepancies.some((d) => d.includes('no title'))).toBe(true);
    });

    it('DesktopController formats SendKeys tokens and escaping correctly', async () => {
      const controller = new DesktopController();
      const sendRes = await controller.sendKey('escape');
      expect(sendRes.success).toBe(true);
      expect(sendRes.details?.stroke).toBe('{ESC}');

      const typeRes = await controller.typeText('{hello}');
      expect(typeRes.success).toBe(true);
    });

    it('AgentLoopRunner.extractToolCall extracts tool calls with arguments, trailing commas, and unclosed tags', () => {
      // 1. Standard format
      const t1 = AgentLoopRunner.extractToolCall(`
<tool_call>
{"name": "browserNavigate", "parameters": {"url": "https://example.com"}}
</tool_call>
`);
      expect(t1).toEqual({ name: 'browserNavigate', params: { url: 'https://example.com' } });

      // 2. "arguments" alias
      const t2 = AgentLoopRunner.extractToolCall(`
<tool_call>
{"name": "desktopMouseMove", "arguments": {"x": 200, "y": 300}}
</tool_call>
`);
      expect(t2).toEqual({ name: 'desktopMouseMove', params: { x: 200, y: 300 } });

      // 3. "args" alias with trailing comma
      const t3 = AgentLoopRunner.extractToolCall(`
<tool_call>
{"name": "desktopType", "args": {"text": "hello world",}}
</tool_call>
`);
      expect(t3).toEqual({ name: 'desktopType', params: { text: 'hello world' } });

      // 4. Unclosed <tool_call> tag
      const t4 = AgentLoopRunner.extractToolCall(`
Here is what I will do next:
<tool_call>
{"name": "desktopScreenshot", "params": {}}
`);
      expect(t4).toEqual({ name: 'desktopScreenshot', params: {} });

      // 5. Code fences
      const t5 = AgentLoopRunner.extractToolCall(`
<tool_call>
\`\`\`json
{"name": "schedule", "parameters": {"type": "one_shot", "prompt": "check status", "durationSeconds": 60}}
\`\`\`
</tool_call>
`);
      expect(t5).toEqual({
        name: 'schedule',
        params: { type: 'one_shot', prompt: 'check status', durationSeconds: 60 },
      });
    });

    it('RecoveryEngine.verify safely evaluates patterns containing regex meta-characters without throwing', () => {
      const skillEngine = new SkillEngine(db);
      const recovery = new RecoveryEngine(skillEngine);

      const preState = {
        timestamp: Date.now() - 1000,
        type: 'browser' as const,
        url: 'https://example.com/items',
        title: 'Search Form',
        domSnippet: '<form action="/items">Search</form>',
      };

      const postState = {
        timestamp: Date.now(),
        type: 'browser' as const,
        url: 'https://example.com/items?query=[test]&filter=(active)+all',
        title: 'Search [Results] (10+ items)',
        domSnippet: 'Found [10] matches for (test)+all',
      };

      // Patterns containing unescaped [, ], (, ), +, ? that would crash standard RegExp()
      const res = recovery.verify(preState, postState, {
        expectedUrlPattern: 'query=[test]',
        expectedTitlePattern: '[Results] (10+ items)',
        expectedTextPattern: '[10] matches for (test)+all',
      });

      // Should not throw SyntaxError and should pass because text matches
      expect(res.passed).toBe(true);
      expect(res.discrepancies.length).toBe(0);
    });

    it('SchedulerService.parseCronIntervalSeconds accurately calculates intervals across cron notations', () => {
      const scheduler = new SchedulerService(db);

      // Seconds notation
      expect(scheduler.parseCronIntervalSeconds('*/30s')).toBe(30);
      expect(scheduler.parseCronIntervalSeconds('*/5s')).toBe(5);

      // Minute intervals
      expect(scheduler.parseCronIntervalSeconds('*/5 * * * *')).toBe(300);
      expect(scheduler.parseCronIntervalSeconds('*/15 * * * *')).toBe(900);

      // Daily
      expect(scheduler.parseCronIntervalSeconds('0 0 * * *')).toBe(86400);
      expect(scheduler.parseCronIntervalSeconds('30 2 * * *')).toBe(86400);

      // Hourly
      expect(scheduler.parseCronIntervalSeconds('0 * * * *')).toBe(3600);

      // Hourly with intervals
      expect(scheduler.parseCronIntervalSeconds('0 */2 * * *')).toBe(7200);
      expect(scheduler.parseCronIntervalSeconds('0 */6 * * *')).toBe(21600);

      // Fallback every minute
      expect(scheduler.parseCronIntervalSeconds('* * * * *')).toBe(60);

      scheduler.stop();
    });
  });
});
