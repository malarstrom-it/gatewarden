import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig, listenHost } from '../src/core/config.ts';
import { ensureDaemon, isHealthy, daemonStatus, isProcessAlive } from '../src/core/daemonControl.ts';
import { RegistrationStore } from '../src/core/state.ts';
import type { Config } from '../src/core/types.ts';
import { isolate } from './helpers/isolation.ts';

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

async function setup(): Promise<{ dir: string; configPath: string; config: Config; startDaemon: () => Promise<DaemonStart> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-daemon-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
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
    stateDir: dir,
    documentFormat: 'yaml',
    logMaxBytes: 1024 * 1024,
    logKeep: 2,
    autostart: true,
  };
  fs.writeFileSync(configPath, JSON.stringify(written, null, 2));
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
 * The environment of the machine names an installation of its own.
 *
 * `GATEWARDEN_HOME` says that the configuration, the state and the log
 * of the gateway live in that one directory. The daemon of a test
 * belongs to the throwaway directory of the test and to nothing else,
 * and the function that puts the name back is what the test gives to
 * its cleanup.
 */
function nameAnInstallationOfTheMachine(installation: string): () => void {
  const before = process.env['GATEWARDEN_HOME'];
  process.env['GATEWARDEN_HOME'] = installation;
  return () => {
    if (before === undefined) delete process.env['GATEWARDEN_HOME'];
    else process.env['GATEWARDEN_HOME'] = before;
  };
}

test('the daemon serves the free ports, even when the environment names another installation', async (t) => {
  const { dir, configPath, config, startDaemon } = await setup();
  t.after(async () => {
    await stopDaemon(configPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The installation of the machine: a directory of its own, outside the
  // throwaway directory of the test, that does not exist.
  const installation = path.join(os.tmpdir(), `gatewarden-machine-installation-${path.basename(dir)}`);
  t.after(() => fs.rmSync(installation, { recursive: true, force: true }));
  t.after(nameAnInstallationOfTheMachine(installation));

  const result = await startDaemon();
  assert.equal(result.started, true);
  assert.ok(result.pid, 'the daemon should have a pid');

  // The daemon listens on the free ports of the throwaway installation.
  const health = await fetch(`http://127.0.0.1:${config.registryPort}/healthz`);
  assert.equal((await health.text()).trim(), 'ok');

  // The state of the daemon is in the throwaway directory.
  assert.ok(fs.existsSync(path.join(dir, 'daemon.pid')));
  assert.ok(fs.existsSync(path.join(dir, 'daemon.log')));

  // The installation of the machine was not touched: it does not exist,
  // and the daemon did not make it exist.
  assert.equal(fs.existsSync(installation), false);
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
