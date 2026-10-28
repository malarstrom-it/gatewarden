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
import dns from 'node:dns/promises';
import type { Config, Route } from '../core/types.ts';
import { DISPATCH_HEADER, RELAY_SECRET_HEADER } from '../core/protocol.ts';
import { toYaml } from '../core/util/yaml.ts';
import { zoneOfFqdn } from '../core/util/slug.ts';
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

/**
 * The DNS zone of a route.
 *
 * A route keeps the zone it was registered with, and the certificate of
 * the route is built from it. The zone of the configuration the daemon
 * runs with is a different thing: a route that was registered before the
 * zone changed keeps the name it was given.
 *
 * A route from a file that was written before the store kept the zone has
 * none: the zone is then the tail of its host name, which is where
 * `buildFqdn` put it.
 */
export function routeZone(route: Route): string {
  if (typeof route.zone === 'string' && route.zone.length > 0) return route.zone;
  return zoneOfFqdn(route.fqdn);
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

  // Middlewares that live in another provider (a file provider, say) are
  // referenced with the `@provider` suffix. Without a provider there is
  // nothing to reference: the shared middlewares stay off until the setup
  // wizard names the provider that owns them.
  const shared: string[] = [];
  if (config.middlewareProvider) {
    if (config.compressMiddleware) shared.push(`compress@${config.middlewareProvider}`);
    if (config.securityHeaders) shared.push(`default-security-headers@${config.middlewareProvider}`);
  }

  for (const registration of registrations) {
    const name = objectName(registration);
    const dispatchMiddleware = middlewareName(registration);

    const router: Record<string, unknown> = {
      rule: hostRule(registration.fqdn),
      entryPoints: config.entryPoints,
      service: name,
      middlewares: [dispatchMiddleware, ...shared],
    };

    if (config.certResolver && routeZone(registration)) {
      const tls: Record<string, unknown> = { certResolver: config.certResolver };
      if (config.tlsMode === 'wildcard') {
        tls['domains'] = [{ main: projectWildcard(registration, routeZone(registration)) }];
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

/**
 * The name of Traefik's HTTP provider.
 *
 * The routers the HTTP provider serves carry it: that is how the proxy
 * says "this router came from the provider the gateway serves" (§9.3).
 */
export const HTTP_PROVIDER = 'http';

/**
 * The name of the provider of Traefik's own routers.
 *
 * The API, the dashboard and the ACME challenge are served by it. They
 * say nothing about the user's routes.
 */
export const INTERNAL_PROVIDER = 'internal';

/** One router, as Traefik's API describes it. */
export interface TraefikRouter {
  name?: string;
  rule?: string;
  entryPoints?: string[];
  middlewares?: string[];
  tls?: { certResolver?: string };
  service?: string;
  /** The provider that served the router (`http`, `file`, ...). */
  provider?: string;
  status?: string;
}

/** One service, as Traefik's API describes it. */
export interface TraefikService {
  name?: string;
  status?: string;
  loadBalancer?: { servers?: Array<{ url?: string }> };
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
 * The provider that owns a middleware.
 *
 * The gateway's own dispatch middleware is not one of the user's: it
 * lives in the HTTP provider, and the provider of it says nothing about
 * the middlewares the user shares (the compression, the security
 * headers). It is left out here: the wizard would otherwise write
 * "http" into the configuration, and every route would then ask for a
 * middleware that does not exist.
 */
export function middlewareProviderOf(middleware: string): string | undefined {
  const at = middleware.lastIndexOf('@');
  if (at <= 0) return undefined;
  const name = middleware.slice(0, at);
  if (name.startsWith(MIDDLEWARE_PREFIX)) return undefined;
  return middleware.slice(at + 1);
}

/**
 * The port an entry point answers on.
 *
 * The address of an entry point is `":8443"` or `"127.0.0.1:8443"`.
 */
export function portOfAddress(address: string | undefined): number | undefined {
  if (!address) return undefined;
  const at = address.lastIndexOf(':');
  if (at < 0) return undefined;
  const port = Number.parseInt(address.slice(at + 1), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
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

  // Traefik's own routers — the API, the dashboard, the ACME challenge —
  // are not the user's: they attach to the entry point the API answers
  // on, and the dev routes have nothing to do with it. Only the routers
  // of the other providers say what the user's routes look like.
  const userRouters = routers.filter((router) => router.provider !== INTERNAL_PROVIDER);

  for (const router of userRouters) {
    hosts.push(...hostsOfRule(router.rule));
    for (const entryPoint of router.entryPoints ?? []) entryPoints.push(entryPoint);
    if (router.tls?.certResolver) certResolvers.push(router.tls.certResolver);
    for (const middleware of router.middlewares ?? []) {
      const provider = middlewareProviderOf(middleware);
      if (provider) providers.push(provider);
    }
  }

  return {
    id: TRAEFIK_ID,
    version,
    derived: {
      zone: deriveZone(hosts),
      entryPoints: [...new Set(entryPoints)],
      entryPointPorts: await discoverEntryPointPorts(base, timeoutMs),
      certResolver: mostCommon(certResolvers),
      middlewareProvider: mostCommon(providers),
    },
    wired: options.expectEndpoints
      ? await isWiredAt(base, routers, options.expectEndpoints, timeoutMs)
      : undefined,
  };
}

/**
 * The port every entry point of the proxy answers on.
 *
 * The public URL of a route has no port of its own when the proxy
 * serves it on the standard one. A proxy that serves it on another port
 * (8443, say) needs the port in the URL, and nobody can guess it.
 *
 * An API that does not answer has no ports: the wizard then tries the
 * standard ones only.
 */
async function discoverEntryPointPorts(
  base: string,
  timeoutMs: number,
): Promise<Record<string, number> | undefined> {
  let body: Array<{ name?: string; address?: string }>;
  try {
    const response = await fetch(`${base}/api/entrypoints`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    const parsed = (await response.json()) as typeof body;
    if (!Array.isArray(parsed)) return undefined;
    body = parsed;
  } catch {
    return undefined;
  }
  const ports: Record<string, number> = {};
  for (const entryPoint of body) {
    if (typeof entryPoint.name !== 'string') continue;
    const port = portOfAddress(entryPoint.address);
    if (port !== undefined) ports[entryPoint.name] = port;
  }
  return Object.keys(ports).length > 0 ? ports : undefined;
}

/** The host and the port of a URL, or `undefined` when it has none. */
function hostPortOf(url: string): { host: string; port: string } | undefined {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
    };
  } catch {
    return undefined;
  }
}

/**
 * Do two names point at the same machine?
 *
 * A name and an address are the same machine when the name resolves to the
 * address. The proxy may reach the gateway by its IP while the
 * configuration advertises its host name, and the wizard must
 * not call that "not wired" (§9.3).
 */
async function sameMachine(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const addresses = async (host: string): Promise<string[]> => {
    try {
      const found = await dns.lookup(host, { all: true });
      return found.map((entry) => entry.address);
    } catch {
      return [];
    }
  };
  const [first, second] = await Promise.all([addresses(a), addresses(b)]);
  if (first.length === 0 || second.length === 0) return false;
  return first.some((address) => second.includes(address));
}

/**
 * Does the proxy already serve something from this machine?
 *
 * The question the setup wizard asks in §9.3: is there a router whose
 * provider is the HTTP provider and whose service points at this host and
 * port? The router list alone does not say; the service list does.
 *
 * A router without a provider is taken for one of the HTTP provider's:
 * the API of an older Traefik does not report the field, and a router
 * that is not ours cannot point at our ports anyway.
 */
async function isWiredAt(
  base: string,
  routers: TraefikRouter[],
  expectEndpoints: string[],
  timeoutMs: number,
): Promise<boolean> {
  const expected = expectEndpoints
    .map((endpoint) => hostPortOf(endpoint))
    .filter((endpoint): endpoint is { host: string; port: string } => endpoint !== undefined);
  if (expected.length === 0) return false;

  const ours = routers.filter((router) => router.provider === undefined || router.provider === HTTP_PROVIDER);
  if (ours.length === 0) return false;

  const services = await fetchServices(base, timeoutMs);
  if (!services) return false;

  for (const router of ours) {
    if (!router.service) continue;
    const service = services.get(router.service);
    if (!service) continue;
    for (const server of service.loadBalancer?.servers ?? []) {
      if (!server.url) continue;
      const found = hostPortOf(server.url);
      if (!found) continue;
      for (const endpoint of expected) {
        if (found.port !== endpoint.port) continue;
        if (await sameMachine(found.host, endpoint.host)) return true;
      }
    }
  }
  return false;
}

/**
 * The services the proxy has, by name.
 *
 * The API names a service `name@provider` — the name the router refers
 * to, with the provider that served it. A router refers to the service
 * without the suffix, so the map is keyed by both.
 */
async function fetchServices(base: string, timeoutMs: number): Promise<Map<string, TraefikService> | undefined> {
  let body: TraefikService[];
  try {
    const response = await fetch(`${base}/api/http/services`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    const parsed = (await response.json()) as TraefikService[];
    if (!Array.isArray(parsed)) return undefined;
    body = parsed;
  } catch {
    return undefined;
  }
  const services = new Map<string, TraefikService>();
  for (const service of body) {
    if (typeof service.name !== 'string') continue;
    services.set(service.name, service);
    const at = service.name.indexOf('@');
    if (at > 0) services.set(service.name.slice(0, at), service);
  }
  return services;
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
  defaultApiBaseUrl: DEFAULT_API_BASE_URL,
  discover: (options) => discoverTraefik(options),
  render: (routes, config) => renderDocument(routes, config),
  wiringSnippet: (config) => traefikWiringSnippet(config),
};

