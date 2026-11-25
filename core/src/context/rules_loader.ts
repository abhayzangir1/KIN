import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WorkspaceRule {
  filePath: string;
  content: string;
  paths?: string[];
}

export class RulesLoader {
  public static loadRootRules(projectRoot: string): string[] {
    if (!projectRoot || !fs.existsSync(projectRoot)) return [];
    const candidates = ['KIN.md', 'AGENTS.md', 'CLAUDE.md'];
    const loaded: string[] = [];
    for (const name of candidates) {
      const full = path.join(projectRoot, name);
      if (fs.existsSync(full)) {
        try {
          const text = fs.readFileSync(full, 'utf8').trim();
          if (text) loaded.push(`[${name}]\n${text.slice(0, 6000)}`);
        } catch {}
      }
    }
    return loaded;
  }

  public static loadMatchingPathRules(projectRoot: string, touchedPath: string): WorkspaceRule[] {
    if (!projectRoot || !touchedPath) return [];
    const rulesDir = path.join(projectRoot, '.kin', 'rules');
    if (!fs.existsSync(rulesDir)) return [];
    const normTouched = touchedPath.replace(/\\/g, '/').toLowerCase();
    const matched: WorkspaceRule[] = [];
    try {
      for (const entry of fs.readdirSync(rulesDir)) {
        if (!entry.endsWith('.md')) continue;
        const full = path.join(rulesDir, entry);
        const raw = fs.readFileSync(full, 'utf8');
        const fmMatch = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
        if (!fmMatch) continue;
        const yaml = fmMatch[1];
        const body = fmMatch[2].trim();
        let globs: string[] = [];
        const inlineMatch = yaml.match(/paths:\s*\[([^\]]+)\]/i);
        if (inlineMatch) {
          globs = inlineMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
        } else {
          const multilineMatch = yaml.match(/paths:\s*\r?\n((?:\s*-\s+[^\r\n]+(?:\r?\n|$))+)/i);
          if (multilineMatch) {
            globs = multilineMatch[1]
              .split(/\r?\n/)
              .map((line) => line.replace(/^\s*-\s+/, '').trim().replace(/^['"]|['"]$/g, '').toLowerCase())
              .filter(Boolean);
          }
        }
        if (globs.length === 0) continue;
        const hits = globs.some((g) => {
          const escaped = g
            .replace(/[.+^${}()|[\]]/g, '\\$&')
            .replace(/\*\*\//g, '(?:.*/)?')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]');
          try {
            const rx = new RegExp(`(^|/)${escaped}$`, 'i');
            return rx.test(normTouched);
          } catch {
            return false;
          }
        });
        if (hits && body) {
          matched.push({ filePath: full, content: body.slice(0, 3000), paths: globs });
        }
      }
    } catch {}
    return matched;
  }
}
