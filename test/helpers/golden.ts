/**
 * Golden fixtures for the Traefik dynamic configuration document (S2).
 *
 * The fixtures are frozen on purpose: they are the input of the golden test,
 * which compares the rendered document byte for byte with the document the
 * gateway rendered before the core split. Nothing in this file may change
 * without the golden files being regenerated on purpose, because a silent
 * change here would silently change what the user's proxy is told.
 *
 * The configuration objects are written out in full instead of being derived
 * from `DEFAULT_CONFIG`, so that the fixtures do not move when the defaults
 * move.
 */

import type { Config, Registration } from '../../src/core/types.ts';

/** One golden case: a configuration and the routes it renders. */
export interface GoldenCase {
  /** The file name of the golden document, without the extension. */
  name: string;
  /** The configuration the document is rendered with. */
  config: Config;
  /** The routes the document is rendered for. */
  routes: Registration[];
}

const BASE_CONFIG: Config = {
  proxy: 'traefik',
  registryPort: 45002,
  relayPort: 45001,
  advertisedIp: '10.0.0.5',
  advertisedHost: 'devbox',
  zone: 'home.malarstrom.com',
  indexHost: 'index.home.malarstrom.com',
  entryPoints: ['websecure'],
  certResolver: 'cloudflare',
  tlsMode: 'wildcard',
  securityHeaders: false,
  compressMiddleware: false,
  middlewareProvider: 'file',
  allowedCidrs: ['127.0.0.1/32', '::1/128'],
  secret: '',
  stateDir: '/tmp/dev-gateway-golden',
  documentFormat: 'yaml',
  logMaxBytes: 5 * 1024 * 1024,
  logKeep: 3,
  autostart: true,
};

function route(overrides: Partial<Registration> & Pick<Registration, 'id' | 'project' | 'branch'>): Registration {
  return {
    projectSlug: overrides.project.toLowerCase(),
    branchSlug: overrides.branch.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    fqdn: 'example.home.malarstrom.com',
    devPort: 3000,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const ALPHA = route({
  id: 'alpha/feature-login',
  project: 'alpha',
  branch: 'feature/login',
  projectSlug: 'alpha',
  branchSlug: 'feature-login',
  fqdn: 'feature-login.alpha.home.malarstrom.com',
  devPort: 5173,
});

const BETA = route({
  id: 'beta/main',
  project: 'beta',
  branch: 'main',
  projectSlug: 'beta',
  branchSlug: 'main',
  fqdn: 'main.beta.home.malarstrom.com',
  devPort: 4000,
  label: 'the beta preview',
});

/** Every golden case, in the order they are rendered. */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: 'single-route',
    config: BASE_CONFIG,
    routes: [ALPHA],
  },
  {
    name: 'two-routes-shared-middlewares',
    config: {
      ...BASE_CONFIG,
      tlsMode: 'fqdn',
      securityHeaders: true,
      compressMiddleware: true,
      middlewareProvider: 'file',
    },
    routes: [ALPHA, BETA],
  },
  {
    name: 'no-routes',
    config: BASE_CONFIG,
    routes: [],
  },
  {
    name: 'two-routes-json',
    config: { ...BASE_CONFIG, documentFormat: 'json' },
    routes: [ALPHA, BETA],
  },
  {
    name: 'with-secret',
    config: { ...BASE_CONFIG, secret: 's3cr3t' },
    routes: [ALPHA],
  },
];
