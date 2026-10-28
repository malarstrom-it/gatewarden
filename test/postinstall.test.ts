/**
 * The `postinstall` layer of the daemon lifecycle (§5.2).
 *
 * The script that runs after an install has one job: start the daemon once,
 * and never fail the install. The guards around it are the interesting
 * part, and they are what the tests are about.
 *
 * The tests that want the script to *do* something run it as an installed
 * package: a copy of the sources with a manifest that is not private. A
 * checkout is not an installation, and the script says so.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig } from '../src/core/config.ts';
import { isHealthy } from '../src/core/daemonControl.ts';
import { freePort } from './helpers/cli.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'postinstall.mjs');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runScript(script: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script], {
      env: { PATH: process.env['PATH'] ?? '', ...env },
      cwd: REPO_ROOT,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** A throwaway installation the script may work on. */
function makeHome(): { home: string; configPath: string; stateDir: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-postinstall-'));
  const stateDir = path.join(home, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  return { home, configPath: path.join(home, 'config.json'), stateDir };
}

/**
 * The package as it is installed: the sources, the script, and a manifest
 * that is not private.
 */
function makeInstalledPackage(): { dir: string; script: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-package-'));
  fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@malarstrom/agent-dev-gateway', version: '0.1.0' }, null, 2),
  );
  // The dependencies of the package, as npm installs them.
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return {
    dir,
    script: path.join(dir, 'scripts', 'postinstall.mjs'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** The environment of a throwaway installation. */
function environment(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    // The script must not see itself as a checkout: `INIT_CWD` is the
    // directory npm was called from, and a real installation is not the
    // package's own directory.
    INIT_CWD: home,
    ...extra,
  };
}

test('the script never fails the install', async () => {
  const home = makeHome();
  const installed = makeInstalledPackage();
  try {
    // A configuration file that cannot be read: the script has to swallow
    // the error and let the install finish.
    fs.writeFileSync(home.configPath, '{ this is not json\n');
    const result = await runScript(
      installed.script,
      environment(home.home, {
        DEV_GATEWAY_CONFIG: home.configPath,
        DEV_GATEWAY_STATE_DIR: home.stateDir,
      }),
    );
    assert.equal(result.code, 0, result.stderr);
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing when the scripts are ignored', async () => {
  const home = makeHome();
  const installed = makeInstalledPackage();
  try {
    await runScript(installed.script, environment(home.home, { npm_config_ignore_scripts: 'true' }));
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing in a CI', async () => {
  const home = makeHome();
  const installed = makeInstalledPackage();
  try {
    await runScript(installed.script, environment(home.home, { CI: 'true' }));
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing when the autostart is turned off', async () => {
  const home = makeHome();
  const installed = makeInstalledPackage();
  try {
    await runScript(installed.script, environment(home.home, { DEV_GATEWAY_AUTOSTART: '0' }));
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing in a checkout', async () => {
  const home = makeHome();
  try {
    // The package of the repository: a checkout holds the sources and the
    // build configuration, and a checkout is not an installation. The
    // `INIT_CWD` points somewhere else on purpose, so that the guard
    // that stops the script is the one that looks at the package itself.
    await runScript(SCRIPT, environment(home.home, { INIT_CWD: home.home }));
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing when the package is a checkout', async () => {
  const home = makeHome();
  const installed = makeInstalledPackage();
  try {
    // The sources and the build configuration are what make a directory a
    // checkout: the published package holds neither.
    fs.writeFileSync(path.join(installed.dir, 'tsconfig.build.json'), '{}');

    const result = await runScript(installed.script, environment(home.home));

    assert.equal(result.code, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script writes the configuration and starts the daemon', async (t) => {
  const home = makeHome();
  const installed = makeInstalledPackage();
  const registryPort = await freePort();
  const relayPort = await freePort();
  fs.writeFileSync(
    home.configPath,
    JSON.stringify(
      {
        registryPort,
        relayPort,
        advertisedIp: '127.0.0.1',
        advertisedHost: '127.0.0.1',
        zone: 'gwtest.local',
        entryPoints: ['websecure'],
        certResolver: 'testca',
        secret: '',
        stateDir: home.stateDir,
        documentFormat: 'yaml',
        autostart: true,
      },
      null,
      2,
    ),
  );

  const config = loadConfig({ configPath: home.configPath, stateDir: home.stateDir });
  t.after(async () => {
    try {
      const pid = Number.parseInt(fs.readFileSync(path.join(home.stateDir, 'daemon.pid'), 'utf8').trim(), 10);
      if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
    } catch {
      // not running
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (await isHealthy(config))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  });

  const result = await runScript(
    installed.script,
    environment(home.home, {
      DEV_GATEWAY_CONFIG: home.configPath,
      DEV_GATEWAY_STATE_DIR: home.stateDir,
    }),
  );

  assert.equal(result.code, 0, result.stderr);
  assert.ok(fs.existsSync(home.stateDir), 'the state directory was not created');

  // The daemon answers: the script started it.
  const deadline = Date.now() + 20_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    healthy = await isHealthy(config);
    if (!healthy) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(healthy, true, 'the daemon did not answer after the install');

  // The second run is idempotent: the daemon is already running.
  const second = await runScript(
    installed.script,
    environment(home.home, {
      DEV_GATEWAY_CONFIG: home.configPath,
      DEV_GATEWAY_STATE_DIR: home.stateDir,
    }),
  );
  assert.equal(second.code, 0, second.stderr);
  assert.equal(await isHealthy(config), true);
});

test('the install does not import the old layout', async () => {
  const home = makeHome();
  const installed = makeInstalledPackage();
  try {
    // The old layout of the user, in the home of the test.
    const legacy = path.join(home.home, '.traefik-dev');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, 'config.json'),
      JSON.stringify({ zone: 'legacy.example', registryPort: 45002, relayPort: 45001, stateDir: legacy }),
    );
    fs.writeFileSync(
      path.join(legacy, 'registrations.json'),
      JSON.stringify({ version: 1, registrations: [{ id: 'probe/main' }] }),
    );

    const result = await runScript(
      installed.script,
      environment(home.home, {
        DEV_GATEWAY_CONFIG: path.join(home.home, 'config.json'),
        DEV_GATEWAY_STATE_DIR: home.stateDir,
      }),
    );

    assert.equal(result.code, 0, result.stderr);

    // The routes of the old layout are not copied: the migration is
    // `dev-gateway migrate`'s job, not the install's.
    assert.ok(fs.existsSync(path.join(legacy, 'registrations.json')));
    assert.equal(fs.existsSync(path.join(home.stateDir, 'routes.json')), false);

    // The old directory is left in place.
    assert.ok(fs.existsSync(path.join(legacy, 'config.json')));
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});
