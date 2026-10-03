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
   * Evaluates an agent action against capability attenuation and autonomy mode.
   */
  public evaluateAction(request: ActionEvaluationRequest): PolicyEvaluationResult {
    // 1. Monotonic Capability Attenuation Check
    // If agent is a subagent (has parentRunId), its capabilities cannot exceed parent capabilities
    if (request.parentRunId && request.parentCapabilities) {
      const parentHasCapability = request.agentCapabilities.every((cap) =>
        request.parentCapabilities!.includes(cap)
      );

      if (!parentHasCapability) {
        return {
          allowed: false,
          requiresInteractiveApproval: false,
          reason: `SECURITY DENIAL: Monotonic capability attenuation violated. Subagent cannot hold capabilities exceeding its parent.`,
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
