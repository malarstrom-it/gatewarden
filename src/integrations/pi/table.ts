/**
 * The route table the `/routes` command renders.
 *
 * The table shows both halves of a route: the local one — the port the
 * development server listens on, and whether it answers — and the public
 * one, the address the user opens in a browser.
 *
 * The rows are the routes in the shape the tools return, so the
 * table and the tool output never disagree.
 */

import type { RouteJson } from '../../core/status.ts';

/** The columns of the table, in order. */
export const ROUTE_TABLE_HEADERS = ['PROJECT', 'BRANCH', 'PORT', 'LOCAL', 'PUBLIC'] as const;

/** The line the table shows when there is no route at all. */
export const EMPTY_ROUTE_TABLE = 'no routes are published';

/** The rows of the table: one route per row. */
function rowOf(route: RouteJson): string[] {
  return [route.project, route.branch, String(route.port), route.state, route.url];
}

/** Pad a cell to the width of its column. */
function pad(cell: string, width: number): string {
  return cell.length >= width ? cell : cell + ' '.repeat(width - cell.length);
}

/**
 * Render the route table.
 *
 * The lines are plain text, so the table can be drawn in the terminal, in
 * a notification, or in a widget, without a renderer of its own.
 */
export function renderRouteTable(routes: RouteJson[]): string[] {
  if (routes.length === 0) return [EMPTY_ROUTE_TABLE];

  const rows = routes.map(rowOf);
  const widths = ROUTE_TABLE_HEADERS.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]!.length)),
  );

  const lines: string[] = [];
  lines.push(
    ROUTE_TABLE_HEADERS.map((header, column) => pad(header, widths[column]!)).join('  ').trimEnd(),
  );
  for (const row of rows) {
    lines.push(row.map((cell, column) => pad(cell, widths[column]!)).join('  ').trimEnd());
  }
  return lines;
}
