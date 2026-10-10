// ============================================================================
// KIN RUNNER ADAPTER ENGINE
// Decoupled execution runner interface and registry.
// KIN retains authoritative ownership of identity, memory, approvals,
// and state, dispatching runs through typed RunnerAdapter instances.
// ============================================================================

import { AgentLoopOptions, AgentLoopResult, AgentLoopRunner } from './agent_loop.js';
import { RunnerAdapter, RunnerAdapterInfo } from '../domain/types.js';

export interface TypedRunnerAdapter extends RunnerAdapter {
  execute(options: AgentLoopOptions): Promise<AgentLoopResult>;
}

export class RunnerAdapterRegistry {
  private static adapters: Map<string, TypedRunnerAdapter> = new Map();
  private static defaultAdapterId: string = 'native-react';

  public static register(adapter: TypedRunnerAdapter, setAsDefault: boolean = false): void {
    this.adapters.set(adapter.id, adapter);
    if (setAsDefault || this.adapters.size === 1) {
      this.defaultAdapterId = adapter.id;
    }
  }

  public static get(id: string): TypedRunnerAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Runner adapter '${id}' is not registered`);
    }
    return adapter;
  }

  public static getDefault(): TypedRunnerAdapter {
    const adapter = this.adapters.get(this.defaultAdapterId);
    if (!adapter) {
      const first = Array.from(this.adapters.values())[0];
      if (!first) {
        throw new Error('No runner adapters are registered in RunnerAdapterRegistry');
      }
      return first;
    }
    return adapter;
  }

  public static setDefault(id: string): void {
    if (!this.adapters.has(id)) {
      throw new Error(`Cannot set default runner adapter: '${id}' is not registered`);
    }
    this.defaultAdapterId = id;
  }

  public static list(): RunnerAdapterInfo[] {
    return Array.from(this.adapters.values()).map((a) => ({
      id: a.id,
      name: a.name,
      version: a.version,
    }));
  }

  public static clear(): void {
    this.adapters.clear();
    this.defaultAdapterId = 'native-react';
  }
}

export class NativeReActRunnerAdapter implements TypedRunnerAdapter {
  public readonly id = 'native-react';
  public readonly name = 'KIN Native ReAct Execution Loop';
  public readonly version = '1.0.0';

  private runner: AgentLoopRunner;

  constructor(runner: AgentLoopRunner) {
    this.runner = runner;
  }

  public async execute(options: AgentLoopOptions): Promise<AgentLoopResult> {
    return await this.runner.execute(options);
  }
}
