import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/state.ts';
import { createRelayServer } from '../src/relay.ts';
import { DISPATCH_HEADER, RELAY_SECRET_HEADER } from '../src/document.ts';
import { close, listen, makeConfig, startDevServer } from './helpers/fixtures.ts';

function tempStore(): RegistrationStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-relay-'));
  return new RegistrationStore(dir);
}

async function withRelay<T>(
  configOverrides: Parameters<typeof makeConfig>[0],
  run: (ctx: { url: string; store: RegistrationStore }) => Promise<T>,
): Promise<T> {
  const store = tempStore();
  const config = makeConfig(configOverrides);
  const server = createRelayServer(store, config);
  const port = await listen(server);
  try {
    return await run({ url: `http://127.0.0.1:${port}`, store });
  } finally {
    await close(server);
  }
}

test('the relay dispatches to the right dev server', async () => {
  await withRelay({}, async ({ url, store }) => {
    const first = await startDevServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('first');
    });
    const second = await startDevServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('second');
    });
    try {
      const one = store.upsert({ project: 'alpha', branch: 'main', devPort: first.port, zone: 'home.malarstrom.com' });
      const two = store.upsert({ project: 'beta', branch: 'main', devPort: second.port, zone: 'home.malarstrom.com' });

      const responseOne = await fetch(`${url}/some/path?x=1`, { headers: { [DISPATCH_HEADER]: one.id } });
      assert.equal(await responseOne.text(), 'first');

      const responseTwo = await fetch(`${url}/other`, { headers: { [DISPATCH_HEADER]: two.id } });
      assert.equal(await responseTwo.text(), 'second');
    } finally {
      await first.close();
      await second.close();
    }
  });
});

test('the relay forwards the method, path and body', async () => {
  await withRelay({}, async ({ url, store }) => {
    let seen: { method?: string; url?: string; body: string } | null = null;
    const dev = await startDevServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        seen = { method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') };
        res.writeHead(201, { 'content-type': 'text/plain' });
        res.end('created');
      });
    });
    try {
      const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: dev.port, zone: 'home.malarstrom.com' });
      const response = await fetch(`${url}/api/items?a=b`, {
        method: 'POST',
        headers: { [DISPATCH_HEADER]: registration.id, 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });
      assert.equal(response.status, 201);
      assert.equal(await response.text(), 'created');
      assert.deepEqual(seen, { method: 'POST', url: '/api/items?a=b', body: '{"hello":"world"}' });
    } finally {
      await dev.close();
    }
  });
});

test('an unknown dispatch id is answered with 404', async () => {
  await withRelay({}, async ({ url }) => {
    const response = await fetch(`${url}/`, { headers: { [DISPATCH_HEADER]: 'alpha/does-not-exist' } });
    assert.equal(response.status, 404);
    assert.match(await response.text(), /unknown registration/);
  });
});

test('a missing dispatch header is answered with 404', async () => {
  await withRelay({}, async ({ url }) => {
    const response = await fetch(`${url}/`);
    assert.equal(response.status, 404);
  });
});

test('a source address outside the allowed CIDRs is answered with 403', async () => {
  await withRelay({ allowedCidrs: ['10.99.0.0/16'] }, async ({ url, store }) => {
    const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: 9999, zone: 'home.malarstrom.com' });
    const response = await fetch(`${url}/`, { headers: { [DISPATCH_HEADER]: registration.id } });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /forbidden/);
  });
});

test('a wrong relay secret is answered with 403, the right one passes', async () => {
  await withRelay({ secret: 's3cret' }, async ({ url, store }) => {
    const dev = await startDevServer((_req, res) => res.end('ok'));
    try {
      const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: dev.port, zone: 'home.malarstrom.com' });
      const denied = await fetch(`${url}/`, { headers: { [DISPATCH_HEADER]: registration.id } });
      assert.equal(denied.status, 403);

      const allowed = await fetch(`${url}/`, {
        headers: { [DISPATCH_HEADER]: registration.id, [RELAY_SECRET_HEADER]: 's3cret' },
      });
      assert.equal(allowed.status, 200);
      assert.equal(await allowed.text(), 'ok');
    } finally {
      await dev.close();
    }
  });
});

test('X-Forwarded-* headers pass through untouched', async () => {
  await withRelay({}, async ({ url, store }) => {
    let headers: http.IncomingHttpHeaders | null = null;
    const dev = await startDevServer((req, res) => {
      headers = req.headers;
      res.end('ok');
    });
    try {
      const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: dev.port, zone: 'home.malarstrom.com' });
      await fetch(`${url}/`, {
        headers: {
          [DISPATCH_HEADER]: registration.id,
          'x-forwarded-for': '10.10.1.77',
          'x-real-ip': '10.10.1.77',
          'x-forwarded-host': 'feature-login.alpha.home.malarstrom.com',
          'x-forwarded-port': '443',
          'x-forwarded-proto': 'https',
          'x-forwarded-server': 'traefik',
        },
      });
      assert.ok(headers);
      const received = headers as http.IncomingHttpHeaders;
      assert.equal(received['x-forwarded-for'], '10.10.1.77');
      assert.equal(received['x-real-ip'], '10.10.1.77');
      assert.equal(received['x-forwarded-host'], 'feature-login.alpha.home.malarstrom.com');
      assert.equal(received['x-forwarded-port'], '443');
      assert.equal(received['x-forwarded-proto'], 'https');
      assert.equal(received['x-forwarded-server'], 'traefik');
    } finally {
      await dev.close();
    }
  });
});

test('a dev server that is not listening is answered with 502 and a clear message', async () => {
  await withRelay({}, async ({ url, store }) => {
    const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: 9, zone: 'home.malarstrom.com' });
    const response = await fetch(`${url}/`, { headers: { [DISPATCH_HEADER]: registration.id } });
    assert.equal(response.status, 502);
    assert.match(await response.text(), /not reachable/);
  });
});

test('large bodies are streamed, not buffered', async () => {
  await withRelay({}, async ({ url, store }) => {
    const payload = Buffer.alloc(1024 * 1024, 0x61);
    const dev = await startDevServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(payload);
      });
    });
    try {
      const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: dev.port, zone: 'home.malarstrom.com' });
      const response = await fetch(`${url}/big`, {
        method: 'POST',
        headers: { [DISPATCH_HEADER]: registration.id },
        body: payload,
      });
      const received = Buffer.from(await response.arrayBuffer());
      assert.equal(received.length, payload.length);
    } finally {
      await dev.close();
    }
  });
});

test('server sent events arrive as they are produced', async () => {
  await withRelay({}, async ({ url, store }) => {
    const dev = await startDevServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write('data: one\n\n');
      setTimeout(() => res.write('data: two\n\n'), 120);
    });
    try {
      const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: dev.port, zone: 'home.malarstrom.com' });
      const response = await fetch(`${url}/events`, { headers: { [DISPATCH_HEADER]: registration.id } });
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read();
      const text = new TextDecoder().decode(first.value);
      assert.match(text, /data: one/);
      const second = await reader.read();
      assert.match(new TextDecoder().decode(second.value), /data: two/);
      await reader.cancel();
    } finally {
      await dev.close();
    }
  });
});
