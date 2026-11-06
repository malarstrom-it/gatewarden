/**
 * The uninstall scripts of the package (§5.2).
 *
 * An installation that is removed takes its daemon with it: the daemon
 * outlives the command that started it, and a daemon that is left behind
 * listens on two ports and serves a package that is not there any more.
 *
 * Two scripts do the work:
 *
 *   - `scripts/preuninstall.mjs` stops the daemon;
 *   - `scripts/postuninstall.mjs` removes the configuration, the state
 *     and the cache.
 *
 * npm 7 and later do not run the uninstall scripts of a package — npm's
 * own documentation says so — so the daemon watches its own installation
 * and stops itself when the package is gone (`src/core/daemon.ts`). The
 * scripts are what the package managers that do run them use, and they
 * are what the tests here are about.
 *
 * The scripts are run as an installed package: a copy of the sources with
 * a manifest that is not private. A checkout is not an installation, and
 * the scripts say so.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/core/config.ts';
import { daemonStatus, isHealthy } from '../src/core/daemonControl.ts';
import { removeInstallationFiles } from '../src/core/installation.ts';
import { resolvePaths } from '../src/core/paths.ts';
import type { Config } from '../src/core/types.ts';
import { freePort } from './helpers/cli.ts';
import { isolate } from './helpers/isolation.ts';
import { resolveGatewayPaths } from '../scripts/paths.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREUNINSTALL = path.join(REPO_ROOT, 'scripts', 'preuninstall.mjs');
const POSTUNINSTALL = path.join(REPO_ROOT, 'scripts', 'postuninstall.mjs');

/** The dependencies the package needs when it runs (§2.1). */
const RUNTIME_DEPENDENCIES = ['env-paths', 'proper-lockfile'];

/** Copy the dependencies of the package into an installation. */
function copyDependencies(from: string, to: string, names: string[], done = new Set<string>()): void {
  for (const name of names) {
    if (done.has(name)) continue;
    done.add(name);
    const source = path.join(from, name);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(to, name), { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    copyDependencies(from, to, Object.keys(manifest.dependencies ?? {}), done);
  }
}

/** The package as it is installed: the sources, the scripts, the dependencies. */
function makeInstalledPackage(): { dir: string; tree: string; cleanup: () => void } {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-'));
  // The installation is a directory of its own, in a tree around it: the
  // tree is what tells a removal from a rebuild (§5.4).
  const dir = path.join(tree, 'installation');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@malarstrom/gatewarden', version: '0.1.1', type: 'module' }, null, 2),
  );
  const modules = path.join(dir, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  copyDependencies(path.join(REPO_ROOT, 'node_modules'), modules, RUNTIME_DEPENDENCIES);
  return { dir, tree, cleanup: () => fs.rmSync(tree, { recursive: true, force: true }) };
}

/** Run a script of the package and collect what it says. */
function runScript(script: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: REPO_ROOT,
      env: { PATH: process.env['PATH'] ?? '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

/** The configuration of a throwaway installation, with ports of its own. */
async function makeConfig(dir: string): Promise<{ configPath: string; config: Config }> {
  const configPath = path.join(dir, 'config.json');
  const config: Config = {
    proxy: 'traefik',
    registryPort: await freePort(),
    relayPort: await freePort(),
    advertisedIp: '127.0.0.1',
    advertisedHost: '127.0.0.1',
    zone: 'gwtest.local',
    entryPoints: ['websecure'],
    certResolver: 'testca',
    tlsMode: 'wildcard',
    securityHeaders: false,
    compressMiddleware: false,
    middlewareProvider: 'file',
    allowedCidrs: ['127.0.0.1/32'],
    registryAllowedCidrs: [],
    secret: '',
    stateDir: dir,
    documentFormat: 'yaml',
    logMaxBytes: 1024 * 1024,
    logKeep: 2,
    autostart: true,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { configPath, config: loadConfig({ configPath, stateDir: dir }) };
}

/** Wait until the predicate says yes, or the deadline says that it will not. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Is the process alive? */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

test('the preuninstall script stops the daemon of the installation', async (t) => {
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-daemon-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const { configPath, config } = await makeConfig(stateDir);

  t.after(async () => {
    const status = await daemonStatus(config);
    if (status.pid) {
      try {
        process.kill(status.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    await waitFor(async () => !(await isHealthy(config)), 8000);
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The daemon of the installation: it runs from the files of the
  // installation, so the script of the installation may stop it.
  //
  // The daemon runs in the throwaway directory of the test and in
  // nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // read it nor write to it. The directories of this installation are
  // apart — the home, the state and the cache — so `GATEWARDEN_HOME`,
  // which says that everything lives in one directory, is not one of
  // them.
  const isolation = isolate(root, {
    home,
    stateDir,
    configPath,
    env: { GATEWARDEN_HOME: undefined },
  });
  const child = spawn(process.execPath, [path.join(installed.dir, 'src', 'daemon.ts'), '--config', configPath], {
    cwd: installed.dir,
    env: isolation.env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  assert.equal(await waitFor(async () => isHealthy(config)), true, 'the daemon did not start');

  const result = await runScript(path.join(installed.dir, 'scripts', 'preuninstall.mjs'), {
    HOME: home,
    GATEWARDEN_CONFIG: configPath,
    GATEWARDEN_STATE_DIR: stateDir,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await waitFor(async () => !(await isHealthy(config))), true, 'the daemon is still running');
  assert.equal(fs.existsSync(path.join(stateDir, 'daemon.pid')), false, 'the pidfile is still there');
});

test('the postuninstall script removes the configuration, the state and the cache', async (t) => {
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-files-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  const cacheHome = path.join(root, 'xdg-cache');
  const cacheDir = path.join(cacheHome, 'gatewarden');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'something'), 'cached');
  const { configPath } = await makeConfig(stateDir);
  fs.writeFileSync(path.join(stateDir, 'routes.json'), JSON.stringify({ version: 1, registrations: [] }));
  fs.writeFileSync(path.join(stateDir, 'daemon.error'), 'unknown proxy "caddy" (known: traefik)\n');

  t.after(() => {
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = await runScript(path.join(installed.dir, 'scripts', 'postuninstall.mjs'), {
    HOME: home,
    GATEWARDEN_CONFIG: configPath,
    GATEWARDEN_STATE_DIR: stateDir,
    XDG_CACHE_HOME: cacheHome,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(configPath), false, 'the configuration file is still there');
  assert.equal(fs.existsSync(path.join(stateDir, 'routes.json')), false, 'the route store is still there');
  assert.equal(
    fs.existsSync(path.join(stateDir, 'daemon.error')),
    false,
    'the reason the daemon stopped is still there',
  );
  assert.equal(fs.existsSync(cacheDir), false, 'the cache directory is still there');
  assert.equal(fs.existsSync(stateDir), false, 'the state directory is still there');
});

test('the files of the gateway in the state directory go with the installation', (t) => {
  // The reason the daemon stopped is a file of the gateway: it goes
  // with the installation, and the files of somebody else stay.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-owned-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'routes.json'), '{}');
  fs.writeFileSync(path.join(stateDir, 'daemon.error'), 'unknown proxy "caddy" (known: traefik)\n');
  fs.writeFileSync(path.join(stateDir, 'somebody-elses-file'), 'not ours');

  removeInstallationFiles({
    configFile: path.join(root, 'config.json'),
    stateDir,
    cacheDir: path.join(root, 'cache'),
    logFile: path.join(root, 'daemon.log'),
  });

  assert.equal(fs.existsSync(path.join(stateDir, 'routes.json')), false, 'the route store is still there');
  assert.equal(
    fs.existsSync(path.join(stateDir, 'daemon.error')),
    false,
    'the reason the daemon stopped is still there',
  );
  assert.equal(
    fs.existsSync(path.join(stateDir, 'somebody-elses-file')),
    true,
    'a file of somebody else was removed',
  );
});

test('the postuninstall script respects GATEWARDEN_HOME', async (t) => {
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-home-'));
  const home = path.join(root, 'home');
  const gateway = path.join(root, 'gateway');
  const cacheDir = path.join(gateway, 'cache');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(gateway, 'config.json'), JSON.stringify({ zone: 'gwtest.local' }));
  fs.writeFileSync(path.join(gateway, 'routes.json'), JSON.stringify({ version: 1, registrations: [] }));

  t.after(() => {
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = await runScript(path.join(installed.dir, 'scripts', 'postuninstall.mjs'), {
    HOME: home,
    GATEWARDEN_HOME: gateway,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(gateway, 'config.json')), false, 'the configuration file is still there');
  assert.equal(fs.existsSync(path.join(gateway, 'routes.json')), false, 'the route store is still there');
  assert.equal(fs.existsSync(cacheDir), false, 'the cache directory is still there');
});

test('the postuninstall script honours the old environment variables', async (t) => {
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-old-'));
  const home = path.join(root, 'home');
  const configPath = path.join(root, 'old-config.json');
  const stateDir = path.join(root, 'old-state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ zone: 'gwtest.local' }));
  fs.writeFileSync(path.join(stateDir, 'routes.json'), JSON.stringify({ version: 1, registrations: [] }));

  t.after(() => {
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The names the variables had before the rename, and the ones of the
  // pre-package layout: they still work.
  const result = await runScript(path.join(installed.dir, 'scripts', 'postuninstall.mjs'), {
    HOME: home,
    TRAEFIK_DEV_CONFIG: configPath,
    TRAEFIK_DEV_STATE_DIR: stateDir,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(configPath), false, 'the configuration file is still there');
  assert.equal(fs.existsSync(stateDir), false, 'the state directory is still there');
});

test('the uninstall scripts do nothing in a checkout', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-checkout-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const configPath = path.join(stateDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ zone: 'gwtest.local' }));

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const script of [PREUNINSTALL, POSTUNINSTALL]) {
    const result = await runScript(script, {
      HOME: home,
      GATEWARDEN_CONFIG: configPath,
      GATEWARDEN_STATE_DIR: stateDir,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(fs.existsSync(configPath), true, `the script ${path.basename(script)} removed a file of the checkout`);
  }
});

test('the uninstall scripts never fail the uninstall', async () => {
  const installed = makeInstalledPackage();
  try {
    for (const script of ['preuninstall.mjs', 'postuninstall.mjs']) {
      const result = await runScript(path.join(installed.dir, 'scripts', script), {
        // A state directory that does not exist, and a configuration file
        // that is not one: the scripts have to swallow it.
        HOME: path.join(os.tmpdir(), 'gatewarden-does-not-exist'),
        GATEWARDEN_CONFIG: path.join(os.tmpdir(), 'gatewarden-does-not-exist', 'config.json'),
        GATEWARDEN_STATE_DIR: path.join(os.tmpdir(), 'gatewarden-does-not-exist', 'state'),
      });

      assert.equal(result.code, 0, result.stderr);
    }
  } finally {
    installed.cleanup();
  }
});

test('the preuninstall script stops the daemon of another installation never', async (t) => {
  // Two installations that share a state directory share their pid file.
  // The uninstall of one of them must not stop the daemon of the other:
  // the process has to run from the installation that is uninstalled.
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-foreign-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  // A process of another installation that looks like the daemon: the
  // name of its script is the name of ours, but it runs from a directory
  // that is not ours.
  const foreign = path.join(root, 'other');
  fs.mkdirSync(foreign, { recursive: true });
  const foreignScript = path.join(foreign, 'gatewarden-daemon.js');
  fs.writeFileSync(foreignScript, 'setTimeout(() => {}, 60_000);\n');
  const child = spawn(process.execPath, [foreignScript], { cwd: foreign, stdio: 'ignore' });
  const pid = child.pid as number;

  t.after(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The pid file of the state directory names the foreign process.
  fs.writeFileSync(path.join(stateDir, 'daemon.pid'), `${pid}\n`);

  const result = await runScript(path.join(installed.dir, 'scripts', 'preuninstall.mjs'), {
    HOME: home,
    GATEWARDEN_CONFIG: path.join(stateDir, 'config.json'),
    GATEWARDEN_STATE_DIR: stateDir,
  });

  assert.equal(result.code, 0, result.stderr);

  // The process of the other installation is still there.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(isAlive(pid), true, 'the script stopped a process of another installation');
});

test('the daemon stops itself and cleans up when the installation is gone', async (t) => {
  // npm 7 and later do not run the uninstall scripts of a package, so
  // the daemon watches its own installation: when the package is gone,
  // the daemon goes with it — and the files of the installation go with
  // the daemon, because nothing else cleans them up.
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-watchdog-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  const cacheHome = path.join(root, 'xdg-cache');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(cacheHome, 'gatewarden'), { recursive: true });
  const { configPath, config } = await makeConfig(stateDir);
  fs.writeFileSync(path.join(stateDir, 'routes.json'), JSON.stringify({ version: 1, registrations: [] }));

  // The daemon of the fake installation: it runs from the sources of
  // the copy, and the copy is the installation.
  //
  // The daemon runs in the throwaway directory of the test and in
  // nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // read it nor write to it. The directories of this installation are
  // apart — the home, the state and the cache — so `GATEWARDEN_HOME`,
  // which says that everything lives in one directory, is not one of
  // them.
  const isolation = isolate(root, {
    home,
    stateDir,
    configPath,
    cacheHome,
    env: { GATEWARDEN_HOME: undefined },
  });
  const child = spawn(process.execPath, [path.join(installed.dir, 'src', 'daemon.ts'), '--config', configPath], {
    cwd: installed.dir,
    env: isolation.env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  t.after(async () => {
    const status = await daemonStatus(config);
    if (status.pid) {
      try {
        process.kill(status.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    await waitFor(async () => !(await isHealthy(config)), 8000);
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await waitFor(async () => isHealthy(config)), true, 'the daemon did not start');

  // The installation goes: the package, the scripts, the compiled output.
  fs.rmSync(installed.dir, { recursive: true, force: true });

  assert.equal(
    await waitFor(async () => !(await isHealthy(config)), 20_000),
    true,
    'the daemon is still running after the installation was removed',
  );
  assert.equal(fs.existsSync(path.join(stateDir, 'daemon.pid')), false, 'the pidfile is still there');

  // The files of the installation go with it: the configuration file,
  // the route store, the log and the cache (§5.4). npm 7 and later do
  // not run the uninstall scripts, so the daemon is the one that cleans
  // up.
  assert.equal(
    await waitFor(() => Promise.resolve(!fs.existsSync(configPath)), 10_000),
    true,
    'the configuration file is still there',
  );
  assert.equal(fs.existsSync(path.join(stateDir, 'routes.json')), false, 'the route store is still there');
  assert.equal(fs.existsSync(path.join(stateDir, 'daemon.log')), false, 'the log is still there');
  assert.equal(fs.existsSync(path.join(cacheHome, 'gatewarden')), false, 'the cache is still there');
});

test('the daemon leaves the files alone when the tree of the installation is gone', async (t) => {
  // `npm ci` removes the whole `node_modules` and fills it again: the
  // installation comes back, and the files of the gateway stay where
  // they are.
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-tree-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const { configPath, config } = await makeConfig(stateDir);

  // The daemon runs in the throwaway directory of the test and in
  // nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // read it nor write to it. The directories of this installation are
  // apart — the home, the state and the cache — so `GATEWARDEN_HOME`,
  // which says that everything lives in one directory, is not one of
  // them.
  const isolation = isolate(root, {
    home,
    stateDir,
    configPath,
    env: { GATEWARDEN_HOME: undefined },
  });
  const child = spawn(process.execPath, [path.join(installed.dir, 'src', 'daemon.ts'), '--config', configPath], {
    cwd: installed.dir,
    env: isolation.env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  t.after(async () => {
    const status = await daemonStatus(config);
    if (status.pid) {
      try {
        process.kill(status.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    await waitFor(async () => !(await isHealthy(config)), 8000);
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await waitFor(async () => isHealthy(config)), true, 'the daemon did not start');

  // The whole tree goes: the `node_modules` and everything in it.
  fs.rmSync(installed.tree, { recursive: true, force: true });

  assert.equal(
    await waitFor(async () => !(await isHealthy(config)), 20_000),
    true,
    'the daemon is still running after the tree was removed',
  );

  // The files of the gateway are still there: the installation is
  // coming back.
  assert.equal(fs.existsSync(configPath), true, 'the configuration file was removed');
});

test('the daemon leaves the files alone when the checkout is gone', async (t) => {
  // A checkout is not an installation: a clone that is deleted must not
  // take the files of the user with it.
  const installed = makeInstalledPackage();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-uninstall-checkout-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const { configPath, config } = await makeConfig(stateDir);

  // The copy becomes a checkout: it holds the sources and the build
  // configuration.
  fs.writeFileSync(path.join(installed.dir, 'tsconfig.build.json'), '{}');

  // The daemon runs in the throwaway directory of the test and in
  // nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // read it nor write to it. The directories of this installation are
  // apart — the home, the state and the cache — so `GATEWARDEN_HOME`,
  // which says that everything lives in one directory, is not one of
  // them.
  const isolation = isolate(root, {
    home,
    stateDir,
    configPath,
    env: { GATEWARDEN_HOME: undefined },
  });
  const child = spawn(process.execPath, [path.join(installed.dir, 'src', 'daemon.ts'), '--config', configPath], {
    cwd: installed.dir,
    env: isolation.env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  t.after(async () => {
    const status = await daemonStatus(config);
    if (status.pid) {
      try {
        process.kill(status.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    await waitFor(async () => !(await isHealthy(config)), 8000);
    installed.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await waitFor(async () => isHealthy(config)), true, 'the daemon did not start');

  fs.rmSync(installed.dir, { recursive: true, force: true });

  assert.equal(
    await waitFor(async () => !(await isHealthy(config)), 20_000),
    true,
    'the daemon is still running after the checkout was removed',
  );

  assert.equal(fs.existsSync(configPath), true, 'the configuration file was removed');
});

test('the paths of the scripts are the paths of the core', () => {
  // The scripts of the package resolve the directories themselves, so
  // that they work when the compiled core of the package is gone. The
  // copy has to be the resolution of the core, to the letter.
  const home = '/home/tester';
  const cases: NodeJS.ProcessEnv[] = [
    {},
    { GATEWARDEN_HOME: '/tmp/gateway' },
    { DEV_GATEWAY_HOME: '/tmp/gateway-old' },
    { GATEWARDEN_CONFIG: '/tmp/config.json' },
    { DEV_GATEWAY_CONFIG: '/tmp/config-old.json' },
    { TRAEFIK_DEV_CONFIG: '/tmp/config-legacy.json' },
    { GATEWARDEN_STATE_DIR: '/tmp/state' },
    { DEV_GATEWAY_STATE_DIR: '/tmp/state-old' },
    { TRAEFIK_DEV_STATE_DIR: '/tmp/state-legacy' },
    { XDG_CONFIG_HOME: '/tmp/xdg-config', XDG_STATE_HOME: '/tmp/xdg-state', XDG_CACHE_HOME: '/tmp/xdg-cache' },
  ];

  for (const env of cases) {
    const fromScript = resolveGatewayPaths(env, process.platform, home);
    const fromCore = resolvePaths({ env, platform: process.platform, home });

    assert.deepEqual(fromScript, fromCore, `the paths differ for ${JSON.stringify(env)}`);
  }
});
