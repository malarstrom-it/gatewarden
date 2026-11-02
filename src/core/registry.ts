/** The registry: serves the dynamic configuration document and the health probe. */

import http from 'node:http';
import type { Config } from './types.ts';
import type { ProxyAdapter } from './proxy.ts';
import { RegistrationStore } from './state.ts';
import { REGISTRY_SECRET_HEADER } from './protocol.ts';
import { isTrusted, isTrustedAddress, registryTrustKeys, registryTrustList, type TrustOptions } from './trust.ts';
import { log } from './log.ts';

const SCOPE = 'registry';

/**
 * The trust boundary of the registry.
 *
 * The registry is bound on every address of the machine, and the
 * document it serves names the projects, the branches, the zone, the
 * address of the machine and the port of the relay. It therefore
 * answers the addresses in the trust list and nobody else — the same
 * rule the relay follows.
 *
 * The list is the list of the relay and the list of the registry on top
 * of it: an installation that says nothing about the registry trusts
 * the same addresses for both listeners.
 */
function trust(config: Config): TrustOptions {
  return {
    cidrs: registryTrustList(config),
    keys: registryTrustKeys(config),
    secretHeader: REGISTRY_SECRET_HEADER,
    scope: 'registry',
  };
}

/**
 * Create the registry HTTP server.
 *
 * The registry serves exactly two endpoints:
 *
 *   - `GET /<proxy>` — the dynamic configuration document, rendered by the
 *     adapter and served under the adapter's id (`/traefik` for Traefik);
 *   - `GET /healthz` — the health probe.
 *
 * Everything else is a 404. The web interface and its endpoints are gone:
 * the index page, the assets, the JSON route list and the create and
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
        // The probe says that the daemon is alive and nothing else, but
        // it is still an answer to the network: only the addresses in
        // the trust list get one.
        //
        // The machine itself always gets one: the loopback is not the
        // network, only a process here can use it, and the daemon's own
        // liveness depends on the answer. A trust list that leaves the
        // loopback out must not make the daemon report itself as
        // broken.
        const trusted = isTrustedAddress({ address: req.socket.remoteAddress }, {
          cidrs: registryTrustList(config),
          keys: registryTrustKeys(config),
          allowLoopback: true,
        });
        if (!trusted.ok) {
          log('warn', SCOPE, 'rejected request', `${req.method} ${req.url}: ${trusted.reason}`);
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`forbidden: ${trusted.reason}\n`);
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
      }

      if (url.pathname === documentPath) {
        // The trust boundary of the registry: the address of the caller
        // has to be in the trust list, and the secret has to be
        // presented when the installation has one — the same two rules
        // the relay follows.
        const trusted = isTrusted({ address: req.socket.remoteAddress }, req.headers, config, trust(config));
        if (!trusted.ok) {
          log('warn', SCOPE, 'rejected request', `${req.method} ${req.url}: ${trusted.reason}`);
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`forbidden: ${trusted.reason}\n`);
          return;
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
