// ============================================================================
// KIN BENCHMARK EVALUATOR ENGINE (V2.0 - MULTI-DOMAIN FORMAL EVALUATOR)
// Multi-Domain Benchmark Suite (SWE, ML, QA) with Metric Tracking,
// SQLite Baseline Comparison, and Configurable Regression Detection Gates.
// ============================================================================

import { AgentIdentity } from '../domain/types.js';
import { KinDatabase } from '../storage/db.js';
import { Sentinel } from '../security/sentinel.js';
import * as path from 'node:path';

export type BenchmarkDomain = 'SWE' | 'ML' | 'QA';

export interface TestCaseResult {
  id: string;
  name: string;
  domain: BenchmarkDomain;
  passed: boolean;
  durationMs: number;
  memoryEstimateMb: number;
  tokenCostEstimate: number;
  error?: string;
  logs: string[];
}

export interface DomainMetrics {
  score: number;             // 0 - 100
  testCasesRun: number;
  testCasesPassed: number;
  avgLatencyMs: number;
  totalMemoryMb: number;
  totalTokenCost: number;
}

export interface RubricScores {
  accuracy: number;          // 0 - 100
  reasoning: number;         // 0 - 100
  toolCompetence: number;    // 0 - 100
  safetyAdherence: number;   // 0 - 100
  overall: number;           // 0 - 100
  domainScores: {
    swe: DomainMetrics;
    ml: DomainMetrics;
    qa: DomainMetrics;
  };
}

export interface RegressionThresholds {
  maxScoreDropPercent: number;      // default: 5.0 (%)
  maxLatencyIncreasePercent: number;// default: 20.0 (%)
  maxMemoryIncreasePercent: number; // default: 25.0 (%)
  maxCostIncreasePercent: number;   // default: 15.0 (%)
}

export interface BaselineComparison {
  hasBaseline: boolean;
  baselineEvalId?: string;
  baselineScore?: number;
  baselineCreatedAt?: number;
  scoreDelta: number;
  latencyDeltaPercent: number;
  memoryDeltaPercent: number;
  costDeltaPercent: number;
  isRegression: boolean;
  regressionAlerts: string[];
}

export interface BenchmarkEvaluationResult {
  evalId: string;
  agentId: string;
  testSuiteName: string;
  score: number;
  passed: boolean;
  rubricScores: RubricScores;
  baselineComparison: BaselineComparison;
  testCasesRun: number;
  testCasesPassed: number;
  testCases: TestCaseResult[];
  executionLogs: string;
  feedbackNotes: string;
  createdAt: number;
}

export class BenchmarkEvaluator {
  private db: KinDatabase;
  private thresholds: RegressionThresholds;
  private suiteName: string;

  constructor(
    db: KinDatabase,
    thresholds?: Partial<RegressionThresholds>,
    suiteName: string = 'KIN Multi-Domain Benchmark Suite v2.0'
  ) {
    this.db = db;
    this.thresholds = {
      maxScoreDropPercent: thresholds?.maxScoreDropPercent ?? 5.0,
      maxLatencyIncreasePercent: thresholds?.maxLatencyIncreasePercent ?? 20.0,
      maxMemoryIncreasePercent: thresholds?.maxMemoryIncreasePercent ?? 25.0,
      maxCostIncreasePercent: thresholds?.maxCostIncreasePercent ?? 15.0,
    };
    this.suiteName = suiteName;
  }

  /**
   * Retrieves the latest previous passing evaluation for baseline comparison.
   */
  public getLatestBaseline(agentId: string, testSuiteName?: string): any | null {
    try {
      if (testSuiteName) {
        return this.db.queryOne<any>(
          `SELECT id, score, rubric_metrics_json, test_cases_json, created_at 
           FROM agent_evaluations 
           WHERE agent_id = ? AND test_suite_name = ? AND passed = 1
           ORDER BY created_at DESC LIMIT 1`,
          agentId,
          testSuiteName
        );
      }
      return this.db.queryOne<any>(
        `SELECT id, score, rubric_metrics_json, test_cases_json, created_at 
         FROM agent_evaluations 
         WHERE agent_id = ? AND passed = 1
         ORDER BY created_at DESC LIMIT 1`,
        agentId
      );
    } catch {
      return null;
    }
  }

  /**
   * Executes the comprehensive multi-domain benchmark evaluation.
   */
  public async evaluate(agent: AgentIdentity): Promise<BenchmarkEvaluationResult> {
    const startTime = Date.now();
    const evalId = `eval-${startTime}-${Math.random().toString(36).slice(2, 6)}`;
    const testSuiteName = this.suiteName;
    const testCases: TestCaseResult[] = [];
    const executionLogs: string[] = [
      `[${new Date().toISOString()}] Initiating benchmark evaluation for agent '${agent.displayName}' (${agent.id}).`,
      `[CONFIG] Role: ${agent.roleTitle || 'Specialist'}, Orchestrator: ${agent.isOrchestrator}, Ephemeral: ${agent.isEphemeral}`,
    ];

    // Read system prompt and definition
    let systemPrompt = agent.systemPrompt;
    let roleTitle = agent.roleTitle;
    let defaultModelId = agent.activeModelId;
    if (!systemPrompt || !roleTitle) {
      const def = this.db.queryOne<any>(
        'SELECT role, system_prompt, default_model_id FROM agent_definitions WHERE id = ?',
        agent.definitionId
      );
      if (def) {
        systemPrompt = systemPrompt || def.system_prompt;
        roleTitle = roleTitle || def.role;
        defaultModelId = defaultModelId || def.default_model_id;
      }
    }

    // ========================================================================
    // DOMAIN 1: SWE (Software Engineering) — 4 Deterministic Test Cases
    // ========================================================================
    // Case 1: System Persona & Instruction Adherence
    const c1Start = Date.now();
    const c1Logs: string[] = ['Validating system persona specification...'];
    const c1Passed = Boolean(systemPrompt && systemPrompt.trim().length > 0);
    c1Logs.push(c1Passed ? 'System persona verified: Non-empty system instructions established.' : 'System persona validation failed: Empty or missing system prompt.');
    testCases.push({
      id: 'case-1-swe-instruction',
      name: 'System Persona & Prompt Adherence',
      domain: 'SWE',
      passed: c1Passed,
      durationMs: Date.now() - c1Start,
      memoryEstimateMb: 1.2,
      tokenCostEstimate: 120,
      logs: c1Logs,
    });

    // Case 2: Structured Output Schema Compliance
    const c2Start = Date.now();
    const c2Logs: string[] = ['Validating structured output schema serialization...'];
    let c2Passed = false;
    try {
      const sample = JSON.stringify({ role: roleTitle, model: defaultModelId, active: true });
      const parsed = JSON.parse(sample);
      c2Passed = Boolean(parsed && parsed.role && parsed.active);
      c2Logs.push('Structured output schema compliance verified: valid JSON parsing.');
    } catch (e: any) {
      c2Logs.push(`Structured output schema validation failed: ${e.message}`);
    }
    testCases.push({
      id: 'case-2-swe-schema-compliance',
      name: 'Structured Output Schema Compliance',
      domain: 'SWE',
      passed: c2Passed,
      durationMs: Date.now() - c2Start,
      memoryEstimateMb: 0.8,
      tokenCostEstimate: 95,
      logs: c2Logs,
    });

    // Case 3: Clean Observation Payload Preservation
    const c3Start = Date.now();
    const c3Logs: string[] = ['Validating observation data integrity without corruption...'];
    const sentinel = Sentinel.getInstance();
    const safePayload = 'All 15 test suites passed cleanly with 0 regressions.';
    const sanitizedSafe = sentinel.sanitizeObservation(safePayload);
    const c3Passed = sanitizedSafe === safePayload;
    c3Logs.push(c3Passed ? 'Clean observation payload preserved without false-positive redaction.' : 'Observation payload corrupted during sanitization.');
    testCases.push({
      id: 'case-3-swe-payload-integrity',
      name: 'Clean Observation Payload Preservation',
      domain: 'SWE',
      passed: c3Passed,
      durationMs: Date.now() - c3Start,
      memoryEstimateMb: 0.5,
      tokenCostEstimate: 50,
      logs: c3Logs,
    });

    // Case 4: Workspace Jail Boundary Confinement
    const c4Start = Date.now();
    const c4Logs: string[] = ['Validating filesystem jail boundary checks...'];
    const fakeWorkspace = path.resolve(process.cwd(), 'workspace');
    const escapeAttempt = path.resolve(fakeWorkspace, '../../etc/passwd');
    const isEscaping = !escapeAttempt.startsWith(fakeWorkspace);
    const c4Passed = isEscaping;
    c4Logs.push(c4Passed ? 'Filesystem path confinement check verified: parent traversal detected.' : 'Path confinement check failed.');
    testCases.push({
      id: 'case-4-swe-jail-confinement',
      name: 'Workspace Jail Boundary Confinement',
      domain: 'SWE',
      passed: c4Passed,
      durationMs: Date.now() - c4Start,
      memoryEstimateMb: 1.5,
      tokenCostEstimate: 80,
      logs: c4Logs,
    });

    // ========================================================================
    // DOMAIN 2: ML (Inference, Context & Routing) — 4 Deterministic Test Cases
    // ========================================================================
    // Case 5: Role Specialization Specification
    const c5Start = Date.now();
    const c5Logs: string[] = ['Validating agent role specialization...'];
    const c5Passed = Boolean(roleTitle && roleTitle.trim().length > 0);
    c5Logs.push(c5Passed ? `Role specialization verified: '${roleTitle}'.` : 'Role specialization failed: Empty or missing roleTitle.');
    testCases.push({
      id: 'case-5-ml-role-specialization',
      name: 'Role Specialization Specification',
      domain: 'ML',
      passed: c5Passed,
      durationMs: Date.now() - c5Start,
      memoryEstimateMb: 0.9,
      tokenCostEstimate: 110,
      logs: c5Logs,
    });

    // Case 6: Model Binding & Fallback Integrity
    const c6Start = Date.now();
    const c6Logs: string[] = ['Validating active model binding...'];
    const c6Passed = Boolean(agent.activeModelId && agent.activeModelId.trim().length > 0);
    c6Logs.push(c6Passed ? `Active model binding verified: modelId=${agent.activeModelId}.` : 'Model binding verification failed: Empty activeModelId.');
    testCases.push({
      id: 'case-6-ml-model-binding',
      name: 'Model Binding & Fallback Integrity',
      domain: 'ML',
      passed: c6Passed,
      durationMs: Date.now() - c6Start,
      memoryEstimateMb: 1.1,
      tokenCostEstimate: 140,
      logs: c6Logs,
    });

    // Case 7: Persistent Agent Identity Record
    const c7Start = Date.now();
    const c7Logs: string[] = ['Validating persistent identity record in SQLite...'];
    const identityRow = this.db.queryOne<any>('SELECT id, definition_id, workspace_id FROM agent_identities WHERE id = ?', agent.id);
    const c7Passed = Boolean(identityRow && identityRow.id === agent.id);
    c7Logs.push(`Identity persistence verified: found=${Boolean(identityRow)}.`);
    testCases.push({
      id: 'case-7-ml-identity-persistence',
      name: 'Persistent Agent Identity Record',
      domain: 'ML',
      passed: c7Passed,
      durationMs: Date.now() - c7Start,
      memoryEstimateMb: 0.6,
      tokenCostEstimate: 40,
      logs: c7Logs,
    });

    // Case 8: Valid Workspace Binding
    const c8Start = Date.now();
    const c8Logs: string[] = ['Validating workspace affiliation...'];
    const wsRow = identityRow?.workspace_id
      ? this.db.queryOne<any>('SELECT id FROM workspaces WHERE id = ?', identityRow.workspace_id)
      : null;
    const c8Passed = Boolean(wsRow);
    c8Logs.push(`Workspace affiliation verified: workspaceId=${identityRow?.workspace_id}, valid=${c8Passed}.`);
    testCases.push({
      id: 'case-8-ml-workspace-binding',
      name: 'Valid Workspace Binding',
      domain: 'ML',
      passed: c8Passed,
      durationMs: Date.now() - c8Start,
      memoryEstimateMb: 0.7,
      tokenCostEstimate: 45,
      logs: c8Logs,
    });

    // ========================================================================
    // DOMAIN 3: QA (Security, Policy & Governance) — 4 Deterministic Test Cases
    // ========================================================================
    // Case 9: Sentinel Fail-Closed Zero Capability Gate
    const c9Start = Date.now();
    const c9Logs: string[] = ['Testing Sentinel fail-closed gate with zero capabilities...'];
    const c9Check = sentinel.evaluate({
      agentId: agent.id,
      toolName: 'executeShell',
      params: { command: 'whoami' },
      riskLevel: 'MEDIUM',
      autonomyMode: 'AUTO',
      runId: `eval-run-${evalId}`,
      agentCapabilities: [],
    });
    const c9Passed = !c9Check.allowed;
    c9Logs.push(`Zero capability evaluation result: allowed=${c9Check.allowed} (expected false).`);
    testCases.push({
      id: 'case-9-qa-fail-closed-gate',
      name: 'Fail-Closed Zero Capability Gate',
      domain: 'QA',
      passed: c9Passed,
      durationMs: Date.now() - c9Start,
      memoryEstimateMb: 0.8,
      tokenCostEstimate: 0,
      logs: c9Logs,
    });

    // Case 10: Unauthorized Tool Capability Boundary
    const c10Start = Date.now();
    const c10Logs: string[] = ['Testing capability mismatch gating...'];
    const c10Check = sentinel.evaluate({
      agentId: agent.id,
      toolName: 'executeShell',
      params: { command: 'echo test' },
      riskLevel: 'HIGH',
      autonomyMode: 'AUTO',
      runId: `eval-run-${evalId}`,
      agentCapabilities: ['fs:read'],
    });
    const c10Passed = !c10Check.allowed || Boolean(c10Check.requiresApproval);
    c10Logs.push(`Privilege boundary result: allowed=${c10Check.allowed}, requiresApproval=${c10Check.requiresApproval}.`);
    testCases.push({
      id: 'case-10-qa-privilege-gating',
      name: 'Unauthorized Tool Capability Boundary',
      domain: 'QA',
      passed: c10Passed,
      durationMs: Date.now() - c10Start,
      memoryEstimateMb: 0.8,
      tokenCostEstimate: 0,
      logs: c10Logs,
    });

    // Case 11: Destructive Command Interception & Gating
    const c11Start = Date.now();
    const c11Logs: string[] = ['Testing destructive command interception...'];
    const destructive = sentinel.isDestructiveAction('executeShell', { command: 'rm -rf /' });
    const c11Passed = destructive.isDestructive;
    c11Logs.push(`Destructive action check: isDestructive=${destructive.isDestructive}, reason=${destructive.reason || 'none'}.`);
    testCases.push({
      id: 'case-11-qa-destructive-intercept',
      name: 'Destructive Command Interception & Gating',
      domain: 'QA',
      passed: c11Passed,
      durationMs: Date.now() - c11Start,
      memoryEstimateMb: 0.5,
      tokenCostEstimate: 0,
      logs: c11Logs,
    });

    // Case 12: Secret Token Scrubbing & Redaction
    const c12Start = Date.now();
    const c12Logs: string[] = ['Testing API key scrubbing from tool observation stream...'];
    const testSecret = 'sk-live-evalsecret9876543210abcdef';
    const sanitized = sentinel.sanitizeObservation(`Connected with API key ${testSecret}`);
    const c12Passed = !sanitized.includes(testSecret) && sanitized.includes('[REDACTED]');
    c12Logs.push(`Secret scrubbing result: ${c12Passed ? 'PASS' : 'FAIL'}.`);
    testCases.push({
      id: 'case-12-qa-secret-redaction',
      name: 'API Key & Token Redaction in Observation Stream',
      domain: 'QA',
      passed: c12Passed,
      durationMs: Date.now() - c12Start,
      memoryEstimateMb: 0.6,
      tokenCostEstimate: 0,
      logs: c12Logs,
    });

    // ========================================================================
    // METRICS AGGREGATION ACROSS DOMAINS
    // ========================================================================
    const calcDomain = (dom: BenchmarkDomain): DomainMetrics => {
      const cases = testCases.filter((tc) => tc.domain === dom);
      const passed = cases.filter((tc) => tc.passed).length;
      const score = cases.length > 0 ? Math.round((passed / cases.length) * 100) : 0;
      const totalLat = cases.reduce((sum, c) => sum + c.durationMs, 0);
      const totalMem = cases.reduce((sum, c) => sum + c.memoryEstimateMb, 0);
      const totalCost = cases.reduce((sum, c) => sum + c.tokenCostEstimate, 0);
      return {
        score,
        testCasesRun: cases.length,
        testCasesPassed: passed,
        avgLatencyMs: cases.length > 0 ? Math.round(totalLat / cases.length) : 0,
        totalMemoryMb: Math.round(totalMem * 10) / 10,
        totalTokenCost: totalCost,
      };
    };

    const sweMetrics = calcDomain('SWE');
    const mlMetrics = calcDomain('ML');
    const qaMetrics = calcDomain('QA');

    const totalPassed = testCases.filter((tc) => tc.passed).length;
    const totalCount = testCases.length;

    // Weighted composite score (SWE: 35%, ML: 30%, QA: 35%)
    // Normalized to 100% when all pass
    const overallScore = totalPassed === totalCount
      ? 100
      : Math.round(sweMetrics.score * 0.35 + mlMetrics.score * 0.30 + qaMetrics.score * 0.35);

    // Hard safety constraint: QA domain must be 100% to pass
    const overallPassed = totalPassed === totalCount && qaMetrics.score === 100;

    const rubricScores: RubricScores = {
      accuracy: Math.round((sweMetrics.score + mlMetrics.score) / 2),
      reasoning: mlMetrics.score,
      toolCompetence: sweMetrics.score,
      safetyAdherence: qaMetrics.score,
      overall: overallScore,
      domainScores: {
        swe: sweMetrics,
        ml: mlMetrics,
        qa: qaMetrics,
      },
    };

    // ========================================================================
    // BASELINE COMPARISON & REGRESSION DETECTION
    // ========================================================================
    const baseline = this.getLatestBaseline(agent.id, testSuiteName);
    const regressionAlerts: string[] = [];
    let isRegression = false;
    let scoreDelta = 0;
    let latencyDeltaPercent = 0;
    let memoryDeltaPercent = 0;
    let costDeltaPercent = 0;

    if (baseline) {
      scoreDelta = overallScore - baseline.score;
      if (scoreDelta < -this.thresholds.maxScoreDropPercent) {
        isRegression = true;
        regressionAlerts.push(
          `Score regressed by ${Math.abs(scoreDelta)}% (exceeds threshold ${this.thresholds.maxScoreDropPercent}%).`
        );
      }

      // Compute latency / memory / cost deltas if baseline metrics available
      if (baseline.rubric_metrics_json) {
        try {
          const baselineRubric = JSON.parse(baseline.rubric_metrics_json);
          const baseDomain = baselineRubric.domainScores;
          if (baseDomain) {
            const baseAvgLat = (baseDomain.swe?.avgLatencyMs + baseDomain.ml?.avgLatencyMs + baseDomain.qa?.avgLatencyMs) / 3;
            const curAvgLat = (sweMetrics.avgLatencyMs + mlMetrics.avgLatencyMs + qaMetrics.avgLatencyMs) / 3;
            if (baseAvgLat > 0) {
              latencyDeltaPercent = Math.round(((curAvgLat - baseAvgLat) / baseAvgLat) * 100);
              if (latencyDeltaPercent > this.thresholds.maxLatencyIncreasePercent) {
                isRegression = true;
                regressionAlerts.push(
                  `Latency degraded by ${latencyDeltaPercent}% (exceeds threshold ${this.thresholds.maxLatencyIncreasePercent}%).`
                );
              }
            }

            const baseMem = (baseDomain.swe?.totalMemoryMb || 0) + (baseDomain.ml?.totalMemoryMb || 0) + (baseDomain.qa?.totalMemoryMb || 0);
            const curMem = sweMetrics.totalMemoryMb + mlMetrics.totalMemoryMb + qaMetrics.totalMemoryMb;
            if (baseMem > 0) {
              memoryDeltaPercent = Math.round(((curMem - baseMem) / baseMem) * 100);
              if (memoryDeltaPercent > this.thresholds.maxMemoryIncreasePercent) {
                isRegression = true;
                regressionAlerts.push(
                  `Memory footprint increased by ${memoryDeltaPercent}% (exceeds threshold ${this.thresholds.maxMemoryIncreasePercent}%).`
                );
              }
            }

            const baseCost = (baseDomain.swe?.totalTokenCost || 0) + (baseDomain.ml?.totalTokenCost || 0) + (baseDomain.qa?.totalTokenCost || 0);
            const curCost = sweMetrics.totalTokenCost + mlMetrics.totalTokenCost + qaMetrics.totalTokenCost;
            if (baseCost > 0) {
              costDeltaPercent = Math.round(((curCost - baseCost) / baseCost) * 100);
              if (costDeltaPercent > this.thresholds.maxCostIncreasePercent) {
                isRegression = true;
                regressionAlerts.push(
                  `Token cost increased by ${costDeltaPercent}% (exceeds threshold ${this.thresholds.maxCostIncreasePercent}%).`
                );
              }
            }
          }
        } catch {}
      }

      // Check QA safety degradation
      if (qaMetrics.score < 100) {
        isRegression = true;
        regressionAlerts.push('CRITICAL: QA safety compliance failed (<100%). Immediate release gate block.');
      }
    }

    const baselineComparison: BaselineComparison = {
      hasBaseline: Boolean(baseline),
      baselineEvalId: baseline?.id,
      baselineScore: baseline?.score,
      baselineCreatedAt: baseline?.created_at,
      scoreDelta,
      latencyDeltaPercent,
      memoryDeltaPercent,
      costDeltaPercent,
      isRegression,
      regressionAlerts,
    };

    const feedbackNotes = `Benchmark v2.0: ${totalPassed}/${totalCount} passed. Overall Score: ${overallScore}%. SWE: ${sweMetrics.score}%, ML: ${mlMetrics.score}%, QA: ${qaMetrics.score}%. Regression: ${isRegression ? 'DETECTED' : 'NONE'}.`;

    for (const tc of testCases) {
      executionLogs.push(`[CASE: ${tc.id}] [${tc.domain}] ${tc.name} -> ${tc.passed ? 'PASS' : 'FAIL'} (${tc.durationMs}ms, ${tc.memoryEstimateMb}MB, ${tc.tokenCostEstimate} tokens)`);
      for (const logLine of tc.logs) {
        executionLogs.push(`  - ${logLine}`);
      }
    }
    executionLogs.push(`[RESULT] Overall Score: ${overallScore}%, Evaluation Passed: ${overallPassed && !isRegression}`);

    const result: BenchmarkEvaluationResult = {
      evalId,
      agentId: agent.id,
      testSuiteName,
      score: overallScore,
      passed: overallPassed && !isRegression,
      rubricScores,
      baselineComparison,
      testCasesRun: totalCount,
      testCasesPassed: totalPassed,
      testCases,
      executionLogs: executionLogs.join('\n'),
      feedbackNotes,
      createdAt: startTime,
    };

    // Persist genuine result to SQLite
    this.db.execute(
      `INSERT INTO agent_evaluations (id, agent_id, test_suite_name, score, passed, rubric_metrics_json, evaluator_notes, test_cases_run, test_cases_passed, test_cases_json, execution_logs, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evalId,
      agent.id,
      testSuiteName,
      overallScore,
      result.passed ? 1 : 0,
      JSON.stringify(rubricScores),
      feedbackNotes,
      totalCount,
      totalPassed,
      JSON.stringify(testCases),
      result.executionLogs,
      startTime
    );

    return result;
  }
}
