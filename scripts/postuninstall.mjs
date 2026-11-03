#!/usr/bin/env node
/**
 * Remove what the installation left behind.
 *
 * The uninstall removes the files of the gateway: the configuration file,
 * the state directory (the route store, the pidfile) and the cache. The
 * directories are the ones of the installation, and they are found the
 * same way the rest of the package finds them:
 * `GATEWARDEN_HOME` puts everything in one directory, `GATEWARDEN_CONFIG`
 * and `GATEWARDEN_STATE_DIR` name one each, and the names the variables
 * had before the rename still work.
 *
 * The script never fails the uninstall: it always exits 0.
 *
 * npm 7 and later do not run the uninstall scripts of a package — npm's
 * own documentation says so — so under npm the files of an installation
 * that is removed stay where they are until the consumer removes them.
 * The daemon stops itself when the package is gone; this script is what
 * the package managers that do run the scripts use.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gatewayPaths, isCheckout } from './paths.mjs';

/** The uninstall must never fail because of this script. */
function stop() {
  process.exit(0);
}

// A checkout is not an installation: nothing is uninstalled from a clone,
// and nothing of the developer may be removed.
if (isCheckout()) stop();

/**
 * The files the gateway owns in its state directory.
 *
 * Everything else in the directory belongs to somebody else and is left
 * in place.
 */
const OWNED_FILES = new Set([
  'routes.json',
  'routes.json.lock',
  'registrations.json',
  'daemon.pid',
  'daemon.log',
  'daemon.error',
]);

/** Is the file one of the gateway's own? */
function isOwned(name) {
  return OWNED_FILES.has(name) || /^daemon\.log\.\d+$/.test(name);
}

/**
 * Is the directory one that must not be removed?
 *
 * The home directory of the user, and every directory above it, hold
 * more than the gateway. A directory that holds the home directory
 * (`GATEWARDEN_HOME=~`) is one of them.
 */
function isProtected(dir) {
  const home = path.resolve(os.homedir());
  const target = path.resolve(dir);
  if (target === home) return true;
  if (target === path.parse(target).root) return true;
  const relative = path.relative(target, home);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Remove a file, and do not mind when it is not there. */
function removeFile(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // ignore
  }
}

/**
 * Remove the files of the gateway in the state directory.
 *
 * The directory itself belongs to the gateway, but a directory that
 * holds something else is left in place: only the files of the gateway
 * go. The directory goes when nothing is left in it.
 */
function removeStateFiles(stateDir) {
  if (!fs.existsSync(stateDir)) return;
  if (isProtected(stateDir)) return;

  let entries;
  try {
    entries = fs.readdirSync(stateDir);
  } catch {
    return;
  }

  for (const entry of entries.filter(isOwned)) {
    removeFile(path.join(stateDir, entry));
  }
}

/** Remove the state directory when nothing is left in it. */
function removeEmptyStateDir(stateDir) {
  if (!fs.existsSync(stateDir)) return;
  if (isProtected(stateDir)) return;
  try {
    if (fs.readdirSync(stateDir).length === 0) fs.rmdirSync(stateDir);
  } catch {
    // ignore
  }
}

/** Remove the cache directory: it belongs to the gateway, entirely. */
function removeCacheDir(cacheDir) {
  if (!fs.existsSync(cacheDir)) return;
  if (isProtected(cacheDir)) return;
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

try {
  const paths = await gatewayPaths();

  removeFile(paths.configFile);
  removeStateFiles(paths.stateDir);
  removeCacheDir(paths.cacheDir);
  // The log lives in the state directory on Linux, and in the log
  // directory of the platform on macOS and Windows.
  removeFile(paths.logFile);
  removeEmptyStateDir(paths.stateDir);
} catch {
  // Never fail the uninstall.
}

process.exit(0);
