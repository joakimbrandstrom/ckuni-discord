import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const deployScript = resolve('deploy/ckuni-discord-auto-deploy');
const backupScript = resolve('backup-postgres.sh');

type Fixture = {
  root: string;
  publisher: string;
  repo: string;
  stateDir: string;
  backupDir: string;
  fakeBin: string;
  logFile: string;
  initialSha: string;
};

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ckuni-auto-deploy-'));
  const origin = join(root, 'origin.git');
  const publisher = join(root, 'publisher');
  const repo = join(root, 'deployment');
  const stateDir = join(root, 'state');
  const backupDir = join(root, 'backups');
  const fakeBin = join(root, 'bin');
  const logFile = join(root, 'commands.log');

  run('git', ['init', '--bare', '--initial-branch=main', origin], root);
  run('git', ['init', '--initial-branch=main', publisher], root);
  run('git', ['config', 'user.name', 'Test User'], publisher);
  run('git', ['config', 'user.email', 'test@example.com'], publisher);

  writeFileSync(join(publisher, 'version.txt'), 'one\n');
  writeFileSync(
    join(publisher, 'backup-postgres.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'backup\\n' >> "\${TEST_LOG}"
mkdir -p "$1"
printf 'archive\\n' > "$1/test.dump"
`,
  );
  chmodSync(join(publisher, 'backup-postgres.sh'), 0o755);
  run('git', ['add', '.'], publisher);
  run('git', ['commit', '-m', 'initial'], publisher);
  run('git', ['remote', 'add', 'origin', origin], publisher);
  run('git', ['push', '-u', 'origin', 'main'], publisher);
  run('git', ['clone', origin, repo], root);

  mkdirSync(stateDir);
  mkdirSync(backupDir);
  mkdirSync(fakeBin);
  writeFileSync(logFile, '');

  writeFileSync(
    join(fakeBin, 'podman'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'podman %s\\n' "$*" >> "\${TEST_LOG}"
if [[ "\${FAIL_UP:-0}" == '1' && "$*" == *'up -d --build'* ]]; then
  exit 23
fi
if [[ "$*" == *'State.StartedAt'* ]]; then
  printf '2026-09-24T08:45:14.000000000+02:00\\n'
elif [[ "$1" == 'inspect' ]]; then
  printf 'true\\n'
elif [[ "$1" == 'logs' ]]; then
  if [[ "\${FAIL_TUNNEL:-0}" != '1' ]]; then
    printf 'Registered tunnel connection\\n'
  fi
elif [[ "$*" == *'io.podman.compose.service=cloudflared'* ]]; then
  printf 'cloudflared-id\\n'
fi
`,
  );
  writeFileSync(
    join(fakeBin, 'curl'),
    `#!/usr/bin/env bash
if [[ "\${FAIL_HEALTH:-0}" == '1' ]]; then
  exit 22
fi
`,
  );
  chmodSync(join(fakeBin, 'podman'), 0o755);
  chmodSync(join(fakeBin, 'curl'), 0o755);

  const initialSha = run('git', ['rev-parse', 'HEAD'], repo);
  writeFileSync(join(stateDir, 'deployed-sha'), `${initialSha}\n`);

  return { root, publisher, repo, stateDir, backupDir, fakeBin, logFile, initialSha };
}

function advanceOrigin(fixture: Fixture) {
  writeFileSync(join(fixture.publisher, 'version.txt'), `${Date.now()}\n`);
  run('git', ['add', 'version.txt'], fixture.publisher);
  run('git', ['commit', '-m', 'update'], fixture.publisher);
  run('git', ['push', 'origin', 'main'], fixture.publisher);
  return run('git', ['rev-parse', 'HEAD'], fixture.publisher);
}

function deploy(fixture: Fixture, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [deployScript], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
      CKUNI_REPO: fixture.repo,
      CKUNI_STATE_DIR: fixture.stateDir,
      CKUNI_BACKUP_DIR: fixture.backupDir,
      CKUNI_BACKUP_COMMAND: join(fixture.repo, 'backup-postgres.sh'),
      CKUNI_HEALTH_ATTEMPTS: '1',
      CKUNI_HEALTH_INTERVAL_SECONDS: '0',
      TEST_LOG: fixture.logFile,
      ...extraEnv,
    },
  });
}

test('does nothing when origin/main is already deployed', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));

  const result = deploy(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already deployed/);
  assert.equal(readFileSync(fixture.logFile, 'utf8'), '');
});

test('backs up, fast-forwards, validates, and records a deployment', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const targetSha = advanceOrigin(fixture);

  const result = deploy(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(run('git', ['rev-parse', 'HEAD'], fixture.repo), targetSha);
  assert.equal(readFileSync(join(fixture.stateDir, 'deployed-sha'), 'utf8').trim(), targetSha);
  const commands = readFileSync(fixture.logFile, 'utf8');
  assert.match(commands, /backup/);
  assert.match(commands, /up -d --build/);
  assert.match(commands, /run --rm bot node dist\/src\/discord\/register-commands\.js/);
  assert.ok(commands.indexOf('backup') < commands.indexOf('stop bot'));
  assert.ok(commands.indexOf('stop bot') < commands.indexOf('up -d --build'));
  assert.match(commands, /io\.podman\.compose\.service=cloudflared/);
  assert.match(commands, /podman logs --since .* --tail 200 cloudflared-id/);
});

test('retries a failed deployment even after the checkout was updated', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const targetSha = advanceOrigin(fixture);

  const failed = deploy(fixture, { FAIL_UP: '1' });
  assert.equal(failed.status, 23);
  assert.equal(run('git', ['rev-parse', 'HEAD'], fixture.repo), targetSha);
  assert.equal(
    readFileSync(join(fixture.stateDir, 'deployed-sha'), 'utf8').trim(),
    fixture.initialSha,
  );

  const retried = deploy(fixture);
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(readFileSync(join(fixture.stateDir, 'deployed-sha'), 'utf8').trim(), targetSha);
  assert.equal(readFileSync(fixture.logFile, 'utf8').match(/^backup$/gm)?.length, 2);
});

test('refuses to deploy from a dirty checkout', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  writeFileSync(join(fixture.repo, 'untracked.txt'), 'dirty\n');

  const result = deploy(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncommitted or untracked files/);
  assert.equal(readFileSync(fixture.logFile, 'utf8'), '');
});

test('does not record deployment without a registration from the current tunnel start', (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const targetSha = advanceOrigin(fixture);

  const result = deploy(fixture, { FAIL_TUNNEL: '1' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /did not register a tunnel connection/);
  assert.equal(run('git', ['rev-parse', 'HEAD'], fixture.repo), targetSha);
  assert.equal(
    readFileSync(join(fixture.stateDir, 'deployed-sha'), 'utf8').trim(),
    fixture.initialSha,
  );
});

test('publishes only a non-empty validated private backup', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ckuni-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeBin = join(root, 'bin');
  const backupDir = join(root, 'backups');
  mkdirSync(fakeBin);
  writeFileSync(
    join(fakeBin, 'podman'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *'pg_dump'* ]]; then
  printf 'valid archive\\n'
elif [[ "\${FAIL_RESTORE:-0}" == '1' ]]; then
  exit 1
fi
`,
  );
  chmodSync(join(fakeBin, 'podman'), 0o755);

  const result = spawnSync('bash', [backupScript, backupDir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      CKUNI_REPO: resolve('.'),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(backupDir);
  assert.equal(files.length, 1);
  assert.match(files[0] ?? '', /^ckuni_\d{8}_\d{6}_\d+\.dump$/);
  assert.equal(statSync(join(backupDir, files[0] ?? '')).mode & 0o777, 0o600);
});

test('removes the temporary backup when archive validation fails', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ckuni-backup-failure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeBin = join(root, 'bin');
  const backupDir = join(root, 'backups');
  mkdirSync(fakeBin);
  writeFileSync(
    join(fakeBin, 'podman'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *'pg_dump'* ]]; then
  printf 'invalid archive\\n'
else
  exit 1
fi
`,
  );
  chmodSync(join(fakeBin, 'podman'), 0o755);

  const result = spawnSync('bash', [backupScript, backupDir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      CKUNI_REPO: resolve('.'),
    },
  });

  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(backupDir), []);
});
