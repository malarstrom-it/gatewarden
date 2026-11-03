/**
 * The shapes the agent-facing surfaces show.
 *
 * The CLI, the MCP server and the pi extension show the same thing in
 * three different ways: the same route, the same status. The shapes live
 * here, in the core, so that the three agree by construction instead of by
 * convention.
 *
 * The core knows no proxy: the caller says what the proxy answered,
 * and the core puts that answer in the report. The discovery itself lives
 * in the adapter catalog.
 */

import fs from 'node:fs';
import { daemonStatus } from './daemonControl.ts';
import type { GatewayPaths } from './paths.ts';
import type { Config, Registration } from './types.ts';

/** One route, in the shape the tools return. */
export interface RouteJson {
  project: string;
  branch: string;
  port: number;
  fqdn: string;
  url: string;
  state: 'up' | 'down';
}

/** The JSON shape of one route. */
export function routeJson(registration: Registration, state: 'up' | 'down'): RouteJson {
  return {
    project: registration.project,
    branch: registration.branch,
    port: registration.devPort,
    fqdn: registration.fqdn,
    url: `https://${registration.fqdn}`,
    state,
  };
}

/** What the proxy answered when it was asked. */
export interface ProxyStatus {
  /** The id of the proxy adapter that was asked. */
  id: string;
  /** Did the proxy answer at all? */
  reachable: boolean;
  /** The version the proxy reported, when it reported one. */
  version?: string;
  /**
   * Why the proxy does not answer, in one sentence.
   *
   * It is there when the cause is known: when the configuration file
   * names a proxy id the package does not know, for instance. The
   * status reports, so a reason is never an error.
   */
  reason?: string;
}

/**
 * The sentence the status carries about a proxy id that is not known.
 *
 * The core knows no proxy: the adapter catalog owns the wording of an
 * id it does not know, and the caller hands that wording over. The
 * status puts it in a sentence, so that a reader — a human at the
 * terminal, an agent reading the tool — learns why the proxy does not
 * answer, and not only that it does not.
 */
export function unknownProxyReasonSentence(catalogReason: string): string {
  return `The configuration file names a proxy the package does not know: ${catalogReason}.`;
}

/**
 * The status of the proxy, with the reason it does not answer.
 *
 * The caller asks the proxy, through the adapter catalog, and hands
 * the answer over. When the configuration file names an id the
 * catalog does not know, the caller hands over the reason the catalog
 * gave, and the status carries it.
 *
 * The reason is a report, never an error: the status says where the
 * installation stands, and it does not fail because of it.
 */
export function withProxyReason(status: ProxyStatus, catalogReason: string | null): ProxyStatus {
  if (!catalogReason) return status;
  return { ...status, reason: unknownProxyReasonSentence(catalogReason) };
}

/** The daemon, in the shape the tools return. */
export interface DaemonStatusJson {
  pid: number | null;
  healthy: boolean;
  running: boolean;
  pidFile: string;
  /** The reason the daemon is not serving, when it is not. */
  error?: string;
}

/** The configuration, in the shape the tools return. */
export interface ConfigStatusJson {
  path: string;
  exists: boolean;
  stateDir: string;
  logFile: string;
  cacheDir: string;
  registryPort: number;
  relayPort: number;
  advertisedHost: string;
  advertisedIp: string;
  zone: string;
  entryPoints: string[];
  certResolver: string;
  secretConfigured: boolean;
}

/** The state of the gateway: the four things `dev_gateway_status` returns. */
export interface GatewayStatus {
  daemon: DaemonStatusJson;
  proxy: ProxyStatus;
  config: ConfigStatusJson;
  reachable: boolean;
}

/**
 * The state of the gateway.
 *
 * The proxy is passed in: the core does not know how to ask a proxy
 * anything, and the caller that does know is the one that answers.
 */
export async function gatewayStatus(
  config: Config,
  configPath: string,
  paths: GatewayPaths,
  proxy: ProxyStatus,
): Promise<GatewayStatus> {
  const status = await daemonStatus(config);

  return {
    daemon: {
      pid: status.pid,
      healthy: status.healthy,
      running: status.running,
      pidFile: status.pidFile,
    },
    proxy,
    config: {
      path: configPath,
      exists: fs.existsSync(configPath),
      stateDir: config.stateDir,
      logFile: paths.logFile,
      cacheDir: paths.cacheDir,
      registryPort: config.registryPort,
      relayPort: config.relayPort,
      advertisedHost: config.advertisedHost,
      advertisedIp: config.advertisedIp,
      zone: config.zone,
      entryPoints: config.entryPoints,
      certResolver: config.certResolver,
      secretConfigured: Boolean(config.secret),
    },
    reachable: status.healthy,
  };
}
