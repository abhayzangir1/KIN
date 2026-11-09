// ============================================================================
// KIN RUN STATE MACHINE — 13-STATE DURABLE LIFECYCLE
// Authoritative lifecycle state machine aligned with PRD § 6 and TRD § 8.
// ============================================================================

import { RunState } from '../domain/types.js';

export type AuthoritativeRunState =
  | 'created'
  | 'queued'
  | 'running'
  | 'paused_approval'
  | 'paused_rate_limit'
  | 'paused_user'
  | 'resuming'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'quota_paused'
  | 'interrupted';

export class StateTransitionError extends Error {
  public readonly fromState: string;
  public readonly toState: string;

  constructor(message: string, fromState: string, toState: string) {
    super(message);
    this.name = 'StateTransitionError';
    this.fromState = fromState;
    this.toState = toState;
    Object.setPrototypeOf(this, StateTransitionError.prototype);
  }
}

export const RUN_STATE_TRANSITIONS: Record<string, string[]> = {
  created: ['queued', 'running', 'cancelling', 'cancelled'],
  queued: ['running', 'cancelling', 'cancelled'],
  running: [
    'paused_approval',
    'paused_rate_limit',
    'paused_user',
    'quota_paused',
    'interrupted',
    'cancelling',
    'cancelled',
    'completed',
    'failed',
    'waiting_for_tool',
    'waiting_for_approval',
    'waiting_for_agent',
    'waiting_for_model',
    'paused',
  ],
  paused_approval: ['resuming', 'running', 'cancelling', 'cancelled', 'failed'],
  paused_rate_limit: ['resuming', 'running', 'cancelling', 'cancelled', 'failed'],
  paused_user: ['resuming', 'running', 'cancelling', 'cancelled'],
  quota_paused: ['resuming', 'running', 'cancelling', 'cancelled', 'failed'],
  interrupted: ['resuming', 'running', 'cancelling', 'cancelled'],
  resuming: ['running', 'cancelling', 'cancelled', 'failed'],
  cancelling: ['cancelled', 'failed'],
  cancelled: [],
  completed: [],
  failed: [],

  // Backward-compatible transitions for legacy aliases
  waiting_for_tool: ['running', 'cancelling', 'cancelled', 'failed'],
  waiting_for_approval: ['resuming', 'running', 'cancelling', 'cancelled', 'failed'],
  waiting_for_agent: ['running', 'cancelling', 'cancelled', 'failed'],
  waiting_for_model: ['running', 'cancelling', 'cancelled', 'failed'],
  recovering: ['running', 'cancelling', 'cancelled', 'failed'],
  paused: ['resuming', 'running', 'cancelling', 'cancelled'],
};

export class RunStateMachine {
  /**
   * Normalizes legacy state strings to authoritative canonical states.
   */
  public static normalizeRunState(state: string): AuthoritativeRunState {
    switch (state) {
      case 'waiting_for_approval':
        return 'paused_approval';
      case 'paused':
        return 'paused_user';
      case 'recovering':
        return 'resuming';
      case 'quota_paused':
        return 'paused_rate_limit';
      case 'waiting_for_tool':
      case 'waiting_for_agent':
      case 'waiting_for_model':
        return 'running';
      default:
        return state as AuthoritativeRunState;
    }
  }

  /**
   * Returns true if the state is terminal (cannot transition further).
   */
  public static isTerminal(state: RunState | string): boolean {
    return state === 'completed' || state === 'failed' || state === 'cancelled';
  }

  /**
   * Returns valid transitions available from the given state.
   */
  public static getAvailableTransitions(state: RunState | string): string[] {
    return RUN_STATE_TRANSITIONS[state] ? [...RUN_STATE_TRANSITIONS[state]] : [];
  }

  /**
   * Checks if transition from `fromState` to `toState` is permitted.
   */
  public static isValidTransition(fromState: RunState | string, toState: RunState | string): boolean {
    if (fromState === toState) return true; // Idempotent self-transition
    if (this.isTerminal(fromState)) return false;

    const allowed = RUN_STATE_TRANSITIONS[fromState];
    if (allowed && allowed.includes(toState)) {
      return true;
    }

    // Check with normalized forms for alias tolerance
    const normFrom = this.normalizeRunState(fromState);
    const normTo = this.normalizeRunState(toState);
    if (normFrom === normTo) return true;

    const normAllowed = RUN_STATE_TRANSITIONS[normFrom];
    if (normAllowed && (normAllowed.includes(normTo) || normAllowed.includes(toState))) {
      return true;
    }

    if (allowed && allowed.includes(normTo)) {
      return true;
    }

    return false;
  }

  /**
   * Validates transition and throws StateTransitionError if invalid.
   */
  public static validateTransition(fromState: RunState | string, toState: RunState | string): void {
    if (fromState === toState) {
      return; // Idempotent
    }

    if (this.isTerminal(fromState)) {
      throw new StateTransitionError(
        `Cannot transition run from terminal state '${fromState}' to '${toState}'.`,
        fromState,
        toState
      );
    }

    if (!this.isValidTransition(fromState, toState)) {
      const allowed = this.getAvailableTransitions(fromState);
      throw new StateTransitionError(
        `Invalid run state transition from '${fromState}' to '${toState}'. Allowed transitions are: [${allowed.join(', ')}].`,
        fromState,
        toState
      );
    }
  }
}
