/**
 * The daemons of the test suite, and the cleanup that stops them.
 *
 * A test that starts a daemon starts a process that outlives the test
 * unless somebody stops it. The daemon of the gateway is detached: it
 * keeps its ports, and it keeps running on the machine after the test
 * that started it is over. A suite that leaves a daemon behind leaves a
 * process behind, and that process holds the ports of the gateway.
 *
 * The suite therefore knows its own daemons, and stops them when the
 * test file is over (see `test/helpers/suite.ts`).
 *
 * ## How a daemon of the suite is found
 *
 * The daemon is a process of its own, and the only thing it carries of
 * the suite is its environment: the variable `GATEWARDEN_TEST_SUITE`
 * says which suite the process belongs to. Every process the suite
 * starts carries it, and the cleanup stops the processes that carry it.
 *
 * The pidfile is not the way to find a daemon. A daemon that is started
 * by hand resolves its state directory the way the package does, and
 * the name `GATEWARDEN_HOME` wins over every other name: the pidfile
 * of such a daemon lies in the directory the name points at, and not in
 * the directory the test knows. The cleanup therefore finds the
 * *process*, and not the file. The pidfiles are read as well, so that a
 * daemon that is not running any more leaves no file behind, and so
 * that a daemon whose pidfile lies elsewhere is found anyway.
 *
 * ## What the cleanup does not touch
 *
 * The gateway that runs on the machine is not a daemon of the suite: it
 * has no marker, and no directory of the suite names it. The cleanup
 * does not see it, and it does not stop it. The same holds for the
 * daemons of another suite that runs on the same machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isProcessAlive } from '../../src/core/daemonControl.ts';

/** The root of the checkout: the marker of this suite. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The variable that says which suite a process belongs to. */
export const SUITE_VARIABLE = 'GATEWARDEN_TEST_SUITE';

/**
 * The scripts a process of the gateway runs.
 *
 * The daemon is `daemon.ts` in a checkout and `gatewarden-daemon.js` in
 * an installation; the worker is `worker.ts`. The name of the script is
 * the whole of the test: a directory says nothing about what a process
 * does, and a test file that is named after a daemon (`daemon.test.ts`)
 * is not a daemon.
 */
const GATEWAY_SCRIPTS = new Set(['daemon', 'gatewarden-daemon', 'traefik-devd', 'worker']);

/** The marker of this suite: the root of the checkout. */
export function suiteMarker(): string {
  return REPO_ROOT;
}

/** The directories of the suite: the installations the tests have made. */
const directories = new Set<string>();

/**
 * Remember a directory of the suite.
 *
 * The daemons of the suite run in these directories, and the pidfiles
 * of the suite lie in them. A daemon whose command line names one of
 * them is a daemon of the suite, also on the platforms that cannot be
 * asked for the environment of a process.
 *
 * @param directory The directory to remember.
 */
export function registerSuiteDirectory(directory: string): void {
  if (directory.length > 0) directories.add(path.resolve(directory));
}

/** The directories the suite has used. */
export function suiteDirectories(): string[] {
  return [...directories];
}

/**
 * The environment of a process of the suite.
 *
 * The marker is in it, so that the cleanup finds the process whatever
 * it does and wherever it writes its files.
 *
 * @param env The environment to add the marker to.
 * @returns The environment with the marker in it.
 */
export function suiteEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...env, [SUITE_VARIABLE]: suiteMarker() };
}

/** A process of the machine, with what it says about itself. */
export interface MachineProcess {
  /** The number of the process. */
  pid: number;
  /** The command line of the process. */
  cmdline: string;
  /** The environment of the process, when the machine can be asked for it. */
  environ: string | null;
}

/**
 * Every process of the machine.
 *
 * Linux is asked through `/proc`, the other platforms through `ps`.
 * The environment of a process is only read where the machine gives it:
 * on the other platforms the cleanup finds the daemons of the suite by
 * the directories of the suite instead.
 *
 * @returns The processes of the machine.
 */
export function machineProcesses(): MachineProcess[] {
  return process.platform === 'linux' ? linuxProcesses() : psProcesses();
}

/** Read a file of `/proc`, or nothing when it cannot be read. */
function readProc(pid: number, name: string): string | null {
  try {
    return fs.readFileSync(`/proc/${pid}/${name}`, 'utf8');
  } catch {
    // The process is gone, or it belongs to another user.
    return null;
  }
}

/** The processes of the machine, read out of `/proc`. */
function linuxProcesses(): MachineProcess[] {
  const found: MachineProcess[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    // A machine without `/proc` has no processes to find.
    return found;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    const cmdline = readProc(pid, 'cmdline');
    if (cmdline === null) continue;
    found.push({ pid, cmdline: cmdline.replace(/\0/g, ' '), environ: readProc(pid, 'environ') });
  }
  return found;
}

/** The processes of the machine, read out of `ps`. */
function psProcesses(): MachineProcess[] {
  let output = '';
  try {
    output = execFileSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const found: MachineProcess[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid) continue;
    found.push({ pid, cmdline: match[2] ?? '', environ: null });
  }
  return found;
}

/**
 * Is the process a process of the gateway: a daemon or a worker?
 *
 * The name of the script says it: the daemon and the worker of the
 * gateway, and nothing else.
 *
 * @param cmdline The command line of the process.
 * @returns Whether the process runs a script of the gateway.
 */
export function isGatewayProcess(cmdline: string): boolean {
  for (const part of cmdline.split(' ')) {
    if (!/\.(ts|js|mjs|cjs)$/.test(part)) continue;
    const name = part.replace(/\.(ts|js|mjs|cjs)$/, '');
    if (GATEWAY_SCRIPTS.has(path.basename(name))) return true;
  }
  return false;
}

/**
 * Does the process belong to the suite?
 *
 * Two answers say yes: the marker in the environment of the process,
 * and a directory of the suite in its command line. The marker is the
 * answer that holds everywhere; the directory is the answer for the
 * platforms that cannot be asked for the environment of a process.
 *
 * @param candidate The process to judge.
 * @returns Whether the process is a process of the suite.
 */
export function belongsToSuite(candidate: MachineProcess): boolean {
  if (candidate.environ?.includes(`${SUITE_VARIABLE}=${suiteMarker()}`)) return true;
  return suiteDirectories().some((directory) => candidate.cmdline.includes(directory));
}

/**
 * The daemons of the suite that run right now.
 *
 * @returns The processes of the suite that run a script of the gateway.
 */
export function daemonsOfTheSuite(): MachineProcess[] {
  return machineProcesses().filter((candidate) => isGatewayProcess(candidate.cmdline) && belongsToSuite(candidate));
}

/**
 * The directories a pidfile of the suite can lie in.
 *
 * The directories of the suite are the ones the tests made. The name of
 * the home installation of the machine is one more: a daemon that was
 * started by hand with the name in its environment writes its pidfile
 * there, and not in the directory of the test.
 */
function pidFileDirectories(): string[] {
  const found = new Set(directories);
  for (const name of ['GATEWARDEN_HOME', 'DEV_GATEWAY_HOME']) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) found.add(path.resolve(value));
  }
  return [...found];
}

/**
 * The pids the pidfiles of the suite name.
 *
 * @returns The pids of the pidfiles of the suite.
 */
export function pidFilesOfTheSuite(): number[] {
  const pids: number[] = [];
  for (const directory of pidFileDirectories()) {
    try {
      const pid = Number.parseInt(fs.readFileSync(path.join(directory, 'daemon.pid'), 'utf8').trim(), 10);
      if (Number.isFinite(pid) && pid > 0) pids.push(pid);
    } catch {
      // No pidfile there: nothing to stop.
    }
  }
  return pids;
}

/** What the cleanup did. */
export interface CleanupResult {
  /** The pids the cleanup stopped. */
  stopped: number[];
  /** The pids that are still running. */
  remaining: number[];
}

/** Wait a little. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send a signal to a process, and say nothing when it is gone. */
function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // The process is gone, or it belongs to another user.
  }
}

/**
 * Wait until the processes are gone.
 *
 * @param pids The pids to wait for.
 * @param timeoutMs How long to wait.
 * @returns The pids that are still running.
 */
async function waitUntilGone(pids: number[], timeoutMs: number): Promise<number[]> {
  const remaining = new Set(pids);
  const deadline = Date.now() + timeoutMs;
  while (remaining.size > 0 && Date.now() < deadline) {
    for (const pid of [...remaining]) {
      if (!isProcessAlive(pid)) remaining.delete(pid);
    }
    if (remaining.size === 0) break;
    await sleep(50);
  }
  return [...remaining];
}

/**
 * Stop every daemon of the suite, and wait until they are gone.
 *
 * The daemons are stopped first: a daemon that stops takes its workers
 * with it. What is left after the polite signal gets the hard one.
 *
 * The daemons of the machine are not touched: a process that does not
 * belong to the suite is never stopped, not even when a pidfile of the
 * suite names it.
 *
 * @param options How long to wait for a daemon to stop.
 * @returns The pids that were stopped, and the pids that are still running.
 */
export async function stopDaemonsOfTheSuite(
  options: { timeoutMs?: number } = {},
): Promise<CleanupResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const processes = machineProcesses();
  const byPid = new Map(processes.map((candidate) => [candidate.pid, candidate]));

  // The processes of the suite that run a script of the gateway.
  const candidates = new Set<number>();
  for (const candidate of processes) {
    if (isGatewayProcess(candidate.cmdline) && belongsToSuite(candidate)) candidates.add(candidate.pid);
  }
  // The pids the pidfiles of the suite name. A pidfile that lies in the
  // directory `GATEWARDEN_HOME` names is read as well: the daemon that
  // wrote it is a daemon of the suite, and the file is the only place
  // it says so.
  for (const pid of pidFilesOfTheSuite()) {
    const candidate = byPid.get(pid);
    if (candidate && isGatewayProcess(candidate.cmdline) && belongsToSuite(candidate)) candidates.add(pid);
  }

  const stopped: number[] = [];
  const pids = [...candidates];
  for (const pid of pids) signal(pid, 'SIGTERM');
  const polite = await waitUntilGone(pids, timeoutMs);
  stopped.push(...pids.filter((pid) => !polite.includes(pid)));
  // What did not stop on the polite signal gets the hard one.
  for (const pid of polite) signal(pid, 'SIGKILL');
  const remaining = await waitUntilGone(polite, 2000);
  stopped.push(...polite.filter((pid) => !remaining.includes(pid)));
  return { stopped, remaining };
}
