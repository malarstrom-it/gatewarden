/**
 * The conformance test (§11.4).
 *
 * The official SDK's client drives our hand-written MCP server: the
 * handshake, the tool list and the tool calls. The SDK is a dev dependency
 * (D5), so this proves conformance without shipping it.
 *
 * The server runs against a throwaway installation: a temporary directory
 * holds the configuration and the state, and the ports are free ones the
 * OS hands out. The gateway that runs on the user's machine is never
 * touched.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isPortListening } from '../src/core/util/net.ts';
import { freePort } from './helpers/cli.ts';
import { registerSuiteDirectory, SUITE_VARIABLE, suiteMarker } from './helpers/daemons.ts';
import { makeTempDir } from './helpers/tempdir.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The MCP server of the package. */
export const MCP_BIN = path.join(REPO_ROOT, 'bin', 'gatewarden-mcp.js');

interface Fixture {
  /** The throwaway directory: the configuration, the state and the home. */
  dir: string;
  /** The client, connected to the server. */
  client: Client;
  /** The registry port of the throwaway installation. */
  registryPort: number;
  /** Stop the daemon the fixture started and remove the directory. */
  cleanup: () => Promise<void>;
}

/**
 * A throwaway installation and a client that talks to it.
 *
 * The server is started as a child process, the way a harness starts it.
 */
async function makeMcpFixture(
  options: { connect?: boolean; zone?: string; proxy?: string } = {},
): Promise<Fixture> {
  const dir = makeTempDir('gatewarden-mcp-');
  const registryPort = await freePort();
  const relayPort = await freePort();

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(
      {
        proxy: options.proxy ?? 'traefik',
        registryPort,
        relayPort,
        advertisedIp: '127.0.0.1',
        advertisedHost: '127.0.0.1',
        zone: options.zone ?? 'gwtest.local',
        entryPoints: ['websecure'],
        certResolver: 'testca',
        tlsMode: 'wildcard',
        securityHeaders: false,
        compressMiddleware: false,
        middlewareProvider: 'file',
        allowedCidrs: ['127.0.0.1/32', '::1/128'],
        secret: '',
        stateDir: dir,
        documentFormat: 'yaml',
      },
      null,
      2,
    ),
  );

  // The home directory is the throwaway one too, so that the old layout
  // (`~/.traefik-dev/`) is looked for there and not in the home of the
  // user the tests run as.
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: dir,
    GATEWARDEN_HOME: dir,
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    XDG_STATE_HOME: path.join(dir, '.local', 'state'),
    XDG_CACHE_HOME: path.join(dir, '.cache'),
    // The marker of the suite: the daemon that the tools start carries
    // it, and the cleanup of the suite finds the daemon by it.
    [SUITE_VARIABLE]: suiteMarker(),
  };
  // The installation of the fixture is known to the cleanup of the
  // suite: the daemon of the fixture is found by the directory it runs
  // in, also when it writes its pidfile somewhere else.
  registerSuiteDirectory(dir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env,
    cwd: dir,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'gatewarden-conformance', version: '1.0.0' }, { capabilities: {} });

  const cleanup = async (): Promise<void> => {
    try {
      await client.close();
    } catch {
      // already closed
    }
    // The daemon the tools started is a separate process: it is stopped by
    // hand, the way the CLI stops it.
    const pidFile = path.join(dir, 'daemon.pid');
    try {
      const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
    } catch {
      // not running
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && fs.existsSync(pidFile)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };

  if (options.connect !== false) {
    await client.connect(transport);
  }

  return { dir, client, registryPort, cleanup };
}

/** A server that answers, so that a route can be `up`. */
async function startDevServer(): Promise<{ port: number; stop: () => Promise<void> }> {
  const port = await freePort();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('hello');
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('the official SDK client can talk to the server', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  const version = fixture.client.getServerVersion();
  assert.equal(version?.name, 'gatewarden');
  assert.equal(typeof version?.version, 'string');

  const capabilities = fixture.client.getServerCapabilities();
  assert.ok(capabilities?.tools, 'the server does not offer tools');
});

test('the four tools are listed', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  const { tools } = await fixture.client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'dev_gateway_status',
    'list_dev_servers',
    'publish_dev_server',
    'remove_dev_server',
  ]);

  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} has no object schema`);
    assert.ok(tool.description, `${tool.name} has no description`);
  }
});

test('the server starts no daemon before a tool is called', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  // The client has done the handshake by now. Nothing else has happened.
  assert.equal(fs.existsSync(path.join(fixture.dir, 'daemon.pid')), false, 'the daemon was started');

  const listening = await isPortListening(fixture.registryPort);
  assert.equal(listening, false, 'the registry is listening before a tool was called');
});

test('publishing without a zone says how to get one', async (t) => {
  const fixture = await makeMcpFixture({ zone: '' });
  t.after(() => fixture.cleanup());

  // The host names are built from the zone. Without one the agent is
  // told what to do instead of getting a route with a trailing dot.
  const published = await fixture.client.callTool({
    name: 'publish_dev_server',
    arguments: { port: 3999, project: 'probe', branch: 'main' },
  });
  assert.equal(published.isError, true, JSON.stringify(published.content));
  assert.match(JSON.stringify(published.content), /no DNS zone is configured/);
  assert.match(JSON.stringify(published.content), /gatewarden setup/);

  const listed = await fixture.client.callTool({ name: 'list_dev_servers', arguments: {} });
  const routes = (listed.structuredContent as { routes: unknown[] }).routes;
  assert.equal(routes.length, 0, 'a route without a zone was registered');
});

test('a development server is published, listed and removed', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  const devServer = await startDevServer();
  t.after(() => devServer.stop());

  const published = await fixture.client.callTool({
    name: 'publish_dev_server',
    arguments: { port: devServer.port, project: 'probe', branch: 'main' },
  });
  assert.equal(published.isError, false, JSON.stringify(published.content));

  const route = published.structuredContent as {
    url: string;
    fqdn: string;
    project: string;
    branch: string;
    port: number;
    state: string;
  };
  assert.equal(route.url, 'https://main.probe.gwtest.local');
  assert.equal(route.fqdn, 'main.probe.gwtest.local');
  assert.equal(route.project, 'probe');
  assert.equal(route.branch, 'main');
  assert.equal(route.port, devServer.port);
  assert.equal(route.state, 'up', 'the development server is listening');

  // The daemon is up now: the first tool call started it (§5.1).
  assert.ok(fs.existsSync(path.join(fixture.dir, 'daemon.pid')), 'the daemon was not started');

  const listed = await fixture.client.callTool({ name: 'list_dev_servers', arguments: {} });
  assert.equal(listed.isError, false);
  const routes = (listed.structuredContent as { routes: Array<{ fqdn: string; state: string }> }).routes;
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.fqdn, 'main.probe.gwtest.local');
  assert.equal(routes[0]?.state, 'up');

  // Publishing the same route again updates it in place.
  const otherPort = await freePort();
  const again = await fixture.client.callTool({
    name: 'publish_dev_server',
    arguments: { port: otherPort, project: 'probe', branch: 'main' },
  });
  assert.equal(again.isError, false);
  assert.equal((again.structuredContent as { port: number }).port, otherPort);

  const afterUpdate = await fixture.client.callTool({ name: 'list_dev_servers', arguments: {} });
  const updated = (afterUpdate.structuredContent as { routes: Array<{ port: number }> }).routes;
  assert.equal(updated.length, 1, 'the route was not updated in place');
  assert.equal(updated[0]?.port, otherPort);

  const removed = await fixture.client.callTool({
    name: 'remove_dev_server',
    arguments: { project: 'probe', branch: 'main' },
  });
  assert.equal(removed.isError, false);
  assert.equal((removed.structuredContent as { removed: boolean }).removed, true);
  assert.equal((removed.structuredContent as { fqdn?: string }).fqdn, 'main.probe.gwtest.local');

  const afterRemove = await fixture.client.callTool({ name: 'list_dev_servers', arguments: {} });
  assert.deepEqual((afterRemove.structuredContent as { routes: unknown[] }).routes, []);
});

test('removing a route that is not there says so', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  const removed = await fixture.client.callTool({
    name: 'remove_dev_server',
    arguments: { project: 'nothing', branch: 'main' },
  });
  assert.equal(removed.isError, false);
  assert.equal((removed.structuredContent as { removed: boolean }).removed, false);
});

test('a tool that cannot do its job reports the failure in the result', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  const result = await fixture.client.callTool({
    name: 'publish_dev_server',
    arguments: { port: 'not a port' },
  });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /port must be an integer/);
});

test('an unknown tool is a protocol error', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  await assert.rejects(
    () => fixture.client.callTool({ name: 'no_such_tool', arguments: {} }),
    /Unknown tool/,
  );
});

test('the status of the gateway is reported', async (t) => {
  const fixture = await makeMcpFixture();
  t.after(() => fixture.cleanup());

  const result = await fixture.client.callTool({ name: 'dev_gateway_status', arguments: {} });
  assert.equal(result.isError, false);

  const status = result.structuredContent as {
    daemon: { running: boolean; pid: number | null };
    proxy: { id: string; reachable: boolean };
    config: { path: string; zone: string; registryPort: number };
    reachable: boolean;
  };
  assert.equal(status.daemon.running, true, 'the tool call did not start the daemon');
  assert.equal(typeof status.daemon.pid, 'number');
  assert.equal(status.proxy.id, 'traefik');
  assert.equal(status.config.zone, 'gwtest.local');
  assert.equal(status.config.path, path.join(fixture.dir, 'config.json'));
  assert.equal(status.reachable, true);
});

test('a tool that needs the daemon still fails when the daemon cannot start', async (t) => {
  // The configuration file names a proxy id the package does not know,
  // so the daemon cannot start.
  const fixture = await makeMcpFixture({ proxy: 'caddy' });
  t.after(() => fixture.cleanup());

  // That is a failure of the call, for every tool that needs a daemon
  // that runs. Only the status tool answers it.
  const result = await fixture.client.callTool({
    name: 'publish_dev_server',
    arguments: { port: 3999, project: 'probe', branch: 'main' },
  });
  assert.equal(result.isError, true, JSON.stringify(result.content));
  const text = (result.content as Array<{ type: string; text: string }>)
    .map((entry) => entry.text)
    .join('\n');
  assert.match(text, /unknown proxy "caddy" \(known: traefik\)/);
});

test('the status tool says why the proxy does not answer, and a client accepts the answer', async (t) => {
  // The configuration file names a proxy id the package does not know.
  const fixture = await makeMcpFixture({ proxy: 'caddy' });
  t.after(() => fixture.cleanup());

  // The client validates the answer of a tool against the schema the
  // tool declares. It learns the schemas from the tool list, so the
  // list is asked for first: without it, the answer is not checked and
  // a broken answer would pass unnoticed.
  await fixture.client.listTools();

  // The tool answers instead of failing: the mistake in the
  // configuration file is what the status reports.
  const result = await fixture.client.callTool({ name: 'dev_gateway_status', arguments: {} });
  assert.equal(result.isError, false, JSON.stringify(result.content));

  const status = result.structuredContent as {
    daemon: { running: boolean; healthy: boolean };
    proxy: { id: string; reachable: boolean; reason?: string };
    reachable: boolean;
    reason?: string;
  };
  assert.equal(status.proxy.id, 'caddy');
  // The proxy does not answer, and the status says why.
  assert.equal(status.proxy.reachable, false);
  assert.equal(
    status.proxy.reason,
    'The configuration file names a proxy the package does not know: unknown proxy "caddy" (known: traefik).',
  );
  // The reason is at the top of the answer too, so that an agent reads
  // why without looking into the proxy.
  assert.equal(status.reason, status.proxy.reason);
  assert.equal(status.reachable, false);
});
