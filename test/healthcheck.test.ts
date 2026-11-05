/**
 * The healthcheck of the package: `gatewarden doctor` (§9.9).
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-health-'));
}

/**
 * Run the CLI against a throwaway directory.
 *
 * The home directory, the XDG directories and the state directory all
 * point into the throwaway directory: nothing of the machine the tests
 * run on decides where the gateway looks.
 */
async function runCli(
  dir: string,
  args: string[],
  opts: { configPath?: boolean; env?: Record<string, string> } = {},
): Promise<Run> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: path.join(dir, 'home'),
    XDG_CONFIG_HOME: path.join(dir, 'config'),
    XDG_STATE_HOME: path.join(dir, 'state'),
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    GATEWARDEN_STATE_DIR: path.join(dir, 'state'),
    ...(opts.env ?? {}),
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

/**
 * Run the CLI and parse its JSON.
 */
async function runJson<T = Report>(
  dir: string,
  args: string[],
  opts: { env?: Record<string, string> } = {},
): Promise<{ run: Run; report: T }> {
  const run = await runCli(dir, [...args, '--json'], opts);
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

/** A route of a route store, as the store writes it. */
function aRoute(name: string, zone: string, devPort: number): Record<string, unknown> {
  return {
    id: name,
    project: name,
    branch: 'main',
    projectSlug: name,
    branchSlug: 'main',
    fqdn: `${name}.${zone}`,
    zone,
    devPort,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
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
  assert.match(daemon?.detail ?? '', /gatewarden start/);
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
  assert.equal(report.ok, true);
});

test('the doctor warns when the address of the proxy is not in the trust list', async (t) => {
  // The trust list (`allowedCidrs`) holds the addresses that may talk
  // to the gateway, and the listeners decide with the source address of
  // the caller: the address of the proxy has to be in the list. A proxy
  // that is not in it gets a 403 from both listeners, and it is the
  // most common reason for one.
  //
  // The address of this machine (the one the gateway advertises) is
  // not the address of the proxy, and it is not the one the list is
  // about: the warning names the address the proxy connects from.
  //
  // An installation without the right address in the list is not
  // broken: it refuses its proxy. That is a warning, not an error.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, {
    zone: undefined,
    advertisedIp: '198.51.100.7',
    advertisedHost: '198.51.100.7',
    allowedCidrs: ['127.0.0.1/32', '::1/128'],
  });

  const { run, report } = await runJson(dir, ['doctor'], {
    env: { GATEWARDEN_PROXY_API_URL: 'http://192.0.2.10:8080' },
  });

  const address = report.checks.find((check) => check.name === 'proxy address');
  assert.equal(address?.status, 'warn', `the doctor says: ${address?.detail}`);
  assert.match(address?.detail ?? '', /192\.0\.2\.10/, 'the reason does not name the address of the proxy');
  assert.doesNotMatch(
    address?.detail ?? '',
    /198\.51\.100\.7/,
    'the reason names the address of this machine, and not the one of the proxy',
  );
  assert.match(address?.detail ?? '', /allowedCidrs/, 'the reason does not name the trust list');
  // A warning is not an error: the doctor still exits 0.
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor says nothing when the address of the proxy is in the trust list', async (t) => {
  // The address this machine advertises is not in the list, and that is
  // right: the list is about the proxy, not about this machine. The
  // doctor has nothing to say about it.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, {
    zone: undefined,
    advertisedIp: '198.51.100.7',
    advertisedHost: '198.51.100.7',
    allowedCidrs: ['127.0.0.1/32', '::1/128', '192.0.2.10/32'],
  });

  const { run, report } = await runJson(dir, ['doctor'], {
    env: { GATEWARDEN_PROXY_API_URL: 'http://192.0.2.10:8080' },
  });

  const address = report.checks.find((check) => check.name === 'proxy address');
  assert.equal(address?.status, 'ok', `the doctor says: ${address?.detail}`);
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor warns when the trust list holds nothing but the loopback', async (t) => {
  // The doctor does not always know where the proxy is: the address of
  // the proxy's API is not in the configuration. What it knows is the
  // list: a list that holds the loopback and nothing else is a list
  // that no proxy on another machine is in, and that proxy is refused
  // with a 403.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, {
    zone: undefined,
    allowedCidrs: ['127.0.0.1/32', '::1/128'],
  });

  const { run, report } = await runJson(dir, ['doctor']);

  const address = report.checks.find((check) => check.name === 'proxy address');
  assert.equal(address?.status, 'warn', `the doctor says: ${address?.detail}`);
  assert.match(address?.detail ?? '', /403/, 'the reason does not say what the proxy gets');
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor prints the trust list in the report', async (t) => {
  // The list is the answer to the question a user asks when a listener
  // answers a 403: which addresses may talk with the gateway?
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: undefined, allowedCidrs: ['127.0.0.1/32', '::1/128', '192.0.2.0/24'] });

  const { report } = await runJson(dir, ['doctor']);

  const list = report.checks.find((check) => check.name === 'trust list');
  assert.equal(list?.status, 'ok', `the doctor says: ${list?.detail}`);
  assert.match(list?.detail ?? '', /allowedCidrs/, 'the reason does not name the trust list');
  assert.match(list?.detail ?? '', /192\.0\.2\.0\/24/, 'the list is not in the report');
});

test('the doctor says that an empty trust list trusts nobody', async (t) => {
  // An empty trust list is not an error either: it is an installation
  // that trusts nobody, and the doctor says that in plain words.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: undefined, allowedCidrs: [] });

  const { run, report } = await runJson(dir, ['doctor']);

  const list = report.checks.find((check) => check.name === 'trust list');
  assert.equal(list?.status, 'warn', `the doctor says: ${list?.detail}`);
  assert.match(list?.detail ?? '', /empty/, 'the reason does not say that the list is empty');
  assert.match(
    list?.detail ?? '',
    /no address may talk to the gateway|the configuration file is empty/,
    'the reason does not say what it means',
  );
  // The proxy is not in an empty list either.
  const address = report.checks.find((check) => check.name === 'proxy address');
  assert.equal(address?.status, 'warn', `the doctor says: ${address?.detail}`);
  assert.match(address?.detail ?? '', /empty/, 'the reason does not say that the list is empty');
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor prints the trust list of the registry in the report', async (t) => {
  // The registry has a list of its own, on top of the relay's: an
  // address that may only read the configuration document does not have
  // to be allowed to dispatch. The doctor prints both lists, so that an
  // installation that has filled the list of the registry sees those
  // addresses somewhere.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, {
    zone: undefined,
    allowedCidrs: ['127.0.0.1/32', '::1/128'],
    registryAllowedCidrs: ['192.0.2.0/24'],
  });

  const { run, report } = await runJson(dir, ['doctor']);

  const list = report.checks.find((check) => check.name === 'registry list');
  assert.equal(list?.status, 'ok', `the doctor says: ${list?.detail}`);
  assert.match(
    list?.detail ?? '',
    /registryAllowedCidrs/,
    'the reason does not name the trust list of the registry',
  );
  assert.match(list?.detail ?? '', /192\.0\.2\.0\/24/, 'the list of the registry is not in the report');
  assert.doesNotMatch(list?.detail ?? '', /is empty/, 'the doctor says the list is empty');
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor says that an empty trust list of the registry serves the same addresses as the relay', async (t) => {
  // An empty list of the registry is the default, and it means that the
  // registry serves the configuration document to the same addresses as
  // the relay. The doctor says that in plain words, so that the reader
  // sees that the list is empty and knows what it means.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, { zone: undefined, registryAllowedCidrs: [] });

  const { run, report } = await runJson(dir, ['doctor']);

  const list = report.checks.find((check) => check.name === 'registry list');
  assert.equal(list?.status, 'ok', `the doctor says: ${list?.detail}`);
  assert.match(
    list?.detail ?? '',
    /registryAllowedCidrs/,
    'the reason does not name the trust list of the registry',
  );
  assert.match(list?.detail ?? '', /empty/, 'the reason does not say that the list is empty');
  assert.match(list?.detail ?? '', /the relay/, 'the reason does not say what an empty list means');
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor warns about the address of the proxy even when the registry list holds it', async (t) => {
  // The list of the registry is on top of the relay's: an address that
  // is only in it reaches the configuration document and not the relay,
  // and the relay is the one the proxy dispatches through. The warning
  // is about the relay's list, so it stands.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, {
    zone: undefined,
    advertisedIp: '198.51.100.7',
    advertisedHost: '198.51.100.7',
    allowedCidrs: ['127.0.0.1/32', '::1/128'],
    registryAllowedCidrs: ['192.0.2.10/32'],
  });

  const { run, report } = await runJson(dir, ['doctor'], {
    env: { GATEWARDEN_PROXY_API_URL: 'http://192.0.2.10:8080' },
  });

  const address = report.checks.find((check) => check.name === 'proxy address');
  assert.equal(address?.status, 'warn', `the doctor says: ${address?.detail}`);
  assert.match(address?.detail ?? '', /192\.0\.2\.10/, 'the reason does not name the address of the proxy');
  assert.match(address?.detail ?? '', /allowedCidrs/, 'the reason does not name the trust list');
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor skips the address of the proxy when it does not know where the proxy is', async (t) => {
  // A thing that is not there is not an error. The doctor cannot name
  // the address of the proxy, and the trust list holds addresses besides
  // the loopback: there is nothing to compare, so the check is skipped.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await writeConfig(dir, {
    zone: undefined,
    allowedCidrs: ['127.0.0.1/32', '::1/128', '192.0.2.10/32'],
  });

  const { run, report } = await runJson(dir, ['doctor']);

  const address = report.checks.find((check) => check.name === 'proxy address');
  assert.equal(address?.status, 'skipped', `the doctor says: ${address?.detail}`);
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
});

test('the doctor skips the trust list when there is no installation here', async (t) => {
  // Nothing is set up here: there is no trust list to print and no
  // address to compare with one.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { run, report } = await runJson(dir, ['doctor']);

  for (const name of ['trust list', 'registry list', 'proxy address']) {
    const check = report.checks.find((entry) => entry.name === name);
    assert.equal(check?.status, 'skipped', `the doctor says: ${check?.detail}`);
  }
  assert.equal(run.code, 0, `the exit code was ${run.code}: ${run.stdout}${run.stderr}`);
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
  assert.match(run.stdout, /not installed: run "gatewarden install-service"/);
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
  assert.match(zone?.detail ?? '', /gatewarden setup/);
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
  assert.match(zone?.detail ?? '', /gatewarden setup/);

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
  assert.match(config?.detail ?? '', /gatewarden migrate/);

  const zone = report.checks.find((check) => check.name === 'dns zone');
  assert.equal(zone?.status, 'ok', `the doctor says: ${zone?.detail}`);

  const daemon = report.checks.find((check) => check.name === 'daemon');
  assert.equal(daemon?.status, 'warn', `the doctor says: ${daemon?.detail}`);
});

test('the doctor says that the layout of the old name is still there', async (t) => {
  // An installation that was made under the name the directories had
  // before the rename is an installation: it is checked, and the doctor
  // says that the migration is waiting.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const oldConfigDir = path.join(dir, 'config', 'dev-gateway');
  fs.mkdirSync(oldConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(oldConfigDir, 'config.json'),
    JSON.stringify({
      proxy: 'traefik',
      registryPort: 45102,
      relayPort: 45101,
      zone: 'oldname.test',
      stateDir: path.join(dir, 'state'),
    }),
  );

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const layout = report.checks.find((check) => check.name === 'old name layout');
  assert.equal(layout?.status, 'warn', `the doctor says: ${layout?.detail}`);
  assert.match(layout?.detail ?? '', /gatewarden migrate/);

  const config = report.checks.find((check) => check.name === 'config file');
  assert.equal(config?.status, 'warn', `the doctor says: ${config?.detail}`);
  assert.match(config?.detail ?? '', /gatewarden migrate/);

  // The installation is here: its zone is read from the old file.
  const zone = report.checks.find((check) => check.name === 'dns zone');
  assert.equal(zone?.status, 'ok', `the doctor says: ${zone?.detail}`);
});

test('the doctor does not warn about the old layout after a migration', async (t) => {
  // The migration copies the configuration file and the route store into
  // the new layout and leaves the old directory where it is. The doctor
  // asks whether something in that directory is still waiting to be
  // migrated: nothing is, so there is no warning — and the reason says
  // that the old directory may stay where it is.
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
      zone: 'migrated.test',
      stateDir: path.join(dir, 'state'),
    }),
  );
  fs.writeFileSync(path.join(legacy, 'registrations.json'), JSON.stringify({ registrations: [] }));

  const migrate = await runCli(dir, ['migrate'], { configPath: false });
  assert.equal(migrate.code, 0, `the migration failed: ${migrate.stdout}${migrate.stderr}`);
  assert.ok(fs.existsSync(legacy), 'the migration leaves the old directory in place');

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const layout = report.checks.find((check) => check.name === 'legacy layout');
  assert.equal(layout?.status, 'ok', `the doctor says: ${layout?.detail}`);
  assert.match(layout?.detail ?? '', /everything the old layout held came over/);
  assert.match(layout?.detail ?? '', /can be left in place or removed by you/);
  assert.doesNotMatch(layout?.detail ?? '', /gatewarden migrate/);
});

test('the doctor still warns about the old files that were not migrated', async (t) => {
  // The new layout has a configuration file of its own, but no route
  // store: the route store of the old layout is still waiting, and the
  // doctor says what it is and where it belongs.
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
  fs.writeFileSync(path.join(legacy, 'registrations.json'), JSON.stringify({ registrations: [] }));

  const configDir = path.join(dir, 'config', 'gatewarden');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      proxy: 'traefik',
      registryPort: 45102,
      relayPort: 45101,
      zone: 'new.test',
      stateDir: path.join(dir, 'state'),
    }),
  );

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const layout = report.checks.find((check) => check.name === 'legacy layout');
  assert.equal(layout?.status, 'warn', `the doctor says: ${layout?.detail}`);
  assert.match(layout?.detail ?? '', /route store/);
  assert.match(layout?.detail ?? '', /has not been migrated/);
  assert.match(layout?.detail ?? '', /gatewarden migrate/);
});

test('the doctor does not tell a home with both layouts to remove the old directory', async (t) => {
  // A home that holds both old layouts. The layout of the old name is
  // the newer one, so the migration moves it first and leaves the route
  // store of the older layout behind: the target is taken. The file is
  // in the new layout and its routes are not, so the doctor must not
  // tell the user to remove a directory that holds the only copy of
  // routes that never came over.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const oldConfigDir = path.join(dir, 'config', 'dev-gateway');
  const oldStateDir = path.join(dir, 'state', 'dev-gateway');
  const legacy = path.join(dir, 'home', '.traefik-dev');
  fs.mkdirSync(oldConfigDir, { recursive: true });
  fs.mkdirSync(oldStateDir, { recursive: true });
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(
    path.join(oldConfigDir, 'config.json'),
    JSON.stringify({
      proxy: 'traefik',
      registryPort: 45102,
      relayPort: 45101,
      zone: 'new.test',
      stateDir: path.join(dir, 'state'),
    }),
  );
  fs.writeFileSync(
    path.join(oldStateDir, 'routes.json'),
    JSON.stringify({ version: 1, registrations: [aRoute('new', 'new.test', 3000)] }),
  );
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
  fs.writeFileSync(
    path.join(legacy, 'registrations.json'),
    JSON.stringify({ version: 1, registrations: [aRoute('old', 'legacy.test', 3001)] }),
  );

  const migrate = await runCli(dir, ['migrate'], { configPath: false });
  assert.equal(migrate.code, 0, `the migration failed: ${migrate.stdout}${migrate.stderr}`);

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  // The route store of the older layout holds a route that the new route
  // store does not hold: the doctor names it and keeps the old
  // directory where it is.
  const layout = report.checks.find((check) => check.name === 'legacy layout');
  assert.equal(layout?.status, 'warn', `the doctor says: ${layout?.detail}`);
  assert.match(layout?.detail ?? '', /old\.legacy\.test:3001/);
  assert.match(layout?.detail ?? '', /must not be removed/);
  assert.doesNotMatch(layout?.detail ?? '', /can be left in place or removed by you/);

  // The newer layout came over whole: its directories may go.
  const oldName = report.checks.find((check) => check.name === 'old name layout');
  assert.equal(oldName?.status, 'ok', `the doctor says: ${oldName?.detail}`);
  assert.match(oldName?.detail ?? '', /can be left in place or removed by you/);
});

test('the doctor tells a home where everything came over to remove the old directory', async (t) => {
  // The same home, with the older layout holding what the newer one
  // holds: the routes of the older layout are in the new route store,
  // and its settings are the settings of the new configuration file.
  // Nothing was left behind, so the doctor may tell the user that the
  // old directories can go.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const oldConfigDir = path.join(dir, 'config', 'dev-gateway');
  const oldStateDir = path.join(dir, 'state', 'dev-gateway');
  const legacy = path.join(dir, 'home', '.traefik-dev');
  fs.mkdirSync(oldConfigDir, { recursive: true });
  fs.mkdirSync(oldStateDir, { recursive: true });
  fs.mkdirSync(legacy, { recursive: true });
  const settings = {
    proxy: 'traefik',
    registryPort: 45102,
    relayPort: 45101,
    zone: 'same.test',
    stateDir: path.join(dir, 'state'),
  };
  fs.writeFileSync(path.join(oldConfigDir, 'config.json'), JSON.stringify(settings));
  fs.writeFileSync(
    path.join(oldStateDir, 'routes.json'),
    JSON.stringify({ version: 1, registrations: [aRoute('same', 'same.test', 3000)] }),
  );
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify(settings));
  fs.writeFileSync(
    path.join(legacy, 'registrations.json'),
    JSON.stringify({ version: 1, registrations: [aRoute('same', 'same.test', 3000)] }),
  );

  const migrate = await runCli(dir, ['migrate'], { configPath: false });
  assert.equal(migrate.code, 0, `the migration failed: ${migrate.stdout}${migrate.stderr}`);

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const layout = report.checks.find((check) => check.name === 'legacy layout');
  assert.equal(layout?.status, 'ok', `the doctor says: ${layout?.detail}`);
  assert.match(layout?.detail ?? '', /everything the old layout held came over/);
  assert.match(layout?.detail ?? '', /can be left in place or removed by you/);
  assert.doesNotMatch(layout?.detail ?? '', /must not be removed/);
});

test('the doctor does not warn about the state directory of the old layout', async (t) => {
  // The state directory is the one the new layout resolves for itself:
  // the migration writes the state directory of the new installation,
  // and not the one the old file names. An old file that names another
  // one does not hold a setting that was left behind.
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
      zone: 'migrated.test',
      stateDir: path.join(dir, 'other-state'),
    }),
  );
  fs.writeFileSync(
    path.join(legacy, 'registrations.json'),
    JSON.stringify({ version: 1, registrations: [aRoute('only', 'migrated.test', 3000)] }),
  );

  const migrate = await runCli(dir, ['migrate'], { configPath: false });
  assert.equal(migrate.code, 0, `the migration failed: ${migrate.stdout}${migrate.stderr}`);

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const layout = report.checks.find((check) => check.name === 'legacy layout');
  assert.equal(layout?.status, 'ok', `the doctor says: ${layout?.detail}`);
  assert.match(layout?.detail ?? '', /everything the old layout held came over/);
});

test('the doctor does not warn about the layout of the old name after a migration', async (t) => {
  // The same as the old layout: the migration copies the files into the
  // new layout and leaves the directories of the old name where they
  // are, and the warning goes away with them.
  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const oldConfigDir = path.join(dir, 'config', 'dev-gateway');
  const oldStateDir = path.join(dir, 'state', 'dev-gateway');
  fs.mkdirSync(oldConfigDir, { recursive: true });
  fs.mkdirSync(oldStateDir, { recursive: true });
  fs.writeFileSync(
    path.join(oldConfigDir, 'config.json'),
    JSON.stringify({
      proxy: 'traefik',
      registryPort: 45102,
      relayPort: 45101,
      zone: 'oldname.test',
      stateDir: path.join(dir, 'state'),
    }),
  );
  fs.writeFileSync(path.join(oldStateDir, 'routes.json'), JSON.stringify({ registrations: [] }));

  const migrate = await runCli(dir, ['migrate'], { configPath: false });
  assert.equal(migrate.code, 0, `the migration failed: ${migrate.stdout}${migrate.stderr}`);
  assert.ok(fs.existsSync(oldConfigDir), 'the migration leaves the old directories in place');

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const layout = report.checks.find((check) => check.name === 'old name layout');
  assert.equal(layout?.status, 'ok', `the doctor says: ${layout?.detail}`);
  assert.match(layout?.detail ?? '', /everything the old layout held came over/);
  assert.match(layout?.detail ?? '', /can be left in place or removed by you/);
  assert.doesNotMatch(layout?.detail ?? '', /gatewarden migrate/);
});

test('the doctor says that the unit of the old name is still there', async (t) => {
  // A unit that was installed before the rename is still on the machine.
  // It names a launcher that does not exist any more, so the daemon it
  // would start is never started: the doctor has to say so.
  if (process.platform === 'win32') {
    t.skip('the scheduled task of the old name is not a file on the disk');
    return;
  }

  const dir = makeEmptyDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const unitPath =
    process.platform === 'darwin'
      ? path.join(dir, 'home', 'Library', 'LaunchAgents', 'dev.mal.arstrom.dev-gateway.plist')
      : path.join(dir, 'home', '.config', 'systemd', 'user', 'dev-gateway.service');
  fs.mkdirSync(path.dirname(unitPath), { recursive: true });
  fs.writeFileSync(unitPath, '[Unit]\nDescription=dev-gateway\n');

  const run = await runCli(dir, ['doctor', '--json'], { configPath: false });
  const report = JSON.parse(run.stdout) as Report;

  const service = report.checks.find((check) => check.name === 'old service');
  assert.equal(service?.status, 'warn', `the doctor says: ${service?.detail}`);
  assert.match(service?.detail ?? '', /dev-gateway/);
  assert.match(service?.detail ?? '', /gatewarden install-service/);
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
  const certificate = makeCertificate('*.gatewarden-setup.localhost');
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
