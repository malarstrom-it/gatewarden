/**
 * Creating a route by hand from the index page.
 *
 * The client can now make a route without an agent: the page posts it to
 * `POST /api/registrations`, the registry writes the same state file the
 * CLI writes, and the route becomes an ordinary route.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/state.ts';
import { createRegistryServer, UI_HEADER } from '../src/registry.ts';
import { close, listen, makeConfig } from './helpers/fixtures.ts';

function tempStore(): RegistrationStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-create-'));
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

/** Post a route the way the index page does. */
function create(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}/api/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [UI_HEADER]: '1', ...headers },
    body: JSON.stringify(body),
  });
}

test('a route created from the page is stored and served', async () => {
  await withRegistry({}, async ({ url, store }) => {
    const response = await create(url, { project: 'alpha', branch: 'feature/login', port: 5173 });
    assert.equal(response.status, 201);

    const created = (await response.json()) as { id: string; fqdn: string; devPort: number };
    assert.equal(created.id, 'alpha/feature-login');
    assert.equal(created.fqdn, 'feature-login.alpha.home.malarstrom.com');
    assert.equal(created.devPort, 5173);

    // The daemon owns the state, so the route is in the store the CLI lists.
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].id, 'alpha/feature-login');

    // And the Traefik document carries it.
    const document = await (await fetch(`${url}/traefik`)).text();
    assert.match(document, /feature-login\.alpha\.home\.malarstrom\.com/);
    assert.match(document, /alpha\/feature-login/);
  });
});

test('the project and branch are slugged the way the CLI slugs them', async () => {
  await withRegistry({}, async ({ url }) => {
    const response = await create(url, { project: 'Alpha App', branch: 'Feature/Login', port: 5173 });
    assert.equal(response.status, 201);
    const created = (await response.json()) as { id: string; fqdn: string };
    assert.equal(created.id, 'alpha-app/feature-login');
    assert.equal(created.fqdn, 'feature-login.alpha-app.home.malarstrom.com');
  });
});

test('a port that is not a port is refused with a reason', async () => {
  await withRegistry({}, async ({ url, store }) => {
    for (const port of ['not-a-port', 0, 70000, 12.5]) {
      const response = await create(url, { project: 'alpha', branch: 'main', port });
      assert.equal(response.status, 400, `port ${port} must be refused`);
      const body = (await response.json()) as { error: string; field: string };
      assert.match(body.error, /port/i);
      assert.equal(body.field, 'port');
    }
    assert.equal(store.list().length, 0);
  });
});

test('a route that already exists is a conflict, not an update', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 5173, zone: 'home.malarstrom.com' });

    const response = await create(url, { project: 'alpha', branch: 'main', port: 9999 });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: string; field: string };
    assert.match(body.error, /already points at 127\.0\.0\.1:5173/);
    assert.equal(body.field, 'branch');

    // The route the client can see is untouched.
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].devPort, 5173);
  });
});

test('without the UI header nothing is created', async () => {
  await withRegistry({}, async ({ url, store }) => {
    const response = await fetch(`${url}/api/registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'alpha', branch: 'main', port: 5173 }),
    });
    assert.equal(response.status, 403);
    assert.equal(store.list().length, 0);
  });
});

test('the gateway’s own ports are refused', async () => {
  await withRegistry({ registryPort: 45002, relayPort: 45001 }, async ({ url, store }) => {
    for (const port of [45002, 45001]) {
      const response = await create(url, { project: 'alpha', branch: 'main', port });
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: string; field: string };
      assert.match(body.error, /gateway/i);
      assert.equal(body.field, 'port');
    }
    assert.equal(store.list().length, 0);
  });
});

test('a route without a project or a branch is refused', async () => {
  await withRegistry({}, async ({ url, store }) => {
    const noProject = await create(url, { project: '', branch: 'main', port: 5173 });
    assert.equal(noProject.status, 400);
    assert.equal(((await noProject.json()) as { field: string }).field, 'project');

    const noBranch = await create(url, { project: 'alpha', branch: '!!!', port: 5173 });
    assert.equal(noBranch.status, 400);
    assert.equal(((await noBranch.json()) as { field: string }).field, 'branch');

    assert.equal(store.list().length, 0);
  });
});

test('the page has a label for every field of the new-route form', async () => {
  await withRegistry({}, async ({ url }) => {
    const html = await (await fetch(`${url}/`)).text();
    for (const field of ['project', 'branch', 'port']) {
      assert.match(html, new RegExp(`<label[^>]*for="new-route-${field}"`), `${field} has a label`);
      assert.match(html, new RegExp(`id="new-route-${field}"`), `${field} has an input`);
    }
    // The control that reveals the panel says what it controls.
    assert.match(html, /id="new-route-toggle"[^>]*aria-expanded="false"/);
    assert.match(html, /aria-controls="new-route"/);
    // The port field asks for a numeric keyboard.
    assert.match(html, /id="new-route-port"[\s\S]*?inputmode="numeric"/);
  });
});
