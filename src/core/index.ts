/**
 * The public surface of the package (`exports` in the manifest).
 *
 * The package ships the compiled core under `dist/`, and this module is
 * what an importer gets:
 *
 *   import { loadConfig, RegistrationStore } from '@malarstrom/gatewarden';
 *
 * Everything here is proxy-agnostic: the core knows about routes,
 * ports, host names and reachability, and about the configuration and the
 * state that hold them. The Traefik adapter is one implementation of the
 * `ProxyAdapter` contract, and it lives outside the core — the core does
 * not import an adapter, not even here. The adapters are reachable under
 * their own export path, `@malarstrom/gatewarden/adapters`.
 *
 * The adapters over the core — the MCP server, the pi extension, the CLI
 * and the skill — are not exported here: they are entry points of their
 * own, and they are what the binaries in `bin/` run.
 */

export {
  APP_NAME,
  LEGACY_DIR_NAME,
  envPathsDirs,
  homeOverride,
  configFileOverride,
  stateDirOverride,
  logFileFor,
  platformDirs,
  resolvePaths,
  legacyDir,
  type GatewayPaths,
  type PathOptions,
  type PathEnv,
  type PlatformDirs,
} from './paths.ts';

export {
  CONFIG_KEYS,
  DEFAULT_CONFIG,
  configFileContent,
  configPathFromArgv,
  defaultStateDir,
  detectIpv4,
  detectIpv6Prefixes,
  listenHost,
  loadConfig,
  loadConfigWithReport,
  resolveConfigPath,
  resolveStateDir,
  normaliseConfig,
  requireZone,
  zoneOf,
  writeConfigFile,
  type LoadedConfig,
} from './config.ts';

export {
  LEGACY_ROUTES_FILE,
  ROUTES_FILE,
  RegistrationStore,
  type UpsertInput,
} from './state.ts';

export { withRouteLock, ROUTES_LOCK_FILE, type LockOptions } from './lock.ts';

export { PROBE_TTL_MS, PROBE_TIMEOUT_MS, RouteProbe } from './probe.ts';

export {
  gatewayStatus,
  routeJson,
  type ConfigStatusJson,
  type DaemonStatusJson,
  type GatewayStatus,
  type ProxyStatus,
  type RouteJson,
} from './status.ts';

export type { DiscoverOptions, ProxyAdapter, ProxyInfo } from './proxy.ts';

export type {
  Config,
  DocumentFormat,
  Registration,
  Route,
} from './types.ts';
