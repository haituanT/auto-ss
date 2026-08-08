const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const backendEntry = path.resolve(rootDir, 'studio', 'backend', 'server.mjs');
const frontendDir = path.resolve(rootDir, 'studio', 'frontend');
const frontendDist = path.resolve(frontendDir, 'dist');
const frontendIndex = path.resolve(frontendDist, 'index.html');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cmdExe = process.env.ComSpec || 'cmd.exe';
const appPort = Number(process.env.AUTO_COMPARE_APP_PORT || process.env.STUDIO_PORT || '3101');
const appUrl = (process.env.AUTO_COMPARE_APP_URL || `http://127.0.0.1:${appPort}`).replace(/\/$/, '');
const statusUrl = `${appUrl}/api/status`;
const allowAiCliDangerousPermissions = process.env.AUTO_COMPARE_AI_CLI_ALLOW_DANGEROUS_PERMISSIONS || '1';
const reuseRunningCore = process.env.AUTO_COMPARE_REUSE_RUNNING_CORE === '1';
const defaultUserDataDir = process.env.LOCALAPPDATA
  ? path.resolve(process.env.LOCALAPPDATA, 'AutoCompareStudio', 'electron-profile')
  : path.resolve(rootDir, '.auto-compare', 'electron-profile');
const userDataDir = process.env.AUTO_COMPARE_USER_DATA_DIR || defaultUserDataDir;

const children = new Set();
let shuttingDown = false;
let backendChild = null;
let electronChild = null;

function resolveElectronPath() {
  try {
    return require('electron');
  } catch {
    const dubFlowElectron = path.resolve(rootDir, '..', '..', 'DubFlow', 'Frontend', 'node_modules', 'electron');
    if (fs.existsSync(dubFlowElectron)) {
      return require(dubFlowElectron);
    }
    throw new Error('Electron is not installed. Run npm install first, then open the app again.');
  }
}

function spawnManaged(command, args, options) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function runNpmSync(args, options = {}) {
  if (process.platform !== 'win32') {
    return spawnSync(npmCmd, args, options);
  }

  return spawnSync(cmdExe, ['/d', '/s', '/c', npmCmd, ...args], options);
}

function visitSource(targetPath, newerThanMs) {
  if (!fs.existsSync(targetPath)) return false;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return stat.mtimeMs > newerThanMs;
  }
  if (!stat.isDirectory()) return false;
  return fs.readdirSync(targetPath).some((name) => {
    if (name === 'dist' || name === 'node_modules') return false;
    return visitSource(path.join(targetPath, name), newerThanMs);
  });
}

function isFrontendSourceNewerThanBuild() {
  if (!fs.existsSync(frontendIndex)) return true;
  const buildMtime = fs.statSync(frontendIndex).mtimeMs;
  const sourceTargets = [
    path.resolve(frontendDir, 'src'),
    path.resolve(frontendDir, 'index.html'),
    path.resolve(frontendDir, 'vite.config.js'),
    path.resolve(rootDir, 'package.json'),
  ];

  return sourceTargets.some((targetPath) => visitSource(targetPath, buildMtime));
}

function ensureFrontendBuild() {
  if (!isFrontendSourceNewerThanBuild()) {
    return;
  }

  console.log('Building Auto Compare Studio UI ...');
  const result = runNpmSync(['run', 'build:studio'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    if (result.error) {
      console.error(result.error);
    }
    throw new Error('Studio UI build failed. Fix the build error above, then open the app again.');
  }
}

function getListeningPid(port) {
  if (process.platform !== 'win32') return null;
  const result = spawnSync('netstat', ['-ano'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;

  const lines = String(result.stdout || '').split(/\r?\n/);
  for (const line of lines) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5) continue;
    const localAddress = columns[1] || '';
    const state = columns[3] || '';
    const pid = Number(columns[4]);
    if (localAddress.endsWith(`:${port}`) && state === 'LISTENING' && Number.isInteger(pid)) {
      return pid;
    }
  }
  return null;
}

function stopListeningProcess(port, label = 'process') {
  const pid = getListeningPid(port);
  if (!pid) return false;
  console.log(`Stopping stale ${label} process ${pid} on port ${port} ...`);
  spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'inherit' });
  return true;
}

function isHttpReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });

    request.on('error', () => resolve(false));
    request.setTimeout(5000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForHttp(url, timeoutMs = 90000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const retry = () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, 700);
      };

      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        retry();
      });

      request.on('error', retry);
      request.setTimeout(30000, () => {
        request.destroy();
      });
    };

    check();
  });
}

function startBackend() {
  console.log('Starting Auto Compare Studio core ...');
  backendChild = spawnManaged(process.execPath, [backendEntry], {
    cwd: rootDir,
    env: {
      ...process.env,
      AUTO_COMPARE_AI_CLI_ALLOW_DANGEROUS_PERMISSIONS: allowAiCliDangerousPermissions,
      STUDIO_PORT: String(appPort),
      REMOTION_CONCURRENCY: process.env.REMOTION_CONCURRENCY || '50%',
      REMOTION_HARDWARE_ACCELERATION: process.env.REMOTION_HARDWARE_ACCELERATION || 'if-possible',
      REMOTION_VIDEO_BITRATE: process.env.REMOTION_VIDEO_BITRATE || '8M',
    },
  });

  backendChild.on('exit', (code) => {
    if (shuttingDown || backendChild === null) return;
    console.error(`Auto Compare Studio core exited unexpectedly with code ${code ?? 'unknown'}.`);
    shutdown(code || 1);
  });

  return backendChild;
}

async function ensureBackendStarted() {
  if (await isHttpReady(statusUrl)) {
    if (reuseRunningCore) {
      console.log('Auto Compare Studio core is already running.');
      return;
    }
    console.log('Auto Compare Studio core is already running; restarting local core with app settings ...');
    if (stopListeningProcess(appPort, 'Auto Compare core')) {
      await sleep(800);
    } else {
      console.log('Could not find the existing core process; reusing it.');
      return;
    }
  }

  if (getListeningPid(appPort)) {
    console.log('Auto Compare Studio port is occupied but not responding; restarting local core ...');
    stopListeningProcess(appPort, 'Auto Compare core');
  }

  startBackend();
  await waitForHttp(statusUrl);
  console.log('Auto Compare Studio core is ready.');
}

function openElectronWindow() {
  console.log('Opening Auto Compare Studio app ...');
  const electronMain = path.resolve(__dirname, 'main.cjs');
  const child = spawnManaged(resolveElectronPath(), [electronMain], {
    cwd: rootDir,
    env: {
      ...process.env,
      AUTO_COMPARE_AI_CLI_ALLOW_DANGEROUS_PERMISSIONS: allowAiCliDangerousPermissions,
      AUTO_COMPARE_APP_URL: appUrl,
      AUTO_COMPARE_USER_DATA_DIR: userDataDir,
    },
  });

  electronChild = child;
  child.on('exit', (code) => {
    if (child !== electronChild) return;
    shutdown(code || 0);
  });
  return child;
}

function killChildTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    killChildTree(child);
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
});

async function main() {
  ensureFrontendBuild();
  await ensureBackendStarted();
  openElectronWindow();
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
