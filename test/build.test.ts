/**
 * The build step (S0, D2).
 *
 * The gate of this slice is "npm run build && npm test is green", so the test
 * builds the package and then exercises the *compiled* output: the modules
 * that the published tarball carries. A build that writes no usable
 * JavaScript to `dist/` has to fail here, not pass.
 *
 * Three things are checked:
 *
 *   - the build writes the compiled modules to `dist/`, with the `.ts` import
 *     specifiers rewritten to `.js`;
 *   - the compiled CLI runs and tells its version;
 *   - the compiled daemon forks the compiled worker next to it, so the
 *     runtime strings resolve in the compiled package as well.
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(REPO_ROOT, 'dist');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Ask the OS for a free TCP port. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

before(async () => {
  // The build is part of the gate, so it runs here: the assertions below
  // look at the output the package ships.
  await execFileAsync('npm', ['run', 'build'], { cwd: REPO_ROOT, timeout: 300_000 });
});

test('the build writes the compiled modules to dist/', () => {
  const modules = [
    'cli.js',
    'daemon.js',
    'daemonControl.js',
    'registry.js',
    'worker.js',
    'util/module.js',
  ];
  for (const name of modules) {
    assert.ok(fs.existsSync(path.join(DIST, name)), `dist/${name} is missing — the build wrote nothing usable`);
  }
});

test('the compiled imports point at JavaScript', () => {
  const compiled = fs.readFileSync(path.join(DIST, 'cli.js'), 'utf8');
  assert.doesNotMatch(compiled, /from "\.\/[^"]*\.ts"/, 'a .ts import specifier survived the build');
  assert.match(compiled, /from "\.\/config\.js"/);
});

test('the compiled CLI runs and prints the version', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

  const { stdout } = await execFileAsync(process.execPath, [path.join(DIST, 'cli.js'), '--version']);

  assert.equal(stdout.trim(), manifest.version);
});

test('the compiled sibling resolution points at the compiled modules', async () => {
  const helper = await import(pathToFileURL(path.join(DIST, 'util', 'module.js')).href);

  const worker = helper.siblingModulePath(pathToFileURL(path.join(DIST, 'daemon.js')).href, 'worker');

  assert.equal(worker, path.join(DIST, 'worker.js'));
  assert.ok(fs.existsSync(worker), 'the compiled worker is missing');
});

test('the compiled daemon serves and forks the compiled worker', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

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
        zone: 'gwtest.local',
        indexHost: 'index.gwtest.local',
        entryPoints: ['websecure'],
        certResolver: 'testca',
        secret: '',
        stateDir: dir,
        documentFormat: 'yaml',
      },
      null,
      2,
    ),
  );

  const daemon = spawn(process.execPath, [path.join(DIST, 'daemon.js')], {
    env: { ...process.env, TRAEFIK_DEV_CONFIG: configPath, TRAEFIK_DEV_STATE_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  daemon.stdout.on('data', (chunk) => (output += chunk));
  daemon.stderr.on('data', (chunk) => (output += chunk));
  t.after(() => {
    daemon.kill('SIGTERM');
  });

  // The daemon answers only when the worker it forked — the compiled one,
  // next to it — is listening.
  let healthy = false;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !healthy) {
    await sleep(150);
    try {
      const response = await fetch(`http://127.0.0.1:${registryPort}/healthz`);
      healthy = response.ok && (await response.text()).trim() === 'ok';
    } catch {
      // not up yet
    }
  }
  assert.equal(healthy, true, `the compiled daemon did not answer /healthz:\n${output}`);

  const document = await (await fetch(`http://127.0.0.1:${registryPort}/traefik`)).text();
  assert.match(document, /routers:/);
});
