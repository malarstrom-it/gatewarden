import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/core/state.ts';
import { createRegistryServer } from '../src/core/registry.ts';
import { traefikAdapter } from '../src/adapters/traefik.ts';
import { formatAge, plural, renderRoutes } from '../src/core/index-page.ts';
import { close, listen, makeConfig } from './helpers/fixtures.ts';

function tempStore(): RegistrationStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-index-'));
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

test('the index page shows the empty state when nothing is registered', async () => {
  await withRegistry({}, async ({ url }) => {
    const html = await (await fetch(`${url}/`)).text();
    assert.match(html, /Nothing is running/);
    assert.match(html, /traefik-dev\.js register --project/);
    assert.ok(!html.includes('data-registration-id='));
  });
});

test('the empty state offers the command as a copyable snippet', async () => {
  await withRegistry({}, async ({ url }) => {
    const html = await (await fetch(`${url}/`)).text();
    assert.match(html, /class="btn btn-primary copy" data-copy="node [^"]*traefik-dev\.js register/);
    assert.match(html, />Copy command</);
  });
});

test('every route carries a status indicator', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    const html = await (await fetch(`${url}/`)).text();
    assert.match(html, /class="route-body[^"]*" data-registration-id="alpha\/main" data-state="down"/);
    assert.match(html, /class="route-state badge">Down</);
  });
});

test('a route whose dev server listens is reported as answering', async () => {
  await withRegistry({}, async ({ url, store }) => {
    const server = (await import('node:http')).createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const port = await listen(server);
    try {
      store.upsert({ project: 'alpha', branch: 'main', devPort: port, zone: 'home.malarstrom.com' });
      const html = await (await fetch(`${url}/`)).text();
      assert.match(html, /data-state="up"/);
      assert.match(html, /class="route-state badge">Up</);
    } finally {
      await close(server);
    }
  });
});

test('every route can be copied and removed', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: 'home.malarstrom.com' });
    const html = await (await fetch(`${url}/`)).text();
    assert.match(html, /class="[^"]*\bcopy\b[^"]*" data-copy="https:\/\/feature-login\.alpha\.home\.malarstrom\.com"/);
    assert.match(html, /aria-label="Copy address"/);
    assert.match(html, /class="[^"]*\bremove\b[^"]*" data-registration-id="alpha\/feature-login"/);
  });
});

test('every route keeps its registration id', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    store.upsert({ project: 'beta', branch: 'feature/x', devPort: 5173, zone: 'home.malarstrom.com' });
    const html = await (await fetch(`${url}/`)).text();
    assert.match(html, /data-registration-id="alpha\/main"/);
    assert.match(html, /data-registration-id="beta\/feature-x"/);
    // once on the row itself, once on its remove control
    assert.equal((html.match(/data-registration-id="/g) ?? []).length, 4);
  });
});

test('the routes are grouped by project and named after their certificate', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    store.upsert({ project: 'alpha', branch: 'feature/x', devPort: 5173, zone: 'home.malarstrom.com' });
    store.upsert({ project: 'beta', branch: 'main', devPort: 4000, zone: 'home.malarstrom.com' });
    const html = await (await fetch(`${url}/`)).text();
    assert.equal((html.match(/<section class="card overflow-hidden" data-project-slug=/g) ?? []).length, 2);
    assert.match(html, /<code>\*\.alpha\.home\.malarstrom\.com<\/code>/);
    assert.match(html, /<code>\*\.beta\.home\.malarstrom\.com<\/code>/);
    assert.match(html, /2 routes/);
    assert.match(html, /1 route</);
  });
});

test('the registration list reports the state of every route', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    const response = await fetch(`${url}/api/registrations`);
    const body = (await response.json()) as {
      registrations: Array<{ id: string; state: string }>;
      checkedAt: string;
    };
    assert.equal(body.registrations.length, 1);
    assert.equal(body.registrations[0].state, 'down');
    assert.ok(Date.parse(body.checkedAt) > 0);
  });
});

test('a host name may break at its dots, never inside a label', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    const html = await (await fetch(`${url}/`)).text();
    assert.match(html, /main\.<wbr>alpha\.<wbr>home\.<wbr>malarstrom\.<wbr>com/);
    // The text of the link is still the host name itself.
    const link = /<a class="route-address link break-words"[^>]*>(.*?)<\/a>/.exec(html)?.[1] ?? '';
    assert.equal(link.replace(/<wbr>/g, ''), 'main.alpha.home.malarstrom.com');
  });
});

test('the route fragment holds the same rows as the page', async () => {
  await withRegistry({}, async ({ url, store }) => {
    store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'home.malarstrom.com' });
    const fragment = await (await fetch(`${url}/api/routes`)).text();
    assert.match(fragment, /data-registration-id="alpha\/main"/);
    assert.match(fragment, /class="[^"]*\bremove\b[^"]*"/);
    assert.ok(!fragment.includes('<html'));
  });
});

test('the page assets are served by the registry itself', async () => {
  await withRegistry({}, async ({ url }) => {
    const css = await fetch(`${url}/index.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
    assert.match(await css.text(), /font-family: 'Hanken Grotesk'/);

    const script = await fetch(`${url}/index.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);

    const font = await fetch(`${url}/fonts/hanken-grotesk-latin.woff2`);
    assert.equal(font.status, 200);
    assert.match(font.headers.get('content-type') ?? '', /woff2/);
    assert.ok((await font.arrayBuffer()).byteLength > 1000);
  });
});

test('the page asks for no third party asset', async () => {
  await withRegistry({}, async ({ url }) => {
    const html = await (await fetch(`${url}/`)).text();
    assert.ok(!/https?:\/\/(?!localhost|127\.0\.0\.1)[^"'\s]*\.(com|net|org|io)/.test(html.replace(/https:\/\/[^"'\s]*malarstrom\.com/g, '')));
    assert.ok(!html.includes('fonts.googleapis.com'));
    assert.ok(!html.includes('fonts.gstatic.com'));
  });
});

test('unknown asset paths are answered with 404', async () => {
  await withRegistry({}, async ({ url }) => {
    assert.equal((await fetch(`${url}/index.js.map`)).status, 404);
    assert.equal((await fetch(`${url}/fonts/nope.woff2`)).status, 404);
  });
});

test('ages are written in words', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(formatAge('2026-10-23T11:59:50Z', now), 'just now');
  assert.equal(formatAge('2026-10-23T11:58:00Z', now), '2 minutes ago');
  assert.equal(formatAge('2026-10-23T09:00:00Z', now), '3 hours ago');
  assert.equal(formatAge('2026-10-20T12:00:00Z', now), '3 days ago');
  assert.equal(plural(1, 'route', 'routes'), 'route');
  assert.equal(plural(2, 'route', 'routes'), 'routes');
});

test('the route renderer escapes what it prints', () => {
  const html = renderRoutes(
    [
      {
        registration: {
          id: 'alpha/main',
          project: 'alpha',
          branch: 'main',
          projectSlug: 'alpha',
          branchSlug: 'main',
          fqdn: 'main.alpha.home.malarstrom.com',
          devPort: 3000,
          label: '<script>alert(1)</script>',
          createdAt: '2026-10-23T12:00:00Z',
          updatedAt: '2026-10-23T12:00:00Z',
        },
        state: 'up',
      },
    ],
    makeConfig({}),
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});
