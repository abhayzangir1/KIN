// ============================================================================
// KIN STORAGE CONFINEMENT & APPLICATION DATA DIRECTORY RESOLVER
// ============================================================================

import * as path from 'node:path';
import { homedir } from 'node:os';
import * as fs from 'node:fs';

/**
 * Resolves the persistent application data directory for KIN storage and profiles.
 * Respects KIN_DATA_DIR, user application data directory on restricted host installs,
 * and permits local repository storage during development.
 */
export function getDataDirectory(): string {
  // 1. Explicit environment override
  if (process.env.KIN_DATA_DIR && process.env.KIN_DATA_DIR.trim().length > 0) {
    const customDir = path.resolve(process.env.KIN_DATA_DIR.trim());
    if (!fs.existsSync(customDir)) {
      try {
        fs.mkdirSync(customDir, { recursive: true });
      } catch {}
    }
    return customDir;
  }

  // 2. User profile application data directory per host platform (aligned with ProcessSupervisor::resolve_data_dir())
  let baseDir: string;
  const platform = process.platform;
  if (platform === 'win32') {
    baseDir = process.env.APPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : path.join(homedir(), 'AppData', 'Roaming'));
  } else if (platform === 'darwin') {
    baseDir = path.join(homedir(), 'Library', 'Application Support');
  } else {
    // Linux / BSD / Unix
    baseDir = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  }

  const kinDataDir = path.join(baseDir, 'kin');
  if (!fs.existsSync(kinDataDir)) {
    try {
      fs.mkdirSync(kinDataDir, { recursive: true });
    } catch {}
  }

  return kinDataDir;
}
