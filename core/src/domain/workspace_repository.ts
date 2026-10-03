import { KinDatabase } from '../storage/db.js';
import { Workspace, Project, Channel } from './types.js';

export class WorkspaceRepository {
  private db: KinDatabase;

  constructor(db: KinDatabase) {
    this.db = db;
  }

  public createWorkspace(ws: Workspace): void {
    this.db.execute(
      `INSERT INTO workspaces (id, name, root_path, default_autonomy_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ws.id,
      ws.name,
      ws.rootPath,
      ws.defaultAutonomyMode,
      ws.createdAt,
      ws.updatedAt
    );
  }

  public getWorkspace(id: string): Workspace | undefined {
    const row = this.db.queryOne<{
      id: string;
      name: string;
      root_path: string;
      default_autonomy_mode: string;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM workspaces WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      defaultAutonomyMode: row.default_autonomy_mode as Workspace['defaultAutonomyMode'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public createProject(project: Project): void {
    this.db.execute(
      `INSERT INTO projects (id, workspace_id, name, repo_path, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      project.id,
      project.workspaceId,
      project.name,
      project.repoPath,
      JSON.stringify(project.settings),
      project.createdAt,
      project.updatedAt
    );
  }

  public getProject(id: string): Project | undefined {
    const row = this.db.queryOne<{
      id: string;
      workspace_id: string;
      name: string;
      repo_path: string;
      settings_json: string;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM projects WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      repoPath: row.repo_path,
      settings: JSON.parse(row.settings_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public listProjects(workspaceId: string): Project[] {
    const rows = this.db.query<{
      id: string;
      workspace_id: string;
      name: string;
      repo_path: string;
      settings_json: string;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at ASC', workspaceId);

    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      repoPath: r.repo_path,
      settings: JSON.parse(r.settings_json),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public deleteProject(projectId: string): void {
    this.db.execute('DELETE FROM projects WHERE id = ?', projectId);
  }

  public createChannel(channel: Channel): void {
    this.db.execute(
      `INSERT INTO channels (id, project_id, name, topic, is_private, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      channel.id,
      channel.projectId,
      channel.name,
      channel.topic ?? null,
      channel.isPrivate ? 1 : 0,
      channel.createdAt
    );
  }

  public getChannel(id: string): Channel | undefined {
    const row = this.db.queryOne<{
      id: string;
      project_id: string;
      name: string;
      topic: string | null;
      is_private: number;
      created_at: number;
    }>('SELECT * FROM channels WHERE id = ?', id);

    if (!row) return undefined;

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      topic: row.topic ?? undefined,
      isPrivate: row.is_private === 1,
      createdAt: row.created_at,
    };
  }

  public listChannels(projectId: string, includePrivate = false): Channel[] {
    const query = includePrivate
      ? 'SELECT * FROM channels WHERE project_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM channels WHERE project_id = ? AND is_private = 0 ORDER BY created_at ASC';
    const rows = this.db.query<{
      id: string;
      project_id: string;
      name: string;
      topic: string | null;
      is_private: number;
      created_at: number;
    }>(query, projectId);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      topic: r.topic ?? undefined,
      isPrivate: r.is_private === 1,
      createdAt: r.created_at,
    }));
  }

  public addChannelMember(channelId: string, agentId: string): void {
    this.db.execute(
      `INSERT OR IGNORE INTO channel_members (channel_id, agent_id, joined_at)
       VALUES (?, ?, ?)`,
      channelId,
      agentId,
      Date.now()
    );
  }

  public removeChannelMember(channelId: string, agentId: string): void {
    this.db.execute(
      `DELETE FROM channel_members WHERE channel_id = ? AND agent_id = ?`,
      channelId,
      agentId
    );
  }

  public listChannelMemberIds(channelId: string): string[] {
    const rows = this.db.query<{ agent_id: string }>(
      `SELECT agent_id FROM channel_members WHERE channel_id = ? ORDER BY joined_at ASC`,
      channelId
    );
    return rows.map((r) => r.agent_id);
  }

  public listAgentChannelIds(agentId: string): string[] {
    const rows = this.db.query<{ channel_id: string }>(
      `SELECT channel_id FROM channel_members WHERE agent_id = ? ORDER BY joined_at ASC`,
      agentId
    );
    return rows.map((r) => r.channel_id);
  }
}
