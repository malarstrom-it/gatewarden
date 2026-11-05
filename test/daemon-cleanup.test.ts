/**
 * The cleanup of the test suite stops the daemons the suite started.
 *
 * A daemon is a detached process: it keeps its ports, and it keeps
 * running on the machine after the test that started it is over. The
 * suite therefore stops the daemons it started when the test file is
 * over (see `test/helpers/suite.ts`), and this file is the proof that
 * the cleanup does what it says.
 *
 * Three things are proved here:
 *
 *   - the cleanup stops a daemon of the suite;
 *   - the cleanup finds a daemon whose pidfile does not lie where the
 *     test expects it — the name `GATEWARDEN_HOME` wins over every
 *     other name, so the pidfile of such a daemon lies in the directory
 *     the name points at;
 *   - the cleanup leaves a daemon that is not the suite's alone. The
 *     gateway of the machine is a daemon like that one, and the cleanup
 *     must never touch it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/core/config.ts';
import { ensureDaemon, isProcessAlive } from '../src/core/daemonControl.ts';
import type { Config } from '../src/core/types.ts';
import { DAEMON, freePort } from './helpers/cli.ts';
import { registerSuiteDirectory, stopDaemonsOfTheSuite, SUITE_VARIABLE, suiteMarker } from './helpers/daemons.ts';
import { isolate } from './helpers/isolation.ts';

/**
 * The configuration of a throwaway installation.
 *
 * @param dir The directory of the installation.
 * @param registryPort The port of the registry.
 * @param relayPort The port of the relay.
 * @param stateDir The state directory the configuration names, or nothing.
 * @returns The path of the configuration file.
 */
function writeConfig(dir: string, registryPort: number, relayPort: number, stateDir = dir): string {
  const configPath = path.join(dir, 'config.json');
  const config: Config = {
    proxy: 'traefik',
    registryPort,
    relayPort,
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
    stateDir,
    documentFormat: 'yaml',
    logMaxBytes: 1024 * 1024,
    logKeep: 2,
    autostart: true,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

/**
 * Wait until a file is there.
 *
 * @param file The file to wait for.
 * @param timeoutMs How long to wait.
 * @returns Whether the file is there.
 */
async function waitForFile(file: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test('the cleanup stops the daemon the suite started', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-cleanup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = writeConfig(dir, await freePort(), await freePort());
  const config = loadConfig({ configPath, stateDir: dir });
  // The installation is known to the cleanup of the suite.
  registerSuiteDirectory(dir);
  // The daemon runs in the throwaway directory of the test and in
  // nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // write its log there.
  const isolation = isolate(dir);
  const started = await isolation.run(() => ensureDaemon(config, { configPath }));
  assert.equal(started.started, true, started.error);
  const pid = started.pid;
  assert.ok(pid, 'the daemon should have a pid');
  assert.equal(isProcessAlive(pid), true, 'the daemon should run');
  // The cleanup stops it.
  const result = await stopDaemonsOfTheSuite();
  assert.ok(result.stopped.includes(pid), `the cleanup did not stop the daemon (pid ${pid})`);
  assert.equal(isProcessAlive(pid), false, 'the daemon is still running');
  assert.deepEqual(result.remaining, [], 'the cleanup left a daemon behind');
});

test('the cleanup finds the daemon whose pidfile lies in the directory GATEWARDEN_HOME names', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-cleanup-home-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'installation');
  const home = path.join(root, 'home');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const configPath = writeConfig(dir, await freePort(), await freePort(), '');
  // The daemon is started by hand, with the name of another
  // installation in its environment: the configuration names no state
  // directory, and the name decides where the state lives, so the daemon
  // writes its pidfile in the directory the name points at, and not in
  // the state directory of the configuration file.
  const daemon = spawn(process.execPath, [DAEMON, '--config', configPath], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: dir,
      GATEWARDEN_HOME: home,
      [SUITE_VARIABLE]: suiteMarker(),
    },
    stdio: 'ignore',
    detached: true,
  });
  daemon.unref();
  registerSuiteDirectory(dir);
  registerSuiteDirectory(home);
  const pidFile = path.join(home, 'daemon.pid');
  assert.equal(await waitForFile(pidFile), true, 'the daemon did not write its pidfile');
  assert.equal(
    fs.existsSync(path.join(dir, 'daemon.pid')),
    false,
    'the pidfile should not be in the state directory of the configuration file',
  );
  // The cleanup finds the daemon anyway: the pidfile is not where the
  // test expects it.
  const result = await stopDaemonsOfTheSuite();
  assert.ok(result.stopped.includes(daemon.pid as number), 'the cleanup did not stop the daemon');
  assert.equal(isProcessAlive(daemon.pid as number), false, 'the daemon is still running');
  assert.deepEqual(result.remaining, [], 'the cleanup left a daemon behind');
});

test('the cleanup does not stop the daemon of the installation of the machine', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-cleanup-machine-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'installation');
  fs.mkdirSync(dir, { recursive: true });
  const configPath = writeConfig(dir, await freePort(), await freePort());
  // A daemon of another installation: it carries no marker of the
  // suite, and it runs in a directory the suite does not know.
  const daemon = spawn(process.execPath, [DAEMON, '--config', configPath], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: dir,
      GATEWARDEN_STATE_DIR: dir,
    },
    stdio: 'ignore',
    detached: true,
  });
  daemon.unref();
  t.after(async () => {
    try {
      process.kill(-(daemon.pid as number), 'SIGTERM');
    } catch {
      // already gone
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isProcessAlive(daemon.pid as number)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  assert.equal(
    await waitForFile(path.join(dir, 'daemon.pid')),
    true,
    'the daemon did not write its pidfile',
  );
  // The name of the home installation points at the installation of the
  // machine, and the pidfile of that installation names the daemon.
  const saved = process.env['GATEWARDEN_HOME'];
  process.env['GATEWARDEN_HOME'] = home;
  t.after(() => {
    if (saved === undefined) delete process.env['GATEWARDEN_HOME'];
    else process.env['GATEWARDEN_HOME'] = saved;
  });
  fs.writeFileSync(path.join(home, 'daemon.pid'), `${daemon.pid}\n`);
  // The cleanup reads the pidfile of the installation of the machine,
  // and it does not stop the daemon it names: the daemon is not the
  // suite's.
  const result = await stopDaemonsOfTheSuite();
  assert.equal(
    result.stopped.includes(daemon.pid as number),
    false,
    'the cleanup stopped the daemon of the installation of the machine',
  );
  assert.equal(isProcessAlive(daemon.pid as number), true, 'the daemon of the machine was stopped');
});

test('the cleanup leaves a daemon that is not the suite\'s alone', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-cleanup-foreign-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'installation');
  fs.mkdirSync(dir, { recursive: true });
  const configPath = writeConfig(dir, await freePort(), await freePort());
  // A daemon of another installation: it carries no marker of the
  // suite, and it runs in a directory the suite does not know. The
  // gateway of the machine is a daemon like this one.
  const daemon = spawn(process.execPath, [DAEMON, '--config', configPath], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: dir,
      GATEWARDEN_STATE_DIR: dir,
    },
    stdio: 'ignore',
    detached: true,
  });
  daemon.unref();
  t.after(async () => {
    try {
      process.kill(-(daemon.pid as number), 'SIGTERM');
    } catch {
      // already gone
    }
    // The daemon stops its workers and ends: the file leaves no process
    // behind, not even for a moment.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isProcessAlive(daemon.pid as number)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  const pidFile = path.join(dir, 'daemon.pid');
  assert.equal(await waitForFile(pidFile), true, 'the daemon did not write its pidfile');
  // The cleanup does not touch it.
  const result = await stopDaemonsOfTheSuite();
  assert.equal(
    result.stopped.includes(daemon.pid as number),
    false,
    'the cleanup stopped a daemon that is not the suite\'s',
  );
  assert.equal(isProcessAlive(daemon.pid as number), true, 'the daemon of another installation was stopped');
});
