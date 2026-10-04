// ============================================================================
// KIN RUNTIME SKILL ENGINE & LEARNING PIPELINE
// Procedural skill registry, evidence-driven continuous self-improvement,
// candidate lesson harvesting, validation & promotion gates, version snapshots,
// rollback management, selective budgeted retrieval, and learning metrics.
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { KinDatabase } from '../storage/db.js';
import { v4 as uuidv4 } from 'uuid';

export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  instructions: string;
  requiredTools: string[];
  triggerPatterns: string[];
  tags?: string[];
  isBuiltIn: boolean;
  status: 'candidate' | 'active' | 'deprecated' | 'disabled';
  parameters?: Record<string, unknown> | string;
  handlerCode?: string;
  skillType?: string;
  enabled?: boolean;
  evidenceCount?: number;
  successCount?: number;
  failureCount?: number;
  lastValidatedAt?: number;
  validatorRef?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: string;
  description: string;
  instructions: string;
  triggerPatterns: string[];
  promotedBy: string;
  changeSummary?: string;
  createdAt: number;
}

export interface SkillExperience {
  id: string;
  skillId?: string;
  runId: string;
  toolName?: string;
  objective: string;
  outcome: 'success' | 'failure';
  failureReason?: string;
  repairStrategy?: string;
  lessonsLearned?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface ToolReliabilityMetric {
  toolName: string;
  invocations: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface RecoveryStrategyMetric {
  strategy: string;
  suggestedCount: number;
  successfulCount: number;
  successRate: number;
}

export interface LearningMetrics {
  totalExperiences: number;
  totalSkills: number;
  activeSkillsCount: number;
  candidateSkillsCount: number;
  deprecatedSkillsCount: number;
  toolReliability: ToolReliabilityMetric[];
  recoveryStrategies: RecoveryStrategyMetric[];
}

export class SkillEngine {
  private db: KinDatabase;
  private skillsDir: string;

  constructor(db: KinDatabase, options?: { skillsDir?: string }) {
    this.db = db;
    this.skillsDir = options?.skillsDir || path.resolve(process.cwd(), '.kin', 'skills');
    this.seedDefaultSkills();
    this.loadSkillsFromDirectory();
  }

  public getSkillsDir(): string {
    return this.skillsDir;
  }

  /**
   * Seeds foundational procedural skills into SQLite if not present.
   */
  public seedDefaultSkills(): void {
    const defaults: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        name: 'sqlite-optimization',
        version: '1.0.0',
        description: 'Best practices for high-concurrency SQLite WAL querying and transaction isolation',
        instructions: 'When working with SQLite: 1. Always use WAL journal mode. 2. Use parameterized prepared statements. 3. Avoid long-running exclusive locks. 4. Check indexes for foreign key filters.',
        requiredTools: ['readFile', 'executeShell'],
        triggerPatterns: ['sqlite', 'database', 'wal', 'transaction', 'query'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
      {
        name: 'code-refactoring-and-review',
        version: '1.0.0',
        description: 'Automated architectural review and zero-regression refactoring guidance',
        instructions: 'When refactoring or reviewing code: 1. Verify boundary conditions and jail paths. 2. Enforce separation of concerns. 3. Maintain backward compatibility. 4. Run test suites before and after modifications.',
        requiredTools: ['readFile', 'writeFile', 'git'],
        triggerPatterns: ['refactor', 'review', 'clean code', 'architecture'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
      {
        name: 'security-boundary-auditing',
        version: '1.0.0',
        description: 'Audit filesystem jail boundaries, process execution safety, and permission escalation prevention',
        instructions: 'Security audit rules: 1. Disallow path traversal (..). 2. Verify all shell commands run in isolated jail. 3. Require interactive human approval for destructive operations. 4. Sanitize parameters.',
        requiredTools: ['readFile', 'executeShell'],
        triggerPatterns: ['security', 'audit', 'permission', 'jail', 'boundary', 'vulnerability'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
      {
        name: 'antigravity-timed-autonomy',
        version: '1.0.0',
        description: 'Non-blocking agent scheduling and sleep/wake timer management',
        instructions: 'When a long wait or monitoring task is needed: 1. Do not busy-poll on CPU/GPU. 2. Use the schedule tool to register a one-shot timer or recurring cron. 3. Transition to idle state. 4. Await wakeup callback.',
        requiredTools: ['schedule'],
        triggerPatterns: ['schedule', 'timer', 'wait', 'watch', 'monitor', 'cron', 'routine'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
      {
        name: 'desktop-application-control',
        version: '1.0.0',
        description: 'Discovering, launching, inspecting, and focusing installed desktop applications',
        instructions: 'When controlling host desktop applications: 1. Use desktopDiscoverApps to verify application executable path. 2. Launch with desktopLaunchApp. 3. Use desktopListWindows to locate top-level window. 4. Focus window using desktopFocusWindow before interacting.',
        requiredTools: ['desktopDiscoverApps', 'desktopLaunchApp', 'desktopListWindows', 'desktopFocusWindow'],
        triggerPatterns: ['app', 'application', 'vscode', 'chrome', 'whatsapp', 'android studio', 'launch', 'window', 'desktop'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
      {
        name: 'persistent-browser-automation',
        version: '1.0.0',
        description: 'Persistent browser session navigation, DOM element inspection, and authenticated session reuse',
        instructions: 'When automating web workflows: 1. Navigate to target URL using browserNavigate. 2. Inspect interactive elements using browserInspect. 3. Use browserClick or browserType on verified selectors. 4. Verify visual outcomes via browserScreenshot. Sessions and cookies persist across runs.',
        requiredTools: ['browserNavigate', 'browserInspect', 'browserClick', 'browserType', 'browserScreenshot'],
        triggerPatterns: ['browser', 'browse', 'web', 'page', 'url', 'site', 'dom', 'click', 'form', 'scrape'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
      {
        name: 'financial-commerce-safety',
        version: '1.0.0',
        description: 'Zero-trust financial safeguards, payment boundary detection, and sensitive secret protection',
        instructions: 'When handling checkout, financial, or billing operations: 1. All financial transactions are hardcoded CRITICAL risk. 2. Pause execution and escalate to interactive human approval. 3. Never echo or request credit card numbers, CVVs, or private keys into context. 4. Await human authorization before completing checkout.',
        requiredTools: ['browserNavigate', 'browserClick'],
        triggerPatterns: ['checkout', 'buy', 'pay', 'purchase', 'card', 'payment', 'stripe', 'paypal', 'billing', 'commerce'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
      {
        name: 'observe-act-verify-recovery',
        version: '1.0.0',
        description: 'Self-healing Observe-Act-Observe-Verify execution loop and fault recovery',
        instructions: 'When executing consequential physical actions: 1. Observe pre-state. 2. Perform targeted action. 3. Observe post-state. 4. Verify whether state mutation satisfied the objective. 5. If verification fails, apply self-healing strategies (dismiss popup modal, alternative selector, retry).',
        requiredTools: ['desktopScreenshot', 'browserScreenshot', 'browserInspect'],
        triggerPatterns: ['observe', 'verify', 'recovery', 'heal', 'retry', 'fault', 'error', 'fix'],
        isBuiltIn: true,
        status: 'active',
        evidenceCount: 10,
        successCount: 5,
        failureCount: 0,
      },
    ];

    const now = Date.now();
    for (const d of defaults) {
      const id = `skill-${d.name}`;
      const existing = this.db.queryOne<{ id: string }>('SELECT id FROM skills WHERE id = ?', id);
      if (!existing) {
        this.db.execute(
          `INSERT INTO skills (id, name, version, description, instructions, required_tools_json, trigger_patterns_json, is_built_in, status, evidence_count, success_count, failure_count, parameters_json, handler_code, skill_type, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', NULL, 'prompt_instruction', 1, ?, ?)`,
          id,
          d.name,
          d.version,
          d.description,
          d.instructions,
          JSON.stringify(d.requiredTools),
          JSON.stringify(d.triggerPatterns),
          d.isBuiltIn ? 1 : 0,
          d.status,
          d.evidenceCount ?? 10,
          d.successCount ?? 5,
          d.failureCount ?? 0,
          now,
          now
        );
      }
    }
  }

  /**
   * Lists skills, optionally filtered by status ('active', 'candidate', 'deprecated', 'disabled').
   * Defaults to 'active'.
   */
  public listSkills(statusFilter: 'candidate' | 'active' | 'deprecated' | 'disabled' | 'all' = 'active'): Skill[] {
    let sql = 'SELECT * FROM skills';
    const params: any[] = [];
    if (statusFilter !== 'all') {
      sql += ' WHERE status = ?';
      params.push(statusFilter);
    }
    sql += ' ORDER BY is_built_in DESC, name ASC';

    const rows = this.db.query<any>(sql, ...params);
    return rows.map(this.mapRowToSkill);
  }

  /**
   * Lists unvalidated candidate lessons awaiting review and promotion.
   */
  public listCandidates(): Skill[] {
    return this.listSkills('candidate');
  }

  /**
   * Retrieves a skill by ID or name.
   */
  public getSkill(idOrName: string): Skill | undefined {
    const row = this.db.queryOne<any>(
      'SELECT * FROM skills WHERE id = ? OR name = ?',
      idOrName,
      idOrName
    );

    return row ? this.mapRowToSkill(row) : undefined;
  }

  /**
   * Dynamically executes a skill handlerCode in a sandboxed VM context.
   */
  public async executeSkill(
    idOrName: string,
    params: Record<string, any> = {}
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    const skill = this.getSkill(idOrName);
    if (!skill) {
      return { success: false, error: `Skill '${idOrName}' not found.` };
    }

    if (skill.enabled === false || skill.status === 'disabled') {
      return { success: false, error: `Skill '${skill.name}' is currently disabled.` };
    }

    if (!skill.handlerCode || skill.handlerCode.trim().length === 0) {
      return {
        success: true,
        output: {
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          parameters: params,
        },
      };
    }

    try {
      const sandbox = {
        params,
        Buffer,
        JSON,
        Math,
        Date,
        console: {
          log: () => {},
          warn: () => {},
          error: () => {},
        },
        result: undefined as any,
      };

      const context = vm.createContext(sandbox);
      const wrappedCode = `
        (async () => {
          ${skill.handlerCode}
          if (typeof handler === 'function') {
            return await handler(params);
          }
          if (typeof execute === 'function') {
            return await execute(params);
          }
          if (typeof run === 'function') {
            return await run(params);
          }
          return typeof result !== 'undefined' ? result : { executed: true };
        })()
      `;

      const script = new vm.Script(wrappedCode);
      const executionPromise = script.runInContext(context, { timeout: 10000 });
      const output = await executionPromise;

      return {
        success: true,
        output,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Skill '${skill.name}' execution failed: ${err?.message || String(err)}`,
      };
    }
  }

  /**
   * Creates a new skill (custom or candidate) and persists to SQLite and disk (.kin/skills/).
   */
  public createSkill(params: {
    id?: string;
    name: string;
    version?: string;
    description: string;
    instructions?: string;
    handlerCode?: string;
    parameters?: Record<string, unknown> | string;
    requiredTools?: string[];
    triggerPatterns?: string[];
    tags?: string[];
    skillType?: string;
    enabled?: boolean;
    status?: 'candidate' | 'active' | 'deprecated' | 'disabled';
    evidenceCount?: number;
  }): Skill {
    const rawName = params.name.trim();
    const sanitizedName = rawName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const id = params.id ? params.id.trim() : `skill-${sanitizedName}`;
    const now = Date.now();
    const patterns = params.triggerPatterns || params.tags || [];
    const enabled = params.enabled !== undefined ? Boolean(params.enabled) : (params.status !== 'disabled');
    const status = !enabled ? 'disabled' : (params.status || 'active');
    const instructions = params.instructions || params.handlerCode || '';
    const skillType = params.skillType || (params.handlerCode ? 'tool_extension' : 'prompt_instruction');
    const paramsJson = typeof params.parameters === 'object' && params.parameters !== null
      ? JSON.stringify(params.parameters)
      : typeof params.parameters === 'string'
      ? params.parameters
      : '{}';

    this.db.execute(
      `INSERT INTO skills (id, name, version, description, instructions, required_tools_json, trigger_patterns_json, is_built_in, status, evidence_count, success_count, failure_count, parameters_json, handler_code, skill_type, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         version = excluded.version,
         description = excluded.description,
         instructions = excluded.instructions,
         required_tools_json = excluded.required_tools_json,
         trigger_patterns_json = excluded.trigger_patterns_json,
         status = excluded.status,
         parameters_json = excluded.parameters_json,
         handler_code = excluded.handler_code,
         skill_type = excluded.skill_type,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
      id,
      rawName,
      params.version || (status === 'candidate' ? '0.1.0' : '1.0.0'),
      params.description || '',
      instructions,
      JSON.stringify(params.requiredTools || []),
      JSON.stringify(patterns),
      status,
      params.evidenceCount || 1,
      paramsJson,
      params.handlerCode || null,
      skillType,
      enabled ? 1 : 0,
      now,
      now
    );

    const created = this.getSkill(id)!;
    this.saveSkillToDisk(created);
    return created;
  }

  /**
   * Updates an existing custom skill, automatically archiving the previous version.
   */
  public updateSkill(
    id: string,
    params: {
      name?: string;
      version?: string;
      description?: string;
      instructions?: string;
      handlerCode?: string;
      parameters?: Record<string, unknown> | string;
      requiredTools?: string[];
      triggerPatterns?: string[];
      tags?: string[];
      skillType?: string;
      enabled?: boolean;
      status?: 'candidate' | 'active' | 'deprecated' | 'disabled';
    },
    promotedBy: string = 'human-operator',
    changeSummary?: string
  ): Skill {
    const existing = this.getSkill(id);
    if (!existing) {
      throw new Error(`Skill '${id}' not found`);
    }
    if (existing.isBuiltIn) {
      throw new Error('Cannot edit built-in system skill');
    }

    const now = Date.now();

    // Archive current snapshot into skill_versions before modifying
    this.archiveSkillVersion(existing, promotedBy, changeSummary || 'Manual update');

    const name = params.name ?? existing.name;
    const version = params.version ?? this.bumpPatchVersion(existing.version);
    const description = params.description ?? existing.description ?? '';
    const instructions = params.instructions ?? existing.instructions ?? '';
    const requiredTools = params.requiredTools ?? existing.requiredTools;
    const patterns = params.triggerPatterns ?? params.tags ?? existing.triggerPatterns;
    const enabled = params.enabled !== undefined ? Boolean(params.enabled) : (params.status !== undefined ? params.status !== 'disabled' : existing.enabled !== false);
    const status = !enabled ? 'disabled' : (params.status ?? existing.status);
    const handlerCode = params.handlerCode !== undefined ? params.handlerCode : existing.handlerCode;
    const skillType = params.skillType ?? existing.skillType ?? 'prompt_instruction';
    const paramsJson = params.parameters !== undefined
      ? (typeof params.parameters === 'object' ? JSON.stringify(params.parameters) : String(params.parameters))
      : (typeof existing.parameters === 'object' ? JSON.stringify(existing.parameters) : (existing.parameters || '{}'));

    this.db.execute(
      `UPDATE skills SET name = ?, version = ?, description = ?, instructions = ?, required_tools_json = ?, trigger_patterns_json = ?, status = ?, parameters_json = ?, handler_code = ?, skill_type = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
      name,
      version,
      description,
      instructions,
      JSON.stringify(requiredTools),
      JSON.stringify(patterns),
      status,
      paramsJson,
      handlerCode || null,
      skillType,
      enabled ? 1 : 0,
      now,
      id
    );

    const updated = this.getSkill(id)!;
    this.saveSkillToDisk(updated);
    return updated;
  }

  /**
   * Deletes a custom (non-built-in) skill from SQLite and removes its disk file.
   */
  public deleteSkill(id: string): boolean {
    const row = this.db.queryOne<{ id: string; name: string; is_built_in: number }>('SELECT id, name, is_built_in FROM skills WHERE id = ?', id);
    if (!row) return false;
    if (row.is_built_in) {
      throw new Error('Cannot delete built-in system skill');
    }

    this.db.execute('DELETE FROM skills WHERE id = ?', id);

    // Remove from disk if exists safely without path traversal or directory root wiping
    try {
      const folderName = row.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
      if (folderName && folderName !== '.' && folderName !== '..') {
        const skillPath = path.resolve(this.skillsDir, folderName);
        const resolvedSkillsDir = path.resolve(this.skillsDir);
        // Ensure skillPath is strictly a child of skillsDir and not skillsDir itself
        if (skillPath !== resolvedSkillsDir && skillPath.startsWith(resolvedSkillsDir)) {
          if (fs.existsSync(skillPath)) {
            fs.rmSync(skillPath, { recursive: true, force: true });
          }
          const directMd = path.resolve(this.skillsDir, `${folderName}.md`);
          if (fs.existsSync(directMd)) {
            fs.unlinkSync(directMd);
          }
        }
      }
    } catch (err) {
      console.warn(`[SkillEngine] Failed to delete skill disk folder:`, err);
    }

    return true;
  }

  /**
   * Dynamically matches relevant ACTIVE skills for a user prompt or agent role.
   * Multi-factor scoring + strict active-only filtering + token/count budgeting.
   * STRICT BOUNDARY: Candidate lessons are NEVER injected into runtime prompts.
   */
  public matchSkills(
    prompt: string,
    role?: string,
    options?: { maxSkills?: number; maxTokens?: number; availableTools?: string[] }
  ): Skill[] {
    const maxSkills = options?.maxSkills ?? 3;
    const maxChars = (options?.maxTokens ?? 1500) * 4;

    const activeSkills = this.listSkills('active');
    const textLower = `${prompt} ${role || ''}`.toLowerCase();

    interface ScoredSkill {
      skill: Skill;
      score: number;
    }

    const scored: ScoredSkill[] = [];

    for (const s of activeSkills) {
      let score = 0;

      // 1. Keyword match on trigger patterns
      for (const pattern of s.triggerPatterns) {
        const pLower = pattern.toLowerCase();
        if (textLower === pLower) {
          score += 5;
        } else if (textLower.includes(pLower)) {
          score += 2;
        }
      }

      // 2. Name or description match
      if (textLower.includes(s.name.toLowerCase())) {
        score += 3;
      }
      if (s.description && textLower.includes(s.description.toLowerCase().slice(0, 30))) {
        score += 1;
      }

      if (score === 0) continue;

      // 3. Tool compatibility check: if skill requires tools not present, penalize
      if (options?.availableTools && s.requiredTools.length > 0) {
        const missing = s.requiredTools.filter((t) => !options.availableTools!.includes(t));
        if (missing.length > 0) {
          score -= 2;
        }
      }

      // 4. Empirical win rate boost
      const totalRuns = (s.successCount || 0) + (s.failureCount || 0);
      if (totalRuns > 0) {
        const winRate = (s.successCount || 0) / totalRuns;
        score += Math.round(winRate * 2);
      }

      if (score > 0) {
        scored.push({ skill: s, score });
      }
    }

    // Sort by highest score first
    scored.sort((a, b) => b.score - a.score);

    // Apply budget limits
    const selected: Skill[] = [];
    let currentChars = 0;

    for (const item of scored) {
      if (selected.length >= maxSkills) break;
      const len = item.skill.instructions.length;
      if (currentChars + len > maxChars && selected.length > 0) {
        continue;
      }
      selected.push(item.skill);
      currentChars += len;
    }

    return selected;
  }

  /**
   * Records a durable execution experience record and updates empirical metrics.
   */
  public recordExperience(params: {
    skillId?: string;
    runId: string;
    toolName?: string;
    objective: string;
    outcome: 'success' | 'failure';
    failureReason?: string;
    repairStrategy?: string;
    lessonsLearned?: string;
    metadata?: Record<string, unknown>;
  }): SkillExperience {
    const id = `exp-${uuidv4()}`;
    const now = Date.now();

    // Strictly enforce execution provenance - never fabricate synthetic agent runs
    const existingRun = this.db.queryOne<{ id: string }>('SELECT id FROM agent_runs WHERE id = ?', params.runId);
    if (!existingRun) {
      throw new Error(`Invalid runId '${params.runId}': Execution run does not exist. Fabricating synthetic agent runs is strictly prohibited.`);
    }

    this.db.execute(
      `INSERT INTO skill_experiences (id, skill_id, run_id, tool_name, objective, outcome, failure_reason, repair_strategy, lessons_learned, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      params.skillId ?? null,
      params.runId,
      params.toolName ?? null,
      params.objective,
      params.outcome,
      params.failureReason ?? null,
      params.repairStrategy ?? null,
      params.lessonsLearned ?? null,
      JSON.stringify(params.metadata || {}),
      now
    );

    // Update skill win/loss metrics if associated
    if (params.skillId) {
      if (params.outcome === 'success') {
        this.db.execute(
          'UPDATE skills SET success_count = success_count + 1, updated_at = ? WHERE id = ?',
          now,
          params.skillId
        );
      } else {
        this.db.execute(
          'UPDATE skills SET failure_count = failure_count + 1, updated_at = ? WHERE id = ?',
          now,
          params.skillId
        );
      }
    }

    return {
      id,
      skillId: params.skillId,
      runId: params.runId,
      toolName: params.toolName,
      objective: params.objective,
      outcome: params.outcome,
      failureReason: params.failureReason,
      repairStrategy: params.repairStrategy,
      lessonsLearned: params.lessonsLearned,
      metadata: params.metadata,
      createdAt: now,
    };
  }

  /**
   * Lists historical skill recovery and execution experiences.
   */
  public listExperiences(filter?: {
    skillId?: string;
    runId?: string;
    toolName?: string;
    outcome?: 'success' | 'failure';
    limit?: number;
  }): SkillExperience[] {
    let sql = 'SELECT * FROM skill_experiences WHERE 1=1';
    const params: any[] = [];
    if (filter?.skillId) {
      sql += ' AND skill_id = ?';
      params.push(filter.skillId);
    }
    if (filter?.runId) {
      sql += ' AND run_id = ?';
      params.push(filter.runId);
    }
    if (filter?.toolName) {
      sql += ' AND tool_name = ?';
      params.push(filter.toolName);
    }
    if (filter?.outcome) {
      sql += ' AND outcome = ?';
      params.push(filter.outcome);
    }
    sql += ` ORDER BY created_at DESC LIMIT ${filter?.limit ?? 100}`;

    const rows = this.db.query<any>(sql, ...params);
    return rows.map((r) => {
      let meta = {};
      try {
        meta = JSON.parse(r.metadata_json || '{}');
      } catch {}
      return {
        id: r.id,
        skillId: r.skill_id ?? undefined,
        runId: r.run_id,
        toolName: r.tool_name ?? undefined,
        objective: r.objective,
        outcome: r.outcome,
        failureReason: r.failure_reason ?? undefined,
        repairStrategy: r.repair_strategy ?? undefined,
        lessonsLearned: r.lessons_learned ?? undefined,
        metadata: meta,
        createdAt: r.created_at,
      };
    });
  }

  /**
   * HARVEST CANDIDATE LESSONS (OpenDots Pattern)
   * Analyzes recent execution experiences to cluster recurring error patterns and
   * repair strategies, synthesizing structured candidate lessons awaiting human/validation review.
   */
  public harvestCandidateLessons(): { createdCount: number; candidates: Skill[] } {
    const recentFailures = this.db.query<any>(
      `SELECT * FROM skill_experiences WHERE outcome = 'failure' AND (failure_reason IS NOT NULL OR repair_strategy IS NOT NULL) ORDER BY created_at DESC LIMIT 100`
    );

    if (recentFailures.length === 0) {
      return { createdCount: 0, candidates: this.listCandidates() };
    }

    // Cluster experiences by tool or failure category
    const clusters: Record<string, any[]> = {};
    for (const exp of recentFailures) {
      let key = 'general';
      const reason = (exp.failure_reason || '').toLowerCase();
      if (exp.tool_name) {
        key = `tool-${exp.tool_name}`;
      } else if (reason.includes('selector') || reason.includes('element')) {
        key = 'dom-selector-drift';
      } else if (reason.includes('modal') || reason.includes('overlay')) {
        key = 'modal-dismissal';
      } else if (reason.includes('stagnation') || reason.includes('unchanged')) {
        key = 'state-stagnation';
      } else if (reason.includes('timeout') || reason.includes('hang')) {
        key = 'execution-timeout';
      } else if (reason.includes('syntax') || reason.includes('json')) {
        key = 'syntax-formatting';
      }

      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(exp);
    }

    let createdCount = 0;
    const now = Date.now();

    for (const [clusterKey, exps] of Object.entries(clusters)) {
      // Require at least 1 verified recovery strategy or 2 repeated errors
      const count = exps.length;
      const strategies = Array.from(new Set(exps.map((e) => e.repair_strategy).filter(Boolean)));
      const sampleReasons = Array.from(new Set(exps.map((e) => e.failure_reason).filter(Boolean))).slice(0, 3);

      const candidateName = `candidate-recovery-${clusterKey}`;
      const candidateId = `skill-${candidateName}`;

      const existing = this.getSkill(candidateId);
      if (existing) {
        // Update evidence count
        this.db.execute(
          'UPDATE skills SET evidence_count = evidence_count + ?, updated_at = ? WHERE id = ?',
          count,
          now,
          candidateId
        );
        continue;
      }

      const instructions = [
        `### EMPIRICAL LESSON: Recovery Guide for ${clusterKey.toUpperCase()}`,
        `Observed empirical failures (${count} instances recorded from real runs):`,
        ...sampleReasons.map((r) => `- "${r}"`),
        '',
        `Recommended Procedural Safeguards:`,
        strategies.length > 0
          ? `1. Primary Self-Healing Strategy: Apply '${strategies.join("', '")}'.`
          : `1. Check pre-conditions and observe state carefully before repeating identical calls.`,
        `2. When executing actions in this category, verify post-action mutations.`,
        `3. If state stagnation occurs, pivot to alternative selector, keyboard shortcut, or wait for network idle.`,
        `4. Do not repeat identical failing invocations in a consecutive loop.`,
      ].join('\n');

      const triggerWords = clusterKey.split('-');
      if (exps[0]?.tool_name) {
        triggerWords.push(exps[0].tool_name);
      }

      this.db.execute(
        `INSERT INTO skills (id, name, version, description, instructions, required_tools_json, trigger_patterns_json, is_built_in, status, evidence_count, success_count, failure_count, created_at, updated_at)
         VALUES (?, ?, '0.1.0', ?, ?, '[]', ?, 0, 'candidate', ?, 0, 0, ?, ?)`,
        candidateId,
        candidateName,
        `Empirical candidate lesson learned from ${count} run failure(s) in ${clusterKey}`,
        instructions,
        JSON.stringify(Array.from(new Set(triggerWords))),
        count,
        now,
        now
      );

      createdCount++;
    }

    return { createdCount, candidates: this.listCandidates() };
  }

  /**
   * VALIDATE & PROMOTE CANDIDATE LESSON (OpenDots Pipeline)
   * Human or verification gate: Promotes candidate to 'active', bumps version,
   * archives previous version into skill_versions, and marks validator reference.
   */
  public validateAndPromoteCandidate(
    candidateId: string,
    decision: {
      action: 'promote' | 'reject';
      reviewer: string;
      rationale?: string;
      updatedInstructions?: string;
    }
  ): { success: boolean; skill?: Skill; message: string } {
    const existing = this.getSkill(candidateId);
    if (!existing) {
      throw new Error(`Candidate skill '${candidateId}' not found.`);
    }

    const now = Date.now();

    if (decision.action === 'promote') {
      // Archive current version snapshot
      this.archiveSkillVersion(
        existing,
        decision.reviewer,
        decision.rationale || 'Promoted from candidate lesson through validation gate'
      );

      const newVersion = existing.version.startsWith('0.') ? '1.0.0' : this.bumpPatchVersion(existing.version);
      const instructions = decision.updatedInstructions || existing.instructions;

      this.db.execute(
        `UPDATE skills SET version = ?, instructions = ?, status = 'active', last_validated_at = ?, validator_ref = ?, updated_at = ? WHERE id = ?`,
        newVersion,
        instructions,
        now,
        decision.reviewer,
        now,
        existing.id
      );

      return {
        success: true,
        skill: this.getSkill(candidateId),
        message: `Candidate '${existing.name}' successfully validated and promoted to active v${newVersion}.`,
      };
    } else {
      // Mark candidate as deprecated or rejected
      this.db.execute(
        `UPDATE skills SET status = 'deprecated', validator_ref = ?, updated_at = ? WHERE id = ?`,
        decision.reviewer,
        now,
        existing.id
      );

      return {
        success: true,
        message: `Candidate '${existing.name}' rejected by validator (${decision.reviewer}) and deprecated.`,
      };
    }
  }

  /**
   * Retrieves version history for a skill.
   */
  public getSkillVersionHistory(skillId: string): SkillVersion[] {
    const rows = this.db.query<any>(
      `SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at DESC`,
      skillId
    );

    return rows.map((r) => ({
      id: r.id,
      skillId: r.skill_id,
      version: r.version,
      description: r.description,
      instructions: r.instructions,
      triggerPatterns: JSON.parse(r.trigger_patterns_json || '[]'),
      promotedBy: r.promoted_by,
      changeSummary: r.change_summary ?? undefined,
      createdAt: r.created_at,
    }));
  }

  /**
   * Rolls back a skill to a previously archived version snapshot.
   */
  public rollbackSkill(skillId: string, versionId: string): Skill {
    const targetVersion = this.db.queryOne<any>(
      `SELECT * FROM skill_versions WHERE id = ? AND skill_id = ?`,
      versionId,
      skillId
    );
    if (!targetVersion) {
      throw new Error(`Version snapshot '${versionId}' not found for skill '${skillId}'.`);
    }

    const current = this.getSkill(skillId);
    if (!current) {
      throw new Error(`Skill '${skillId}' not found.`);
    }

    const now = Date.now();

    // Archive current state before rollback
    this.archiveSkillVersion(current, 'system-rollback', `Rollback to version ${targetVersion.version}`);

    // Restore target snapshot with full manifest
    let manifest: any = {};
    if (targetVersion.change_summary) {
      try {
        manifest = JSON.parse(targetVersion.change_summary);
      } catch {}
    }

    const handlerCode = manifest.handlerCode ?? null;
    const skillType = manifest.skillType || (handlerCode ? 'tool_extension' : 'prompt_instruction');
    const enabled = manifest.enabled !== undefined ? (manifest.enabled ? 1 : 0) : 1;
    const requiredToolsJson = manifest.requiredTools ? JSON.stringify(manifest.requiredTools) : '[]';
    const paramsJson = manifest.parameters ? (typeof manifest.parameters === 'object' ? JSON.stringify(manifest.parameters) : String(manifest.parameters)) : '{}';

    this.db.execute(
      `UPDATE skills SET version = ?, description = ?, instructions = ?, trigger_patterns_json = ?, required_tools_json = ?, parameters_json = ?, handler_code = ?, skill_type = ?, enabled = ?, status = 'active', updated_at = ? WHERE id = ?`,
      targetVersion.version,
      targetVersion.description,
      targetVersion.instructions,
      targetVersion.trigger_patterns_json,
      requiredToolsJson,
      paramsJson,
      handlerCode,
      skillType,
      enabled,
      now,
      skillId
    );

    return this.getSkill(skillId)!;
  }

  /**
   * Computes empirical learning, tool reliability, and recovery strategy metrics.
   */
  public getLearningMetrics(): LearningMetrics {
    const experiences = this.db.query<any>('SELECT * FROM skill_experiences ORDER BY created_at DESC LIMIT 500');
    const allSkills = this.db.query<any>('SELECT status, count(*) as count FROM skills GROUP BY status');

    const statusMap: Record<string, number> = {};
    for (const s of allSkills) {
      statusMap[s.status] = s.count;
    }

    // Tool reliability metrics
    const toolStats: Record<string, { invocations: number; successes: number; failures: number }> = {};
    for (const exp of experiences) {
      const tool = exp.tool_name || 'other';
      if (!toolStats[tool]) {
        toolStats[tool] = { invocations: 0, successes: 0, failures: 0 };
      }
      toolStats[tool].invocations++;
      if (exp.outcome === 'success') {
        toolStats[tool].successes++;
      } else {
        toolStats[tool].failures++;
      }
    }

    const toolReliability: ToolReliabilityMetric[] = Object.entries(toolStats).map(([toolName, stats]) => ({
      toolName,
      invocations: stats.invocations,
      successes: stats.successes,
      failures: stats.failures,
      successRate: stats.invocations > 0 ? Math.round((stats.successes / stats.invocations) * 100) : 0,
    }));

    // Recovery strategy effectiveness
    const strategyStats: Record<string, { suggested: number; succeeded: number }> = {};
    for (const exp of experiences) {
      if (exp.repair_strategy) {
        const strat = exp.repair_strategy;
        if (!strategyStats[strat]) {
          strategyStats[strat] = { suggested: 0, succeeded: 0 };
        }
        strategyStats[strat].suggested++;
        if (exp.outcome === 'success') {
          strategyStats[strat].succeeded++;
        }
      }
    }

    const recoveryStrategies: RecoveryStrategyMetric[] = Object.entries(strategyStats).map(([strategy, stats]) => ({
      strategy,
      suggestedCount: stats.suggested,
      successfulCount: stats.succeeded,
      successRate: stats.suggested > 0 ? Math.round((stats.succeeded / stats.suggested) * 100) : 0,
    }));

    return {
      totalExperiences: experiences.length,
      totalSkills: (statusMap.active || 0) + (statusMap.candidate || 0) + (statusMap.deprecated || 0),
      activeSkillsCount: statusMap.active || 0,
      candidateSkillsCount: statusMap.candidate || 0,
      deprecatedSkillsCount: statusMap.deprecated || 0,
      toolReliability,
      recoveryStrategies,
    };
  }

  /**
   * Exports a skill as a portable JSON package.
   */
  public exportSkill(id: string): string {
    const skill = this.getSkill(id);
    if (!skill) throw new Error(`Skill '${id}' not found`);
    return JSON.stringify(
      {
        $schema: 'https://kin.dev/schemas/skill-v1.json',
        skill,
      },
      null,
      2
    );
  }

  /**
   * Exports all active skills as a unified bundle.
   */
  public exportAllSkills(): string {
    const skills = this.listSkills('active');
    return JSON.stringify(
      {
        $schema: 'https://kin.dev/schemas/skill-bundle-v1.json',
        exportedAt: Date.now(),
        skillsCount: skills.length,
        skills,
      },
      null,
      2
    );
  }

  /**
   * Imports a portable skill package into SQLite.
   */
  public importSkill(rawJson: string | object): Skill {
    let parsed: any;
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
      } catch (err: any) {
        throw new Error(`Invalid JSON format: ${err.message}`);
      }
    } else {
      parsed = rawJson;
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid skill package: expected JSON object');
    }

    const data = parsed.skill || (Array.isArray(parsed.skills) ? parsed.skills[0] : parsed);

    if (!data || !data.name || (!data.instructions && !data.handlerCode && !data.description)) {
      throw new Error('Invalid skill package: missing name or instructions');
    }

    const rawName = String(data.name).trim();
    const sanitizedSlug = rawName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'custom-skill';
    const id = data.id ? String(data.id).trim() : `skill-${sanitizedSlug}`;
    const now = Date.now();
    const existing = this.getSkill(id);

    const patterns = Array.isArray(data.triggerPatterns) && data.triggerPatterns.length > 0
      ? data.triggerPatterns
      : (Array.isArray(data.trigger_patterns) ? data.trigger_patterns : (data.tags || []));

    const requiredTools = Array.isArray(data.requiredTools)
      ? data.requiredTools
      : (Array.isArray(data.required_tools) ? data.required_tools : []);

    const enabled = data.enabled !== undefined ? Boolean(data.enabled) : (data.status !== 'disabled');
    const status = !enabled ? 'disabled' : (data.status || 'active');
    const instructions = data.instructions || data.handlerCode || data.description || '';
    const skillType = data.skillType || data.skill_type || (data.handlerCode ? 'tool_extension' : 'prompt_instruction');
    const paramsJson = typeof data.parameters === 'object' && data.parameters !== null
      ? JSON.stringify(data.parameters)
      : typeof data.parameters === 'string'
      ? data.parameters
      : '{}';

    if (existing) {
      this.archiveSkillVersion(existing, 'bundle-import', 'Imported updated skill definition');
      this.db.execute(
        `UPDATE skills SET version = ?, description = ?, instructions = ?, required_tools_json = ?, trigger_patterns_json = ?, status = ?, parameters_json = ?, handler_code = ?, skill_type = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
        data.version || this.bumpPatchVersion(existing.version),
        data.description || '',
        instructions,
        JSON.stringify(requiredTools),
        JSON.stringify(patterns),
        status,
        paramsJson,
        data.handlerCode || null,
        skillType,
        enabled ? 1 : 0,
        now,
        id
      );
    } else {
      this.db.execute(
        `INSERT INTO skills (id, name, version, description, instructions, required_tools_json, trigger_patterns_json, is_built_in, status, evidence_count, success_count, failure_count, parameters_json, handler_code, skill_type, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1, 0, 0, ?, ?, ?, ?, ?, ?)`,
        id,
        rawName,
        data.version || '1.0.0',
        data.description || '',
        instructions,
        JSON.stringify(requiredTools),
        JSON.stringify(patterns),
        status,
        paramsJson,
        data.handlerCode || null,
        skillType,
        enabled ? 1 : 0,
        now,
        now
      );
    }

    const imported = this.getSkill(id)!;
    this.saveSkillToDisk(imported);
    return imported;
  }

  /**
   * Imports a bundle containing multiple skills.
   */
  public importSkillBundle(rawJson: string | object): { imported: number; skills: Skill[] } {
    let parsed: any;
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
      } catch (err: any) {
        throw new Error(`Invalid JSON format: ${err.message}`);
      }
    } else {
      parsed = rawJson;
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid skill bundle: expected JSON object');
    }

    const items: any[] = Array.isArray(parsed.skills)
      ? parsed.skills
      : Array.isArray(parsed)
      ? parsed
      : parsed.skill && typeof parsed.skill === 'object'
      ? [parsed.skill]
      : (parsed.name && (parsed.instructions || parsed.handlerCode || parsed.skillType || parsed.skill_type || parsed.requiredTools || parsed.triggerPatterns))
      ? [parsed]
      : [];

    const imported: Skill[] = [];
    for (const item of items) {
      try {
        const s = this.importSkill(item);
        imported.push(s);
      } catch (err: any) {
        console.warn(`[SkillEngine] Failed to import skill item:`, err.message);
      }
    }

    return { imported: imported.length, skills: imported };
  }

  /**
   * Persists a skill definition to disk under .kin/skills/<folder>/SKILL.md and skill.json.
   */
  public saveSkillToDisk(skill: Skill): void {
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      }

      const folderName = skill.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().replace(/^-+|-+$/g, '') || skill.id || 'unnamed-skill';
      const skillFolder = path.join(this.skillsDir, folderName);
      if (!fs.existsSync(skillFolder)) {
        fs.mkdirSync(skillFolder, { recursive: true });
      }

      // 1. Write structured SKILL.md with YAML frontmatter
      const skillMdPath = path.join(skillFolder, 'SKILL.md');
      const paramStr = typeof skill.parameters === 'object'
        ? JSON.stringify(skill.parameters)
        : (skill.parameters || '{}');

      const mdContent = [
        '---',
        `name: ${skill.name}`,
        `version: ${skill.version || '1.0.0'}`,
        `description: >\n  ${(skill.description || '').replace(/\n/g, '\n  ')}`,
        `skill_type: ${skill.skillType || 'prompt_instruction'}`,
        `enabled: ${skill.enabled !== false}`,
        `required_tools: ${JSON.stringify(skill.requiredTools || [])}`,
        `trigger_patterns: ${JSON.stringify(skill.triggerPatterns || [])}`,
        `parameters: ${paramStr}`,
        '---',
        '',
        skill.instructions || '',
      ].join('\n');

      fs.writeFileSync(skillMdPath, mdContent, 'utf-8');

      // 2. Write implementation.ts if handlerCode is present
      if (skill.handlerCode) {
        const implPath = path.join(skillFolder, 'implementation.ts');
        fs.writeFileSync(implPath, skill.handlerCode, 'utf-8');
      }

      // 3. Write portable skill.json manifest
      const jsonManifestPath = path.join(skillFolder, 'skill.json');
      fs.writeFileSync(jsonManifestPath, JSON.stringify({ $schema: 'https://kin.dev/schemas/skill-v1.json', skill }, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[SkillEngine] Failed to save skill '${skill.name}' to disk:`, err);
    }
  }

  /**
   * Scans a directory (defaults to .kin/skills/) and loads/persists all skills into SQLite.
   */
  public loadSkillsFromDirectory(dirPath?: string): { loadedCount: number; skills: Skill[] } {
    const targetDir = dirPath ? path.resolve(dirPath) : this.skillsDir;
    const loaded: Skill[] = [];

    if (!fs.existsSync(targetDir)) {
      return { loadedCount: 0, skills: [] };
    }

    try {
      const stat = fs.statSync(targetDir);
      if (stat.isFile()) {
        if (targetDir.endsWith('.json')) {
          const raw = fs.readFileSync(targetDir, 'utf-8');
          const res = this.importSkillBundle(raw);
          return { loadedCount: res.imported, skills: res.skills };
        } else if (targetDir.endsWith('.md')) {
          const rawMd = fs.readFileSync(targetDir, 'utf-8');
          const { frontmatter, body } = parseFrontmatterAndBody(rawMd);
          const skillName = frontmatter.name || path.basename(targetDir, path.extname(targetDir));
          const parentDir = path.dirname(targetDir);
          let handlerCode: string | undefined;
          const siblingImpl = path.join(parentDir, 'implementation.ts');
          if (fs.existsSync(siblingImpl)) {
            handlerCode = fs.readFileSync(siblingImpl, 'utf-8');
          }
          const requiredTools = Array.isArray(frontmatter.required_tools)
            ? frontmatter.required_tools
            : (Array.isArray(frontmatter.requiredTools) ? frontmatter.requiredTools : []);

          const triggerPatterns = Array.isArray(frontmatter.trigger_patterns)
            ? frontmatter.trigger_patterns
            : (Array.isArray(frontmatter.triggerPatterns)
            ? frontmatter.triggerPatterns
            : (Array.isArray(frontmatter.tags) ? frontmatter.tags : []));

          const skill = this.importSkill({
            name: skillName,
            version: frontmatter.version ? String(frontmatter.version) : '1.0.0',
            description: frontmatter.description || '',
            instructions: body || frontmatter.instructions || frontmatter.description || '',
            handlerCode,
            parameters: frontmatter.parameters,
            skillType: frontmatter.skill_type || frontmatter.skillType || (handlerCode ? 'tool_extension' : 'prompt_instruction'),
            enabled: frontmatter.enabled !== false,
            requiredTools,
            triggerPatterns,
          });
          return { loadedCount: 1, skills: [skill] };
        }
        return { loadedCount: 0, skills: [] };
      }

      // If targetDir itself is a single skill directory containing SKILL.md / skill.md
      const directSkillMd = fs.existsSync(path.join(targetDir, 'SKILL.md'))
        ? path.join(targetDir, 'SKILL.md')
        : (fs.existsSync(path.join(targetDir, 'skill.md')) ? path.join(targetDir, 'skill.md') : undefined);
      const directSkillJson = fs.existsSync(path.join(targetDir, 'skill.json'))
        ? path.join(targetDir, 'skill.json')
        : undefined;

      if (directSkillMd) {
        try {
          const rawMd = fs.readFileSync(directSkillMd, 'utf-8');
          const { frontmatter, body } = parseFrontmatterAndBody(rawMd);
          const skillName = frontmatter.name || path.basename(targetDir);
          let handlerCode: string | undefined;
          const siblingImpl = path.join(targetDir, 'implementation.ts');
          if (fs.existsSync(siblingImpl)) {
            handlerCode = fs.readFileSync(siblingImpl, 'utf-8');
          }
          const requiredTools = Array.isArray(frontmatter.required_tools)
            ? frontmatter.required_tools
            : (Array.isArray(frontmatter.requiredTools) ? frontmatter.requiredTools : []);

          const triggerPatterns = Array.isArray(frontmatter.trigger_patterns)
            ? frontmatter.trigger_patterns
            : (Array.isArray(frontmatter.triggerPatterns)
            ? frontmatter.triggerPatterns
            : (Array.isArray(frontmatter.tags) ? frontmatter.tags : []));

          const skill = this.importSkill({
            name: skillName,
            version: frontmatter.version ? String(frontmatter.version) : '1.0.0',
            description: frontmatter.description || '',
            instructions: body || frontmatter.instructions || frontmatter.description || '',
            handlerCode,
            parameters: frontmatter.parameters,
            skillType: frontmatter.skill_type || frontmatter.skillType || (handlerCode ? 'tool_extension' : 'prompt_instruction'),
            enabled: frontmatter.enabled !== false,
            requiredTools,
            triggerPatterns,
          });
          return { loadedCount: 1, skills: [skill] };
        } catch (err: any) {
          console.warn(`[SkillEngine] Failed to parse ${directSkillMd}:`, err.message);
        }
      } else if (directSkillJson) {
        try {
          const raw = fs.readFileSync(directSkillJson, 'utf-8');
          const skill = this.importSkill(raw);
          return { loadedCount: 1, skills: [skill] };
        } catch (err: any) {
          console.warn(`[SkillEngine] Failed to parse ${directSkillJson}:`, err.message);
        }
      }

      const entries = fs.readdirSync(targetDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
          // Check for SKILL.md or skill.md
          const skillMd = fs.existsSync(path.join(fullPath, 'SKILL.md'))
            ? path.join(fullPath, 'SKILL.md')
            : path.join(fullPath, 'skill.md');
          const skillJson = path.join(fullPath, 'skill.json');
          const implTs = path.join(fullPath, 'implementation.ts');

          if (fs.existsSync(skillMd)) {
            try {
              const rawMd = fs.readFileSync(skillMd, 'utf-8');
              const { frontmatter, body } = parseFrontmatterAndBody(rawMd);
              let handlerCode: string | undefined;
              if (fs.existsSync(implTs)) {
                handlerCode = fs.readFileSync(implTs, 'utf-8');
              }

              const requiredTools = Array.isArray(frontmatter.required_tools)
                ? frontmatter.required_tools
                : (Array.isArray(frontmatter.requiredTools) ? frontmatter.requiredTools : []);

              const triggerPatterns = Array.isArray(frontmatter.trigger_patterns)
                ? frontmatter.trigger_patterns
                : (Array.isArray(frontmatter.triggerPatterns)
                ? frontmatter.triggerPatterns
                : (Array.isArray(frontmatter.tags) ? frontmatter.tags : []));

              const skill = this.importSkill({
                name: frontmatter.name || entry.name,
                version: frontmatter.version ? String(frontmatter.version) : '1.0.0',
                description: frontmatter.description || '',
                instructions: body || frontmatter.instructions || frontmatter.description || '',
                handlerCode,
                parameters: frontmatter.parameters,
                skillType: frontmatter.skill_type || frontmatter.skillType || (handlerCode ? 'tool_extension' : 'prompt_instruction'),
                enabled: frontmatter.enabled !== false,
                requiredTools,
                triggerPatterns,
              });
              loaded.push(skill);
            } catch (err: any) {
              console.warn(`[SkillEngine] Failed to parse ${skillMd}:`, err.message);
            }
          } else if (fs.existsSync(skillJson)) {
            try {
              const raw = fs.readFileSync(skillJson, 'utf-8');
              const skill = this.importSkill(raw);
              loaded.push(skill);
            } catch (err: any) {
              console.warn(`[SkillEngine] Failed to parse ${skillJson}:`, err.message);
            }
          }
        } else if (entry.isFile()) {
          if (entry.name.endsWith('.json')) {
            if (entry.name === 'routine.json' || entry.name === 'package.json' || entry.name === 'tsconfig.json') {
              continue;
            }
            try {
              const raw = fs.readFileSync(fullPath, 'utf-8');
              const res = this.importSkillBundle(raw);
              loaded.push(...res.skills);
            } catch {}
          } else if (entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md') {
            try {
              const rawMd = fs.readFileSync(fullPath, 'utf-8');
              const { frontmatter, body } = parseFrontmatterAndBody(rawMd);
              const skillName = frontmatter.name || entry.name.replace(/\.md$/i, '');
              let handlerCode: string | undefined;
              const siblingImpl = path.join(targetDir, 'implementation.ts');
              if (fs.existsSync(siblingImpl)) {
                handlerCode = fs.readFileSync(siblingImpl, 'utf-8');
              }
              const requiredTools = Array.isArray(frontmatter.required_tools)
                ? frontmatter.required_tools
                : (Array.isArray(frontmatter.requiredTools) ? frontmatter.requiredTools : []);

              const triggerPatterns = Array.isArray(frontmatter.trigger_patterns)
                ? frontmatter.trigger_patterns
                : (Array.isArray(frontmatter.triggerPatterns)
                ? frontmatter.triggerPatterns
                : (Array.isArray(frontmatter.tags) ? frontmatter.tags : []));

              const skill = this.importSkill({
                name: skillName,
                version: frontmatter.version ? String(frontmatter.version) : '1.0.0',
                description: frontmatter.description || '',
                instructions: body || frontmatter.instructions || frontmatter.description || '',
                handlerCode,
                parameters: frontmatter.parameters,
                skillType: frontmatter.skill_type || frontmatter.skillType || (handlerCode ? 'tool_extension' : 'prompt_instruction'),
                enabled: frontmatter.enabled !== false,
                requiredTools,
                triggerPatterns,
              });
              loaded.push(skill);
            } catch (err: any) {
              console.warn(`[SkillEngine] Failed to import standalone markdown skill ${fullPath}:`, err.message);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[SkillEngine] Failed to scan directory '${targetDir}':`, err.message);
    }

    return { loadedCount: loaded.length, skills: loaded };
  }

  /**
   * Imports an external skill bundle or directory of skills into persistent storage.
   */
  public importSkillDirectory(dirPath: string): { imported: number; skills: Skill[] } {
    const result = this.loadSkillsFromDirectory(dirPath);
    // Ensure all loaded skills are saved to .kin/skills/
    for (const skill of result.skills) {
      this.saveSkillToDisk(skill);
    }
    return { imported: result.loadedCount, skills: result.skills };
  }

  private archiveSkillVersion(skill: Skill, promotedBy: string, changeSummary?: string): void {
    const versionId = `sver-${uuidv4()}`;
    const manifest = {
      changeSummary: changeSummary ?? null,
      parameters: skill.parameters,
      handlerCode: skill.handlerCode,
      requiredTools: skill.requiredTools,
      skillType: skill.skillType,
      enabled: skill.enabled,
    };
    this.db.execute(
      `INSERT INTO skill_versions (id, skill_id, version, description, instructions, trigger_patterns_json, promoted_by, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      versionId,
      skill.id,
      skill.version,
      skill.description,
      skill.instructions,
      JSON.stringify(skill.triggerPatterns),
      promotedBy,
      JSON.stringify(manifest),
      Date.now()
    );
  }

  private bumpPatchVersion(current: string): string {
    const parts = current.split('.');
    if (parts.length === 3 && !isNaN(Number(parts[2]))) {
      return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
    }
    return `${current}.1`;
  }

  private mapRowToSkill(row: any): Skill {
    const triggerPatterns = JSON.parse(row.trigger_patterns_json || '[]');
    let parameters: any = undefined;
    if (row.parameters_json) {
      try {
        parameters = JSON.parse(row.parameters_json);
      } catch {
        parameters = row.parameters_json;
      }
    }
    const enabled = row.enabled !== undefined && row.enabled !== null
      ? Boolean(row.enabled)
      : row.status !== 'disabled';

    return {
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description,
      instructions: row.instructions,
      requiredTools: JSON.parse(row.required_tools_json || '[]'),
      triggerPatterns,
      tags: triggerPatterns,
      isBuiltIn: Boolean(row.is_built_in),
      status: row.status,
      parameters,
      handlerCode: row.handler_code ?? undefined,
      skillType: row.skill_type || 'prompt_instruction',
      enabled,
      evidenceCount: row.evidence_count ?? 0,
      successCount: row.success_count ?? 0,
      failureCount: row.failure_count ?? 0,
      lastValidatedAt: row.last_validated_at ?? undefined,
      validatorRef: row.validator_ref ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Robust zero-dependency YAML frontmatter parser for SKILL.md markdown files.
 * Supports:
 * - Top-level scalar key-values (strings, numbers, booleans)
 * - Quoted and unquoted strings
 * - Folded (>) and literal (|) multiline strings
 * - Standard bulleted YAML lists (- item)
 * - JSON-encoded arrays and objects ([...], {...})
 * - Files without trailing newlines after closing ---
 * - Resilient fallback if closing --- delimiter is omitted
 */
export function parseFrontmatterAndBody(markdown: string): { frontmatter: Record<string, any>; body: string } {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }

  let rawYaml = '';
  let body = '';

  const closedMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (closedMatch) {
    rawYaml = closedMatch[1];
    body = (closedMatch[2] || '').trim();
  } else {
    // If no clean closing delimiter, check if there's any \n--- in the text
    const secondDelim = trimmed.indexOf('\n---', 3);
    if (secondDelim !== -1) {
      rawYaml = trimmed.slice(3, secondDelim).trim();
      const rest = trimmed.slice(secondDelim + 4);
      body = rest.replace(/^\r?\n/, '').trim();
    } else {
      // Unclosed delimiter: treat lines after initial --- as frontmatter
      rawYaml = trimmed.slice(3).trim();
      body = '';
    }
  }

  const frontmatter: Record<string, any> = {};
  const lines = rawYaml.split(/\r?\n/);

  let currentKey: string | null = null;
  let multilineMode: 'folded' | 'literal' | 'none' = 'none';
  let multilineVal = '';
  let activeListKey: string | null = null;

  const commitMultiline = () => {
    if (currentKey && multilineVal !== '') {
      frontmatter[currentKey] = multilineVal.trim();
      multilineVal = '';
    }
    multilineMode = 'none';
  };

  for (const rawLine of lines) {
    // Strip trailing comments (e.g. key: val # comment)
    const lineWithoutComment = rawLine.replace(/(\s+#.*)$/, '');
    const trimmedLine = lineWithoutComment.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    // Check for bullet list item: ^\s*-\s+(.*)$
    const listMatch = lineWithoutComment.match(/^\s*-\s+(.*)$/);
    if (listMatch) {
      const itemVal = listMatch[1].trim().replace(/^["']|["']$/g, '');
      const targetKey = activeListKey || currentKey;
      if (targetKey) {
        if (!Array.isArray(frontmatter[targetKey])) {
          frontmatter[targetKey] = [];
        }
        frontmatter[targetKey].push(itemVal);
      }
      continue;
    }

    // Check for top-level key: ^([a-zA-Z0-9_-]+):\s*(.*)$
    const keyMatch = lineWithoutComment.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      commitMultiline();
      activeListKey = null;

      currentKey = keyMatch[1];
      const val = keyMatch[2].trim();

      if (val === '>' || val === '>-') {
        multilineMode = 'folded';
        multilineVal = '';
      } else if (val === '|' || val === '|-') {
        multilineMode = 'literal';
        multilineVal = '';
      } else if (val === '') {
        // Value might be on subsequent lines (bullet list or indented block)
        activeListKey = currentKey;
      } else if (val.startsWith('[') || val.startsWith('{')) {
        try {
          frontmatter[currentKey] = JSON.parse(val);
        } catch {
          frontmatter[currentKey] = val;
        }
        currentKey = null;
      } else if (val.toLowerCase() === 'true') {
        frontmatter[currentKey] = true;
        currentKey = null;
      } else if (val.toLowerCase() === 'false') {
        frontmatter[currentKey] = false;
        currentKey = null;
      } else if (!isNaN(Number(val)) && val !== '') {
        frontmatter[currentKey] = Number(val);
        currentKey = null;
      } else {
        frontmatter[currentKey] = val.replace(/^["']|["']$/g, '');
        currentKey = null;
      }
    } else if (currentKey && multilineMode !== 'none') {
      const sep = multilineMode === 'folded' ? ' ' : '\n';
      multilineVal += (multilineVal ? sep : '') + trimmedLine;
    } else if (currentKey && activeListKey === currentKey) {
      multilineVal += (multilineVal ? ' ' : '') + trimmedLine;
    }
  }

  commitMultiline();

  return { frontmatter, body };
}
