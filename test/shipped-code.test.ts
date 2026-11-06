/**
 * The code the package ships loads (S84).
 *
 * The guard of the source paths (S42) reads the text of the code and
 * says that no message of the package points at a file that is not
 * shipped. It does not say that the code loads. An import of a module
 * that is not there — a module that was renamed, a file that the
 * tarball does not hold — is invisible to a guard that reads text, and
 * it breaks the installation of the reader of the package: the package
 * installs, the command starts, and the module that is imported says
 * that it cannot be found.
 *
 * So this guard packs the package, unpacks the tarball into a clean
 * directory, and imports every module of the shipped build. A module
 * that does not load is named, with the error it gave.
 *
 * The imports run in a process of their own, one process per module:
 *
 *   - a module that does not load does not take the other modules with
 *     it, and the error belongs to the module that gave it;
 *   - two of the modules are programs: the daemon starts the workers
 *     and the worker starts a listener when they are imported. A
 *     program must not run while the guard looks at the package, so
 *     the module that starts the program is replaced by a stub for that
 *     one import. The imports of the program itself are still checked
 *     — they are what breaks an installation.
 *
 * The guard needs no network and no installed package: the runtime
 * dependencies are copied out of the checkout, the way the packaging
 * tests copy them.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { copyDependencyClosure, unpackTarball } from './helpers/install.ts';
import { makeTempDir } from './helpers/tempdir.ts';

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The manifest of the package. */
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  name: string;
  dependencies: Record<string, string>;
};

/**
 * The script that imports one module of the shipped package.
 *
 * The script runs in a process of its own and says in one word whether
 * the module loaded. Everything it writes to the standard error is the
 * error the module gave.
 */
const IMPORT_SCRIPT = `import { registerHooks } from 'node:module';

const moduleUrl = process.argv[2];
const replacements = JSON.parse(process.argv[3] ?? '{}');
const role = process.argv[4];

// The modules that start a program are replaced by a stub, so that the
// program does not run while the guard looks at the package.
if (Object.keys(replacements).length > 0) {
  registerHooks({
    load(url, context, nextLoad) {
      const source = replacements[url];
      if (source !== undefined) return { format: 'module', shortCircuit: true, source };
      return nextLoad(url, context);
    },
  });
}

// The worker wants a role and refuses to start without one, and the
// refusal comes before anything else. The role is given to it, so that
// the module is loaded and not refused.
if (role !== undefined && role !== '') process.argv[2] = role;

try {
  await import(moduleUrl);
} catch (error) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(text + '\\n');
  process.exit(1);
}

process.stdout.write('LOADED\\n');
process.exit(0);
`;

/**
 * The modules of the package that are programs.
 *
 * A program starts something when it is imported: the daemon starts the
 * workers, the worker starts a listener. The guard imports every module
 * of the shipped build, and a program must not run while the guard looks
 * at the package — so the module that starts the program is replaced by
 * a stub for that one import.
 *
 * The stub replaces the module that starts the program and not the
 * program itself: the imports of the program are what break an
 * installation, and they are checked when the program is imported.
 */
const PROGRAMS: Record<string, { stub: string; source: string; role?: string }> = {
  'dist/daemon.js': {
    stub: 'dist/core/daemon.js',
    source: 'export async function runDaemon() {}\n',
  },
  'dist/worker.js': {
    stub: 'dist/core/worker.js',
    source: 'export async function runWorker() {}\n',
    role: 'registry',
  },
};

/**
 * The environment of a nested npm.
 *
 * The configuration of the npm that runs the test would otherwise leak
 * into the npm the test runs, and the variables of the machine the test
 * runs on would decide where the code of the package looks for its
 * configuration and its state.
 */
function npmEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_config_')) continue;
    if (key.startsWith('npm_lifecycle_') || key === 'npm_command' || key === 'npm_execpath') continue;
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * Every module of the shipped build.
 *
 * The modules are the files of the `dist` directory of the package, and
 * the names are the paths they have in the package — the name of a
 * module is how the failure of a module is told to the reader.
 *
 * @param packageDir the directory of the package in the installation
 * @returns the paths of the modules, relative to the package, in
 *   alphabetical order
 */
function shippedModules(packageDir: string): string[] {
  const dist = path.join(packageDir, 'dist');
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) found.push(path.relative(packageDir, full).split(path.sep).join('/'));
    }
  };

  if (fs.existsSync(dist)) walk(dist);

  return found.sort();
}

/**
 * What an import of a module of the shipped build gave.
 */
interface ImportResult {
  /** Whether the module loaded. */
  loaded: boolean;
  /** What the module said when it did not load. */
  error: string;
}

describe('the code the package ships', () => {
  let workdir = '';
  let install = '';
  let packageDir = '';
  let home = '';
  let script = '';
  let modules: string[] = [];

  before(async () => {
    workdir = makeTempDir('gatewarden-shipped-');
    home = path.join(workdir, 'home');
    install = path.join(workdir, 'install');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(install, { recursive: true });

    // The build output of the working tree is what the package ships.
    // A build here would throw away the very thing the guard is about,
    // so the output that is there is the output that is packed. A
    // checkout without a build has nothing to look at, and it is built
    // first. A change in the source is in the guard after a build.
    if (!fs.existsSync(path.join(REPO_ROOT, 'dist'))) {
      await execFileAsync('npm', ['run', 'build'], {
        cwd: REPO_ROOT,
        timeout: 600_000,
        env: npmEnv(),
      });
    }

    // 1. Pack the package. The scripts of the package are skipped: the
    //    build is the build output of the working tree.
    const packed = await execFileAsync('npm', ['pack', '--ignore-scripts', '--pack-destination', workdir], {
      cwd: REPO_ROOT,
      timeout: 600_000,
      env: npmEnv(),
    });
    const name = packed.stdout.trim().split('\n').pop() as string;
    const tarball = path.join(workdir, name);

    // 2. Unpack the tarball into a directory that looks like an
    //    installation: the package under `node_modules`, its
    //    dependencies next to it.
    const modulesDir = path.join(install, 'node_modules');
    packageDir = path.join(modulesDir, ...MANIFEST.name.split('/'));
    await unpackTarball(tarball, packageDir);

    // 3. The runtime dependencies, copied out of the checkout: the
    //    install stays offline and hermetic. The whole closure is
    //    copied, not only the direct dependencies.
    for (const dependency of Object.keys(MANIFEST.dependencies)) {
      copyDependencyClosure(dependency, modulesDir, REPO_ROOT);
    }

    // 4. The script that does the importing.
    script = path.join(workdir, 'import-module.mjs');
    fs.writeFileSync(script, IMPORT_SCRIPT);

    modules = shippedModules(packageDir);
  });

  after(async () => {
    if (workdir === '') return;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  /**
   * Import a module of the shipped build, in a process of its own.
   *
   * @param module the path of the module, relative to the package
   * @returns what the import gave
   */
  async function importModule(module: string): Promise<ImportResult> {
    const program = PROGRAMS[module];
    const replacements: Record<string, string> = {};

    if (program !== undefined) {
      replacements[pathToFileURL(path.join(packageDir, program.stub)).href] = program.source;
    }

    const args = [script, pathToFileURL(path.join(packageDir, module)).href, JSON.stringify(replacements)];
    if (program?.role !== undefined) args.push(program.role);

    try {
      const { stdout } = await execFileAsync(process.execPath, args, {
        cwd: install,
        timeout: 60_000,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: home,
          GATEWARDEN_HOME: home,
          XDG_CONFIG_HOME: path.join(home, '.config'),
          XDG_STATE_HOME: path.join(home, '.local', 'state'),
          XDG_CACHE_HOME: path.join(home, '.cache'),
        },
      });

      // The script says that the module loaded. A module that ends the
      // process while it is imported says nothing, and it has not
      // loaded.
      if (!stdout.includes('LOADED')) {
        return { loaded: false, error: 'the module ended the process before it was loaded' };
      }

      return { loaded: true, error: '' };
    } catch (error) {
      const failure = error as { stderr?: string; message?: string };
      const text = (failure.stderr ?? '').trim();

      return { loaded: false, error: text === '' ? (failure.message ?? String(error)) : text };
    }
  }

  test('the package ships a build to look at', () => {
    assert.ok(modules.length > 0, 'the tarball holds no compiled output');
  });

  test('every module of the shipped build loads', async () => {
    const failures: string[] = [];

    for (const module of modules) {
      const result = await importModule(module);
      if (!result.loaded) failures.push(`${module}: ${result.error}`);
    }

    console.log(`imported ${modules.length} modules of the shipped build`);

    assert.deepEqual(
      failures,
      [],
      `the module(s) of the shipped build did not load:\n${failures.join('\n')}`,
    );
  });
});
