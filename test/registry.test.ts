import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/state.ts';
import { createRegistryServer } from '../src/registry.ts';
import { REGISTRY_SECRET_HEADER } from '../src/document.ts';
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
  const server = createRegistryServer(store, makeConfig(overrides));
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

test('the registry serves the registrations as JSON', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: 'home.malarstrom.com' });
    const response = await fetch(`${url}/api/registrations`);
    const body = (await response.json()) as { registrations: Array<{ fqdn: string; devPort: number }> };
    assert.equal(body.registrations.length, 1);
    assert.equal(body.registrations[0].fqdn, 'feature-login.alpha.home.malarstrom.com');
    assert.equal(body.registrations[0].devPort, 5173);
  });
});

test('the index page lists every registration with a clickable link', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: 'home.malarstrom.com' });
    const response = await fetch(`${url}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.match(html, /https:\/\/feature-login\.alpha\.home\.malarstrom\.com/);
    assert.match(html, /alpha/);
    assert.match(html, /feature-login/);
    assert.match(html, /5173/);
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

test('unknown paths are answered with 404', async () => {
  await withRegistry({}, async ({ url }) => {
    const response = await fetch(`${url}/nope`);
    assert.equal(response.status, 404);
  });
});

test('the index page survives registrations with html in their label', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({
      project: 'alpha',
      branch: 'main',
      devPort: 3000,
      label: '<script>alert(1)</script>',
      zone: 'home.malarstrom.com',
    });
    const response = await fetch(`${url}/`);
    const html = await response.text();
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;/);
  });
});

test('the registry only binds what is asked for', async () => {
  const store = tempStore();
  const server = createRegistryServer(store, makeConfig({}));
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  const address = server.address() as { address: string; port: number };
  assert.equal(address.address, '0.0.0.0');
  await close(server);
});

test('the registry refuses methods other than GET', async () => {
  await withRegistry({}, async ({ url }) => {
    const response = await fetch(`${url}/`, { method: 'POST' });
    assert.equal(response.status, 405);
  });
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
