/**
 * An unknown proxy id stops the gateway, and says why.
 *
 * A proxy id the catalog does not know is a mistake in the
 * configuration file. It used to look like a gateway that would not
 * start: the worker died of the mistake at once, the daemon started it
 * again, and the log filled with "respawning" until the command that
 * waited for the daemon gave up with a timeout that said nothing about
 * the mistake.
 *
 * Now:
 *
 *   - the daemon stops with the reason, and does not start the worker
 *     again (a worker that dies of anything else is still started
 *     again — see the respawn test in `daemon.test.ts`);
 *   - the command that waits for the daemon says the reason, and not a
 *     timeout;
 *   - the doctor reports the id that is unknown as an error, with the
 *     ids that exist.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fork, spawn } from 'node:child_process';
import { isUnknownProxyError, requireAdapter, unknownProxyReason } from '../src/adapters/index.ts';
import { fatalReason, stopWorker } from '../src/core/daemon.ts';
import { makeCliFixture, REPO_ROOT, type CliFixture } from './helpers/cli.ts';

/** The daemon of the package. */
const DAEMON = path.join(REPO_ROOT, 'bin', 'gatewarden-daemon.js');

/** Run the daemon and collect what it wrote. */
function runDaemon(fixture: CliFixture): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DAEMON, '--config', fixture.configPath], {
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => resolve({ code, output }));
  });
}

test('the catalog says which proxy id is unknown, and which ids exist', () => {
  assert.equal(unknownProxyReason('traefik'), null);
  assert.equal(unknownProxyReason('caddy'), 'unknown proxy "caddy" (known: traefik)');

  assert.throws(
    () => requireAdapter('caddy'),
    (error: unknown) =>
      isUnknownProxyError(error) && error.proxyId === 'caddy' && error.known.join(', ') === 'traefik',
  );
});

test('only the failure a worker reports stops the daemon', () => {
  // The worker tells the daemon why it will not serve, over the channel
  // the daemon opened. Nothing else is a reason to stop.
  assert.equal(fatalReason({ type: 'fatal', message: 'unknown proxy "caddy" (known: traefik)' }), 'unknown proxy "caddy" (known: traefik)');
  assert.equal(fatalReason({ type: 'fatal' }), null);
  assert.equal(fatalReason({ type: 'other', message: 'hello' }), null);
  assert.equal(fatalReason('unknown proxy "caddy"'), null);
  assert.equal(fatalReason(undefined), null);
});

test('gatewarden start says which proxy id is unknown, and does not wait for a timeout', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  const result = await fixture.runFail(['start']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown proxy "caddy" \(known: traefik\)/);
  assert.doesNotMatch(result.stdout + result.stderr, /did not answer \/healthz/);

  // No daemon was started, so there was nothing to start again.
  assert.equal(fs.existsSync(path.join(fixture.dir, 'daemon.pid')), false);
});

test('gatewarden start --json says the same thing as JSON', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  const result = await fixture.runFail(['start', '--json']);
  assert.equal(result.code, 1);
  const payload = JSON.parse(result.stdout) as { started: boolean; error: string };
  assert.equal(payload.started, false);
  assert.equal(payload.error, 'unknown proxy "caddy" (known: traefik)');
});

test('a command that waits for the daemon says the reason, not a timeout', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  const result = await fixture.runFail([
    'register',
    '--project',
    'demo',
    '--branch',
    'main',
    '--port',
    '5173',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown proxy "caddy" \(known: traefik\)/);
  assert.doesNotMatch(result.stdout + result.stderr, /did not answer \/healthz/);
});

test('the daemon stops with the code zero every time', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  // The daemon that stops on purpose has to end with the code zero
  // every time: a service that reads another code starts it again,
  // and the journal of the service fills with the same failure.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { code, output } = await runDaemon(fixture);
    assert.equal(code, 0, `run ${attempt + 1} ended with the code ${code}:\n${output}`);
    assert.doesNotMatch(output, /EPIPE|Unhandled 'error' event/);
  }
});

test('stopping a worker that is already gone does not raise', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-stop-worker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const script = path.join(dir, 'worker.mjs');
  fs.writeFileSync(script, 'process.exit(0);\n');

  const child = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const errors: NodeJS.ErrnoException[] = [];
  child.on('error', (error: NodeJS.ErrnoException) => errors.push(error));
  await new Promise((resolve) => child.on('exit', resolve));

  // The channel of a worker that has exited is closed: the message
  // cannot be sent. The error of that must not reach the daemon — an
  // unhandled error ends it with a code that is not zero.
  stopWorker(child);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(errors.map((error) => error.code), []);
});

test('stopping a worker that is still there stops it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-stop-live-worker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const script = path.join(dir, 'worker.mjs');
  fs.writeFileSync(
    script,
    "process.on('message', (message) => { if (message === 'shutdown') process.exit(0); });\n",
  );

  const child = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const errors: NodeJS.ErrnoException[] = [];
  child.on('error', (error: NodeJS.ErrnoException) => errors.push(error));

  stopWorker(child);
  // The worker is stopped, one way or another: the message it reads,
  // or the signal that follows it.
  const stopped = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  assert.equal(stopped, true, 'the worker did not stop');
  assert.deepEqual(errors.map((error) => error.code), []);
});

test('the daemon stops instead of starting the worker again', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  const { code, output } = await runDaemon(fixture);

  // The daemon stopped on purpose, so it ends with the code that says
  // "stopped": a service that starts it again would fill its journal
  // with the same failure for ever.
  assert.equal(code, 0);
  assert.match(output, /unknown proxy "caddy" \(known: traefik\)/);
  // The worker is not started again: the log does not fill up.
  assert.doesNotMatch(output, /respawning/);

  // The reason is written down, so that a command that waits for the
  // daemon can say it.
  const reason = fs.readFileSync(path.join(fixture.dir, 'daemon.error'), 'utf8').trim();
  assert.equal(reason, 'unknown proxy "caddy" (known: traefik)');

  // The daemon is gone: it removed its own pidfile.
  assert.equal(fs.existsSync(path.join(fixture.dir, 'daemon.pid')), false);
});

test('a proxy id with a quote in it is reported as it is', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'cadd"y' } });
  t.after(() => fixture.cleanup());

  const { code, output } = await runDaemon(fixture);

  assert.equal(code, 0);
  // The reason is the one of the catalog, whole: the id is in it as it
  // was written in the configuration file.
  assert.match(output, /unknown proxy "cadd"y" \(known: traefik\)/);
  const reason = fs.readFileSync(path.join(fixture.dir, 'daemon.error'), 'utf8').trim();
  assert.equal(reason, 'unknown proxy "cadd"y" (known: traefik)');
});

test('the doctor reports an unknown proxy id as an error, with its reason', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  const result = await fixture.runFail(['doctor', '--json']);
  const report = JSON.parse(result.stdout) as {
    ok: boolean;
    checks: { name: string; status: string; detail: string }[];
  };

  const proxy = report.checks.find((check) => check.name === 'proxy');
  assert.ok(proxy, 'the doctor should have a proxy check');
  assert.equal(proxy.status, 'fail');
  assert.match(proxy.detail, /unknown proxy "caddy" \(known: traefik\)/);
  assert.equal(report.ok, false);
});
