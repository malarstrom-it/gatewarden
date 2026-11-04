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
 *
 * The trust lists (`allowedCidrs` and `registryAllowedCidrs`) are in the
 * report too. The first holds the addresses that may talk to the
 * gateway — the address of the proxy and the loopback of the machine —
 * and a proxy that is not in it gets a 403, which is the most common
 * reason for one. An installation that refuses its proxy is not broken,
 * so that is a warning and never a failure.
 *
 * The registry has a list of its own, on top of the relay's: an address
 * that may only read the configuration document does not have to be
 * allowed to dispatch. Both lists are printed, each on a row of its
 * own, because a list that is written in the configuration file and
 * never named in the report is a list nobody knows about.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectIpv6Prefixes,
  listenHost,
  loadConfigWithReport,
  resolveConfigPath,
  resolveStateDir,
  zoneOf,
} from '../core/config.ts';
import { legacyAppPaths, legacyDir, logFileFor } from '../core/paths.ts';
import { daemonStatus } from '../core/daemonControl.ts';
import { LEGACY_ROUTES_FILE, ROUTES_FILE, RegistrationStore } from '../core/state.ts';
import { isAddressAllowed, isLoopbackAddress, isPortListening, normaliseAddress } from '../core/util/net.ts';
import { moduleDirectory } from '../core/util/module.ts';
import { requireAdapter } from '../adapters/index.ts';
import type { Config } from '../core/types.ts';
import { proxyAddresses } from './setup.ts';
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

/**
 * The environment variable that says where the proxy's API answers.
 *
 * The wizard is told with its `--api-base-url` flag. The doctor needs
 * the same thing for the same reason: the trust list holds the
 * addresses of the proxy, and the doctor compares them with the list.
 * Without a flag of its own, the doctor reads the environment.
 */
const PROXY_API_URL_ENV = 'GATEWARDEN_PROXY_API_URL';

/**
 * The trust list the configuration file declares.
 *
 * The list the listeners use is the list of the file plus the IPv6
 * prefixes of the networks of this machine, which the loader adds. The
 * list of the file is the one the user writes, and the one the doctor
 * asks about: the addresses the loader adds are the neighbours of this
 * machine on its own networks, not the proxy.
 */
function declaredTrustList(declared: Record<string, unknown> | undefined, config: Config): string[] {
  const value = declared?.['allowedCidrs'];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  // No file to read: the list of the loader, without the prefixes it
  // adds for the networks of this machine.
  const derived = detectIpv6Prefixes();
  return config.allowedCidrs.filter(
    (cidr) => !derived.some((prefix) => prefix.toLowerCase() === cidr.toLowerCase()),
  );
}

/**
 * Does the list hold an address that is not the loopback?
 *
 * The loopback is the machine itself: a process here is the only one
 * that can have it. The trust list of an installation holds the
 * addresses of the proxy and the loopback, so a list that holds nothing
 * but the loopback is a list that no proxy on another machine is in.
 */
function holdsAddressBesidesLoopback(list: string[]): boolean {
  return list.some((cidr) => !isLoopbackCidr(cidr));
}

/**
 * Does the CIDR cover loopback addresses only?
 *
 * `127.0.0.1/32` and `127.0.0.0/8` are the loopback of the machine,
 * and so is `::1/128`. A wider net (`0.0.0.0/0`, `::/0`) is not: it
 * covers the world.
 */
function isLoopbackCidr(cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/');
  const address = normaliseAddress(network);
  if (!isLoopbackAddress(address)) return false;
  if (bitsRaw === undefined) return true;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits)) return false;
  // The IPv6 loopback is one address; the IPv4 loopback is a net.
  return address.includes(':') ? bits === 128 : bits >= 8;
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
 * One file of an old layout, and the place it has in the new one.
 */
interface OldLayoutFile {
  /** What the file is. */
  what: string;
  /** Where the file is in the old layout. */
  from: string;
  /** Where the file belongs in the new layout. */
  to: string;
}

/**
 * What an old layout holds, and what of it the new layout has.
 *
 * The question the doctor asks about an old layout is not "is the old
 * directory still there" but "is there anything in it that the new
 * layout does not have yet". A migration copies the configuration file
 * and the route store into the new layout and leaves the old directory
 * where it is, so a directory that is still there after a migration is
 * not a sign that the migration is waiting: it is the sign that the
 * migration has run.
 */
interface OldLayoutState {
  /** The files of the old layout that the new layout has. */
  migrated: OldLayoutFile[];
  /** The files of the old layout that the new layout does not have. */
  pending: OldLayoutFile[];
}

/**
 * The state of an old layout against the new one.
 *
 * The two files a migration moves are the configuration file and the
 * route store. The pidfile and the log of the old layout belong to a
 * daemon that runs, and they are never migrated, so they do not count
 * here: an old directory that holds nothing else has nothing left to
 * migrate.
 */
function oldLayoutState(opts: {
  oldConfigFile: string;
  oldRoutesFile: string;
  newConfigFile: string;
  newRoutesFile: string;
}): OldLayoutState {
  const migrated: OldLayoutFile[] = [];
  const pending: OldLayoutFile[] = [];

  const files: OldLayoutFile[] = [
    { what: 'the configuration file', from: opts.oldConfigFile, to: opts.newConfigFile },
    { what: 'the route store', from: opts.oldRoutesFile, to: opts.newRoutesFile },
  ];

  for (const file of files) {
    if (!exists(file.from)) continue;
    (exists(file.to) ? migrated : pending).push(file);
  }

  return { migrated, pending };
}

/**
 * The directories of an old layout that hold the files in question.
 *
 * The old layout of the name the package had before the rename has two
 * directories: one for the configuration and one for the route store.
 * The name of the layout in the report is the name of the directories
 * that hold the files the report talks about.
 */
function oldLayoutDirs(files: OldLayoutFile[], fallback: string[]): string[] {
  const dirs = [...new Set(files.map((file) => path.dirname(file.from)))];
  return dirs.length > 0 ? dirs : fallback;
}

/**
 * The reason of the check of an old layout.
 *
 * When something is waiting, the reason says what it is and where it
 * belongs: the migration has not run, or it has not run for that file.
 * When nothing is waiting, the reason says what the migration did and
 * what the user may do with the old directories: the migration leaves
 * them where they are on purpose, so the user may leave them there as
 * well, or remove them. The advice to run the migration again belongs to
 * the first case only.
 */
function oldLayoutDetail(dirs: string[], state: OldLayoutState): string {
  const label = dirs.length === 1 ? dirs[0] : `${dirs[0]} and ${dirs[1]}`;

  if (state.pending.length > 0) {
    const waiting = state.pending
      .map((file) => `${file.what} (${file.from}) has not been migrated to ${file.to} yet`)
      .join('; ');
    return `${label} is still there: ${waiting} (run "gatewarden migrate")`;
  }

  const copied = state.migrated.map((file) => `${file.what} to ${file.to}`).join(' and ');
  const what = dirs.length === 1 ? 'the old directory' : 'the old directories';
  return `${label} is still there: the migration copied the files to the new layout (${copied}); ${what} can be left in place or removed by you`;
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
      'trust list',
      'registry list',
      'proxy address',
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
  let proxyApiBaseUrl: string | undefined;
  try {
    const adapter = requireAdapter(config.proxy);
    // Where the proxy's API answers. The wizard is told with a flag, the
    // doctor with the environment: the address of the proxy is what the
    // trust list is about.
    proxyApiBaseUrl = env[PROXY_API_URL_ENV] ?? adapter.defaultApiBaseUrl;
    const base = proxyApiBaseUrl ?? '(the default of the adapter)';
    const discovered = await adapter.discover({ timeoutMs: 1000, apiBaseUrl: proxyApiBaseUrl });
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

  // 10. The trust lists.
  //
  // The addresses that may talk to the gateway. Both listeners answer
  // the addresses in the list and nobody else, so the list is the
  // answer to the question a user asks when a listener answers a 403.
  // The report prints it: the user has to see which addresses may talk
  // with the gateway.
  //
  // The list that is printed is the list the listeners use: the list of
  // the configuration file plus the IPv6 prefixes of the networks of
  // this machine, which the loader adds.
  //
  // The list of the registry is printed on a row of its own, below.
  //
  // An empty list is not an error: it is an installation that trusts
  // nobody, and the doctor says so in plain words.
  const trustList = declaredTrustList(declared, config);
  if (!here) {
    skipped('trust list', NOT_SET_UP);
  } else if (trustList.length === 0 && config.allowedCidrs.length === 0) {
    checks.push({
      name: 'trust list',
      status: 'warn',
      detail: 'the trust list (allowedCidrs) is empty: no address may talk to the gateway',
    });
  } else if (trustList.length === 0) {
    // The file holds nothing, and the machine adds the IPv6 prefixes of
    // its own networks: the list is not empty, but the user has not
    // named a single address in it.
    checks.push({
      name: 'trust list',
      status: 'warn',
      detail: `the trust list (allowedCidrs) of the configuration file is empty: the only addresses that may talk to the gateway are the ones this machine adds (${config.allowedCidrs.join(', ')})`,
    });
  } else {
    checks.push({
      name: 'trust list',
      status: 'ok',
      detail: `the trust list (allowedCidrs): ${config.allowedCidrs.join(', ')}`,
    });
  }

  // 11. The trust list of the registry.
  //
  // The registry has a list of its own, on top of the relay's: the two
  // listeners have different jobs — one hands out the configuration
  // document, the other forwards the requests — and an address that may
  // only read the document does not have to be allowed to dispatch. The
  // doctor prints the list, because an installation that has filled it
  // has to see those addresses somewhere.
  //
  // An empty list of the registry is not a warning: it means that the
  // registry serves the configuration document to the same addresses as
  // the relay. The doctor says that in plain words, so that the reader
  // sees that the list is empty and knows what it means.
  //
  // The address of the proxy is not compared with this list: an address
  // that is only in it reaches the registry and not the relay, and the
  // relay is the one the proxy dispatches through.
  if (!here) {
    skipped('registry list', NOT_SET_UP);
  } else if (config.registryAllowedCidrs.length === 0) {
    checks.push({
      name: 'registry list',
      status: 'ok',
      detail:
        'the trust list of the registry (registryAllowedCidrs) is empty: the registry serves the configuration document to the same addresses as the relay',
    });
  } else {
    checks.push({
      name: 'registry list',
      status: 'ok',
      detail: `the trust list of the registry (registryAllowedCidrs): ${config.registryAllowedCidrs.join(', ')}`,
    });
  }

  // 12. The address of the proxy.
  //
  // The trust list holds the addresses that may talk to the gateway:
  // the address of the proxy — the one that polls the configuration
  // document and sends the dispatch header — and the loopback of the
  // machine. The listeners decide with the source address of the
  // caller, so the address of the proxy is the one that has to be in
  // the list. A proxy that is not in it gets a 403, and it is the most
  // common reason for one.
  //
  // The doctor knows where the proxy is when it can resolve the host of
  // the proxy's API: those are the addresses the proxy connects from,
  // and the ones the setup wizard writes into the list.
  //
  // The list of the registry does not count here: an address that is
  // only in it reaches the configuration document and not the relay, and
  // the relay is the one the proxy dispatches through.
  //
  // When the doctor does not know, it says what it can say: a list
  // that holds nothing but the loopback is a list that no proxy on
  // another machine is in.
  //
  // An installation without the right address in the list is not
  // broken: it is an installation that refuses its proxy. That is a
  // warning with the way out, never a failure.
  if (!here) {
    skipped('proxy address', NOT_SET_UP);
  } else {
    const sources = await proxyAddresses(proxyApiBaseUrl);
    const uncovered = sources.filter((address) => !isAddressAllowed(address, config.allowedCidrs));
    if (sources.length > 0) {
      if (uncovered.length > 0) {
        checks.push({
          name: 'proxy address',
          status: 'warn',
          detail: `the proxy connects from ${uncovered.join(', ')}, and the trust list (allowedCidrs) does not cover it: the gateway answers it a 403 (add the address of your proxy to allowedCidrs)`,
        });
      } else {
        checks.push({
          name: 'proxy address',
          status: 'ok',
          detail: `the proxy connects from ${sources.join(', ')}, and the trust list (allowedCidrs) covers it`,
        });
      }
    } else if (trustList.length === 0) {
      checks.push({
        name: 'proxy address',
        status: 'warn',
        detail:
          'the trust list (allowedCidrs) of the configuration file is empty: the address of your proxy is not in it (add the address of your proxy to allowedCidrs)',
      });
    } else if (!holdsAddressBesidesLoopback(trustList)) {
      checks.push({
        name: 'proxy address',
        status: 'warn',
        detail: 'the trust list (allowedCidrs) of the configuration file holds the loopback and nothing else: a proxy that runs on another machine is not in it, and the gateway answers it a 403 (add the address of your proxy to allowedCidrs)',
      });
    } else {
      skipped(
        'proxy address',
        'the doctor does not know where the proxy is: the trust list holds addresses besides the loopback',
      );
    }
  }

  // 13. The service.
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

  // 14. The unit of the old name.
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

  // 15. The old layout.
  //
  // The migration copies the configuration file and the route store into
  // the new layout and leaves the old directory where it is. The
  // directory being there is therefore not a reason to warn: what the
  // doctor asks is whether something in it is still waiting to be
  // migrated.
  const legacyState = oldLayoutState({
    oldConfigFile: legacyConfig,
    oldRoutesFile: path.join(legacy, LEGACY_ROUTES_FILE),
    newConfigFile: configPath,
    newRoutesFile: path.join(stateDir, ROUTES_FILE),
  });
  if (!exists(legacy)) {
    skipped('legacy layout', 'there is no old layout to migrate');
  } else if (legacyState.pending.length > 0) {
    checks.push({
      name: 'legacy layout',
      status: 'warn',
      detail: oldLayoutDetail(oldLayoutDirs(legacyState.pending, [legacy]), legacyState),
    });
  } else if (legacyState.migrated.length > 0) {
    // The migration has run: everything the old layout held is in the
    // new layout, and the old directory is only left in place.
    checks.push({
      name: 'legacy layout',
      status: 'ok',
      detail: oldLayoutDetail(oldLayoutDirs(legacyState.migrated, [legacy]), legacyState),
    });
  } else {
    skipped(
      'legacy layout',
      `${legacy} holds no configuration and no route store: there is nothing to migrate`,
    );
  }

  // 16. The layout of the name the directories had before the rename.
  //
  // An installation that was made under the old name keeps its
  // configuration and its route store in the directories of that name.
  // The migration moves them and leaves the directories where they
  // are, so the doctor asks the same question here as it asks about the
  // old layout: is there anything in them that is still waiting to be
  // migrated?
  const oldNameState = oldLayoutState({
    oldConfigFile: oldNameConfig,
    oldRoutesFile: path.join(oldName.stateDir, ROUTES_FILE),
    newConfigFile: configPath,
    newRoutesFile: path.join(stateDir, ROUTES_FILE),
  });
  const oldNameDirs = [
    ...(exists(oldName.configDir) ? [oldName.configDir] : []),
    ...(exists(oldName.stateDir) ? [oldName.stateDir] : []),
  ];
  if (oldNameDirs.length === 0) {
    skipped('old name layout', 'there is no old name layout to migrate');
  } else if (oldNameState.pending.length > 0) {
    checks.push({
      name: 'old name layout',
      status: 'warn',
      detail: oldLayoutDetail(oldLayoutDirs(oldNameState.pending, oldNameDirs), oldNameState),
    });
  } else if (oldNameState.migrated.length > 0) {
    checks.push({
      name: 'old name layout',
      status: 'ok',
      detail: oldLayoutDetail(oldLayoutDirs(oldNameState.migrated, oldNameDirs), oldNameState),
    });
  } else {
    skipped(
      'old name layout',
      `${oldLayoutDirs([], oldNameDirs).join(' and ')} holds no configuration and no route store: there is nothing to migrate`,
    );
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
