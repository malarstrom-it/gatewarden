#!/usr/bin/env node
/**
 * Stop the daemon before the package goes.
 *
 * The daemon outlives the command that started it: it is spawned
 * detached and unreferenced. An installation that is removed without
 * stopping it leaves a process behind that listens on two ports and
 * serves a package that is not there any more.
 *
 * The script reads the pidfile of the installation, checks that the pid
 * in it belongs to the gateway's daemon — the CLI never stops a process
 * it does not own — and stops it: `SIGTERM` first, and `SIGKILL` when
 * the daemon is still there after ten seconds.
 *
 * The script never fails the uninstall: it always exits 0, and a daemon
 * that cannot be stopped does not stop the uninstall.
 *
 * npm 7 and later do not run the uninstall scripts of a package — npm's
 * own documentation says so — so the daemon watches its own installation
 * as well and stops itself when the package is gone (`src/core/daemon.ts`).
 * This script is what the package managers that do run the scripts use.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gatewayPaths, isCheckout, PACKAGE_ROOT } from './paths.mjs';

/** The uninstall must never fail because of this script. */
function stop() {
  process.exit(0);
}

// A checkout is not an installation: nothing is uninstalled from a clone,
// and nothing of the developer may be stopped.
if (isCheckout()) stop();

/** Is the process alive? */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process is not ours, but it is there.
    return (error).code === 'EPERM';
  }
}

/**
 * Is this process the daemon of *this* installation?
 *
 * The daemon is started through one of its launchers: `daemon.ts` (the
 * lazy start), `gatewarden-daemon.js` and `traefik-devd.js` (the names
 * the package installs, the last one the old name of the second). A
 * process that is none of them is not ours.
 *
 * The name of the script is not enough. Two installations that share a
 * state directory share their pid file, and the pid in it may belong to
 * the daemon of the *other* installation: the uninstall of one of them
 * must not stop the daemon of the other. The command line of the process
 * has to name this installation as well — the daemon is started from the
 * files of the installation, so its path is in the command line.
 *
 * On the systems whose processes cannot be read that way, the pid file
 * is the only source there is.
 */
function isDaemonOfInstallation(pid) {
  if (process.platform !== 'linux') return true;
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const parts = raw.split('\0').filter((part) => part.length > 0);
    const script = parts.find((part) => /\.(ts|js|mjs|cjs)$/.test(part));
    if (!script) return false;
    const name = path.basename(script);
    if (!/daemon|devd/.test(name) || /cli/.test(name)) return false;
    return parts.some((part) => isInsideDirectory(PACKAGE_ROOT, part));
  } catch (error) {
    // The process is gone, or its command line cannot be read: a process
    // that belongs to another user cannot be read. A process the machine
    // cannot tell us about is not one we may stop either.
    return (error).code === 'EACCES';
  }
}

/** Is the file in the directory, or in it? */
function isInsideDirectory(dir, file) {
  const relative = path.relative(path.resolve(dir), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** The pid in the pidfile, when the file holds one. */
function readPidFile(pidFile) {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Wait until the process is gone, or the deadline says that it is not. */
async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAlive(pid);
}

try {
  const paths = await gatewayPaths();
  const pidFile = path.join(paths.stateDir, 'daemon.pid');
  const pid = readPidFile(pidFile);

  if (pid !== null && isAlive(pid) && isDaemonOfInstallation(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The process is gone between the check and the signal.
    }

    if (!(await waitForExit(pid, 10_000))) {
      // The daemon did not let go of the port in time.
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore
      }
      await waitForExit(pid, 2_000);
    }
  }

  // The pidfile goes with the daemon: a pidfile that points at a process
  // that is gone is stale, and the daemon removes it when it stops.
  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    // ignore
  }
} catch {
  // Never fail the uninstall.
}

process.exit(0);
