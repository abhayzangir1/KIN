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

  public listChannels(projectId: string): Channel[] {
    const rows = this.db.query<{
      id: string;
      project_id: string;
      name: string;
      topic: string | null;
      is_private: number;
      created_at: number;
    }>('SELECT * FROM channels WHERE project_id = ? ORDER BY created_at ASC', projectId);

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      topic: r.topic ?? undefined,
      isPrivate: r.is_private === 1,
      createdAt: r.created_at,
    }));
  }
}
