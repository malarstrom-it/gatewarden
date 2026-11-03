/**
 * The MCP server: the primary agent surface, speaking the stdio
 * JSON-RPC protocol directly.
 *
 * The official SDK is a dev dependency: the MCP conformance test drives
 * this server with the SDK's own client, and nothing else needs it. The
 * transport is newline-delimited JSON-RPC — one JSON object per line, in
 * both directions — and the standard output carries nothing else.
 *
 * The server never starts the daemon when it starts. The daemon is started
 * by the first tool call — the lazy start — so that running the server is
 * safe: it does not change anything until an agent asks it to.
 */

import { createInterface } from 'node:readline';
import process from 'node:process';
import { ensureDaemon } from '../../core/daemonControl.ts';
import { deprecatedEnvNotices } from '../../core/paths.ts';
import { packageVersion } from '../../core/util/module.ts';
import { createToolContext, TOOLS, type ToolDefinition } from './tools.ts';

/** The JSON-RPC version every message carries. */
export const JSONRPC_VERSION = '2.0';

/**
 * The protocol versions the server speaks.
 *
 * The version the client asks for is used when it is one of these; the
 * client is then sure that the server understands what it says. A client
 * that asks for something else gets the newest version here.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

/** The newest protocol version the server speaks. */
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** The JSON-RPC error codes the server uses. */
export const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcId = string | number;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: string;
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: string;
  id: JsonRpcId | null;
  error: JsonRpcError;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** What the client sends: a request, a notification or a response. */
export type JsonRpcMessage = Record<string, unknown>;

/** The text the client is told about the server, once, at the handshake. */
export const INSTRUCTIONS =
  'Publish a development server with publish_dev_server and give the user the returned url verbatim. ' +
  'Do not compose the host name yourself. list_dev_servers shows what is published, ' +
  'remove_dev_server takes a route away, and dev_gateway_status reports the state of the gateway.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Is this an id a response may carry? */
function isValidId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function failure(id: JsonRpcId | null, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

export interface McpServerOptions {
  /** The tools the server offers. Defaults to the four of the MCP server. */
  tools?: ToolDefinition[];
  /** The name and the version of the server. */
  serverInfo?: { name: string; version: string };
  /** The working directory the project and the branch are inferred from. */
  cwd?: string;
  /** An explicit configuration file. */
  configPath?: string;
  /** An explicit state directory. */
  stateDir?: string;
}

/**
 * The server: it takes a message and answers it.
 *
 * The transport is not part of it, so that the protocol can be tested
 * without a process, and the process without a client.
 */
export class McpServer {
  private readonly tools: Map<string, ToolDefinition>;
  private readonly serverInfo: { name: string; version: string };
  private readonly options: McpServerOptions;

  constructor(options: McpServerOptions = {}) {
    this.options = options;
    this.tools = new Map((options.tools ?? TOOLS).map((tool) => [tool.name, tool]));
    this.serverInfo = options.serverInfo ?? { name: 'gatewarden', version: packageVersion() };
  }

  /** The names of the tools the server offers. */
  toolNames(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Answer one message.
   *
   * A notification has no answer: the result is `null`.
   */
  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isRecord(message)) {
      return failure(null, ERROR_CODES.invalidRequest, 'Invalid request: the message is not an object');
    }

    const method = message['method'];
    if (typeof method !== 'string') {
      const id = message['id'];
      return isValidId(id)
        ? failure(id, ERROR_CODES.invalidRequest, 'Invalid request: the method is missing')
        : null;
    }

    const id = message['id'];
    if (!isValidId(id)) {
      // A notification. There is nothing to answer.
      return null;
    }

    const params = isRecord(message['params']) ? message['params'] : {};

    try {
      switch (method) {
        case 'initialize':
          return success(id, this.initialize(params));
        case 'ping':
          return success(id, {});
        case 'tools/list':
          return success(id, { tools: this.toolDescriptors() });
        case 'tools/call':
          return await this.callTool(id, params);
        default:
          return failure(id, ERROR_CODES.methodNotFound, `Method not found: ${method}`);
      }
    } catch (error) {
      return failure(id, ERROR_CODES.internalError, (error as Error).message);
    }
  }

  /** The handshake: the version, the capabilities and who we are. */
  private initialize(params: Record<string, unknown>): Record<string, unknown> {
    const requested = params['protocolVersion'];
    const protocolVersion =
      typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;

    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: this.serverInfo,
      instructions: INSTRUCTIONS,
    };
  }

  /** The tools, as the client wants to see them. */
  private toolDescriptors(): Array<Record<string, unknown>> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }));
  }

  /**
   * Call a tool.
   *
   * A tool that fails says so in the result, with `isError` set: the agent
   * can read the message and try again. Only a call that cannot be made at
   * all — an unknown tool, arguments that are not an object — is answered
   * with a protocol error.
   */
  private async callTool(id: JsonRpcId, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const name = params['name'];
    if (typeof name !== 'string') {
      return failure(id, ERROR_CODES.invalidParams, 'Invalid params: the tool name is missing');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return failure(id, ERROR_CODES.invalidParams, `Unknown tool: ${name}`);
    }

    const args = isRecord(params['arguments']) ? params['arguments'] : {};

    try {
      const context = createToolContext({
        cwd: this.options.cwd,
        configPath: this.options.configPath,
        stateDir: this.options.stateDir,
      });

      // The lazy start: the daemon serves the document the proxy polls.
      // The server does not start it when it starts — the first tool
      // call does.
      const started = await ensureDaemon(context.config, { configPath: context.configPath });
      if (started.error) throw new Error(started.error);

      const result = await tool.handler(args, context);
      if (!isRecord(result)) {
        throw new Error(`the tool ${name} returned something that is not an object`);
      }
      return success(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      });
    } catch (error) {
      return success(id, {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true,
      });
    }
  }
}

export interface StdioOptions {
  /** Where the messages come from. Defaults to the standard input. */
  input?: NodeJS.ReadableStream;
  /** Where the answers go. Defaults to the standard output. */
  output?: NodeJS.WritableStream;
  /** What to do with a failure that is not a message. */
  onError?: (error: Error) => void;
}

/**
 * Answer one line of the transport.
 *
 * A line that is not JSON is answered with a parse error, and a line that
 * is a notification is answered with nothing.
 */
export async function handleLine(server: McpServer, line: string): Promise<JsonRpcResponse | null> {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let message: unknown;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    return failure(null, ERROR_CODES.parseError, `Parse error: ${(error as Error).message}`);
  }

  return server.handleMessage(message);
}

/**
 * Serve the protocol over the standard input and the standard output.
 *
 * The answers go out in the order the questions came in, one JSON object
 * per line. Nothing else is ever written to the standard output: the
 * standard error is where the news goes.
 */
export function runStdioServer(server: McpServer, options: StdioOptions = {}): void {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const lines = createInterface({ input, crlfDelay: Infinity });

  let queue: Promise<void> = Promise.resolve();

  lines.on('line', (line) => {
    queue = queue
      .then(async () => {
        const response = await handleLine(server, line);
        if (response) output.write(JSON.stringify(response) + '\n');
      })
      .catch((error: unknown) => {
        options.onError?.(error as Error);
      });
  });
}

/** The arguments of the launcher. */
export interface ServerArgs {
  configPath?: string;
  stateDir?: string;
  help: boolean;
  version: boolean;
}

/** Read the arguments of the launcher. */
export function parseServerArgs(argv: string[]): ServerArgs {
  const args: ServerArgs = { help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      args.version = true;
    } else if (arg === '--config') {
      args.configPath = argv[index + 1];
      index += 1;
    } else if (arg === '--state-dir') {
      args.stateDir = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function usage(): string {
  return `gatewarden-mcp — the MCP server of the gateway (stdio JSON-RPC)

Usage:
  gatewarden-mcp [--config <path>] [--state-dir <path>]

The server speaks the Model Context Protocol over the standard input and the
standard output. It offers four tools: publish_dev_server, remove_dev_server,
list_dev_servers and dev_gateway_status.

The daemon is not started when the server starts; the first tool call starts
it.

Environment:
  GATEWARDEN_HOME         everything in one directory
  GATEWARDEN_CONFIG       the configuration file
  GATEWARDEN_STATE_DIR    the state directory
`;
}

/**
 * Run the server.
 *
 * This is what `bin/gatewarden-mcp.js` calls.
 */
export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseServerArgs(argv);

  // The environment variables that were renamed still work. They say so
  // once, on the standard error, where the protocol does not see it.
  for (const notice of deprecatedEnvNotices()) {
    process.stderr.write(`warning: ${notice}\n`);
  }

  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (args.version) {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }

  runStdioServer(
    new McpServer({
      configPath: args.configPath,
      stateDir: args.stateDir,
    }),
    {
      onError: (error) => {
        process.stderr.write(`gatewarden-mcp: ${error.message}\n`);
      },
    },
  );
}
