/** The registry: serves the Traefik dynamic configuration document and the index page. */

import fs from 'node:fs';
import http from 'node:http';
import type { Config, Registration } from './types.ts';
import { RegistrationStore } from './state.ts';
import { REGISTRY_SECRET_HEADER, renderDocument } from './document.ts';
import { slugify } from './util/slug.ts';
import { isPortListening } from './util/net.ts';
import { log } from './log.ts';
import { renderIndex, renderRoutes, type RouteView, type RouteState } from './index-page.ts';

const SCOPE = 'registry';

/**
 * Header the index page sends with a manual removal.
 *
 * It is the CSRF guard: a custom header is never sent by a plain form
 * submission or by a "simple" cross-origin request, so sending it forces a
 * CORS preflight. The registry sends no CORS headers, so a cross-site page
 * can never trigger a deletion; only the index page itself (same origin) can.
 */
export const UI_HEADER = 'X-Gateway-UI';
/** Value the index page sends in {@link UI_HEADER}. */
export const UI_HEADER_VALUE = '1';

/**
 * Static assets of the index page.
 *
 * They live in the repository next to the code and are served by the registry
 * itself, so the page never asks a CDN for anything: the gateway runs on a
 * private network and a font request to a third party would leak every visit.
 */
const ASSETS = new Map<string, { file: URL; type: string }>([
  ['/index.css', { file: new URL('./assets/index.css', import.meta.url), type: 'text/css; charset=utf-8' }],
  ['/index.js', { file: new URL('./assets/index.js', import.meta.url), type: 'text/javascript; charset=utf-8' }],
]);

const FONT_DIR = new URL('./assets/fonts/', import.meta.url);
const FONT_TYPE = 'font/woff2';

const assetCache = new Map<string, { mtimeMs: number; body: Buffer }>();

/**
 * Read an asset from disk.
 *
 * The body is cached, but only for as long as the file on disk is unchanged:
 * the stylesheet and the script are edited in place during development and a
 * stale copy would be worse than a second read.
 */
function readAsset(url: URL): Buffer | null {
  try {
    const stat = fs.statSync(url);
    const cached = assetCache.get(url.href);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.body;
    const body = fs.readFileSync(url);
    assetCache.set(url.href, { mtimeMs: stat.mtimeMs, body });
    return body;
  } catch {
    return null;
  }
}

/**
 * Handle `DELETE /api/registrations/<project-slug>/<branch-slug>`.
 *
 * Two guards, in this order:
 *
 *  1. the `X-Gateway-UI` header must be present. A custom header is never
 *     sent by a plain form submission nor by a "simple" cross-origin
 *     request, so sending it forces a CORS preflight. The registry sends no
 *     CORS headers, so a page on another origin can never trigger a
 *     deletion -- only the index page itself, which is same origin.
 *  2. when a secret is configured, `X-Registry-Secret` must match it, the
 *     same convention the http provider uses for the document endpoint.
 *
 * The registration is identified by the id the store keys on
 * (`<project-slug>/<branch-slug>`), the same value the relay dispatches on.
 */
async function handleDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  store: RegistrationStore,
  config: Config,
): Promise<void> {
  const match = /^\/api\/registrations\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
    return;
  }

  if (req.headers[UI_HEADER.toLowerCase()] !== UI_HEADER_VALUE) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`forbidden: missing ${UI_HEADER} header\n`);
    return;
  }

  if (config.secret) {
    const provided = req.headers[REGISTRY_SECRET_HEADER.toLowerCase()];
    if (provided !== config.secret) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden: registry secret missing or wrong\n');
      return;
    }
  }

  const projectSlug = slugify(decodeURIComponent(match[1]));
  const branchSlug = slugify(decodeURIComponent(match[2]));
  const id = `${projectSlug}/${branchSlug}`;

  const registration = store.find(id);
  if (!registration) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
    return;
  }

  const removed = store.removeById(id);
  if (!removed) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
    return;
  }

  const source = req.socket.remoteAddress ?? 'unknown';
  log('info', SCOPE, 'registration removed', `project=${projectSlug} branch=${branchSlug} source=${source}`);

  res.writeHead(204);
  res.end();
}

/**
 * Create the registry HTTP server.
 *
 * Routes: `GET /traefik` (dynamic configuration), `GET /` (index),
 * `GET /api/registrations` (JSON),
 * `DELETE /api/registrations/<project>/<branch>` (manual removal),
 * `GET /healthz`.
 */
export function createRegistryServer(store: RegistrationStore, config: Config): http.Server {
  const upCache = new Map<string, { value: boolean; at: number }>();

  async function probe(registration: Registration): Promise<boolean> {
    const cached = upCache.get(registration.id);
    const now = Date.now();
    if (cached && now - cached.at < 2000) return cached.value;
    const value = await isPortListening(registration.devPort, '127.0.0.1', 400);
    upCache.set(registration.id, { value, at: now });
    return value;
  }

  /** Probe every registration and pair it with the state the probe found. */
  async function probeRoutes(registrations: Registration[]): Promise<RouteView[]> {
    const states = await Promise.all(
      registrations.map(async (registration): Promise<RouteState> => ((await probe(registration)) ? 'up' : 'down')),
    );
    return registrations.map((registration, index) => ({ registration, state: states[index] }));
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const registrations = store.list();

      if (req.method === 'DELETE') {
        await handleDelete(req, res, url, store, config);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD, DELETE' });
        res.end('method not allowed\n');
        return;
      }

      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
      }

      if (url.pathname === '/traefik') {
        if (config.secret) {
          const provided = req.headers[REGISTRY_SECRET_HEADER.toLowerCase()];
          if (provided !== config.secret) {
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('forbidden: registry secret missing or wrong\n');
            return;
          }
        }
        const body = renderDocument(registrations, config);
        res.writeHead(200, { 'content-type': 'application/yaml; charset=utf-8' });
        res.end(body);
        return;
      }

      if (url.pathname === '/api/registrations') {
        const routes = await probeRoutes(registrations);
        const body =
          JSON.stringify(
            {
              registrations: routes.map((route) => ({ ...route.registration, state: route.state })),
              checkedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + '\n';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
        return;
      }

      if (url.pathname === '/api/routes') {
        const routes = await probeRoutes(registrations);
        const body = renderRoutes(routes, config);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
        return;
      }

      if (ASSETS.has(url.pathname)) {
        const asset = ASSETS.get(url.pathname)!;
        const body = readAsset(asset.file);
        if (!body) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found\n');
          return;
        }
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      if (url.pathname.startsWith('/fonts/')) {
        const name = url.pathname.slice('/fonts/'.length);
        if (!/^[a-z0-9-]+\.woff2$/.test(name)) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found\n');
          return;
        }
        const body = readAsset(new URL(name, FONT_DIR));
        if (!body) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('not found\n');
          return;
        }
        res.writeHead(200, { 'content-type': FONT_TYPE, 'cache-control': 'max-age=604800' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const routes = await probeRoutes(registrations);
        const body = renderIndex(routes, config);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
    })().catch((error: unknown) => {
      log('error', SCOPE, 'request failed', error instanceof Error ? error.message : String(error));
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('internal error\n');
    });
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return server;
}
