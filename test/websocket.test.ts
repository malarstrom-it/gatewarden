import assert from 'node:assert/strict';
import type http from 'node:http';
import net from 'node:net';
import test, { type TestContext } from 'node:test';
import { RegistrationStore } from '../src/core/state.ts';
import { createRelayServer } from '../src/core/relay.ts';
import { DISPATCH_HEADER } from '../src/core/protocol.ts';
import { close, listen, makeConfig } from './helpers/fixtures.ts';
import { openUpgrade, startEchoServer, wsRoundTrip, type EchoServer, type WsConnection, type WsRoundTrip } from './helpers/ws.ts';
import { makeTempDir } from './helpers/tempdir.ts';

/**
 * Every test gets its own time limit.
 *
 * A hanging test must fail with a message that says what happened, not
 * with a CI job that burns its whole timeout. The limit is generous
 * enough for a slow machine and short enough to be read in the log.
 */
const TEST_TIMEOUT = 20000;

/** How long a cleanup waits for a listener to close. */
const CLOSE_TIMEOUT = 2000;

/** The resources one test owns. */
interface Scenario {
  /** The echo server the relay tunnels to. */
  echo: EchoServer | null;
  /** The relay listener. */
  server: http.Server | null;
  /** An upgrade that is kept open. */
  connection: WsConnection | null;
  /** A round trip that is done. */
  round: WsRoundTrip | null;
  /** A peer that does not behave. */
  rude: net.Socket | null;
}

/**
 * Register the cleanup of one test and hand out the resources it owns.
 *
 * The hook is registered before anything is opened: a test that fails
 * while it sets itself up must still close what it opened. A listener
 * that is left open keeps a handle in the event loop, the test process
 * never exits, and the CI job waits for its whole timeout instead of
 * reporting the failure.
 */
function scenario(t: TestContext): Scenario {
  const state: Scenario = { echo: null, server: null, connection: null, round: null, rude: null };
  t.after(async () => {
    // The peers first: a listener can only finish its shutdown when the
    // connections it holds are gone.
    state.rude?.destroy();
    await state.round?.close();
    await state.connection?.close();
    if (state.server) await within(close(state.server), CLOSE_TIMEOUT);
    if (state.echo) await within(state.echo.close(), CLOSE_TIMEOUT);
    // The last line of defence: nothing may stay open, or the process
    // never exits.
    sweepSockets();
  });
  return state;
}

/** Wait for a promise, but never longer than `ms`. */
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

/** The handles Node keeps open. The type is not in the type definitions. */
interface NodeHandles {
  _getActiveHandles(): unknown[];
}

/**
 * Destroy the sockets that are still open.
 *
 * A socket that is left open keeps a handle in the event loop, and the
 * test process then never exits. The CI job would wait for its whole
 * timeout instead of reporting the failure. The output streams are the
 * process's own, and they stay.
 */
function sweepSockets(): void {
  const handles = (process as unknown as NodeHandles)._getActiveHandles();
  for (const handle of handles) {
    if (handle === process.stdout || handle === process.stderr) continue;
    if (handle instanceof net.Socket && !handle.destroyed) handle.destroy();
  }
}

function tempStore(): RegistrationStore {
  const dir = makeTempDir('traefik-dev-ws-');
  return new RegistrationStore(dir);
}

test('a websocket upgrade is tunnelled through the relay', { timeout: TEST_TIMEOUT }, async (t) => {
  const state = scenario(t);
  const echo = await startEchoServer();
  state.echo = echo;
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  state.server = server;
  const port = await listen(server);
  const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: echo.port, zone: 'example.com' });
  const round = await wsRoundTrip(port, '/ws', 'hello hmr', { [DISPATCH_HEADER]: registration.id });
  state.round = round;
  await round.close();
  assert.equal(round.reply, 'hello hmr');
  assert.equal(round.handshake['upgrade'], 'websocket');
});

test('the relay forwards the dispatch header to the websocket upstream', { timeout: TEST_TIMEOUT }, async (t) => {
  const state = scenario(t);
  const echo = await startEchoServer();
  state.echo = echo;
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  state.server = server;
  const port = await listen(server);
  const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: echo.port, zone: 'example.com' });
  const round = await wsRoundTrip(port, '/ws', 'ping', { [DISPATCH_HEADER]: registration.id });
  state.round = round;
  await round.close();
  assert.equal(echo.lastHandshake()['x-dev-target'], registration.id);
});

test('a websocket upgrade for an unknown registration is refused', { timeout: TEST_TIMEOUT }, async (t) => {
  const state = scenario(t);
  const echo = await startEchoServer();
  state.echo = echo;
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  state.server = server;
  const port = await listen(server);
  await assert.rejects(
    wsRoundTrip(port, '/ws', 'ping', { [DISPATCH_HEADER]: 'alpha/nope' }),
    /handshake failed/,
  );
});

test('a websocket upgrade from a forbidden source is refused', { timeout: TEST_TIMEOUT }, async (t) => {
  const state = scenario(t);
  const echo = await startEchoServer();
  state.echo = echo;
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({ allowedCidrs: ['10.99.0.0/16'] }));
  state.server = server;
  const port = await listen(server);
  await assert.rejects(wsRoundTrip(port, '/ws', 'ping', { [DISPATCH_HEADER]: 'alpha/main' }), /handshake failed/);
});

test('closing the relay closes the upgraded sockets', { timeout: TEST_TIMEOUT }, async (t) => {
  const state = scenario(t);
  const echo = await startEchoServer();
  state.echo = echo;
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  state.server = server;
  const port = await listen(server);
  const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: echo.port, zone: 'example.com' });
  const connection = await openUpgrade(port, '/ws', { [DISPATCH_HEADER]: registration.id });
  state.connection = connection;

  // The upgrade is open. Node counts the connection, and `close()`
  // waits for the count to reach zero: an upgraded socket that the
  // relay does not close itself keeps the listener from ever finishing
  // its shutdown, and its handle keeps the process alive. Without the
  // relay closing its own sockets this await never returns, and the
  // test fails on its own time limit instead of hanging the job.
  await close(server);
  await connection.close();
  assert.equal(connection.socket.destroyed, true);
});

test('the relay survives a peer that resets an upgrade', { timeout: TEST_TIMEOUT }, async (t) => {
  const state = scenario(t);
  const echo = await startEchoServer();
  state.echo = echo;
  const store = tempStore();
  const server = createRelayServer(store, makeConfig({}));
  state.server = server;
  const port = await listen(server);
  const registration = store.upsert({ project: 'alpha', branch: 'main', devPort: echo.port, zone: 'example.com' });

  // A peer that resets the connection instead of closing it: the
  // refusal and the reset race each other. Node hands the upgraded
  // socket to the application without an error handler of its own, so
  // an unhandled 'error' here would take the whole relay down.
  const rude = net.connect({ port, host: '127.0.0.1' });
  state.rude = rude;
  // The reset makes the socket report the error it got. Nothing waits
  // for it, but an error without a handler is an unhandled 'error'
  // event, and that stops the test process.
  rude.on('error', () => {});
  await new Promise<void>((resolve) => rude.once('connect', () => resolve()));
  rude.write(
    [
      'GET /ws HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      `${DISPATCH_HEADER}: alpha/nope`,
      '',
      '',
    ].join('\r\n'),
  );
  rude.resetAndDestroy();

  // The relay is still there: the next upgrade is tunnelled as usual.
  const round = await wsRoundTrip(port, '/ws', 'still here', { [DISPATCH_HEADER]: registration.id });
  state.round = round;
  await round.close();
  assert.equal(round.reply, 'still here');
});
