/**
 * The pi extension (S6, §7).
 *
 * The extension is loaded the way pi loads it: the factory is called with
 * pi's API, and the factory registers the tools, the command and the
 * session start. The tests drive that API with a stand-in for pi, so that
 * the behaviour of the extension is checked without a model and without a
 * terminal.
 *
 * Every test runs against a throwaway installation: a temporary directory
 * holds the configuration and the state, and the ports are free ones the
 * OS hands out. The gateway that runs on the user's machine is never
 * involved.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import gatewardenExtension, { STATUS_KEY, statusText } from '../src/integrations/pi/extension.ts';
import { renderRouteTable } from '../src/integrations/pi/table.ts';
import { PI_TOOL_NAMES } from '../src/integrations/pi/tools.ts';
import { loadConfig } from '../src/core/config.ts';
import { isHealthy } from '../src/core/daemonControl.ts';
import type {
  PiCommandContext,
  PiComponentFactory,
  PiExtensionApi,
  PiExtensionContext,
  PiExtensionMode,
  PiSessionShutdownEvent,
  PiSessionStartEvent,
  PiToolDefinition,
  PiUiContext,
} from '../src/integrations/pi/pi-api.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A free TCP port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** The stand-in for pi: it records what the extension registers. */
class FakePi implements PiExtensionApi {
  readonly tools = new Map<string, PiToolDefinition>();
  readonly commands = new Map<
    string,
    { description?: string; handler: (args: string, ctx: PiCommandContext) => Promise<void> }
  >();
  readonly handlers = new Map<
    string,
    (event: PiSessionStartEvent | PiSessionShutdownEvent, ctx: PiExtensionContext) => Promise<void> | void
  >();

  on(
    event: 'session_start',
    handler: (event: PiSessionStartEvent, ctx: PiExtensionContext) => Promise<void> | void,
  ): () => void;
  on(
    event: 'session_shutdown',
    handler: (event: PiSessionShutdownEvent, ctx: PiExtensionContext) => Promise<void> | void,
  ): () => void;
  on(
    event: string,
    // The implementation signature has to fit both overloads, so the
    // event is loose here; the overloads above are what callers see.
    handler: (event: any, ctx: PiExtensionContext) => Promise<void> | void,
  ): () => void {
    this.handlers.set(event, handler);
    return () => this.handlers.delete(event);
  }

  registerTool(tool: PiToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerCommand(
    name: string,
    options: { description?: string; handler: (args: string, ctx: PiCommandContext) => Promise<void> },
  ): void {
    this.commands.set(name, options);
  }
}

/** What the fake terminal recorded. */
interface FakeUi extends PiUiContext {
  statuses: Map<string, string | undefined>;
  notifications: Array<{ message: string; type?: string }>;
  widgets: Map<string, string[] | undefined>;
  rendered: string[];
}

/** A context, with a terminal that records what it is told. */
function makeContext(cwd: string, mode: PiExtensionMode = 'tui'): PiExtensionContext & { ui: FakeUi } {
  const statuses = new Map<string, string | undefined>();
  const notifications: Array<{ message: string; type?: string }> = [];
  const widgets = new Map<string, string[] | undefined>();
  const rendered: string[] = [];

  const ui: FakeUi = {
    statuses,
    notifications,
    widgets,
    rendered,
    notify(message: string, type?: string): void {
      notifications.push({ message, type });
    },
    setStatus(key: string, text: string | undefined): void {
      statuses.set(key, text);
    },
    setWidget(key: string, content: string[] | undefined): void {
      widgets.set(key, content);
    },
    async custom<T>(factory: PiComponentFactory<T>): Promise<T> {
      let result: T | undefined;
      const component = factory(undefined, undefined, undefined, (value) => {
        result = value;
      });
      rendered.push(...component.render(100));
      return result as T;
    },
  };

  return { ui, mode, hasUI: mode === 'tui', cwd };
}

interface Fixture {
  dir: string;
  configPath: string;
  cwd: string;
  stopDaemon: () => Promise<void>;
}

/**
 * A throwaway installation: a directory, a configuration file and the
 * ports it uses.
 */
async function makeInstallation(): Promise<{ dir: string; configPath: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-pi-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        proxy: 'traefik',
        registryPort,
        relayPort,
        advertisedIp: '127.0.0.1',
        advertisedHost: '127.0.0.1',
        zone: 'gwtest.local',
        entryPoints: ['websecure'],
        certResolver: 'testca',
        secret: '',
        stateDir: dir,
        documentFormat: 'yaml',
      },
      null,
      2,
    ),
  );
  return { dir, configPath };
}

/** The number of live routes the status line says. */
function liveCount(ctx: PiExtensionContext & { ui: FakeUi }): number {
  const text = ctx.ui.statuses.get(STATUS_KEY) ?? '';
  const match = /^(\d+) routes? live$/.exec(text);
  return match ? Number.parseInt(match[1] as string, 10) : -1;
}

let fixture: Fixture;
const savedEnv = { ...process.env };

before(async () => {
  const { dir, configPath } = await makeInstallation();

  // The working directory of the session: a throwaway one, so that the
  // inferred project and branch do not depend on the repository.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-pi-session-'));

  // The whole installation lives in the temporary directory (§11.1).
  process.env['GATEWARDEN_HOME'] = dir;
  process.env['HOME'] = dir;

  fixture = {
    dir,
    configPath,
    cwd,
    stopDaemon: async () => {
      const config = loadConfig({ configPath, stateDir: dir });
      try {
        const pid = Number.parseInt(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8').trim(), 10);
        if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
      } catch {
        // not running
      }
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && (await isHealthy(config))) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
});

after(async () => {
  await fixture.stopDaemon();
  process.env = savedEnv;
  fs.rmSync(fixture.dir, { recursive: true, force: true });
  fs.rmSync(fixture.cwd, { recursive: true, force: true });
});

/** Load the extension, the way pi loads it. */
function load(): FakePi {
  const pi = new FakePi();
  gatewardenExtension(pi);
  return pi;
}

test('the extension registers the three tools of §7', () => {
  const pi = load();

  assert.deepEqual(
    [...pi.tools.keys()],
    ['publish_dev_server', 'remove_dev_server', 'list_dev_servers'],
  );
  assert.deepEqual([...pi.tools.keys()], [...PI_TOOL_NAMES]);
});

test('every tool declares a schema for its arguments and for its result', () => {
  for (const tool of load().tools.values()) {
    assert.equal(tool.parameters.type, 'object', `${tool.name} has no argument schema`);
    assert.ok(tool.outputSchema, `${tool.name} has no result schema`);
    assert.equal(tool.outputSchema?.type, 'object');
  }
});

test('the extension registers the /routes command', () => {
  const pi = load();

  const command = pi.commands.get('routes');
  assert.ok(command, 'the /routes command is not registered');
  assert.ok(command.description, 'the /routes command has no description');
});

test('the extension listens for the session start', () => {
  const pi = load();

  assert.ok(pi.handlers.has('session_start'), 'the extension does not listen for the session start');
});

test('publishing a route returns the address and writes the state file', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd);
  const tool = pi.tools.get('publish_dev_server');
  assert.ok(tool);

  const result = await tool.execute(
    'call-1',
    { port: 4321, project: 'demo', branch: 'main' },
    undefined,
    undefined,
    ctx,
  );

  const payload = result.structuredContent as { url: string; fqdn: string; project: string };
  assert.equal(payload.fqdn, 'main.demo.gwtest.local');
  assert.equal(payload.url, 'https://main.demo.gwtest.local');
  assert.match(result.content[0]!.text, /"url"/);

  const state = JSON.parse(fs.readFileSync(path.join(fixture.dir, 'routes.json'), 'utf8')) as {
    registrations: Array<{ devPort: number; projectSlug: string }>;
  };
  assert.equal(state.registrations.length, 1);
  assert.equal(state.registrations[0]!.devPort, 4321);
  assert.equal(state.registrations[0]!.projectSlug, 'demo');
});

test('the route list shows the published route', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd);
  const tool = pi.tools.get('list_dev_servers');
  assert.ok(tool);

  const result = await tool.execute('call-2', {}, undefined, undefined, ctx);
  const payload = result.structuredContent as { routes: Array<{ port: number; state: string }> };

  assert.equal(payload.routes.length, 1);
  assert.equal(payload.routes[0]!.port, 4321);
  // Nothing listens on 4321, so the route is down.
  assert.equal(payload.routes[0]!.state, 'down');
});

test('removing a route takes it away', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd);
  const tool = pi.tools.get('remove_dev_server');
  assert.ok(tool);

  const result = await tool.execute(
    'call-3',
    { project: 'demo', branch: 'main' },
    undefined,
    undefined,
    ctx,
  );
  const payload = result.structuredContent as { removed: boolean; fqdn?: string };
  assert.equal(payload.removed, true);
  assert.equal(payload.fqdn, 'main.demo.gwtest.local');

  const listTool = pi.tools.get('list_dev_servers');
  assert.ok(listTool);
  const listed = await listTool.execute('call-4', {}, undefined, undefined, ctx);
  const routes = (listed.structuredContent as { routes: unknown[] }).routes;
  assert.equal(routes.length, 0);
});

test('the /routes command renders the table', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd);
  const publish = pi.tools.get('publish_dev_server');
  assert.ok(publish);
  await publish.execute('call-5', { port: 4321, project: 'demo', branch: 'main' }, undefined, undefined, ctx);

  const command = pi.commands.get('routes');
  assert.ok(command);

  await command.handler('', ctx);

  const table = ctx.ui.rendered.join('\n');
  assert.match(table, /PROJECT\s+BRANCH\s+PORT\s+LOCAL\s+PUBLIC/);
  assert.match(table, /main\.demo\.gwtest\.local/);
  assert.match(table, /4321/);
});

test('the /routes command shows the table in the modes without a terminal', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd, 'print');
  const command = pi.commands.get('routes');
  assert.ok(command);

  await command.handler('', ctx);

  assert.equal(ctx.ui.rendered.length, 0);
  assert.equal(ctx.ui.notifications.length, 1);
  assert.match(ctx.ui.notifications[0]!.message, /PROJECT\s+BRANCH\s+PORT\s+LOCAL\s+PUBLIC/);
});

test('the status line shows the number of live routes', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd);
  const tool = pi.tools.get('publish_dev_server');
  assert.ok(tool);

  // A development server that answers: the route is live.
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  try {
    await tool.execute('call-6', { port, project: 'live', branch: 'main' }, undefined, undefined, ctx);

    // One route is live: the one whose development server answers.
    assert.equal(ctx.ui.statuses.get(STATUS_KEY), '1 route live');

    const listTool = pi.tools.get('list_dev_servers');
    assert.ok(listTool);
    const result = await listTool.execute('call-7', {}, undefined, undefined, ctx);
    const payload = result.structuredContent as { routes: Array<{ project: string; state: string }> };
    assert.deepEqual(
      payload.routes.map((route) => route.state),
      ['down', 'up'],
    );
  } finally {
    server.close();
  }
});

test('the session start makes sure the daemon runs and sets the status line', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd);
  const start = pi.handlers.get('session_start');
  assert.ok(start);

  await start({ type: 'session_start', reason: 'startup' }, ctx);

  const config = loadConfig({ configPath: fixture.configPath, stateDir: fixture.dir });
  assert.equal(await isHealthy(config), true, 'the daemon of the throwaway installation did not start');
  assert.ok(ctx.ui.statuses.has(STATUS_KEY), 'the status line was not set');
});

test('a gateway that cannot be read is told to the user, and does not throw', async () => {
  const pi = load();
  const ctx = makeContext(fixture.cwd);
  const start = pi.handlers.get('session_start');
  assert.ok(start);

  // A configuration file that is not JSON: the gateway cannot be read at
  // all, and nothing is asked of the network.
  const broken = path.join(fixture.dir, 'broken.json');
  fs.writeFileSync(broken, 'this is not json');
  const savedHome = process.env['GATEWARDEN_HOME'];
  const savedConfig = process.env['GATEWARDEN_CONFIG'];
  delete process.env['GATEWARDEN_HOME'];
  process.env['GATEWARDEN_CONFIG'] = broken;
  try {
    await start({ type: 'session_start', reason: 'startup' }, ctx);
  } finally {
    if (savedHome === undefined) delete process.env['GATEWARDEN_HOME'];
    else process.env['GATEWARDEN_HOME'] = savedHome;
    if (savedConfig === undefined) delete process.env['GATEWARDEN_CONFIG'];
    else process.env['GATEWARDEN_CONFIG'] = savedConfig;
    fs.rmSync(broken, { force: true });
  }

  assert.equal(ctx.ui.statuses.get(STATUS_KEY), 'gatewarden unreachable');
  assert.equal(ctx.ui.notifications.length, 1);
  assert.match(ctx.ui.notifications[0]!.message, /invalid config file/);
});

test('the status line follows a development server that dies', async () => {
  // The count of live routes changes when a development server starts or
  // dies, and nothing tells the extension when that happens: the status
  // line is brought up to date on its own.
  const pi = new FakePi();
  gatewardenExtension(pi, { statusRefreshMs: 20 });
  const ctx = makeContext(fixture.cwd);

  const start = pi.handlers.get('session_start');
  assert.ok(start);
  await start({ type: 'session_start', reason: 'startup' }, ctx);

  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  const tool = pi.tools.get('publish_dev_server');
  assert.ok(tool);
  await tool.execute('call-8', { port, project: 'watched', branch: 'main' }, undefined, undefined, ctx);

  const before = liveCount(ctx);
  assert.ok(before >= 1, `the status line does not count the live route: ${ctx.ui.statuses.get(STATUS_KEY)}`);

  server.close();

  // The timer brings the status up to date, without anything else happening.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && liveCount(ctx) !== before - 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(liveCount(ctx), before - 1, 'the status line kept a number that was no longer true');

  // The session ends: the timer goes with it.
  const shutdown = pi.handlers.get('session_shutdown');
  assert.ok(shutdown, 'the extension does not listen for the end of the session');
  await shutdown({ type: 'session_shutdown' }, ctx);
});

test('the read-only tool leaves the environment alone', async () => {
  // A tool that is declared read-only must not start a background
  // process: the list tool only reads the state file.
  const installation = await makeInstallation();
  const savedHome = process.env['GATEWARDEN_HOME'];
  process.env['GATEWARDEN_HOME'] = installation.dir;

  try {
    const pi = load();
    const ctx = makeContext(fixture.cwd);
    const tool = pi.tools.get('list_dev_servers');
    assert.ok(tool);

    const result = await tool.execute('call-9', {}, undefined, undefined, ctx);
    const routes = (result.structuredContent as { routes: unknown[] }).routes;
    assert.deepEqual(routes, []);

    assert.equal(
      fs.existsSync(path.join(installation.dir, 'daemon.pid')),
      false,
      'the read-only tool started a daemon',
    );
  } finally {
    if (savedHome === undefined) delete process.env['GATEWARDEN_HOME'];
    else process.env['GATEWARDEN_HOME'] = savedHome;
    fs.rmSync(installation.dir, { recursive: true, force: true });
  }
});

test('the status text reads the way the specification writes it', () => {
  assert.equal(statusText(3), '3 routes live');
  assert.equal(statusText(1), '1 route live');
  assert.equal(statusText(0), '0 routes live');
});

test('the route table has a column for the local state and one for the public address', () => {
  const lines = renderRouteTable([
    {
      project: 'demo',
      branch: 'main',
      port: 3000,
      fqdn: 'main.demo.gwtest.local',
      url: 'https://main.demo.gwtest.local',
      state: 'up',
    },
  ]);

  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /PROJECT/);
  assert.match(lines[1]!, /main\.demo\.gwtest\.local/);
  assert.match(lines[1]!, /up/);
});

test('the route table of an empty gateway says so', () => {
  assert.deepEqual(renderRouteTable([]), ['no routes are published']);
});

test('the extension does not import the harness', () => {
  // pi is the host, not a dependency: the extension may not import the
  // harness, and it may not need a schema library either.
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'integrations', 'pi', 'extension.ts'), 'utf8');
  assert.doesNotMatch(source, /from ['"]@earendil-works\//);
  assert.doesNotMatch(source, /from ['"]typebox/);
});
