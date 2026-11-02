/**
 * `gatewarden` — the CLI an agent uses.
 *
 *   gatewarden register --project <p> --branch <b> --port <port> [--label <text>]
 *   gatewarden unregister --project <p> --branch <b>
 *   gatewarden list [--json]
 *   gatewarden status [--json]
 *   gatewarden config [--write] [--json]
 *   gatewarden setup [--json]
 *   gatewarden start [--json]
 *   gatewarden stop [--json]
 *   gatewarden doctor [--json] [--strict]
 *   gatewarden install-service [--no-enable] [--json]
 *   gatewarden migrate [--dry-run] [--json]
 *
 * The commands of the old CLI (`register`, `unregister`, `list`, `status`,
 * `config`, `migrate`) keep their names and their behaviour. The commands
 * the specification adds (`setup`, `start`, `stop`, `doctor`,
 * `install-service`) live next to them.
 *
 * Every command that says something about the state of the gateway can say
 * it as JSON: `--json` writes one object to the standard output and
 * nothing else, so a script can read it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configFileContent,
  loadConfigWithReport,
  requireZone,
  writeConfigFile,
  listenHost,
  resolveConfigPath,
  resolveStateDir,
  zoneOf,
  CONFIG_KEYS,
} from '../core/config.ts';
import {
  deprecatedEnvNotices,
  legacyAppPaths,
  legacyDir,
  logFileFor,
  resolvePaths,
  type GatewayPaths,
} from '../core/paths.ts';
import { legacyAppLayout, migrateLegacyAppLayout, migrateLegacyLayout } from '../core/migrate.ts';
import { RegistrationStore } from '../core/state.ts';
import { withRouteLock } from '../core/lock.ts';
import { ensureDaemon, daemonStatus, isGatewayDaemon, isProcessAlive, pidFilePath, stopDaemon } from '../core/daemonControl.ts';
import { isPortListening } from '../core/util/net.ts';
import { slugify } from '../core/util/slug.ts';
import { packageVersion } from '../core/util/module.ts';
import { discoverProxyStatus, requireAdapter } from '../adapters/index.ts';
import { gatewayStatus, routeJson } from '../core/status.ts';
import type { RouteJson } from '../core/status.ts';
import type { Config } from '../core/types.ts';
import { runSetup, type SetupReport } from './setup.ts';
import { installService, manualEnableCommand } from './service.ts';
import {
  daemonLauncherPath,
  healthExitCode,
  healthSummary,
  runHealthCheck,
  serviceUnitInstalled,
  type HealthCheck,
} from './healthcheck.ts';

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

/**
 * The flags that never take a value.
 *
 * The parser has to know them: without the list, `--json list` reads
 * `list` as the value of `--json`, and the command is lost.
 */
const BOOLEAN_FLAGS = new Set([
  'json',
  'version',
  'help',
  'write',
  'dry-run',
  'no-enable',
  'no-verify',
  'yes',
  'non-interactive',
  'strict',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      index += 1;
    }
  }

  // The command is the first word that is not a flag and not the value of
  // one. The options are global: they may come before the command.
  const command = positional[0] ?? 'help';
  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  if (typeof value === 'string') return value;
  return undefined;
}

/** Is the JSON output asked for? */
function wantsJson(flags: Record<string, string | boolean>): boolean {
  return flags['json'] === true || flags['json'] === 'true';
}

/** Write one JSON object to the standard output. */
function emitJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/**
 * The version of the package.
 *
 * It is read from the package manifest next to the module, so that the
 * CLI and the MCP server report the same version.
 */
export { packageVersion };

/**
 * The healthcheck of the package (§9.9).
 *
 * The doctor, the launcher path of the daemon and the check of the
 * service unit live in their own module: the healthcheck is a thing of
 * its own, and the CLI only calls it.
 */
export { daemonLauncherPath, serviceUnitInstalled };
export type { HealthCheck };
/** One check of the doctor. The name the older code used. */
export type DoctorCheck = HealthCheck;

function usage(): string {
  return `gatewarden — expose a dev server running on this machine through the proxy

Usage:
  gatewarden register   --project <p> --branch <b> --port <port> [--label <text>]
  gatewarden unregister --project <p> --branch <b>
  gatewarden list
  gatewarden status
  gatewarden config [--write]
  gatewarden setup
  gatewarden start
  gatewarden stop
  gatewarden doctor [--strict]
  gatewarden install-service
  gatewarden migrate [--dry-run]
  gatewarden version

Global options:
  --config <path>      configuration file (default: the XDG configuration directory)
  --state-dir <path>   state directory (default: the XDG state directory)
  --json               machine readable output (every command that reports)
  --version            print the version and exit

The lifecycle:
  start                start the daemon and wait for it
  stop                 stop the daemon
  doctor               the healthcheck: report where the installation stands
  install-service      install the daemon as a service, so it survives a reboot
  setup                walk a new installation through the six steps (optional)

The healthcheck:
  doctor               reports every check it made, with the reason for it
  doctor --strict      the warnings are errors as well (for a CI that wants
                       the whole installation to be complete)
  doctor --json        the same report as one JSON object

  A thing that is not there is not an error: a missing daemon, a missing
  zone, a proxy that does not answer and a service that is not installed
  are reported as warnings. Only a thing that is there and broken fails.

Environment:
  GATEWARDEN_HOME         everything in one directory
  GATEWARDEN_CONFIG       the configuration file
  GATEWARDEN_STATE_DIR    the state directory

  The old DEV_GATEWAY_* names still work, but they are deprecated.
`;
}

function resolveConfig(
  flags: Record<string, string | boolean>,
  opts: { migrate?: boolean } = {},
): { config: Config; configPath: string; paths: GatewayPaths } {
  const loaded = loadConfigWithReport({
    configPath: flagString(flags, 'config'),
    stateDir: flagString(flags, 'state-dir'),
    migrate: opts.migrate,
  });
  return { config: loaded.config, configPath: loaded.configPath, paths: loaded.paths };
}

/**
 * One route, in the shape the MCP tools use (§6.2).
 *
 * The shape lives in the core, so that the CLI, the MCP server and the pi
 * extension show the same route.
 */
export type { RouteJson } from '../core/status.ts';
export { routeJson };

async function commandRegister(flags: Record<string, string | boolean>): Promise<number> {
  const project = flagString(flags, 'project');
  const branch = flagString(flags, 'branch');
  const portRaw = flagString(flags, 'port');
  const label = flagString(flags, 'label');

  if (!project || !branch || !portRaw) {
    process.stderr.write('error: register needs --project, --branch and --port\n');
    return 2;
  }
  const devPort = Number(portRaw);
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
    process.stderr.write(`error: invalid --port "${portRaw}"\n`);
    return 2;
  }
  if (!slugify(project) || !slugify(branch)) {
    process.stderr.write('error: --project and --branch must contain at least one letter or digit\n');
    return 2;
  }

  const { config, configPath } = resolveConfig(flags);
  fs.mkdirSync(config.stateDir, { recursive: true });

  // The host names are built from the zone. An installation that has
  // none cannot name a route, and the error says how to get one instead
  // of registering a route with a trailing dot in its name.
  let zone: string;
  try {
    zone = requireZone(config);
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    return 1;
  }

  const started = await ensureDaemon(config, { configPath });
  if (started.error) {
    process.stderr.write(`error: ${started.error}\n`);
    return 1;
  }

  const store = new RegistrationStore(config.stateDir);
  // The write is a read-modify-write, and two agents may register at the
  // same time (D10): the lock keeps the second one from dropping the
  // route of the first.
  const registration = await withRouteLock(config.stateDir, () =>
    store.upsert({ project, branch, devPort, label, zone }),
  );
  const up = await isPortListening(devPort);

  if (wantsJson(flags)) {
    emitJson(routeJson(registration, up ? 'up' : 'down'));
    return 0;
  }

  process.stdout.write(
    `registered ${registration.fqdn} -> 127.0.0.1:${devPort}` +
      ` (${up ? 'dev server is up' : 'dev server is not listening yet'})\n`,
  );
  process.stdout.write(`url: https://${registration.fqdn}\n`);
  return 0;
}

async function commandUnregister(flags: Record<string, string | boolean>): Promise<number> {
  const project = flagString(flags, 'project');
  const branch = flagString(flags, 'branch');
  if (!project || !branch) {
    process.stderr.write('error: unregister needs --project and --branch\n');
    return 2;
  }

  const { config, configPath } = resolveConfig(flags);
  await ensureDaemon(config, { configPath });
  const store = new RegistrationStore(config.stateDir);
  const existing = store.findByProjectBranch(project, branch);
  const removed = await withRouteLock(config.stateDir, () => store.remove(project, branch));
  if (!removed) {
    process.stderr.write(`not registered: ${slugify(branch)}.${slugify(project)}.\n`);
    return 1;
  }

  if (wantsJson(flags)) {
    emitJson({ removed: true, fqdn: existing?.fqdn });
    return 0;
  }
  process.stdout.write(`unregistered ${slugify(branch)}.${slugify(project)}\n`);
  return 0;
}

async function commandList(flags: Record<string, string | boolean>): Promise<number> {
  const { config } = resolveConfig(flags);
  const store = new RegistrationStore(config.stateDir);
  const registrations = store.list();

  if (wantsJson(flags)) {
    const routes: RouteJson[] = [];
    for (const registration of registrations) {
      const up = await isPortListening(registration.devPort);
      routes.push(routeJson(registration, up ? 'up' : 'down'));
    }
    // `routes` is the shape the MCP tool uses (§6.2); `registrations` is
    // the raw state, for the scripts that read the store.
    emitJson({ routes, registrations });
    return 0;
  }

  if (registrations.length === 0) {
    process.stdout.write('no registrations\n');
    return 0;
  }

  const rows: string[] = [];
  for (const registration of registrations) {
    const up = await isPortListening(registration.devPort);
    rows.push(
      [
        registration.projectSlug,
        registration.branchSlug,
        registration.fqdn,
        String(registration.devPort),
        up ? 'up' : 'down',
        registration.updatedAt,
      ].join('\t'),
    );
  }
  process.stdout.write(['PROJECT\tBRANCH\tFQDN\tPORT\tSTATE\tUPDATED', ...rows].join('\n') + '\n');
  return 0;
}

/** The state of the daemon, in the shape the MCP tool uses (§6.2). */
export async function statusOf(
  config: Config,
  configPath: string,
  paths: GatewayPaths,
): Promise<Record<string, unknown>> {
  const proxy = await discoverProxyStatus(config.proxy);
  const status = await gatewayStatus(config, configPath, paths, proxy);
  const store = new RegistrationStore(config.stateDir);
  const registrations = store.list();

  return {
    // The four things the MCP tool `dev_gateway_status` returns (§6.2).
    ...status,
    // The keys the old CLI wrote, at the top level: a script written
    // against `gatewarden status --json` keeps reading them.
    configPath,
    stateDir: config.stateDir,
    logFile: paths.logFile,
    cacheDir: paths.cacheDir,
    registryPort: config.registryPort,
    relayPort: config.relayPort,
    advertisedIp: config.advertisedIp,
    zone: config.zone,
    entryPoints: config.entryPoints,
    certResolver: config.certResolver,
    secretConfigured: Boolean(config.secret),
    registrations: registrations.length,
    routes: registrations.length,
  };
}

async function commandStatus(flags: Record<string, string | boolean>): Promise<number> {
  // The status is a report, not a check: it has to run everywhere, on a
  // machine with an installation and on a machine without one. A
  // configuration file that cannot be read is reported, not thrown.
  let loaded: { config: Config; configPath: string; paths: GatewayPaths };
  try {
    loaded = resolveConfig(flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const configPath = resolveConfigPath({
      configPath: flagString(flags, 'config'),
    });
    const stateDir = resolveStateDir({ stateDir: flagString(flags, 'state-dir') });
    const paths = resolvePaths();
    const logFile = logFileFor(stateDir);
    if (wantsJson(flags)) {
      // The same shape as the form that works: a script that reads
      // `config.cacheDir` or `config.logFile` finds them in both.
      emitJson({
        daemon: { pid: null, healthy: false, running: false, pidFile: path.join(stateDir, 'daemon.pid') },
        proxy: { id: '', reachable: false },
        config: {
          path: configPath,
          exists: fs.existsSync(configPath),
          stateDir,
          logFile,
          cacheDir: paths.cacheDir,
          registryPort: 0,
          relayPort: 0,
          advertisedHost: '',
          advertisedIp: '',
          zone: '',
          entryPoints: [],
          certResolver: '',
          secretConfigured: false,
        },
        reachable: false,
        configPath,
        stateDir,
        logFile,
        cacheDir: paths.cacheDir,
        registryPort: 0,
        relayPort: 0,
        advertisedIp: '',
        zone: '',
        entryPoints: [],
        certResolver: '',
        secretConfigured: false,
        registrations: 0,
        routes: 0,
        error: message,
      });
      return 0;
    }
    process.stdout.write(`config file:  ${configPath} (cannot be read: ${message})\n`);
    return 0;
  }

  const { config, configPath, paths } = loaded;
  const status = await daemonStatus(config);
  const store = new RegistrationStore(config.stateDir);
  const registrations = store.list();

  if (wantsJson(flags)) {
    emitJson(await statusOf(config, configPath, paths));
    return 0;
  }

  process.stdout.write(
    [
      `daemon:       ${status.running ? (status.healthy ? 'running' : 'running, but not serving yet') : 'not running'} (pid ${status.pid ?? '-'})`,
      `pidfile:      ${status.pidFile}`,
      `logfile:      ${paths.logFile}`,
      `config file:  ${configPath}${fs.existsSync(configPath) ? '' : ' (missing, defaults are used)'}`,
      `state dir:    ${config.stateDir}`,
      `cache dir:    ${paths.cacheDir}`,
      `registry:     ${listenHost()}:${config.registryPort}`,
      `relay:        ${listenHost()}:${config.relayPort}`,
      `advertised:   ${config.advertisedHost || config.advertisedIp} (ip ${config.advertisedIp})`,
      `zone:         ${zoneOf(config) || '(not configured)'}`,
      `entryPoints:  ${config.entryPoints.join(', ')}`,
      `certResolver: ${config.certResolver || '(none)'}`,
      `secret:       ${config.secret ? 'configured' : 'not configured'}`,
      `registrations: ${registrations.length}`,
    ].join('\n') + '\n',
  );
  // The status never fails: it reports where the installation stands,
  // and a machine without an installation is not an error of the command.
  // A script that wants to know whether the gateway serves reads
  // `daemon.healthy` of the JSON form.
  return 0;
}

function commandConfig(flags: Record<string, string | boolean>): number {
  const { config, configPath } = resolveConfig(flags);
  if (flags['write']) {
    writeConfigFile(configPath, config);
    if (wantsJson(flags)) {
      emitJson({ path: configPath, written: true, config: configFileContent(config) });
      return 0;
    }
    process.stdout.write(`wrote ${configPath}\n`);
    return 0;
  }
  if (wantsJson(flags)) {
    emitJson({ path: configPath, config: configFileContent(config) });
    return 0;
  }
  process.stdout.write(`config file: ${configPath}\n`);
  for (const [key, description] of Object.entries(CONFIG_KEYS)) {
    const value = (config as unknown as Record<string, unknown>)[key];
    process.stdout.write(`  ${key} = ${JSON.stringify(value)}  # ${description}\n`);
  }
  return 0;
}

/**
 * Move the old layout (`~/.traefik-dev/`) to the new one (§3.4).
 *
 * The report says what moved and what stayed where it was. Nothing is ever
 * deleted: the old directory is left in place.
 */
function commandMigrate(flags: Record<string, string | boolean>): number {
  const dryRun = flags['dry-run'] === true;
  const { config, configPath, paths } = resolveConfig(flags, { migrate: false });
  const targetPaths = { ...paths, configFile: configPath };

  // The layout of the name the directories had before the rename is the
  // newer of the two old layouts, so it is migrated first: in a home
  // that holds both, its routes are the ones that belong in the active
  // store. The pre-package layout is migrated after it, and finds its
  // files in place already.
  //
  // The order is the one the first run uses (`loadConfigWithReport`),
  // so that the two paths move the same files to the same place.
  const oldNameReport = migrateLegacyAppLayout({
    paths: targetPaths,
    legacy: legacyAppLayout(legacyAppPaths()),
    config: configFileContent(config),
    dryRun,
  });
  // What the newer layout has claimed is spoken for: the older layout
  // must not claim the same target file. In a dry run the file is not
  // there yet, and the claim is the only thing that says so.
  const claimed = [oldNameReport.config?.to, oldNameReport.routes?.to].filter(
    (file): file is string => typeof file === 'string',
  );
  const report = migrateLegacyLayout({
    paths: targetPaths,
    legacyDir: legacyDir(),
    config: configFileContent(config),
    dryRun,
    claimed,
  });

  if (wantsJson(flags)) {
    emitJson({ ...report, oldName: oldNameReport });
    return 0;
  }

  const lines: string[] = [`old name layout:  ${oldNameReport.legacyDir}`];
  if (oldNameReport.config) {
    lines.push(`configuration:  ${oldNameReport.config.from} -> ${oldNameReport.config.to}`);
  }
  if (oldNameReport.routes) {
    lines.push(
      `routes:         ${oldNameReport.routes.from} -> ${oldNameReport.routes.to} (${oldNameReport.routes.count} routes)`,
    );
  }
  for (const file of oldNameReport.leftInPlace) lines.push(`left in place:  ${file}`);
  for (const note of oldNameReport.notes) lines.push(`note:           ${note}`);
  if (oldNameReport.migrated) {
    lines.push(dryRun ? 'dry run: nothing was moved' : 'the old name layout was migrated');
  } else {
    lines.push('nothing to migrate in the old name layout');
  }

  lines.push(`legacy layout:  ${report.legacyDir}`);
  if (report.config) lines.push(`configuration:  ${report.config.from} -> ${report.config.to}`);
  if (report.routes) {
    lines.push(`routes:         ${report.routes.from} -> ${report.routes.to} (${report.routes.count} routes)`);
  }
  for (const file of report.leftInPlace) lines.push(`left in place:  ${file}`);
  for (const note of report.notes) lines.push(`note:           ${note}`);
  if (report.migrated) {
    lines.push(dryRun ? 'dry run: nothing was moved' : 'the old layout was migrated');
  } else {
    lines.push('nothing to migrate');
  }

  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

/**
 * Start the daemon and wait for it (§5.1).
 *
 * The daemon is started detached, so it outlives the command.
 */
async function commandStart(flags: Record<string, string | boolean>): Promise<number> {
  const { config, configPath } = resolveConfig(flags);
  const before = await daemonStatus(config);
  if (before.running || before.healthy) {
    // The daemon of this installation is not started a second time. It
    // writes its pidfile before it binds its port, so it can be running
    // for a moment before it serves; a second daemon would fight for the
    // same port.
    const ready = await ensureDaemon(config, { configPath });
    if (ready.error) {
      if (wantsJson(flags)) {
        emitJson({ started: false, alreadyRunning: true, pid: before.pid, error: ready.error });
        return 1;
      }
      process.stderr.write(`error: ${ready.error}\n`);
      return 1;
    }
    // A gateway answers on the port, but this installation has no pidfile:
    // the daemon that answers is not this installation's daemon.
    const detail =
      before.pid === null
        ? `a gateway answers on port ${config.registryPort}, but it is not this installation's daemon: there is no pidfile`
        : before.healthy
          ? `the daemon is already running (pid ${before.pid})`
          : `the daemon is running (pid ${before.pid})`;
    if (wantsJson(flags)) {
      emitJson({
        started: false,
        alreadyRunning: true,
        pid: before.pid,
        detail,
        daemon: { running: true, pid: before.pid },
      });
      return 0;
    }
    process.stdout.write(`${detail}\n`);
    return 0;
  }

  const started = await ensureDaemon(config, { configPath });
  if (started.error) {
    if (wantsJson(flags)) {
      emitJson({ started: false, alreadyRunning: false, pid: null, error: started.error });
      return 1;
    }
    process.stderr.write(`error: ${started.error}\n`);
    return 1;
  }

  if (wantsJson(flags)) {
    emitJson({ started: true, alreadyRunning: false, pid: started.pid, daemon: { running: true, pid: started.pid } });
    return 0;
  }
  process.stdout.write(`started the daemon (pid ${started.pid})\n`);
  return 0;
}

/** Is the process alive? */
export { isProcessAlive, isGatewayDaemon } from '../core/daemonControl.ts';

/**
 * Stop the daemon (§5).
 *
 * The daemon removes its own pidfile when it stops. The command waits for
 * the process to be gone, and never stops a process that is not the
 * gateway's daemon.
 */
async function commandStop(flags: Record<string, string | boolean>): Promise<number> {
  const { config } = resolveConfig(flags);
  const result = await stopDaemon(config);

  if (!result.wasRunning) {
    if (wantsJson(flags)) {
      emitJson({ stopped: false, wasRunning: false, pid: null });
      return 0;
    }
    process.stdout.write('the daemon was not running\n');
    return 0;
  }

  if (!result.stopped) {
    const message = result.error ?? 'the daemon did not stop';
    if (wantsJson(flags)) {
      emitJson({ stopped: false, wasRunning: true, pid: result.pid, error: message });
      return 1;
    }
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }

  if (wantsJson(flags)) {
    emitJson({ stopped: true, wasRunning: true, pid: result.pid });
    return 0;
  }
  process.stdout.write(`stopped the daemon (pid ${result.pid})\n`);
  return 0;
}

/**
 * The healthcheck: `gatewarden doctor` (§9.9).
 *
 * The doctor reports where the installation stands. It fails only when
 * something is broken — never because the machine it runs on is a CI
 * runner without a proxy, a zone, a daemon or a public URL.
 */
async function commandDoctor(flags: Record<string, string | boolean>): Promise<number> {
  const strict = flags['strict'] === true;
  const report = await runHealthCheck({
    configPath: flagString(flags, 'config'),
    stateDir: flagString(flags, 'state-dir'),
  });
  const code = healthExitCode(report.checks, strict);

  if (wantsJson(flags)) {
    emitJson({ ok: report.ok, strict, checks: report.checks, paths: report.paths });
    return code;
  }

  for (const check of report.checks) {
    process.stdout.write(`${check.status.padEnd(8)}  ${check.name.padEnd(18)}  ${check.detail}\n`);
  }
  process.stdout.write(healthSummary(report.checks) + '\n');
  return code;
}

/**
 * Install the daemon as a service (§5.3).
 *
 * The unit is written first, and enabled after it. When the platform
 * refuses to enable it, the command says which command to run by hand.
 */
function commandInstallService(flags: Record<string, string | boolean>): number {
  const { config, configPath } = resolveConfig(flags);
  const result = installService({
    daemonPath: daemonLauncherPath(),
    configPath,
    stateDir: config.stateDir,
    enable: flags['no-enable'] !== true,
  });

  const payload = {
    platform: result.unit.platform,
    name: result.unit.name,
    path: result.unit.path,
    written: result.written,
    enabled: result.enabled,
    error: result.error,
    manualEnable: result.enabled ? undefined : manualEnableCommand(result.unit),
  };

  if (wantsJson(flags)) {
    emitJson(payload);
    return result.error ? 1 : 0;
  }

  if (result.unit.path) {
    process.stdout.write(`wrote ${result.unit.path}\n`);
  } else {
    process.stdout.write(`prepared the scheduled task ${result.unit.name}\n`);
  }
  if (result.enabled) {
    process.stdout.write('the service is enabled and running\n');
    return 0;
  }
  if (result.error) {
    process.stderr.write(`error: ${result.error}\n`);
    process.stderr.write(`enable it by hand: ${manualEnableCommand(result.unit)}\n`);
    return 1;
  }
  process.stdout.write(`the service was not enabled: ${manualEnableCommand(result.unit)}\n`);
  return 0;
}

/**
 * Walk a new installation through the six steps (§9).
 */
async function commandSetup(flags: Record<string, string | boolean>): Promise<number> {
  const { config, configPath, paths } = resolveConfig(flags);
  const json = wantsJson(flags);
  const interactive =
    flags['yes'] !== true &&
    flags['non-interactive'] !== true &&
    Boolean(process.stdin.isTTY) &&
    !json;

  let report: SetupReport;
  try {
    report = await runSetup({
      config,
      configPath,
      paths,
      cwd: process.cwd(),
      proxy: flagString(flags, 'proxy') ?? config.proxy,
      apiBaseUrl: flagString(flags, 'api-base-url'),
      interactive,
      verify: flags['no-verify'] !== true,
      pollIntervalMs: Number(flagString(flags, 'poll-interval') ?? 3000),
      promptTimeoutMs: Number(flagString(flags, 'prompt-timeout') ?? 30) * 1000,
      log: json ? () => {} : (line) => process.stdout.write(line + '\n'),
    });
  } catch (error) {
    // The wizard does not die with a stack trace: the user gets a line
    // that says what went wrong and where.
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      emitJson({ error: message });
      return 1;
    }
    process.stderr.write(`error: the setup did not finish: ${message}\n`);
    return 1;
  }

  // A failed verification is a failed setup: the exit code says so, in
  // every mode, so that a script can see it. A verification that could
  // not run — no proxy, no zone, no public URL to fetch — is `skipped`,
  // and a skipped verification is not a failure: the exit code is 0.
  const failed = report.verification.status === 'failed';
  if (json) {
    emitJson(report);
    return failed ? 1 : 0;
  }
  process.stdout.write(
    `verification: ${report.verification.status}${report.verification.reason ? ` — ${report.verification.reason}` : ''}\n`,
  );
  for (const step of report.nextSteps) process.stdout.write(`next: ${step}\n`);
  return failed ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  // The environment variables that were renamed still work. They say so
  // once, here, where the user can see it.
  for (const notice of deprecatedEnvNotices()) {
    process.stderr.write(`warning: ${notice}\n`);
  }
  if (flags['version'] === true || command === 'version') {
    process.stdout.write(`${packageVersion()}\n`);
    return 0;
  }
  switch (command) {
    case 'register':
      return commandRegister(flags);
    case 'unregister':
      return commandUnregister(flags);
    case 'list':
      return commandList(flags);
    case 'status':
      return commandStatus(flags);
    case 'config':
      return commandConfig(flags);
    case 'setup':
      return commandSetup(flags);
    case 'start':
      return commandStart(flags);
    case 'stop':
      return commandStop(flags);
    case 'doctor':
      return commandDoctor(flags);
    case 'install-service':
      return commandInstallService(flags);
    case 'migrate':
      return commandMigrate(flags);
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(usage());
      return 0;
    default:
      process.stderr.write(`error: unknown command "${command}"\n\n${usage()}`);
      return 2;
  }
}

/** Entry point used by bin/gatewarden.js. */
export async function run(): Promise<void> {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}

// Allow running this module directly as well as importing it.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void run();
}
