/**
 * The daemon and its workers read the same configuration file.
 *
 * The configuration file lives in the XDG configuration directory, not in
 * the state directory. A daemon that is started by hand (the way the
 * README documents it) has no environment to inherit, so it has to resolve
 * the file the same way the CLI does — and hand that file to the workers
 * it forks. Otherwise the workers serve the default configuration.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { logFileFor } from '../src/core/paths.ts';
import { openLogFile } from '../src/core/daemonControl.ts';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAEMON = path.join(REPO_ROOT, 'bin', 'gatewarden-daemon.js');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = (server.address() as net.AddressInfo);
      server.close(() => resolve(port));
    });
  });
}

/** A home directory of its own, with a configuration file in it. */
function makeHome(registryPort: number, relayPort: number): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-daemon-'));
  const configDir = path.join(home, '.config', 'gatewarden');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(
      {
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
        secret: '',
        stateDir: '',
        documentFormat: 'yaml',
        logMaxBytes: 5 * 1024 * 1024,
        logKeep: 3,
        autostart: true,
      },
      null,
      2,
    ),
  );
  return home;
}

/** The environment of a process that only knows its home directory. */
function homeEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  };
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listening = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (listening) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

/** Does the registry answer its health probe? */
async function waitForHealth(port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.text()).trim() === 'ok') return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

test('a daemon that is started by hand gives its workers the configuration file', async (t) => {
  const registryPort = await freePort();
  const relayPort = await freePort();
  const home = makeHome(registryPort, relayPort);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  // Started the way the README documents it: no environment, no arguments.
  const daemon = spawn(process.execPath, [DAEMON], {
    env: homeEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  daemon.stdout.on('data', (chunk) => (output += chunk));
  daemon.stderr.on('data', (chunk) => (output += chunk));
  t.after(() => daemon.kill('SIGTERM'));

  // The workers bind the ports of the configuration file, not the defaults.
  assert.equal(await waitForHealth(registryPort), true, `the registry did not answer:\n${output}`);
  assert.equal(await waitForPort(relayPort), true, `the relay did not listen:\n${output}`);
  assert.match(output, new RegExp(`registry=${registryPort}`));
  assert.match(output, new RegExp(`relay=${relayPort}`));
});

test('the log file is opened, and the directory it lives in is created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-log-'));
  try {
    const logFile = path.join(dir, 'logs', 'of', 'the', 'platform', 'daemon.log');
    const handle = openLogFile(logFile);
    fs.closeSync(handle);

    assert.ok(fs.existsSync(logFile), 'the log file was not created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the log directory is the state directory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-log-'));
  try {
    const stateDir = path.join(home, 'state');
    const logFile = logFileFor(stateDir);
    assert.equal(path.dirname(logFile), stateDir, 'the log is not in the state directory');

    const handle = openLogFile(logFile);
    fs.closeSync(handle);

    assert.ok(fs.existsSync(logFile), 'the log file was not created');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a daemon that is started with a configuration file on the command line reads it', async (t) => {
  const registryPort = await freePort();
  const relayPort = await freePort();
  const home = makeHome(registryPort, relayPort);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const configFile = path.join(home, '.config', 'gatewarden', 'config.json');
  const daemon = spawn(process.execPath, [DAEMON, '--config', configFile], {
    env: homeEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  daemon.stdout.on('data', (chunk) => (output += chunk));
  daemon.stderr.on('data', (chunk) => (output += chunk));
  t.after(() => daemon.kill('SIGTERM'));

  assert.equal(await waitForHealth(registryPort), true, `the registry did not answer:\n${output}`);
  assert.equal(await waitForPort(relayPort), true, `the relay did not listen:\n${output}`);
});
