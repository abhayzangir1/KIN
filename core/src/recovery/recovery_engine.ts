// ============================================================================
// KIN OBSERVE-ACT-OBSERVE-VERIFY RECOVERY ENGINE
// Structured physical verification loop that checks action outcomes, detects
// state drift, and applies autonomous self-healing recovery strategies.
// ============================================================================

import { SkillEngine } from '../skills/skill_engine.js';

export interface ObservationSnapshot {
  timestamp: number;
  type: 'browser' | 'desktop' | 'filesystem' | 'shell';
  url?: string;
  title?: string;
  windowTitle?: string;
  domSnippet?: string;
  hashOrSignature?: string;
}

export interface RecoveryVerificationSpec {
  expectedUrlPattern?: string;
  expectedTitlePattern?: string;
  expectedTextPattern?: string;
  expectedFileChange?: string;
  disallowedPatterns?: string[];
}

export interface VerificationResult {
  passed: boolean;
  preState: ObservationSnapshot;
  postState: ObservationSnapshot;
  discrepancies: string[];
  suggestedRecoveryStrategy?: 'wait_and_retry' | 'dismiss_modal' | 'keyboard_fallback' | 'alternative_selector' | 'escalate_to_human';
}

function safeTestPattern(pattern: string, text: string): boolean {
  if (!pattern || !text) return false;
  // 1. Literal substring match (avoids regex metacharacter misinterpretation like brackets or query strings)
  if (text.toLowerCase().includes(pattern.toLowerCase())) {
    return true;
  }
  // 2. Regular expression pattern evaluation
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return false;
  }
}

export class RecoveryEngine {
  private skillEngine: SkillEngine;

  constructor(skillEngine: SkillEngine) {
    this.skillEngine = skillEngine;
  }

  /**
   * Compares pre-action and post-action observations against verification expectations.
   */
  public verify(
    preState: ObservationSnapshot,
    postState: ObservationSnapshot,
    spec: RecoveryVerificationSpec
  ): VerificationResult {
    const discrepancies: string[] = [];

    // 1. Verify URL pattern if specified
    if (spec.expectedUrlPattern) {
      if (!postState.url) {
        discrepancies.push(`URL did not match expectation: expected /${spec.expectedUrlPattern}/i, but post-state had no URL`);
      } else if (!safeTestPattern(spec.expectedUrlPattern, postState.url)) {
        discrepancies.push(`URL did not match expectation: expected /${spec.expectedUrlPattern}/i, got '${postState.url}'`);
      }
    }

    // 2. Verify Title pattern if specified
    if (spec.expectedTitlePattern) {
      if (!postState.title) {
        discrepancies.push(`Page title did not match expectation: expected /${spec.expectedTitlePattern}/i, but post-state had no title`);
      } else if (!safeTestPattern(spec.expectedTitlePattern, postState.title)) {
        discrepancies.push(`Page title did not match expectation: expected /${spec.expectedTitlePattern}/i, got '${postState.title}'`);
      }
    }

    // 3. Verify Text pattern if specified
    if (spec.expectedTextPattern) {
      if (!postState.domSnippet) {
        discrepancies.push(`DOM snippet did not contain expected text pattern /${spec.expectedTextPattern}/i (no DOM snippet present)`);
      } else if (!safeTestPattern(spec.expectedTextPattern, postState.domSnippet)) {
        discrepancies.push(`DOM snippet did not contain expected text pattern /${spec.expectedTextPattern}/i`);
      }
    }

    // 4. Verify no disallowed error/modal patterns appeared
    if (spec.disallowedPatterns) {
      const combined = `${postState.title || ''} ${postState.domSnippet || ''} ${postState.windowTitle || ''}`;
      for (const disallowed of spec.disallowedPatterns) {
        if (safeTestPattern(disallowed, combined)) {
          discrepancies.push(`Disallowed pattern /${disallowed}/i detected in outcome.`);
        }
      }
    }

    // 5. Detect state stagnation (action was performed, but state didn't change at all)
    const stateUnchanged =
      preState.url === postState.url &&
      preState.title === postState.title &&
      preState.windowTitle === postState.windowTitle &&
      preState.domSnippet === postState.domSnippet;

    if (discrepancies.length === 0 && stateUnchanged && (spec.expectedUrlPattern || spec.expectedTitlePattern)) {
      discrepancies.push('State stagnation: Action completed but UI/page state showed zero mutation.');
    }

    const passed = discrepancies.length === 0;

    // Suggest adaptive self-healing strategy based on discrepancies & empirical metrics
    let suggestedRecoveryStrategy: VerificationResult['suggestedRecoveryStrategy'] = undefined;
    if (!passed) {
      const allText = discrepancies.join(' ').toLowerCase();
      const candidates: Array<{ strategy: NonNullable<VerificationResult['suggestedRecoveryStrategy']>; baseWeight: number }> = [];

      if (allText.includes('modal') || allText.includes('cookie') || allText.includes('overlay') || allText.includes('banner')) {
        candidates.push({ strategy: 'dismiss_modal', baseWeight: 10 });
      }
      if (allText.includes('stagnation') || allText.includes('did not match') || allText.includes('selector')) {
        candidates.push({ strategy: 'alternative_selector', baseWeight: 8 });
      }
      if (allText.includes('loading') || allText.includes('network') || allText.includes('wait') || allText.includes('timeout')) {
        candidates.push({ strategy: 'wait_and_retry', baseWeight: 7 });
      }
      if (candidates.length === 0 || allText.includes('click') || allText.includes('focus')) {
        candidates.push({ strategy: 'keyboard_fallback', baseWeight: 5 });
      }

      // Check empirical recovery strategy success rates from learning pipeline
      try {
        const metrics = this.skillEngine.getLearningMetrics();
        const stratMap = new Map(metrics.recoveryStrategies.map((s) => [s.strategy, s.successRate]));
        candidates.sort((a, b) => {
          const rateA = stratMap.get(a.strategy) ?? a.baseWeight * 10;
          const rateB = stratMap.get(b.strategy) ?? b.baseWeight * 10;
          return rateB - rateA;
        });
      } catch {}

      suggestedRecoveryStrategy = candidates[0]?.strategy || 'wait_and_retry';
    }

    return {
      passed,
      preState,
      postState,
      discrepancies,
      suggestedRecoveryStrategy,
    };
  }

  /**
   * Records a structured recovery experience into durable SkillEngine.
   */
  public recordRecoveryExperience(params: {
    runId: string;
    actionName: string;
    objective: string;
    outcome: 'success' | 'failure';
    failureReason?: string;
    repairStrategy?: string;
  }): void {
    this.skillEngine.recordExperience({
      runId: params.runId,
      toolName: params.actionName,
      objective: `${params.actionName}: ${params.objective}`,
      outcome: params.outcome,
      failureReason: params.failureReason,
      repairStrategy: params.repairStrategy,
      lessonsLearned:
        params.outcome === 'success'
          ? `Self-healing strategy '${params.repairStrategy}' resolved action fault.`
          : `Recovery strategy failed: ${params.failureReason}`,
    });
  }
}
