const { spawn } = require('node:child_process');

const DEFAULT_REMOTE = String(process.env.AUTO_COMPARE_UPDATE_REMOTE || 'origin').trim() || 'origin';
const DEFAULT_BRANCH = String(process.env.AUTO_COMPARE_UPDATE_BRANCH || '').trim();

function sanitizeText(value) {
  return String(value || '')
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1$2:<redacted>@')
    .replace(/([?&](?:access[_-]?token|api[_-]?key|password|secret|token)=)[^&\s]+/gi, '$1<redacted>');
}

function userFacingError(error) {
  const message = sanitizeText(error?.message || error || 'Unknown Git error.').trim();
  return message.length > 420 ? `${message.slice(0, 417)}...` : message;
}

function runCommand(command, args, { cwd, timeoutMs = 60_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let child;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      handler(value);
    };

    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(reject, error);
      return;
    }

    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish(resolve, { stdout: String(stdout), stderr: String(stderr) });
        return;
      }

      const detail = String(stderr || stdout || '').trim();
      finish(reject, new Error(
        `${command} ${args.join(' ')} failed${signal ? ` (${signal})` : ` with exit code ${code}`}${detail ? `: ${sanitizeText(detail)}` : '.'}`,
      ));
    });

    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(reject, new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });
}

function git(rootDir, args, options = {}) {
  return runCommand('git', args, { cwd: rootDir, ...options });
}

function output(result) {
  return String(result?.stdout || '').trim();
}

async function inspectRepository(rootDir) {
  const topLevel = output(await git(rootDir, ['rev-parse', '--show-toplevel']));
  const branch = output(await git(rootDir, ['branch', '--show-current']));
  const head = output(await git(rootDir, ['rev-parse', 'HEAD']));
  const status = output(await git(rootDir, ['status', '--porcelain', '--untracked-files=normal']));

  return {
    topLevel,
    branch,
    head,
    workingTreeClean: !status,
  };
}

function compareCounts(value) {
  const [localAhead = '0', remoteAhead = '0'] = String(value || '').trim().split(/\s+/);
  return {
    localAhead: Number(localAhead) || 0,
    remoteAhead: Number(remoteAhead) || 0,
  };
}

async function checkForUpdates({
  rootDir,
  remoteName = DEFAULT_REMOTE,
  branch = DEFAULT_BRANCH,
  fetchRemote = true,
} = {}) {
  try {
    const repo = await inspectRepository(rootDir);
    const targetBranch = branch || repo.branch || 'main';
    if (!targetBranch) {
      return { status: 'unavailable', available: false, error: 'Không xác định được nhánh Git để kiểm tra.' };
    }

    await git(rootDir, ['remote', 'get-url', remoteName]);
    if (fetchRemote) {
      await git(rootDir, ['fetch', '--prune', remoteName, targetBranch], { timeoutMs: 90_000 });
    }

    const remoteRef = `${remoteName}/${targetBranch}`;
    const currentCommit = output(await git(rootDir, ['rev-parse', 'HEAD']));
    const latestCommit = output(await git(rootDir, ['rev-parse', remoteRef]));
    const counts = compareCounts(output(await git(rootDir, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`])));
    const latestDetails = output(await git(rootDir, ['log', '-1', '--format=%s%x00%aI', remoteRef])).split('\0');
    const status = counts.remoteAhead > 0 && counts.localAhead === 0
      ? 'update-available'
      : counts.remoteAhead === 0 && counts.localAhead === 0
        ? 'up-to-date'
        : counts.localAhead > 0 && counts.remoteAhead === 0
          ? 'local-ahead'
          : 'diverged';
    const canUpdate = status === 'update-available' && repo.workingTreeClean && repo.branch === targetBranch;

    return {
      status,
      available: status === 'update-available',
      canUpdate,
      workingTreeClean: repo.workingTreeClean,
      branch: targetBranch,
      remoteName,
      currentCommit,
      latestCommit,
      latestShortCommit: latestCommit.slice(0, 8),
      latestMessage: latestDetails[0] || '',
      latestDate: latestDetails[1] || '',
      localAhead: counts.localAhead,
      remoteAhead: counts.remoteAhead,
      reason: !repo.workingTreeClean
        ? 'Có file đang sửa cục bộ; hãy lưu hoặc commit trước khi cập nhật.'
        : repo.branch !== targetBranch
          ? `App đang ở nhánh ${repo.branch || 'detached'}, cần chuyển về ${targetBranch}.`
          : status === 'local-ahead' || status === 'diverged'
            ? 'Bản cục bộ và GitHub không cùng lịch sử; app không tự ghi đè để tránh mất code.'
            : '',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      available: false,
      canUpdate: false,
      error: userFacingError(error),
    };
  }
}

function changedFilesFromDiff(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

async function installDependencies(rootDir) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await runCommand(npmCommand, ['install', '--no-audit', '--no-fund'], {
    cwd: rootDir,
    timeoutMs: 10 * 60 * 1000,
  });
}

async function applyGitUpdate(options = {}) {
  const check = await checkForUpdates({ ...options, fetchRemote: true });
  if (check.status !== 'update-available') return check;
  if (!check.canUpdate) return check;

  const remoteRef = `${check.remoteName}/${check.branch}`;
  const changedFiles = changedFilesFromDiff(output(await git(options.rootDir, [
    'diff', '--name-only', `HEAD..${remoteRef}`,
  ])));

  try {
    await git(options.rootDir, ['merge', '--ff-only', remoteRef], { timeoutMs: 90_000 });
  } catch (error) {
    return {
      ...check,
      status: 'error',
      available: true,
      canUpdate: false,
      error: userFacingError(error),
    };
  }

  const dependenciesChanged = changedFiles.some((file) => file === 'package.json' || file === 'package-lock.json');
  if (dependenciesChanged) {
    try {
      await installDependencies(options.rootDir);
    } catch (error) {
      return {
        ...check,
        status: 'updated-needs-install',
        updated: true,
        restarting: false,
        changedFiles,
        dependenciesChanged: true,
        error: `Đã tải code mới nhưng cài thư viện thất bại: ${userFacingError(error)}`,
      };
    }
  }

  const newCommit = output(await git(options.rootDir, ['rev-parse', 'HEAD']));
  return {
    ...check,
    status: 'updated',
    updated: true,
    restarting: false,
    changedFiles,
    dependenciesChanged,
    currentCommit: newCommit,
    latestShortCommit: newCommit.slice(0, 8),
  };
}

module.exports = {
  applyGitUpdate,
  checkForUpdates,
  inspectRepository,
  sanitizeText,
};
