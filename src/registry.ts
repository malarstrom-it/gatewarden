/** The registry: serves the Traefik dynamic configuration document and the index page. */

import http from 'node:http';
import type { Config, Registration } from './types.ts';
import { RegistrationStore } from './state.ts';
import { REGISTRY_SECRET_HEADER, renderDocument } from './document.ts';
import { slugify } from './util/slug.ts';
import { isPortListening } from './util/net.ts';
import { log } from './log.ts';

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
        `          <td><button type="button" class="remove" data-registration-id="${escapeHtml(registration.id)}" data-project="${escapeHtml(registration.projectSlug)}" data-branch="${escapeHtml(registration.branchSlug)}">Remove</button></td>`,
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
      button.remove {
        font: inherit; font-size: 0.85em; cursor: pointer; color: #a02020;
        background: #fff; border: 1px solid #d8b4b4; border-radius: 3px; padding: 0.15rem 0.5rem;
      }
      button.remove:hover { background: #fdf2f2; }
      button.remove:disabled { color: #999; border-color: #ddd; cursor: default; }
      .notice { color: #a02020; font-size: 0.85em; margin: 0.5rem 0 0; }
      .label { color: #666; font-size: 0.85em; }
      .meta { color: #666; font-size: 0.85em; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>Dev servers in this container (${registrations.length})</h1>
    <table>
      <thead>
        <tr><th>Project</th><th>Branch</th><th>URL</th><th>Port</th><th>State</th><th>Last change</th><th></th></tr>
      </thead>
      <tbody>
${rows || '        <tr><td colspan="7">nothing registered</td></tr>'}
      </tbody>
    </table>
    <p class="notice" id="notice" hidden></p>
    <p class="meta">zone: ${escapeHtml(config.zone)} &middot; relay: ${escapeHtml(config.advertisedHost || config.advertisedIp)}:${config.relayPort} &middot; registry port: ${config.registryPort}</p>
    <script>
      // Manual removal: ask, DELETE the registration, reload.
      // The X-Gateway-UI header is a CSRF guard -- it forces a CORS preflight
      // for any cross-site caller, and this server sends no CORS headers.
      (function () {
        var notice = document.getElementById('notice');
        function say(message) {
          notice.textContent = message;
          notice.hidden = false;
        }
        document.querySelectorAll('button.remove').forEach(function (button) {
          button.addEventListener('click', function () {
            var project = button.getAttribute('data-project');
            var branch = button.getAttribute('data-branch');
            if (!confirm('Remove the registration ' + project + '/' + branch + '?')) return;
            button.disabled = true;
            fetch('/api/registrations/' + encodeURIComponent(project) + '/' + encodeURIComponent(branch), {
              method: 'DELETE',
              headers: { 'X-Gateway-UI': '1' },
            }).then(function (response) {
              if (!response.ok) throw new Error('the gateway answered ' + response.status);
              window.location.reload();
            }).catch(function (error) {
              button.disabled = false;
              say('Could not remove ' + project + '/' + branch + ': ' + error.message);
            });
          });
        });
      })();
    </script>
  </body>
</html>
`;
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
