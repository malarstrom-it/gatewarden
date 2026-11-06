/**
 * The leftovers of an interrupted run (D11, §11).
 *
 * A run that is killed — with SIGKILL, or with the power of the
 * machine — cannot clean up after itself. The proxy and the daemon are
 * then still running, and they hold the ports of the environment: the
 * next run cannot come up.
 *
 * This module finds those leftovers and stops them. It only ever stops
 * a process that is provably one of ours: the Traefik binary we
 * downloaded, or the daemon that runs with our configuration file. A
 * process that holds one of our ports and is not one of those is
 * reported and left alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pidsOnPort } from './ports.ts';
import { binaryPath } from './traefik.ts';
import type { TestEnvSettings } from './settings.ts';

/** What a leftover is. */
export type LeftoverKind = 'proxy' | 'daemon' | 'unknown';

export interface Leftover {
  /** The process. */
  pid: number;
  /** What it is. */
  kind: LeftoverKind;
  /** The port it holds. */
  port: number;
  /** The command line of the process. */
  cmdline: string;
}

/** The command line of a process. */
export function cmdlineOf(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

/**
 * What a command line is.
 *
 * The proxy is the binary we downloaded, and the daemon is the daemon
 * of this repository running with our configuration file.
 */
export function classifyCmdline(cmdline: string, settings: TestEnvSettings): LeftoverKind {
  if (cmdline.length === 0) return 'unknown';
  if (cmdline.includes(binaryPath(settings.cacheDir, settings.traefikVersion))) return 'proxy';
  if (cmdline.includes(settings.root)) return 'daemon';
  return 'unknown';
}

/**
 * The leftovers of an earlier run.
 *
 * The processes that hold one of the ports of the environment are found
 * first: the proxy and the workers of the daemon. The supervisor of the
 * daemon holds no port, but it respawns its workers, so it is found
 * through the pidfile the daemon writes.
 */
export function findLeftovers(settings: TestEnvSettings): Leftover[] {
  const ports = [settings.registryPort, settings.relayPort, settings.proxyPort, settings.proxyApiPort];
  const found = new Map<number, Leftover>();
  for (const port of ports) {
    for (const pid of pidsOnPort(port)) {
      if (found.has(pid)) continue;
      const cmdline = cmdlineOf(pid);
      found.set(pid, { pid, kind: classifyCmdline(cmdline, settings), port, cmdline });
    }
  }

  // The supervisor of the daemon: it holds no port, and it is the one
  // that respawns the workers.
  const pidFile = path.join(settings.root, 'daemon.pid');
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && !found.has(pid)) {
      const cmdline = cmdlineOf(pid);
      found.set(pid, { pid, kind: classifyCmdline(cmdline, settings), port: -1, cmdline });
    }
  } catch {
    // there is no pidfile
  }
  return [...found.values()];
}

/** Is the process still alive? */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Stop the leftovers of an earlier run.
 *
 * Only the proxy and the daemon are stopped. A process that is not one
 * of ours is reported and left running: the ports of the environment
 * are then in use by somebody else, and that is not ours to decide.
 */
export async function stopLeftovers(
  settings: TestEnvSettings,
  log: (line: string) => void = () => {},
): Promise<Leftover[]> {
  const leftovers = findLeftovers(settings);
  // The supervisor of the daemon goes first: it stops its own workers
  // when it gets the signal, and it respawns them when they die
  // without it.
  const ordered = [...leftovers].sort((a, b) => Number(b.port === -1) - Number(a.port === -1));
  for (const leftover of ordered) {
    if (leftover.kind === 'unknown') {
      log(`port ${leftover.port} is held by pid ${leftover.pid}, which is not one of ours: ${leftover.cmdline}`);
      continue;
    }
    log(`stopping the leftover ${leftover.kind} of an earlier run (pid ${leftover.pid})`);
    try {
      process.kill(leftover.pid, 'SIGTERM');
    } catch {
      // it is already gone
    }
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (ordered.every((leftover) => leftover.kind === 'unknown' || !isAlive(leftover.pid))) return leftovers;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const leftover of ordered) {
    if (leftover.kind === 'unknown' || !isAlive(leftover.pid)) continue;
    try {
      process.kill(leftover.pid, 'SIGKILL');
    } catch {
      // it is already gone
    }
  }
  return leftovers;
}
