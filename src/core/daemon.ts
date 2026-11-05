/**
 * The daemon: the supervisor of the gateway.
 *
 * One supervisor process with two supervised workers:
 *
 *   - registry worker: serves the dynamic configuration and the index
 *   - relay worker:   dispatches to the dev servers
 *
 * A worker that dies of something a restart can fix is respawned; the
 * other listener keeps serving. A worker that dies of a mistake no
 * restart can fix — a proxy id the package does not know, say — is not
 * respawned: the daemon stops and says why.
 *
 * The supervisor itself knows nothing about proxies: the workers pick the
 * adapter they render with.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { loadConfig, configPathFromArgv, resolveConfigPath } from './config.ts';
import { logFileFor, resolvePaths } from './paths.ts';
import { clearDaemonReason, ensureLogDirectory, writeDaemonReason } from './daemonControl.ts';
import {
  installationRoot,
  installationTreeIsIntact,
  isCheckoutInstallation,
  removeInstallationFiles,
} from './installation.ts';
import { log, setLogLevel } from './log.ts';
import { relativeModulePath } from './util/module.ts';

const SCOPE = 'daemon';

/** How often the daemon looks at its own installation. */
const WATCH_INTERVAL_MS = 500;

/**
 * The worker, next to the core.
 *
 * The path is a runtime string, so the compiler does not rewrite it: it is
 * resolved against the module that asks for it, with the extension that
 * matches the world the daemon runs in (`.ts` in a checkout, `.js` in the
 * compiled package). The worker's entry point sits one level up, next to
 * the core, and not inside it: it is the process that wires the adapters.
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

/**
 * The reason a worker gave for not serving, when it gave one.
 *
 * The worker sends it over the channel the daemon opened: the daemon
 * does not have to guess the reason from what the worker wrote, and the
 * reason that reaches the user is the one the worker knows.
 */
export function fatalReason(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  if (record['type'] !== 'fatal') return null;
  const text = record['message'];
  return typeof text === 'string' && text.length > 0 ? text : null;
}

class Supervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private backoffMs = 500;
  /** The reason the worker gave for not serving, when it gave one. */
  private fatal: string | null = null;
  /** A restart is on its way: the worker must not be started twice. */
  private respawning = false;

  private readonly role: string;
  private readonly configPath: string;
  private readonly stateDir: string;
  /** Called when the worker dies of a failure no restart can fix. */
  private readonly onFatal: (reason: string) => void;

  constructor(
    role: string,
    configPath: string,
    stateDir: string,
    onFatal: (reason: string) => void,
  ) {
    this.role = role;
    this.configPath = configPath;
    this.stateDir = stateDir;
    this.onFatal = onFatal;
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
    this.fatal = null;
    this.respawning = false;

    // A worker that cannot be reached must not take the daemon with it:
    // the channel of a process that has exited is closed, and writing
    // to it raises an error. The error is a line in the log, and the
    // supervisor goes on. The worker that is gone is started again by
    // its exit, which comes anyway.
    child.on('error', (error: Error) => {
      if (this.stopping) return;
      log('warn', SCOPE, `${this.role} worker could not be reached`, error.message);
    });

    // The worker tells the daemon when it will not serve, and why. The
    // daemon has to tell that failure from the ones a restart can fix.
    child.on('message', (message: unknown) => {
      const reason = fatalReason(message);
      if (reason === null) return;
      this.fatal = reason;
      this.onFatal(reason);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      if (this.fatal !== null) {
        // The worker said why it will not serve, and the daemon is
        // stopping because of it. It is not started again.
        return;
      }
      this.scheduleRespawn('worker exited', `code=${code} signal=${signal}`);
    });
  }

  /**
   * Start the worker again, after a failure.
   *
   * The backoff grows with every failure, and one failure never starts
   * the worker twice.
   */
  private scheduleRespawn(message: string, detail: string): void {
    if (this.stopping || this.respawning) return;
    this.respawning = true;
    log('warn', SCOPE, `${this.role} ${message}`, `${detail}; respawning`);
    setTimeout(() => {
      this.respawning = false;
      this.start();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
  }

  stop(): void {
    this.stopping = true;
    stopWorker(this.child);
  }
}

/**
 * Stop a worker.
 *
 * The worker may be gone already: the channel of a process that has
 * exited is closed, and writing to it raises an error that would take
 * the daemon with it — an unhandled error ends the daemon with a code
 * that is not zero, and a service that reads that code starts the
 * daemon again.
 *
 * The message is a courtesy; the signal is what stops a worker that is
 * still there.
 */
export function stopWorker(child: ChildProcess | null): void {
  if (!child) return;
  try {
    if (child.connected) {
      // The callback takes the error of a message that could not be
      // sent: without it, the error is an event nobody listens to.
      child.send('shutdown', () => {
        // The worker may not take the message: it is on its way out.
      });
    }
  } catch {
    // The channel is gone: there is nothing to tell.
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // The worker is gone.
  }
}

/**
 * Run the daemon.
 *
 * The daemon is the supervisor; the entry point that starts it is
 * `gatewarden-daemon`, which is also the process the CLI starts.
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
  // The log lives in the state directory; the helper makes sure that the
  // directory is there.
  ensureLogDirectory(logFile);
  rotateLog(logFile, config.logMaxBytes, config.logKeep);

  const pidFile = path.join(config.stateDir, 'daemon.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  // The reason of an earlier life of the daemon is not the reason of
  // this one.
  clearDaemonReason(config);

  let stopping = false;
  let registry: Supervisor | null = null;
  let relay: Supervisor | null = null;

  /**
   * Stop the daemon.
   *
   * The workers are stopped, the pidfile is removed, and the process
   * ends with the code that says "stopped": zero.
   *
   * A daemon that stops on purpose — because a worker will not serve,
   * say — must not look like a daemon that crashed. A service that
   * starts a daemon that stopped on purpose again fills its journal
   * with the same failure for ever. A daemon that dies of something
   * else ends with a code that is not zero (the entry point sets it),
   * and the service starts it again.
   */
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    log('info', SCOPE, 'daemon stopping');
    registry?.stop();
    relay?.stop();
    try {
      fs.rmSync(pidFile, { force: true });
    } catch {
      // ignore
    }
    setTimeout(() => process.exit(0), 500).unref();
  };

  /**
   * A failure no restart can fix.
   *
   * A worker that will not serve — because the configuration names a
   * proxy id the package does not know — would not serve after a
   * restart either. The daemon stops instead of starting it again, and
   * writes the reason down: the command that waits for the daemon can
   * then say what happened, instead of waiting for a health check that
   * will never answer.
   */
  const fatal = (reason: string): void => {
    if (stopping) return;
    log('error', SCOPE, 'the daemon stops', reason);
    writeDaemonReason(config, reason);
    shutdown();
  };

  // The workers read the same configuration file as the daemon. Resolving
  // it the same way matters: the configuration file lives in the XDG
  // configuration directory, not in the state directory. The file the CLI
  // resolved travels with the command line, so the workers cannot end up
  // reading another one.
  registry = new Supervisor('registry', configPath, config.stateDir, fatal);
  relay = new Supervisor('relay', configPath, config.stateDir, fatal);
  registry.start();
  relay.start();

  log('info', SCOPE, 'daemon started', `pid=${process.pid} registry=${config.registryPort} relay=${config.relayPort} state=${config.stateDir}`);

  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());

  // The daemon watches its own installation. An installation that
  // is removed takes the daemon with it: the package is gone, and the
  // daemon has nothing left to serve.
  //
  // The files of the installation go with it as well: the configuration
  // file, the route store and the cache. npm 7 and later do not run the
  // uninstall scripts of a package — npm's own documentation says so —
  // so the daemon is the only one that can clean up.
  //
  // Two cases are left alone: a checkout is not an installation (a
  // clone that is deleted must not take the files of the user with it),
  // and a tree that is being rebuilt (`npm ci` removes the whole
  // `node_modules` and fills it again) brings the installation back.
  const root = installationRoot(import.meta.url);
  if (root !== null) {
    // Whether the installation is a checkout is decided now, while it is
    // still there: the directory is gone by the time the daemon notices.
    const checkout = isCheckoutInstallation(root);
    const watch = setInterval(() => {
      if (fs.existsSync(root)) return;
      clearInterval(watch);

      if (checkout) {
        log('info', SCOPE, 'the checkout is gone', `root=${root}`);
      } else if (!installationTreeIsIntact(root)) {
        log('info', SCOPE, 'the tree of the installation is gone', `root=${root}`);
      } else {
        const paths = resolvePaths();
        removeInstallationFiles({
          configFile: configPath,
          stateDir: config.stateDir,
          cacheDir: paths.cacheDir,
          logFile,
        });
        log('info', SCOPE, 'the installation is gone', `root=${root}`);
      }

      shutdown();
    }, WATCH_INTERVAL_MS);
  }
}
