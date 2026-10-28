/** The registry: serves the dynamic configuration document and the health probe. */

import http from 'node:http';
import type { Config } from './types.ts';
import type { ProxyAdapter } from './proxy.ts';
import { RegistrationStore } from './state.ts';
import { REGISTRY_SECRET_HEADER } from './protocol.ts';
import { log } from './log.ts';

const SCOPE = 'registry';

/**
 * Create the registry HTTP server.
 *
 * The registry serves exactly two endpoints (D9, §10.1):
 *
 *   - `GET /<proxy>` — the dynamic configuration document, rendered by the
 *     adapter and served under the adapter's id (`/traefik` for Traefik);
 *   - `GET /healthz` — the health probe.
 *
 * Everything else is a 404. The web interface and its endpoints are gone
 * (D8): the index page, the assets, the JSON route list and the create and
 * delete endpoints went with it. The extension, the CLI and the MCP server
 * write the route state file directly, so the registry has no write path
 * left to guard.
 */
export function createRegistryServer(store: RegistrationStore, config: Config, adapter: ProxyAdapter): http.Server {
  const documentPath = `/${adapter.id}`;

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
        res.end('method not allowed\n');
        return;
      }

      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
      }

      if (url.pathname === documentPath) {
        if (config.secret) {
          const provided = req.headers[REGISTRY_SECRET_HEADER.toLowerCase()];
          if (provided !== config.secret) {
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('forbidden: registry secret missing or wrong\n');
            return;
          }
        }
        const body = adapter.render(store.list(), config);
        res.writeHead(200, { 'content-type': 'application/yaml; charset=utf-8' });
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
