// ============================================================================
// KIN RUNTIME TOOL ENGINE & HARNESS² RECURSIVE SCAFFOLDING
// Dedicated Custom Dynamic Tool Lifecycle, Worker Sandboxing,
// Lexical-Parameter Similarity Interception, Pre-Approval Gating,
// and Cross-Task Improvement Library (Google Research Harness²).
// ============================================================================

import * as vm from 'node:vm';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { v4 as uuidv4 } from 'uuid';
import { KinDatabase } from '../storage/db.js';

export interface CustomTool {
  id: string;
  projectId?: string;
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  handlerCode: string;
  status: 'candidate' | 'active' | 'denied' | 'archived';
  approvalId?: string;
  createdByAgentId?: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateToolInput {
  id?: string;
  name: string;
  description: string;
  parametersSchema?: Record<string, unknown> | string;
  handlerCode: string;
  projectId?: string;
  agentId?: string;
  runId?: string;
  forceCreation?: boolean;
  rationale?: string;
  requireApproval?: boolean;
}

export interface CreateToolResult {
  success: boolean;
  status: 'created_pending_approval' | 'created_active' | 'duplicate_advisory' | 'error';
  tool?: CustomTool;
  existingSimilarTool?: string;
  similarityScore?: number;
  message?: string;
  approvalId?: string;
  error?: string;
}

export interface ExecuteCustomToolResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTimeMs?: number;
}

export interface ExecuteCustomToolContext {
  agentId?: string;
  runId?: string;
  channelId?: string;
  projectId?: string;
  worktreeRoot?: string;
  isProbe?: boolean;
  timeoutMs?: number;
}

export interface HarnessImprovement {
  id: string;
  projectId?: string;
  domain: string;
  componentType: 'tool' | 'prompt_guidance' | 'subagent_role' | 'skill_recipe';
  problemSignature: string;
  verifiedAdaptation: string;
  evidenceMetrics: Record<string, unknown>;
  successRuns: number;
  createdAt: number;
  updatedAt: number;
}

export class ToolEngine {
  private db: KinDatabase;
  private defaultTimeoutMs: number = 15000; // 15 seconds strict timeout
  private maxMemoryMb: number = 128; // 128MB heap memory limit

  constructor(db: KinDatabase, options?: { defaultTimeoutMs?: number; maxMemoryMb?: number }) {
    this.db = db;
    if (options?.defaultTimeoutMs) this.defaultTimeoutMs = options.defaultTimeoutMs;
    if (options?.maxMemoryMb) this.maxMemoryMb = options.maxMemoryMb;
  }

  // ============================================================================
  // 1. DUPLICATE & SIMILARITY DETECTION (Hybrid Lexical + Parameters)
  // ============================================================================

  public detectSimilarTool(
    name: string,
    description: string,
    parametersSchema?: Record<string, unknown> | string,
    projectId?: string,
    builtInToolSchemas: Array<{ name: string; description: string; parameters?: any }> = []
  ): { isSimilar: boolean; existingToolName?: string; description?: string; similarityScore: number } {
    const normalizeTokens = (str: string): Set<string> => {
      const words = str
        .toLowerCase()
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'tool', 'function'].includes(w));
      return new Set(words);
    };

    const extractParamKeys = (schema: any): Set<string> => {
      if (!schema) return new Set();
      let parsed = schema;
      if (typeof schema === 'string') {
        try {
          parsed = JSON.parse(schema);
        } catch {
          return new Set();
        }
      }
      const props = parsed?.properties || parsed;
      if (typeof props === 'object' && props !== null) {
        return new Set(Object.keys(props).map((k) => k.toLowerCase()));
      }
      return new Set();
    };

    const inputNameTokens = normalizeTokens(name);
    const inputDescTokens = normalizeTokens(description);
    const inputParamKeys = extractParamKeys(parametersSchema);

    // Collect all candidate tools to compare against: built-in + active custom tools in project
    const candidates: Array<{ name: string; description: string; paramKeys: Set<string> }> = [];

    for (const b of builtInToolSchemas) {
      candidates.push({
        name: b.name,
        description: b.description || '',
        paramKeys: extractParamKeys(b.parameters),
      });
    }

    const activeCustom = this.listTools(projectId, 'active');
    for (const c of activeCustom) {
      if (c.name.toLowerCase() === name.toLowerCase()) continue;
      candidates.push({
        name: c.name,
        description: c.description || '',
        paramKeys: extractParamKeys(c.parametersSchema),
      });
    }

    let highestScore = 0;
    let closestCandidate: { name: string; description: string } | null = null;

    for (const cand of candidates) {
      const candNameTokens = normalizeTokens(cand.name);
      const candDescTokens = normalizeTokens(cand.description);

      // Jaccard similarity helper
      const jaccard = (a: Set<string>, b: Set<string>): number => {
        if (a.size === 0 && b.size === 0) return 1.0;
        if (a.size === 0 || b.size === 0) return 0.0;
        let intersection = 0;
        for (const item of a) {
          if (b.has(item)) intersection++;
        }
        const union = a.size + b.size - intersection;
        return union === 0 ? 0 : intersection / union;
      };

      const nameSim = jaccard(inputNameTokens, candNameTokens);
      const descSim = jaccard(inputDescTokens, candDescTokens);
      const paramSim = jaccard(inputParamKeys, cand.paramKeys);

      // Weighted score: 45% name, 35% description, 20% parameters
      const totalScore = nameSim * 0.45 + descSim * 0.35 + paramSim * 0.2;

      // Exact name match or subset match boost
      if (cand.name.toLowerCase() === name.toLowerCase()) {
        return {
          isSimilar: true,
          existingToolName: cand.name,
          description: cand.description,
          similarityScore: 1.0,
        };
      }

      if (totalScore > highestScore) {
        highestScore = totalScore;
        closestCandidate = cand;
      }
    }

    // Threshold for duplicate warning: 75% similarity
    if (highestScore >= 0.75 && closestCandidate) {
      return {
        isSimilar: true,
        existingToolName: closestCandidate.name,
        description: closestCandidate.description,
        similarityScore: Math.round(highestScore * 100) / 100,
      };
    }

    return { isSimilar: false, similarityScore: Math.round(highestScore * 100) / 100 };
  }

  // ============================================================================
  // 2. TOOL REGISTRATION & PRE-APPROVAL GATE
  // ============================================================================

  public createTool(
    input: CreateToolInput,
    builtInToolSchemas: Array<{ name: string; description: string; parameters?: any }> = []
  ): CreateToolResult {
    const rawName = (input.name || '').trim();
    if (!rawName) {
      return { success: false, status: 'error', error: "Tool 'name' is required." };
    }
    const cleanName = rawName.replace(/^skill[-_]{1,2}/, '').trim();

    // Check duplicate or similar tool unless forceCreation is specified
    if (!input.forceCreation) {
      const simCheck = this.detectSimilarTool(
        cleanName,
        input.description || '',
        input.parametersSchema,
        input.projectId,
        builtInToolSchemas
      );
      if (simCheck.isSimilar && simCheck.existingToolName) {
        return {
          success: false,
          status: 'duplicate_advisory',
          existingSimilarTool: simCheck.existingToolName,
          similarityScore: simCheck.similarityScore,
          message: `A very similar tool '${simCheck.existingToolName}' already exists (${Math.round(
            simCheck.similarityScore * 100
          )}% similarity): "${simCheck.description}". If this fulfills your objective, invoke '${
            simCheck.existingToolName
          }' directly. If you genuinely require a new tool with different behavior, re-invoke create_tool with forceCreation: true and specify your rationale.`,
        };
      }
    }

    // Validate parameters schema
    let parsedSchema: Record<string, unknown> = {};
    if (typeof input.parametersSchema === 'string') {
      try {
        parsedSchema = JSON.parse(input.parametersSchema);
      } catch {
        parsedSchema = { type: 'object', properties: {} };
      }
    } else if (input.parametersSchema && typeof input.parametersSchema === 'object') {
      parsedSchema = input.parametersSchema;
    } else {
      parsedSchema = { type: 'object', properties: {} };
    }

    const toolId = `tool-${uuidv4()}`;
    const now = Date.now();
    const requireApproval = input.requireApproval !== false; // Default: operator pre-approval required

    let approvalId: string | undefined;

    if (requireApproval) {
      approvalId = `appr-${uuidv4()}`;
      try {
        const agentId = input.agentId || 'agent-orchestrator';
        const runId = input.runId || `run-tool-${uuidv4()}`;
        const agentExists = this.db.queryOne('SELECT id FROM agent_identities WHERE id = ?', agentId);
        const resolvedAgentId = agentExists ? agentId : (this.db.queryOne<{ id: string }>('SELECT id FROM agent_identities LIMIT 1')?.id || agentId);

        const existingRun = this.db.queryOne('SELECT id FROM agent_runs WHERE id = ?', runId);
        if (!existingRun) {
          try {
            this.db.execute(
              `INSERT OR IGNORE INTO agent_runs (id, agent_id, project_id, state, heartbeat_at, created_at) VALUES (?, ?, ?, 'waiting_for_approval', ?, ?);`,
              runId,
              resolvedAgentId,
              input.projectId || 'proj-kin',
              now,
              now
            );
          } catch {}
        }

        const actionPayload = {
          toolId,
          name: cleanName,
          description: input.description,
          parametersSchema: parsedSchema,
          handlerCode: input.handlerCode,
          rationale: input.rationale || 'Specialized task automation',
        };

        this.db.execute(
          `INSERT INTO approvals (
            id, run_id, agent_id, tool_name, action_payload_json, risk_level, status, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, 'MEDIUM', 'pending', ?, ?);`,
          approvalId,
          runId,
          resolvedAgentId,
          'create_tool',
          JSON.stringify(actionPayload),
          now + 86400000,
          now
        );
      } catch (err: any) {
        return { success: false, status: 'error', error: `Failed to create tool approval: ${err?.message || err}` };
      }
    }

    const initialStatus = requireApproval ? 'candidate' : 'active';

    try {
      this.db.execute(
        `INSERT INTO custom_tools (
          id, project_id, name, description, parameters_schema, handler_code, status,
          approval_id, created_by_agent_id, usage_count, success_count, failure_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?);`,
        toolId,
        input.projectId || null,
        cleanName,
        input.description || 'Dynamic custom tool',
        JSON.stringify(parsedSchema),
        input.handlerCode,
        initialStatus,
        approvalId || null,
        input.agentId || null,
        now,
        now
      );

      const tool = this.getToolById(toolId);
      if (!tool) {
        return { success: false, status: 'error', error: 'Failed to retrieve inserted tool.' };
      }

      if (requireApproval) {
        return {
          success: true,
          status: 'created_pending_approval',
          tool,
          approvalId,
          message: `Tool '${cleanName}' proposed and registered with status 'candidate'. Awaiting operator approval. If operator denies, you will smoothly continue using existing tools.`,
        };
      }

      return {
        success: true,
        status: 'created_active',
        tool,
        message: `Tool '${cleanName}' created successfully and is now active for the swarm.`,
      };
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE')) {
        return {
          success: false,
          status: 'error',
          error: `A custom tool named '${cleanName}' already exists in this project.`,
        };
      }
      return { success: false, status: 'error', error: err?.message || String(err) };
    }
  }

  // ============================================================================
  // 3. WORKER-THREAD SANDBOX EXECUTION
  // ============================================================================

  public async executeCustomTool(
    nameOrId: string,
    params: Record<string, unknown> = {},
    executionContext: ExecuteCustomToolContext = {}
  ): Promise<ExecuteCustomToolResult> {
    const tool = this.getTool(nameOrId, executionContext.projectId);
    if (!tool) {
      return { success: false, error: `Custom tool '${nameOrId}' not found.` };
    }

    // Tool must be active, unless we are in an authorized probe trial
    if (tool.status !== 'active' && !(tool.status === 'candidate' && executionContext.isProbe)) {
      return {
        success: false,
        error: `Tool '${tool.name}' is currently in '${tool.status}' status and cannot be executed without operator approval.`,
      };
    }

    const startTime = Date.now();
    let activeWorker: Worker | null = null;
    let timer: NodeJS.Timeout | null = null;

    const sanitizePayload = (obj: any): any => {
      if (!obj) return {};
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch {
        return {};
      }
    };

    const cleanParams = sanitizePayload(params);
    const cleanContext = sanitizePayload(executionContext);
    const worktreeRoot = executionContext.worktreeRoot || process.cwd();

    const workerScript = `
      const { parentPort, workerData } = require('node:worker_threads');
      const vm = require('node:vm');
      const path = require('node:path');
      const fs = require('node:fs');

      (async () => {
        try {
          const { handlerCode, cleanParams, cleanContext, worktreeRoot } = workerData;

          // Canonical jail helper inside worker
          function isPathContained(targetPath, baseDir) {
            try {
              const rel = path.relative(baseDir, path.resolve(baseDir, targetPath));
              return !rel.startsWith('..') && !path.isAbsolute(rel);
            } catch {
              return false;
            }
          }

          // Safe restricted FS module
          const jailedFs = {
            readFileSync: (p, enc) => {
              const resolved = path.resolve(worktreeRoot, p);
              if (!isPathContained(resolved, worktreeRoot)) throw new Error("Path jail traversal blocked: " + p);
              return fs.readFileSync(resolved, enc || 'utf-8');
            },
            writeFileSync: (p, data) => {
              const resolved = path.resolve(worktreeRoot, p);
              if (!isPathContained(resolved, worktreeRoot)) throw new Error("Path jail traversal blocked: " + p);
              return fs.writeFileSync(resolved, data, 'utf-8');
            },
            existsSync: (p) => {
              const resolved = path.resolve(worktreeRoot, p);
              if (!isPathContained(resolved, worktreeRoot)) return false;
              return fs.existsSync(resolved);
            }
          };

          // Build sandboxed context with restricted globals (no host Buffer or host constructors)
          const context = vm.createContext({
            params: Object.freeze(JSON.parse(JSON.stringify(cleanParams))),
            context: Object.freeze(JSON.parse(JSON.stringify(cleanContext))),
            fs: jailedFs,
            path: {
              join: path.join,
              resolve: (...args) => path.resolve(worktreeRoot, ...args),
              basename: path.basename,
              dirname: path.dirname,
              extname: path.extname
            },
            console: {
              log: () => {},
              warn: () => {},
              error: () => {}
            },
            JSON,
            Math,
            Date,
            setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5000)),
            clearTimeout,
            exports: {},
            module: { exports: {} }
          });

          // Prevent prototype pollution or constructor escapes inside guest context
          vm.runInContext(
            "globalThis.Buffer = Object.freeze({" +
            "  from: function(input) {" +
            "    if (typeof input === 'string') {" +
            "      var arr = new Uint8Array(input.length);" +
            "      for (var i = 0; i < input.length; i++) arr[i] = input.charCodeAt(i) & 0xff;" +
            "      return arr;" +
            "    }" +
            "    if (Array.isArray(input) || (input && input.constructor && input.constructor.name === 'Uint8Array')) {" +
            "      return new Uint8Array(input);" +
            "    }" +
            "    return new Uint8Array(0);" +
            "  }," +
            "  alloc: function(size) { return new Uint8Array(typeof size === 'number' ? size : 0); }," +
            "  isBuffer: function(obj) { return !!(obj && obj.constructor && obj.constructor.name === 'Uint8Array'); }," +
            "  concat: function(list) {" +
            "    if (!Array.isArray(list)) return new Uint8Array(0);" +
            "    var total = list.reduce(function(acc, c) { return acc + (c ? (c.length || 0) : 0); }, 0);" +
            "    var out = new Uint8Array(total);" +
            "    var offset = 0;" +
            "    for (var i = 0; i < list.length; i++) {" +
            "      var item = list[i];" +
            "      if (item && item.length) { out.set(item, offset); offset += item.length; }" +
            "    }" +
            "    return out;" +
            "  }" +
            "});" +
            "Object.freeze(Object.prototype);" +
            "Object.freeze(Object);" +
            "Object.freeze(Array);",
            context
          );

          const wrapped = "(async () => {\\n" +
            "  const module = { exports: {} };\\n" +
            "  const exports = module.exports;\\n" +
            "  " + handlerCode + "\\n" +
            "  const runFn = typeof module.exports === 'function' ? module.exports : (module.exports.run || module.exports.default || exports.run || exports.default);\\n" +
            "  if (typeof runFn === 'function') { return await runFn(params, context); }\\n" +
            "  return module.exports;\\n" +
            "})();";

          const script = new vm.Script(wrapped, { timeout: 14000 });
          const output = await script.runInContext(context);
          parentPort.postMessage({ success: true, output });
        } catch (err) {
          parentPort.postMessage({ success: false, error: err?.message || String(err) });
        }
      })();
    `;

    try {
      activeWorker = new Worker(workerScript, {
        eval: true,
        workerData: {
          handlerCode: tool.handlerCode,
          cleanParams,
          cleanContext,
          worktreeRoot,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: this.maxMemoryMb,
        },
      });

      const workerPromise = new Promise<{ success: boolean; output?: any; error?: string }>((resolve, reject) => {
        activeWorker!.on('message', (msg) => resolve(msg));
        activeWorker!.on('error', (err) => reject(err));
        activeWorker!.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker process stopped unexpectedly with exit code ${code}`));
          }
        });
      });

      const timeoutMs = typeof executionContext.timeoutMs === 'number' && executionContext.timeoutMs > 0
        ? executionContext.timeoutMs
        : this.defaultTimeoutMs;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Custom tool execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const res = await Promise.race([workerPromise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
        if (activeWorker) {
          try {
            activeWorker.terminate();
          } catch {}
          activeWorker = null;
        }
      });

      const execTime = Date.now() - startTime;

      if (res.success) {
        this.incrementMetrics(tool.id, true);
        return { success: true, output: res.output, executionTimeMs: execTime };
      } else {
        this.incrementMetrics(tool.id, false);
        return { success: false, error: res.error, executionTimeMs: execTime };
      }
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      if (activeWorker) {
        try {
          activeWorker.terminate();
        } catch {}
        activeWorker = null;
      }
      this.incrementMetrics(tool.id, false);
      return {
        success: false,
        error: err?.message || String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  public executeTool(
    nameOrId: string,
    params: Record<string, unknown> = {},
    context: ExecuteCustomToolContext = {}
  ): Promise<ExecuteCustomToolResult> {
    return this.executeCustomTool(nameOrId, params, context);
  }

  // ============================================================================
  // 4. RETRIEVAL, APPROVAL RESOLUTION & MANAGEMENT
  // ============================================================================

  public getTool(nameOrId: string, projectId?: string): CustomTool | undefined {
    const clean = nameOrId.replace(/^custom__|^tool__/, '').trim();
    let row: any;
    if (projectId) {
      row = this.db.queryOne(
        `SELECT * FROM custom_tools WHERE (id = ? OR name = ? COLLATE NOCASE) AND (project_id = ? OR project_id IS NULL) LIMIT 1;`,
        clean,
        clean,
        projectId
      );
    }
    if (!row) {
      row = this.db.queryOne(
        `SELECT * FROM custom_tools WHERE id = ? OR name = ? COLLATE NOCASE LIMIT 1;`,
        clean,
        clean
      );
    }
    return row ? this.mapRowToTool(row) : undefined;
  }

  public getToolById(id: string): CustomTool | undefined {
    const row = this.db.queryOne(`SELECT * FROM custom_tools WHERE id = ?;`, id);
    return row ? this.mapRowToTool(row) : undefined;
  }

  public listTools(arg1?: string, arg2?: string): CustomTool[] {
    const statuses = ['candidate', 'active', 'denied', 'archived'];
    let status: string | undefined;
    let projectId: string | undefined;

    if (arg1 && statuses.includes(arg1)) {
      status = arg1;
      projectId = arg2;
    } else if (arg1 === 'all') {
      status = undefined;
      projectId = arg2;
    } else if (arg2 && statuses.includes(arg2)) {
      status = arg2;
      projectId = arg1;
    } else if (arg2 === 'all') {
      status = undefined;
      projectId = arg1;
    } else {
      projectId = arg1;
      status = arg2;
    }

    let sql = `SELECT * FROM custom_tools WHERE 1=1`;
    const params: any[] = [];
    if (projectId) {
      sql += ` AND (project_id = ? OR project_id IS NULL)`;
      params.push(projectId);
    }
    if (status && status !== 'all') {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC;`;
    const rows = this.db.query<any>(sql, ...params);
    return rows.map((r) => this.mapRowToTool(r));
  }

  public resolveToolApproval(approvalId: string, resolution: 'approved' | 'denied'): boolean {
    const newStatus = resolution === 'approved' ? 'active' : 'denied';
    const now = Date.now();
    const result = this.db.execute(
      `UPDATE custom_tools SET status = ?, updated_at = ? WHERE approval_id = ?;`,
      newStatus,
      now,
      approvalId
    );
    return result.changes > 0;
  }

  public deleteTool(nameOrId: string, projectId?: string): boolean {
    const tool = this.getTool(nameOrId, projectId);
    if (!tool) return false;
    const res = this.db.execute(`DELETE FROM custom_tools WHERE id = ?;`, tool.id);
    return res.changes > 0;
  }

  // ============================================================================
  // 5. GOOGLE RESEARCH HARNESS² IMPROVEMENT LIBRARY
  // ============================================================================

  public recordImprovement(input: {
    projectId?: string;
    domain: string;
    componentType: 'tool' | 'prompt_guidance' | 'subagent_role' | 'skill_recipe';
    problemSignature: string;
    verifiedAdaptation: string;
    evidenceMetrics?: Record<string, unknown>;
  }): HarnessImprovement {
    const id = `harness-${uuidv4()}`;
    const now = Date.now();
    const sig = input.problemSignature.trim();

    // Upsert or increment success runs
    const existing = this.db.queryOne<any>(
      `SELECT id, success_runs FROM harness_improvements WHERE domain = ? AND problem_signature = ?;`,
      input.domain,
      sig
    );

    if (existing) {
      this.db.execute(
        `UPDATE harness_improvements 
         SET success_runs = success_runs + 1, verified_adaptation = ?, evidence_metrics_json = ?, updated_at = ?
         WHERE id = ?;`,
        input.verifiedAdaptation,
        JSON.stringify(input.evidenceMetrics || {}),
        now,
        existing.id
      );
      return this.getImprovementById(existing.id)!;
    }

    this.db.execute(
      `INSERT INTO harness_improvements (
        id, project_id, domain, component_type, problem_signature, verified_adaptation, evidence_metrics_json, success_runs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?);`,
      id,
      input.projectId || null,
      input.domain,
      input.componentType,
      sig,
      input.verifiedAdaptation,
      JSON.stringify(input.evidenceMetrics || {}),
      now,
      now
    );

    return this.getImprovementById(id)!;
  }

  public findImprovements(projectIdOrDomain?: string, domain?: string, componentType?: string): HarnessImprovement[] {
    let sql = `SELECT * FROM harness_improvements WHERE 1=1`;
    const params: any[] = [];
    if (projectIdOrDomain && !domain && !componentType) {
      sql += ` AND (project_id = ? OR domain = ?)`;
      params.push(projectIdOrDomain, projectIdOrDomain);
    } else {
      if (projectIdOrDomain) {
        sql += ` AND project_id = ?`;
        params.push(projectIdOrDomain);
      }
      if (domain) {
        sql += ` AND domain = ?`;
        params.push(domain);
      }
      if (componentType) {
        sql += ` AND component_type = ?`;
        params.push(componentType);
      }
    }
    sql += ` ORDER BY success_runs DESC, updated_at DESC LIMIT 10;`;
    const rows = this.db.query<any>(sql, ...params);
    return rows.map((r) => this.mapRowToImprovement(r));
  }

  public getImprovementById(id: string): HarnessImprovement | undefined {
    const row = this.db.queryOne<any>(`SELECT * FROM harness_improvements WHERE id = ?;`, id);
    return row ? this.mapRowToImprovement(row) : undefined;
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private incrementMetrics(toolId: string, success: boolean): void {
    const now = Date.now();
    if (success) {
      this.db.execute(
        `UPDATE custom_tools SET usage_count = usage_count + 1, success_count = success_count + 1, updated_at = ? WHERE id = ?;`,
        now,
        toolId
      );
    } else {
      this.db.execute(
        `UPDATE custom_tools SET usage_count = usage_count + 1, failure_count = failure_count + 1, updated_at = ? WHERE id = ?;`,
        now,
        toolId
      );
    }
  }

  private mapRowToTool(row: any): CustomTool {
    let parsedSchema: Record<string, unknown> = {};
    try {
      parsedSchema = JSON.parse(row.parameters_schema);
    } catch {
      parsedSchema = {};
    }
    return {
      id: row.id,
      projectId: row.project_id || undefined,
      name: row.name,
      description: row.description,
      parametersSchema: parsedSchema,
      handlerCode: row.handler_code,
      status: row.status,
      approvalId: row.approval_id || undefined,
      createdByAgentId: row.created_by_agent_id || undefined,
      usageCount: row.usage_count || 0,
      successCount: row.success_count || 0,
      failureCount: row.failure_count || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToImprovement(row: any): HarnessImprovement {
    let metrics: Record<string, unknown> = {};
    try {
      metrics = JSON.parse(row.evidence_metrics_json);
    } catch {
      metrics = {};
    }
    return {
      id: row.id,
      projectId: row.project_id || undefined,
      domain: row.domain,
      componentType: row.component_type,
      problemSignature: row.problem_signature,
      verifiedAdaptation: row.verified_adaptation,
      evidenceMetrics: metrics,
      successRuns: row.success_runs || 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
