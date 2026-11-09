// ============================================================================
// KIN DYNAMIC WORKFORCE HIRING SERVICE
// Evaluates, attenuates, and executes runtime coworker hiring proposals.
// Aligned with PRD § 6, § 12 and TRD § 6.
// ============================================================================

import * as crypto from 'node:crypto';
import { KinDatabase } from '../storage/db.js';
import { AgentRepository } from '../domain/agent_repository.js';

export interface HiringProposal {
  displayName: string;
  roleTitle: string;
  systemPrompt: string;
  domainAuthority: string[];
  suggestedModel: string;
  channelIds: string[];
  capabilities: string[];
  parentAgentId?: string;
  isEphemeral?: boolean;
}

export interface HiringExecutionContext {
  agentId?: string;
  runId?: string;
  parentRunId?: string;
  projectId?: string;
  channelId?: string;
  worktreeRoot?: string;
  autonomyMode?: string;
  approvalToken?: string;
}

export class DynamicHiringService {
  private static readonly MAX_DELEGATION_DEPTH = 3;
  private static readonly MAX_PROJECT_SPECIALISTS = 25;
  private static readonly DEFAULT_FALLBACK_MODEL_ID = 'ollama/llama3.2';

  /**
   * Constructs and validates a structured 7-tuple HiringProposal,
   * enforcing capability attenuation and delegation depth limits.
   */
  public static createProposal(
    params: Record<string, any>,
    context: HiringExecutionContext,
    db?: KinDatabase,
    agentRepo?: AgentRepository
  ): HiringProposal {
    const rawName = params.displayName || params.name || params.agentName || params.roleTitle;
    const role = params.roleTitle || params.role || 'Specialist';
    if (!rawName) {
      throw new Error("hireSpecialist requires 'displayName' and 'roleTitle' parameters");
    }

    const cleanName = String(rawName).trim().replace(/\s+/g, '');
    const normalizedName = cleanName.startsWith('@') ? cleanName : `@${cleanName}`;
    const projectId = context.projectId || 'proj-kin';
    const channelId = context.channelId || 'chan-general';
    const candidateParent = params.parentAgentId || context.agentId;

    // 1. Enforce delegation depth limit (max recursion depth = 3)
    if (candidateParent && db) {
      const depth = this.getDelegationDepth(candidateParent, db);
      if (depth >= this.MAX_DELEGATION_DEPTH) {
        throw new Error(
          `Maximum delegation depth reached (limit: ${this.MAX_DELEGATION_DEPTH}). Agent '${candidateParent}' cannot hire further subagents.`
        );
      }
    }

    // 2. Resolve caller model or fallbacks
    const resolvedModel = this.resolveModel(params, context, db, agentRepo);

    // 3. Attenuation: A hired agent cannot possess capabilities exceeding their hiring agent
    const capabilities = this.attenuateCapabilities(params.capabilities, context.agentId, db);

    const domainAuthority = Array.isArray(params.domainAuthority) && params.domainAuthority.length > 0
      ? params.domainAuthority
      : [role];

    const sysPrompt =
      params.systemPrompt ||
      `You are ${normalizedName}, a ${role} specialist in project ${projectId}. Follow the capabilities and project scope provided for this run. Ask when access or authority is unclear.`;

    const channelIds = Array.isArray(params.channelIds) && params.channelIds.length > 0
      ? params.channelIds
      : [channelId];

    return {
      displayName: normalizedName,
      roleTitle: role,
      systemPrompt: sysPrompt,
      domainAuthority,
      suggestedModel: resolvedModel,
      channelIds,
      capabilities,
      parentAgentId: candidateParent,
      isEphemeral: Boolean(params.isEphemeral),
    };
  }

  /**
   * Executes an approved HiringProposal, persisting records into SQLite.
   */
  public static executeHiring(
    proposal: HiringProposal,
    context: HiringExecutionContext,
    db: KinDatabase,
    agentRepo?: AgentRepository
  ): any {
    const projectId = context.projectId || 'proj-kin';
    const now = Date.now();
    const primaryChannelId = proposal.channelIds[0] || context.channelId || 'chan-general';

    // Verify parent agent if present
    let verifiedParentId: string | null = null;
    if (proposal.parentAgentId) {
      const parentRow = db.queryOne<{ id: string }>(
        'SELECT id FROM agent_identities WHERE id = ?',
        proposal.parentAgentId
      );
      if (parentRow) {
        verifiedParentId = proposal.parentAgentId;
      }
    }

    // Check project capacity limit for non-ephemeral specialists
    if (!proposal.isEphemeral) {
      const countRow = db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM agent_identities WHERE project_id = ? AND is_ephemeral = 0',
        projectId
      );
      if (countRow && countRow.count >= this.MAX_PROJECT_SPECIALISTS) {
        throw new Error(`Specialist capacity limit reached for project '${projectId}' (limit: ${this.MAX_PROJECT_SPECIALISTS}).`);
      }
    }

    // Check for existing identity
    const existing = db.queryOne<{
      id: string;
      definition_id: string;
      display_name: string;
      active_model_id: string;
      parent_agent_id: string | null;
    }>(
      `SELECT id, definition_id, display_name, active_model_id, parent_agent_id FROM agent_identities 
       WHERE project_id = ? AND display_name = ? COLLATE NOCASE`,
      projectId,
      proposal.displayName
    );

    let agentId = existing?.id || `agent-${now}-${crypto.randomBytes(3).toString('hex')}`;
    let defId = existing?.definition_id || `def-${now}-${crypto.randomBytes(3).toString('hex')}`;

    if (existing) {
      if (verifiedParentId && !existing.parent_agent_id) {
        db.execute(
          'UPDATE agent_identities SET parent_agent_id = ?, updated_at = ? WHERE id = ?',
          verifiedParentId,
          now,
          agentId
        );
      }
      for (const chId of proposal.channelIds) {
        db.execute(
          `INSERT OR IGNORE INTO channel_members (channel_id, agent_id, joined_at) VALUES (?, ?, ?)`,
          chId,
          agentId,
          now
        );
      }
    } else {
      // Ensure workspace and project records exist
      db.execute(
        `INSERT OR IGNORE INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
         VALUES (?, ?, ?, 'AUTO', ?, ?)`,
        'ws-default',
        'Default Workspace',
        context.worktreeRoot || '.',
        now,
        now
      );
      db.execute(
        `INSERT OR IGNORE INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?)`,
        projectId,
        'ws-default',
        projectId,
        context.worktreeRoot || '.',
        now,
        now
      );

      for (const chId of proposal.channelIds) {
        db.execute(
          `INSERT OR IGNORE INTO channels (id, project_id, name, is_private, created_at)
           VALUES (?, ?, ?, 0, ?)`,
          chId,
          projectId,
          chId.replace(/^chan-/, ''),
          now
        );
      }

      db.execute(
        `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        defId,
        proposal.displayName.replace(/^@/, ''),
        proposal.roleTitle,
        proposal.systemPrompt,
        proposal.suggestedModel,
        JSON.stringify(proposal.domainAuthority),
        JSON.stringify(proposal.capabilities),
        now
      );

      db.execute(
        `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, parent_agent_id, display_name, active_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        agentId,
        'ws-default',
        projectId,
        defId,
        verifiedParentId,
        proposal.displayName,
        proposal.suggestedModel,
        proposal.isEphemeral ? 1 : 0,
        now,
        now
      );

      for (const chId of proposal.channelIds) {
        db.execute(
          `INSERT OR IGNORE INTO channel_members (channel_id, agent_id, joined_at) VALUES (?, ?, ?)`,
          chId,
          agentId,
          now
        );
      }
    }

    return {
      id: agentId,
      agentId,
      name: proposal.displayName.replace(/^@/, ''),
      role: proposal.roleTitle,
      displayName: proposal.displayName,
      activeModelId: proposal.suggestedModel,
      parentAgentId: verifiedParentId || undefined,
      systemPrompt: proposal.systemPrompt,
      status: 'idle',
      isOrchestrator: false,
      projectId,
      assignedChannels: proposal.channelIds,
      isEphemeral: proposal.isEphemeral,
      capabilities: proposal.capabilities,
    };
  }

  /**
   * Cleans up and unenrolls an ephemeral child agent upon completion or termination.
   */
  public static teardownEphemeralAgent(agentId: string, db: KinDatabase): boolean {
    const identity = db.queryOne<{ id: string; is_ephemeral: number }>(
      'SELECT id, is_ephemeral FROM agent_identities WHERE id = ?',
      agentId
    );
    if (!identity || identity.is_ephemeral !== 1) {
      return false;
    }

    db.execute('DELETE FROM channel_members WHERE agent_id = ?', agentId);
    db.execute('DELETE FROM agent_identities WHERE id = ?', agentId);
    return true;
  }

  public static getDelegationDepth(agentId: string, db: KinDatabase): number {
    let depth = 0;
    let current: string | null = agentId;
    while (current && depth < 10) {
      const row: { parent_agent_id: string | null } | undefined = db.queryOne<{ parent_agent_id: string | null }>(
        'SELECT parent_agent_id FROM agent_identities WHERE id = ?',
        current
      );
      if (row && row.parent_agent_id) {
        depth++;
        current = row.parent_agent_id;
      } else {
        break;
      }
    }
    return depth;
  }

  public static attenuateCapabilities(
    requested: string[] | undefined,
    callerAgentId: string | undefined,
    db?: KinDatabase
  ): string[] {
    let callerCaps: string[] = ['*'];
    if (callerAgentId && db) {
      const callerRow = db.queryOne<{ capabilities_json: string; is_orchestrator: number }>(
        `SELECT d.capabilities_json, i.is_orchestrator 
         FROM agent_identities i 
         JOIN agent_definitions d ON i.definition_id = d.id 
         WHERE i.id = ?`,
        callerAgentId
      );
      if (callerRow && !callerRow.is_orchestrator) {
        try {
          callerCaps = JSON.parse(callerRow.capabilities_json || '[]');
        } catch {
          callerCaps = [];
        }
      }
    }

    const defaultCaps = ['fs:read', 'fs:write', 'shell:exec', 'agent:hire', 'agent:delegate', 'mcp:call'];
    const requestedCaps: string[] = Array.isArray(requested) && requested.length > 0
      ? requested
      : defaultCaps;

    const hasWildcard = callerCaps.includes('*');
    let capabilities = requestedCaps.filter((cap) => hasWildcard || (cap !== '*' && callerCaps.includes(cap)));
    if (capabilities.length === 0 && !hasWildcard) {
      if (callerCaps.includes('fs:read')) capabilities.push('fs:read');
    }
    return capabilities;
  }

  private static resolveModel(
    params: Record<string, any>,
    context: HiringExecutionContext,
    db?: KinDatabase,
    agentRepo?: AgentRepository
  ): string {
    let callerModelId: string | undefined;
    if (context.agentId && db) {
      const caller = db.queryOne<{ active_model_id: string }>(
        'SELECT active_model_id FROM agent_identities WHERE id = ?',
        context.agentId
      );
      if (caller?.active_model_id) callerModelId = caller.active_model_id;
    }

    return (
      params.suggestedModel ||
      params.activeModelId ||
      params.modelId ||
      callerModelId ||
      process.env.KIN_DEFAULT_MODEL ||
      this.DEFAULT_FALLBACK_MODEL_ID
    );
  }
}
