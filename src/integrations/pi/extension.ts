/**
 * The pi extension (§7).
 *
 * One adapter over the core. The extension gives the pi user the three
 * things the MCP server alone does not give: a native tool contract, a
 * route table in the terminal, and a status line that says how many
 * routes are live.
 *
 * The extension is published compiled (`dist/integrations/pi/extension.js`),
 * so pi loads it without a TypeScript loader of its own:
 *
 *     pi -e ./dist/integrations/pi/extension.js
 *
 * It is a client of the core like every other surface (D12): it never
 * hosts the daemon, it makes sure the daemon runs.
 */

import { ensureDaemon } from '../../core/daemonControl.ts';
import { createToolContext } from '../mcp/tools.ts';
import type { PiComponent, PiExtensionApi, PiExtensionContext } from './pi-api.ts';
import { renderRouteTable } from './table.ts';
import { createPiTools, listRoutes } from './tools.ts';

/** The key of the status line in the footer. */
export const STATUS_KEY = 'dev-gateway';

/**
 * How often the status line is brought up to date, in milliseconds.
 *
 * The count of live routes changes when a development server starts or
 * dies, and nothing tells the extension when that happens. Without a
 * refresh the footer would keep a number that is no longer true.
 */
export const STATUS_REFRESH_MS = 5000;

/** What the extension can be told when it is loaded. */
export interface PiExtensionOptions {
  /** How often the status line is brought up to date. */
  statusRefreshMs?: number;
}

/** The text of the status line, for a number of live routes. */
export function statusText(live: number): string {
  return live === 1 ? '1 route live' : `${live} routes live`;
}

/**
 * The status line: how many routes are live.
 *
 * A route is live when the development server behind it answers on its
 * local port. The count is the one the tools report as `state: up`.
 */
async function refreshStatus(ctx: PiExtensionContext): Promise<void> {
  try {
    const routes = await listRoutes(ctx.cwd);
    const live = routes.filter((route) => route.state === 'up').length;
    ctx.ui.setStatus(STATUS_KEY, statusText(live));
  } catch {
    // The gateway is not readable: say so instead of showing a number
    // that means nothing.
    ctx.ui.setStatus(STATUS_KEY, 'dev-gateway unreachable');
  }
}

/**
 * Make sure the daemon runs (§5.1, §7).
 *
 * A failure is told to the user, not thrown: a gateway that does not
 * start must not keep the session from opening.
 */
async function ensureDaemonRunning(ctx: PiExtensionContext): Promise<void> {
  try {
    const context = createToolContext({ cwd: ctx.cwd });
    const started = await ensureDaemon(context.config, { configPath: context.configPath });
    if (started.error) ctx.ui.notify(`dev-gateway: ${started.error}`, 'warning');
  } catch (error) {
    ctx.ui.notify(`dev-gateway: ${(error as Error).message}`, 'warning');
  }
}

/** The table as a component pi can draw. */
function tableComponent(lines: string[], done: () => void): PiComponent {
  return {
    render(width: number): string[] {
      return lines.map((line) => (line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line));
    },
    invalidate(): void {
      // Nothing is cached.
    },
    handleInput(data: string): void {
      // Escape and Enter close the table.
      if (data === '\x1b' || data === '\r' || data === '\n') done();
    },
  };
}

/**
 * The extension.
 *
 * pi calls this when it loads the extension: the tools are registered,
 * the command is registered, and the session start is listened for.
 */
export default function devGatewayExtension(
  pi: PiExtensionApi,
  options: PiExtensionOptions = {},
): void {
  const refreshMs = options.statusRefreshMs ?? STATUS_REFRESH_MS;

  // The timer that keeps the status line fresh. It belongs to this
  // runtime: a reload loads the extension again, and the old runtime
  // stops its own timer when its session ends.
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;

  /** Stop the timer that keeps the status line fresh. */
  const stopStatusRefresh = (): void => {
    if (statusTimer !== undefined) {
      clearInterval(statusTimer);
      statusTimer = undefined;
    }
  };

  /**
   * Keep the status line fresh.
   *
   * The count of live routes changes when a development server starts or
   * dies, and nothing tells the extension when that happens. Without
   * this the footer would keep a number that is no longer true.
   */
  const startStatusRefresh = (ctx: PiExtensionContext): void => {
    stopStatusRefresh();
    // The modes without a terminal of their own show no status line.
    if (ctx.mode !== 'tui' && ctx.mode !== 'rpc') return;
    if (refreshMs <= 0) return;

    statusTimer = setInterval(() => {
      // One refresh at a time: a slow gateway must not pile up.
      if (refreshing) return;
      refreshing = true;
      void refreshStatus(ctx)
        .catch(() => {
          // The status line says what is wrong; the timer goes on.
        })
        .finally(() => {
          refreshing = false;
        });
    }, refreshMs);
    // The timer must not keep the process alive.
    statusTimer.unref?.();
  };

  for (const tool of createPiTools({ onRoutesChanged: refreshStatus })) {
    pi.registerTool(tool);
  }

  pi.registerCommand('routes', {
    description: 'Show the published development servers: the address of each one, and whether it answers',
    handler: async (_args, ctx) => {
      const routes = await listRoutes(ctx.cwd);
      const lines = renderRouteTable(routes);

      if (ctx.mode === 'tui' && ctx.ui.custom) {
        await ctx.ui.custom<undefined>((_tui, _theme, _keybindings, done) =>
          tableComponent(lines, () => done(undefined)),
        );
      } else {
        // The other modes have no terminal of their own: the table goes
        // out as a message.
        ctx.ui.notify(lines.join('\n'), 'info');
      }

      await refreshStatus(ctx);
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    await ensureDaemonRunning(ctx);
    await refreshStatus(ctx);
    startStatusRefresh(ctx);
  });

  // The session is over: the timer that keeps the status line fresh goes
  // with it. The cleanup is idempotent, because a session can end in
  // several ways.
  pi.on('session_shutdown', async () => {
    stopStatusRefresh();
  });
}
