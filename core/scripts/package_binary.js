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
  targetTriple = arch === 'x64' ? 'x86_64-unknown-linux-gnu' : (arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : `${arch}-unknown-linux-gnu`);
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

const nativeTriple = rustcHost || targetTriple;
const tauriBinaryNames = new Set([
  `kin-core-${nativeTriple}${binaryExt}`,
  `kin-core-${targetTriple}${binaryExt}`,
]);
const coreBinaryNames = new Set([
  `kin-core${binaryExt}`,
  `kin-core-${nativeTriple}${binaryExt}`,
]);

console.log(`[KIN PACKAGE] Target binary variants:`, {
  tauri: Array.from(tauriBinaryNames),
  core: Array.from(coreBinaryNames),
});

// 4. Bundle into single CommonJS file for Node SEA
const bundledDaemonPath = path.resolve(coreDir, 'dist', 'bundle_daemon.cjs');
console.log('[KIN PACKAGE] Bundling core daemon with esbuild for SEA embedding...');
try {
  execSync(`npx esbuild "${startDaemonPath}" --bundle --platform=node --format=cjs --outfile="${bundledDaemonPath}"`, {
    cwd: coreDir,
    stdio: 'inherit'
  });
} catch (bundleErr) {
  console.error('[KIN PACKAGE] esbuild bundle failed:', bundleErr.message);
  throw bundleErr;
}

const workerQuickJsSrc = path.resolve(coreDir, 'src', 'execution', 'worker_quickjs.ts');
const workerQuickJsBundle = path.resolve(coreDir, 'dist', 'worker_quickjs.cjs');
if (fs.existsSync(workerQuickJsSrc)) {
  console.log('[KIN PACKAGE] Pre-bundling QuickJS worker (worker_quickjs.cjs)...');
  execSync(
    `npx esbuild "${workerQuickJsSrc}" --bundle --platform=node --target=node20 --format=cjs --outfile="${workerQuickJsBundle}"`,
    { cwd: coreDir, stdio: 'inherit' }
  );
}

const seaConfigPath = path.resolve(coreDir, 'sea-config.json');
const seaBlobPath = path.resolve(coreDir, 'sea-prep.blob');
const seaAssets = {};
if (fs.existsSync(workerQuickJsBundle)) {
  seaAssets['worker_quickjs.cjs'] = path.relative(coreDir, workerQuickJsBundle).replace(/\\/g, '/');
}
const includeUiAssets = !process.argv.includes('--no-ui') && process.env.KIN_SEA_NO_UI !== '1';
const uiDistDir = path.resolve(coreDir, '..', 'ui', 'dist');
if (includeUiAssets && fs.existsSync(path.join(uiDistDir, 'index.html'))) {
  const walkUi = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkUi(full);
      } else if (entry.isFile()) {
        const rel = path.relative(uiDistDir, full).replace(/\\/g, '/');
        seaAssets[`ui/dist/${rel}`] = path.relative(coreDir, full).replace(/\\/g, '/');
      }
    }
  };
  walkUi(uiDistDir);
}

const seaConfig = {
  main: path.relative(coreDir, fs.existsSync(bundledDaemonPath) ? bundledDaemonPath : startDaemonPath).replace(/\\/g, '/'),
  output: path.relative(coreDir, seaBlobPath).replace(/\\/g, '/'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  ...(Object.keys(seaAssets).length > 0 ? { assets: seaAssets } : {}),
};

fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf-8');

console.log('[KIN PACKAGE] Generating Node SEA blob...');
try {
  execSync(`node --experimental-sea-config "${seaConfigPath}"`, { cwd: coreDir, stdio: 'inherit' });
} catch (e) {
  console.error('[KIN PACKAGE] SEA blob generation failed:', e.message);
  throw e;
}

if (!fs.existsSync(seaBlobPath)) {
  throw new Error(`[KIN PACKAGE] SEA blob missing at: ${seaBlobPath}`);
}

// 5. Create native sidecar binary via single-shot postject template
const nodeExecutable = process.execPath;
const templateBinary = path.resolve(coreBinariesDir, `kin-core-template${binaryExt}`);

try {
  fs.copyFileSync(nodeExecutable, templateBinary);

  // Pre-injection signature removal to prevent PE / Mach-O header issues
  if (platform === 'win32') {
    try {
      execSync(`signtool remove /s "${templateBinary}"`, { stdio: 'ignore' });
    } catch {}
  } else if (platform === 'darwin') {
    try {
      execSync(`codesign --remove-signature "${templateBinary}"`, { stdio: 'ignore' });
    } catch {}
  }

  console.log('[KIN PACKAGE] Injecting SEA blob into base binary template...');
  try {
    if (platform === 'win32') {
      execSync(`npx --yes postject "${templateBinary}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, {
        cwd: coreDir,
        stdio: 'inherit'
      });
    } else if (platform === 'darwin') {
      execSync(`npx --yes postject "${templateBinary}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA`, {
        cwd: coreDir,
        stdio: 'inherit'
      });
    } else {
      execSync(`npx --yes postject "${templateBinary}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, {
        cwd: coreDir,
        stdio: 'inherit'
      });
    }
    console.log('[KIN PACKAGE] SEA blob successfully injected into base template.');
  } catch (postjectErr) {
    console.error('[KIN PACKAGE] Postject injection failed:', postjectErr.message);
    throw postjectErr;
  }

  // Post-injection signature handling
  if (platform === 'darwin') {
    try {
      execSync(`codesign --sign - --force "${templateBinary}"`, { stdio: 'ignore' });
    } catch {}
  } else if (platform === 'win32' && process.env.WIN_SIGN_CERT) {
    try {
      execSync(`signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f "${process.env.WIN_SIGN_CERT}" /p "${process.env.WIN_SIGN_PASS || ''}" "${templateBinary}"`, { stdio: 'inherit' });
      console.log('[KIN PACKAGE] Successfully code-signed Windows binary template.');
    } catch (signErr) {
      console.warn('[KIN PACKAGE] Windows code signing notice:', signErr.message);
    }
  }

  const destinations = [];
  for (const name of tauriBinaryNames) {
    destinations.push(path.resolve(tauriBinariesDir, name));
  }
  for (const name of coreBinaryNames) {
    destinations.push(path.resolve(coreBinariesDir, name));
  }

  for (const dest of destinations) {
    try {
      fs.copyFileSync(templateBinary, dest);
      if (platform !== 'win32') {
        fs.chmodSync(dest, 0o755);
      }
      const stat = fs.statSync(dest);
      console.log(`[KIN PACKAGE] Successfully populated sidecar binary: ${dest} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);
    } catch (err) {
      console.error(`[KIN PACKAGE] Error copying sidecar binary to ${dest}:`, err.message);
    }
  }
} finally {
  if (fs.existsSync(templateBinary)) {
    try { fs.unlinkSync(templateBinary); } catch {}
  }
  if (fs.existsSync(seaBlobPath)) {
    try { fs.unlinkSync(seaBlobPath); } catch {}
  }
  if (fs.existsSync(seaConfigPath)) {
    try { fs.unlinkSync(seaConfigPath); } catch {}
  }
}

// Copy schema.sql into distribution folders
const schemaSrc = path.resolve(coreDir, 'src', 'storage', 'schema.sql');
if (fs.existsSync(schemaSrc)) {
  try {
    fs.copyFileSync(schemaSrc, path.resolve(tauriBinariesDir, 'schema.sql'));
    fs.copyFileSync(schemaSrc, path.resolve(coreBinariesDir, 'schema.sql'));
    fs.mkdirSync(path.resolve(coreDir, 'dist', 'storage'), { recursive: true });
    fs.copyFileSync(schemaSrc, path.resolve(coreDir, 'dist', 'storage', 'schema.sql'));
    console.log('[KIN PACKAGE] Successfully bundled schema.sql into binaries distributions.');
  } catch (schemaErr) {
    console.warn('[KIN PACKAGE] Warning bundling schema.sql:', schemaErr.message);
  }
}

console.log('[KIN PACKAGE] Sidecar packaging complete.');
