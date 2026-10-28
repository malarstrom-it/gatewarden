/**
 * A proxy that behaves like Traefik, for the tests of the setup wizard.
 *
 * It answers the three endpoints the wizard reads (`/api/version`,
 * `/api/http/routers`, `/api/http/services`), it polls the dynamic
 * configuration document the way Traefik's HTTP provider does, and it
 * serves the public URLs: a request for a host it has a router for is
 * forwarded to the service of that router, with the headers the
 * middleware of the router stamps on it.
 *
 * The double is deliberately faithful in the places the wizard depends
 * on: the routers carry the provider they came from, the services carry
 * the URL they forward to, and the document is polled, not pushed.
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { parseYaml } from './yaml.ts';

/** One router, as the double's API describes it. */
export interface FakeRouter {
  name?: string;
  rule?: string;
  entryPoints?: string[];
  middlewares?: string[];
  tls?: { certResolver?: string };
  service?: string;
  provider?: string;
  status?: string;
}

/** One service, as the double's API describes it. */
export interface FakeService {
  name?: string;
  status?: string;
  loadBalancer?: { servers?: Array<{ url?: string }> };
}

interface FakeMiddleware {
  headers?: { customRequestHeaders?: Record<string, string> };
}

interface DynamicDocument {
  http?: {
    routers?: Record<string, FakeRouter>;
    services?: Record<string, FakeService>;
    middlewares?: Record<string, FakeMiddleware>;
  };
}

export interface FakeProxyOptions {
  /** The certificate the public listener serves TLS with. */
  tls?: { key: string | Buffer; cert: string | Buffer };
  /** Where the proxy polls the dynamic configuration document. */
  documentEndpoint?: string;
  /** How often the proxy polls the document. */
  pollIntervalMs?: number;
  /**
   * The name of the entry point the routes attach to.
   *
   * The public URL of a route has no port of its own when the proxy
   * serves it on the standard one. A proxy that serves it on another
   * port needs the port in the URL, and the wizard reads it from the
   * API — like a real Traefik.
   */
  entryPoint?: string;
  /** Serve plain HTTP instead of TLS. */
  plain?: boolean;
  /** Refuse every public request with a 403 of its own. */
  refuse?: boolean;
}

/** The host names a `Host(...)` rule matches. */
function hostsOfRule(rule: string | undefined): string[] {
  if (!rule) return [];
  return [...rule.matchAll(/Host\(`([^`]+)`\)/g)].map((match) => match[1]);
}

/** Parse the document the proxy polls: YAML or JSON. */
function parseDocument(body: string, contentType: string | undefined): DynamicDocument {
  if (contentType?.includes('json')) return JSON.parse(body) as DynamicDocument;
  return (parseYaml(body) ?? {}) as DynamicDocument;
}

/**
 * The proxy double.
 *
 * The API and the public listeners are separate: the API answers on a
 * free port, the public URLs on the ports a public URL uses (443 and
 * 80), so that a URL like `https://check.dev-gateway-setup.localhost`
 * reaches it.
 */
export class FakeTraefik {
  /** The port the API answers on. */
  apiPort = 0;
  /** The port the public URLs are served on, over TLS. */
  publicPort = 0;
  /** The port the public URLs are served on, over plain HTTP. */
  plainPort = 0;
  /** The routers the proxy has that did not come from the document. */
  readonly ownRouters: FakeRouter[] = [];
  /** The services the proxy has that did not come from the document. */
  readonly ownServices: FakeService[] = [];
  /** The documents the proxy polled, in order. */
  readonly polled: string[] = [];
  /** The requests the proxy served, as `host method path`. */
  readonly served: string[] = [];

  private readonly options: FakeProxyOptions;
  private readonly api: http.Server;
  private readonly publicServers: Array<http.Server | https.Server | net.Server> = [];
  private routers: FakeRouter[] = [];
  private services: FakeService[] = [];
  private middlewares: Record<string, FakeMiddleware> = {};
  private timer: NodeJS.Timeout | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: FakeProxyOptions = {}) {
    this.options = options;
    this.api = http.createServer((req, res) => this.serveApi(req, res));
  }

  /** Start the API and the public listener. */
  async start(): Promise<void> {
    this.apiPort = await listen(this.api, 0, '127.0.0.1');
    // The public listeners take a port of their own — the ports 80 and
    // 443 belong to the machine, not to the test — and both of the
    // loopback addresses, because the name of a route may resolve to
    // either of them. The wizard reads the ports from the API, the way
    // it does with a real proxy.
    //
    // There are two of them, one with TLS and one without: a proxy that
    // has both serves the routes on both.
    const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
      void this.servePublic(req, res);
    };
    for (const [secure, port] of [
      [true, 0],
      [false, 0],
    ] as Array<[boolean, number]>) {
      for (const host of ['::1', '127.0.0.1']) {
        try {
          const server = secure
            ? https.createServer(this.options.tls ?? {}, handler)
            : http.createServer(handler);
          const bound = await listen(server, port, host);
          if (secure) this.publicPort = bound;
          else this.plainPort = bound;
          this.publicServers.push(server);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'EADDRINUSE' && code !== 'EADDRNOTAVAIL' && code !== 'EACCES') throw error;
        }
      }
    }

    if (this.options.documentEndpoint) {
      this.setDocumentEndpoint(this.options.documentEndpoint);
    }
  }

  /** Stop every listener and the poller. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const server of this.publicServers) await close(server);
    await close(this.api);
  }

  /** Poll the dynamic configuration document from now on. */
  setDocumentEndpoint(endpoint: string): void {
    if (this.timer) clearInterval(this.timer);
    void this.poll(endpoint);
    this.timer = setInterval(() => void this.poll(endpoint), this.options.pollIntervalMs ?? 100);
    this.timer.unref?.();
  }

  /**
   * Read the document once, right now.
   *
   * The polls are queued: two of them at the same time would read the
   * document twice and race over what the proxy knows.
   */
  poll(endpoint: string): Promise<void> {
    this.queue = this.queue.then(() => this.readDocument(endpoint)).catch(() => {});
    return this.queue;
  }

  private async readDocument(endpoint: string): Promise<void> {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return;
      const body = await response.text();
      const document = parseDocument(body, response.headers.get('content-type') ?? undefined);
      this.polled.push(body);

      const http = document.http ?? {};
      this.routers = Object.entries(http.routers ?? {}).map(([name, router]) => ({
        ...router,
        name,
        provider: 'http',
        status: 'active',
      }));
      this.services = Object.entries(http.services ?? {}).map(([name, service]) => ({
        ...service,
        name,
        status: 'active',
      }));
      this.middlewares = http.middlewares ?? {};
    } catch {
      // A proxy that cannot reach the document keeps what it had.
    }
  }

  /** The routers the API reports. */
  apiRouters(): FakeRouter[] {
    return [...this.ownRouters, ...this.routers];
  }

  /** The services the API reports. */
  apiServices(): FakeService[] {
    return [...this.ownServices, ...this.services];
  }

  private serveApi(req: http.IncomingMessage, res: http.ServerResponse): void {
    const send = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = req.url ?? '/';
    if (url === '/api/version') return send({ Version: '3.7.16' });
    if (url === '/api/http/routers') return send(this.apiRouters());
    if (url === '/api/http/services') return send(this.apiServices());
    if (url === '/api/http/middlewares') return send(this.middlewares);
    if (url === '/api/entrypoints') {
      return send([
        { name: this.options.entryPoint ?? 'websecure', address: `:${this.publicPort}` },
        { name: 'web', address: `:${this.plainPort}` },
        { name: 'traefik', address: `:${this.apiPort}` },
      ]);
    }
    res.writeHead(404);
    res.end('not found');
  }

  /**
   * Serve a public request: find the router for the host, forward the
   * request to the service of that router.
   */
  private async servePublic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const host = (req.headers.host ?? '').split(':')[0];
    this.served.push(`${host} ${req.method ?? 'GET'} ${req.url ?? '/'}`);

    if (this.options.refuse) {
      // A proxy that refuses the request itself: an ipAllowList, a
      // forwardAuth, a middleware of its own. The answer is not the one
      // of the relay, and the wizard has to tell the two apart.
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden\n');
      return;
    }

    const router = this.apiRouters().find((candidate) => hostsOfRule(candidate.rule).includes(host));
    if (!router) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    const service = this.apiServices().find((candidate) => candidate.name === router.service);
    const target = service?.loadBalancer?.servers?.[0]?.url;
    if (!target) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('no service\n');
      return;
    }

    const headers: Record<string, string> = { host };
    for (const middleware of router.middlewares ?? []) {
      const name = middleware.split('@')[0];
      const custom = this.middlewares[name]?.headers?.customRequestHeaders;
      for (const [key, value] of Object.entries(custom ?? {})) headers[key] = value;
    }

    try {
      const response = await fetch(target + (req.url ?? '/'), {
        method: req.method ?? 'GET',
        headers,
        redirect: 'manual',
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'text/plain' });
      res.end(body);
    } catch (error) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`bad gateway: ${(error as Error).message}\n`);
    }
  }
}

/** Listen on a port and return it. */
function listen(server: http.Server | https.Server, port = 0, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

/** Close a server and wait for it. */
function close(server: http.Server | https.Server | net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}
