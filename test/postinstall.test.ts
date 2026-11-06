/**
 * The install script of the package (§5.2).
 *
 * The script that runs after an install has one job: write the
 * configuration file, and start nothing at all. The daemon is started by
 * the lazy start and by the explicit command `gatewarden start`, and an
 * install that starts a daemon makes the machine do something nobody
 * asked for.
 *
 * The guards around the script are the interesting part, and they are what
 * the tests are about.
 *
 * The tests that want the script to *do* something run it as an installed
 * package: a copy of the sources with a manifest that is not private. A
 * checkout is not an installation, and the script says so.
 *
 * The script runs as an ordinary user. A global install as root must not
 * write into the home of one user (§5.2), so on a machine that works as
 * root, such as the CI runner of this repository, the script stops before
 * it does anything, and every test here would be about a script that does
 * nothing. The tests therefore run the script as an ordinary user whenever
 * the machine has one, and skip themselves with a reason when it does not.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './helpers/tempdir.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'postinstall.mjs');

/**
 * The processes whose command line names a path.
 *
 * The daemon of an installation is started with the path of its
 * configuration file on the command line, so the processes that mention
 * the path are the processes of that installation. The list is empty on
 * the systems whose processes cannot be read that way: the check is
 * there for the machines that can answer it.
 */
function processesMentioning(needle: string): string[] {
  if (process.platform !== 'linux') return [];

  const found: string[] = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (cmdline.includes(needle)) found.push(`${entry}: ${cmdline.split('\0').join(' ')}`);
    } catch {
      // The process is gone, or it belongs to another user.
    }
  }
  return found;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * The user the script runs as.
 *
 * `uid` is undefined when the script runs as the user of the test, which is
 * the ordinary case. It is set when the machine works as root: the script
 * must not start a daemon as root, so it runs as an ordinary user instead.
 */
interface ScriptUser {
  /** The uid of the user, when the script drops to one. */
  uid?: number;
  /** The gid of the user, when the script drops to one. */
  gid?: number;
  /** The name of the user, for the messages. */
  name: string;
}

/**
 * The script as it runs when the test process is root: the script runs as
 * the user of the test, and that user is root.
 */
const AS_ROOT: ScriptUser = { name: 'root' };

/**
 * The ordinary user of the machine, when it has one.
 *
 * The script must not start a daemon when it runs as root, so a test that
 * wants to see the daemon start needs a user that is not root. `nobody` is
 * the one every Linux has; a machine without it has some other ordinary
 * user; a machine with neither has none, and the tests skip themselves.
 */
function ordinaryUser(): ScriptUser | null {
  let passwd: string;
  try {
    passwd = fs.readFileSync('/etc/passwd', 'utf8');
  } catch {
    return null;
  }
  const users = passwd
    .split('\n')
    .map((line) => line.split(':'))
    .filter((fields) => fields.length >= 4)
    .map((fields) => ({ name: fields[0] ?? '', uid: Number(fields[2]), gid: Number(fields[3]) }))
    .filter((user) => Number.isInteger(user.uid) && user.uid > 0);
  const user = users.find((candidate) => candidate.name === 'nobody') ?? users[0];
  return user ? { uid: user.uid, gid: user.gid, name: user.name } : null;
}

/**
 * The user the script runs as, and the reason it cannot, when it cannot.
 */
function scriptUser(): { user: ScriptUser | null; reason: string } {
  if (process.getuid?.() !== 0) {
    return { user: { name: 'the user of the test' }, reason: '' };
  }
  const user = ordinaryUser();
  return user
    ? { user, reason: '' }
    : {
        user: null,
        reason: 'the machine works as root and has no ordinary user to run the script as',
      };
}

/**
 * Can the user the script runs as read a file of the checkout?
 *
 * The script of the repository runs from the repository, so the user that
 * runs it has to be able to reach the checkout. A checkout in a directory
 * that the ordinary user cannot enter is a machine that this test skips
 * itself on, rather than fails on.
 */
function canRead(user: ScriptUser, file: string): Promise<boolean> {
  if (user.uid === undefined) return Promise.resolve(true);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('node:fs').accessSync(process.argv[1], require('node:fs').constants.R_OK)",
        file,
      ],
      {
        cwd: REPO_ROOT,
        env: { PATH: process.env['PATH'] ?? '' },
        uid: user.uid,
        gid: user.gid,
      },
    );
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * The user the script runs as, or nothing when the machine has none.
 *
 * The test is skipped when there is no ordinary user: a script that runs
 * as root does nothing at all, and a test about a script that does nothing
 * says nothing.
 */
function userOrSkip(t: TestContext): ScriptUser | null {
  const { user, reason } = scriptUser();
  if (!user) {
    t.skip(reason);
    return null;
  }
  return user;
}

/**
 * Give a directory to the user the script runs as.
 *
 * The script writes into the home of the installation: the configuration,
 * the state directory with the pidfile, the log. The daemon it starts
 * writes there too. The user that runs the script must own them.
 *
 * The symlinks are given, not what they point at: a link belongs to the
 * installation, and its target does not.
 */
function giveTo(user: ScriptUser, dir: string): void {
  if (user.uid === undefined) return;
  const gid = user.gid ?? user.uid;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    const stats = fs.lstatSync(current);
    fs.lchownSync(current, user.uid, gid);
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
    }
  }
}

/**
 * Run the script and collect what it says.
 *
 * The environment is built from scratch: only the variables of the test
 * travel with it. The runner sets `CI=true`, and the script must not see
 * that here — it would stop before it started the daemon, and the test
 * would be about a script that does nothing.
 */
function runScript(script: string, env: NodeJS.ProcessEnv, user: ScriptUser): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: REPO_ROOT,
      env: { PATH: process.env['PATH'] ?? '', ...env },
      ...(user.uid === undefined ? {} : { uid: user.uid, gid: user.gid }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

/** A throwaway installation the script may work on. */
function makeHome(user: ScriptUser): { home: string; configPath: string; stateDir: string } {
  const home = makeTempDir('gatewarden-postinstall-');
  const stateDir = path.join(home, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  giveTo(user, home);
  return { home, configPath: path.join(home, 'config.json'), stateDir };
}

/**
 * The dependencies the package needs when it runs (§2.1).
 *
 * The daemon the script starts reads them, so the installation has to carry
 * them with it.
 */
const RUNTIME_DEPENDENCIES = ['env-paths', 'proper-lockfile'];

/**
 * Copy the dependencies of the package into an installation.
 *
 * An installed package carries its dependencies with it: `npm install`
 * writes them into the `node_modules` of the package. The installation
 * borrows them from the checkout here, and a symlink to the checkout's
 * `node_modules` would tie the installation to a directory that the user
 * who runs the script may not be able to read.
 */
function copyDependencies(from: string, to: string, names: string[], done = new Set<string>()): void {
  for (const name of names) {
    if (done.has(name)) continue;
    done.add(name);
    const source = path.join(from, name);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(to, name), { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    copyDependencies(from, to, Object.keys(manifest.dependencies ?? {}), done);
  }
}

/**
 * The package as it is installed: the sources, the script, the
 * dependencies, and a manifest that is not private.
 */
function makeInstalledPackage(user: ScriptUser): { dir: string; script: string; cleanup: () => void } {
  const dir = makeTempDir('gatewarden-package-');
  fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: '@malarstrom/gatewarden', version: '0.1.1', type: 'module' },
      null,
      2,
    ),
  );
  // The dependencies of the package, as npm installs them.
  const modules = path.join(dir, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  copyDependencies(path.join(REPO_ROOT, 'node_modules'), modules, RUNTIME_DEPENDENCIES);
  giveTo(user, dir);
  return {
    dir,
    script: path.join(dir, 'scripts', 'postinstall.mjs'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** The environment of a throwaway installation. */
function environment(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    // The runner is a CI, and the script does nothing in a CI. The test
    // is about a script that starts a daemon, so the variable is emptied
    // here and set again by the test that is about a CI.
    CI: '',
    // The script must not see itself as a checkout: `INIT_CWD` is the
    // directory npm was called from, and a real installation is not the
    // package's own directory.
    INIT_CWD: home,
    ...extra,
  };
}

test('the script never fails the install', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  const home = makeHome(user);
  const installed = makeInstalledPackage(user);
  try {
    // A configuration file that cannot be read: the script has to swallow
    // the error and let the install finish.
    fs.writeFileSync(home.configPath, '{ this is not json\n');
    const result = await runScript(
      installed.script,
      environment(home.home, {
        GATEWARDEN_CONFIG: home.configPath,
        GATEWARDEN_STATE_DIR: home.stateDir,
      }),
      user,
    );
    assert.equal(result.code, 0, result.stderr);
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing when the scripts are ignored', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  const home = makeHome(user);
  const installed = makeInstalledPackage(user);
  try {
    await runScript(
      installed.script,
      environment(home.home, { npm_config_ignore_scripts: 'true' }),
      user,
    );
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing in a CI', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  const home = makeHome(user);
  const installed = makeInstalledPackage(user);
  try {
    await runScript(installed.script, environment(home.home, { CI: 'true' }), user);
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing when the autostart is turned off', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  const home = makeHome(user);
  const installed = makeInstalledPackage(user);
  try {
    await runScript(installed.script, environment(home.home, { GATEWARDEN_AUTOSTART: '0' }), user);
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing in a checkout', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  if (!(await canRead(user, SCRIPT))) {
    t.skip(`the ordinary user of the machine (${user.name}) cannot read the checkout (${REPO_ROOT})`);
    return;
  }
  const home = makeHome(user);
  try {
    // The package of the repository: a checkout holds the sources and the
    // build configuration, and a checkout is not an installation. The
    // `INIT_CWD` points somewhere else on purpose, so that the guard
    // that stops the script is the one that looks at the package itself.
    const result = await runScript(SCRIPT, environment(home.home, { INIT_CWD: home.home }), user);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing when the package is a checkout', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  const home = makeHome(user);
  const installed = makeInstalledPackage(user);
  try {
    // The sources and the build configuration are what make a directory a
    // checkout: the published package holds neither.
    fs.writeFileSync(path.join(installed.dir, 'tsconfig.build.json'), '{}');

    const result = await runScript(installed.script, environment(home.home), user);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script does nothing when it runs as root', async (t) => {
  // A global install as root must not start a daemon for one user (§5.2).
  // The test needs root to run the script as root, and a machine that is
  // not root cannot do that.
  if (process.getuid?.() !== 0) {
    t.skip('the machine does not work as root; the script cannot be run as root here');
    return;
  }
  const home = makeHome(AS_ROOT);
  const installed = makeInstalledPackage(AS_ROOT);
  try {
    const result = await runScript(installed.script, environment(home.home), AS_ROOT);

    assert.equal(result.code, 0, result.stderr);
    // Nothing was written, and no daemon was started: the script stopped
    // before it did anything.
    assert.equal(fs.existsSync(path.join(home.home, '.config')), false, 'the script wrote something');
    assert.equal(fs.existsSync(path.join(home.stateDir, 'daemon.pid')), false, 'the daemon started');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the script writes the configuration and starts nothing', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  const home = makeHome(user);
  const installed = makeInstalledPackage(user);

  try {
    const result = await runScript(
      installed.script,
      environment(home.home, {
        GATEWARDEN_CONFIG: home.configPath,
        GATEWARDEN_STATE_DIR: home.stateDir,
      }),
      user,
    );

    assert.equal(result.code, 0, result.stderr);

    // The script is silent: it writes to neither stdout nor stderr.
    assert.equal(result.stdout, '', 'the script wrote to stdout');
    assert.equal(result.stderr, '', 'the script wrote to stderr');

    // The configuration file is written, and it holds the default values.
    assert.ok(fs.existsSync(home.configPath), 'the script wrote no configuration file');
    const written = JSON.parse(fs.readFileSync(home.configPath, 'utf8')) as Record<string, unknown>;
    assert.equal(written['registryPort'], 45002);
    assert.equal(written['relayPort'], 45001);

    // The state directory is there.
    assert.ok(fs.existsSync(home.stateDir), 'the state directory was not created');

    // No daemon. The daemon writes its pidfile before it binds its port,
    // so a pidfile that is not there is a daemon that was not started —
    // and no process of the installation runs either.
    assert.equal(fs.existsSync(path.join(home.stateDir, 'daemon.pid')), false, 'the daemon started');
    assert.deepEqual(processesMentioning(home.configPath), [], 'the install started a process');
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});

test('the install does not import the old layout', async (t) => {
  const user = userOrSkip(t);
  if (!user) return;
  const home = makeHome(user);
  const installed = makeInstalledPackage(user);
  try {
    // The old layout of the user, in the home of the test.
    const legacy = path.join(home.home, '.traefik-dev');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, 'config.json'),
      JSON.stringify({
        zone: 'legacy.example',
        registryPort: 45002,
        relayPort: 45001,
        stateDir: legacy,
        // The daemon of the old layout is not the daemon of this test: the
        // autostart is off, so that the install does not leave a daemon
        // behind on the default ports of the machine.
        autostart: false,
      }),
    );
    fs.writeFileSync(
      path.join(legacy, 'registrations.json'),
      JSON.stringify({ version: 1, registrations: [{ id: 'probe/main' }] }),
    );

    const result = await runScript(
      installed.script,
      environment(home.home, {
        GATEWARDEN_CONFIG: path.join(home.home, 'config.json'),
        GATEWARDEN_STATE_DIR: home.stateDir,
      }),
      user,
    );

    assert.equal(result.code, 0, result.stderr);

    // The routes of the old layout are not copied: the migration is
    // `gatewarden migrate`'s job, not the install's.
    assert.ok(fs.existsSync(path.join(legacy, 'registrations.json')));
    assert.equal(fs.existsSync(path.join(home.stateDir, 'routes.json')), false);

    // The old directory is left in place.
    assert.ok(fs.existsSync(path.join(legacy, 'config.json')));
  } finally {
    installed.cleanup();
    fs.rmSync(home.home, { recursive: true, force: true });
  }
});
