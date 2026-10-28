/**
 * The daemon (`traefik-devd`).
 *
 * One supervisor process with two supervised workers:
 *
 *   - registry worker: serves the Traefik dynamic configuration and the index
 *   - relay worker:   dispatches to the dev servers
 *
 * A worker that dies is respawned; the other listener keeps serving.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { loadConfig, configPathFromArgv, resolveConfigPath } from './config.ts';
import { logFileFor } from './core/paths.ts';
import { ensureLogDirectory } from './daemonControl.ts';
import { log, setLogLevel } from './log.ts';
import { siblingModulePath } from './util/module.ts';

const SCOPE = 'daemon';
/**
 * The worker, next to this module.
 *
 * The path is a runtime string, so the compiler does not rewrite it: it is
 * resolved against the module that asks for it, with the extension that
 * matches the world the daemon runs in (`.ts` in a checkout, `.js` in the
 * compiled package).
 */
const WORKER_PATH = siblingModulePath(import.meta.url, 'worker');

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
        DEV_GATEWAY_CONFIG: this.configPath,
        DEV_GATEWAY_STATE_DIR: this.stateDir,
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

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(process.env['TRAEFIK_DEV_LOG_LEVEL'] === 'debug' ? 'debug' : 'info');

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
  const configPath = configPathFromArgv(process.argv) ?? resolveConfigPath();
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

main().catch((error: unknown) => {
  log('error', SCOPE, 'daemon failed to start', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
