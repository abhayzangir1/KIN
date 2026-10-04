import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { SkillEngine, parseFrontmatterAndBody } from '../src/skills/skill_engine.js';
import { MemoryRepository } from '../src/domain/memory_repository.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('KIN Learning & Self-Improvement Pipeline (OpenDots + Trans4mers Architecture)', () => {
  let db: KinDatabase;
  let testDbPath: string;
  let skillEngine: SkillEngine;
  let memoryRepo: MemoryRepository;

  beforeEach(() => {
    testDbPath = path.join(process.cwd(), `test_learning_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
    db = new KinDatabase({ dbPath: testDbPath });
    const runner = new MigrationRunner(db);
    runner.runMigrations();

    // Create a default agent identity so foreign key constraints on agent_runs are met
    db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES ('ws-1', 'Test Workspace', '.', 'AUTO', 1, 1)`
    );
    db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES ('proj-1', 'ws-1', 'Test Project', '.', '{}', 1, 1)`
    );
    db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, created_at)
       VALUES ('def-1', 'Boss', 'Lead Orchestrator', 'Prompt', 'llama3', 1)`
    );
    db.execute(
      `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, active_model_id, is_orchestrator, created_at, updated_at)
       VALUES ('agent-boss', 'ws-1', 'proj-1', 'def-1', 'Boss', 'llama3', 1, 1, 1)`
    );

    skillEngine = new SkillEngine(db);
    memoryRepo = new MemoryRepository(db);
  });

  afterEach(() => {
    db.close();
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch {}
  });

  it('1. Experience Capture: records rich tool-level and recovery experiences with lessons learned', () => {
    const exp1 = skillEngine.recordExperience({
      runId: 'run-101',
      toolName: 'browserClick',
      objective: 'Click checkout button',
      outcome: 'failure',
      failureReason: 'Element #checkout-btn obscured by modal backdrop overlay',
      repairStrategy: 'dismiss_modal',
      lessonsLearned: 'Modal backdrop must be dismissed before clicking checkout selector.',
      metadata: { selector: '#checkout-btn' },
    });

    expect(exp1.id).toBeDefined();
    expect(exp1.toolName).toBe('browserClick');
    expect(exp1.outcome).toBe('failure');
    expect(exp1.repairStrategy).toBe('dismiss_modal');

    const exp2 = skillEngine.recordExperience({
      runId: 'run-102',
      toolName: 'browserClick',
      objective: 'Click checkout button after modal dismiss',
      outcome: 'success',
      repairStrategy: 'dismiss_modal',
      lessonsLearned: 'Dismissing modal allowed click to proceed.',
    });

    expect(exp2.outcome).toBe('success');

    const allExp = skillEngine.listExperiences();
    expect(allExp.length).toBe(2);
    expect(allExp[0].repairStrategy).toBe('dismiss_modal');
  });

  it('2. Candidate Lesson Harvesting: synthesizes structured candidate lessons without polluting active skills', () => {
    // Record multiple failures with recovery strategies
    skillEngine.recordExperience({
      runId: 'run-201',
      toolName: 'browserClick',
      objective: 'Navigate and click navigation drawer',
      outcome: 'failure',
      failureReason: 'DOM selector timeout: #nav-drawer not visible',
      repairStrategy: 'alternative_selector',
      lessonsLearned: 'Use text-based selector instead of fragile ID',
    });

    skillEngine.recordExperience({
      runId: 'run-202',
      toolName: 'browserClick',
      objective: 'Navigate and click navigation drawer again',
      outcome: 'failure',
      failureReason: 'DOM selector timeout: #nav-drawer not visible',
      repairStrategy: 'alternative_selector',
      lessonsLearned: 'Use alternative selector fallback',
    });

    const harvest = skillEngine.harvestCandidateLessons();
    expect(harvest.createdCount).toBeGreaterThan(0);

    const candidates = skillEngine.listCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    const candidate = candidates[0];
    expect(candidate.status).toBe('candidate');
    expect(candidate.version).toBe('0.1.0');
    expect(candidate.evidenceCount).toBeGreaterThanOrEqual(1);

    // CRITICAL ARCHITECTURAL BOUNDARY: Candidates must NEVER be returned by active matchSkills!
    const activeMatches = skillEngine.matchSkills('browser click nav drawer');
    const hasCandidateInActive = activeMatches.some((s) => s.status === 'candidate');
    expect(hasCandidateInActive).toBe(false);
  });

  it('3. Validation Gate: promoting candidate requires validation, bumps version to 1.0.0, and archives to skill_versions', () => {
    // Create an explicit candidate lesson
    const candidate = skillEngine.createSkill({
      name: 'candidate-modal-dismiss-rule',
      description: 'Learned rule for dismissing promotional overlays before clicking',
      instructions: 'Always inspect if an overlay is present. If found, dismiss it first.',
      triggerPatterns: ['modal', 'overlay', 'popup'],
      status: 'candidate',
      evidenceCount: 3,
    });

    expect(candidate.status).toBe('candidate');
    expect(candidate.version).toBe('0.1.0');

    // Promotion gate
    const promotion = skillEngine.validateAndPromoteCandidate(candidate.id, {
      action: 'promote',
      reviewer: 'QA-Lead-Architect',
      rationale: 'Verified across 3 successful runs on test site',
    });

    expect(promotion.success).toBe(true);
    expect(promotion.skill?.status).toBe('active');
    expect(promotion.skill?.version).toBe('1.0.0');
    expect(promotion.skill?.validatorRef).toBe('QA-Lead-Architect');

    // Verify archived snapshot in skill_versions
    const history = skillEngine.getSkillVersionHistory(candidate.id);
    expect(history.length).toBe(1);
    expect(history[0].version).toBe('0.1.0');
    expect(history[0].promotedBy).toBe('QA-Lead-Architect');

    // Now it IS matched by active matchSkills
    const matched = skillEngine.matchSkills('handling popup overlay modal');
    expect(matched.some((s) => s.id === candidate.id)).toBe(true);
  });

  it('4. Rejection Gate: candidate rejection marks skill deprecated', () => {
    const candidate = skillEngine.createSkill({
      name: 'candidate-flaky-workaround',
      description: 'Temporary flaky workaround that should not be promoted',
      instructions: 'Sleep for 10 seconds blindly.',
      status: 'candidate',
    });

    const rejection = skillEngine.validateAndPromoteCandidate(candidate.id, {
      action: 'reject',
      reviewer: 'Security-Officer',
      rationale: 'Violates non-blocking rule; sleep is banned.',
    });

    expect(rejection.success).toBe(true);
    const updated = skillEngine.getSkill(candidate.id);
    expect(updated?.status).toBe('deprecated');

    // Banned/deprecated candidate is never matched
    const matched = skillEngine.matchSkills('flaky workaround sleep');
    expect(matched.some((s) => s.id === candidate.id)).toBe(false);
  });

  it('5. Version History & Rollback: reverts degraded skill to previous version snapshot', () => {
    const skill = skillEngine.createSkill({
      name: 'git-rebase-workflow',
      description: 'Standard safe rebase workflow',
      instructions: '1. git fetch origin\n2. git rebase origin/main\n3. verify clean state',
      status: 'active',
      version: '1.0.0',
    });

    // Update skill to v1.0.1
    const updated = skillEngine.updateSkill(
      skill.id,
      {
        instructions: '1. git rebase --force-rebase (DANGEROUS DEGRADED INSTRUCTION)',
      },
      'Dev-A',
      'Experimented with aggressive rebase'
    );

    expect(updated.version).toBe('1.0.1');
    expect(updated.instructions).toContain('DANGEROUS');

    const history = skillEngine.getSkillVersionHistory(skill.id);
    expect(history.length).toBe(1);
    expect(history[0].version).toBe('1.0.0');

    // Perform rollback
    const restored = skillEngine.rollbackSkill(skill.id, history[0].id);
    expect(restored.version).toBe('1.0.0');
    expect(restored.instructions).toContain('verify clean state');
    expect(restored.instructions).not.toContain('DANGEROUS');
  });

  it('6. Budgeted Selective Retrieval: limits returned skills by count and token budget, prioritizing empirical win rates', () => {
    const s1 = skillEngine.createSkill({
      name: 'skill-alpha',
      instructions: 'Alpha instructions: ' + 'A'.repeat(500),
      triggerPatterns: ['keyword'],
      status: 'active',
    });
    const s2 = skillEngine.createSkill({
      name: 'skill-beta',
      instructions: 'Beta instructions: ' + 'B'.repeat(500),
      triggerPatterns: ['keyword'],
      status: 'active',
    });
    const s3 = skillEngine.createSkill({
      name: 'skill-gamma',
      instructions: 'Gamma instructions: ' + 'C'.repeat(500),
      triggerPatterns: ['keyword'],
      status: 'active',
    });

    // Give s2 a high win rate
    skillEngine.recordExperience({
      skillId: s2.id,
      runId: 'run-w1',
      objective: 'test',
      outcome: 'success',
    });
    skillEngine.recordExperience({
      skillId: s2.id,
      runId: 'run-w2',
      objective: 'test',
      outcome: 'success',
    });

    // Match with maxSkills = 2
    const matches = skillEngine.matchSkills('keyword task', undefined, { maxSkills: 2 });
    expect(matches.length).toBeLessThanOrEqual(2);
    // s2 must be ranked first due to proven empirical win rate
    expect(matches[0].id).toBe(s2.id);
  });

  it('7. Learning & Telemetry Metrics: aggregates tool reliability and recovery strategy success rates', () => {
    skillEngine.recordExperience({
      runId: 'r1',
      toolName: 'executeShell',
      objective: 'npm test',
      outcome: 'success',
    });
    skillEngine.recordExperience({
      runId: 'r2',
      toolName: 'executeShell',
      objective: 'git pull',
      outcome: 'failure',
      failureReason: 'Merge conflict',
    });
    skillEngine.recordExperience({
      runId: 'r3',
      toolName: 'browserNavigate',
      objective: 'open dashboard',
      outcome: 'success',
      repairStrategy: 'wait_and_retry',
    });

    const metrics = skillEngine.getLearningMetrics();
    expect(metrics.totalExperiences).toBe(3);

    const shellTool = metrics.toolReliability.find((t) => t.toolName === 'executeShell');
    expect(shellTool).toBeDefined();
    expect(shellTool?.invocations).toBe(2);
    expect(shellTool?.successes).toBe(1);
    expect(shellTool?.failures).toBe(1);
    expect(shellTool?.successRate).toBe(50);

    const waitStrat = metrics.recoveryStrategies.find((s) => s.strategy === 'wait_and_retry');
    expect(waitStrat).toBeDefined();
    expect(waitStrat?.suggestedCount).toBe(1);
    expect(waitStrat?.successRate).toBe(100);
  });

  it('8. Memory Repository: stores scoped memories with OCC and maintains version snapshots in memory_versions', () => {
    const mem = memoryRepo.setMemory({
      scope: 'project',
      scopeId: 'proj-1',
      type: 'procedural',
      key: 'db_convention',
      value: { journalMode: 'WAL', timeout: 5000 },
    });

    expect(mem.id).toBeDefined();
    expect(mem.version).toBe(1);

    // Update with OCC
    const updatedMem = memoryRepo.setMemory({
      scope: 'project',
      scopeId: 'proj-1',
      type: 'procedural',
      key: 'db_convention',
      value: { journalMode: 'WAL', timeout: 10000, synchronous: 'NORMAL' },
      expectedVersion: 1,
    });

    expect(updatedMem.version).toBe(2);

    // Check version history snapshot
    const history = memoryRepo.getVersionHistory(mem.id);
    expect(history.length).toBe(1);
    expect(history[0].version).toBe(1);

    // OCC conflict rejection
    expect(() => {
      memoryRepo.setMemory({
        scope: 'project',
        scopeId: 'proj-1',
        type: 'procedural',
        key: 'db_convention',
        value: { bad: true },
        expectedVersion: 1, // outdated version!
      });
    }).toThrow(/OCC CONFLICT/);
  });

  it('9. Persistent Skill Creation: persists custom skills with parameters, handlerCode, and disk files in .kin/skills/', () => {
    const customSkill = skillEngine.createSkill({
      id: 'skill-paper-extractor',
      name: 'paper-extractor',
      version: '1.2.0',
      description: 'Extracts methodology and conclusions from scientific literature',
      instructions: '1. Read document text. 2. Parse methodology. 3. Extract key metrics.',
      handlerCode: 'export function extract(text: string) { return { extracted: true }; }',
      parameters: { format: 'json', maxTokens: 4000 },
      requiredTools: ['readFile'],
      triggerPatterns: ['paper', 'extract', 'literature'],
      skillType: 'tool_extension',
      enabled: true,
    });

    expect(customSkill.id).toBe('skill-paper-extractor');
    expect(customSkill.name).toBe('paper-extractor');
    expect(customSkill.version).toBe('1.2.0');
    expect(customSkill.handlerCode).toContain('export function extract');
    expect(customSkill.parameters).toEqual({ format: 'json', maxTokens: 4000 });
    expect(customSkill.enabled).toBe(true);

    // Verify disk persistence in .kin/skills/
    const diskPath = path.join(skillEngine.getSkillsDir(), 'paper-extractor', 'SKILL.md');
    expect(fs.existsSync(diskPath)).toBe(true);
    const diskContent = fs.readFileSync(diskPath, 'utf-8');
    expect(diskContent).toContain('name: paper-extractor');
    expect(diskContent).toContain('Extracts methodology and conclusions');

    const implPath = path.join(skillEngine.getSkillsDir(), 'paper-extractor', 'implementation.ts');
    expect(fs.existsSync(implPath)).toBe(true);
    expect(fs.readFileSync(implPath, 'utf-8')).toContain('export function extract');

    const jsonPath = path.join(skillEngine.getSkillsDir(), 'paper-extractor', 'skill.json');
    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  it('10. Directory Import & Loading: scans and imports skills from directory containing SKILL.md and implementation.ts', () => {
    const tempDir = path.join(process.cwd(), `temp_skill_import_${Date.now()}`);
    const skillSubdir = path.join(tempDir, 'data-cleaner');
    fs.mkdirSync(skillSubdir, { recursive: true });

    const skillMd = `---
name: data-cleaner
version: 2.0.0
description: Cleans and standardizes raw CSV data
skill_type: tool_extension
enabled: true
required_tools: ["readFile", "writeFile"]
trigger_patterns: ["clean", "csv", "data"]
parameters: {"nullThreshold": 0.2}
---

Steps to clean CSV:
1. Inspect header row.
2. Strip trailing whitespace.
3. Validate numeric columns.`;

    fs.writeFileSync(path.join(skillSubdir, 'SKILL.md'), skillMd, 'utf-8');
    fs.writeFileSync(path.join(skillSubdir, 'implementation.ts'), 'export function clean(data: any) { return []; }', 'utf-8');

    // Import directory
    const importResult = skillEngine.importSkillDirectory(tempDir);
    expect(importResult.imported).toBeGreaterThanOrEqual(1);

    const importedSkill = skillEngine.getSkill('skill-data-cleaner');
    expect(importedSkill).toBeDefined();
    expect(importedSkill?.name).toBe('data-cleaner');
    expect(importedSkill?.version).toBe('2.0.0');
    expect(importedSkill?.instructions).toContain('Steps to clean CSV');
    expect(importedSkill?.handlerCode).toContain('export function clean');
    expect(importedSkill?.requiredTools).toEqual(['readFile', 'writeFile']);

    // Clean up tempDir
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('11. ToolGateway create_skill & import_skill: swarmed agents dynamically create and import skills via tool calls', async () => {
    const toolGateway = new ToolGateway({ db, skillEngine });

    const context = {
      runId: 'run-swarm-1',
      agentId: 'agent-boss',
      worktreeRoot: process.cwd(),
      autonomyMode: 'AUTO' as const,
      allowedCapabilities: ['*'],
    };

    // Agent executes create_skill tool
    const createRes = await toolGateway.executeTool<any>(
      'create_skill',
      {
        name: 'dynamic-summarizer',
        description: 'Auto-generated specialist skill created by agent workforce',
        instructions: 'Summarize text with 3 executive bullet points.',
        parameters: { style: 'bullets' },
        triggerPatterns: ['summarize', 'brief'],
      },
      context
    );

    expect(createRes.success).toBe(true);
    expect(createRes.output?.name).toBe('dynamic-summarizer');

    const createdInDb = skillEngine.getSkill('skill-dynamic-summarizer');
    expect(createdInDb).toBeDefined();
    expect(createdInDb?.description).toBe('Auto-generated specialist skill created by agent workforce');

    // Agent executes import_skill tool with bundle JSON
    const importRes = await toolGateway.executeTool<any>(
      'import_skill',
      {
        bundleJson: JSON.stringify({
          skills: [
            {
              name: 'json-validator',
              description: 'Validates JSON schemas and syntax',
              instructions: 'Validate schema against specification.',
              requiredTools: ['readFile'],
            },
          ],
        }),
      },
      context
    );

    expect(importRes.success).toBe(true);
    expect(importRes.output?.importedCount).toBe(1);
    expect(skillEngine.getSkill('skill-json-validator')).toBeDefined();
  });

  it('12. Skill Deletion: cleans up SQLite state and disk directory', () => {
    const skill = skillEngine.createSkill({
      name: 'temporary-skill',
      description: 'Skill to be deleted',
      instructions: 'Temporary instructions',
    });

    expect(skillEngine.getSkill(skill.id)).toBeDefined();
    const diskPath = path.join(skillEngine.getSkillsDir(), 'temporary-skill');
    expect(fs.existsSync(diskPath)).toBe(true);

    const deleted = skillEngine.deleteSkill(skill.id);
    expect(deleted).toBe(true);
    expect(skillEngine.getSkill(skill.id)).toBeUndefined();
    expect(fs.existsSync(diskPath)).toBe(false);
  });

  it('13. YAML Frontmatter Parser: parses bulleted lists, handles unclosed delimiters, and files without trailing newlines', () => {
    // 1. Standard YAML with bulleted lists and folded multiline
    const yamlStandard = `---
name: yaml-bullet-skill
version: 1.5.0
description: >
  A multi-line folded
  description string.
required_tools:
  - readFile
  - executeShell
trigger_patterns:
  - analysis
  - metrics
parameters: {"timeout": 5000}
enabled: true
---
Procedural steps:
1. Do this.
2. Do that.`;

    const parsed1 = parseFrontmatterAndBody(yamlStandard);
    expect(parsed1.frontmatter.name).toBe('yaml-bullet-skill');
    expect(parsed1.frontmatter.version).toBe('1.5.0');
    expect(parsed1.frontmatter.description).toBe('A multi-line folded description string.');
    expect(parsed1.frontmatter.required_tools).toEqual(['readFile', 'executeShell']);
    expect(parsed1.frontmatter.trigger_patterns).toEqual(['analysis', 'metrics']);
    expect(parsed1.frontmatter.parameters).toEqual({ timeout: 5000 });
    expect(parsed1.frontmatter.enabled).toBe(true);
    expect(parsed1.body).toContain('Procedural steps:');

    // 2. File ending with --- without trailing newline
    const yamlNoTrailingNewline = `---\nname: no-newline-skill\nversion: 2.0.0\n---`;
    const parsed2 = parseFrontmatterAndBody(yamlNoTrailingNewline);
    expect(parsed2.frontmatter.name).toBe('no-newline-skill');
    expect(parsed2.frontmatter.version).toBe('2.0.0');

    // 3. Unclosed delimiter fallback
    const yamlUnclosed = `---\nname: unclosed-skill\ndescription: Unclosed frontmatter test`;
    const parsed3 = parseFrontmatterAndBody(yamlUnclosed);
    expect(parsed3.frontmatter.name).toBe('unclosed-skill');
    expect(parsed3.frontmatter.description).toBe('Unclosed frontmatter test');
  });

  it('14. Directory Import with Standard YAML & Standalone Markdown: imports bulleted skills and standalone md files', () => {
    const tempDir = path.join(process.cwd(), `temp_yaml_import_${Date.now()}`);
    const skillSubdir = path.join(tempDir, 'bullet-skill');
    fs.mkdirSync(skillSubdir, { recursive: true });

    const skillMd = `---
name: bullet-skill
version: 1.0.0
description: Skill with YAML bullet lists
required_tools:
  - readFile
  - executeShell
trigger_patterns:
  - bullet
  - list
---
Instructions for bullet skill.`;

    fs.writeFileSync(path.join(skillSubdir, 'SKILL.md'), skillMd, 'utf-8');

    // Also write a standalone markdown file
    const standaloneMd = `---
name: standalone-skill
version: 1.1.0
description: Standalone markdown skill
requiredTools:
  - writeFile
tags:
  - standalone
---
Standalone skill instructions.`;
    fs.writeFileSync(path.join(tempDir, 'standalone-skill.md'), standaloneMd, 'utf-8');

    const result = skillEngine.importSkillDirectory(tempDir);
    expect(result.imported).toBe(2);

    const s1 = skillEngine.getSkill('skill-bullet-skill');
    expect(s1).toBeDefined();
    expect(s1?.requiredTools).toEqual(['readFile', 'executeShell']);
    expect(s1?.triggerPatterns).toEqual(['bullet', 'list']);

    const s2 = skillEngine.getSkill('skill-standalone-skill');
    expect(s2).toBeDefined();
    expect(s2?.requiredTools).toEqual(['writeFile']);
    expect(s2?.triggerPatterns).toEqual(['standalone']);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('15. Safe Skill Deletion & Path Confinement: protects root skills directory against accidental deletion', () => {
    const custom = skillEngine.createSkill({
      id: 'skill-safe-del',
      name: 'safe-del',
      description: 'Testing path confinement',
      instructions: 'Run test.',
    });

    const skillsDir = skillEngine.getSkillsDir();
    expect(fs.existsSync(skillsDir)).toBe(true);

    const deleted = skillEngine.deleteSkill('skill-safe-del');
    expect(deleted).toBe(true);
    // Root skillsDir must never be deleted!
    expect(fs.existsSync(skillsDir)).toBe(true);
  });
});
