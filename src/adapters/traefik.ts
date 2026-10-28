/**
 * The Traefik adapter: renders the dynamic configuration document Traefik
 * polls (D3, §4.2).
 *
 * One route produces exactly one router, one service and one middleware.
 * Adding or removing a route touches only its own three objects, so routes
 * are atomic with respect to each other.
 *
 * Everything Traefik-shaped lives here: the routers, the services, the
 * middlewares, the TLS blocks and the names they get. The core knows none
 * of it — it hands the adapter the routes and the configuration and serves
 * what comes back.
 */

import { createHash } from 'node:crypto';
import type { Config, Route } from '../core/types.ts';
import { DISPATCH_HEADER, RELAY_SECRET_HEADER } from '../core/protocol.ts';
import { toYaml } from '../core/util/yaml.ts';
import type { DiscoverOptions, ProxyAdapter, ProxyInfo } from './types.ts';

/** Prefix of every router and service this registry serves (avoids collisions with other providers). */
export const NAME_PREFIX = 'dev-';
/** Prefix of every dispatch middleware this registry serves. */
export const MIDDLEWARE_PREFIX = 'devhdr-';

/** Deterministic, collision-resistant object name for a registration (router and service). */
export function objectName(registration: Route): string {
  const hash = createHash('sha1').update(registration.id).digest('hex').slice(0, 6);
  return `${NAME_PREFIX}${registration.projectSlug}-${registration.branchSlug}-${hash}`;
}

/** Object name of the dispatch middleware of a registration. */
export function middlewareName(registration: Route): string {
  const hash = createHash('sha1').update(registration.id).digest('hex').slice(0, 6);
  return `${MIDDLEWARE_PREFIX}${registration.projectSlug}-${registration.branchSlug}-${hash}`;
}

/** Exact-Host rule for a registration. */
export function hostRule(fqdn: string): string {
  return `Host(\`${fqdn}\`)`;
}

/** Wildcard certificate domain for a project (one certificate per project). */
export function projectWildcard(registration: Route, zone: string): string {
  return `*.${registration.projectSlug}.${zone}`;
}

export interface DynamicConfig {
  /**
   * The HTTP section.
   *
   * It is absent from a document that holds nothing at all: a section
   * without entries is omitted, never rendered as an empty map.
   */
  http?: {
    routers: Record<string, unknown>;
    services: Record<string, unknown>;
    middlewares: Record<string, unknown>;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Remove every key whose value is an empty map.
 *
 * Traefik decodes the document with paerser, and an empty map is rejected:
 * "middlewares cannot be a standalone element (type map[string]*dynamic.Middleware)"
 * — a section without entries must be omitted, not rendered as `{}`.
 *
 * The rule is applied to the whole document, so no future section can
 * reintroduce the bug.
 */
export function pruneEmptyMaps<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const pruned = pruneEmptyMaps(item);
      if (isPlainObject(pruned) && Object.keys(pruned).length === 0) continue;
      items.push(pruned);
    }
    return items as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const pruned = pruneEmptyMaps(child);
      if (isPlainObject(pruned) && Object.keys(pruned).length === 0) continue;
      out[key] = pruned;
    }
    return out as unknown as T;
  }
  return value;
}

/** Find every key in the object whose value is an empty map (used by the tests). */
export function findEmptyMapPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findEmptyMapPaths(item, `${prefix}[${index}]`));
  }
  if (isPlainObject(value)) {
    const paths: string[] = [];
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isPlainObject(child) && Object.keys(child).length === 0) {
        paths.push(path);
        continue;
      }
      paths.push(...findEmptyMapPaths(child, path));
    }
    return paths;
  }
  return [];
}

/**
 * Build the dynamic configuration object for the given registrations.
 */
export function buildDynamicConfig(registrations: Route[], config: Config): DynamicConfig {
  const routers: Record<string, unknown> = {};
  const services: Record<string, unknown> = {};
  const middlewares: Record<string, unknown> = {};

  const host = config.advertisedHost || config.advertisedIp;
  const relayUrl = `http://${host}:${config.relayPort}`;

  // Middlewares that live in another provider (the user's file provider) are
  // referenced with the `@provider` suffix.
  const shared: string[] = [];
  if (config.compressMiddleware) shared.push(`compress@${config.middlewareProvider}`);
  if (config.securityHeaders) shared.push(`default-security-headers@${config.middlewareProvider}`);

  for (const registration of registrations) {
    const name = objectName(registration);
    const dispatchMiddleware = middlewareName(registration);

    const router: Record<string, unknown> = {
      rule: hostRule(registration.fqdn),
      entryPoints: config.entryPoints,
      service: name,
      middlewares: [dispatchMiddleware, ...shared],
    };

    if (config.certResolver) {
      const tls: Record<string, unknown> = { certResolver: config.certResolver };
      if (config.tlsMode === 'wildcard') {
        tls['domains'] = [{ main: projectWildcard(registration, config.zone) }];
      }
      router['tls'] = tls;
    }

    routers[name] = router;
    services[name] = { loadBalancer: { servers: [{ url: relayUrl }] } };

    const customRequestHeaders: Record<string, string> = { [DISPATCH_HEADER]: registration.id };
    if (config.secret) customRequestHeaders[RELAY_SECRET_HEADER] = config.secret;
    middlewares[dispatchMiddleware] = { headers: { customRequestHeaders } };
  }

  return pruneEmptyMaps({ http: { routers, services, middlewares } }) as DynamicConfig;
}

/** Render the dynamic configuration in the configured format. */
export function renderDocument(registrations: Route[], config: Config): string {
  const doc = buildDynamicConfig(registrations, config);
  if (config.documentFormat === 'json') return JSON.stringify(doc, null, 2) + '\n';
  return toYaml(doc as never);
}

/** The id of the Traefik adapter. */
export const TRAEFIK_ID = 'traefik';

/**
 * The path the registry serves the document under.
 *
 * It is the adapter's id: the Traefik provider polls `/traefik`, which is
 * where the proxy has always found the document.
 */
export const DOCUMENT_PATH = `/${TRAEFIK_ID}`;

/** Where Traefik's API usually answers. */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8080';

/** One router, as Traefik's API describes it. */
interface TraefikRouter {
  rule?: string;
  entryPoints?: string[];
  middlewares?: string[];
  tls?: { certResolver?: string };
  service?: string;
}

/** The host names a router rule matches, when the rule is a `Host(...)` rule. */
function hostsOfRule(rule: string | undefined): string[] {
  if (!rule) return [];
  const hosts: string[] = [];
  for (const match of rule.matchAll(/Host\(`([^`]+)`\)/g)) {
    const host = match[1];
    if (host && !host.includes('*')) hosts.push(host);
  }
  return hosts;
}

/**
 * The DNS zone the proxy's host names are built from.
 *
 * The zone is the longest common suffix of the host names the proxy already
 * serves. A single host name carries one label too many — the name of the
 * route itself — so that label is dropped.
 */
export function deriveZone(hosts: string[]): string | undefined {
  const usable = hosts.filter((host) => host.length > 0);
  if (usable.length === 0) return undefined;

  // The suffix is counted from the end: the labels that are the same are the
  // last ones, not the first.
  const reversed = usable.map((host) => host.split('.').reverse());
  let common = reversed[0].length;
  for (const labels of reversed.slice(1)) {
    let index = 0;
    while (index < common && index < labels.length && labels[index] === reversed[0][index]) index += 1;
    common = index;
  }

  // One host name: the first label is the route's own name, not the zone.
  if (common === reversed[0].length) common -= 1;
  if (common < 2) return undefined;
  return reversed[0].slice(0, common).reverse().join('.');
}

/** The value that appears most often in a list of strings. */
function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Read the Traefik API and describe the proxy.
 *
 * Returns `undefined` when no Traefik answers: the caller then asks the
 * user for the values instead of guessing them.
 */
export async function discoverTraefik(options: DiscoverOptions = {}): Promise<ProxyInfo | undefined> {
  const base = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 2000;

  let routers: TraefikRouter[];
  let version: string | undefined;
  try {
    const versionResponse = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (versionResponse.ok) {
      const body = (await versionResponse.json()) as { Version?: string };
      version = body?.Version;
    }
    const routersResponse = await fetch(`${base}/api/http/routers`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!routersResponse.ok) return undefined;
    const body = (await routersResponse.json()) as TraefikRouter[];
    if (!Array.isArray(body)) return undefined;
    routers = body;
  } catch {
    return undefined;
  }

  const hosts: string[] = [];
  const entryPoints: string[] = [];
  const certResolvers: string[] = [];
  const providers: string[] = [];

  for (const router of routers) {
    hosts.push(...hostsOfRule(router.rule));
    for (const entryPoint of router.entryPoints ?? []) entryPoints.push(entryPoint);
    if (router.tls?.certResolver) certResolvers.push(router.tls.certResolver);
    for (const middleware of router.middlewares ?? []) {
      const at = middleware.lastIndexOf('@');
      if (at > 0) providers.push(middleware.slice(at + 1));
    }
  }

  return {
    id: TRAEFIK_ID,
    version,
    derived: {
      zone: deriveZone(hosts),
      entryPoints: [...new Set(entryPoints)],
      certResolver: mostCommon(certResolvers),
      middlewareProvider: mostCommon(providers),
    },
  };
}

/**
 * The static configuration the user has to add to Traefik.
 *
 * The wizard writes it to a file the user can copy (S8). The gateway cannot
 * apply it itself: the proxy's configuration lives on another machine.
 */
export function traefikWiringSnippet(config: Config): string {
  const host = config.advertisedHost || config.advertisedIp;
  const lines = [
    '# dev-gateway: the dynamic configuration this proxy polls.',
    'providers:',
    '  http:',
    `    endpoint: "http://${host}:${config.registryPort}${DOCUMENT_PATH}"`,
    '    pollInterval: 2s',
  ];
  if (config.certResolver) {
    lines.push('', '# The certificate resolver the generated routers ask for:', `#   ${config.certResolver}`);
  }
  if (config.entryPoints.length > 0) {
    lines.push('', '# The entry points the generated routers attach to:', `#   ${config.entryPoints.join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

/** The Traefik adapter. */
export const traefikAdapter: ProxyAdapter = {
  id: TRAEFIK_ID,
  discover: (options) => discoverTraefik(options),
  render: (routes, config) => renderDocument(routes, config),
  wiringSnippet: (config) => traefikWiringSnippet(config),
};

