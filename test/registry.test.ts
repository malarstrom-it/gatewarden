/**
 * The registry (D9, §10.1).
 *
 * The registry serves exactly two endpoints: the dynamic configuration
 * document and the health probe. The web interface is gone (D8), and with
 * it the JSON route list, the assets and the create and delete endpoints:
 * the extension, the CLI and the MCP server write the state file directly.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/core/state.ts';
import { createRegistryServer } from '../src/core/registry.ts';
import { traefikAdapter } from '../src/adapters/traefik.ts';
import { REGISTRY_SECRET_HEADER } from '../src/core/protocol.ts';
import { close, listen, makeConfig } from './helpers/fixtures.ts';

function tempStore(): RegistrationStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-registry-'));
  return new RegistrationStore(dir);
}

async function withRegistry<T>(
  overrides: Parameters<typeof makeConfig>[0],
  run: (ctx: { url: string; store: RegistrationStore }) => Promise<T>,
): Promise<T> {
  const store = tempStore();
  const server = createRegistryServer(store, makeConfig(overrides), traefikAdapter);
  const port = await listen(server);
  try {
    return await run({ url: `http://127.0.0.1:${port}`, store });
  } finally {
    await close(server);
  }
}

test('the registry answers the health probe', async () => {
  await withRegistry({}, async ({ url }) => {
    const response = await fetch(`${url}/healthz`);
    assert.equal(response.status, 200);
    assert.equal((await response.text()).trim(), 'ok');
  });
});

test('the dynamic configuration document is served on /traefik', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    const response = await fetch(`${url}/traefik`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /Host\(`main\.alpha\.home\.malarstrom\.com`\)/);
  });
});

test('the dynamic configuration document is protected by the registry secret', async () => {
  await withRegistry({ secret: 'topsecret' }, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    const denied = await fetch(`${url}/traefik`);
    assert.equal(denied.status, 403);

    const allowed = await fetch(`${url}/traefik`, { headers: { [REGISTRY_SECRET_HEADER]: 'topsecret' } });
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /http:/);
  });
});

test('the registry answers only the configuration path and the health probe', async () => {
  await withRegistry({}, async ({ url }) => {
    const gone = [
      '/',
      '/index.html',
      '/index.css',
      '/index.js',
      '/fonts/hanken-grotesk-latin.woff2',
      '/api/registrations',
      '/api/routes',
      '/favicon.ico',
      '/nope',
    ];
    for (const pathname of gone) {
      const response = await fetch(`${url}${pathname}`);
      assert.equal(response.status, 404, `${pathname} must not be answered any more`);
    }
  });
});

test('the registry refuses methods other than GET and HEAD', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });

    const posted = await fetch(`${url}/api/registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Gateway-UI': '1' },
      body: JSON.stringify({ project: 'beta', branch: 'main', port: 4000 }),
    });
    assert.equal(posted.status, 405);
    assert.equal(posted.headers.get('allow'), 'GET, HEAD');

    const deleted = await fetch(`${url}/api/registrations/alpha/main`, {
      method: 'DELETE',
      headers: { 'X-Gateway-UI': '1' },
    });
    assert.equal(deleted.status, 405);

    // The store is untouched: the registry has no write path any more.
    assert.equal(store.list().length, 1);
  });
});

test('unknown paths are answered with 404', async () => {
  await withRegistry({}, async ({ url }) => {
    const response = await fetch(`${url}/nope`);
    assert.equal(response.status, 404);
  });
});

test('the registry only binds what is asked for', async () => {
  const store = tempStore();
  const server = createRegistryServer(store, makeConfig({}), traefikAdapter);
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  const address = server.address() as { address: string; port: number };
  assert.equal(address.address, '0.0.0.0');
  await close(server);
});

test('the registry answers http/1.1 requests from a raw client', async () => {
  await withRegistry({}, async ({ url }) => {
    const body = await new Promise<string>((resolve, reject) => {
      const request = http.get(url + '/healthz', (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
    });
    assert.equal(body.trim(), 'ok');
  });
});
