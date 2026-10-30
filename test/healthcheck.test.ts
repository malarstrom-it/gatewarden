/**
 * The healthcheck of the package: `dev-gateway doctor` (§9.9).
 *
 * The doctor has to work everywhere: in a container without a proxy, a
 * zone, a daemon and a public URL, and on a machine with an installation
 * that is broken. The tests run against throwaway directories and free
 * ports; the gateway of the user is never touched.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { CLI, freePort, makeCliFixture } from './helpers/cli.ts';
import { makeCertificate } from './helpers/cert.ts';
import { FakeTraefik } from './helpers/proxy.ts';

const execFileAsync = promisify(execFile);

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skipped';
  detail: string;
}

interface Report {
  ok: boolean;
  strict: boolean;
  checks: Check[];
  paths: { configPath: string; stateDir: string; logFile: string };
}

/** A throwaway directory that holds nothing. */
function makeEmptyDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-health-'));
}

/**
 * Run the CLI against a throwaway directory.
 *
 * The home directory, the XDG directories and the state directory all
 * point into the throwaway directory: nothing of the machine the tests
 * run on decides where the gateway looks.
 */
async function runCli(dir: string, args: string[], opts: { configPath?: boolean } = {}): Promise<Run> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: path.join(dir, 'home'),
    XDG_CONFIG_HOME: path.join(dir, 'config'),
    XDG_STATE_HOME: path.join(dir, 'state'),
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    DEV_GATEWAY_STATE_DIR: path.join(dir, 'state'),
  };
  const cliArgs = [...args];
  if (opts.configPath !== false) {
    cliArgs.push('--config', path.join(dir, 'config.json'));
  }
  cliArgs.push('--state-dir', path.join(dir, 'state'));
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...cliArgs], { env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Run the CLI and parse its JSON. */
async function runJson<T = Report>(
  dir: string,
  args: string[],
): Promise<{ run: Run; report: T }> {
  const run = await runCli(dir, [...args, '--json']);
  let report: T;
  try {
    report = JSON.parse(run.stdout) as T;
  } catch (error) {
    throw new Error(
      `the CLI did not write JSON (exit ${run.code}): ${run.stdout}${run.stderr}\n${(error as Error).message}`,
    );
  }
  return { run, report };
}

/** Write a configuration file for a throwaway installation. */
async function writeConfig(dir: string, values: Record<string, unknown> = {}): Promise<void> {
  const registryPort = await freePort();
  const relayPort = await freePort();
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(
      {
        proxy: 'traefik',
        registryPort,
        relayPort,
        advertisedIp: '127.0.0.1',
        advertisedHost: '127.0.0.1',
        zone: 'healthcheck.test',
        entryPoints: ['websecure'],
        certResolver: 'testca',
        middlewareProvider: 'file',
        allowedCidrs: ['127.0.0.1/32', '::1/128'],
        stateDir: dir,
        ...values,
      },
      null,
      2,
    ),
  );
}

test('the doctor reports where it stands in an empty environment and exits 0', async (t) => {
  // Nothing is set up here: no configuration file, no state directory,
  // no daemon, no proxy, no zone. The doctor still has to say where it
  // stands — and it must not fail, because the machine is not broken.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { run, report } = await runJson(dir, ['doctor']);

  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.ok(report.checks.length > 0, 'the doctor reported nothing at all');
  for (const check of report.checks) {
    assert.notEqual(check.status, 'fail', `the check "${check.name}" failed: ${check.detail}`);
    assert.ok(check.detail.length > 0, `the check "${check.name}" has no reason`);
  }
});

test('the doctor does not fail in an empty environment even with --strict', async (t) => {
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = await runCli(dir, ['doctor', '--strict']);
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the JSON form holds a post per check', async (t) => {
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { report } = await runJson(dir, ['doctor']);

  const names = report.checks.map((check) => check.name);
  for (const expected of [
    'config file',
    'state directory',
    'daemon',
    'dns zone',
    'registry port',
    'relay port',
    'routes',
    'proxy',
    'service',
  ]) {
    assert.ok(names.includes(expected), `${expected} is missing from the report`);
  }
  for (const check of report.checks) {
    assert.ok(check.name.length > 0, 'a check has no name');
    assert.ok(['ok', 'warn', 'fail', 'skipped'].includes(check.status), `unknown status: ${check.status}`);
    assert.ok(check.detail.length > 0, `the check "${check.name}" has no reason`);
  }
  assert.ok(report.paths.configPath.length > 0);
  assert.ok(report.paths.stateDir.length > 0);
});

test('the doctor does not fail because the daemon has not started', async (t) => {
  // The daemon starts by itself with the first route (D7): a daemon that
  // does not run is not an error, it is a warning with a reason.
  //
  // The configuration file does not declare a zone here: the
  // installation has not declared itself, so nothing of it is an error.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: undefined });

  const { run, report } = await runJson(dir, ['doctor']);

  const daemon = report.checks.find((check) => check.name === 'daemon');
  assert.equal(daemon?.status, 'warn', `the doctor says: ${daemon?.detail}`);
  assert.match(daemon?.detail ?? '', /dev-gateway start/);
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
  assert.equal(report.ok, true);
});

test('--strict gives exit 1 when a check really fails', async (t) => {
  // A configuration file that cannot be read is a real error: the file
  // is there and it is broken.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'config.json'), '{ this is not json');

  const strict = await runCli(dir, ['doctor', '--strict']);
  assert.equal(strict.code, 1, `the exit code was ${strict.code}: ${strict.stdout}${strict.stderr}`);

  const { run, report } = await runJson(dir, ['doctor', '--strict']);
  assert.equal(report.ok, false);
  const config = report.checks.find((check) => check.name === 'config file');
  assert.equal(config?.status, 'fail', `the doctor says: ${config?.detail}`);
  assert.match(config?.detail ?? '', /cannot be read/);
  // A broken configuration file must not take the doctor down with it.
  assert.doesNotMatch(run.stderr, /at runHealthCheck/, 'the doctor died with a stack trace');

  // The error is an error in every mode: the strictness is about the
  // warnings, not about the errors.
  const plain = await runCli(dir, ['doctor']);
  assert.equal(plain.code, 1, `the exit code was ${plain.code}: ${plain.stdout}${plain.stderr}`);
});

test('--strict turns the warnings into errors', async (t) => {
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: undefined });

  const plain = await runCli(dir, ['doctor']);
  assert.equal(plain.code, 0, `the exit code was ${plain.code}: ${plain.stdout}${plain.stderr}`);

  const strict = await runCli(dir, ['doctor', '--strict']);
  assert.equal(strict.code, 1, `the exit code was ${strict.code}: ${strict.stdout}${strict.stderr}`);
});

test('the doctor says every reason in clear text', async (t) => {
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: undefined });

  const run = await runCli(dir, ['doctor']);
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
  // The service is not installed here, and the doctor says what to do
  // about it.
  assert.match(run.stdout, /not installed: run "dev-gateway install-service"/);
  // Every check is on a line of its own, with its status and its reason.
  const lines = run.stdout.split('\n').filter((line) => line.trim().length > 0);
  assert.ok(lines.length > 5, `the report is ${lines.length} lines long`);
  const checkLines = lines.slice(0, -1);
  for (const line of checkLines) {
    assert.match(line, /^(ok|warn|fail|skipped)\s/, `the line has no status: ${line}`);
  }
  assert.match(run.stdout, /nothing is broken/);
});

test('the status runs everywhere without failing', async (t) => {
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Nothing is set up here.
  const empty = await runCli(dir, ['status']);
  assert.equal(empty.code, 0, `the exit code was ${empty.code}: ${empty.stdout}${empty.stderr}`);

  // A configuration file that cannot be read is reported, not thrown.
  fs.writeFileSync(path.join(dir, 'config.json'), '{ this is not json');
  const broken = await runCli(dir, ['status']);
  assert.equal(broken.code, 0, `the exit code was ${broken.code}: ${broken.stdout}${broken.stderr}`);
  assert.match(broken.stdout, /cannot be read/);

  const { run, report } = await runJson(dir, ['status']);
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
  assert.equal((report as unknown as { error?: string }).error !== undefined, true);
});

test('the doctor does not fail because the zone is not set', async (t) => {
  // A zone that is not set is a part of the installation that is not
  // there yet — the setup wizard writes it, or the user writes it by
  // hand (§9.1). It is a warning, never a failure.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: undefined });

  const { run, report } = await runJson(dir, ['doctor']);

  const zone = report.checks.find((check) => check.name === 'dns zone');
  assert.equal(zone?.status, 'warn', `the doctor says: ${zone?.detail}`);
  assert.match(zone?.detail ?? '', /dev-gateway setup/);
  assert.equal(report.ok, true);
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor checks an installation that has declared itself', async (t) => {
  // A configuration file that declares a zone has declared an
  // installation: it is checked as one. A zone it declares and leaves
  // empty is a file that is wrong, and the daemon of an installation
  // that is set up has to run.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: '' });

  const { run, report } = await runJson(dir, ['doctor']);

  const zone = report.checks.find((check) => check.name === 'dns zone');
  assert.equal(zone?.status, 'fail', `the doctor says: ${zone?.detail}`);
  assert.match(zone?.detail ?? '', /dev-gateway setup/);

  const daemon = report.checks.find((check) => check.name === 'daemon');
  assert.equal(daemon?.status, 'fail', `the doctor says: ${daemon?.detail}`);
  assert.equal(report.ok, false);
  assert.equal(run.code, 1, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor checks an installation that lives in the old layout', async (t) => {
  // The installation of the old layout is an installation: its daemon,
  // its ports and its service are checked, not skipped. What is missing
  // is the configuration file of the new layout, and the doctor says
  // that the migration is waiting.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const legacy = path.join(dir, 'home', '.traefik-dev');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(
    path.join(legacy, 'config.json'),
    JSON.stringify({
      proxy: 'traefik',
      registryPort: 45102,
      relayPort: 45101,
      zone: 'legacy.test',
      stateDir: path.join(dir, 'state'),
    }),
  );

  // Without an explicit configuration file, the loader reads the old one.
  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const config = report.checks.find((check) => check.name === 'config file');
  assert.equal(config?.status, 'warn', `the doctor says: ${config?.detail}`);
  assert.match(config?.detail ?? '', /dev-gateway migrate/);

  const zone = report.checks.find((check) => check.name === 'dns zone');
  assert.equal(zone?.status, 'ok', `the doctor says: ${zone?.detail}`);

  const daemon = report.checks.find((check) => check.name === 'daemon');
  assert.equal(daemon?.status, 'warn', `the doctor says: ${daemon?.detail}`);
});

test('the status keeps its shape when the configuration file cannot be read', async (t) => {
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'config.json'), '{ this is not json');

  const { run, report } = await runJson<Record<string, unknown>>(dir, ['status']);

  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
  // The keys the normal form promises are there in this one as well.
  const config = report['config'] as Record<string, unknown>;
  assert.equal(typeof config['cacheDir'], 'string');
  assert.ok((config['cacheDir'] as string).length > 0, 'the cache directory is empty');
  assert.ok((config['logFile'] as string).length > 0, 'the log file is empty');
  assert.equal(config['exists'], true);
  assert.equal(typeof report['cacheDir'], 'string');
  assert.ok((report['cacheDir'] as string).length > 0);
  assert.ok(typeof report['error'] === 'string' && report['error'].length > 0, 'the error is not reported');
  // The normal form has no "ok": the two forms differ in the values, not
  // in the keys.
  assert.equal('ok' in report, false);
});

test('the setup tells a script that the chain answered with an error', async (t) => {
  const certificate = makeCertificate('*.dev-gateway-setup.localhost');
  if (!certificate) {
    t.skip('openssl is not there to make a certificate with');
    return;
  }

  // The proxy answers every public request with a 403 of its own: the
  // chain answered, and it answered with an error. That is a failed
  // verification, and the exit code says so in every mode.
  const cli = await makeCliFixture({
    config: { zone: 'localhost', advertisedHost: '127.0.0.1', advertisedIp: '127.0.0.1' },
    env: { NODE_EXTRA_CA_CERTS: certificate.certFile },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
    fs.rmSync(certificate.dir, { recursive: true, force: true });
  });

  const proxy = new FakeTraefik({
    tls: { key: certificate.key, cert: certificate.cert },
    refuse: true,
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const text = await cli.runFail(['setup', '--api-base-url', `http://127.0.0.1:${proxy.apiPort}`]);
  assert.equal(text.code, 1, `the exit code was ${text.code}: ${text.stdout}${text.stderr}`);

  const json = await cli.runFail(['setup', '--api-base-url', `http://127.0.0.1:${proxy.apiPort}`, '--json']);
  assert.equal(json.code, 1, `the exit code was ${json.code}: ${json.stdout}${json.stderr}`);
  const report = JSON.parse(json.stdout) as { verification: { status: string; reason?: string } };
  assert.equal(report.verification.status, 'failed');
});

test('the verification says what the public URL answered with', async (t) => {
  // A proxy whose public listener speaks plain HTTP and answers every
  // request with a 500. The chain answered, and the answer is the
  // reason: the HTTPS attempt that never got that far says nothing
  // about the certificate.
  const proxy = await startBrokenProxy();
  t.after(async () => {
    await proxy.stop();
  });

  const cli = await makeCliFixture({
    config: { zone: 'localhost', advertisedHost: '127.0.0.1', advertisedIp: '127.0.0.1' },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const result = await cli.runFail(['setup', '--api-base-url', `http://127.0.0.1:${proxy.apiPort}`, '--json']);
  const report = JSON.parse(result.stdout) as { verification: { status: string; reason?: string } };

  assert.equal(report.verification.status, 'failed', JSON.stringify(report.verification));
  assert.match(report.verification.reason ?? '', /answered with an error/);
  assert.match(report.verification.reason ?? '', /500/);
  assert.doesNotMatch(report.verification.reason ?? '', /certificate/, 'the reason is about the certificate');
});

/**
 * A proxy that answers the API and answers every public request with a
 * 500, over plain HTTP.
 *
 * The public port speaks no TLS: an HTTPS request to it fails in the
 * handshake, which says nothing about the certificate.
 */
async function startBrokenProxy(): Promise<{
  apiPort: number;
  stop: () => Promise<void>;
}> {
  const publicServer = http.createServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('broken\n');
  });
  const publicPort = await listen(publicServer);

  const api = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const json = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url === '/api/version') return json({ Version: '3.7.16' });
    if (url === '/api/http/routers') return json([]);
    if (url === '/api/http/services') return json([]);
    if (url === '/api/entrypoints') return json([{ name: 'websecure', address: `:${publicPort}` }]);
    res.writeHead(404);
    res.end('no');
  });
  const apiPort = await listen(api);

  return {
    apiPort,
    stop: async () => {
      await close(publicServer);
      await close(api);
    },
  };
}

/** Listen on a free port and answer with it. */
function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve(address.port);
    });
  });
}

/** Close a server and wait for it. */
function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}
