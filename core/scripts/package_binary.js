import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const coreDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(coreDir, '..');
const tauriBinariesDir = path.resolve(rootDir, 'src-tauri', 'binaries');
const coreBinariesDir = path.resolve(coreDir, 'binaries');

console.log('[KIN PACKAGE] Packaging @kin/core standalone binary sidecar...');

// 1. Ensure dist exists
const startDaemonPath = path.resolve(coreDir, 'dist', 'start_daemon.js');
if (!fs.existsSync(startDaemonPath)) {
  console.log('[KIN PACKAGE] Building core TypeScript files first...');
  execSync('npm run build', { cwd: coreDir, stdio: 'inherit' });
}

// 2. Ensure destination directories exist
fs.mkdirSync(tauriBinariesDir, { recursive: true });
fs.mkdirSync(coreBinariesDir, { recursive: true });

// 3. Determine target triple
const platform = process.platform;
const arch = process.arch;

let targetTriple = '';
let binaryExt = '';

if (platform === 'win32') {
  targetTriple = arch === 'x64' ? 'x86_64-pc-windows-msvc' : `${arch}-pc-windows-msvc`;
  binaryExt = '.exe';
} else if (platform === 'darwin') {
  targetTriple = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
} else if (platform === 'linux') {
  targetTriple = arch === 'x64' ? 'x86_64-unknown-linux-gnu' : `${arch}-unknown-linux-gnu`;
} else {
  targetTriple = `${arch}-unknown-${platform}`;
}

let rustcHost = '';
try {
  const rustcInfo = execSync('rustc -vV', { encoding: 'utf-8' });
  const match = rustcInfo.match(/host:\s*([^\s]+)/);
  if (match) {
    rustcHost = match[1].trim();
  }
} catch {}

const binaryNames = new Set([
  `kin-core${binaryExt}`,
  `kin-core-${targetTriple}${binaryExt}`,
]);

if (rustcHost) {
  binaryNames.add(`kin-core-${rustcHost}${binaryExt}`);
}

if (platform === 'win32') {
  binaryNames.add('kin-core-x86_64-pc-windows-msvc.exe');
  binaryNames.add('kin-core-x86_64-pc-windows-gnu.exe');
} else if (platform === 'darwin') {
  binaryNames.add('kin-core-x86_64-apple-darwin');
  binaryNames.add('kin-core-aarch64-apple-darwin');
} else if (platform === 'linux') {
  binaryNames.add('kin-core-x86_64-unknown-linux-gnu');
  binaryNames.add('kin-core-aarch64-unknown-linux-gnu');
}

console.log(`[KIN PACKAGE] Target binary variants:`, Array.from(binaryNames));

// 4. Bundle into single CommonJS file for Node SEA
const bundledDaemonPath = path.resolve(coreDir, 'dist', 'bundle_daemon.cjs');
console.log('[KIN PACKAGE] Bundling core daemon with esbuild for SEA embedding...');
try {
  execSync(`npx esbuild "${startDaemonPath}" --bundle --platform=node --format=cjs --outfile="${bundledDaemonPath}"`, {
    cwd: coreDir,
    stdio: 'inherit'
  });
} catch (bundleErr) {
  console.warn('[KIN PACKAGE] esbuild bundle notice:', bundleErr.message);
}

const seaConfigPath = path.resolve(coreDir, 'sea-config.json');
const seaBlobPath = path.resolve(coreDir, 'sea-prep.blob');

const seaConfig = {
  main: path.relative(coreDir, fs.existsSync(bundledDaemonPath) ? bundledDaemonPath : startDaemonPath).replace(/\\/g, '/'),
  output: path.relative(coreDir, seaBlobPath).replace(/\\/g, '/'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false
};

fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf-8');

try {
  console.log('[KIN PACKAGE] Generating Node SEA blob...');
  execSync(`node --experimental-sea-config "${seaConfigPath}"`, { cwd: coreDir, stdio: 'inherit' });
} catch (e) {
  console.warn('[KIN PACKAGE] Warning: SEA blob generation encountered an issue:', e.message);
}

// 5. Create native sidecar binary via single-shot postject template
const nodeExecutable = process.execPath;
const templateBinary = path.resolve(coreBinariesDir, `kin-core-template${binaryExt}`);

try {
  fs.copyFileSync(nodeExecutable, templateBinary);
  if (fs.existsSync(seaBlobPath)) {
    try {
      console.log('[KIN PACKAGE] Injecting SEA blob into base binary template...');
      if (platform === 'win32') {
        execSync(`npx --yes postject "${templateBinary}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, {
          cwd: coreDir,
          stdio: 'ignore'
        });
      } else if (platform === 'darwin') {
        execSync(`npx --yes postject "${templateBinary}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA`, {
          cwd: coreDir,
          stdio: 'ignore'
        });
        // Re-sign binary on macOS to prevent SIGKILL from Mach-O signature invalidation
        try {
          execSync(`codesign --sign - --force "${templateBinary}"`, { stdio: 'ignore' });
        } catch {}
      } else {
        execSync(`npx --yes postject "${templateBinary}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, {
          cwd: coreDir,
          stdio: 'ignore'
        });
      }
      console.log('[KIN PACKAGE] SEA blob successfully injected into base template.');
    } catch (e) {
      console.warn('[KIN PACKAGE] Warning: postject injection encountered notice:', e.message);
    }
  }

  const destinations = [];
  for (const name of binaryNames) {
    destinations.push(path.resolve(tauriBinariesDir, name));
    destinations.push(path.resolve(coreBinariesDir, name));
  }

  for (const dest of destinations) {
    try {
      fs.copyFileSync(templateBinary, dest);
      if (platform !== 'win32') {
        fs.chmodSync(dest, 0o755);
      }
      console.log(`[KIN PACKAGE] Successfully populated sidecar binary: ${dest}`);
    } catch (err) {
      console.error(`[KIN PACKAGE] Error copying sidecar binary to ${dest}:`, err.message);
    }
  }
} finally {
  if (fs.existsSync(templateBinary)) {
    try { fs.unlinkSync(templateBinary); } catch {}
  }
}

// Clean up temporary blob
if (fs.existsSync(seaBlobPath)) {
  try { fs.unlinkSync(seaBlobPath); } catch {}
}
if (fs.existsSync(seaConfigPath)) {
  try { fs.unlinkSync(seaConfigPath); } catch {}
}

console.log('[KIN PACKAGE] Sidecar packaging complete.');
