import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkspaceTrustManager } from '../policy/workspace_trust.js';
import { HookRegistry } from '../policy/hook_registry.js';
import { SkillEngine } from './skill_engine.js';
import { McpClientManager } from '../execution/mcp_client.js';

export interface KinPluginManifest {
  name: string;
  version?: string;
  description?: string;
  skills?: string | string[];
  mcpServers?: Record<string, any>;
  mcpConfig?: string;
  hooks?: string;
}

export interface LoadedPluginRecord {
  name: string;
  version: string;
  description?: string;
  pluginRoot: string;
  manifestPath: string;
  skillsLoaded: number;
  mcpServersRegistered: number;
  hooksConfigured: boolean;
  quarantined: boolean;
  reason?: string;
}

/**
 * Thin plugin manager parsing .kin-plugin/plugin.json and .claude-plugin/plugin.json
 * bundles into skills, MCP servers, and hooks, gated by Workspace Trust.
 */
export class PluginManager {
  private static instance: PluginManager;
  private loadedPlugins: Map<string, LoadedPluginRecord> = new Map();

  private constructor() {}

  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  public listLoadedPlugins(): LoadedPluginRecord[] {
    return Array.from(this.loadedPlugins.values());
  }

  public findPluginManifest(pluginRoot: string): string | null {
    const absRoot = path.resolve(pluginRoot);
    const candidates = [
      path.join(absRoot, '.kin-plugin', 'plugin.json'),
      path.join(absRoot, '.claude-plugin', 'plugin.json'),
      path.join(absRoot, 'plugin.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return c;
      }
    }
    return null;
  }

  public async loadPluginFromRepo(
    repoRoot: string,
    deps: {
      skillEngine?: SkillEngine;
      mcpClient?: McpClientManager;
    } = {}
  ): Promise<LoadedPluginRecord | null> {
    const absRoot = path.resolve(repoRoot);
    const manifestPath = this.findPluginManifest(absRoot);
    if (!manifestPath) return null;

    let manifest: KinPluginManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as KinPluginManifest;
    } catch (err: any) {
      throw new Error(`Invalid plugin manifest '${manifestPath}': ${err.message}`);
    }

    const pluginName = manifest.name || path.basename(absRoot);
    const trust = WorkspaceTrustManager.getInstance();
    if (!trust.isTrusted(absRoot)) {
      const status = trust.getTrustStatus(absRoot);
      const record: LoadedPluginRecord = {
        name: pluginName,
        version: manifest.version || '1.0.0',
        description: manifest.description,
        pluginRoot: absRoot,
        manifestPath,
        skillsLoaded: 0,
        mcpServersRegistered: 0,
        hooksConfigured: false,
        quarantined: true,
        reason: status.reason || 'Workspace Trust approval required before loading plugin.',
      };
      this.loadedPlugins.set(absRoot, record);
      return record;
    }

    let skillsLoaded = 0;
    if (deps.skillEngine) {
      const skillDirs = Array.isArray(manifest.skills)
        ? manifest.skills
        : (typeof manifest.skills === 'string' ? [manifest.skills] : ['skills', '.kin/skills']);

      for (const rel of skillDirs) {
        const fullSkillDir = path.resolve(absRoot, rel);
        if (fs.existsSync(fullSkillDir)) {
          const res = deps.skillEngine.loadSkillsFromDirectory(fullSkillDir);
          skillsLoaded += res.loadedCount;
        }
      }
    }

    let mcpServersRegistered = 0;
    if (deps.mcpClient) {
      const serversToRegister: Record<string, any> = { ...(manifest.mcpServers || {}) };
      if (manifest.mcpConfig) {
        const mcpPath = path.resolve(absRoot, manifest.mcpConfig);
        if (fs.existsSync(mcpPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
            Object.assign(serversToRegister, parsed.mcpServers || parsed.servers || {});
          } catch {
            // Ignore malformed nested mcpConfig
          }
        }
      }
      for (const [srvName, conf] of Object.entries(serversToRegister)) {
        if (conf && (conf.command || conf.url)) {
          await deps.mcpClient.startServer({
            name: srvName,
            command: conf.command,
            args: conf.args || [],
            env: conf.env || {},
            url: conf.url,
            transport: conf.transport || (conf.url ? 'http' : 'stdio'),
          }, absRoot);
          mcpServersRegistered += 1;
        }
      }
    }

    let hooksConfigured = fs.existsSync(path.join(absRoot, '.kin', 'hooks.json'));
    if (manifest.hooks) {
      const customHooksPath = path.resolve(absRoot, manifest.hooks);
      if (fs.existsSync(customHooksPath)) {
        HookRegistry.getInstance().registerPluginHooksFile(absRoot, customHooksPath);
        hooksConfigured = true;
      }
    }

    const record: LoadedPluginRecord = {
      name: pluginName,
      version: manifest.version || '1.0.0',
      description: manifest.description,
      pluginRoot: absRoot,
      manifestPath,
      skillsLoaded,
      mcpServersRegistered,
      hooksConfigured,
      quarantined: false,
    };
    this.loadedPlugins.set(absRoot, record);
    return record;
  }
}
