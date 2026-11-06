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
import { builtinModules } from 'node:module';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { listenHost } from '../src/core/config.ts';
import { isolate } from './helpers/isolation.ts';
import { makeTempDir } from './helpers/tempdir.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(REPO_ROOT, 'dist');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Ask the OS for a free TCP port. */
/**
 * Ask the OS for a free TCP port.
 *
 * The port is asked for on the address the daemon binds: the daemon
 * listens on every address of the machine, and a port that is free on
 * the loopback address alone is not free for it.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, listenHost(), () => {
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
    'cli/index.js',
    'cli/setup.js',
    'cli/service.js',
    'daemon.js',
    'worker.js',
    'core/daemon.js',
    'core/daemonControl.js',
    'core/registry.js',
    'core/util/module.js',
    'adapters/traefik.js',
    'integrations/pi/extension.js',
  ];
  for (const name of modules) {
    assert.ok(fs.existsSync(path.join(DIST, name)), `dist/${name} is missing — the build wrote nothing usable`);
  }
});

test('the compiled imports point at JavaScript', () => {
  const compiled = fs.readFileSync(path.join(DIST, 'cli', 'index.js'), 'utf8');
  assert.doesNotMatch(compiled, /from "\.\.?\/[^"]*\.ts"/, 'a .ts import specifier survived the build');
  assert.match(compiled, /from "\.\.\/core\/config\.js"/);
});

test('the compiled pi extension depends on nothing but the package', () => {
  // pi is the host, not a dependency: the compiled extension may not
  // import the harness, and it may not need a schema library either.
  //
  // The whole closure is walked, not only the extension: the extension
  // imports the core, and the core is where a dependency would sneak
  // in. Every specifier in the closure has to be a relative one (a
  // module of the package), a node builtin, or one of the runtime
  // dependencies the manifest declares.
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const allowed = new Set(Object.keys(manifest.dependencies ?? {}));
  const builtins = new Set(builtinModules);

  const seen = new Set<string>();
  const queue = [path.join(DIST, 'integrations', 'pi', 'extension.js')];
  const foreign: string[] = [];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    assert.ok(fs.existsSync(file), `${path.relative(REPO_ROOT, file)} is imported but was not built`);
    const source = fs.readFileSync(file, 'utf8');

    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), specifier));
        continue;
      }
      const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
      if (specifier.startsWith('node:') || builtins.has(bare)) continue;
      if (allowed.has(specifier)) continue;
      foreign.push(`${path.relative(REPO_ROOT, file)} imports ${specifier}`);
    }
  }

  assert.ok(seen.size > 1, 'the closure of the extension is empty, which cannot be');
  assert.deepEqual(foreign, [], 'the extension pulls in something the package does not declare');
});

/**
 * Every import specifier of a compiled module.
 *
 * The compiler keeps the quoting of the source for a bare specifier
 * (`import envPaths from 'env-paths';`) and writes the rewritten relative
 * ones with double quotes. Both are matched, or a dependency would slip
 * through the guard.
 */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1] as string);
    }
  }
  return specifiers;
}

test('the compiled CLI runs and prints the version', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

  const { stdout } = await execFileAsync(process.execPath, [path.join(DIST, 'cli', 'index.js'), '--version']);

  assert.equal(stdout.trim(), manifest.version);
});

test('the compiled sibling resolution points at the compiled modules', async () => {
  const helper = await import(pathToFileURL(path.join(DIST, 'core', 'util', 'module.js')).href);

  const worker = helper.siblingModulePath(pathToFileURL(path.join(DIST, 'daemon.js')).href, 'worker');

  assert.equal(worker, path.join(DIST, 'worker.js'));
  assert.ok(fs.existsSync(worker), 'the compiled worker is missing');
});

test('the compiled daemon serves and forks the compiled worker', async (t) => {
  const dir = makeTempDir('gatewarden-build-');
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

  // One route, so that the document the daemon serves holds a router.
  fs.writeFileSync(
    path.join(dir, 'routes.json'),
    JSON.stringify(
      {
        version: 1,
        registrations: [
          {
            id: 'alpha/main',
            project: 'alpha',
            branch: 'main',
            projectSlug: 'alpha',
            branchSlug: 'main',
            fqdn: 'main.alpha.gwtest.local',
            devPort: 3000,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
  );

  // The daemon of the test runs in the throwaway directory and in
  // nothing else: the environment of the machine says where the
  // installation of the machine is, and the daemon of a test must not
  // read it nor write to it.
  const isolation = isolate(dir);
  const daemon = spawn(process.execPath, [path.join(DIST, 'daemon.js'), '--config', configPath], {
    env: isolation.env,
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
  assert.match(document, /Host\(`main\.alpha\.gwtest\.local`\)/);
  assert.ok(!document.includes('dev-index'), 'the document must not hold an index router');
});
