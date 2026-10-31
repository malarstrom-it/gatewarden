/** Configuration loading for the registry, relay and CLI (D6, §3). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from './types.ts';
import {
  configFileOverride,
  homeOverride,
  legacyAppPaths,
  legacyDir,
  logFileFor,
  resolvePaths,
  stateDirOverride,
  type GatewayPaths,
  type PathEnv,
  type PathOptions,
} from './paths.ts';
import {
  legacyAppLayout,
  migrateLegacyAppLayout,
  migrateLegacyLayout,
  type LegacyAppMigrationReport,
  type MigrationReport,
} from './migrate.ts';

/**
 * The built-in defaults.
 *
 * They are neutral: not one value of one installation is in here (§3.2).
 * The values that name somebody's own setup — the DNS zone, the
 * certificate resolver, the provider of the shared middlewares and the
 * host name the proxy reaches this machine under — are empty, and the
 * setup wizard derives them or asks for them (§9.2).
 *
 * What is left is what the package itself decides: the adapter, the
 * ports, the entry point name Traefik uses by convention, the log
 * rotation and the loopback addresses, which are the loopback addresses
 * of every machine.
 */
export const DEFAULT_CONFIG: Config = {
  proxy: 'traefik',
  registryPort: 45002,
  relayPort: 45001,
  advertisedIp: '',
  advertisedHost: '',
  zone: '',
  entryPoints: ['websecure'],
  certResolver: '',
  tlsMode: 'wildcard',
  securityHeaders: false,
  compressMiddleware: false,
  middlewareProvider: '',
  allowedCidrs: ['127.0.0.1/32', '::1/128'],
  secret: '',
  stateDir: '',
  documentFormat: 'yaml',
  logMaxBytes: 5 * 1024 * 1024,
  logKeep: 3,
  autostart: true,
};

/** Every key a user may set, with a one line explanation (used by `traefik-dev config`). */
export const CONFIG_KEYS: Record<string, string> = {
  proxy: 'Which proxy adapter writes the dynamic configuration ("traefik").',
  registryPort: 'Port the registry listener binds on 0.0.0.0 (the dynamic configuration document).',
  relayPort: 'Port the relay listener binds on 0.0.0.0 (dispatches to 127.0.0.1:<devPort>).',
  advertisedIp: 'IP this machine advertises to the proxy for the service URLs (empty = the first non-loopback IPv4).',
  advertisedHost:
    'Host name the proxy reaches this machine under (empty = the advertised IP). Use a name that the proxy can resolve.',
  zone: 'DNS zone the FQDNs are built from (empty until the setup wizard derives or asks for it).',
  entryPoints: 'Traefik entryPoint names the generated routers attach to.',
  certResolver: 'Name of the Traefik ACME certificate resolver (empty = no tls block).',
  tlsMode: 'Certificate granularity: "wildcard" = one certificate per project, "fqdn" = one certificate per branch.',
  securityHeaders:
    'Also apply the "default-security-headers" middleware of the shared middlewares to the dev routers (default false: frameDeny/stsPreload can break previews).',
  compressMiddleware: 'Also apply the "compress" middleware of the shared middlewares to the dev routers (default false).',
  middlewareProvider: 'Name of the Traefik provider that owns the shared middlewares (empty = the shared middlewares are not used).',
  allowedCidrs: 'CIDRs allowed to send the X-Dev-Target dispatch header to the relay.',
  secret: 'Optional shared secret, checked on the registry document and the relay dispatch.',
  stateDir: 'Directory holding the route store and the pidfile.',
  documentFormat: 'Format of the dynamic configuration document: yaml or json.',
  logMaxBytes: 'Rotate the log file when it grows past this size.',
  logKeep: 'How many rotated log files to keep.',
  autostart:
    'Kept for compatibility: the install starts no daemon (D7). The daemon starts itself when a command needs it.',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Derive this container's advertised IP from the network interfaces. */
export function detectIpv4(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      candidates.push(info.address);
    }
  }
  // Prefer a private (RFC 1918) address: this container lives on a Docker network.
  const priv = candidates.find((a) => a.startsWith('10.') || a.startsWith('172.') || a.startsWith('192.168.'));
  return priv ?? candidates[0] ?? '127.0.0.1';
}

/**
 * Derive the IPv6 prefixes of this container's own networks (`/64`), so that a
 * peer on the same Docker network is accepted when it connects over IPv6.
 */
export function detectIpv6Prefixes(): string[] {
  const prefixes = new Set<string>();
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv6' || info.internal) continue;
      const address = info.address.toLowerCase();
      if (address.startsWith('fe80:')) continue; // link local
      const groups = address.split(':');
      if (groups.length < 4) continue;
      prefixes.add(`${groups.slice(0, 4).join(':')}::/64`);
    }
  }
  return [...prefixes];
}

/** The address the listeners bind to: dual stack when IPv6 is available. */
export function listenHost(): string {
  return detectIpv6Prefixes().length > 0 ? '::' : '0.0.0.0';
}

export interface ConfigPathOptions extends PathOptions {
  /** An explicit configuration file (the `--config` flag). */
  configPath?: string;
}

/**
 * Resolve the configuration file (§3.1).
 *
 * The order: an explicit path, `GATEWARDEN_HOME` (everything in one
 * directory), `GATEWARDEN_CONFIG`, the old `TRAEFIK_DEV_CONFIG`, and
 * finally the XDG configuration directory.
 *
 * `GATEWARDEN_HOME` wins over the configuration file override: it says
 * that everything lives in one directory, and the configuration file is in
 * it.
 */
export function resolveConfigPath(opts: ConfigPathOptions = {}): string {
  if (opts.configPath) return path.resolve(opts.configPath);
  const env = opts.env ?? process.env;
  const home = homeOverride(env);
  if (home) return path.join(path.resolve(home), 'config.json');
  const override = configFileOverride(env);
  if (override) return path.resolve(override);
  return resolvePaths(opts).configFile;
}

/**
 * The configuration file named on the command line.
 *
 * The daemon and its workers get the file the CLI resolved, so that they
 * read the same configuration as the process that started them — even when
 * the environment names another one.
 */
export function configPathFromArgv(argv: string[]): string | undefined {
  const index = argv.indexOf('--config');
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return path.resolve(value);
}

export interface StateDirOptions extends PathOptions {
  /** An explicit state directory (the `--state-dir` flag). */
  stateDir?: string;
}

/**
 * Resolve the state directory (§3.1).
 *
 * The order: an explicit path, `GATEWARDEN_STATE_DIR`, the old
 * `TRAEFIK_DEV_STATE_DIR`, `GATEWARDEN_HOME` (everything in one directory),
 * and finally the XDG state directory.
 */
export function resolveStateDir(opts: StateDirOptions = {}): string {
  if (opts.stateDir) return path.resolve(opts.stateDir);
  return resolvePaths(opts).stateDir;
}

/** The state directory of the platform the process runs on. */
export function defaultStateDir(): string {
  return resolvePaths().stateDir;
}

/** Read a JSON object from a file. Returns `undefined` when there is none. */
function readJsonObject(file: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlainObject(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Is `file` the directory `dir` itself, or inside it? */
function isInside(dir: string, file: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export interface LoadConfigOptions extends PathOptions {
  /** An explicit configuration file (the `--config` flag). */
  configPath?: string;
  /** An explicit state directory (the `--state-dir` flag). */
  stateDir?: string;
  /** Values that win over the file. */
  overrides?: Partial<Config>;
  /** Set to false to leave the old layout alone. */
  migrate?: boolean;
}

export interface LoadedConfig {
  config: Config;
  configPath: string;
  paths: GatewayPaths;
  /** What the migration from the old layout did, when it ran. */
  migration?: MigrationReport;
  /** What the migration from the layout of the old name did, when it ran. */
  oldNameMigration?: LegacyAppMigrationReport;
}

/**
 * Load the configuration.
 *
 * Precedence: built-in defaults < configuration file < explicit overrides.
 *
 * On the first run the old layout (`~/.traefik-dev/`) is picked up (§3.4):
 * when the new configuration file does not exist and the old one does, the
 * old values become the new configuration and the old route store is
 * imported. The old directory is left in place.
 */
export function loadConfig(opts: LoadConfigOptions = {}): Config {
  return loadConfigWithReport(opts).config;
}

/** Load the configuration, and report what the migration did. */
export function loadConfigWithReport(opts: LoadConfigOptions = {}): LoadedConfig {
  const env = opts.env ?? process.env;
  const paths = resolvePaths(opts);
  const configPath = resolveConfigPath(opts);

  const legacy = legacyDir(opts);
  const legacyConfigFile = path.join(legacy, 'config.json');
  const legacyRoutesFile = path.join(legacy, 'registrations.json');
  // The old layout is only read when the new configuration file is the one
  // that would be written; an explicit `--config` means the user chose.
  const useLegacy = !opts.configPath && !fs.existsSync(configPath);
  const legacyRaw = useLegacy && fs.existsSync(legacyConfigFile) ? readJsonObject(legacyConfigFile) : undefined;
  const mayMigrate = opts.migrate !== false && useLegacy;

  // The layout of the name the directories had before the rename. It is
  // read the same way as the pre-package layout: only when the new
  // configuration file does not exist yet.
  const oldName = legacyAppLayout(legacyAppPaths(opts));
  const oldNameRaw =
    useLegacy && fs.existsSync(oldName.configFile) ? readJsonObject(oldName.configFile) : undefined;

  let fileConfig: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!isPlainObject(raw)) throw new Error('the file does not hold a JSON object');
      fileConfig = raw as Partial<Config>;
    } catch (error) {
      throw new Error(`invalid config file ${configPath}: ${(error as Error).message}`);
    }
  }

  const stateDir = resolveStateDirFor(
    opts,
    env,
    paths,
    fileConfig.stateDir,
    legacyRaw?.['stateDir'],
    [legacy, oldName.stateDir],
  );

  // Before the migration the new file does not exist; the old values are
  // what the configuration is built from. The layout of the old name is
  // the newer of the two: an installation that was made under that name
  // is the one that came last.
  const source =
    Object.keys(fileConfig).length > 0
      ? fileConfig
      : ((oldNameRaw as Partial<Config> | undefined) ??
        (legacyRaw as Partial<Config> | undefined) ??
        {});

  const merged: Config = normaliseConfig({
    ...DEFAULT_CONFIG,
    ...pickKnown(source),
    ...(opts.overrides ?? {}),
    stateDir,
  });

  if (!merged.advertisedIp) merged.advertisedIp = detectIpv4();
  if (!merged.advertisedHost) merged.advertisedHost = merged.advertisedIp;
  // A peer on the same Docker network may connect over IPv6; accept the
  // container's own IPv6 prefixes unless the user listed them already.
  for (const prefix of detectIpv6Prefixes()) {
    if (!merged.allowedCidrs.some((cidr) => cidr.toLowerCase() === prefix.toLowerCase())) {
      merged.allowedCidrs = [...merged.allowedCidrs, prefix];
    }
  }

  const targetPaths: GatewayPaths = {
    configFile: configPath,
    stateDir,
    logFile: logFileFor(stateDir, opts),
    cacheDir: paths.cacheDir,
  };

  // The first run: move the old layouts to the new one (§3.4). The
  // layout of the old name comes first: it is the newer of the two, and
  // the one that wins when both hold something.
  let oldNameMigration: LegacyAppMigrationReport | undefined;
  if (mayMigrate && (oldNameRaw !== undefined || fs.existsSync(oldName.routesFile))) {
    oldNameMigration = migrateLegacyAppLayout({
      paths: targetPaths,
      legacy: oldName,
      config: configFileContent(merged),
    });
  }

  let migration: MigrationReport | undefined;
  if (mayMigrate && (legacyRaw !== undefined || fs.existsSync(legacyRoutesFile))) {
    migration = migrateLegacyLayout({
      paths: targetPaths,
      legacyDir: legacy,
      config: configFileContent(merged),
    });
  }

  return {
    config: merged,
    configPath,
    paths: targetPaths,
    migration,
    oldNameMigration,
  };
}

/**
 * The state directory the configuration runs with.
 *
 * A state directory that a configuration file names is kept, unless it is
 * the old directory itself: the route store moves out of it.
 *
 * The environment wins over the file. The file may hold a state directory
 * that was resolved once, on another machine or under another home; an
 * environment variable that names the state directory is a decision of the
 * moment, and it is the one that counts.
 */
function resolveStateDirFor(
  opts: LoadConfigOptions,
  env: PathEnv,
  paths: GatewayPaths,
  fileStateDir: string | undefined,
  legacyStateDir: unknown,
  excluded: string[],
): string {
  if (opts.stateDir) return path.resolve(opts.stateDir);
  if (environmentNamesStateDir(env, opts.platform ?? process.platform)) return paths.stateDir;
  for (const candidate of [fileStateDir, legacyStateDir]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    // A state directory inside one of the old layouts is not kept: the
    // route store moves out of it.
    if (excluded.some((dir) => isInside(dir, candidate))) continue;
    return path.resolve(candidate);
  }
  return paths.stateDir;
}

/**
 * Does the environment name the state directory?
 *
 * `XDG_STATE_HOME` is such a name on Linux, the platform where XDG rules.
 * On macOS and Windows the platform has a state directory of its own and
 * ignores the variable, so the configuration file may still name one.
 */
function environmentNamesStateDir(env: PathEnv, platform: NodeJS.Platform): boolean {
  if (stateDirOverride(env) || homeOverride(env)) return true;
  if (platform !== 'linux') return false;
  const xdg = env['XDG_STATE_HOME'];
  return typeof xdg === 'string' && xdg.length > 0;
}

function pickKnown(fileConfig: Partial<Config>): Partial<Config> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (fileConfig[key as keyof Config] !== undefined) out[key] = fileConfig[key as keyof Config];
  }
  return out as Partial<Config>;
}

/** Is the value a string? */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Is the value a boolean? */
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * The value of a number, or the fallback.
 *
 * A number in the file may be written as a string ("45002"): it is read
 * as the number it names. A value that is not a number at all is not a
 * value: the built-in default is used instead.
 */
function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * The strings of a list, or the fallback when the value is not a list.
 *
 * An empty list is a list: the trust list may be empty on purpose, and
 * the fallback is only for a value that is not a list at all.
 */
function stringListOr(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The configuration, with every value of the type its key needs.
 *
 * The configuration file is written by hand as often as by the wizard,
 * and a hand-written file may hold anything: a number where a string
 * belongs, a null where a list belongs. A value of the wrong type is not
 * a value: the built-in default is used instead. A file like that is
 * wrong, but it cannot crash the process.
 */
export function normaliseConfig(config: Config): Config {
  const entryPoints = stringListOr(config.entryPoints, DEFAULT_CONFIG.entryPoints);
  return {
    ...config,
    proxy: isString(config.proxy) ? config.proxy : DEFAULT_CONFIG.proxy,
    registryPort: numberOr(config.registryPort, DEFAULT_CONFIG.registryPort),
    relayPort: numberOr(config.relayPort, DEFAULT_CONFIG.relayPort),
    advertisedIp: isString(config.advertisedIp) ? config.advertisedIp : DEFAULT_CONFIG.advertisedIp,
    advertisedHost: isString(config.advertisedHost) ? config.advertisedHost : DEFAULT_CONFIG.advertisedHost,
    zone: isString(config.zone) ? config.zone : DEFAULT_CONFIG.zone,
    entryPoints: entryPoints.length > 0 ? entryPoints : [...DEFAULT_CONFIG.entryPoints],
    certResolver: isString(config.certResolver) ? config.certResolver : DEFAULT_CONFIG.certResolver,
    tlsMode: config.tlsMode === 'fqdn' ? 'fqdn' : DEFAULT_CONFIG.tlsMode,
    securityHeaders: isBoolean(config.securityHeaders) ? config.securityHeaders : DEFAULT_CONFIG.securityHeaders,
    compressMiddleware: isBoolean(config.compressMiddleware)
      ? config.compressMiddleware
      : DEFAULT_CONFIG.compressMiddleware,
    middlewareProvider: isString(config.middlewareProvider)
      ? config.middlewareProvider
      : DEFAULT_CONFIG.middlewareProvider,
    allowedCidrs: stringListOr(config.allowedCidrs, DEFAULT_CONFIG.allowedCidrs),
    secret: isString(config.secret) ? config.secret : DEFAULT_CONFIG.secret,
    stateDir: isString(config.stateDir) ? config.stateDir : DEFAULT_CONFIG.stateDir,
    documentFormat: config.documentFormat === 'json' ? 'json' : DEFAULT_CONFIG.documentFormat,
    logMaxBytes: numberOr(config.logMaxBytes, DEFAULT_CONFIG.logMaxBytes),
    logKeep: numberOr(config.logKeep, DEFAULT_CONFIG.logKeep),
    autostart: isBoolean(config.autostart) ? config.autostart : DEFAULT_CONFIG.autostart,
  };
}

/**
 * The DNS zone of the installation, as a string.
 *
 * The configuration file is written by hand as often as by the wizard, and
 * a hand-written file may hold a zone that is not a string. Such a zone is
 * no zone: the value is empty, and the code that needs a zone says that it
 * has none instead of failing on the type.
 */
export function zoneOf(config: Pick<Config, 'zone'>): string {
  return isString(config.zone) ? config.zone.trim() : '';
}

/**
 * The DNS zone of the installation.
 *
 * The host names of the routes are built from the zone, so an
 * installation that has none cannot name a route. The error says how to
 * get one instead of building a host name with a trailing dot.
 */
export function requireZone(config: Pick<Config, 'zone'>): string {
  const zone = zoneOf(config);
  if (!zone) {
    throw new Error('no DNS zone is configured: run "gatewarden setup" to derive one, or write it in the configuration file');
  }
  return zone;
}

/**
 * The content of the configuration file: the known keys, in a stable order.
 *
 * The values that are derived at runtime stay out of the file: the
 * auto-detected IPv6 prefixes, the address of this machine and the host
 * name that is the address. They are derived again on every run, and a
 * file that pins the address of the moment it was written keeps
 * advertising an address the machine does not have any more. An empty
 * value means "derived", the same way an empty zone means "not set yet".
 */
export function configFileContent(config: Config): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const value = (config as unknown as Record<string, unknown>)[key];
    if (key === 'allowedCidrs' && Array.isArray(value)) {
      data[key] = value.filter(
        (cidr) => !String(cidr).includes(':') || DEFAULT_CONFIG.allowedCidrs.includes(String(cidr)),
      );
      continue;
    }
    // The address of this machine is detected, and the host name that is
    // the address is derived from it.
    if (key === 'advertisedIp' && value === detectIpv4()) {
      data[key] = '';
      continue;
    }
    if (key === 'advertisedHost' && value === config.advertisedIp) {
      data[key] = '';
      continue;
    }
    data[key] = value;
  }
  return data;
}

/**
 * Write a config file with the current values (used by `traefik-dev config --write`).
 *
 * The keys in `opts.omit` are left out: the setup wizard does not write
 * the values nobody confirmed when they are the built-in default, so that
 * a new installation does not get the zone of another project.
 */
export function writeConfigFile(configPath: string, config: Config, opts: { omit?: string[] } = {}): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const content = configFileContent(config);
  for (const key of opts.omit ?? []) delete content[key];
  fs.writeFileSync(configPath, JSON.stringify(content, null, 2) + '\n');
}
