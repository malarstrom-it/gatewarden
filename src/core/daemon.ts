/**
 * The daemon: the supervisor of the gateway.
 *
 * One supervisor process with two supervised workers:
 *
 *   - registry worker: serves the dynamic configuration and the index
 *   - relay worker:   dispatches to the dev servers
 *
 * A worker that dies is respawned; the other listener keeps serving.
 *
 * The supervisor itself knows nothing about proxies: the workers pick the
 * adapter they render with (D3).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { loadConfig, configPathFromArgv, resolveConfigPath } from './config.ts';
import { logFileFor } from './paths.ts';
import { ensureLogDirectory } from './daemonControl.ts';
import { log, setLogLevel } from './log.ts';
import { relativeModulePath } from './util/module.ts';

const SCOPE = 'daemon';
/**
 * The worker, next to the core.
 *
 * The path is a runtime string, so the compiler does not rewrite it: it is
 * resolved against the module that asks for it, with the extension that
 * matches the world the daemon runs in (`.ts` in a checkout, `.js` in the
 * compiled package). The worker's entry point sits one level up, next to
 * the core, and not inside it: it is the process that wires the adapters
 * (D3).
 */
const WORKER_PATH = relativeModulePath(import.meta.url, '../worker');

/** Rotate the log file when it grew past the configured size. */
export function rotateLog(logFile: string, maxBytes: number, keep: number): void {
  try {
    const stat = fs.statSync(logFile);
    if (stat.size < maxBytes) return;
    for (let index = keep; index >= 1; index -= 1) {
      const from = index === 1 ? logFile : `${logFile}.${index - 1}`;
      const to = `${logFile}.${index}`;
      if (fs.existsSync(from)) {
        if (index === keep) fs.rmSync(to, { force: true });
        fs.renameSync(from, to);
      }
    }
  } catch {
    // No log file yet — nothing to rotate.
  }
}

class Supervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private backoffMs = 500;

  private readonly role: string;
  private readonly configPath: string;
  private readonly stateDir: string;

  constructor(role: string, configPath: string, stateDir: string) {
    this.role = role;
    this.configPath = configPath;
    this.stateDir = stateDir;
  }

  start(): void {
    if (this.stopping) return;
    const child = fork(WORKER_PATH, [this.role, '--config', this.configPath], {
      execArgv: [],
      env: {
        ...process.env,
        GATEWARDEN_CONFIG: this.configPath,
        GATEWARDEN_STATE_DIR: this.stateDir,
        TRAEFIK_DEV_CONFIG: this.configPath,
        TRAEFIK_DEV_STATE_DIR: this.stateDir,
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.child = child;

    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      log('warn', SCOPE, `${this.role} worker exited`, `code=${code} signal=${signal}; respawning`);
      setTimeout(() => this.start(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
    });
  }

  stop(): void {
    this.stopping = true;
    if (this.child) {
      this.child.send?.('shutdown');
      this.child.kill('SIGTERM');
    }
  }
}

/**
 * Run the daemon.
 *
 * The daemon is the supervisor; the entry point that starts it is
 * `src/daemon.ts`, which is also the process the CLI starts.
 */
export async function runDaemon(): Promise<void> {
  // The configuration file the daemon runs with is the one the command
  // line names (`--config <path>`), and the one the environment names
  // when the command line does not. The workers are given the same file,
  // so that the daemon and its workers cannot read different ones.
  const configPath = configPathFromArgv(process.argv) ?? resolveConfigPath();
  const config = loadConfig({ configPath });
  setLogLevel(
    (process.env['GATEWARDEN_LOG_LEVEL'] ??
      process.env['DEV_GATEWAY_LOG_LEVEL'] ??
      process.env['TRAEFIK_DEV_LOG_LEVEL']) === 'debug'
      ? 'debug'
      : 'info',
  );

  fs.mkdirSync(config.stateDir, { recursive: true });
  const logFile = logFileFor(config.stateDir);
  // The log does not always live in the state directory: on macOS and
  // Windows it lives in the log directory of the platform.
  ensureLogDirectory(logFile);
  rotateLog(logFile, config.logMaxBytes, config.logKeep);

  const pidFile = path.join(config.stateDir, 'daemon.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);

  // The workers read the same configuration file as the daemon. Resolving
  // it the same way matters: the configuration file lives in the XDG
  // configuration directory, not in the state directory. The file the CLI
  // resolved travels with the command line, so the workers cannot end up
  // reading another one.
  const registry = new Supervisor('registry', configPath, config.stateDir);
  const relay = new Supervisor('relay', configPath, config.stateDir);
  registry.start();
  relay.start();

  log('info', SCOPE, 'daemon started', `pid=${process.pid} registry=${config.registryPort} relay=${config.relayPort} state=${config.stateDir}`);

  const shutdown = () => {
    log('info', SCOPE, 'daemon stopping');
    registry.stop();
    relay.stop();
    try {
      fs.rmSync(pidFile, { force: true });
    } catch {
      // ignore
    }
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
