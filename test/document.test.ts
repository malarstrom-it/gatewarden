import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/core/state.ts';
import { buildDynamicConfig, objectName, middlewareName, renderDocument, findEmptyMapPaths, pruneEmptyMaps, type DynamicConfig } from '../src/adapters/traefik.ts';
import { DISPATCH_HEADER } from '../src/core/protocol.ts';
import { parseYaml } from './helpers/yaml.ts';
import { makeConfig } from './helpers/fixtures.ts';

function tempStore(): { store: RegistrationStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-doc-'));
  return { store: new RegistrationStore(dir), dir };
}

const ZONE = 'home.malarstrom.com';

/**
 * The HTTP section of a document.
 *
 * The section is absent from a document that holds nothing at all: a section
 * without entries is omitted, never rendered as an empty map.
 */
function httpOf(doc: DynamicConfig): NonNullable<DynamicConfig['http']> {
  assert.ok(doc.http, 'the document must have an HTTP section');
  return doc.http;
}

test('a registration produces exactly one router, one service and one middleware', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE, certResolver: '' });
  const registration = store.upsert({ project: 'alpha', branch: 'feature/login', devPort: 5173, zone: ZONE });

  const doc = buildDynamicConfig(store.list(), config);
  const names = Object.keys(httpOf(doc).routers);
  assert.equal(names.length, 1);
  assert.equal(names[0], objectName(registration));
  assert.ok(httpOf(doc).services[names[0]]);
  assert.ok(httpOf(doc).middlewares[middlewareName(registration)]);

  const router = httpOf(doc).routers[names[0]] as Record<string, unknown>;
  assert.equal(router['rule'], 'Host(`feature-login.alpha.home.malarstrom.com`)');
  assert.equal(router['service'], names[0]);
  assert.deepEqual(router['middlewares'], [middlewareName(registration)]);

  const service = httpOf(doc).services[names[0]] as { loadBalancer: { servers: Array<{ url: string }> } };
  assert.equal(service.loadBalancer.servers[0].url, `http://${config.advertisedHost || config.advertisedIp}:${config.relayPort}`);

  const middleware = httpOf(doc).middlewares[middlewareName(registration)] as {
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

  assert.ok(httpOf(before).routers[objectName(first)]);
  assert.ok(!httpOf(after).routers[objectName(first)]);
  assert.ok(!httpOf(after).services[objectName(first)]);
  assert.ok(!httpOf(after).middlewares[middlewareName(first)]);

  // The other registration is untouched.
  assert.deepEqual(httpOf(after).routers[objectName(second)], httpOf(before).routers[objectName(second)]);
  assert.deepEqual(httpOf(after).services[objectName(second)], httpOf(before).services[objectName(second)]);
  assert.deepEqual(httpOf(after).middlewares[middlewareName(second)], httpOf(before).middlewares[middlewareName(second)]);
});

test('registering the same project and branch again updates the port and creates no duplicate route', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const updated = store.upsert({ project: 'alpha', branch: 'main', devPort: 3001, zone: ZONE });

  assert.equal(store.list().length, 1);
  assert.equal(updated.devPort, 3001);

  const doc = buildDynamicConfig(store.list(), config);
  const routers = Object.keys(httpOf(doc).routers);
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
  for (const router of Object.values(httpOf(doc).routers)) {
    const rule = (router as { rule: string }).rule;
    assert.match(rule, /^Host\(`[^`*]+\.[^`*]+\.home\.malarstrom\.com`\)$/);
  }
});

test('a certificate resolver adds a per-project wildcard tls block', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE, certResolver: 'cloudflare', tlsMode: 'wildcard' });
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const doc = buildDynamicConfig(store.list(), config);
  const router = Object.values(httpOf(doc).routers).find((r) => (r as { rule: string }).rule.includes('alpha'));
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
  const router = Object.values(httpOf(doc).routers).find((r) => (r as { rule: string }).rule.includes('alpha'));
  assert.deepEqual((router as { tls: unknown }).tls, { certResolver: 'cloudflare' });
});

test('the shared middlewares of the file provider are only referenced when asked for', () => {
  const { store } = tempStore();
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });

  const plain = buildDynamicConfig(store.list(), makeConfig({ zone: ZONE }));
  const plainRouter = Object.values(httpOf(plain).routers).find((r) => (r as { rule: string }).rule.includes('alpha')) as {
    middlewares: string[];
  };
  assert.equal(plainRouter.middlewares.length, 1);

  const shared = buildDynamicConfig(
    store.list(),
    makeConfig({ zone: ZONE, securityHeaders: true, compressMiddleware: true }),
  );
  const sharedRouter = Object.values(httpOf(shared).routers).find((r) => (r as { rule: string }).rule.includes('alpha')) as {
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
  const urls = Object.values(httpOf(doc).services).flatMap((service) =>
    (service as { loadBalancer: { servers: Array<{ url: string }> } }).loadBalancer.servers.map((server) => server.url),
  );
  assert.ok(urls.includes('http://devbox:45001'), 'the relay service must use the advertised host');
  // The index router is gone (D8): nothing points at the registry any more.
  assert.ok(!urls.includes('http://devbox:45002'), 'nothing may point at the registry port');
});

test('object names are prefixed so they cannot collide with other providers', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });
  const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });
  const doc = buildDynamicConfig(store.list(), config);
  for (const name of Object.keys(httpOf(doc).routers)) assert.ok(name.startsWith('dev-'));
  assert.ok(objectName(registration).startsWith('dev-'));
});

test('a document without registrations contains no empty map', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });

  const doc = buildDynamicConfig(store.list(), config);
  assert.deepEqual(findEmptyMapPaths(doc), [], 'the document must not contain an empty map');

  // The sections are omitted, not rendered as an empty map.
  assert.equal(doc.http, undefined, 'a document without routes holds no section at all');

  const parsed = parseYaml(renderDocument(store.list(), config)) as Record<string, unknown>;
  assert.deepEqual(findEmptyMapPaths(parsed), []);
  assert.equal('http' in parsed, false, 'a document without routes holds nothing at all');
});

test('a document with one registration has exactly one non-empty router, service and middleware', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });
  const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: ZONE });

  const doc = buildDynamicConfig(store.list(), config);
  const routers = Object.entries(httpOf(doc).routers);
  const services = Object.entries(httpOf(doc).services);
  const middlewares = Object.entries(httpOf(doc).middlewares);

  assert.equal(routers.length, 1);
  assert.equal(services.length, 1);
  assert.equal(middlewares.length, 1);
  assert.equal(routers[0][0], objectName(registration));
  assert.equal(middlewares[0][0], middlewareName(registration));
  assert.ok(Object.keys(routers[0][1] as object).length > 0);
  assert.ok(Object.keys(services[0][1] as object).length > 0);
  assert.ok(Object.keys(middlewares[0][1] as object).length > 0);
  assert.deepEqual(findEmptyMapPaths(doc), []);
});

test('the renderer never produces an empty map, in any format', () => {
  const { store } = tempStore();
  const config = makeConfig({ zone: ZONE });

  for (const registrations of [[], ['one'], ['one', 'two']]) {
    const dir = tempStore();
    for (const name of registrations) {
      dir.store.upsert({ project: name, branch: 'main', devPort: 3000, zone: ZONE });
    }
    const doc = buildDynamicConfig(dir.store.list(), config);
    assert.deepEqual(findEmptyMapPaths(doc), [], `empty map in the object for ${registrations.length} registrations`);
    assert.deepEqual(
      findEmptyMapPaths(parseYaml(renderDocument(dir.store.list(), config))),
      [],
      `empty map in the YAML for ${registrations.length} registrations`,
    );
    const jsonConfig = makeConfig({ zone: ZONE, documentFormat: 'json' });
    assert.deepEqual(
      findEmptyMapPaths(JSON.parse(renderDocument(dir.store.list(), jsonConfig))),
      [],
      `empty map in the JSON for ${registrations.length} registrations`,
    );
    void store;
  }
});

test('pruneEmptyMaps drops empty maps at any depth and keeps the rest', () => {
  const pruned = pruneEmptyMaps({
    keep: { a: 1 },
    drop: {},
    nested: { drop: {}, keep: { b: 2 } },
    list: [{ drop: {} }, { keep: 3 }],
  });
  assert.deepEqual(pruned, {
    keep: { a: 1 },
    nested: { keep: { b: 2 } },
    list: [{ keep: 3 }],
  });
});
