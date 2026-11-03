/**
 * The four tools of the MCP server.
 *
 * MCP is the primary agent surface, and these tools are that surface: four
 * calls, a typed contract each, and a result the agent can hand to the
 * user verbatim. They are thin: everything they do, the core does —
 * the route store writes the state, the daemon serves the document, the
 * proxy asks for it.
 *
 * The names are the ones the human decided:
 *
 *   publish_dev_server, remove_dev_server, list_dev_servers,
 *   dev_gateway_status.
 */

import { discoverProxyStatus } from '../../adapters/index.ts';
import { loadConfigWithReport, requireZone } from '../../core/config.ts';
import { gatewayStatus, routeJson } from '../../core/status.ts';
import { RegistrationStore } from '../../core/state.ts';
import { withRouteLock } from '../../core/lock.ts';
import { isPortListening } from '../../core/util/net.ts';
import type { GatewayPaths } from '../../core/paths.ts';
import type { Config } from '../../core/types.ts';
import { inferBranch, inferProject } from './inference.ts';

/** A JSON Schema, as MCP wants it: an object schema at the root. */
export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/** What a tool needs to know about the installation it runs in. */
export interface ToolContext {
  /** The configuration of the installation. */
  config: Config;
  /** The configuration file the configuration came from. */
  configPath: string;
  /** The four directories of the installation. */
  paths: GatewayPaths;
  /** The working directory the project and the branch are inferred from. */
  cwd: string;
}

/** One tool: its contract and what it does. */
export interface ToolDefinition {
  /** The name the agent calls. */
  name: string;
  /** A human readable name, for the surfaces that show one. */
  title: string;
  /** What the tool does, in the words the agent reads. */
  description: string;
  /** The JSON Schema of the arguments. */
  inputSchema: JsonSchema;
  /** The JSON Schema of the result. */
  outputSchema: JsonSchema;
  /** What the tool does. */
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

/**
 * Read the context of an installation.
 *
 * The configuration is read per call, so that a change to the file is
 * picked up without restarting the server.
 */
export function createToolContext(options: {
  cwd?: string;
  configPath?: string;
  stateDir?: string;
} = {}): ToolContext {
  const loaded = loadConfigWithReport({
    configPath: options.configPath,
    stateDir: options.stateDir,
  });
  return {
    config: loaded.config,
    configPath: loaded.configPath,
    paths: loaded.paths,
    cwd: options.cwd ?? process.cwd(),
  };
}

/** A string argument, when it is one and it is not empty. */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A string argument that has to be there. */
function requiredString(args: Record<string, unknown>, name: string): string {
  const value = optionalString(args[name]);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

/** The route, as it is returned to the agent. */
const routeSchema: JsonSchema = {
  type: 'object',
  properties: {
    project: { type: 'string' },
    branch: { type: 'string' },
    port: { type: 'integer' },
    fqdn: { type: 'string' },
    url: { type: 'string' },
    state: { type: 'string', enum: ['up', 'down'] },
  },
  required: ['project', 'branch', 'port', 'fqdn', 'url', 'state'],
  additionalProperties: false,
};

/** The daemon, as it is returned to the agent. */
const daemonSchema: JsonSchema = {
  type: 'object',
  properties: {
    pid: { type: ['integer', 'null'] },
    healthy: { type: 'boolean' },
    running: { type: 'boolean' },
    pidFile: { type: 'string' },
  },
  required: ['pid', 'healthy', 'running', 'pidFile'],
  additionalProperties: false,
};

/** The proxy, as it is returned to the agent. */
const proxySchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    reachable: { type: 'boolean' },
    version: { type: 'string' },
  },
  required: ['id', 'reachable'],
  additionalProperties: false,
};

/** The configuration, as it is returned to the agent. */
const configSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    exists: { type: 'boolean' },
    stateDir: { type: 'string' },
    logFile: { type: 'string' },
    cacheDir: { type: 'string' },
    registryPort: { type: 'integer' },
    relayPort: { type: 'integer' },
    advertisedHost: { type: 'string' },
    advertisedIp: { type: 'string' },
    zone: { type: 'string' },
    entryPoints: { type: 'array', items: { type: 'string' } },
    certResolver: { type: 'string' },
    secretConfigured: { type: 'boolean' },
  },
  required: [
    'path',
    'exists',
    'stateDir',
    'logFile',
    'cacheDir',
    'registryPort',
    'relayPort',
    'advertisedHost',
    'advertisedIp',
    'zone',
    'entryPoints',
    'certResolver',
    'secretConfigured',
  ],
  additionalProperties: false,
};

/**
 * Publish a development server.
 *
 * The route is updated in place when the project and the branch already
 * have one: an agent that restarts a development server on another port
 * expects the same address to follow it.
 */
const publishDevServer: ToolDefinition = {
  name: 'publish_dev_server',
  title: 'Publish a development server',
  description:
    'Publish a development server that runs on this machine so the user can open it in a browser on their network. ' +
    'Give the user the returned url verbatim. Publishing the same project and branch again updates the route in place, ' +
    'so a restarted development server keeps its address.',
  inputSchema: {
    type: 'object',
    properties: {
      port: {
        type: 'integer',
        minimum: 1,
        maximum: 65535,
        description: 'The port the development server listens on, on this machine.',
      },
      project: {
        type: 'string',
        description: 'The project name. Defaults to the name of the working directory.',
      },
      branch: {
        type: 'string',
        description: 'The branch name. Defaults to the branch of the working directory.',
      },
      label: {
        type: 'string',
        description: 'An optional label, shown in the route list.',
      },
    },
    required: ['port'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      fqdn: { type: 'string' },
      project: { type: 'string' },
      branch: { type: 'string' },
      port: { type: 'integer' },
      state: { type: 'string', enum: ['up', 'down'] },
    },
    required: ['url', 'fqdn', 'project', 'branch', 'port', 'state'],
    additionalProperties: false,
  },
  async handler(args, context) {
    const port = args['port'];
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('port must be an integer between 1 and 65535');
    }

    const project = optionalString(args['project']) ?? inferProject(context.cwd);
    const branch = optionalString(args['branch']) ?? inferBranch(context.cwd);
    const label = optionalString(args['label']);

    // The host names are built from the zone. An installation that has
    // none cannot name a route, and the agent is told how to get one
    // instead of publishing a route with a trailing dot in its name.
    const zone = requireZone(context.config);

    const store = new RegistrationStore(context.config.stateDir);
    // The write is a read-modify-write, and two agent sessions may publish
    // at the same time: the route store is guarded by a lock file, and the
    // lock keeps one of them from dropping the route of the other.
    const registration = await withRouteLock(context.config.stateDir, () =>
      store.upsert({
        project,
        branch,
        devPort: port,
        label,
        zone,
      }),
    );

    const up = await isPortListening(port);
    return routeJson(registration, up ? 'up' : 'down');
  },
};

/** Remove a published development server. */
const removeDevServer: ToolDefinition = {
  name: 'remove_dev_server',
  title: 'Remove a published development server',
  description:
    'Remove a published development server. The project and the branch name the route. ' +
    'The result says whether there was a route to remove.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'The project name of the route.' },
      branch: { type: 'string', description: 'The branch name of the route.' },
    },
    required: ['project', 'branch'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      removed: { type: 'boolean' },
      fqdn: { type: 'string' },
    },
    required: ['removed'],
    additionalProperties: false,
  },
  async handler(args, context) {
    const project = requiredString(args, 'project');
    const branch = requiredString(args, 'branch');

    const store = new RegistrationStore(context.config.stateDir);
    const existing = store.findByProjectBranch(project, branch);
    const removed = await withRouteLock(context.config.stateDir, () => store.remove(project, branch));
    return { removed, fqdn: existing?.fqdn };
  },
};

/** List the published development servers. */
const listDevServers: ToolDefinition = {
  name: 'list_dev_servers',
  title: 'List the published development servers',
  description:
    'List the published development servers: the address of each one, and whether the port it points at answers.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      routes: { type: 'array', items: routeSchema },
    },
    required: ['routes'],
    additionalProperties: false,
  },
  async handler(_args, context) {
    const store = new RegistrationStore(context.config.stateDir);
    const routes = [];
    for (const registration of store.list()) {
      const up = await isPortListening(registration.devPort);
      routes.push(routeJson(registration, up ? 'up' : 'down'));
    }
    return { routes };
  },
};

/** Report the state of the gateway. */
const gatewardenStatus: ToolDefinition = {
  name: 'dev_gateway_status',
  title: 'Report the state of the gateway',
  description:
    'Report the state of the gateway: the daemon, the proxy, the configuration, and whether the gateway is reachable.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      daemon: daemonSchema,
      proxy: proxySchema,
      config: configSchema,
      reachable: { type: 'boolean' },
    },
    required: ['daemon', 'proxy', 'config', 'reachable'],
    additionalProperties: false,
  },
  async handler(_args, context) {
    const proxy = await discoverProxyStatus(context.config.proxy);
    const status = await gatewayStatus(context.config, context.configPath, context.paths, proxy);
    return {
      daemon: status.daemon,
      proxy: status.proxy,
      config: status.config,
      reachable: status.reachable,
    };
  },
};

/** The four tools of the server, in the order they are listed. */
export const TOOLS: ToolDefinition[] = [
  publishDevServer,
  removeDevServer,
  listDevServers,
  gatewardenStatus,
];

/** The names of the four tools. */
export const TOOL_NAMES = TOOLS.map((tool) => tool.name);
