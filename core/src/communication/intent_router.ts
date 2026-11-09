// ============================================================================
// KIN INTENT ROUTER & CHANNEL BOUNDARY ENFORCER
// Encapsulates intent-first routing and enforces PRD § 6 channel boundaries.
// ============================================================================

import { AgentDefinition, AgentIdentity, Message } from '../domain/types.js';
import {
  ActivationEngine,
  ChannelRoutingInput,
  ChannelRoutingResult,
  SpecialistMatchInfo,
  GreetingClassifier,
} from './activation_engine.js';

export { ChannelRoutingInput, ChannelRoutingResult, SpecialistMatchInfo, GreetingClassifier };

export class IntentRouter {
  private activationEngine: ActivationEngine;

  constructor(activationEngine?: ActivationEngine) {
    this.activationEngine = activationEngine || new ActivationEngine();
  }

  /**
   * Evaluates if a given message is strictly a conversational greeting
   * without any substantive task directives or special recipient requests.
   * Per PRD § 6: Pure greetings route exclusively to @Boss without waking specialists.
   */
  public isPureGreeting(content: string): boolean {
    return this.activationEngine.isPureGreeting(content);
  }

  /**
   * Deterministically routes a channel message to the minimal necessary agent(s).
   * Enforces PRD § 6 channel boundary:
   * - Non-members of a channel CANNOT be activated by channel mentions.
   * - Unassigned project agents mentioned in channels route to @Boss for staffing offer.
   */
  public routeChannelMessage(input: ChannelRoutingInput): ChannelRoutingResult {
    return this.activationEngine.evaluateChannelRouting(input);
  }
}
