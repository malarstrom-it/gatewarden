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
import { fileURLToPath } from 'node:url';
import type { Config } from './types.ts';

const DAEMON_PATH = fileURLToPath(new URL('./daemon.ts', import.meta.url));

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
  return path.join(config.stateDir, 'daemon.log');
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
    // Stale pidfile: the process is gone.
    try {
      fs.rmSync(pidFile, { force: true });
    } catch {
      // ignore
    }
    pid = null;
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
  const out = fs.openSync(logFile, 'a');

  const child = spawn(process.execPath, [DAEMON_PATH], {
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      TRAEFIK_DEV_CONFIG: opts.configPath ?? process.env['TRAEFIK_DEV_CONFIG'] ?? path.join(config.stateDir, 'config.json'),
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
