/**
 * The relay: one listener for every registration.
 *
 * Traefik stamps the dispatch header (`X-Dev-Target`) with a per-router
 * middleware; the relay resolves it to `127.0.0.1:<devPort>` and proxies the
 * request. WebSocket upgrades are tunnelled byte for byte.
 */

import http from 'node:http';
import net from 'node:net';
import type { Config } from './types.ts';
import { RegistrationStore } from './state.ts';
import { DISPATCH_HEADER, RELAY_SECRET_HEADER } from './document.ts';
import { isAddressAllowed } from './util/net.ts';
import { log } from './log.ts';

const SCOPE = 'relay';

/** Headers that must not be forwarded to the upstream server. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function filterHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'host') {
      out.host = Array.isArray(value) ? value[0] : value;
      continue;
    }
    out[lower] = value;
  }
  return out;
}

/** The relay's view of the caller. */
export interface Peer {
  address: string | undefined;
}

function readHeader(headers: http.IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Check the trust boundary: the source address must be inside an allowed CIDR
 * and, when a secret is configured, the secret header must match.
 */
export function isTrusted(peer: Peer, headers: http.IncomingHttpHeaders, config: Config): { ok: boolean; reason?: string } {
  if (!isAddressAllowed(peer.address, config.allowedCidrs)) {
    return { ok: false, reason: 'source address not allowed' };
  }
  if (config.secret) {
    const provided = readHeader(headers, RELAY_SECRET_HEADER);
    if (provided !== config.secret) return { ok: false, reason: 'relay secret missing or wrong' };
  }
  return { ok: true };
}

/**
 * Create the relay HTTP server.
 */
export function createRelayServer(store: RegistrationStore, config: Config): http.Server {
  const server = http.createServer((req, res) => {
    const trusted = isTrusted({ address: req.socket.remoteAddress }, req.headers, config);
    if (!trusted.ok) {
      log('warn', SCOPE, 'rejected request', `${req.method} ${req.url}: ${trusted.reason}`);
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`forbidden: ${trusted.reason}\n`);
      return;
    }

    const id = readHeader(req.headers, DISPATCH_HEADER);
    if (!id) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`not found: missing ${DISPATCH_HEADER} header\n`);
      return;
    }

    const registration = store.find(id);
    if (!registration) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`not found: unknown registration "${id}"\n`);
      return;
    }

    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: registration.devPort,
        method: req.method,
        path: req.url ?? '/',
        headers: filterHeaders(req.headers),
      },
      (upstreamRes) => {
        const headers: http.OutgoingHttpHeaders = { ...upstreamRes.headers };
        delete headers['connection'];
        res.writeHead(upstreamRes.statusCode ?? 502, headers);
        upstreamRes.pipe(res);
      },
    );

    upstream.on('error', (error: Error) => {
      log('warn', SCOPE, 'upstream error', `${registration.id} 127.0.0.1:${registration.devPort}: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`bad gateway: dev server for ${registration.id} is not reachable on 127.0.0.1:${registration.devPort}\n`);
      } else {
        res.destroy();
      }
    });

    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
    });

    req.pipe(upstream);
  });

  // WebSocket / HMR upgrades are tunnelled raw.
  server.on('upgrade', (req, socket, head) => {
    const trusted = isTrusted({ address: req.socket.remoteAddress }, req.headers, config);
    if (!trusted.ok) {
      log('warn', SCOPE, 'rejected upgrade', trusted.reason);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    const id = readHeader(req.headers, DISPATCH_HEADER);
    if (!id) {
      socket.end(`HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n`);
      return;
    }
    const registration = store.find(id);
    if (!registration) {
      socket.end(`HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n`);
      return;
    }

    const headers = filterHeaders(req.headers);
    const requestLine = [
      `GET ${req.url ?? '/'} HTTP/${req.httpVersion}`,
      ...Object.entries(headers).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`),
      'connection: Upgrade',
      'upgrade: websocket',
      '',
      '',
    ].join('\r\n');

    const upstream = net.connect({ host: '127.0.0.1', port: registration.devPort }, () => {
      upstream.write(requestLine);
      if (head && head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });

    upstream.on('error', (error: Error) => {
      log('warn', SCOPE, 'upgrade upstream error', `${registration.id}: ${error.message}`);
      socket.destroy();
    });
    socket.on('error', () => upstream.destroy());
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return server;
}
