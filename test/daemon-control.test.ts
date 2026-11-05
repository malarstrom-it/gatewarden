/**
 * The daemon control: the pidfile, the liveness of the process and the
 * health probe.
 *
 * Two questions are kept apart, because they have different answers:
 *
 *   - does the daemon run?  the pidfile points at a process that runs;
 *   - does the daemon serve? the health probe answers.
 *
 * The daemon writes its pidfile before it binds its port, so a daemon
 * that has just started runs and does not serve yet. A machine under
 * load makes that window wide, and the commands must not answer "there
 * was nothing to stop" for a daemon that runs.
 *
 * The tests run against a throwaway directory. The gateway that runs on
 * the user's machine is never touched.
 *
 * The environment the daemon is started with is looked at, and not
 * tried out: a daemon that reads the configuration of another
 * installation must not be started to find that out.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import { loadConfig, resolveConfigPath, resolveStateDir } from '../src/core/config.ts';
import {
  daemonEnv,
  daemonStatus,
  ensureDaemon,
  isHealthy,
  isProcessAlive,
  processState,
  stopDaemon,
} from '../src/core/daemonControl.ts';
import type { Config } from '../src/core/types.ts';
import { CLI, DAEMON, freePort } from './helpers/cli.ts';

/** A throwaway installation with a configuration file of its own. */
async function makeConfig(): Promise<{ dir: string; configPath: string; config: Config }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-control-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
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
        secret: '',
        stateDir: dir,
      },
      null,
      2,
    ),
  );
  return { dir, configPath, config: loadConfig({ configPath, stateDir: dir }) };
}

/** Wait for something to become true. */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** A process that runs and does nothing. */
function startSleeper(): ChildProcess {
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
}

/**
 * A program that leaves a zombie behind: it forks a child, the child
 * terminates, and the program does not collect it.
 */
const ZOMBIE_MAKER = [
  'import os, sys, time',
  'pid = os.fork()',
  'if pid == 0:',
  '    os._exit(0)',
  'print(pid, flush=True)',
  'time.sleep(60)',
].join('\n');

/** The same program, but it says right away that it works. */
const ZOMBIE_PROBE = [
  'import os, sys',
  'pid = os.fork()',
  'if pid == 0:',
  '    os._exit(0)',
  'print(pid, flush=True)',
  'sys.exit(0)',
].join('\n');

/**
 * A program that takes the orphans in and never collects them: what
 * the init of a container that is not an init does not do.
 */
const SUBREAPER_PROBE = [
  'import ctypes, sys',
  'ctypes.CDLL("libc.so.6").prctl(36, 1, 0, 0, 0)',
  'sys.exit(0)',
].join('\n');

/**
 * Can this machine run the program?
 *
 * The program has to run, not just to be there: python3 without the
 * library the program needs answers `--version` and fails at the first
 * line that matters.
 */
function canRun(program: string): boolean {
  const probe = spawnSync('python3', ['-c', program], { encoding: 'utf8', timeout: 10_000 });
  if (probe.error || probe.status !== 0) return false;
  if (program === ZOMBIE_PROBE) {
    const pid = Number.parseInt((probe.stdout ?? '').split('\n')[0]?.trim() ?? '', 10);
    return Number.isFinite(pid) && pid > 0;
  }
  return true;
}

test('a process that runs is alive', () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.notEqual(processState(process.pid), 'Z');
});

test('a process that does not exist is not alive', () => {
  // A pid that nothing runs: the highest possible pid is a good guess,
  // and the answer must be no either way.
  assert.equal(isProcessAlive(0x7fffffff), false);
});

test(
  'a process that has terminated is not alive',
  { skip: canRun(ZOMBIE_PROBE) ? false : 'this machine cannot leave a zombie behind' },
  async (t) => {
    const maker = spawn('python3', ['-c', ZOMBIE_MAKER], { stdio: ['ignore', 'pipe', 'ignore'] });
    t.after(() => {
      try {
        maker.kill('SIGKILL');
      } catch {
        // already gone
      }
    });

    const pid = await new Promise<number>((resolve, reject) => {
      let said = '';
      maker.stdout?.on('data', (chunk: Buffer | string) => {
        said += String(chunk);
        const line = said.split('\n')[0]?.trim();
        if (line) resolve(Number.parseInt(line, 10));
      });
      setTimeout(() => reject(new Error('the helper did not answer')), 10_000);
    });

    const becameZombie = await waitFor(() => processState(pid) === 'Z');
    assert.equal(becameZombie, true, 'the helper did not leave a zombie behind');

    // `kill(pid, 0)` cannot tell a zombie from a running process: the
    // pid is still there. The process itself is gone, and the gateway
    // must not believe that its daemon runs.
    assert.doesNotThrow(() => process.kill(pid, 0));
    assert.equal(isProcessAlive(pid), false);
  },
);

test('the daemon runs before it serves', async (t) => {
  const { dir, configPath } = await makeConfig();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A port that is taken: the registry worker of the daemon cannot bind
  // it. The daemon runs, and it does not serve.
  const taken = net.createServer();
  await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
  t.after(() => taken.close());
  const takenPort = (taken.address() as net.AddressInfo).port;

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(configPath, JSON.stringify({ ...raw, registryPort: takenPort }, null, 2));
  const config = loadConfig({ configPath, stateDir: dir });

  const daemon = spawn(process.execPath, [DAEMON, '--config', configPath], {
    env: { ...process.env, HOME: dir, GATEWARDEN_STATE_DIR: dir },
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

  const pidFile = path.join(dir, 'daemon.pid');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !fs.existsSync(pidFile)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(fs.existsSync(pidFile), 'the daemon did not write its pidfile');

  const status = await daemonStatus(config);
  assert.equal(status.running, true, 'the daemon runs: its pidfile points at it');
  assert.equal(status.pid, daemon.pid);
  assert.equal(status.healthy, false, 'the daemon does not serve: the registry cannot bind its port');
});

test('a pidfile that points at a process that is gone says that the daemon does not run', async (t) => {
  const { dir, config } = await makeConfig();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const pidFile = path.join(dir, 'daemon.pid');
  fs.writeFileSync(pidFile, '2147483646\n');

  const status = await daemonStatus(config);
  assert.equal(status.running, false);
  assert.equal(status.pid, null);
  assert.equal(fs.existsSync(pidFile), false, 'the stale pidfile was not removed');
});

test('a pidfile that points at a foreign process is not stopped', { skip: process.platform !== 'linux' }, async (t) => {
  const { dir, config } = await makeConfig();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sleeper = startSleeper();
  t.after(() => {
    try {
      sleeper.kill('SIGKILL');
    } catch {
      // already gone
    }
  });

  const pidFile = path.join(dir, 'daemon.pid');
  fs.writeFileSync(pidFile, `${sleeper.pid}\n`);

  // The process is not the gateway's daemon: it is never stopped, and
  // the pidfile that points at it is stale.
  const result = await stopDaemon(config);
  assert.equal(result.wasRunning, false, 'the process of the pidfile is not the gateway daemon');
  assert.equal(result.stopped, false);
  assert.equal(sleeper.killed, false, 'a process that is not the gateway daemon was stopped');
  assert.equal(fs.existsSync(pidFile), false, 'the stale pidfile was not removed');
});

test('a pidfile that points at a foreign process does not lock the installation out', async (t) => {
  const { dir, configPath, config } = await makeConfig();
  t.after(async () => {
    await stopDaemon(config);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // What a daemon that was killed hard leaves behind: its pidfile, and
  // a pid that the machine has handed to somebody else.
  const stranger = startSleeper();
  t.after(() => {
    try {
      stranger.kill('SIGKILL');
    } catch {
      // already gone
    }
  });

  const pidFile = path.join(dir, 'daemon.pid');
  fs.writeFileSync(pidFile, `${stranger.pid}\n`);

  const status = await daemonStatus(config);
  assert.equal(status.running, false, 'the process of the pidfile is not the gateway daemon');
  assert.equal(status.pid, null);
  assert.equal(fs.existsSync(pidFile), false, 'the stale pidfile was not removed');

  // The installation is not locked out: the daemon starts again.
  const started = await ensureDaemon(config, { configPath });
  assert.equal(started.error, undefined);
  assert.equal(started.started, true);
  assert.ok(started.pid, 'the daemon did not start');
  assert.equal(await isHealthy(config), true, 'the daemon did not answer');
});

/**
 * The CI runs in a container whose init does not collect the processes
 * that are orphaned. The daemon of the gateway is orphaned when the
 * command that started it exits, and it stays behind as a zombie: the
 * pid is in the process table, and `kill(pid, 0)` succeeds.
 *
 * The helper below is such an init: it takes the orphans in and never
 * collects them. The daemon it starts is therefore a zombie when it
 * stops, and the command that stops it must say that it stopped.
 */
const SUBREAPER = [
  'import ctypes, os, subprocess, sys, time',
  'libc = ctypes.CDLL("libc.so.6", use_errno=True)',
  'libc.prctl(36, 1, 0, 0, 0)',
  'child = subprocess.Popen(sys.argv[1:])',
  'child.wait()',
  'print("exited", flush=True)',
  'time.sleep(120)',
].join('\n');

test(
  'stop says that it stopped the daemon, even when the daemon is not collected',
  { skip: canRun(SUBREAPER_PROBE) ? false : 'this machine cannot take the orphans in' },
  async (t) => {
    const { dir, configPath, config } = await makeConfig();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const env = {
      PATH: process.env['PATH'] ?? '',
      HOME: dir,
      GATEWARDEN_STATE_DIR: dir,
      GATEWARDEN_CONFIG: configPath,
    };

    // The command that starts the daemon runs under the helper, so that
    // the daemon is orphaned to the helper and not to the init of the
    // machine.
    const starter = spawn(
      'python3',
      ['-c', SUBREAPER, process.execPath, CLI, 'start', '--config', configPath, '--state-dir', dir],
      { env, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let said = '';
    starter.stdout?.on('data', (chunk: Buffer | string) => {
      said += String(chunk);
    });
    t.after(() => {
      try {
        starter.kill('SIGKILL');
      } catch {
        // already gone
      }
    });

    const pidFile = path.join(dir, 'daemon.pid');
    const started = await waitFor(() => fs.existsSync(pidFile));
    assert.equal(started, true, 'the daemon did not write its pidfile');
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    assert.ok(Number.isFinite(pid));

    // The daemon serves: the command that started it waited for it.
    const served = await waitFor(async () => isHealthy(config));
    assert.equal(served, true, 'the daemon did not answer /healthz');

    // The command that started the daemon has exited: the daemon is
    // orphaned, and the helper has taken it in.
    const orphaned = await waitFor(() => said.includes('exited'));
    assert.equal(orphaned, true, 'the command that started the daemon did not finish');

    // The daemon is stopped the way the CLI stops it.
    const stopped = await stopDaemon(config);
    assert.equal(stopped.wasRunning, true, 'the daemon was not running');
    assert.equal(stopped.stopped, true, stopped.error ?? 'the daemon did not stop');
    assert.equal(fs.existsSync(pidFile), false, 'the pidfile was not removed');
  },
);

test('the daemon does not inherit GATEWARDEN_HOME', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-control-'));
  const config = loadConfig({ configPath: path.join(dir, 'config.json'), stateDir: dir });

  const env = daemonEnv(config, path.join(dir, 'config.json'), {
    PATH: '/usr/bin',
    GATEWARDEN_HOME: path.join(os.tmpdir(), 'gatewarden-home-of-another-installation'),
  });

  assert.equal(env['GATEWARDEN_HOME'], undefined);
});

test('the daemon does not inherit the name GATEWARDEN_HOME had before the rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-control-'));
  const config = loadConfig({ configPath: path.join(dir, 'config.json'), stateDir: dir });

  const env = daemonEnv(config, path.join(dir, 'config.json'), {
    PATH: '/usr/bin',
    DEV_GATEWAY_HOME: path.join(os.tmpdir(), 'gatewarden-old-home'),
  });

  assert.equal(env['DEV_GATEWAY_HOME'], undefined);
});

test('the daemon reads the configuration it was given', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-control-'));
  const configPath = path.join(dir, 'config.json');
  const config = loadConfig({ configPath, stateDir: dir });

  const env = daemonEnv(config, configPath, {
    PATH: '/usr/bin',
    GATEWARDEN_HOME: path.join(os.tmpdir(), 'gatewarden-home-of-another-installation'),
  });

  // The child resolves the paths with its own environment: the
  // configuration file and the state directory are the ones it was
  // given, and not the ones of the installation the name pointed at.
  assert.equal(resolveConfigPath({ env }), configPath);
  assert.equal(resolveStateDir({ env }), config.stateDir);
});

test('the other names of the environment are left as they are', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-control-'));
  const configPath = path.join(dir, 'config.json');
  const config = loadConfig({ configPath, stateDir: dir });

  const env = daemonEnv(config, configPath, {
    PATH: '/usr/bin',
    HOME: '/home/someone',
    GATEWARDEN_LOG_LEVEL: 'debug',
    GATEWARDEN_CONFIG: '/somewhere/else/config.json',
  });

  assert.equal(env['PATH'], '/usr/bin');
  assert.equal(env['HOME'], '/home/someone');
  assert.equal(env['GATEWARDEN_LOG_LEVEL'], 'debug');
  // The configuration and the state directory of the daemon are the ones
  // it was started with, under both their current and their old names.
  assert.equal(env['GATEWARDEN_CONFIG'], configPath);
  assert.equal(env['GATEWARDEN_STATE_DIR'], config.stateDir);
  assert.equal(env['TRAEFIK_DEV_CONFIG'], configPath);
  assert.equal(env['TRAEFIK_DEV_STATE_DIR'], config.stateDir);
});

test('the environment of the caller is not changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-control-'));
  const configPath = path.join(dir, 'config.json');
  const config = loadConfig({ configPath, stateDir: dir });
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    GATEWARDEN_HOME: path.join(os.tmpdir(), 'gatewarden-home-of-another-installation'),
  };

  daemonEnv(config, configPath, baseEnv);

  assert.equal(baseEnv['GATEWARDEN_HOME'], path.join(os.tmpdir(), 'gatewarden-home-of-another-installation'));
});
