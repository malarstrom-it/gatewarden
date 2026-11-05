/**
 * The installation of the package: where it is, and what belongs to it.
 *
 * The daemon runs from an installation — a directory that holds the
 * `package.json` of the package — and the files of the gateway live in
 * the directories of the user. This module knows the two, and it
 * knows when the first one is gone and the second one has to go with it:
 * the uninstall takes the files of the user with it.
 *
 * The rules:
 *
 * - a checkout is not an installation: a clone that is deleted must not
 *   take the files of the user with it;
 * - the tree the installation sits in has to be intact: `npm ci` removes
 *   the whole `node_modules` and builds it again, and the installation
 *   comes back with it;
 * - the home directory of the user, and every directory above it, hold
 *   more than the gateway and are never removed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The files the gateway owns in its state directory.
 *
 * Everything else in the directory belongs to somebody else and is left
 * in place.
 */
const OWNED_STATE_FILES = new Set([
  'routes.json',
  'routes.json.lock',
  'registrations.json',
  'daemon.pid',
  'daemon.log',
  'daemon.error',
]);

/** Is the file one of the gateway's own? */
export function isOwnedStateFile(name: string): boolean {
  return OWNED_STATE_FILES.has(name) || /^daemon\.log\.\d+$/.test(name);
}

/**
 * The directory of the installation the code runs from.
 *
 * The daemon is part of a package, and the directory that holds the
 * `package.json` of that package is the installation. The daemon watches
 * it, and stops itself when the installation is gone.
 *
 * The directory is null when there is none: code that runs from a
 * directory without a manifest is not part of an installation, and
 * nothing says that the directory belongs to one.
 */
export function installationRoot(moduleUrl: string): string | null {
  let dir = path.dirname(fileURLToPath(moduleUrl));

  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Is the directory a checkout of the repository, and not an installation?
 *
 * A checkout holds the sources and the build configuration; an
 * installation holds the compiled output and nothing else. The developer
 * who deletes a clone must not lose the files of the gateway.
 */
export function isCheckoutInstallation(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'src')) &&
    fs.existsSync(path.join(root, 'tsconfig.build.json'))
  );
}

/**
 * Is the tree the installation sits in still there?
 *
 * The tree is the `node_modules` the installation lives in — the one of
 * the project, or the one of the global prefix. It is gone when the whole
 * tree is rebuilt (`npm ci` removes `node_modules` before it fills it
 * again), and the installation comes back with it: the files of the
 * gateway stay where they are.
 *
 * A directory without a `node_modules` above it — a tarball that was
 * unpacked by hand — is judged by its parent.
 */
export function installationTreeIsIntact(root: string): boolean {
  let dir = path.dirname(root);

  for (let depth = 0; depth < 5; depth += 1) {
    if (path.basename(dir) === 'node_modules') return fs.existsSync(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return fs.existsSync(path.dirname(root));
}

/**
 * Is the directory one that must not be removed?
 *
 * The home directory of the user, and every directory above it, hold
 * more than the gateway. A directory that holds the home directory
 * (`GATEWARDEN_HOME=~`) is one of them.
 */
export function isProtectedDirectory(dir: string): boolean {
  const home = path.resolve(os.homedir());
  const target = path.resolve(dir);
  if (target === home) return true;
  if (target === path.parse(target).root) return true;
  const relative = path.relative(target, home);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The files of an installation. */
export interface InstallationFiles {
  /** The configuration file. */
  configFile: string;
  /** The state directory: the route store and the pid file. */
  stateDir: string;
  /** The cache directory. */
  cacheDir: string;
  /** The log file. */
  logFile: string;
}

/** Remove a file, and do not mind when it is not there. */
function removeFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // ignore
  }
}

/**
 * Remove the files of an installation.
 *
 * The configuration file, the files of the gateway in the state directory
 * (the route store, the pid file, the log) and the cache. The state
 * directory itself goes when nothing is left in it; a directory that
 * holds something else stays, with the files of the gateway gone.
 */
export function removeInstallationFiles(files: InstallationFiles): void {
  removeFile(files.configFile);

  if (fs.existsSync(files.stateDir) && !isProtectedDirectory(files.stateDir)) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(files.stateDir);
    } catch {
      entries = [];
    }
    for (const entry of entries.filter(isOwnedStateFile)) {
      removeFile(path.join(files.stateDir, entry));
    }
  }

  // The cache belongs to the gateway, entirely.
  if (fs.existsSync(files.cacheDir) && !isProtectedDirectory(files.cacheDir)) {
    try {
      fs.rmSync(files.cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  // The log lives in the state directory, on every platform.
  removeFile(files.logFile);

  // The state directory goes when nothing is left in it.
  if (fs.existsSync(files.stateDir) && !isProtectedDirectory(files.stateDir)) {
    try {
      if (fs.readdirSync(files.stateDir).length === 0) fs.rmdirSync(files.stateDir);
    } catch {
      // ignore
    }
  }
}

/**
 * Is this process the daemon of this installation?
 *
 * The daemon is started through one of its launchers: `daemon.ts` (the
 * lazy start) and `gatewarden-daemon.js` (the name the package
 * installs). A process that is none of them is not the daemon.
 *
 * The name of the script is not enough: two installations that share a
 * state directory share their pid file, and the pid in it may belong to
 * the daemon of the *other* installation. The command line of the
 * process has to name the installation as well — the daemon is started
 * from the files of the installation, so its path is in the command line.
 *
 * On the systems whose processes cannot be read that way, the pid file
 * is the only source there is.
 */
export function isDaemonOfInstallation(pid: number, root: string): boolean {
  if (process.platform !== 'linux') return true;
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const parts = raw.split('\0').filter((part) => part.length > 0);
    const script = parts.find((part) => /\.(ts|js|mjs|cjs)$/.test(part));
    if (!script) return false;
    const name = path.basename(script);
    if (!/daemon|devd/.test(name) || /cli/.test(name)) return false;
    // The process has to run from this installation: the daemon is
    // started from the files of the installation, so its path is in the
    // command line.
    return parts.some((part) => isInsideDirectory(root, part));
  } catch (error) {
    // The process is gone, or its command line cannot be read: a process
    // that belongs to another user cannot be read. A process the machine
    // cannot tell us about is not one we may stop either.
    return (error as NodeJS.ErrnoException).code === 'EACCES';
  }
}

/** Is the file in the directory, or in it? */
export function isInsideDirectory(dir: string, file: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
