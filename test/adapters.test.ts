/**
 * The proxy adapter (D3, §4.2).
 *
 * The Traefik adapter is the one implementation the package has. It renders
 * the dynamic configuration, it finds the proxy and it says what the user
 * has to add to the proxy.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { adapterFor, adapterIds, requireAdapter, traefikAdapter } from '../src/adapters/index.ts';
import { deriveZone, discoverTraefik, traefikWiringSnippet } from '../src/adapters/traefik.ts';
import type { ProxyAdapter } from '../src/adapters/types.ts';
import { createRegistryServer } from '../src/core/registry.ts';
import { RegistrationStore } from '../src/core/state.ts';
import { close, listen, makeConfig } from './helpers/fixtures.ts';

/** A fake Traefik API. */
async function fakeTraefik(
  routers: unknown[],
  version = '3.7.16',
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ Version: version }));
      return;
    }
    if (req.url === '/api/http/routers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(routers));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('the Traefik adapter implements the contract', () => {
  assert.equal(traefikAdapter.id, 'traefik');
  assert.equal(typeof traefikAdapter.render, 'function');
  assert.equal(typeof traefikAdapter.discover, 'function');
  assert.equal(typeof traefikAdapter.wiringSnippet, 'function');
});

test('the catalog knows the Traefik adapter and nothing else', () => {
  assert.deepEqual(adapterIds(), ['traefik']);
  assert.equal(adapterFor('traefik'), traefikAdapter);
  assert.equal(adapterFor('caddy'), undefined);
  assert.equal(requireAdapter('traefik'), traefikAdapter);
  assert.throws(() => requireAdapter('caddy'), /unknown proxy "caddy"/);
});

test('the zone is the longest common suffix of the host names', () => {
  assert.equal(deriveZone(['feature-login.alpha.home.malarstrom.com', 'main.beta.home.malarstrom.com']), 'home.malarstrom.com');
  assert.equal(deriveZone(['index.home.malarstrom.com']), 'home.malarstrom.com');
  assert.equal(deriveZone(['a.example.com', 'b.example.com']), 'example.com');
  assert.equal(deriveZone([]), undefined);
  assert.equal(deriveZone(['localhost']), undefined);
});

test('discover reads the version and derives the values from the routers', async (t) => {
  const traefik = await fakeTraefik([
    {
      rule: 'Host(`feature-login.alpha.home.malarstrom.com`)',
      entryPoints: ['websecure'],
      middlewares: ['devhdr-alpha', 'default-security-headers@file'],
      tls: { certResolver: 'cloudflare' },
    },
    {
      rule: 'Host(`main.beta.home.malarstrom.com`)',
      entryPoints: ['websecure'],
      middlewares: ['devhdr-beta'],
      tls: { certResolver: 'cloudflare' },
    },
  ]);
  t.after(() => traefik.close());

  const info = await discoverTraefik({ apiBaseUrl: traefik.baseUrl });

  assert.ok(info);
  assert.equal(info.id, 'traefik');
  assert.equal(info.version, '3.7.16');
  assert.equal(info.derived.zone, 'home.malarstrom.com');
  assert.deepEqual(info.derived.entryPoints, ['websecure']);
  assert.equal(info.derived.certResolver, 'cloudflare');
  assert.equal(info.derived.middlewareProvider, 'file');
});

test('discover answers undefined when no proxy answers', async () => {
  const info = await discoverTraefik({ apiBaseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
  assert.equal(info, undefined);
});

test('the wiring snippet names the endpoint the proxy has to poll', () => {
  const config = makeConfig({
    advertisedHost: 'devbox',
    registryPort: 45002,
    relayPort: 45001,
    entryPoints: ['websecure'],
    certResolver: 'cloudflare',
  });

  const snippet = traefikWiringSnippet(config);

  assert.match(snippet, /endpoint: "http:\/\/devbox:45002\/traefik"/);
  assert.match(snippet, /pollInterval/);
  assert.match(snippet, /cloudflare/);
});

test('the registry serves the document under the id of the adapter', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-adapter-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = new RegistrationStore(dir);
  const config = makeConfig({ stateDir: dir, zone: 'gwtest.local' });

  // A second proxy, with a document of its own.
  const other: ProxyAdapter = {
    id: 'otherproxy',
    discover: async () => undefined,
    render: () => 'http: {}\n',
    wiringSnippet: () => '',
  };

  const server = createRegistryServer(store, config, other);
  const port = await listen(server);
  t.after(() => close(server));

  const served = await (await fetch(`http://127.0.0.1:${port}/otherproxy`)).text();
  assert.equal(served, 'http: {}\n');

  // The Traefik path is the Traefik adapter's, not the core's.
  const missing = await fetch(`http://127.0.0.1:${port}/traefik`);
  assert.equal(missing.status, 404);
});
