import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface WorkspaceTrustRecord {
  repoRoot: string;
  configHash: string;
  trustedAt: number;
  trustedBy: string;
  files: string[];
}

export interface WorkspaceTrustStatus {
  repoRoot: string;
  trusted: boolean;
  hasConfigs: boolean;
  configHash: string;
  files: string[];
  trustedAt?: number;
  trustedBy?: string;
  reason?: string;
}

const STATIC_TRUST_CANDIDATES = [
  '.kin/hooks.json',
  '.kin/mcp.json',
  '.kin/mcp_servers.json',
  'mcp.json',
  '.kin-plugin/plugin.json',
  '.claude-plugin/plugin.json',
];

const EXECUTABLE_SKILL_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.md', '.json']);

/**
 * Manages SHA-256 Workspace Trust verification for repository-local executable configs
 * (.kin/hooks.json, .kin/mcp.json, .kin/skills/*, .kin-plugin/plugin.json).
 * Quarantines repo-local configs until explicitly trusted by the operator, and
 * automatically re-quarantines if any tracked config file changes.
 */
export class WorkspaceTrustManager {
  private static instance: WorkspaceTrustManager;
  private storePath: string;
  private enforceInTests = false;

  private constructor(storePath?: string) {
    const baseDir = storePath
      ? path.dirname(storePath)
      : (process.env.KIN_DATA_DIR || path.join(os.homedir(), '.kin'));
    this.storePath = storePath || path.join(baseDir, 'trusted_workspaces.json');
  }

  public static getInstance(): WorkspaceTrustManager {
    if (!WorkspaceTrustManager.instance) {
      WorkspaceTrustManager.instance = new WorkspaceTrustManager();
    }
    return WorkspaceTrustManager.instance;
  }

  /** Allows tests to override the trust store path for isolated verification. */
  public setStorePath(storePath: string): void {
    this.storePath = path.resolve(storePath);
  }

  /** Enables strict quarantine enforcement during Vitest runs for security tests. */
  public setEnforceInTests(enforce: boolean): void {
    this.enforceInTests = enforce;
  }

  private collectRepoConfigFiles(repoRoot: string): string[] {
    const root = path.resolve(repoRoot);
    const found: string[] = [];

    for (const rel of STATIC_TRUST_CANDIDATES) {
      const full = path.join(root, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        found.push(rel.replace(/\\/g, '/'));
      }
    }

    const skillsDir = path.join(root, '.kin', 'skills');
    if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
      const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (EXECUTABLE_SKILL_EXTENSIONS.has(ext)) {
              found.push(path.relative(root, full).replace(/\\/g, '/'));
            }
          }
        }
      };
      walk(skillsDir);
    }

    return Array.from(new Set(found)).sort();
  }

  public computeConfigHash(repoRoot: string): { configHash: string; files: string[] } {
    const root = path.resolve(repoRoot);
    const files = this.collectRepoConfigFiles(root);
    const hash = crypto.createHash('sha256');
    for (const rel of files) {
      const full = path.join(root, rel);
      hash.update(rel);
      hash.update('\0');
      try {
        hash.update(fs.readFileSync(full));
      } catch {
        hash.update('');
      }
      hash.update('\0');
    }
    return {
      configHash: hash.digest('hex'),
      files,
    };
  }

  private readStore(): Record<string, WorkspaceTrustRecord> {
    try {
      if (!fs.existsSync(this.storePath)) return {};
      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeStore(records: Record<string, WorkspaceTrustRecord>): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${this.storePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
    fs.renameSync(tmp, this.storePath);
  }

  public getTrustStatus(repoRoot: string): WorkspaceTrustStatus {
    const root = path.resolve(repoRoot);
    const { configHash, files } = this.computeConfigHash(root);
    if (files.length === 0) {
      return {
        repoRoot: root,
        trusted: true,
        hasConfigs: false,
        configHash,
        files: [],
      };
    }

    const records = this.readStore();
    const record = records[root];
    if (!record) {
      return {
        repoRoot: root,
        trusted: false,
        hasConfigs: true,
        configHash,
        files,
        reason: `Workspace '${root}' contains untrusted repository configs (${files.join(', ')}).`,
      };
    }

    if (record.configHash !== configHash) {
      return {
        repoRoot: root,
        trusted: false,
        hasConfigs: true,
        configHash,
        files,
        reason: `Workspace config hash changed since last approval (${record.configHash.slice(0, 12)} -> ${configHash.slice(0, 12)}). Re-approval required.`,
      };
    }

    return {
      repoRoot: root,
      trusted: true,
      hasConfigs: true,
      configHash,
      files,
      trustedAt: record.trustedAt,
      trustedBy: record.trustedBy,
    };
  }

  public isTrusted(repoRoot: string): boolean {
    if (process.env.VITEST === 'true' && !this.enforceInTests) {
      return true;
    }
    return this.getTrustStatus(repoRoot).trusted;
  }

  public trustWorkspace(repoRoot: string, trustedBy: string = 'operator'): WorkspaceTrustStatus {
    const root = path.resolve(repoRoot);
    const { configHash, files } = this.computeConfigHash(root);
    const records = this.readStore();
    records[root] = {
      repoRoot: root,
      configHash,
      trustedAt: Date.now(),
      trustedBy,
      files,
    };
    this.writeStore(records);
    return this.getTrustStatus(root);
  }

  public revokeTrust(repoRoot: string): WorkspaceTrustStatus {
    const root = path.resolve(repoRoot);
    const records = this.readStore();
    delete records[root];
    this.writeStore(records);
    return this.getTrustStatus(root);
  }
}
