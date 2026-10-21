/** Shared test fixtures. */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CONFIG } from '../../src/config.ts';
import type { Config } from '../../src/types.ts';

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    stateDir: '/tmp/traefik-dev-test',
    registryPort: 0,
    relayPort: 0,
    ...overrides,
  };
}

/** Listen on an ephemeral port and return it. */
export function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

/** Close a server and wait for it. */
export function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A simple dev server that reports the headers it received. */
export async function startDevServer(
  handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(
    handler ??
      ((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(JSON.stringify({ url: req.url, method: req.method, headers: req.headers }));
      }),
  );
  const port = await listen(server);
  return {
    port,
    close: () => close(server),
  };
}
