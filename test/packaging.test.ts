/**
 * The published package (S10, §2).
 *
 * Two acceptance criteria live here:
 *
 *   - the contents of `npm pack` are exactly the allow-list of the
 *     manifest: no more, and no less;
 *   - the tarball, installed into a temporary directory, gives a working
 *     `gatewarden` binary, a working MCP server and a pi extension pi
 *     can load.
 *
 * The install is hermetic, and it needs no network: the packaging layer
 * is layer L3 of §11.3, and L3 needs no network. The tarball is
 * unpacked into a directory that looks like an installation, the runtime
 * dependencies are copied out of the checkout, and the install script of
 * the package is run. It happens in a temporary directory, with a home of
 * its own, with ports the OS hands out, and with the daemon that the
 * install starts shut down again when the test is done. The gateway that
 * runs on the user's machine — the one on port 45001 and 45002 — is
 * never involved.
 *
 * The third acceptance criterion of §2.2 — a git install — has a test of
 * its own: a clone of the repository builds itself and ships the
 * compiled output.
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { listenHost } from '../src/core/config.ts';

import { copyDependencyClosure, linkBinaries, unpackTarball } from './helpers/install.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  license: string;
  type: string;
  bin: Record<string, string>;
  exports: Record<string, string>;
  files: string[];
  engines: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  pi: { extensions: string[]; skills: string[] };
  keywords: string[];
  private?: boolean;
};

/** The four tools the MCP server offers (§6.2). */
const MCP_TOOLS = ['dev_gateway_status', 'list_dev_servers', 'publish_dev_server', 'remove_dev_server'];

/**
 * The files that may name the old layout.
 *
 * They are the compatibility: the modules move the directories of the name
 * the package had before the rename and know the names of the service
 * units of that name, and the documents describe how the migration and the
 * deprecated environment variables work.
 */
const OLD_NAME_FILES = [
  'dist/core/paths.',
  'dist/core/migrate.',
  'dist/cli/service.',
  'dist/cli/healthcheck.',
  'README.md',
  'docs/setup.md',
  'docs/healthcheck.md',
];

/** The three tools the pi extension registers (§7). */
const PI_TOOLS = ['list_dev_servers', 'publish_dev_server', 'remove_dev_server'];

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

/** Every file under a directory, relative to the repository. */
function filesUnder(relativeDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
    }
  };
  walk(path.join(REPO_ROOT, relativeDir));
  return found;
}

/**
 * The files the tarball has to hold: the allow-list of the manifest, and
 * the manifest itself, which npm always ships.
 */
function expectedContents(): string[] {
  const expected = new Set<string>(['package.json']);

  for (const entry of MANIFEST.files) {
    const full = path.join(REPO_ROOT, entry);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      for (const file of filesUnder(entry)) expected.add(file);
    } else {
      expected.add(entry);
    }
  }

  return [...expected].sort();
}

/** The files the tarball holds. */
async function tarballContents(tarball: string): Promise<string[]> {
  const { stdout } = await execFileAsync('tar', ['-tzf', tarball], { timeout: 120_000 });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith('/'))
    .map((line) => (line.startsWith('package/') ? line.slice('package/'.length) : line))
    .sort();
}

/**
 * The environment of a nested npm.
 *
 * The configuration of the npm that runs the test would otherwise leak
 * into the npm the test runs: `npm publish --dry-run` sets
 * `npm_config_dry_run`, and a nested npm that inherits it packs and
 * installs nothing. npm reads its own configuration from the rc files
 * anyway, so the variables are dropped and the nested npm starts clean.
 *
 * The variable `CI` is dropped as well: the install script of the
 * package does nothing in a CI, on purpose, and the test is about the
 * daemon it starts when the install is not one.
 */
function npmEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_config_')) continue;
    if (key.startsWith('npm_lifecycle_') || key === 'npm_command' || key === 'npm_execpath') continue;
    if (key === 'CI') continue;
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

describe('the published package', () => {
  let workdir = '';
  let home = '';
  let install = '';
  let packageDir = '';
  let tarball = '';
  let registryPort = 0;
  let relayPort = 0;

  before(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-packaging-'));
    home = path.join(workdir, 'home');
    install = path.join(workdir, 'install');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(install, { recursive: true });

    registryPort = await freePort();
    relayPort = await freePort();

    // The configuration of a throwaway installation: its own state
    // directory and two ports the OS hands out.
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify(
        {
          registryPort,
          relayPort,
          advertisedIp: '127.0.0.1',
          advertisedHost: '127.0.0.1',
          zone: 'gwtest.local',
          entryPoints: ['websecure'],
          certResolver: 'testca',
          stateDir: home,
          documentFormat: 'yaml',
          autostart: true,
        },
        null,
        2,
      ),
    );

    // 1. Pack the package. `prepare` builds it, so the tarball carries
    //    the compiled output the package ships.
    const packed = await execFileAsync('npm', ['pack', '--pack-destination', workdir], {
      cwd: REPO_ROOT,
      timeout: 600_000,
      env: npmEnv(),
    });
    const name = packed.stdout.trim().split('\n').pop() as string;
    tarball = path.join(workdir, name);

    // 2. Install the tarball, the way a user installs it — without the
    //    registry: the runtime dependencies are copied out of the
    //    checkout, the commands are linked, and the install script of
    //    the package runs.
    const modules = path.join(install, 'node_modules');
    packageDir = path.join(modules, ...MANIFEST.name.split('/'));
    await unpackTarball(tarball, packageDir);

    for (const dependency of Object.keys(MANIFEST.dependencies)) {
      copyDependencyClosure(dependency, modules, REPO_ROOT);
    }
    linkBinaries(packageDir, modules, Object.keys(MANIFEST.bin));

    await execFileAsync(process.execPath, [path.join(packageDir, 'scripts', 'postinstall.mjs')], {
      cwd: install,
      timeout: 120_000,
      env: npmEnv({
        HOME: home,
        GATEWARDEN_HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(home, '.local', 'state'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
      }),
    });
  });

  after(async () => {
    if (workdir === '') return;

    // The daemon the install started has to go before the directory does.
    try {
      const pid = Number.parseInt(fs.readFileSync(path.join(home, 'daemon.pid'), 'utf8').trim(), 10);
      if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
    } catch {
      // The daemon was never started; nothing to stop.
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${registryPort}/healthz`);
        if (!response.ok) break;
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // The directory goes last, and it goes even when the daemon needed a
    // moment to let go of a file.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  });

  test('the manifest is the published one', () => {
    assert.equal(MANIFEST.name, '@malarstrom/gatewarden');
    assert.equal(MANIFEST.private, undefined, 'a private package is never published');
    assert.equal(MANIFEST.license, 'MIT');
    assert.equal(MANIFEST.type, 'module');
    assert.equal(MANIFEST.exports['.'], './dist/core/index.js');
    assert.equal(MANIFEST.bin['gatewarden'], 'bin/gatewarden.js');
    assert.equal(MANIFEST.bin['gatewarden-mcp'], 'bin/gatewarden-mcp.js');
    assert.equal(MANIFEST.bin['gatewarden-daemon'], 'bin/gatewarden-daemon.js');
    assert.equal(MANIFEST.engines['node'], '>=20.11');

    // The allow-list, not an ignore list (§2.1). The bin files are
    // named one by one, so that the tarball holds the three launchers
    // of §2.1 and nothing else.
    assert.deepEqual(MANIFEST.files, [
      'dist',
      'bin/gatewarden.js',
      'bin/gatewarden-mcp.js',
      'bin/gatewarden-daemon.js',
      'bin/entry.mjs',
      'scripts',
      'skills',
      'docs',
      'README.md',
      'LICENSE',
    ]);

    // A git install has to build itself: the compiled output is not in
    // the repository, and npm runs `prepare` for a package that comes
    // from a git repository (§2.2).
    assert.equal(MANIFEST.scripts['prepare'], 'npm run build');

    // The runtime dependencies are the two the specification names, and
    // the MCP SDK is a dev dependency (D5).
    assert.deepEqual(Object.keys(MANIFEST.dependencies).sort(), ['env-paths', 'proper-lockfile']);
    assert.ok(MANIFEST.devDependencies['@modelcontextprotocol/sdk'], 'the MCP SDK is a dev dependency');
    assert.equal(MANIFEST.dependencies['@modelcontextprotocol/sdk'], undefined);

    // The pi manifest points at the compiled output, so pi does not need
    // a TypeScript loader for the package.
    assert.deepEqual(MANIFEST.pi.extensions, ['dist/integrations/pi/extension.js']);
    assert.deepEqual(MANIFEST.pi.skills, ['./skills']);
    assert.ok(MANIFEST.keywords.includes('pi-package'));
  });

  test('a copy of the repository builds itself and ships the compiled output', async (t) => {
    // §2.2 promises that the package can be installed from a git
    // repository. The compiled output is not in the repository, so the
    // clone has to build itself — npm does that with `prepare`, when it
    // installs a package that comes from a git repository.
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-git-'));
    t.after(() => fs.rmSync(clone, { recursive: true, force: true }));

    // The clone: the working tree, without the files that are not in
    // the repository.
    fs.cpSync(REPO_ROOT, clone, {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source);
        if (name === 'node_modules' || name === 'dist' || name === '.git') return false;
        return true;
      },
    });
    assert.equal(fs.existsSync(path.join(clone, 'dist')), false, 'the clone has a dist/ — it should not');

    // The dependencies of the build come from the checkout, so that the
    // clone needs no network.
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(clone, 'node_modules'), 'dir');

    // `npm run prepare` is what npm runs for a package that comes from a
    // git repository.
    await execFileAsync('npm', ['run', 'prepare'], {
      cwd: clone,
      timeout: 600_000,
      env: npmEnv(),
    });

    assert.ok(
      fs.existsSync(path.join(clone, 'dist', 'cli', 'index.js')),
      'the clone did not build itself: there is no compiled output',
    );

    // The tarball of the clone carries the compiled output, so that the
    // installation of a git dependency has a binary to run.
    const packed = await execFileAsync('npm', ['pack', '--pack-destination', clone], {
      cwd: clone,
      timeout: 600_000,
      env: npmEnv(),
    });
    const name = packed.stdout.trim().split('\n').pop() as string;
    const contents = await tarballContents(path.join(clone, name));

    assert.ok(
      contents.includes('dist/cli/index.js'),
      'the tarball of the clone does not carry the compiled output',
    );
    assert.ok(
      contents.includes('bin/gatewarden.js'),
      'the tarball of the clone does not carry the launcher',
    );
  });

  test('the tarball holds exactly the allow-list', async () => {
    const actual = await tarballContents(tarball);
    const expected = expectedContents();

    const extra = actual.filter((file) => !expected.includes(file));
    const missing = expected.filter((file) => !actual.includes(file));

    assert.deepEqual(extra, [], 'the tarball holds files the allow-list does not name');
    assert.deepEqual(missing, [], 'the tarball does not hold files the allow-list names');
  });

  test('the tarball holds no name of the old package', async () => {
    // The package was renamed. What is published carries the new name
    // and nothing of the old one: not a file name, not a line of text.
    // The two modules that implement the compatibility are the one
    // exception: they name the directories the migration moves.
    const actual = await tarballContents(tarball);
    const hits: string[] = [];

    for (const file of actual) {
      if (/dev-gateway/i.test(file)) hits.push(`${file}: a file of the old name`);
    }

    for (const file of actual) {
      if (!/\.(md|mjs|js|json|ts|map)$/.test(file)) continue;
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      // The old package name ends in the old product name, so this one
      // check covers both.
      if (!text.includes('dev-gateway')) continue;
      if (!OLD_NAME_FILES.some((prefix) => file.startsWith(prefix))) {
        hits.push(`${file}: the old name`);
      }
    }

    assert.deepEqual(hits, [], 'the published package still carries the old name:\n' + hits.join('\n'));
  });

  test('the tarball holds the licence and the readme', async () => {
    const actual = await tarballContents(tarball);

    assert.ok(actual.includes('LICENSE'), 'the licence is not in the tarball');
    assert.ok(actual.includes('README.md'), 'the readme is not in the tarball');
    assert.ok(actual.includes('dist/core/index.js'), 'the exported entry point is not in the tarball');
    assert.ok(actual.includes('skills/gatewarden/SKILL.md'), 'the skill is not in the tarball');
    assert.ok(actual.includes('docs/AGENTS.md'), 'the agent instructions are not in the tarball');
  });

  test('the install starts the daemon of the installation', async (t) => {
    // The install script does not start a daemon when it runs as root:
    // a global install as root must not start a daemon for one user.
    // The runner of the CI is root, and there is no daemon to wait for.
    if (process.getuid?.() === 0) {
      t.skip('the install script does not start a daemon as root');
      return;
    }

    const deadline = Date.now() + 30_000;
    let healthy = false;

    while (Date.now() < deadline && !healthy) {
      try {
        const response = await fetch(`http://127.0.0.1:${registryPort}/healthz`);
        healthy = response.ok && (await response.text()).trim() === 'ok';
      } catch {
        // not up yet
      }
      if (!healthy) await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.equal(healthy, true, 'the daemon of the installed package did not answer');
  });

  test('the installed binary runs', async () => {
    const binary = path.join(install, 'node_modules', '.bin', 'gatewarden');

    const { stdout } = await execFileAsync(binary, ['--version'], {
      env: { ...process.env, HOME: home, GATEWARDEN_HOME: home },
      timeout: 60_000,
    });

    assert.equal(stdout.trim(), MANIFEST.version);
  });

  test('the installed binary registers a route', async () => {
    const binary = path.join(install, 'node_modules', '.bin', 'gatewarden');

    const { stdout } = await execFileAsync(
      binary,
      ['register', '--project', 'packaged', '--branch', 'main', '--port', '4321'],
      {
        env: { ...process.env, HOME: home, GATEWARDEN_HOME: home },
        cwd: workdir,
        timeout: 120_000,
      },
    );

    assert.match(stdout, /^registered /m, 'the register command did not report a registration');

    const listed = await execFileAsync(binary, ['list', '--json'], {
      env: { ...process.env, HOME: home, GATEWARDEN_HOME: home },
      timeout: 60_000,
    });
    const routes = (JSON.parse(listed.stdout) as { routes: Array<{ fqdn: string }> }).routes;

    assert.equal(routes.length, 1, 'the route of the installed package is not in the list');
    assert.equal(routes[0]?.fqdn, 'main.packaged.gwtest.local');
  });

  test('the installed package is importable by its name', async () => {
    // The `exports` of the manifest: the core is the entry point, and the
    // adapters are reachable under their own path.
    const script = path.join(install, 'import.mjs');
    fs.writeFileSync(
      script,
      [
        "const core = await import('@malarstrom/gatewarden');",
        "const adapters = await import('@malarstrom/gatewarden/adapters');",
        'console.log(JSON.stringify({',
        '  core: Object.keys(core).length,',
        '  adapters: Object.keys(adapters).length,',
        '}));',
      ].join('\n'),
    );

    const { stdout } = await execFileAsync(process.execPath, [script], {
      cwd: install,
      timeout: 60_000,
      env: npmEnv({ HOME: home, GATEWARDEN_HOME: home }),
    });

    const imported = JSON.parse(stdout.trim()) as { core: number; adapters: number };
    assert.ok(imported.core > 0, 'the core entry point exports nothing');
    assert.ok(imported.adapters > 0, 'the adapters entry point exports nothing');
  });

  test('the installed MCP server answers', async () => {
    const server = spawn(process.execPath, [path.join(packageDir, 'bin', 'gatewarden-mcp.js')], {
      env: { ...process.env, HOME: home, GATEWARDEN_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines: string[] = [];
    let buffer = '';
    server.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts) if (line.trim().length > 0) lines.push(line);
    });

    let stderr = '';
    server.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    try {
      const ask = async (message: Record<string, unknown>): Promise<Record<string, unknown>> => {
        server.stdin.write(`${JSON.stringify(message)}\n`);
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const line = lines.shift();
          if (line !== undefined) {
            const answer = JSON.parse(line) as Record<string, unknown>;
            if (answer['id'] === message['id']) return answer;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`the MCP server did not answer ${String(message['method'])}:\n${stderr}`);
      };

      const handshake = await ask({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      });
      const result = handshake['result'] as { serverInfo: { name: string }; capabilities: { tools: unknown } };

      assert.equal(result.serverInfo.name, 'gatewarden');
      assert.ok(result.capabilities.tools, 'the server offers no tools');

      const listed = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const tools = (listed['result'] as { tools: Array<{ name: string }> }).tools;

      assert.deepEqual(tools.map((tool) => tool.name).sort(), MCP_TOOLS);
    } finally {
      server.stdin.end();
      server.kill('SIGTERM');
    }
  });

  test('pi loads the installed extension', async () => {
    // The path comes from the pi manifest of the *installed* package: the
    // manifest is what pi reads.
    const installed = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      pi: { extensions: string[] };
    };
    const extensionPath = path.join(packageDir, ...(installed.pi.extensions[0] as string).split('/'));
    assert.ok(fs.existsSync(extensionPath), 'the extension is not in the installed package');

    const pi = await piModule();

    if (!pi) {
      // No pi on this machine: the extension's own contract is checked
      // instead — the module loads and registers what pi would get.
      assert.equal(
        await piOnPath(),
        false,
        'pi is installed on this machine, but its loader could not be found',
      );

      const module = (await import(pathToFileURL(extensionPath).href)) as {
        default: (api: unknown) => void;
      };
      const registered = { tools: [] as string[], commands: [] as string[] };
      module.default({
        registerTool: (tool: { name: string }) => registered.tools.push(tool.name),
        registerCommand: (name: string) => registered.commands.push(name),
        on: () => undefined,
      });

      assert.deepEqual(registered.tools.sort(), PI_TOOLS);
      assert.deepEqual(registered.commands, ['routes']);
      return;
    }

    // The loader of the pi that is installed on this machine: the same
    // one that loads the extension when pi starts.
    const agentDir = path.join(workdir, 'pi-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    const loaded = await pi.discoverAndLoadExtensions([extensionPath], workdir, agentDir);

    assert.deepEqual(
      loaded.errors.map((error) => `${error.path}: ${error.error}`),
      [],
      'pi could not load the extension',
    );
    assert.equal(loaded.extensions.length, 1, 'pi did not load the extension');

    const extension = loaded.extensions[0];
    assert.ok(extension, 'pi loaded no extension');
    assert.deepEqual([...extension.tools.keys()].sort(), PI_TOOLS);
    assert.ok(extension.commands.has('routes'), 'the /routes command is not registered');
  });

  test('pi finds the extension and the skill through the pi manifest', async () => {
    const pi = await piModule();
    if (!pi) {
      assert.equal(await piOnPath(), false, 'pi is installed, but its package manager could not be found');
      return;
    }

    // A pi of its own: the agent directory is a temporary one, so the
    // settings of the user are neither read nor written.
    const agentDir = path.join(workdir, 'pi-package-agent');
    fs.mkdirSync(agentDir, { recursive: true });

    await execFileAsync(await piBinary(), ['install', packageDir], {
      cwd: workdir,
      timeout: 300_000,
      env: npmEnv({ PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', HOME: home }),
    });

    const settings = pi.SettingsManager.create(workdir, agentDir);
    const packages = new pi.DefaultPackageManager({
      cwd: workdir,
      agentDir,
      settingsManager: settings,
    });
    const resolved = await packages.resolve();

    const extension = path.join(packageDir, 'dist', 'integrations', 'pi', 'extension.js');
    const skill = path.join(packageDir, 'skills', 'gatewarden', 'SKILL.md');

    assert.ok(
      resolved.extensions.some((resource: { path: string }) => resource.path === extension),
      'pi did not find the extension of the package',
    );
    assert.ok(
      resolved.skills.some((resource: { path: string }) => resource.path === skill),
      'pi did not find the skill of the package',
    );
  });
});

/** Is there a pi on the path of this machine? */
async function piOnPath(): Promise<boolean> {
  try {
    await execFileAsync('which', ['pi'], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

/** The path of the pi on the path of this machine. */
async function piBinary(): Promise<string> {
  const { stdout } = await execFileAsync('which', ['pi'], { timeout: 60_000 });
  return stdout.trim();
}

/**
 * The pi that is installed on this machine, when there is one.
 *
 * pi is the host of the extension, not a dependency of the package: the
 * test uses it when it is there, and does not require it.
 */
async function piModule(): Promise<
  | {
      discoverAndLoadExtensions: (
        paths: string[],
        cwd: string,
        agentDir: string,
      ) => Promise<{
        extensions: Array<{ tools: Map<string, unknown>; commands: Map<string, unknown> }>;
        errors: Array<{ path: string; error: string }>;
      }>;
      SettingsManager: {
        create: (cwd: string, agentDir: string) => unknown;
      };
      DefaultPackageManager: new (options: {
        cwd: string;
        agentDir: string;
        settingsManager: unknown;
      }) => { resolve: () => Promise<{ extensions: Array<{ path: string }>; skills: Array<{ path: string }> }> };
    }
  | undefined
> {
  const candidates: string[] = [];

  // The global npm root, where pi is installed as a dependency.
  try {
    const { stdout } = await execFileAsync('npm', ['root', '-g'], { timeout: 60_000, env: npmEnv() });
    candidates.push(path.join(stdout.trim(), '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'));
  } catch {
    // No npm, no global root: no pi.
  }

  // The pi that is on the path: the launcher is a link into the
  // installation, and the installation is what holds the loader.
  try {
    const { stdout } = await execFileAsync('which', ['pi'], { timeout: 60_000 });
    const launcher = fs.realpathSync(stdout.trim());
    const marker = `${path.sep}@earendil-works${path.sep}pi-coding-agent${path.sep}`;
    const at = launcher.indexOf(marker);
    if (at !== -1) {
      const root = launcher.slice(0, at + marker.length - 1);
      candidates.push(path.join(root, 'dist', 'index.js'));
    }
  } catch {
    // No pi on the path.
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const module = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
      if (
        typeof module['discoverAndLoadExtensions'] === 'function' &&
        typeof module['SettingsManager'] === 'function' &&
        typeof module['DefaultPackageManager'] === 'function'
      ) {
        return module as never;
      }
    } catch {
      // Not this one; try the next.
    }
  }

  return undefined;
}
