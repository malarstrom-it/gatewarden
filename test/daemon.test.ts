import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { loadConfig, listenHost, resolveConfigPath } from '../src/core/config.ts';
import { ensureDaemon, isHealthy, daemonStatus, isProcessAlive } from '../src/core/daemonControl.ts';
import { workerEnv } from '../src/core/daemon.ts';
import { RegistrationStore } from '../src/core/state.ts';
import type { Config } from '../src/core/types.ts';
import { isolate } from './helpers/isolation.ts';
import { REPO_ROOT } from './helpers/cli.ts';

/** Ask the OS for a free TCP port. */
/**
 * Ask the OS for a free TCP port.
 *
 * The port is asked for on the address the daemon binds: the daemon
 * listens on every address of the machine, and a port that is free on
 * the loopback address alone is not free for it.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, listenHost(), () => {
      const address = server.address() as net.AddressInfo;
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Direct children of a process (Linux /proc). */
export function childrenOf(pid: number): number[] {
  const children: number[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ppid = Number(after[1]);
      if (ppid === pid) children.push(Number(entry));
    } catch {
      // process gone
    }
  }
  return children;
}

function cmdlineOf(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    return '';
  }
}

/**
 * Wait until a condition holds.
 *
 * The timeout is a backstop that keeps a test from running for ever, not
 * the thing the test waits for: the condition is what the test asserts.
 */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * The processes of an installation: the daemon and the workers it
 * supervises.
 *
 * Every one of them names the configuration file of the installation on
 * their command line, and the configuration file of a throwaway
 * installation is its own. The list is found that way and not through
 * the pidfile alone: a worker that outlives the daemon that supervised
 * it is not a child of anything any more, and it still holds the port of
 * the gateway.
 */
function processesOf(configPath: string): number[] {
  const pids: number[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    // A machine without /proc has no processes to find.
    return pids;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    if (cmdlineOf(pid).includes(configPath)) pids.push(pid);
  }
  return pids;
}

/**
 * Wait until the processes are gone.
 *
 * A process that has terminated but has not been collected yet is gone
 * as well: it runs nothing and holds nothing but its place in the
 * process table.
 */
async function waitUntilGone(pids: number[], timeoutMs = 15000): Promise<boolean> {
  return waitFor(async () => pids.every((pid) => !isProcessAlive(pid)), timeoutMs);
}

/** What the start of the daemon says. */
type DaemonStart = { started: boolean; pid: number | null; error?: string };

/**
 * Write the configuration of a throwaway installation.
 *
 * The file is written where the test says it is, and the state of the
 * installation is the directory of the test.
 *
 * The state directory is named in the file, unless the test says that
 * the configuration names none: a daemon that was given such a
 * configuration has to resolve the state directory itself.
 */
function writeConfig(
  dir: string,
  registryPort: number,
  relayPort: number,
  options: { stateDir?: string } = {},
): string {
  const configPath = path.join(dir, 'config.json');
  const written: Config = {
    proxy: 'traefik',
    registryPort,
    relayPort,
    advertisedIp: '127.0.0.1',
    advertisedHost: '127.0.0.1',
    zone: 'example.com',
    entryPoints: ['websecure'],
    certResolver: 'cloudflare',
    tlsMode: 'wildcard',
    securityHeaders: false,
    compressMiddleware: false,
    middlewareProvider: 'file',
    allowedCidrs: ['127.0.0.1/32'],
    registryAllowedCidrs: [],
    secret: '',
    stateDir: options.stateDir ?? dir,
    documentFormat: 'yaml',
    logMaxBytes: 1024 * 1024,
    logKeep: 2,
    autostart: true,
  };
  fs.writeFileSync(configPath, JSON.stringify(written, null, 2));
  return configPath;
}

async function setup(): Promise<{ dir: string; configPath: string; config: Config; startDaemon: () => Promise<DaemonStart> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-daemon-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = writeConfig(dir, registryPort, relayPort);
  // The daemon of the test runs in the throwaway directory and in
  // nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // read it nor write to it.
  const isolation = isolate(dir);
  const config = loadConfig({ configPath, stateDir: dir });
  return {
    dir,
    configPath,
    config,
    startDaemon: () => isolation.run(() => ensureDaemon(config, { configPath })),
  };
}

/**
 * Stop the daemon of an installation and wait until it is gone.
 *
 * The wait is on the processes, not on the health probe: the probe
 * answers for whoever holds the port, and the daemon that comes after
 * this one cannot bind a port that is still held.
 */
async function stopDaemon(configPath: string): Promise<void> {
  const pids = processesOf(configPath);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await waitUntilGone(pids);
}

test('ensureDaemon starts the daemon and waits until it is healthy', async (t) => {
  const { dir, configPath, config, startDaemon } = await setup();
  t.after(async () => {
    await stopDaemon(configPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const result = await startDaemon();
  assert.equal(result.started, true);
  assert.ok(result.pid, 'the daemon should have a pid');
  assert.equal(await isHealthy(config), true);

  const status = await daemonStatus(config);
  assert.equal(status.healthy, true);
  assert.ok(fs.existsSync(path.join(dir, 'daemon.pid')));
  assert.ok(fs.existsSync(path.join(dir, 'daemon.log')));
});

test('ensureDaemon is a no-op when the daemon is already running', async (t) => {
  const { dir, configPath, startDaemon } = await setup();
  t.after(async () => {
    await stopDaemon(configPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await startDaemon();
  const second = await startDaemon();
  assert.equal(second.started, false);
  assert.ok(second.pid);
});

test('the daemon serves the registrations written by the CLI', async (t) => {
  const { dir, configPath, config, startDaemon } = await setup();
  t.after(async () => {
    await stopDaemon(configPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await startDaemon();
  const store = new RegistrationStore(dir);
  store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: config.zone });

  const body = await (await fetch(`http://127.0.0.1:${config.registryPort}/traefik`)).text();
  assert.match(body, /Host\(`feature-login\.alpha\.example\.com`\)/);
});

test('the daemon restarts after it was killed', async (t) => {
  const { dir, configPath, config, startDaemon } = await setup();
  t.after(async () => {
    await stopDaemon(configPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await startDaemon();
  const first = await daemonStatus(config);
  assert.ok(first.pid);
  const daemonPid = first.pid as number;

  // The daemon and the workers it supervises are the processes of the
  // installation. They are collected before the daemon is killed: a
  // worker that outlives its supervisor is not a child of anything any
  // more, and it still holds the port of the gateway.
  const processes = processesOf(configPath);
  assert.ok(processes.includes(daemonPid), 'the daemon should be a process of the installation');
  const workers = processes.filter((pid) => pid !== daemonPid);

  process.kill(daemonPid, 'SIGTERM');

  // The daemon is gone when its process is gone. The health probe is
  // not the signal: it answers for whoever holds the port, and the
  // daemon that comes after this one cannot bind a port that is still
  // held. Waiting for the probe to fall silent says something about
  // the port, not about the daemon.
  const daemonGone = await waitUntilGone([daemonPid]);
  assert.equal(daemonGone, true, 'the daemon did not stop after SIGTERM');

  // The workers go with it. A worker that stays behind holds the port
  // of the gateway, and the daemon that comes after this one would not
  // be able to bind it.
  const workersGone = await waitUntilGone(workers);
  assert.equal(workersGone, true, 'a worker of the daemon outlived it and still holds the port');

  const restarted = await startDaemon();
  assert.equal(restarted.started, true);
  assert.ok(restarted.pid, 'the daemon that came back should have a pid');
  assert.notEqual(restarted.pid, daemonPid, 'the daemon that came back should be a new process');
  assert.equal(await isHealthy(config), true);
});

/**
 * The daemon that is started by hand.
 *
 * The daemon is started the way the service unit starts it: the
 * configuration file travels on the command line, the state directory is
 * named by the environment, and the environment names another
 * installation as well. The daemon runs with the configuration it was
 * given: the name of the other installation does not decide where the
 * daemon keeps its state and its log.
 *
 * The daemon writes its log to the standard output, and the process
 * that starts it decides where the output goes: the log file of the
 * state directory, the way the CLI and the service unit do it.
 */
test('the daemon uses the configuration it was given, even when the environment names another installation', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-daemon-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The installation of the machine: another directory, with a
  // configuration of its own and with ports of its own.
  const installation = path.join(dir, 'machine-installation');
  fs.mkdirSync(installation, { recursive: true });
  const machineRegistryPort = await freePort();
  const machineRelayPort = await freePort();
  writeConfig(installation, machineRegistryPort, machineRelayPort, { stateDir: installation });

  // The installation of the test: the configuration the daemon is given.
  // The file names no state directory, so that the daemon has to
  // resolve one itself.
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = writeConfig(dir, registryPort, relayPort, { stateDir: '' });
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });

  // The daemon is started by hand, with the name of the installation of
  // the machine in its environment.
  let errors = '';
  const logFile = path.join(stateDir, 'daemon.log');
  const out = fs.openSync(logFile, 'a');
  const daemon = spawn(process.execPath, [path.join(REPO_ROOT, 'src', 'daemon.ts'), '--config', configPath], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: dir,
      GATEWARDEN_HOME: installation,
      GATEWARDEN_CONFIG: configPath,
      GATEWARDEN_STATE_DIR: stateDir,
    },
    stdio: ['ignore', out, 'pipe'],
  });
  fs.closeSync(out);
  daemon.stderr?.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  t.after(async () => {
    daemon.kill('SIGTERM');
    await waitUntilGone(processesOf(configPath));
  });

  // The daemon serves the ports of the configuration it was given, and
  // not the ports of the other installation.
  const served = await waitFor(async () => {
    try {
      const answer = await fetch(`http://127.0.0.1:${registryPort}/healthz`);
      return (await answer.text()).trim() === 'ok';
    } catch {
      return false;
    }
  }, 15000);
  assert.equal(served, true, `the daemon should serve: ${errors}`);

  // The state of the daemon is in the state directory it was given.
  assert.ok(fs.existsSync(path.join(stateDir, 'daemon.pid')), 'the pidfile should be in the state directory');

  // The daemon says which configuration file it runs with.
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, new RegExp(`config=${configPath}`), 'the daemon should say which configuration it uses');

  // The installation of the machine was not touched: the daemon did not
  // write its pidfile there, and it did not read the configuration of
  // that installation either.
  assert.equal(fs.existsSync(path.join(installation, 'daemon.pid')), false);
  assert.equal(fs.existsSync(path.join(installation, 'daemon.log')), false);
  assert.equal(fs.existsSync(path.join(installation, 'routes.json')), false);
});

test('the daemon respawns a worker that dies, the other listener keeps serving', async (t) => {
  const { dir, configPath, config, startDaemon } = await setup();
  t.after(async () => {
    await stopDaemon(configPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await startDaemon();
  const status = await daemonStatus(config);
  const pid = status.pid as number;

  const relayWorker = childrenOf(pid).find((child) => cmdlineOf(child).includes('worker.ts relay'));
  assert.ok(relayWorker, 'the relay worker should be a child of the daemon');

  process.kill(relayWorker, 'SIGKILL');

  const respawned = await waitFor(async () => {
    const children = childrenOf(pid);
    const worker = children.find((child) => cmdlineOf(child).includes('worker.ts relay'));
    return Boolean(worker) && worker !== relayWorker;
  }, 15000);
  assert.equal(respawned, true, 'the relay worker should have been respawned');

  // The registry listener was never touched.
  assert.equal(await isHealthy(config), true);
});

test('the workers of the daemon do not inherit GATEWARDEN_HOME', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-worker-'));
  const configPath = path.join(dir, 'config.json');
  const config = loadConfig({ configPath, stateDir: dir });

  const env = workerEnv(config, configPath, {
    PATH: '/usr/bin',
    GATEWARDEN_HOME: path.join(os.tmpdir(), 'gatewarden-machine-installation'),
    DEV_GATEWAY_HOME: path.join(os.tmpdir(), 'gatewarden-machine-installation'),
  });

  // The name of another installation is not in the environment of the
  // worker, and the name it had before the rename is not either.
  assert.equal(env['GATEWARDEN_HOME'], undefined);
  assert.equal(env['DEV_GATEWAY_HOME'], undefined);

  // The worker reads the configuration the daemon was given, and not the
  // one of the installation the name pointed at.
  assert.equal(resolveConfigPath({ env }), configPath);
  assert.equal(env['GATEWARDEN_CONFIG'], configPath);
  assert.equal(env['GATEWARDEN_STATE_DIR'], config.stateDir);
});

test('a worker of a daemon that was started by hand does not have GATEWARDEN_HOME', async (t) => {
  if (process.platform !== 'linux') {
    t.skip('the environment of a process is read from /proc, and /proc is Linux');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-worker-'));
  // The installation of the machine: another directory, outside the
  // throwaway directory of the test.
  const installation = path.join(dir, 'machine-installation');
  fs.mkdirSync(installation, { recursive: true });
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = writeConfig(dir, registryPort, relayPort);

  // The daemon is started by hand and the name of another installation is
  // in its environment: this is what the service unit and the autostart
  // of the CLI do. The daemon reads the configuration it was given, and
  // its workers must read it too.
  let errors = '';
  const daemon = spawn(process.execPath, [path.join(REPO_ROOT, 'src', 'daemon.ts'), '--config', configPath], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: dir,
      GATEWARDEN_HOME: installation,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  daemon.stderr?.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  t.after(async () => {
    daemon.kill('SIGTERM');
    await waitUntilGone(processesOf(configPath));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The daemon serves, so its workers run.
  const served = await waitFor(async () => {
    try {
      const answer = await fetch(`http://127.0.0.1:${registryPort}/healthz`);
      return (await answer.text()).trim() === 'ok';
    } catch {
      return false;
    }
  }, 15000);
  assert.equal(served, true, `the daemon should serve: ${errors}`);

  const workers = childrenOf(daemon.pid as number).filter((pid) => cmdlineOf(pid).includes('worker.ts'));
  assert.ok(workers.length > 0, 'the daemon should have workers');

  for (const worker of workers) {
    const environment = fs.readFileSync(`/proc/${worker}/environ`, 'utf8').split('\0');
    // The name of the home installation is not in the environment of the
    // worker, and the name it had before the rename is not either.
    assert.equal(
      environment.some((entry) => entry.startsWith('GATEWARDEN_HOME=')),
      false,
      `the worker ${worker} should not have GATEWARDEN_HOME`,
    );
    assert.equal(
      environment.some((entry) => entry.startsWith('DEV_GATEWAY_HOME=')),
      false,
      `the worker ${worker} should not have DEV_GATEWAY_HOME`,
    );
    // The configuration the daemon was given travels with the worker.
    assert.ok(
      environment.includes(`GATEWARDEN_CONFIG=${configPath}`),
      `the worker ${worker} should read the configuration of the daemon`,
    );
  }
});
