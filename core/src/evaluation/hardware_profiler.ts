// ============================================================================
// KIN REFERENCE HARDWARE QA PROFILER (MILESTONE 4 PRODUCTION READY)
// Automatic physical hardware profiling, multi-tier classification, and
// runtime resource limit validation across 3 reference tiers:
// Tier 1: Baseline Laptop (<150MB RSS, 2k-4k context, 50% compaction)
// Tier 2: Standard Developer (<250MB RSS, 8k context, 75% compaction)
// Tier 3: Performance Workstation (<500MB RSS, 32k+ context, 85% compaction)
// ============================================================================

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { KinDatabase } from '../storage/db.js';
import { MigrationRunner } from '../storage/migration_runner.js';
import { ContextCompactor, CompactionSnapshot } from '../context/context_compactor.js';
import { ContextCompiler } from '../context/context_compiler.js';
import { AgentDefinition, AgentIdentity, Message, Project, Channel } from '../domain/types.js';

export type HardwareTier = 'baseline_laptop' | 'standard_developer' | 'performance_workstation';

export interface HostHardwareSpecs {
  totalRamBytes: number;
  totalRamGB: number;
  freeRamBytes: number;
  freeRamGB: number;
  cpuCores: number;
  platform: string;
  arch: string;
  estimatedVramGB: number;
  isSimulated?: boolean;
}

export interface HardwareProfileConstraints {
  tier: HardwareTier;
  tierName: string;
  description: string;
  maxIdleRamMb: number;
  maxHeapMb: number;
  maxActiveRuns: number;
  maxBrowserContexts: number;
  maxShellProcesses: number;
  toolEngineMemoryLimitMb: number;
  contextWindowTokens: number;
  compactionThresholdRatio: number;
  outputSpillerThresholdBytes: number;
  idleEvictionWindowMs: number;
  gcStrategy: 'aggressive' | 'standard' | 'relaxed';
  recommendedLocalModels: string[];
  ollamaContextSize: number;
}

export interface BenchmarkReport {
  timestamp: number;
  detectedSpecs: HostHardwareSpecs;
  assignedTier: HardwareTier;
  constraints: HardwareProfileConstraints;
  metrics: {
    idleMemory: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
      externalMb: number;
      passedBudget: boolean;
      targetBudgetMb: number;
    };
    sqliteThroughput: {
      totalWrites: number;
      durationMs: number;
      writesPerSecond: number;
      targetWritesPerSecond: number;
      passed: boolean;
    };
    contextCompilation: {
      tokenBudget: number;
      durationMs: number;
      targetLatencyMs: number;
      passed: boolean;
    };
    compactionReduction: {
      messagesCompacted: number;
      tokensBefore: number;
      tokensAfter: number;
      reductionRatioPercent: number;
      durationMs: number;
      passed: boolean;
    };
    startupLatency: {
      durationMs: number;
      targetLatencyMs: number;
      passed: boolean;
    };
  };
  overallPassed: boolean;
}

export class HardwareProfiler {
  /**
   * Detects physical host hardware specifications.
   * Allows simulated overrides for deterministic test matrix execution.
   */
  public detectHostHardware(overrides?: Partial<HostHardwareSpecs>): HostHardwareSpecs {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const totalGB = Math.round((totalBytes / (1024 ** 3)) * 10) / 10;
    const freeGB = Math.round((freeBytes / (1024 ** 3)) * 10) / 10;
    const cpuCores = os.cpus()?.length || 4;

    // VRAM heuristic estimation
    let estimatedVram = 0;
    if (totalGB >= 28) {
      estimatedVram = 16;
    } else if (totalGB >= 12) {
      estimatedVram = 8;
    }

    const detected: HostHardwareSpecs = {
      totalRamBytes: totalBytes,
      totalRamGB: totalGB,
      freeRamBytes: freeBytes,
      freeRamGB: freeGB,
      cpuCores,
      platform: os.platform(),
      arch: os.arch(),
      estimatedVramGB: estimatedVram,
      isSimulated: false,
    };

    if (overrides) {
      return {
        ...detected,
        ...overrides,
        isSimulated: true,
      };
    }

    return detected;
  }

  /**
   * Classifies host machine into one of 3 hardware tiers.
   */
  public classifyTier(specs: HostHardwareSpecs): HardwareTier {
    if (specs.totalRamGB < 12 || specs.cpuCores <= 4) {
      return 'baseline_laptop';
    }
    if (specs.totalRamGB >= 28 || specs.cpuCores >= 12) {
      return 'performance_workstation';
    }
    return 'standard_developer';
  }

  /**
   * Returns authoritative runtime constraints and tuning parameters for a hardware tier.
   */
  public getTierConstraints(tier: HardwareTier): HardwareProfileConstraints {
    switch (tier) {
      case 'baseline_laptop':
        return {
          tier: 'baseline_laptop',
          tierName: 'Tier 1: Baseline Laptop',
          description: 'Entry-level hardware (8GB-12GB RAM, <=4 CPU cores, integrated graphics). Highly compact profile.',
          maxIdleRamMb: 150,
          maxHeapMb: 512,
          maxActiveRuns: 2,
          maxBrowserContexts: 1,
          maxShellProcesses: 1,
          toolEngineMemoryLimitMb: 64,
          contextWindowTokens: 4096,
          compactionThresholdRatio: 0.50,
          outputSpillerThresholdBytes: 1024,
          idleEvictionWindowMs: 60000,
          gcStrategy: 'aggressive',
          recommendedLocalModels: [
            'qwen2.5:1.5b',
            'llama3.2:1b',
            'llama3.2:3b',
            'phi3.5:mini',
          ],
          ollamaContextSize: 2048,
        };

      case 'standard_developer':
        return {
          tier: 'standard_developer',
          tierName: 'Tier 2: Standard Developer Machine',
          description: 'Standard development machine (16GB RAM, 6-10 CPU cores, ~8GB discrete VRAM). Balanced profile.',
          maxIdleRamMb: 250,
          maxHeapMb: 1024,
          maxActiveRuns: 8,
          maxBrowserContexts: 2,
          maxShellProcesses: 2,
          toolEngineMemoryLimitMb: 128,
          contextWindowTokens: 8192,
          compactionThresholdRatio: 0.75,
          outputSpillerThresholdBytes: 2048,
          idleEvictionWindowMs: 180000,
          gcStrategy: 'standard',
          recommendedLocalModels: [
            'llama3.1:8b',
            'qwen2.5:7b',
            'mistral:7b-instruct',
          ],
          ollamaContextSize: 8192,
        };

      case 'performance_workstation':
        return {
          tier: 'performance_workstation',
          tierName: 'Tier 3: Performance Workstation',
          description: 'High-end workstation (32GB+ RAM, 12+ CPU cores, 16GB+ discrete VRAM). Maximum throughput profile.',
          maxIdleRamMb: 500,
          maxHeapMb: 2048,
          maxActiveRuns: 16,
          maxBrowserContexts: 4,
          maxShellProcesses: 4,
          toolEngineMemoryLimitMb: 256,
          contextWindowTokens: 32768,
          compactionThresholdRatio: 0.85,
          outputSpillerThresholdBytes: 4096,
          idleEvictionWindowMs: 300000,
          gcStrategy: 'relaxed',
          recommendedLocalModels: [
            'qwen2.5:14b',
            'qwen2.5:32b',
            'llama3.3:70b',
            'deepseek-r1:14b',
            'deepseek-r1:32b',
          ],
          ollamaContextSize: 32768,
        };
    }
  }

  /**
   * Measures current process memory consumption and validates against the tier budget.
   */
  public measureIdleMemory(targetBudgetMb: number = 150): BenchmarkReport['metrics']['idleMemory'] {
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / (1024 * 1024));
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
    const heapTotalMb = Math.round(mem.heapTotal / (1024 * 1024));
    const externalMb = Math.round(mem.external / (1024 * 1024));

    return {
      rssMb,
      heapUsedMb,
      heapTotalMb,
      externalMb,
      targetBudgetMb,
      passedBudget: rssMb <= targetBudgetMb,
    };
  }

  /**
   * Benchmarks SQLite WAL transactional write throughput.
   */
  public async benchmarkSqliteThroughput(
    db: KinDatabase,
    writeCount: number = 200,
    targetWritesPerSecond: number = 200
  ): Promise<BenchmarkReport['metrics']['sqliteThroughput']> {
    const start = Date.now();
    const testKeyPrefix = `bench_${start}`;

    // Execute atomic batch of writes in WAL mode
    db.transactionSync(() => {
      for (let i = 0; i < writeCount; i++) {
        db.execute(
          `INSERT INTO memories (id, scope, scope_id, type, key, value_json, version, created_at, updated_at)
           VALUES (?, 'project', 'proj-bench', 'semantic', ?, '{"metric": "throughput"}', 1, ?, ?)`,
          `mem-${testKeyPrefix}-${i}`,
          `${testKeyPrefix}_${i}`,
          start + i,
          start + i
        );
      }
    });

    const durationMs = Math.max(1, Date.now() - start);
    const writesPerSecond = Math.round((writeCount / durationMs) * 1000);
    const passed = writesPerSecond >= targetWritesPerSecond || durationMs < 500;

    return {
      totalWrites: writeCount,
      durationMs,
      writesPerSecond,
      targetWritesPerSecond,
      passed,
    };
  }

  /**
   * Benchmarks structured 5-block context assembly latency.
   */
  public async benchmarkContextCompilation(
    tokenBudget: number = 8192,
    targetLatencyMs: number = 30
  ): Promise<BenchmarkReport['metrics']['contextCompilation']> {
    const start = Date.now();

    const mockAgent: AgentIdentity = {
      id: 'ag-bench-compiler',
      workspaceId: 'ws-bench',
      projectId: 'proj-bench',
      definitionId: 'def-bench',
      displayName: 'Compiler Benchmark Specialist',
      roleTitle: 'Performance Evaluator',
      systemPrompt: 'You are an autonomous engineering agent.',
      activeModelId: 'ollama/llama3',
      isOrchestrator: false,
      isEphemeral: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockDef: AgentDefinition = {
      id: 'def-bench',
      name: 'Performance Evaluator',
      role: 'Performance Evaluator',
      systemPrompt: 'You are an autonomous engineering agent.',
      defaultModelId: 'ollama/llama3',
      domainAuthority: ['evaluation'],
      capabilities: ['fs:read'],
      createdAt: Date.now(),
    };

    const mockProject: Project = {
      id: 'proj-bench',
      workspaceId: 'ws-bench',
      name: 'BenchProject',
      repoPath: '.',
      settings: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockChannel: Channel = {
      id: 'chan-bench',
      projectId: 'proj-bench',
      name: 'general',
      isPrivate: false,
      createdAt: Date.now(),
    };

    const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-bench-${i}`,
      channelId: 'chan-bench',
      senderId: i % 2 === 0 ? 'user-1' : mockAgent.id,
      senderType: (i % 2 === 0 ? 'human' : 'agent') as 'human' | 'agent',
      content: `Turn ${i}: Inspecting system memory metrics and verifying prompt cache alignment across 5 blocks.`,
      mentions: [],
      productivityScore: 100,
      createdAt: Date.now() - (20 - i) * 1000,
    }));

    const compiler = new ContextCompiler();
    compiler.compile({
      agentIdentity: mockAgent,
      agentDefinition: mockDef,
      project: mockProject,
      activeChannel: mockChannel,
      toolSchemas: [],
      projectDecisions: [],
      trajectoryMessages: messages,
      tokenBudget,
    });

    const durationMs = Math.max(1, Date.now() - start);
    const passed = durationMs <= targetLatencyMs;

    return {
      tokenBudget,
      durationMs,
      targetLatencyMs,
      passed,
    };
  }

  /**
   * Benchmarks context compactor efficiency and token reduction ratio.
   */
  public async benchmarkCompaction(
    thresholdRatio: number = 0.50
  ): Promise<BenchmarkReport['metrics']['compactionReduction']> {
    const start = Date.now();
    const compactor = new ContextCompactor();

    // Trajectory of 30 messages simulating conversation with observations
    const messages: Message[] = Array.from({ length: 30 }, (_, i) => ({
      id: `msg-comp-${i}`,
      channelId: 'chan-comp',
      senderId: i % 2 === 0 ? 'user-1' : 'ag-bench',
      senderType: (i % 2 === 0 ? 'human' : 'agent') as 'human' | 'agent',
      content: `Turn ${i}: Extensive tool execution output with 500 characters of trace logs and database updates. Step ${i} finished. Result: status=ok, records_modified=12.`,
      mentions: [],
      productivityScore: 100,
      createdAt: Date.now() - (30 - i) * 1000,
    }));

    const snapshotState: Omit<CompactionSnapshot, 'compactedAt'> = {
      goalId: 'goal-bench',
      primaryObjective: 'Execute high-throughput memory compaction',
      completedTasks: [{ id: 'task-1', title: 'Compile initial AST' }],
      activeTask: { id: 'task-2', title: 'Compact message history' },
      modifiedFiles: [{ path: 'core/src/evaluation/hardware_profiler.ts' }],
      encounteredErrorsAndResolutions: [],
      immutableDecisions: [{ key: 'storage', decision: 'SQLite WAL mode' }],
      pendingTaskDag: [],
    };

    const tokensBefore = 3500;
    const maxTokens = 4000;

    const result = compactor.evaluateAndCompact({
      messages,
      currentTokens: tokensBefore,
      maxTokens,
      snapshotState,
      compactionThresholdRatio: thresholdRatio,
    });

    const durationMs = Math.max(1, Date.now() - start);
    const reductionRatioPercent = tokensBefore > 0
      ? Math.round(((tokensBefore - result.tokensAfter) / tokensBefore) * 100)
      : 0;

    const passed = result.didCompact && reductionRatioPercent >= 40 && durationMs < 50;

    return {
      messagesCompacted: messages.length,
      tokensBefore,
      tokensAfter: result.tokensAfter,
      reductionRatioPercent,
      durationMs,
      passed,
    };
  }

  /**
   * Measures cold database and engine initialization latency.
   */
  public async benchmarkStartupLatency(
    tempDbPath: string,
    targetLatencyMs: number = 350
  ): Promise<BenchmarkReport['metrics']['startupLatency']> {
    const start = Date.now();

    const db = new KinDatabase(tempDbPath);
    new MigrationRunner(db).runMigrations();
    const pragma = db.queryOne<{ journal_mode: string }>('PRAGMA journal_mode;');

    const durationMs = Math.max(1, Date.now() - start);
    const passed = Boolean(pragma && pragma.journal_mode.toLowerCase() === 'wal') && durationMs <= targetLatencyMs;

    db.close();

    return {
      durationMs,
      targetLatencyMs,
      passed,
    };
  }

  /**
   * Executes complete end-to-end QA profiling suite for the detected or simulated hardware tier.
   */
  public async runFullHardwareQASuite(
    db: KinDatabase,
    simulatedTier?: HardwareTier,
    tempDbPath?: string
  ): Promise<BenchmarkReport> {
    const timestamp = Date.now();

    // 1. Detect hardware (or simulate)
    let overrideSpecs: Partial<HostHardwareSpecs> | undefined = undefined;
    if (simulatedTier === 'baseline_laptop') {
      overrideSpecs = { totalRamGB: 8, cpuCores: 4 };
    } else if (simulatedTier === 'standard_developer') {
      overrideSpecs = { totalRamGB: 16, cpuCores: 8 };
    } else if (simulatedTier === 'performance_workstation') {
      overrideSpecs = { totalRamGB: 32, cpuCores: 16 };
    }

    const detectedSpecs = this.detectHostHardware(overrideSpecs);
    const assignedTier = simulatedTier ?? this.classifyTier(detectedSpecs);
    const constraints = this.getTierConstraints(assignedTier);

    // 2. Measure idle memory
    const idleMemory = this.measureIdleMemory(constraints.maxIdleRamMb);

    // 3. Measure SQLite throughput
    const sqliteThroughput = await this.benchmarkSqliteThroughput(db);

    // 4. Measure context compilation
    const contextCompilation = await this.benchmarkContextCompilation(constraints.contextWindowTokens);

    // 5. Measure compaction
    const compactionReduction = await this.benchmarkCompaction(constraints.compactionThresholdRatio);

    // 6. Measure startup latency
    const startupPath = tempDbPath ?? path.join(os.tmpdir(), `kin-startup-qa-${timestamp}.sqlite`);
    let startupLatency: BenchmarkReport['metrics']['startupLatency'];
    try {
      startupLatency = await this.benchmarkStartupLatency(startupPath);
    } finally {
      try {
        if (fs.existsSync(startupPath)) fs.unlinkSync(startupPath);
        if (fs.existsSync(`${startupPath}-wal`)) fs.unlinkSync(`${startupPath}-wal`);
        if (fs.existsSync(`${startupPath}-shm`)) fs.unlinkSync(`${startupPath}-shm`);
      } catch {}
    }

    // Evaluate overall pass status
    const overallPassed =
      sqliteThroughput.passed &&
      contextCompilation.passed &&
      compactionReduction.passed &&
      startupLatency.passed;

    return {
      timestamp,
      detectedSpecs,
      assignedTier,
      constraints,
      metrics: {
        idleMemory,
        sqliteThroughput,
        contextCompilation,
        compactionReduction,
        startupLatency,
      },
      overallPassed,
    };
  }
}
