import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { isHealthy } from '../src/daemonControl.ts';
import { RegistrationStore } from '../src/state.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'traefik-dev.js');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function setup(): Promise<{ dir: string; configPath: string; run: (args: string[]) => Promise<string> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-cli-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
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
        allowedCidrs: ['127.0.0.1/32', '::1/128'],
        secret: '',
        stateDir: dir,
        documentFormat: 'yaml',
      },
      null,
      2,
    ),
  );

  const run = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...args, '--config', configPath, '--state-dir', dir]);
    return stdout;
  };
  return { dir, configPath, run };
}

async function stopDaemon(configPath: string, dir: string): Promise<void> {
  const config = loadConfig({ configPath, stateDir: dir });
  try {
    const pid = Number.parseInt(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8').trim(), 10);
    if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
  } catch {
    // not running
  }
  await waitFor(async () => !(await isHealthy(config)), 8000);
}

test('register starts the daemon and records the registration', async (t) => {
  const { dir, configPath, run } = await setup();
  t.after(async () => {
    await stopDaemon(configPath, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const output = await run(['register', '--project', 'probe', '--branch', 'feature/login', '--port', '3999']);
  assert.match(output, /main\.probe|feature-login\.probe/);
  assert.match(output, /https:\/\/feature-login\.probe\.home\.malarstrom\.com/);

  const store = new RegistrationStore(dir);
  const registrations = store.list();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].devPort, 3999);
  assert.equal(registrations[0].fqdn, 'feature-login.probe.home.malarstrom.com');

  const config = loadConfig({ configPath, stateDir: dir });
  assert.equal(await isHealthy(config), true, 'the daemon must be running after register');
});

test('registering the same project and branch twice keeps one registration', async (t) => {
  const { dir, configPath, run } = await setup();
  t.after(async () => {
    await stopDaemon(configPath, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await run(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);
  await run(['register', '--project', 'probe', '--branch', 'main', '--port', '4000']);

  const store = new RegistrationStore(dir);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].devPort, 4000);
});

test('list and status report the state, unregister removes it', async (t) => {
  const { dir, configPath, run } = await setup();
  t.after(async () => {
    await stopDaemon(configPath, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await run(['register', '--project', 'probe', '--branch', 'main', '--port', '3999']);

  const list = await run(['list']);
  assert.match(list, /probe/);
  assert.match(list, /main\.probe\.home\.malarstrom\.com/);

  const status = await run(['status']);
  assert.match(status, /daemon:\s+running/);
  assert.match(status, /registrations: 1/);

  await run(['unregister', '--project', 'probe', '--branch', 'main']);
  const after = await run(['list']);
  assert.match(after, /no registrations/);
});

test('register rejects invalid input', async () => {
  const { dir, configPath } = await setup();
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [CLI, 'register', '--project', 'probe', '--branch', 'main', '--port', 'abc', '--config', configPath, '--state-dir', dir]),
      /invalid --port/,
    );
    await assert.rejects(
      execFileAsync(process.execPath, [CLI, 'register', '--project', 'probe', '--config', configPath, '--state-dir', dir]),
      /register needs --project, --branch and --port/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
