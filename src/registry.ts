/** The registry: serves the Traefik dynamic configuration document and the index page. */

import http from 'node:http';
import type { Config, Registration } from './types.ts';
import { RegistrationStore } from './state.ts';
import { REGISTRY_SECRET_HEADER, renderDocument } from './document.ts';
import { isPortListening } from './util/net.ts';
import { log } from './log.ts';

const SCOPE = 'registry';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render the "what is running" page. */
export function renderIndex(registrations: Registration[], up: Map<string, boolean>, config: Config): string {
  const rows = registrations
    .map((registration) => {
      const state = up.get(registration.id) ? 'up' : 'down';
      const label = registration.label ? ` <span class="label">${escapeHtml(registration.label)}</span>` : '';
      return [
        '        <tr>',
        `          <td>${escapeHtml(registration.projectSlug)}</td>`,
        `          <td>${escapeHtml(registration.branchSlug)}${label}</td>`,
        `          <td><a href="https://${escapeHtml(registration.fqdn)}">${escapeHtml(registration.fqdn)}</a></td>`,
        `          <td>${registration.devPort}</td>`,
        `          <td class="${state}">${state}</td>`,
        `          <td>${escapeHtml(registration.updatedAt)}</td>`,
        '        </tr>',
      ].join('\n');
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Traefik dev gateway</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
      h1 { font-size: 1.25rem; }
      table { border-collapse: collapse; margin-top: 1rem; }
      th, td { border-bottom: 1px solid #ddd; padding: 0.4rem 0.8rem; text-align: left; }
      th { font-weight: 600; }
      td.up { color: #0a7a28; }
      td.down { color: #a02020; }
      .label { color: #666; font-size: 0.85em; }
      .meta { color: #666; font-size: 0.85em; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>Dev servers in this container (${registrations.length})</h1>
    <table>
      <thead>
        <tr><th>Project</th><th>Branch</th><th>URL</th><th>Port</th><th>State</th><th>Last change</th></tr>
      </thead>
      <tbody>
${rows || '        <tr><td colspan="6">nothing registered</td></tr>'}
      </tbody>
    </table>
    <p class="meta">zone: ${escapeHtml(config.zone)} &middot; relay: ${escapeHtml(config.advertisedIp)}:${config.relayPort} &middot; registry port: ${config.registryPort}</p>
  </body>
</html>
`;
}

/**
 * Create the registry HTTP server.
 *
 * Routes: `GET /traefik` (dynamic configuration), `GET /` (index),
 * `GET /api/registrations` (JSON), `GET /healthz`.
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

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const registrations = store.list();

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
        const body = JSON.stringify({ registrations }, null, 2) + '\n';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(body);
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const up = new Map<string, boolean>();
        await Promise.all(registrations.map(async (r) => up.set(r.id, await probe(r))));
        const body = renderIndex(registrations, up, config);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
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
