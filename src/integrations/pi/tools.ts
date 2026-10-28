/**
 * The native tools of the pi extension (§7).
 *
 * The extension offers three of the four tools of §6.2:
 * `publish_dev_server`, `remove_dev_server` and `list_dev_servers`. The
 * fourth one, `dev_gateway_status`, is not a tool here: the status line
 * and the `/routes` command show the state of the gateway to the user
 * directly, which is what the pi surface is for.
 *
 * The tools themselves are the MCP tools. The work is done once, in the
 * core, and both surfaces call the same code — the extension adds the
 * native tool contract (a schema the model sees, a structured result a
 * program can read), not a second implementation.
 */

import { ensureDaemon } from '../../core/daemonControl.ts';
import type { RouteJson } from '../../core/status.ts';
import { createToolContext, TOOLS as MCP_TOOLS, type ToolDefinition } from '../mcp/tools.ts';
import type { PiExtensionContext, PiJsonSchema, PiToolDefinition } from './pi-api.ts';

/** The three tools the extension offers (§7). */
export const PI_TOOL_NAMES = ['publish_dev_server', 'remove_dev_server', 'list_dev_servers'] as const;

/**
 * The tools that change the routes.
 *
 * A tool that changes something needs the daemon: it serves the document
 * the proxy polls. A tool that only reads the state file does not, and
 * must not start a background process either — a tool that is declared
 * read-only has to leave the environment alone.
 */
const MUTATING_TOOLS = new Set(['publish_dev_server', 'remove_dev_server']);

/** The name of the tool that lists the routes. */
const LIST_TOOL = 'list_dev_servers';

/** What the tools tell the extension about a change. */
export interface PiToolOptions {
  /**
   * Called after a tool changed the routes.
   *
   * The status line counts the live routes, so it has to be told that
   * something changed.
   */
  onRoutesChanged?: (ctx: PiExtensionContext) => Promise<void> | void;
}

/** The MCP tool of a name. */
function mcpTool(name: string): ToolDefinition {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`the tool ${name} is missing from the MCP tools`);
  return tool;
}

/** The hints pi shows about a tool. */
function annotationsOf(name: string): PiToolDefinition['annotations'] {
  if (name === 'list_dev_servers') return { readOnlyHint: true, openWorldHint: false };
  if (name === 'remove_dev_server') return { destructiveHint: true, openWorldHint: false };
  return { openWorldHint: false };
}

/** The one line the system prompt tells the model about a tool. */
function snippetOf(name: string): string {
  if (name === 'list_dev_servers') return 'List the published development servers';
  if (name === 'remove_dev_server') return 'Remove a published development server';
  return 'Publish a development server so the user can open it in a browser';
}

/**
 * The routes, in the shape the tools return (§6.2).
 *
 * The list tool of the MCP server does the work, so that the table, the
 * tool output and the status line all count the same routes.
 */
export async function listRoutes(cwd: string): Promise<RouteJson[]> {
  const context = createToolContext({ cwd });
  const result = (await mcpTool(LIST_TOOL).handler({}, context)) as { routes: RouteJson[] };
  return result.routes;
}

/** The three tools of the extension, ready to be registered. */
export function createPiTools(options: PiToolOptions = {}): PiToolDefinition[] {
  return PI_TOOL_NAMES.map((name) => {
    const source = mcpTool(name);
    return {
      name: source.name,
      label: source.title,
      description: source.description,
      parameters: source.inputSchema as PiJsonSchema,
      outputSchema: source.outputSchema as PiJsonSchema,
      promptSnippet: snippetOf(name),
      annotations: annotationsOf(name),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const context = createToolContext({ cwd: ctx.cwd });

        // The lazy start (§5.1): the daemon serves the document the proxy
        // polls. Without it a published route is never served. A tool that
        // only reads the routes does not start it: it would change the
        // environment of a tool that is declared read-only.
        if (MUTATING_TOOLS.has(name)) {
          const started = await ensureDaemon(context.config, { configPath: context.configPath });
          if (started.error) throw new Error(started.error);
        }

        const result = await source.handler(params, context);
        await options.onRoutesChanged?.(ctx);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          details: result,
        };
      },
    };
  });
}
