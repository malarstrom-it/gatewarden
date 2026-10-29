/**
 * Who listens on which port (the isolation proof, D11, §11).
 *
 * The acceptance criterion of S9 says that the user's live gateway and
 * the user's live proxy are untouched, "proven by asserting that their
 * ports are not bound by the test". This module is that assertion: it
 * reads the listening sockets of the machine out of `/proc`, and it says
 * which process holds a port.
 *
 * `/proc` is used instead of `ss` or `netstat`: the two are not always
 * installed, and the test has to run on a machine that has nothing but
 * Node.
 */

import fs from 'node:fs';

/** One listening socket. */
export interface Listener {
  /** The port the socket listens on. */
  port: number;
  /** The processes that hold the socket. */
  pids: number[];
}

/** The inode of the listening sockets of a port. */
function inodesOf(port: number): Set<string> {
  const inodes = new Set<string>();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      // 0A is LISTEN.
      if (parts[3] !== '0A') continue;
      const local = parts[1] ?? '';
      const at = local.lastIndexOf(':');
      if (at < 0) continue;
      if (Number.parseInt(local.slice(at + 1), 16) !== port) continue;
      inodes.add(parts[9] ?? '');
    }
  }
  return inodes;
}

/** The processes that hold a set of socket inodes. */
function pidsOf(inodes: Set<string>): number[] {
  const pids: number[] = [];
  if (inodes.size === 0) return pids;
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return pids;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link: string;
      try {
        link = fs.readlinkSync(`/proc/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(link);
      if (match && inodes.has(match[1] ?? '')) {
        pids.push(Number.parseInt(entry, 10));
        break;
      }
    }
  }
  return pids;
}

/**
 * The listeners of a port.
 *
 * An empty list means that nothing listens on the port.
 */
export function listenersOf(port: number): Listener[] {
  const inodes = inodesOf(port);
  if (inodes.size === 0) return [];
  return [{ port, pids: pidsOf(inodes) }];
}

/** The pids that listen on a port. */
export function pidsOnPort(port: number): number[] {
  return listenersOf(port).flatMap((listener) => listener.pids);
}

/** Is nothing listening on the port? */
export function portIsFree(port: number): boolean {
  return pidsOnPort(port).length === 0;
}

/**
 * A snapshot of the listeners of a set of ports.
 *
 * The test takes one before the environment comes up and one after it
 * goes down, and compares the two: the live ports must hold the same
 * processes before and after.
 */
export interface ListenerSnapshot {
  /** The port and the processes that hold it. */
  [port: string]: number[];
}

/** Take a snapshot of the listeners of the given ports. */
export function snapshotOf(ports: number[]): ListenerSnapshot {
  const snapshot: ListenerSnapshot = {};
  for (const port of ports) snapshot[String(port)] = pidsOnPort(port);
  return snapshot;
}

/** Are two snapshots of the same ports the same? */
export function snapshotsAreEqual(a: ListenerSnapshot, b: ListenerSnapshot): boolean {
  const ports = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const port of ports) {
    const first = [...(a[port] ?? [])].sort((x, y) => x - y);
    const second = [...(b[port] ?? [])].sort((x, y) => x - y);
    if (first.length !== second.length) return false;
    if (first.some((pid, index) => pid !== second[index])) return false;
  }
  return true;
}

/** Describe a snapshot, for the report of the test. */
export function describeSnapshot(snapshot: ListenerSnapshot): string {
  return Object.entries(snapshot)
    .map(([port, pids]) => `${port}: ${pids.length > 0 ? pids.join(', ') : 'nothing'}`)
    .join('; ');
}
