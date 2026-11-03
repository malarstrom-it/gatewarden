/**
 * The healthcheck of the package: `gatewarden doctor`.
 *
 * The doctor is the one command that has to work everywhere. It runs in a
 * container that has no proxy, no zone, no daemon and no public URL, and
 * it still has to say something true about where it stands.
 *
 * The rule it follows:
 *
 * > **A thing that is not there is not an error. A thing that is there and
 * > broken is.**
 *
 * A missing configuration file, a zone that is not set, a daemon that has
 * not started, a proxy that does not answer, a service that is not
 * installed: these are the shape of a machine that has no installation on
 * it, or of an installation that is not complete yet, and they are
 * reported with their reason (`skipped` or `warn`). A configuration file
 * that cannot be read, a state directory that cannot be written to, a
 * daemon that runs but does not answer, a proxy that answers but is not
 * the one the configuration names: these are errors (`fail`), and only
 * these are.
 *
 * The exit code follows the same rule. The doctor exits 0 when nothing is
 * broken, even when a dozen checks stand at `warn` — a healthcheck that
 * fails because the machine is a CI runner is a healthcheck nobody trusts.
 * `--strict` turns the warnings into errors as well, for the one who wants
 * the whole installation to be complete.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listenHost,
  loadConfigWithReport,
  resolveConfigPath,
  resolveStateDir,
  zoneOf,
} from '../core/config.ts';
import { legacyAppPaths, legacyDir, logFileFor } from '../core/paths.ts';
import { daemonStatus } from '../core/daemonControl.ts';
import { RegistrationStore } from '../core/state.ts';
import { isPortListening } from '../core/util/net.ts';
import { moduleDirectory } from '../core/util/module.ts';
import { requireAdapter } from '../adapters/index.ts';
import type { Config } from '../core/types.ts';
import { legacyServiceUnitFor, serviceUnitFor, type ServiceUnit } from './service.ts';

/**
 * What a check found.
 *
 * - `ok` — the thing is there and it works.
 * - `warn` — the thing is not there, or it is not complete. It is not an
 *   error, and the reason says what to do about it.
 * - `fail` — the thing is there and it is broken. This is the only status
 *   that makes the doctor fail.
 * - `skipped` — there is nothing to check here: the installation is not on
 *   this machine.
 */
export type HealthStatus = 'ok' | 'warn' | 'fail' | 'skipped';

/** One check of the doctor. */
export interface HealthCheck {
  /** What was looked at. */
  name: string;
  /** What was found. */
  status: HealthStatus;
  /** The reason, in clear text. */
  detail: string;
}

/** The report of the doctor. */
export interface HealthReport {
  /**
   * Is nothing broken?
   *
   * `false` when a check failed. A warning does not make it `false`: a
   * warning is a thing to know about, not a thing that is broken.
   */
  ok: boolean;
  /** Every check, one per thing the doctor looks at. */
  checks: HealthCheck[];
  /** Where the installation keeps its files. */
  paths: { configPath: string; stateDir: string; logFile: string };
}

export interface HealthCheckOptions {
  /** An explicit configuration file (the `--config` flag). */
  configPath?: string;
  /** An explicit state directory (the `--state-dir` flag). */
  stateDir?: string;
  /** The environment to read. Defaults to the environment of the process. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The reason of a check that has nothing to check.
 *
 * It is the same sentence in every check, so that the report reads as one
 * thing and not as twelve.
 */
const NOT_SET_UP = 'not set up here: there is no installation on this machine';

/** The path of the launcher that runs the daemon. */
export function daemonLauncherPath(): string {
  // The CLI entry point sits two levels under the package root, next to
  // `bin/`.
  const root = path.resolve(moduleDirectory(import.meta.url), '..', '..');
  return path.join(root, 'bin', 'gatewarden-daemon.js');
}

/** Is a service unit installed for this platform? */
export function serviceUnitInstalled(unit: ServiceUnit): boolean {
  if (!unit.path) return false;
  try {
    return fs.existsSync(unit.path);
  } catch {
    return false;
  }
}

/** Is the path a directory that can be written to? */
function writableDirectory(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The fields a configuration file declares.
 *
 * The loader normalises the file: a zone that is an empty string and a
 * zone that is not mentioned at all become the same value. The doctor
 * needs to tell the two apart, because they are two different
 * installations: one that says "the zone is empty" and one that says
 * nothing about the zone yet.
 */
function readDeclaredFields(configPath: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    return raw as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Does the path exist? */
function exists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

/**
 * The doctor.
 *
 * Every check says what it looked at and why it says what it says. The
 * doctor reads the installation and changes nothing: it does not migrate
 * the old layout, and it does not start a daemon.
 */
export async function runHealthCheck(opts: HealthCheckOptions = {}): Promise<HealthReport> {
  const env = opts.env ?? process.env;
  const checks: HealthCheck[] = [];

  let configPath = resolveConfigPath({ configPath: opts.configPath, env });
  let stateDir = resolveStateDir({ stateDir: opts.stateDir, env });
  let config: Config | undefined;
  let configError: string | undefined;

  try {
    const loaded = loadConfigWithReport({
      configPath: opts.configPath,
      stateDir: opts.stateDir,
      env,
      // The doctor reads the installation, it does not move it: the
      // migration is the job of `gatewarden migrate`.
      migrate: false,
    });
    config = loaded.config;
    configPath = loaded.configPath;
    stateDir = loaded.paths.stateDir;
  } catch (error) {
    // A configuration file that cannot be read is one of the few things
    // that is an error. The rest of the report is still worth having.
    configError = error instanceof Error ? error.message : String(error);
  }

  const logFile = logFileFor(stateDir, { env });
  const configExists = exists(configPath);
  const legacy = legacyDir({ env });
  const legacyConfig = path.join(legacy, 'config.json');
  const legacyHasConfig = exists(legacyConfig);

  // The layout of the name the directories had before the rename.
  const oldName = legacyAppPaths({ env });
  const oldNameConfig = path.join(oldName.configDir, 'config.json');
  const oldNameHasConfig = exists(oldNameConfig);

  // The fields the configuration file declares.
  //
  // The zone is the field the host names of the routes are built from,
  // and the one field the installation cannot do without. A
  // configuration file that declares it has declared an installation: it
  // is checked as one, and a part of it that is missing is an error. A
  // configuration file that says nothing about the zone belongs to an
  // installation that is not set up here: everything about it is a
  // warning, and the doctor exits 0.
  const declared = readDeclaredFields(configPath);
  const declaresZone = declared !== undefined && 'zone' in declared;

  /**
   * Is the installation on this machine?
   *
   * The configuration file is the installation's own declaration: without
   * it there is nothing to check, and every check says so. With it, the
   * installation is here, and what is missing from it is reported as what
   * it is.
   *
   * The old layout counts too: an installation that still lives in
   * `~/.traefik-dev` is here as well, and its daemon, its ports and its
   * service are checked like the ones of any other installation. The
   * doctor says that the migration is waiting.
   */
  const here = (configExists || legacyHasConfig || oldNameHasConfig) && configError === undefined;

  /**
   * Has the installation declared itself here?
   *
   * The configuration file of the new layout is there and it declares a
   * zone: the installation has said what it is, and it is checked as one
   * — the daemon has to run, and the zone it declares has to be usable.
   */
  const installed = configExists && declaresZone && configError === undefined;

  /** A check that has nothing to check. */
  const skipped = (name: string, reason: string): void => {
    checks.push({ name, status: 'skipped', detail: reason });
  };

  /**
   * A thing that is not there.
   *
   * On a machine that has the installation, a missing part is a warning:
   * the installation is not complete, and that is not an error. On a
   * machine that does not have the installation at all, there is nothing
   * to warn about.
   */
  const missing = (name: string, reason: string): void => {
    checks.push({ name, status: here ? 'warn' : 'skipped', detail: reason });
  };

  // 1. The configuration file.
  if (configError !== undefined) {
    checks.push({
      name: 'config file',
      status: 'fail',
      detail: `the configuration file cannot be read: ${configError}`,
    });
  } else if (!configExists && legacyHasConfig) {
    // The installation is here, but it lives in the old layout. Its
    // values are read (the loader falls back to the old file), and the
    // doctor says that the migration is waiting.
    missing(
      'config file',
      `${configPath} (not written yet: the installation is in the old layout, ${legacyConfig} — run "gatewarden migrate")`,
    );
  } else if (!configExists && oldNameHasConfig) {
    // The installation is here, but it lives in the directories of the
    // name the package had before the rename. The same thing: the
    // values are read, and the migration is waiting.
    missing(
      'config file',
      `${configPath} (not written yet: the installation is in the layout of the old name, ${oldNameConfig} — run "gatewarden migrate")`,
    );
  } else if (!configExists) {
    skipped('config file', `${configPath} (not written yet: ${NOT_SET_UP})`);
  } else {
    checks.push({ name: 'config file', status: 'ok', detail: configPath });
  }

  // The rest of the report needs the configuration. Without it, every
  // check says that it has nothing to check.
  if (config === undefined) {
    const reason =
      configError !== undefined
        ? `the configuration file cannot be read, so there is nothing to check: ${configError}`
        : NOT_SET_UP;
    for (const name of [
      'state directory',
      'daemon',
      'dns zone',
      'shared middlewares',
      'registry port',
      'relay port',
      'routes',
      'routes and zone',
      'proxy',
      'service',
      'old service',
      'legacy layout',
      'old name layout',
    ]) {
      skipped(name, reason);
    }
    return { ok: false, checks, paths: { configPath, stateDir, logFile } };
  }

  // 2. The state directory.
  if (!exists(stateDir)) {
    skipped('state directory', `${stateDir} (does not exist yet: the daemon creates it when it starts)`);
  } else if (writableDirectory(stateDir)) {
    checks.push({ name: 'state directory', status: 'ok', detail: stateDir });
  } else {
    checks.push({
      name: 'state directory',
      status: 'fail',
      detail: `${stateDir} (not writable: the daemon cannot write its pidfile there)`,
    });
  }

  // 3. The daemon.
  //
  // The daemon starts by itself with the first route (the lazy start),
  // so a daemon that does not run is the normal state of a fresh
  // installation: it is a warning, not an error. A daemon that runs
  // and does not answer is broken.
  const status = await daemonStatus(config);
  if (!here) {
    skipped(
      'daemon',
      `not set up here: there is no installation on this machine (the pidfile of one would be ${status.pidFile})`,
    );
  } else if (status.healthy) {
    if (status.pid === null) {
      // Something answers on the port, and it is not this installation's
      // daemon. That is a fact about the machine, not a broken part of
      // the installation: the doctor says it, and the daemon says it
      // again when it cannot bind the port.
      missing(
        'daemon',
        `a gateway answers on port ${config.registryPort}, but it is not this installation's daemon: there is no pidfile (${status.pidFile})`,
      );
    } else {
      checks.push({ name: 'daemon', status: 'ok', detail: `running (pid ${status.pid})` });
    }
  } else if (status.running) {
    checks.push({
      name: 'daemon',
      status: 'fail',
      detail: `the daemon (pid ${status.pid}) runs, but it does not answer /healthz (see ${logFile})`,
    });
  } else if (installed) {
    // The installation has declared itself: its daemon has to run.
    checks.push({
      name: 'daemon',
      status: 'fail',
      detail: `not running (pidfile ${status.pidFile}): the installation is set up here, so the daemon has to run (run "gatewarden start")`,
    });
  } else {
    missing(
      'daemon',
      `not running (pidfile ${status.pidFile}): it starts with the first route, or run "gatewarden start"`,
    );
  }

  // 4. The DNS zone.
  //
  // The host names of the routes are built from the zone. A zone that is
  // not set is a part of the installation that is not there yet — the
  // setup wizard writes it, or the user writes it by hand. It is
  // a warning with the reason and the way to get one, never a failure:
  // an installation without a zone is not a broken installation, it is an
  // unfinished one.
  const zone = zoneOf(config);
  if (zone) {
    checks.push({ name: 'dns zone', status: 'ok', detail: zone });
  } else if (declaresZone) {
    // The installation declares a zone, and the zone it declares is
    // empty: the file is wrong, and the host names of the routes cannot
    // be built from it.
    checks.push({
      name: 'dns zone',
      status: 'fail',
      detail: 'the configuration file declares a zone, and it is empty: the host names of the routes are built from it (run "gatewarden setup", or write it in the configuration file)',
    });
  } else if (here) {
    missing(
      'dns zone',
      'not configured: the host names of the routes are built from it (run "gatewarden setup", or write it in the configuration file)',
    );
  } else {
    skipped('dns zone', 'not configured: there are no routes to name on this machine');
  }

  // 5. The shared middlewares.
  //
  // They live in another provider of the proxy. When they are on and no
  // provider owns them, the routes ask for a middleware that does not
  // exist yet — a part of the installation that is not there, not a
  // broken one.
  if (!config.compressMiddleware && !config.securityHeaders) {
    skipped('shared middlewares', 'the shared middlewares are not in use');
  } else if (config.middlewareProvider) {
    checks.push({
      name: 'shared middlewares',
      status: 'ok',
      detail: config.middlewareProvider,
    });
  } else {
    missing(
      'shared middlewares',
      'the shared middlewares are on, but no provider owns them (run "gatewarden setup")',
    );
  }

  // 6. The two ports the gateway serves on.
  //
  // Nothing listening on them is not an error: the daemon binds them when
  // it starts, and it starts with the first route.
  const registryUp = await isPortListening(config.registryPort);
  if (registryUp && here) {
    checks.push({
      name: 'registry port',
      status: 'ok',
      detail: `${listenHost()}:${config.registryPort}`,
    });
  } else if (registryUp) {
    skipped(
      'registry port',
      `${listenHost()}:${config.registryPort} (something listens there, but there is no installation here)`,
    );
  } else {
    missing(
      'registry port',
      `${listenHost()}:${config.registryPort} (nothing listens there: the daemon has not started it)`,
    );
  }

  const relayUp = await isPortListening(config.relayPort);
  if (relayUp && here) {
    checks.push({
      name: 'relay port',
      status: 'ok',
      detail: `${listenHost()}:${config.relayPort}`,
    });
  } else if (relayUp) {
    skipped(
      'relay port',
      `${listenHost()}:${config.relayPort} (something listens there, but there is no installation here)`,
    );
  } else {
    missing(
      'relay port',
      `${listenHost()}:${config.relayPort} (nothing listens there: the daemon has not started it)`,
    );
  }

  // 7. The routes.
  const store = new RegistrationStore(config.stateDir);
  const registrations = store.list();
  checks.push({
    name: 'routes',
    status: 'ok',
    detail: `${registrations.length} registered`,
  });

  // 8. The routes and the zone together.
  //
  // A route keeps the zone it was registered with, so the routes of an
  // installation without a zone still have their names. What the zone of
  // the configuration is missing is the *next* route: it cannot be named.
  // That is a part of the installation that is not there, and it is said
  // where it belongs — in the zone check as well.
  if (registrations.length === 0) {
    skipped('routes and zone', 'no routes: there is no host name to build');
  } else if (zone) {
    checks.push({
      name: 'routes and zone',
      status: 'ok',
      detail: `${registrations.length} registered, the zone is ${zone}`,
    });
  } else if (installed) {
    checks.push({
      name: 'routes and zone',
      status: 'fail',
      detail: `${registrations.length} registered, but the configuration has no zone: a new route cannot be named (run "gatewarden setup")`,
    });
  } else {
    missing(
      'routes and zone',
      `${registrations.length} registered, but the configuration has no zone: a new route cannot be named (run "gatewarden setup")`,
    );
  }

  // 9. The proxy.
  //
  // The proxy runs on another machine: one that does not answer is the
  // normal state of a gateway that is not wired yet. One that answers and
  // is not the proxy of the configuration is an error: the routes would be
  // published to the wrong place.
  let proxy: HealthCheck;
  try {
    const adapter = requireAdapter(config.proxy);
    const base = adapter.defaultApiBaseUrl ?? '(the default of the adapter)';
    const discovered = await adapter.discover({ timeoutMs: 1000 });
    if (!discovered) {
      proxy = {
        name: 'proxy',
        status: here ? 'warn' : 'skipped',
        detail: `no ${config.proxy} API answered at ${base}: the proxy runs on another machine`,
      };
    } else {
      const derivedZone = discovered.derived.zone;
      const contradicts = derivedZone !== undefined && zone !== '' && derivedZone !== zone;
      proxy = {
        name: 'proxy',
        status: contradicts ? 'fail' : 'ok',
        detail: contradicts
          ? `the ${config.proxy} at ${base} serves the zone ${derivedZone}, but the configuration says ${zone}: the routes would be published under the wrong names`
          : `${discovered.id}${discovered.version ? ` ${discovered.version}` : ''} (${derivedZone ?? 'no zone derived'})`,
      };
    }
  } catch (error) {
    proxy = {
      name: 'proxy',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  checks.push(proxy);

  // 10. The service.
  const unit = serviceUnitFor({
    daemonPath: daemonLauncherPath(),
    configPath,
    stateDir: config.stateDir,
  });
  if (serviceUnitInstalled(unit)) {
    checks.push({
      name: 'service',
      status: 'ok',
      detail: `${unit.path ?? unit.name} (installed)`,
    });
  } else {
    missing('service', 'not installed: run "gatewarden install-service" so the daemon survives a reboot');
  }

  // 11. The unit of the old name.
  //
  // A unit that was installed before the rename is still on the machine,
  // and it names a launcher that does not exist any more: the daemon it
  // would start is never started, and the service of this installation
  // is not there either. The doctor says so, and the way out is to
  // install the service again and to remove the old unit.
  const legacyUnit = legacyServiceUnitFor({ home: env['HOME'] ?? os.homedir() });
  if (legacyUnit.path !== null && exists(legacyUnit.path)) {
    checks.push({
      name: 'old service',
      status: 'warn',
      detail: `${legacyUnit.path} is still there: it runs the daemon of the old name; run "gatewarden install-service" and remove the old unit`,
    });
  } else {
    skipped('old service', 'there is no unit of the old name');
  }

  // 12. The old layout.
  if (exists(legacy)) {
    checks.push({
      name: 'legacy layout',
      status: 'warn',
      detail: `${legacy} is still there: run "gatewarden migrate"`,
    });
  } else {
    skipped('legacy layout', 'there is no old layout to migrate');
  }

  // 13. The layout of the name the directories had before the rename.
  //
  // An installation that was made under the old name keeps its
  // configuration and its route store in the directories of that name.
  // The migration moves them; until it has run, the old layout is still
  // there, and the doctor says so.
  if (exists(oldName.configDir) || exists(oldName.stateDir)) {
    checks.push({
      name: 'old name layout',
      status: 'warn',
      detail: `${oldName.configDir} is still there: run "gatewarden migrate"`,
    });
  } else {
    skipped('old name layout', 'there is no old name layout to migrate');
  }

  return {
    ok: !checks.some((check) => check.status === 'fail'),
    checks,
    paths: { configPath, stateDir, logFile },
  };
}

/**
 * The exit code of the doctor.
 *
 * Without `strict` only a failed check is an error: a warning says that
 * something is not in place, and that is not a reason to fail a
 * healthcheck. With `strict` a warning is an error too — for the one who
 * wants the whole installation to be complete.
 */
export function healthExitCode(checks: HealthCheck[], strict = false): number {
  const broken = checks.some((check) => check.status === 'fail');
  const incomplete = checks.some((check) => check.status === 'warn');
  return broken || (strict && incomplete) ? 1 : 0;
}

/**
 * The summary of the report, in clear text.
 *
 * The line the README and the setup guide promise: `nothing is broken`
 * when nothing is broken, and the names of the checks that failed when
 * something is.
 */
export function healthSummary(checks: HealthCheck[]): string {
  const failed = checks.filter((check) => check.status === 'fail').map((check) => check.name);
  if (failed.length > 0) return `some checks failed: ${failed.join(', ')}`;
  const warned = checks.filter((check) => check.status === 'warn').map((check) => check.name);
  if (warned.length > 0) {
    return `nothing is broken (${warned.length} checks are not in place here: ${warned.join(', ')})`;
  }
  return 'nothing is broken';
}
