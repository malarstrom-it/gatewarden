import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/state.ts';
import { buildDynamicConfig, objectName, middlewareName, renderDocument, DISPATCH_HEADER } from '../src/document.ts';
import { parseYaml } from './helpers/yaml.ts';
import { makeConfig } from './helpers/fixtures.ts';

function tempStore(): { store: RegistrationStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-doc-'));
  return { store: new RegistrationStore(dir), dir };
}

const ZONE = 'home.malarstrom.com';

test('a registration produces exactly one router, one service and one middleware', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE, certResolver: '' });
  const registration = store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: ZONE });

  const doc = buildDynamicConfig(store.list(), config);
  const names = Object.keys(doc.http.routers).filter((name) => name !== 'dev-index');
  assert.equal(names.length, 1);
  assert.equal(names[0], objectName(registration));
  assert.ok(doc.http.services[names[0]]);
  assert.ok(doc.http.middlewares[middlewareName(registration)]);

  const router = doc.http.routers[names[0]] as Record<string, unknown>;
  assert.equal(router['rule'], 'Host(`feature-login.alpha.home.malarstrom.com`)');
  assert.equal(router['service'], names[0]);
  assert.deepEqual(router['middlewares'], [middlewareName(registration)]);

  const service = doc.http.services[names[0]] as { loadBalancer: { servers: Array<{ url: string }> } };
  assert.equal(service.loadBalancer.servers[0].url, `http://${config.advertisedIp}:${config.relayPort}`);

  const middleware = doc.http.middlewares[middlewareName(registration)] as {
    headers: { customRequestHeaders: Record<string, string> };
  };
  assert.equal(middleware.headers.customRequestHeaders[DISPATCH_HEADER], registration.id);
});

test('unregister removes exactly its own objects and leaves the others untouched', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const second = store.upsert({ project: 'beta', branch: 'feature/x', devPort: 4000, zone: ZONE });
  const first = store.list().find((r) => r.projectSlug === 'alpha')!;

  const before = buildDynamicConfig(store.list(), config);
  assert.ok(store.remove('alpha', 'main'));
  const after = buildDynamicConfig(store.list(), config);

  assert.ok(before.http.routers[objectName(first)]);
  assert.ok(!after.http.routers[objectName(first)]);
  assert.ok(!after.http.services[objectName(first)]);
  assert.ok(!after.http.middlewares[middlewareName(first)]);

  // The other registration is untouched.
  assert.deepEqual(after.http.routers[objectName(second)], before.http.routers[objectName(second)]);
  assert.deepEqual(after.http.services[objectName(second)], before.http.services[objectName(second)]);
  assert.deepEqual(after.http.middlewares[middlewareName(second)], before.http.middlewares[middlewareName(second)]);
});

test('registering the same project and branch again updates the port and creates no duplicate route', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const updated = store.upsert({ project: 'alpha', branch: 'main', devPort: 3001, zone: ZONE });

  assert.equal(store.list().length, 1);
  assert.equal(updated.devPort, 3001);

  const doc = buildDynamicConfig(store.list(), config);
  const routers = Object.keys(doc.http.routers).filter((name) => name !== 'dev-index');
  assert.equal(routers.length, 1);
});

test('the rendered YAML document parses back to the same object', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE, certResolver: 'cloudflare' });
  store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: ZONE });

  const yaml = renderDocument(store.list(), config);
  const parsed = parseYaml(yaml) as ReturnType<typeof buildDynamicConfig>;
  assert.deepEqual(parsed, buildDynamicConfig(store.list(), config));
});

test('the rendered JSON document parses', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE, documentFormat: 'json' });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const json = renderDocument(store.list(), config);
  assert.deepEqual(JSON.parse(json), buildDynamicConfig(store.list(), config));
});

test('every router rule is an exact Host rule', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  store.upsert({ project: 'beta', branch: 'feature/x', devPort: 4000, zone: ZONE });

  const doc = buildDynamicConfig(store.list(), config);
  for (const [name, router] of Object.entries(doc.http.routers)) {
    if (name === 'dev-index') continue;
    const rule = (router as { rule: string }).rule;
    assert.match(rule, /^Host\(`[^`*]+\.[^`*]+\.home\.malarstrom\.com`\)$/);
  }
});

test('a certificate resolver adds a per-project wildcard tls block', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE, certResolver: 'cloudflare', tlsMode: 'wildcard' });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const doc = buildDynamicConfig(store.list(), config);
  const router = Object.values(doc.http.routers).find((r) => (r as { rule: string }).rule.includes('alpha'));
  assert.deepEqual((router as { tls: unknown }).tls, {
    certResolver: 'cloudflare',
    domains: [{ main: '*.alpha.home.malarstrom.com' }],
  });
});

test('tlsMode fqdn asks for a per-branch certificate', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE, certResolver: 'cloudflare', tlsMode: 'fqdn' });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const doc = buildDynamicConfig(store.list(), config);
  const router = Object.values(doc.http.routers).find((r) => (r as { rule: string }).rule.includes('alpha'));
  assert.deepEqual((router as { tls: unknown }).tls, { certResolver: 'cloudflare' });
});

test('the shared middlewares of the file provider are only referenced when asked for', () => {
  const { store } = tempStore();
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });

  const plain = buildDynamicConfig(store.list(), makeConfig({ zone: ZONE }));
  const plainRouter = Object.values(plain.http.routers).find((r) => (r as { rule: string }).rule.includes('alpha')) as {
    middlewares: string[];
  };
  assert.equal(plainRouter.middlewares.length, 1);

  const shared = buildDynamicConfig(
    store.list(),
    makeConfig({ zone: ZONE, securityHeaders: true, compressMiddleware: true }),
  );
  const sharedRouter = Object.values(shared.http.routers).find((r) => (r as { rule: string }).rule.includes('alpha')) as {
    middlewares: string[];
  };
  assert.ok(sharedRouter.middlewares.includes('default-security-headers@file'));
  assert.ok(sharedRouter.middlewares.includes('compress@file'));
});

test('the service URL uses the advertised host', () => {
  const { store } = tempStore();
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const doc = buildDynamicConfig(
    store.list(),
    makeConfig({ zone: ZONE, advertisedHost: 'devbox', relayPort: 45001, registryPort: 45002 }),
  );
  const urls = Object.values(doc.http.services).flatMap((service) =>
    (service as { loadBalancer: { servers: Array<{ url: string }> } }).loadBalancer.servers.map((server) => server.url),
  );
  assert.ok(urls.includes('http://devbox:45001'), 'the relay service must use the advertised host');
  assert.ok(urls.includes('http://devbox:45002'), 'the index service must use the advertised host');
});

test('object names are prefixed so they cannot collide with other providers', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });
  const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const doc = buildDynamicConfig(store.list(), config);
  for (const name of Object.keys(doc.http.routers)) assert.ok(name.startsWith('dev-'));
  assert.ok(objectName(registration).startsWith('dev-'));
});
