/**
 * Client side of the daemon: health probe, pidfile and lazy start.
 *
 * `ensureDaemon()` is what makes the gateway survive a container restart:
 * the first `traefik-dev register` after a restart starts the daemon and waits
 * until it answers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
 * the core, and not inside it: it is the process that wires the adapters
 * (D3).
 */
const DAEMON_PATH = relativeModulePath(import.meta.url, '../daemon');

export interface DaemonStatus {
  pid: number | null;
  healthy: boolean;
  pidFile: string;
  error?: string;
}

/** Path of the pidfile. */
export function pidFilePath(config: Config): string {
  return path.join(config.stateDir, 'daemon.pid');
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

/** Current daemon status. */
export async function daemonStatus(config: Config): Promise<DaemonStatus> {
  const pidFile = pidFilePath(config);
  let pid: number | null = null;
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    pid = Number.parseInt(raw, 10);
    if (!Number.isFinite(pid)) pid = null;
  } catch {
    pid = null;
  }
  const healthy = await isHealthy(config);
  if (!healthy && pid !== null) {
    // The pidfile is stale when the process is gone. A daemon that is
    // still starting is not stale: it answers /healthz in a moment, and
    // its pidfile is its own.
    if (!isProcessAlive(pid)) {
      try {
        fs.rmSync(pidFile, { force: true });
      } catch {
        // ignore
      }
      pid = null;
    }
  }
  return { pid, healthy, pidFile };
}

/**
 * Make sure the daemon is running.
 *
 * Starts it detached when it is not, then waits for `/healthz`.
 */
export async function ensureDaemon(
  config: Config,
  opts: { timeoutMs?: number; configPath?: string } = {},
): Promise<{ started: boolean; pid: number | null; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 20_000;

  if (await isHealthy(config)) {
    const status = await daemonStatus(config);
    return { started: false, pid: status.pid };
  }

  fs.mkdirSync(config.stateDir, { recursive: true });
  const logFile = logFilePath(config);
  const out = openLogFile(logFile);

  const configPath = opts.configPath ?? resolveConfigPath();
  const child = spawn(process.execPath, [DAEMON_PATH, '--config', configPath], {
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      DEV_GATEWAY_CONFIG: configPath,
      DEV_GATEWAY_STATE_DIR: config.stateDir,
      // The old names are still read by the daemon, so they travel with it.
      TRAEFIK_DEV_CONFIG: configPath,
      TRAEFIK_DEV_STATE_DIR: config.stateDir,
    },
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
  }

  return { started: true, pid: null, error: `daemon did not answer /healthz within ${timeoutMs} ms (see ${logFile})` };
}

/** Is the process alive? */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Is this process the gateway daemon?
 *
 * The daemon is started through one of its launchers: `daemon.ts` (the
 * lazy start), `dev-gateway-daemon.js` and `traefik-devd.js` (the names
 * the package installs, the last one the old name of the second). All of
 * them are the daemon; a process that is none of them is not.
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
  } catch {
    return false;
  }
}

/**
 * Stop the daemon and wait for it to be gone.
 *
 * The daemon removes its own pidfile when it stops; the file is removed
 * here as well, for a daemon that did not get that far. A process that
 * is not the gateway's daemon is never stopped.
 */
export async function stopDaemon(
  config: Config,
  opts: { timeoutMs?: number } = {},
): Promise<{ stopped: boolean; wasRunning: boolean; pid: number | null; error?: string }> {
  const status = await daemonStatus(config);
  const pidFile = pidFilePath(config);

  if (status.pid === null) {
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
