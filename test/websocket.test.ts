import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore } from '../src/state.ts';
import { createRelayServer } from '../src/relay.ts';
import { DISPATCH_HEADER } from '../src/document.ts';
import { close, listen, makeConfig } from './helpers/fixtures.ts';
import { startEchoServer, wsRoundTrip } from './helpers/ws.ts';

function tempStore(): RegistrationStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-dev-ws-'));
  return new RegistrationStore(dir);
}

test('a websocket upgrade is tunnelled through the relay', async () => {
  const echo = await startEchoServer();
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  const port = await listen(server);
  try {
    const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: echo.port, zone: 'home.malarstrom.com' });
    const { reply, handshake } = await wsRoundTrip(port, '/ws', 'hello hmr', { [DISPATCH_HEADER]: registration.id });
    assert.equal(reply, 'hello hmr');
    assert.equal(handshake['upgrade'], 'websocket');
  } finally {
    await close(server);
    await echo.close();
  }
});

test('the relay forwards the dispatch header to the websocket upstream', async () => {
  const echo = await startEchoServer();
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  const port = await listen(server);
  try {
    const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: echo.port, zone: 'home.malarstrom.com' });
    await wsRoundTrip(port, '/ws', 'ping', { [DISPATCH_HEADER]: registration.id });
    assert.equal(echo.lastHandshake()['x-dev-target'], registration.id);
  } finally {
    await close(server);
    await echo.close();
  }
});

test('a websocket upgrade for an unknown registration is refused', async () => {
  const echo = await startEchoServer();
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  const port = await listen(server);
  try {
    await assert.rejects(
      wsRoundTrip(port, '/ws', 'ping', { [DISPATCH_HEADER]: 'alpha/nope' }),
      /handshake failed/,
    );
  } finally {
    await close(server);
    await echo.close();
  }
});

test('a websocket upgrade from a forbidden source is refused', async () => {
  const echo = await startEchoServer();
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({ allowedCidrs: ['10.99.0.0/16'] }));
  const port = await listen(server);
  try {
    await assert.rejects(wsRoundTrip(port, '/ws', 'ping', { [DISPATCH_HEADER]: 'alpha/main' }), /handshake failed/);
  } finally {
    await close(server);
    await echo.close();
  }
});
