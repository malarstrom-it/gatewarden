import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';
import { ensureDaemon, isHealthy, daemonStatus } from '../src/daemonControl.ts';
import { RegistrationStore } from '../src/state.ts';
import type { Config } from '../src/types.ts';

/** Ask the OS for a free TCP port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
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

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function setup(): Promise<{ dir: string; configPath: string; config: Config }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-daemon-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = path.join(dir, 'config.json');
  const config: Config = {
    proxy: 'traefik',
    registryPort,
    relayPort,
    advertisedIp: '127.0.0.1',
    advertisedHost: '127.0.0.1',
    zone: 'home.malarstrom.com',
    indexHost: 'index.home.malarstrom.com',
    entryPoints: ['websecure'],
    certResolver: 'cloudflare',
    tlsMode: 'wildcard',
    securityHeaders: false,
    compressMiddleware: false,
    middlewareProvider: 'file',
    allowedCidrs: ['127.0.0.1/32'],
    secret: '',
    stateDir: dir,
    documentFormat: 'yaml',
    logMaxBytes: 1024 * 1024,
    logKeep: 2,
    autostart: true,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { dir, configPath, config: loadConfig({ configPath, stateDir: dir }) };
}

async function stopDaemon(config: Config): Promise<void> {
  const status = await daemonStatus(config);
  if (status.pid) {
    try {
      process.kill(status.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await waitFor(async () => !(await isHealthy(config)), 8000);
}

test('ensureDaemon starts the daemon and waits until it is healthy', async (t) => {
  const { dir, configPath, config } = await setup();
  t.after(async () => {
    await stopDaemon(config);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const result = await ensureDaemon(config, { configPath });
  assert.equal(result.started, true);
  assert.ok(result.pid, 'the daemon should have a pid');
  assert.equal(await isHealthy(config), true);

  const status = await daemonStatus(config);
  assert.equal(status.healthy, true);
  assert.ok(fs.existsSync(path.join(dir, 'daemon.pid')));
  assert.ok(fs.existsSync(path.join(dir, 'daemon.log')));
});

test('ensureDaemon is a no-op when the daemon is already running', async (t) => {
  const { dir, configPath, config } = await setup();
  t.after(async () => {
    await stopDaemon(config);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await ensureDaemon(config, { configPath });
  const second = await ensureDaemon(config, { configPath });
  assert.equal(second.started, false);
  assert.ok(second.pid);
});

test('the daemon serves the registrations written by the CLI', async (t) => {
  const { dir, configPath, config } = await setup();
  t.after(async () => {
    await stopDaemon(config);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await ensureDaemon(config, { configPath });
  const store = new RegistrationStore(dir);
  store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: config.zone });

  const body = await (await fetch(`http://127.0.0.1:${config.registryPort}/traefik`)).text();
  assert.match(body, /Host\(`feature-login\.alpha\.home\.malarstrom\.com`\)/);
});

test('the daemon restarts after it was killed', async (t) => {
  const { dir, configPath, config } = await setup();
  t.after(async () => {
    await stopDaemon(config);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await ensureDaemon(config, { configPath });
  const first = await daemonStatus(config);
  assert.ok(first.pid);
  process.kill(first.pid as number, 'SIGTERM');
  assert.equal(await waitFor(async () => !(await isHealthy(config)), 8000), true);

  const restarted = await ensureDaemon(config, { configPath });
  assert.equal(restarted.started, true);
  assert.equal(await isHealthy(config), true);
  const status = await daemonStatus(config);
  assert.notEqual(status.pid, first.pid);
});

test('the daemon respawns a worker that dies, the other listener keeps serving', async (t) => {
  const { dir, configPath, config } = await setup();
  t.after(async () => {
    await stopDaemon(config);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await ensureDaemon(config, { configPath });
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
