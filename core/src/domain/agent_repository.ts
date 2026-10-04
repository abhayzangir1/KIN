import { KinDatabase } from '../storage/db.js';
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

    let domainAuthority: string[] = [];
    let capabilities: string[] = [];
    try {
      domainAuthority = JSON.parse(row.domain_authority_json || '[]');
    } catch {
      domainAuthority = [];
    }
    try {
      capabilities = JSON.parse(row.capabilities_json || '[]');
    } catch {
      capabilities = [];
    }

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
    this.db.execute(
      `INSERT INTO agent_identities (id, workspace_id, project_id, definition_id, display_name, avatar_url, active_model_id, fallback_model_id, is_orchestrator, is_ephemeral, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      identity.id,
      identity.workspaceId,
      identity.projectId ?? null,
      identity.definitionId,
      identity.displayName,
      identity.avatarUrl ?? null,
      identity.activeModelId,
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
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM agent_identities WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id ?? undefined,
      definitionId: row.definition_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      activeModelId: row.active_model_id,
      fallbackModelId: row.fallback_model_id ?? undefined,
      isOrchestrator: row.is_orchestrator === 1,
      isEphemeral: row.is_ephemeral === 1,
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
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT * FROM agent_identities 
       WHERE (project_id = ? OR (id = 'agent-boss' AND is_orchestrator = 1))
         AND (display_name = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE)
       LIMIT 1`,
      projectId,
      displayName,
      normalizedName,
      rawName
    );

    if (!row) return undefined;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id ?? undefined,
      definitionId: row.definition_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      activeModelId: row.active_model_id,
      fallbackModelId: row.fallback_model_id ?? undefined,
      isOrchestrator: row.is_orchestrator === 1,
      isEphemeral: row.is_ephemeral === 1,
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
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM agent_identities WHERE workspace_id = ? ORDER BY is_orchestrator DESC, created_at ASC', workspaceId);

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id ?? undefined,
      definitionId: row.definition_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      activeModelId: row.active_model_id,
      fallbackModelId: row.fallback_model_id ?? undefined,
      isOrchestrator: row.is_orchestrator === 1,
      isEphemeral: row.is_ephemeral === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public listIdentitiesByProject(projectId: string): AgentIdentity[] {
    const rows = this.db.query<{
      id: string;
      workspace_id: string;
      project_id: string | null;
      definition_id: string;
      display_name: string;
      avatar_url: string | null;
      active_model_id: string;
      fallback_model_id: string | null;
      is_orchestrator: number;
      is_ephemeral: number;
      created_at: number;
      updated_at: number;
    }>(
      `SELECT * FROM agent_identities 
       WHERE project_id = ? OR (id = 'agent-boss' AND is_orchestrator = 1)
       ORDER BY is_orchestrator DESC, created_at ASC`,
      projectId
    );

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id ?? undefined,
      definitionId: row.definition_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      activeModelId: row.active_model_id,
      fallbackModelId: row.fallback_model_id ?? undefined,
      isOrchestrator: row.is_orchestrator === 1,
      isEphemeral: row.is_ephemeral === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
