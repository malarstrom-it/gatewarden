/** Configuration loading for the registry, relay and CLI. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from './types.ts';

export const DEFAULT_STATE_DIR = path.join(os.homedir(), '.traefik-dev');

export const DEFAULT_CONFIG: Config = {
  registryPort: 45002,
  relayPort: 45001,
  advertisedIp: '',
  advertisedHost: '',
  zone: 'home.malarstrom.com',
  indexHost: 'index.home.malarstrom.com',
  entryPoints: ['websecure'],
  certResolver: 'cloudflare',
  tlsMode: 'wildcard',
  securityHeaders: false,
  compressMiddleware: false,
  middlewareProvider: 'file',
  allowedCidrs: ['172.16.2.0/24', '127.0.0.1/32', '::1/128'],
  secret: '',
  stateDir: DEFAULT_STATE_DIR,
  documentFormat: 'yaml',
  logMaxBytes: 5 * 1024 * 1024,
  logKeep: 3,
};

/** Every key a user may set, with a one line explanation (used by `traefik-dev config`). */
export const CONFIG_KEYS: Record<string, string> = {
  registryPort: 'Port the registry listener binds on 0.0.0.0 (dynamic configuration document + index).',
  relayPort: 'Port the relay listener binds on 0.0.0.0 (dispatches to 127.0.0.1:<devPort>).',
  advertisedIp: 'IP this container advertises to Traefik for the service URLs (default: first non-loopback IPv4).',
  advertisedHost:
    'Host name or IP the Traefik container reaches this container under (Docker network "private"). Default: advertisedIp. A stable container name is preferred.',
  zone: 'DNS zone the FQDNs are built from.',
  indexHost: 'Host name of the index router (the "what is running" page).',
  entryPoints: 'Traefik entryPoint names the generated routers attach to.',
  certResolver: 'Name of the Traefik ACME certificate resolver (the user\'s is "cloudflare"; empty = no tls block).',
  tlsMode: 'Certificate granularity: "wildcard" = one certificate per project, "fqdn" = one certificate per branch.',
  securityHeaders:
    'Also apply the user\'s "default-security-headers" middleware to the dev routers (default false: frameDeny/stsPreload can break previews).',
  compressMiddleware: 'Also apply the user\'s "compress" middleware to the dev routers (default false).',
  middlewareProvider: 'Name of the Traefik provider that owns the shared middlewares ("file" in the user\'s setup).',
  allowedCidrs: 'CIDRs allowed to send the X-Dev-Target dispatch header to the relay.',
  secret: 'Optional shared secret, checked on the registry document and the relay dispatch.',
  stateDir: 'Directory holding registrations, pidfile and logs.',
  documentFormat: 'Format of the dynamic configuration document: yaml or json.',
  logMaxBytes: 'Rotate the log file when it grows past this size.',
  logKeep: 'How many rotated log files to keep.',
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

/** Resolve the config file path. */
export function resolveConfigPath(opts: { configPath?: string; stateDir?: string } = {}): string {
  if (opts.configPath) return path.resolve(opts.configPath);
  const fromEnv = process.env['TRAEFIK_DEV_CONFIG'];
  if (fromEnv) return path.resolve(fromEnv);
  const stateDir = opts.stateDir ?? process.env['TRAEFIK_DEV_STATE_DIR'] ?? DEFAULT_STATE_DIR;
  return path.join(stateDir, 'config.json');
}

/** Resolve the state directory. */
export function resolveStateDir(opts: { stateDir?: string } = {}): string {
  if (opts.stateDir) return path.resolve(opts.stateDir);
  const fromEnv = process.env['TRAEFIK_DEV_STATE_DIR'];
  if (fromEnv) return path.resolve(fromEnv);
  return DEFAULT_STATE_DIR;
}

/**
 * Load the configuration.
 *
 * Precedence: built-in defaults < config file < explicit overrides.
 */
export function loadConfig(opts: { configPath?: string; stateDir?: string; overrides?: Partial<Config> } = {}): Config {
  const stateDir = resolveStateDir(opts);
  const configPath = resolveConfigPath({ ...opts, stateDir });
  let fileConfig: Partial<Config> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (isPlainObject(raw)) fileConfig = raw as Partial<Config>;
    } catch (error) {
      throw new Error(`invalid config file ${configPath}: ${(error as Error).message}`);
    }
  }

  const merged: Config = {
    ...DEFAULT_CONFIG,
    ...pickKnown(fileConfig),
    ...(opts.overrides ?? {}),
    stateDir,
  };

  // The state directory may come from the file itself.
  if (!opts.stateDir && !process.env['TRAEFIK_DEV_STATE_DIR'] && fileConfig.stateDir) {
    merged.stateDir = path.resolve(fileConfig.stateDir);
  }

  if (!merged.advertisedIp) merged.advertisedIp = detectIpv4();
  if (!merged.advertisedHost) merged.advertisedHost = merged.advertisedIp;
  merged.registryPort = Number(merged.registryPort);
  merged.relayPort = Number(merged.relayPort);
  if (!Array.isArray(merged.entryPoints) || merged.entryPoints.length === 0) merged.entryPoints = ['websecure'];
  if (merged.documentFormat !== 'json') merged.documentFormat = 'yaml';
  return merged;
}

function pickKnown(fileConfig: Partial<Config>): Partial<Config> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (fileConfig[key as keyof Config] !== undefined) out[key] = fileConfig[key as keyof Config];
  }
  return out as Partial<Config>;
}

/** Write a config file with the current values (used by `traefik-dev config --write`). */
export function writeConfigFile(configPath: string, config: Config): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    data[key] = (config as unknown as Record<string, unknown>)[key];
  }
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}
