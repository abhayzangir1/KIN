import { KinDatabase, safeJsonParseArray } from '../storage/db.js';
import { AgentDefinition, AgentIdentity } from './types.js';

export class AgentRepository {
  private db: KinDatabase;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  public createDefinition(def: AgentDefinition): void {
    this.db.execute(
      `INSERT INTO agent_definitions (id, name, role, system_prompt, default_model_id, domain_authority_json, capabilities_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         role = excluded.role,
         system_prompt = excluded.system_prompt,
         default_model_id = excluded.default_model_id,
         domain_authority_json = excluded.domain_authority_json,
         capabilities_json = excluded.capabilities_json`,
      def.id,
      def.name,
      def.role,
      def.systemPrompt,
      def.defaultModelId,
      JSON.stringify(def.domainAuthority),
      JSON.stringify(def.capabilities),
      def.createdAt
    );
  }

  public getDefinition(id: string): AgentDefinition | undefined {
    const row = this.db.queryOne<{
      id: string;
      name: string;
      role: string;
      system_prompt: string;
      default_model_id: string;
      domain_authority_json: string;
      capabilities_json: string;
      created_at: number;
    }>('SELECT * FROM agent_definitions WHERE id = ?', id);

    if (!row) return undefined;

    const domainAuthority = safeJsonParseArray<string>(row.domain_authority_json, []);
    const capabilities = safeJsonParseArray<string>(row.capabilities_json, []);

    return {
      id: row.id,
      name: row.name,
      role: row.role,
      systemPrompt: row.system_prompt,
      defaultModelId: row.default_model_id,
      domainAuthority,
      capabilities,
      createdAt: row.created_at,
    };
  }

  public createIdentity(identity: AgentIdentity): void {
    if (!identity.displayName || typeof identity.displayName !== 'string') {
      throw new Error('Agent displayName must be a non-empty string.');
    }
    const cleanName = identity.displayName.trim();
    if (cleanName.length < 2 || cleanName.length > 64) {
      throw new Error(`Agent displayName '${cleanName}' must be between 2 and 64 characters.`);
    }
    this.db.execute(
      `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, parent_agent_id, display_name, avatar_url, active_model_id, fallback_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      identity.id,
      identity.workspaceId ?? null,
      identity.projectId ?? null,
      identity.definitionId,
      identity.parentAgentId ?? null,
      identity.displayName,
      identity.avatarUrl ?? null,
      identity.activeModelId ?? null,
      identity.fallbackModelId ?? null,
      identity.isOrchestrator ? 1 : 0,
      identity.isEphemeral ? 1 : 0,
      identity.createdAt,
      identity.updatedAt
    );
  }

  public getIdentity(id: string): AgentIdentity | undefined {
    const row = this.db.queryOne<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      definition_id: string;
      parent_agent_id: string | null;
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
      def_role: string | null;
      def_system_prompt: string | null;
      def_capabilities_json: string | null;
    }>(
      `SELECT 
         i.*,
         d.role AS def_role,
         d.system_prompt AS def_system_prompt,
         d.capabilities_json AS def_capabilities_json
       FROM agent_identities i
       LEFT JOIN agent_definitions d ON i.definition_id = d.id
       WHERE i.id = ?`,
      id
    );

    if (!row) return undefined;

    let capabilities: string[] | undefined;
    if (row.def_capabilities_json) {
      capabilities = safeJsonParseArray<string>(row.def_capabilities_json, []);
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id || 'proj-kin',
      definitionId: row.definition_id,
      parentAgentId: row.parent_agent_id ?? undefined,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      activeModelId: row.active_model_id,
      fallbackModelId: row.fallback_model_id ?? undefined,
      isOrchestrator: row.is_orchestrator === 1,
      isEphemeral: row.is_ephemeral === 1,
      roleTitle: row.def_role ?? undefined,
      systemPrompt: row.def_system_prompt ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public getIdentityByProjectAndName(projectId: string, displayName: string): AgentIdentity | undefined {
    const clean = displayName.trim().replace(/\s+/g, '');
    const normalizedName = clean.startsWith('@') ? clean : `@${clean}`;
    const rawName = clean.replace(/^@/, '');
    const row = this.db.queryOne<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      definition_id: string;
      parent_agent_id: string | null;
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
      def_role: string | null;
      def_system_prompt: string | null;
      def_capabilities_json: string | null;
    }>(
      `SELECT 
         i.*,
         d.role AS def_role,
         d.system_prompt AS def_system_prompt,
         d.capabilities_json AS def_capabilities_json
       FROM agent_identities i
       LEFT JOIN agent_definitions d ON i.definition_id = d.id
       WHERE i.project_id = ?
         AND (i.display_name = ? COLLATE NOCASE OR i.display_name = ? COLLATE NOCASE OR i.display_name = ? COLLATE NOCASE)
       LIMIT 1`,
      projectId,
      displayName,
      normalizedName,
      rawName
    );

    if (!row) return undefined;

    let capabilities: string[] | undefined;
    if (row.def_capabilities_json) {
      capabilities = safeJsonParseArray<string>(row.def_capabilities_json, []);
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id || projectId,
      definitionId: row.definition_id,
      parentAgentId: row.parent_agent_id ?? undefined,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      activeModelId: row.active_model_id,
      fallbackModelId: row.fallback_model_id ?? undefined,
      isOrchestrator: row.is_orchestrator === 1,
      isEphemeral: row.is_ephemeral === 1,
      roleTitle: row.def_role ?? undefined,
      systemPrompt: row.def_system_prompt ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Explicit user-driven model assignment for an agent.
   * Autonomous routing is prohibited; only explicit user configuration alters this.
   */
  public updateAgentModelConfig(
    agentId: string,
    activeModelId: string,
    fallbackModelId?: string
  ): void {
    this.db.execute(
      `UPDATE agent_identities
       SET active_model_id = ?, fallback_model_id = ?, updated_at = ?
       WHERE id = ?`,
      activeModelId,
      fallbackModelId ?? null,
      Date.now(),
      agentId
    );
  }

  public listIdentities(workspaceId: string): AgentIdentity[] {
    const rows = this.db.query<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      definition_id: string;
      parent_agent_id: string | null;
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
      def_role: string | null;
      def_system_prompt: string | null;
      def_capabilities_json: string | null;
    }>(
      `SELECT 
         i.*,
         d.role AS def_role,
         d.system_prompt AS def_system_prompt,
         d.capabilities_json AS def_capabilities_json
       FROM agent_identities i
       LEFT JOIN agent_definitions d ON i.definition_id = d.id
       WHERE i.workspace_id = ? 
       ORDER BY i.is_orchestrator DESC, i.created_at ASC`,
      workspaceId
    );

    return rows.map((row) => {
      let capabilities: string[] | undefined;
      if (row.def_capabilities_json) {
        capabilities = safeJsonParseArray<string>(row.def_capabilities_json, []);
      }
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        projectId: row.project_id || 'proj-kin',
        definitionId: row.definition_id,
        parentAgentId: row.parent_agent_id ?? undefined,
        displayName: row.display_name,
        avatarUrl: row.avatar_url ?? undefined,
        activeModelId: row.active_model_id,
        fallbackModelId: row.fallback_model_id ?? undefined,
        isOrchestrator: row.is_orchestrator === 1,
        isEphemeral: row.is_ephemeral === 1,
        roleTitle: row.def_role ?? undefined,
        systemPrompt: row.def_system_prompt ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  public listIdentitiesByProject(projectId: string): AgentIdentity[] {
    const rows = this.db.query<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      definition_id: string;
      parent_agent_id: string | null;
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
      def_role: string | null;
      def_system_prompt: string | null;
      def_capabilities_json: string | null;
    }>(
      `SELECT 
         i.*,
         d.role AS def_role,
         d.system_prompt AS def_system_prompt,
         d.capabilities_json AS def_capabilities_json
       FROM agent_identities i
       LEFT JOIN agent_definitions d ON i.definition_id = d.id
       WHERE i.project_id = ?
       ORDER BY i.is_orchestrator DESC, i.created_at ASC`,
      projectId
    );

    return rows.map((row) => {
      let capabilities: string[] | undefined;
      if (row.def_capabilities_json) {
        capabilities = safeJsonParseArray<string>(row.def_capabilities_json, []);
      }
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        projectId: row.project_id || projectId,
        definitionId: row.definition_id,
        parentAgentId: row.parent_agent_id ?? undefined,
        displayName: row.display_name,
        avatarUrl: row.avatar_url ?? undefined,
        activeModelId: row.active_model_id,
        fallbackModelId: row.fallback_model_id ?? undefined,
        isOrchestrator: row.is_orchestrator === 1,
        isEphemeral: row.is_ephemeral === 1,
        roleTitle: row.def_role ?? undefined,
        systemPrompt: row.def_system_prompt ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  public listSubordinates(parentAgentId: string): AgentIdentity[] {
    const rows = this.db.query<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      definition_id: string;
      parent_agent_id: string | null;
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
      def_role: string | null;
      def_system_prompt: string | null;
      def_capabilities_json: string | null;
    }>(
      `SELECT 
         i.*,
         d.role AS def_role,
         d.system_prompt AS def_system_prompt,
         d.capabilities_json AS def_capabilities_json
       FROM agent_identities i
       LEFT JOIN agent_definitions d ON i.definition_id = d.id
       WHERE i.parent_agent_id = ?
       ORDER BY i.created_at ASC`,
      parentAgentId
    );

    return rows.map((row) => {
      let capabilities: string[] | undefined;
      if (row.def_capabilities_json) {
        capabilities = safeJsonParseArray<string>(row.def_capabilities_json, []);
      }
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        projectId: row.project_id || 'proj-kin',
        definitionId: row.definition_id,
        parentAgentId: row.parent_agent_id ?? undefined,
        displayName: row.display_name,
        avatarUrl: row.avatar_url ?? undefined,
        activeModelId: row.active_model_id,
        fallbackModelId: row.fallback_model_id ?? undefined,
        isOrchestrator: row.is_orchestrator === 1,
        isEphemeral: row.is_ephemeral === 1,
        roleTitle: row.def_role ?? undefined,
        systemPrompt: row.def_system_prompt ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  public ensureProjectBoss(projectId: string, workspaceId: string = 'ws-default'): AgentIdentity {
    const existing = this.listIdentitiesByProject(projectId).find(
      (a) => a.isOrchestrator === true
    );
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const defId = projectId === 'proj-kin' ? 'def-boss' : `def-boss-${projectId}`;
    const agentId = projectId === 'proj-kin' ? 'agent-boss' : `agent-boss-${projectId}`;

    if (!this.getDefinition(defId)) {
      this.createDefinition({
        id: defId,
        name: 'Boss',
        role: 'Workspace Orchestrator',
        systemPrompt: 'You are @Boss, KIN’s workspace orchestrator for this project. Coordinate agents and tools for the current request. Follow the capabilities and project boundaries provided for this run, and ask when access or authority is unclear.',
        defaultModelId: 'ollama/qwen2.5-coder:3b',
        domainAuthority: ['Architecture', 'Orchestration', 'Engineering', 'Operations'],
        capabilities: ['read', 'write', 'shell', 'worktree', 'delegate', 'agent:hire', 'agent:delegate', '*'],
        createdAt: now,
      });
    }

    const bossIdentity: AgentIdentity = {
      id: agentId,
      workspaceId,
      projectId,
      definitionId: defId,
      displayName: '@Boss',
      activeModelId: 'ollama/qwen2.5-coder:3b',
      isOrchestrator: true,
      isEphemeral: false,
      createdAt: now,
      updatedAt: now,
    };

    this.createIdentity(bossIdentity);
    return bossIdentity;
  }
}

