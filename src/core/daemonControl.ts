/**
 * Client side of the daemon: health probe, pidfile and lazy start.
 *
 * `ensureDaemon()` is what makes the gateway survive a container restart:
 * the first `gatewarden register` after a restart starts the daemon and waits
 * until it answers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import type { Config } from './types.ts';
import { resolveConfigPath } from './config.ts';
import { logFileFor } from './paths.ts';
import { relativeModulePath } from './util/module.ts';

/**
 * The daemon, next to the core.
 *
 * The path is a runtime string, so the compiler does not rewrite it: it is
 * resolved against the module that asks for it, with the extension that
 * matches the world the code runs in (`.ts` in a checkout, `.js` in the
 * compiled package). The daemon's entry point sits one level up, next to
 * the core, and not inside it: it is the process that wires the adapters.
 */
const DAEMON_PATH = relativeModulePath(import.meta.url, '../daemon');

export interface DaemonStatus {
  /**
   * The pid of the daemon, when its pidfile points at a process that runs.
   *
   * A pidfile that points at a process that has terminated is stale: the
   * file is removed and the pid is null.
   */
  pid: number | null;
  /**
   * Does the daemon run?
   *
   * The pidfile points at a process that runs. The daemon writes the
   * pidfile when it starts and removes it when it stops, so this is the
   * answer to "does the daemon run".
   */
  running: boolean;
  /**
   * Does the daemon serve?
   *
   * The health probe answers. The daemon writes its pidfile before it
   * binds its port, so a daemon that runs but does not serve yet runs:
   * the health probe alone would say that it does not.
   */
  healthy: boolean;
  /** Path of the pidfile. */
  pidFile: string;
  error?: string;
}

/** Path of the pidfile. */
export function pidFilePath(config: Config): string {
  return path.join(config.stateDir, 'daemon.pid');
}

/**
 * Path of the file that holds the reason the daemon stopped.
 *
 * The daemon writes it when it stops for a reason of its own — a proxy
 * id the catalog does not know — and removes it when it starts. A
 * command that waits for the daemon reads it, and can say what
 * happened instead of reporting a timeout.
 */
export function daemonReasonPath(config: Config): string {
  return path.join(config.stateDir, 'daemon.error');
}

/** The reason the daemon stopped, when it left one behind. */
export function readDaemonReason(config: Config): string | null {
  try {
    const reason = fs.readFileSync(daemonReasonPath(config), 'utf8').trim();
    return reason.length > 0 ? reason : null;
  } catch {
    return null;
  }
}

/**
 * Write down the reason the daemon stopped.
 *
 * The reason is a nicety: the log holds it too. A state directory that
 * cannot be written to must not keep the daemon from stopping.
 */
export function writeDaemonReason(config: Config, reason: string): void {
  try {
    fs.mkdirSync(config.stateDir, { recursive: true });
    fs.writeFileSync(daemonReasonPath(config), `${reason}\n`);
  } catch {
    // ignore
  }
}

/** Forget the reason of an earlier life of the daemon. */
export function clearDaemonReason(config: Config): void {
  try {
    fs.rmSync(daemonReasonPath(config), { force: true });
  } catch {
    // ignore
  }
}

/** Path of the log file. */
export function logFilePath(config: Config): string {
  return logFileFor(config.stateDir);
}

/**
 * Make sure the directory of the log file exists.
 *
 * The log does not always live in the state directory: on macOS and
 * Windows it lives in the log directory of the platform, and that
 * directory does not exist yet on a fresh installation.
 */
export function ensureLogDirectory(logFile: string): string {
  const dir = path.dirname(logFile);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Open the log file for appending, creating the directory it lives in. */
export function openLogFile(logFile: string): number {
  ensureLogDirectory(logFile);
  return fs.openSync(logFile, 'a');
}

/** Probe the registry health endpoint. */
export async function isHealthy(config: Config, timeoutMs = 1000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.registryPort}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok && (await response.text()).trim() === 'ok';
  } catch {
    return false;
  }
}

/**
 * The state of the daemon.
 *
 * Two questions, two answers. The pidfile says whether the daemon runs:
 * the daemon writes it when it starts and removes it when it stops. The
 * health probe says whether it serves.
 *
 * The two are not the same, and the difference matters: the daemon
 * writes its pidfile before it binds its port, so a daemon that has
 * just started runs but does not serve yet. A command that stops the
 * daemon must not answer "there was nothing to stop" for such a
 * daemon.
 */
export async function daemonStatus(config: Config): Promise<DaemonStatus> {
  const pidFile = pidFilePath(config);
  const pid = readPidFile(pidFile);
  // The pidfile points at a process that runs *and* that is the gateway's
  // daemon. A pidfile that points at some other live process is stale:
  // the daemon that wrote it is gone, and the machine has handed its pid
  // to somebody else. Such a pidfile must not lock the installation
  // out: the daemon has to be able to start again.
  const running = pid !== null && isProcessAlive(pid) && isGatewayDaemon(pid);
  const healthy = await isHealthy(config);

  if (pid !== null && !running) {
    // The pidfile points at a process that is gone, or at one that is
    // not ours: it is stale.
    try {
      fs.rmSync(pidFile, { force: true });
    } catch {
      // ignore
    }
  }

  return { pid: running ? pid : null, running, healthy, pidFile };
}

/** The pid in the pidfile, when the file holds one. */
function readPidFile(pidFile: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * The names that put everything of an installation in one directory.
 *
 * They are the two names of the same thing: `DEV_GATEWAY_HOME` is the
 * name `GATEWARDEN_HOME` had before the rename.
 */
const HOME_VARIABLES = ['GATEWARDEN_HOME', 'DEV_GATEWAY_HOME'] as const;

/**
 * The environment the daemon is started with.
 *
 * The daemon must run with the configuration it was given, and not with
 * the configuration of another installation. `GATEWARDEN_HOME` says
 * that everything — the configuration, the state, the log and the cache
 * — lives in one directory, and it wins over every other name. So it is
 * taken away from the environment the child inherits: the daemon that
 * is started with `--config` and with `GATEWARDEN_CONFIG` reads that
 * configuration, and not the one of the installation the name points
 * at.
 *
 * The other names are left as they are. The configuration file and the
 * state directory travel with the child, under both their current and
 * their old names.
 */
export function daemonEnv(
  config: Config,
  configPath: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of HOME_VARIABLES) {
    delete env[name];
  }
  return {
    ...env,
    GATEWARDEN_CONFIG: configPath,
    GATEWARDEN_STATE_DIR: config.stateDir,
    // The old names are still read by the daemon, so they travel with it.
    TRAEFIK_DEV_CONFIG: configPath,
    TRAEFIK_DEV_STATE_DIR: config.stateDir,
  };
}

/**
 * Make sure the daemon is running.
 *
 * Starts it detached when it is not, then waits for `/healthz`.
 *
 * A daemon that stops with a reason of its own — a proxy id the catalog
 * does not know, for instance — is reported with that reason, and not
 * with a timeout: the reason is what the reader needs.
 */
export async function ensureDaemon(
  config: Config,
  opts: { timeoutMs?: number; configPath?: string } = {},
): Promise<{ started: boolean; pid: number | null; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const status = await daemonStatus(config);
  if (status.healthy) {
    return { started: false, pid: status.pid };
  }

  if (status.running) {
    // The daemon runs but does not serve yet: it writes its pidfile
    // before it binds its port. A second daemon would fight for the same
    // port, so the one that runs is given the time to answer.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (await isHealthy(config)) {
        return { started: false, pid: status.pid };
      }
      // The daemon may have stopped with a reason of its own.
      const reason = readDaemonReason(config);
      if (reason) {
        return { started: false, pid: null, error: reason };
      }
    }
    return {
      started: false,
      pid: status.pid,
      error: `the daemon (pid ${status.pid}) did not answer /healthz within ${timeoutMs} ms`,
    };
  }

  fs.mkdirSync(config.stateDir, { recursive: true });
  // The reason of an earlier life of the daemon is not the reason of
  // this one.
  clearDaemonReason(config);
  const logFile = logFilePath(config);
  const out = openLogFile(logFile);

  const configPath = opts.configPath ?? resolveConfigPath();
  const child = spawn(process.execPath, [DAEMON_PATH, '--config', configPath], {
    detached: true,
    stdio: ['ignore', out, out],
    env: daemonEnv(config, configPath),
  });
  child.unref();
  fs.closeSync(out);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await isHealthy(config)) {
      const status = await daemonStatus(config);
      return { started: true, pid: status.pid };
    }
    // The daemon may have stopped with a reason of its own: a proxy id
    // the catalog does not know, for instance. The reason is said, and
    // not a timeout.
    const reason = readDaemonReason(config);
    if (reason) {
      return { started: true, pid: null, error: reason };
    }
  }

  return { started: true, pid: null, error: `daemon did not answer /healthz within ${timeoutMs} ms (see ${logFile})` };
}

/**
 * Is the process alive?
 *
 * A process that has terminated but has not been reaped yet — a zombie —
 * is not alive: it runs nothing and holds nothing but its place in the
 * process table. `kill(pid, 0)` cannot tell the two apart, so the state
 * of the process is read from the system.
 *
 * It matters where the init does not reap. In a container whose PID 1 is
 * not an init, every orphaned process stays behind as a zombie: the
 * daemon of the gateway is orphaned when the command that started it
 * exits, and the gateway would go on believing that its daemon runs.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // The process is not ours, but it is there.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  return processState(pid) !== 'Z';
}

/**
 * The state of a process: `R`, `S`, `Z` and so on.
 *
 * Linux keeps it in `/proc/<pid>/stat`; the other systems ask `ps`. The
 * state is null when it cannot be read.
 */
export function processState(pid: number): string | null {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      // The name of the executable sits in parentheses and may contain
      // spaces, so the state is the field after the last one of them.
      const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      return fields[0] ?? null;
    } catch {
      return null;
    }
  }
  // Windows has no zombies: a process that has terminated is gone.
  if (process.platform === 'win32') return null;
  try {
    const state = execFileSync('ps', ['-o', 'state=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return state.trim().charAt(0) || null;
  } catch {
    return null;
  }
}

/**
 * Is this process the gateway daemon?
 *
 * The daemon is started through one of its launchers: `daemon.ts` (the
 * lazy start) and `gatewarden-daemon.js` (the name the package
 * installs). Both of them are the daemon; a process that is none of
 * them is not.
 *
 * The pidfile is a file in the state directory: something else may have
 * written it, and the CLI must never stop a process it does not own. On
 * Linux the command line of the process says what it is; on the other
 * platforms the pidfile is the only source there is.
 */
export function isGatewayDaemon(pid: number): boolean {
  if (process.platform !== 'linux') return true;
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const parts = raw.split('\0').filter((part) => part.length > 0);
    // The script is the first argument that names a file.
    const script = parts.find((part) => /\.(ts|js|mjs|cjs)$/.test(part));
    if (!script) return false;
    // Only the name of the script counts: the directories it lives in say
    // nothing about what the process does.
    const name = path.basename(script);
    return /daemon|devd/.test(name) && !/cli/.test(name);
  } catch (error) {
    // The process is gone, or its command line cannot be read: a process
    // that belongs to another user cannot be read. A process the machine
    // cannot tell us about is not one we may stop either, so it is
    // treated as ours: the pidfile of it is left alone.
    return (error as NodeJS.ErrnoException).code === 'EACCES';
  }
}

/**
 * Stop the daemon and wait for it to be gone.
 *
 * The daemon removes its own pidfile when it stops; the file is removed
 * here as well, for a daemon that did not get that far. A process that
 * is not the gateway's daemon is never stopped.
 *
 * "Was running" is answered from the pidfile and the liveness of the
 * process, not from the health probe: a daemon that has just started
 * writes its pidfile before it binds its port, and it is running even
 * though it does not serve yet.
 */
export async function stopDaemon(
  config: Config,
  opts: { timeoutMs?: number } = {},
): Promise<{ stopped: boolean; wasRunning: boolean; pid: number | null; error?: string }> {
  const status = await daemonStatus(config);
  const pidFile = pidFilePath(config);

  if (status.pid === null) {
    // Nothing runs: there is no pidfile, or it points at a process that
    // has terminated.
    return { stopped: false, wasRunning: false, pid: null };
  }

  if (!isGatewayDaemon(status.pid)) {
    return {
      stopped: false,
      wasRunning: true,
      pid: status.pid,
      error: `the pid ${status.pid} in ${pidFile} does not belong to the gateway daemon; nothing was stopped`,
    };
  }

  try {
    process.kill(status.pid, 'SIGTERM');
  } catch (error) {
    return {
      stopped: false,
      wasRunning: true,
      pid: status.pid,
      error: `could not stop the daemon: ${(error as Error).message}`,
    };
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  while (Date.now() < deadline && isProcessAlive(status.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // The daemon has stopped when its process is gone. A process that has
  // terminated but has not been reaped yet has stopped as well: it only
  // waits for its parent to collect it.
  const stopped = !isProcessAlive(status.pid);
  if (stopped) {
    try {
      fs.rmSync(pidFile, { force: true });
    } catch {
      // ignore
    }
  }
  return {
    stopped,
    wasRunning: true,
    pid: status.pid,
    error: stopped ? undefined : 'the daemon did not stop',
  };
}
