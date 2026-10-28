/**
 * The lifecycle commands of the CLI: `start`, `stop`, `doctor` and
 * `install-service` (§5).
 *
 * The tests run against a throwaway installation: the daemon they start
 * listens on free ports in a temporary directory, and the service unit is
 * written into a temporary home directory. The gateway that runs on the
 * user's machine is never touched.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { LEGACY_DAEMON, makeCliFixture } from './helpers/cli.ts';

test('start starts the daemon and waits for it', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const result = await cli.runJson<{ started: boolean; alreadyRunning: boolean; pid: number | null }>([
    'start',
    '--json',
  ]);
  assert.equal(result.started, true);
  assert.equal(result.alreadyRunning, false);
  assert.equal(typeof result.pid, 'number');
  assert.ok(fs.existsSync(path.join(cli.dir, 'daemon.pid')));
});

test('start says that the daemon is already running', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['start']);
  const second = await cli.runJson<{ started: boolean; alreadyRunning: boolean }>(['start', '--json']);
  assert.equal(second.started, false);
  assert.equal(second.alreadyRunning, true);
});

test('stop stops the daemon', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['start']);
  const result = await cli.runJson<{ stopped: boolean; wasRunning: boolean; pid: number | null }>([
    'stop',
    '--json',
  ]);
  assert.equal(result.wasRunning, true);
  assert.equal(result.stopped, true);
  assert.equal(typeof result.pid, 'number');
  assert.equal(fs.existsSync(path.join(cli.dir, 'daemon.pid')), false);
});

test('stop says that the daemon was not running', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const result = await cli.runJson<{ stopped: boolean; wasRunning: boolean }>(['stop', '--json']);
  assert.equal(result.wasRunning, false);
  assert.equal(result.stopped, false);
});

test('stop stops a daemon that was started through the old launcher', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // The daemon the way the live gateway runs it: through the launcher of
  // the old name, `bin/traefik-devd.js`.
  const daemon = spawn(process.execPath, [LEGACY_DAEMON, '--config', cli.configPath], {
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();
  t.after(() => {
    try {
      process.kill(-(daemon.pid as number), 'SIGTERM');
    } catch {
      // already stopped
    }
  });

  const pidFile = path.join(cli.dir, 'daemon.pid');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !fs.existsSync(pidFile)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(fs.existsSync(pidFile), 'the daemon did not write its pidfile');

  const result = await cli.runJson<{ stopped: boolean; wasRunning: boolean; pid: number | null }>([
    'stop',
    '--json',
  ]);
  assert.equal(result.wasRunning, true);
  assert.equal(result.stopped, true, 'the daemon of the old launcher was not stopped');
  assert.equal(fs.existsSync(pidFile), false);
});

test('doctor reports what it finds', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['start']);

  const result = await cli.runJson<{
    ok: boolean;
    checks: Array<{ name: string; status: string; detail: string }>;
  }>(['doctor', '--json']);

  assert.equal(result.ok, true, JSON.stringify(result.checks));
  const names = result.checks.map((check) => check.name);
  for (const expected of ['config file', 'state directory', 'daemon', 'registry port', 'relay port', 'routes', 'proxy']) {
    assert.ok(names.includes(expected), `${expected} is missing from the report`);
  }
  const daemon = result.checks.find((check) => check.name === 'daemon');
  assert.equal(daemon?.status, 'ok');
});

test('doctor fails when the daemon is not running', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const result = await cli.runFail(['doctor', '--json']);
  assert.equal(result.code, 1);
  const parsed = JSON.parse(result.stdout) as {
    ok: boolean;
    checks: Array<{ name: string; status: string }>;
  };
  assert.equal(parsed.ok, false);
  const daemon = parsed.checks.find((check) => check.name === 'daemon');
  assert.equal(daemon?.status, 'fail');
});

test('install-service writes the unit of the platform and enables it', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  // The unit is written, but not enabled: enabling it would start a daemon
  // on the machine the tests run on.
  const result = await cli.runJson<{
    platform: string;
    name: string;
    path: string | null;
    written: boolean;
    enabled: boolean;
    manualEnable: string;
  }>(['install-service', '--no-enable', '--json']);

  assert.equal(result.written, true);
  assert.equal(result.enabled, false);
  assert.equal(result.platform, process.platform);
  assert.ok(result.manualEnable.length > 0);

  if (process.platform === 'linux') {
    const unit = path.join(cli.dir, '.config', 'systemd', 'user', 'dev-gateway.service');
    assert.equal(result.path, unit);
    assert.ok(fs.existsSync(unit), 'the unit was not written');
    const content = fs.readFileSync(unit, 'utf8');
    assert.match(content, /ExecStart=.*dev-gateway-daemon\.js/);
    assert.match(content, /--config/);
  }
});

test('install-service reports the command to enable the unit by hand', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const output = await cli.run(['install-service', '--no-enable']);
  assert.match(output, /service was not enabled/);
  assert.match(output, /systemctl|launchctl|schtasks/);
});
