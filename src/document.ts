/**
 * Rendering of the Traefik dynamic configuration document.
 *
 * One registration produces exactly one router, one service and one
 * middleware. Adding or removing a registration touches only its own three
 * objects, so registrations are atomic with respect to each other.
 */

import { createHash } from 'node:crypto';
import type { Config, Registration } from './types.ts';
import { toYaml } from './util/yaml.ts';

/** Header Traefik stamps with the dispatch target. */
export const DISPATCH_HEADER = 'X-Dev-Target';
/** Header carrying the optional shared secret to the relay. */
export const RELAY_SECRET_HEADER = 'X-Relay-Secret';
/** Header Traefik sends to the registry endpoint when a secret is configured. */
export const REGISTRY_SECRET_HEADER = 'X-Registry-Secret';

/** Prefix of every router and service this registry serves (avoids collisions with other providers). */
export const NAME_PREFIX = 'dev-';
/** Prefix of every dispatch middleware this registry serves. */
export const MIDDLEWARE_PREFIX = 'devhdr-';

/** Deterministic, collision-resistant object name for a registration (router and service). */
export function objectName(registration: Registration): string {
  const hash = createHash('sha1').update(registration.id).digest('hex').slice(0, 6);
  return `${NAME_PREFIX}${registration.projectSlug}-${registration.branchSlug}-${hash}`;
}

/** Object name of the dispatch middleware of a registration. */
export function middlewareName(registration: Registration): string {
  const hash = createHash('sha1').update(registration.id).digest('hex').slice(0, 6);
  return `${MIDDLEWARE_PREFIX}${registration.projectSlug}-${registration.branchSlug}-${hash}`;
}

/** Object name of the index router/service. */
export const INDEX_OBJECT_NAME = `${NAME_PREFIX}index`;

/** Exact-Host rule for a registration. */
export function hostRule(fqdn: string): string {
  return `Host(\`${fqdn}\`)`;
}

/** Wildcard certificate domain for a project (one certificate per project). */
export function projectWildcard(registration: Registration, zone: string): string {
  return `*.${registration.projectSlug}.${zone}`;
}

export interface DynamicConfig {
  http: {
    routers: Record<string, unknown>;
    services: Record<string, unknown>;
    middlewares: Record<string, unknown>;
  };
}

/**
 * Build the dynamic configuration object for the given registrations.
 */
export function buildDynamicConfig(registrations: Registration[], config: Config): DynamicConfig {
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

  // The index router points at the registry itself so the user can open the
  // "what is running" page through Traefik.
  const indexRouter: Record<string, unknown> = {
    rule: hostRule(config.indexHost),
    entryPoints: config.entryPoints,
    service: INDEX_OBJECT_NAME,
  };
  if (config.certResolver) indexRouter['tls'] = { certResolver: config.certResolver };
  routers[INDEX_OBJECT_NAME] = indexRouter;
  services[INDEX_OBJECT_NAME] = {
    loadBalancer: { servers: [{ url: `http://${host}:${config.registryPort}` }] },
  };

  return { http: { routers, services, middlewares } };
}

/** Render the dynamic configuration in the configured format. */
export function renderDocument(registrations: Registration[], config: Config): string {
  const doc = buildDynamicConfig(registrations, config);
  if (config.documentFormat === 'json') return JSON.stringify(doc, null, 2) + '\n';
  return toYaml(doc as never);
}
