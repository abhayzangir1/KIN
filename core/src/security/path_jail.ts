import * as fs from 'node:fs';
import * as path from 'node:path';

export function normalizeFsPath(p: string): string {
  const resolved = path.resolve(p).replace(/\\/g, '/');
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(resolved)) {
    return resolved[0].toLowerCase() + resolved.slice(1);
  }
  return resolved;
}

function resolveCanonicalForJail(p: string): string {
  const abs = path.resolve(p);
  if (fs.existsSync(abs)) {
    try {
      return normalizeFsPath(fs.realpathSync(abs));
    } catch {}
  }
  return normalizeFsPath(abs);
}

export function isSameFsPath(a: string, b: string): boolean {
  const normA = normalizeFsPath(a);
  const normB = normalizeFsPath(b);
  return process.platform === 'win32' ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

export function isPathWithinRoot(target: string, root: string): boolean {
  const normTarget = resolveCanonicalForJail(target);
  const normRoot = resolveCanonicalForJail(root);
  const cmpTarget = process.platform === 'win32' ? normTarget.toLowerCase() : normTarget;
  const cmpRoot = process.platform === 'win32' ? normRoot.toLowerCase() : normRoot;
  if (cmpTarget === cmpRoot) return true;
  const prefix = cmpRoot.endsWith('/') ? cmpRoot : `${cmpRoot}/`;
  return cmpTarget.startsWith(prefix);
}

export function isSensitivePattern(rawPath: string, baseName?: string): boolean {
  const p = rawPath.replace(/\\/g, '/').toLowerCase();
  const base = (baseName ?? path.posix.basename(p)).toLowerCase();
  return (
    base === 'ipc_auth.token' ||
    base === 'vault.key' ||
    base === '.env' ||
    base.startsWith('.env.') ||
    base.endsWith('.env') ||
    base === '.npmrc' ||
    base === '.pypirc' ||
    base === 'id_rsa' ||
    base === 'id_ed25519' ||
    base === 'id_ecdsa' ||
    base === 'id_dsa' ||
    base === 'kin_storage.sqlite' ||
    base === 'kin_storage.sqlite-wal' ||
    base === 'kin_storage.sqlite-shm' ||
    base.endsWith('.sqlite') ||
    base.endsWith('.sqlite3') ||
    base.endsWith('.sqlite-wal') ||
    base.endsWith('.sqlite-shm') ||
    p.includes('/.git/') ||
    p.startsWith('.git/') ||
    p.endsWith('/.git') ||
    p === '.git' ||
    p.includes('/.ssh/') ||
    p.startsWith('.ssh/') ||
    p.endsWith('/.ssh') ||
    p === '.ssh' ||
    p.includes('/.aws/') ||
    p.startsWith('.aws/') ||
    p.endsWith('/.aws') ||
    p === '.aws' ||
    ((p.startsWith('.kin/') || p.includes('/.kin/')) && !p.includes('/.kin/worktrees/'))
  );
}
