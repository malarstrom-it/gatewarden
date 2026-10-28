/**
 * The CLI: the commands that were there before, and their JSON output.
 *
 * Every test runs against a throwaway installation (see
 * `test/helpers/cli.ts`): a temporary directory, free ports, and a home
 * directory of its own. The gateway that runs on the user's machine is
 * never touched.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/core/state.ts';
import { LEGACY_CLI, REPO_ROOT, makeCliFixture } from './helpers/cli.ts';

test('register starts the daemon and records the registration', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const output = await cli.run(['register', '--project', 'probe', '--branch', 'feature/login', '--port', '3999']);
  assert.match(output, /main\.probe|feature-login\.probe/);
  assert.match(output, /https:\/\/feature-login\.probe\.gwtest\.local/);

  const store = new RegistrationStore(cli.dir);
  const registrations = store.list();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].devPort, 3999);
  assert.equal(registrations[0].fqdn, 'feature-login.probe.gwtest.local');
});

test('registering the same project and branch twice keeps one registration', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);
  await cli.run(['register', '--project', 'probe', '--branch', 'main', '--port', '4000']);

  const store = new RegistrationStore(cli.dir);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].devPort, 4000);
});

test('list and status report the state, unregister removes it', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);

  const list = await cli.run(['list']);
  assert.match(list, /probe/);
  assert.match(list, /main\.probe\.gwtest\.local/);

  const status = await cli.run(['status']);
  assert.match(status, /daemon:\s+running/);
  assert.match(status, /registrations: 1/);

  await cli.run(['unregister', '--project', 'probe', '--branch', 'main']);
  const after = await cli.run(['list']);
  assert.match(after, /no registrations/);
});

test('register refuses when no zone is configured', async (t) => {
  const cli = await makeCliFixture({ config: { zone: '' } });
  t.after(() => cli.cleanup());

  const result = await cli.runFail(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);
  assert.equal(result.code, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /no DNS zone is configured/);
  assert.match(result.stderr, /dev-gateway setup/, 'the error does not say how to get a zone');

  // Nothing was registered: a route without a zone has no name.
  const store = new RegistrationStore(cli.dir);
  assert.equal(store.list().length, 0);
});

test('register rejects invalid input', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const badPort = await cli.runFail(['register', '--project', 'probe', '--branch', 'main', '--port', 'abc']);
  assert.equal(badPort.code, 2);
  assert.match(badPort.stderr, /invalid --port/);

  const missing = await cli.runFail(['register', '--project', 'probe']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /register needs --project, --branch and --port/);
});

test('unregister says when there is nothing to unregister', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const result = await cli.runFail(['unregister', '--project', 'probe', '--branch', 'main']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not registered/);
});

test('config shows every key and writes the file', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const shown = await cli.run(['config']);
  assert.match(shown, /config file:/);
  assert.match(shown, /zone = "gwtest\.local"/);

  // A marker in the file proves that `--write` rewrote it.
  const raw = JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as Record<string, unknown>;
  raw['marker'] = true;
  fs.writeFileSync(cli.configPath, JSON.stringify(raw, null, 2));

  await cli.run(['config', '--write']);
  const parsed = JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as Record<string, unknown>;
  assert.equal(parsed.zone, 'gwtest.local');
  assert.equal((parsed['registryPort'] as number) > 0, true);
  assert.equal(parsed['marker'], undefined, 'the file was not rewritten');
});

test('migrate reports that there is nothing to migrate', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const output = await cli.run(['migrate']);
  assert.match(output, /nothing to migrate/);
});

test('list --json is machine-readable', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);

  const result = await cli.runFail(['list', '--json']);
  assert.equal(result.code, 0);

  const parsed = JSON.parse(result.stdout) as {
    routes: Array<{ project: string; branch: string; port: number; fqdn: string; url: string; state: string }>;
  };
  assert.equal(Array.isArray(parsed.routes), true);
  assert.equal(parsed.routes.length, 1);
  assert.equal(parsed.routes[0].project, 'probe');
  assert.equal(parsed.routes[0].branch, 'main');
  assert.equal(parsed.routes[0].port, 3999);
  assert.equal(parsed.routes[0].fqdn, 'main.probe.gwtest.local');
  assert.equal(parsed.routes[0].url, 'https://main.probe.gwtest.local');
  assert.equal(parsed.routes[0].state, 'down');
});

test('list --json of an empty installation is an empty list', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const parsed = await cli.runJson<{ routes: unknown[] }>(['list', '--json']);
  assert.deepEqual(parsed.routes, []);
});

test('status --json reports the daemon, the configuration and the proxy', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['start']);

  const parsed = await cli.runJson<{
    daemon: { running: boolean; pid: number | null; healthy: boolean; pidFile: string };
    reachable: boolean;
    proxy: { id: string; reachable: boolean };
    config: { path: string; zone: string; registryPort: number };
    routes: number;
    // The keys the old CLI wrote at the top level.
    configPath: string;
    stateDir: string;
    logFile: string;
    cacheDir: string;
    registryPort: number;
    relayPort: number;
    advertisedIp: string;
    zone: string;
    entryPoints: string[];
    certResolver: string;
    secretConfigured: boolean;
    registrations: number;
  }>(['status', '--json']);

  assert.equal(parsed.daemon.running, true);
  assert.equal(typeof parsed.daemon.pid, 'number');
  assert.equal(parsed.reachable, true);
  assert.equal(parsed.proxy.id, 'traefik');
  assert.equal(parsed.config.zone, 'gwtest.local');
  assert.equal(parsed.config.path, cli.configPath);
  assert.equal(parsed.routes, 0);

  // The old shape is still there: a script written against the previous
  // CLI keeps reading the keys it knows.
  assert.equal(parsed.configPath, cli.configPath);
  assert.equal(parsed.stateDir, cli.dir);
  assert.equal(parsed.zone, 'gwtest.local');
  assert.deepEqual(parsed.entryPoints, ['websecure']);
  assert.equal(parsed.certResolver, 'testca');
  assert.equal(parsed.secretConfigured, false);
  assert.equal(parsed.registrations, 0);
  assert.equal(typeof parsed.registryPort, 'number');
  assert.equal(typeof parsed.relayPort, 'number');
  assert.equal(typeof parsed.advertisedIp, 'string');
  assert.equal(typeof parsed.logFile, 'string');
  assert.equal(typeof parsed.cacheDir, 'string');
});

test('the global options work before the command', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  await cli.run(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);

  const parsed = await cli.runJson<{ routes: unknown[] }>(['--json', 'list']);
  assert.equal(parsed.routes.length, 1);

  const shown = await cli.run(['--json', 'version']);
  assert.match(shown.trim(), /^\d+\.\d+\.\d+/);
});

test('register --json and unregister --json answer with the route', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const registered = await cli.runJson<{ url: string; fqdn: string; port: number; state: string }>([
    'register',
    '--project',
    'probe',
    '--branch',
    'main',
    '--port',
    '3999',
    '--json',
  ]);
  assert.equal(registered.url, 'https://main.probe.gwtest.local');
  assert.equal(registered.fqdn, 'main.probe.gwtest.local');
  assert.equal(registered.port, 3999);
  assert.equal(registered.state, 'down');

  const removed = await cli.runJson<{ removed: boolean; fqdn?: string }>([
    'unregister',
    '--project',
    'probe',
    '--branch',
    'main',
    '--json',
  ]);
  assert.equal(removed.removed, true);
  assert.equal(removed.fqdn, 'main.probe.gwtest.local');
});

test('config --json writes the configuration as JSON', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const parsed = await cli.runJson<{ path: string; config: { zone: string; proxy: string } }>([
    'config',
    '--json',
  ]);
  assert.equal(parsed.path, cli.configPath);
  assert.equal(parsed.config.zone, 'gwtest.local');
  assert.equal(parsed.config.proxy, 'traefik');
});

test('migrate --json reports what it moved', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const parsed = await cli.runJson<{ migrated: boolean; legacyDir: string }>(['migrate', '--json']);
  assert.equal(typeof parsed.migrated, 'boolean');
  assert.match(parsed.legacyDir, /\.traefik-dev$/);
});

test('the old binary name still works, and so do the old command names', async (t) => {
  const cli = await makeCliFixture({ cli: LEGACY_CLI });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const output = await cli.run(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);
  assert.match(output, /https:\/\/main\.probe\.gwtest\.local/);

  const list = await cli.run(['list']);
  assert.match(list, /main\.probe\.gwtest\.local/);

  const status = await cli.run(['status']);
  assert.match(status, /daemon:\s+running/);

  const config = await cli.run(['config']);
  assert.match(config, /config file:/);

  const migrated = await cli.run(['migrate']);
  assert.match(migrated, /nothing to migrate/);
});

test('version prints the version of the package', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };

  const output = await cli.run(['version']);
  assert.equal(output.trim(), manifest.version);
});

test('help lists the commands of the specification', async (t) => {
  const cli = await makeCliFixture();
  t.after(() => cli.cleanup());

  const output = await cli.run(['help']);
  for (const command of [
    'register',
    'unregister',
    'list',
    'status',
    'config',
    'setup',
    'start',
    'stop',
    'doctor',
    'install-service',
    'migrate',
  ]) {
    assert.match(output, new RegExp(`dev-gateway ${command}`), `${command} is missing from the help`);
  }
});
