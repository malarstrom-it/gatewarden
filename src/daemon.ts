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
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { log, setLogLevel } from './log.ts';

const SCOPE = 'daemon';
const WORKER_PATH = fileURLToPath(new URL('./worker.ts', import.meta.url));

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
    const child = fork(WORKER_PATH, [this.role], {
      execArgv: [],
      env: {
        ...process.env,
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
  const logFile = path.join(config.stateDir, 'daemon.log');
  rotateLog(logFile, config.logMaxBytes, config.logKeep);

  const pidFile = path.join(config.stateDir, 'daemon.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);

  const configPath = process.env['TRAEFIK_DEV_CONFIG'] ?? path.join(config.stateDir, 'config.json');
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
