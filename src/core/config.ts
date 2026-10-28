/** Configuration loading for the registry, relay and CLI (D6, §3). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from './types.ts';
import {
  configFileOverride,
  homeOverride,
  legacyDir,
  logFileFor,
  resolvePaths,
  stateDirOverride,
  type GatewayPaths,
  type PathEnv,
  type PathOptions,
} from './paths.ts';
import { migrateLegacyLayout, type MigrationReport } from './migrate.ts';

export const DEFAULT_CONFIG: Config = {
  proxy: 'traefik',
  registryPort: 45002,
  relayPort: 45001,
  advertisedIp: '',
  advertisedHost: 'devbox',
  zone: 'home.malarstrom.com',
  entryPoints: ['websecure'],
  certResolver: 'cloudflare',
  tlsMode: 'wildcard',
  securityHeaders: false,
  compressMiddleware: false,
  middlewareProvider: 'file',
  allowedCidrs: ['172.16.2.0/24', '127.0.0.1/32', '::1/128'],
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
  advertisedIp: 'IP this container advertises to Traefik for the service URLs (default: first non-loopback IPv4).',
  advertisedHost:
    'Host name the Traefik container reaches this container under (Docker network "private"). Default: "devbox", the compose service name. Use the container IP if the name is not resolvable.',
  zone: 'DNS zone the FQDNs are built from.',
  entryPoints: 'Traefik entryPoint names the generated routers attach to.',
  certResolver: 'Name of the Traefik ACME certificate resolver (the user\'s is "cloudflare"; empty = no tls block).',
  tlsMode: 'Certificate granularity: "wildcard" = one certificate per project, "fqdn" = one certificate per branch.',
  securityHeaders:
    'Also apply the user\'s "default-security-headers" middleware to the dev routers (default false: frameDeny/stsPreload can break previews).',
  compressMiddleware: 'Also apply the user\'s "compress" middleware to the dev routers (default false).',
  middlewareProvider: 'Name of the Traefik provider that owns the shared middlewares ("file" in the user\'s setup).',
  allowedCidrs: 'CIDRs allowed to send the X-Dev-Target dispatch header to the relay.',
  secret: 'Optional shared secret, checked on the registry document and the relay dispatch.',
  stateDir: 'Directory holding the route store and the pidfile.',
  documentFormat: 'Format of the dynamic configuration document: yaml or json.',
  logMaxBytes: 'Rotate the log file when it grows past this size.',
  logKeep: 'How many rotated log files to keep.',
  autostart: 'Whether the daemon may be started by `postinstall` (D7).',
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
 * The order: an explicit path, `DEV_GATEWAY_HOME` (everything in one
 * directory), `DEV_GATEWAY_CONFIG`, the old `TRAEFIK_DEV_CONFIG`, and
 * finally the XDG configuration directory.
 *
 * `DEV_GATEWAY_HOME` wins over the configuration file override: it says
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
 * The order: an explicit path, `DEV_GATEWAY_STATE_DIR`, the old
 * `TRAEFIK_DEV_STATE_DIR`, `DEV_GATEWAY_HOME` (everything in one directory),
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
}

/**
 * Load the configuration.
 *
 * Precedence: built-in defaults < configuration file < explicit overrides.
 *
 * On the first run the old layout (`~/.traefik-dev/`) is picked up (§3.3):
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

  const stateDir = resolveStateDirFor(opts, env, paths, fileConfig.stateDir, legacyRaw?.['stateDir'], legacy);

  // Before the migration the new file does not exist; the old values are
  // what the configuration is built from.
  const source = Object.keys(fileConfig).length > 0 ? fileConfig : (legacyRaw as Partial<Config> | undefined) ?? {};

  const merged: Config = {
    ...DEFAULT_CONFIG,
    ...pickKnown(source),
    ...(opts.overrides ?? {}),
    stateDir,
  };

  if (!merged.advertisedIp) merged.advertisedIp = detectIpv4();
  if (!merged.advertisedHost) merged.advertisedHost = merged.advertisedIp;
  // A peer on the same Docker network may connect over IPv6; accept the
  // container's own IPv6 prefixes unless the user listed them already.
  for (const prefix of detectIpv6Prefixes()) {
    if (!merged.allowedCidrs.some((cidr) => cidr.toLowerCase() === prefix.toLowerCase())) {
      merged.allowedCidrs = [...merged.allowedCidrs, prefix];
    }
  }
  merged.registryPort = Number(merged.registryPort);
  merged.relayPort = Number(merged.relayPort);
  if (!Array.isArray(merged.entryPoints) || merged.entryPoints.length === 0) merged.entryPoints = ['websecure'];
  if (merged.documentFormat !== 'json') merged.documentFormat = 'yaml';

  // The first run: move the old layout to the new one (§3.3).
  let migration: MigrationReport | undefined;
  if (mayMigrate && (legacyRaw !== undefined || fs.existsSync(legacyRoutesFile))) {
    migration = migrateLegacyLayout({
      paths: {
        configFile: configPath,
        stateDir,
        logFile: logFileFor(stateDir, opts),
        cacheDir: paths.cacheDir,
      },
      legacyDir: legacy,
      config: configFileContent(merged),
    });
  }

  return {
    config: merged,
    configPath,
    paths: { configFile: configPath, stateDir, logFile: logFileFor(stateDir, opts), cacheDir: paths.cacheDir },
    migration,
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
  legacy: string,
): string {
  if (opts.stateDir) return path.resolve(opts.stateDir);
  if (environmentNamesStateDir(env, opts.platform ?? process.platform)) return paths.stateDir;
  for (const candidate of [fileStateDir, legacyStateDir]) {
    if (typeof candidate === 'string' && candidate.length > 0 && !isInside(legacy, candidate)) {
      return path.resolve(candidate);
    }
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

/**
 * The content of the configuration file: the known keys, in a stable order.
 *
 * The auto-detected IPv6 prefixes stay out of the file: they are derived at
 * runtime and would go stale.
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
    data[key] = value;
  }
  return data;
}

/** Write a config file with the current values (used by `traefik-dev config --write`). */
export function writeConfigFile(configPath: string, config: Config): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(configFileContent(config), null, 2) + '\n');
}
