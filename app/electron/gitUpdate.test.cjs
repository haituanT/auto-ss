const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { applyGitUpdate, checkForUpdates } = require('./gitUpdate.cjs');

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function configureRepository(cwd) {
  git(cwd, ['config', 'user.name', 'Auto Compare Tests']);
  git(cwd, ['config', 'user.email', 'auto-compare-tests@example.invalid']);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-compare-git-update-'));
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  const app = path.join(root, 'app');

  fs.mkdirSync(source);
  git(source, ['init', '-b', 'main']);
  configureRepository(source);
  fs.writeFileSync(path.join(source, 'version.txt'), 'first\n');
  git(source, ['add', 'version.txt']);
  git(source, ['commit', '-m', 'first version']);

  git(root, ['init', '--bare', remote]);
  git(source, ['remote', 'add', 'origin', remote]);
  git(source, ['push', '-u', 'origin', 'main']);
  git(root, ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(root, ['clone', remote, app]);
  configureRepository(app);

  return { root, source, remote, app };
}

function cleanupFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

test('detects and fast-forwards a clean clone to the new remote commit', async () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.source, 'version.txt'), 'second\n');
    git(fixture.source, ['add', 'version.txt']);
    git(fixture.source, ['commit', '-m', 'second version']);
    git(fixture.source, ['push', 'origin', 'main']);

    const check = await checkForUpdates({ rootDir: fixture.app });
    assert.equal(check.status, 'update-available');
    assert.equal(check.canUpdate, true);
    assert.equal(check.remoteAhead, 1);

    const update = await applyGitUpdate({ rootDir: fixture.app });
    assert.equal(update.status, 'updated');
    assert.equal(update.updated, true);
    assert.equal(fs.readFileSync(path.join(fixture.app, 'version.txt'), 'utf8').replace(/\r\n/g, '\n'), 'second\n');
  } finally {
    cleanupFixture(fixture);
  }
});

test('does not overwrite a clone with local edits', async () => {
  const fixture = createFixture();
  try {
    fs.writeFileSync(path.join(fixture.app, 'version.txt'), 'local edit\n');
    fs.writeFileSync(path.join(fixture.source, 'version.txt'), 'second\n');
    git(fixture.source, ['add', 'version.txt']);
    git(fixture.source, ['commit', '-m', 'second version']);
    git(fixture.source, ['push', 'origin', 'main']);

    const check = await checkForUpdates({ rootDir: fixture.app });
    assert.equal(check.status, 'update-available');
    assert.equal(check.canUpdate, false);
    assert.equal(check.workingTreeClean, false);

    const update = await applyGitUpdate({ rootDir: fixture.app });
    assert.equal(update.status, 'update-available');
    assert.equal(update.updated, undefined);
    assert.equal(fs.readFileSync(path.join(fixture.app, 'version.txt'), 'utf8').replace(/\r\n/g, '\n'), 'local edit\n');
  } finally {
    cleanupFixture(fixture);
  }
});
