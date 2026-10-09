// ============================================================================
// KIN POLICY & APPROVAL ENGINE
// Capability attenuation, scoped action leases, and risk-tiered autonomy checks.
// ============================================================================

import { AutonomyMode, RiskLevel } from '../domain/types.js';

export interface ActionEvaluationRequest {
  agentId: string;
  parentRunId?: string;
  toolName: string;
  commandOrPath?: string;
  riskLevel: RiskLevel;
  autonomyMode: AutonomyMode;
  agentCapabilities: string[];
  parentCapabilities?: string[];
  subagentApprovedWhitelist?: {
    permittedPaths?: string[];
    permittedCommands?: string[];
  };
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  requiresInteractiveApproval: boolean;
  reason: string;
}

export class PolicyEngine {
  /**
   * Convenience evaluation method supporting partial context and tool parameters.
   */
  public evaluate(request: {
    toolName: string;
    params?: Record<string, any>;
    autonomyMode?: AutonomyMode;
    agentId?: string;
    agentCapabilities?: string[];
    riskLevel?: RiskLevel;
    parentRunId?: string;
    parentCapabilities?: string[];
  }): { allowed: boolean; requiresApproval: boolean; reason: string } {
    const riskLevel = request.riskLevel || (request.toolName === 'executeShell' && request.params?.command?.includes('rm -rf') ? 'CRITICAL' : 'LOW');
    const res = this.evaluateAction({
      agentId: request.agentId || 'default',
      toolName: request.toolName,
      commandOrPath: request.params?.command || request.params?.path,
      riskLevel,
      autonomyMode: request.autonomyMode || 'AUTO',
      agentCapabilities: request.agentCapabilities || ['*'],
      parentRunId: request.parentRunId,
      parentCapabilities: request.parentCapabilities,
    });
    return {
      allowed: res.allowed,
      requiresApproval: res.requiresInteractiveApproval,
      reason: res.reason,
    };
  }

  /**
   * Evaluates an agent action against capability attenuation and autonomy mode.
   */
  public evaluateAction(request: ActionEvaluationRequest): PolicyEvaluationResult {
    // 1. Role-Based Baseline & Interactive Escalation Check
    // If agent is a subagent (has parentRunId), baseline capabilities are permitted.
    // If an action requires capabilities exceeding parent/baseline, prompt for interactive operator approval.
    if (request.parentRunId && request.parentCapabilities) {
      const parentHasCapability = request.agentCapabilities.every((cap) =>
        request.parentCapabilities!.includes(cap) || request.parentCapabilities!.includes('*')
      );

      if (!parentHasCapability) {
        return {
          allowed: false,
          requiresInteractiveApproval: true,
          reason: `Monotonic capability attenuation violated: Capability elevation requested: Subagent requires capabilities beyond parent baseline, prompting for interactive operator approval.`,
        };
      }
    }

    // 2. Pre-Authorized Subagent Whitelist Check
    // If the parent's approved implementation plan explicitly pre-whitelisted this command or path,
    // execute without an interactive interruption
    if (request.parentRunId && request.subagentApprovedWhitelist && request.commandOrPath) {
      const cmdOrPath = request.commandOrPath.toLowerCase();

      const isWhitelistedCommand = request.subagentApprovedWhitelist.permittedCommands?.some((cmd) =>
        cmdOrPath.includes(cmd.toLowerCase())
      );

      const isWhitelistedPath = request.subagentApprovedWhitelist.permittedPaths?.some((p) =>
        cmdOrPath.includes(p.toLowerCase())
      );

      if (isWhitelistedCommand || isWhitelistedPath) {
        return {
          allowed: true,
          requiresInteractiveApproval: false,
          reason: `Action pre-authorized by parent's approved implementation plan scope.`,
        };
      }
    }

    // 3. Autonomy Mode Evaluation
    switch (request.autonomyMode) {
      case 'FULL_ACCESS':
        // Zero-trust boundary: CRITICAL risk actions (financial payments, destructive commands)
        // require explicit interactive human approval even under FULL_ACCESS mode
        if (request.riskLevel === 'CRITICAL') {
          return {
            allowed: true,
            requiresInteractiveApproval: true,
            reason: `Zero-trust boundary: CRITICAL operation (${request.toolName}) requires interactive human approval even under FULL_ACCESS mode.`,
          };
        }
        return {
          allowed: true,
          requiresInteractiveApproval: false,
          reason: `Auto-approved under FULL_ACCESS mode within granted capability envelope.`,
        };

      case 'ALWAYS_ASK':
        // Prompt for any state mutation (MEDIUM, HIGH, CRITICAL)
        if (request.riskLevel === 'LOW') {
          return {
            allowed: true,
            requiresInteractiveApproval: false,
            reason: `Read-only action auto-approved.`,
          };
        }
        return {
          allowed: true,
          requiresInteractiveApproval: true,
          reason: `Consequential action requires user approval under ALWAYS_ASK mode.`,
        };

      case 'AUTO':
      default:
        // AUTO mode: Auto-approves safe/reversible actions in the worktree jail (LOW and MEDIUM).
        // Any HIGH/CRITICAL action (rm -rf, package install, dropping tables, network calls) MUST escalate.
        if (request.riskLevel === 'HIGH' || request.riskLevel === 'CRITICAL') {
          return {
            allowed: true,
            requiresInteractiveApproval: true,
            reason: `High-risk/irreversible operation (${request.toolName}) triggers mandatory human approval gate under AUTO mode.`,
          };
        }
        return {
          allowed: true,
          requiresInteractiveApproval: false,
          reason: `Safe and reversible worktree operation auto-approved under AUTO mode.`,
        };
    }
  }
}
