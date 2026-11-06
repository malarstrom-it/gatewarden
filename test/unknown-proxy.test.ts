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
 *     ids that exist;
 *   - the status says the reason too, in a sentence, and it does not
 *     fail because of it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fork, spawn } from 'node:child_process';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { isUnknownProxyError, requireAdapter, unknownProxyReason } from '../src/adapters/index.ts';
import { fatalReason, stopWorker } from '../src/core/daemon.ts';
import { McpServer } from '../src/integrations/mcp/server.ts';
import { answersUnknownProxy, TOOLS } from '../src/integrations/mcp/tools.ts';
import { freePort, makeCliFixture, REPO_ROOT, type CliFixture } from './helpers/cli.ts';
import { isolate } from './helpers/isolation.ts';
import { makeTempDir } from './helpers/tempdir.ts';

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
  const dir = makeTempDir('gatewarden-stop-worker-');
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
  const dir = makeTempDir('gatewarden-stop-live-worker-');
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

test('only the status tool answers the failure of an unknown proxy id', () => {
  const status = TOOLS.find((tool) => tool.name === 'dev_gateway_status');
  const publish = TOOLS.find((tool) => tool.name === 'publish_dev_server');
  assert.ok(status && publish, 'the tools of the server are missing');

  const unknown = 'unknown proxy "caddy" (known: traefik)';
  const other = 'daemon did not answer /healthz within 20000 ms';

  // The status tool answers the mistake it reports.
  assert.equal(answersUnknownProxy(status, { proxy: 'caddy' }, unknown), true);
  // Every other tool fails when the daemon did not start.
  assert.equal(answersUnknownProxy(publish, { proxy: 'caddy' }, unknown), false);
  // The status tool fails for every other reason too.
  assert.equal(answersUnknownProxy(status, { proxy: 'caddy' }, other), false);
  assert.equal(answersUnknownProxy(status, { proxy: 'traefik' }, unknown), false);
});

/**
 * The sentence the status carries about an unknown proxy id.
 *
 * It is the wording of the catalog, in a sentence: the id that is
 * unknown, and the ids that exist.
 */
const UNKNOWN_PROXY_REASON =
  'The configuration file names a proxy the package does not know: unknown proxy "caddy" (known: traefik).';

test('the status says which proxy id is unknown, and does not fail', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  const result = await fixture.runFail(['status']);

  // The status reports: it does not fail because the proxy id is wrong.
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  // The reason is a sentence, and it names the id that is unknown.
  assert.match(
    result.stdout,
    /proxy reason: The configuration file names a proxy the package does not know: unknown proxy "caddy" \(known: traefik\)\./,
  );
  // The id that is unknown is named too.
  assert.match(result.stdout, /^proxy: {8}caddy$/m);
});

test('the status says nothing about a proxy the package knows', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'traefik' } });
  t.after(() => fixture.cleanup());

  const result = await fixture.runFail(['status']);

  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  // A proxy that answers needs no line of its own: the output of the
  // status is the output it was before.
  assert.doesNotMatch(result.stdout, /^proxy:/m);
  assert.doesNotMatch(result.stdout, /proxy reason:/);
});

test('the status --json says why the proxy does not answer', async (t) => {
  const fixture = await makeCliFixture({ config: { proxy: 'caddy' } });
  t.after(() => fixture.cleanup());

  const payload = await fixture.runJson<{
    proxy: { id: string; reachable: boolean; reason?: string };
    reachable: boolean;
  }>(['status', '--json']);

  assert.equal(payload.proxy.id, 'caddy');
  // The proxy does not answer, and the status says why.
  assert.equal(payload.proxy.reachable, false);
  assert.equal(payload.proxy.reason, UNKNOWN_PROXY_REASON);
  assert.equal(payload.reachable, false);
});

test('the MCP status tool says why the proxy does not answer, and does not fail', async (t) => {
  const dir = makeTempDir('gatewarden-unknown-proxy-mcp-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const configPath = path.join(dir, 'config.json');
  const registryPort = await freePort();
  const relayPort = await freePort();
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        proxy: 'caddy',
        registryPort,
        relayPort,
        advertisedIp: '127.0.0.1',
        advertisedHost: '127.0.0.1',
        zone: 'gwtest.local',
        entryPoints: ['websecure'],
        certResolver: 'testca',
        secret: '',
        stateDir: dir,
        allowedCidrs: ['127.0.0.1/32', '::1/128'],
      },
      null,
      2,
    ),
  );

  const server = new McpServer({ configPath, stateDir: dir });
  // The daemon that the tool starts runs in the throwaway directory and
  // in nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // read it nor write to it.
  const isolation = isolate(dir);
  const response = await isolation.run(() =>
    server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'dev_gateway_status', arguments: {} },
    }),
  );

  assert.ok(response && 'result' in response);
  const result = response.result as {
    isError: boolean;
    structuredContent?: {
      proxy: { id: string; reachable: boolean; reason?: string };
      reachable: boolean;
      reason?: string;
    };
  };

  // The tool reports: it does not fail because the proxy id is wrong.
  assert.equal(result.isError, false);

  const status = result.structuredContent;
  assert.ok(status, 'the tool answered with a status');
  assert.equal(status.proxy.id, 'caddy');
  assert.equal(status.proxy.reachable, false);
  // The reason is in the proxy, and at the top of the answer, so that an
  // agent reads why without looking into the proxy.
  assert.equal(status.proxy.reason, UNKNOWN_PROXY_REASON);
  assert.equal(status.reason, UNKNOWN_PROXY_REASON);
  assert.equal(status.reachable, false);

  // The answer is inside the schema the tool declares: a client that
  // validates the answer against it accepts the answer.
  const tool = TOOLS.find((entry) => entry.name === 'dev_gateway_status');
  assert.ok(tool, 'the status tool is missing');
  const validator = new AjvJsonSchemaValidator();
  // The schema of the tool is a JSON Schema of this package; the
  // validator of the SDK wants the schema in its own type.
  const schema = tool.outputSchema as unknown as Parameters<
    typeof validator.getValidator
  >[0];
  const validation = validator.getValidator(schema)(status);
  assert.equal(validation.valid, true, validation.errorMessage);
});
