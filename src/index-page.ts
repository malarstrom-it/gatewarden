/**
 * The index page: a live console of the dev servers that agents publish
 * through the gateway.
 *
 * The page is server rendered and self contained: one HTML document, one
 * stylesheet, one script and one self hosted font, all served by the
 * registry itself. No framework, no runtime dependency, no runtime build, no
 * CDN request: the stylesheet is Tailwind, compiled ahead of time and
 * committed.
 *
 * The subject is a routing table. Rows are grouped by project, because a
 * project is the unit the proxy certificate is issued for; every row is one
 * route, from the public host name to the port the dev server listens on
 * inside the container, with a badge that says whether anything answers
 * there.
 *
 * The styles are Tailwind utilities over a shadcn token set, compiled into
 * `assets/index.css` from `assets/index.src.css`.
 */

import type { Config, Registration } from './types.ts';

/** Whether the dev server behind a route answers on its port. */
export type RouteState = 'up' | 'down';

/** A registration together with the state the gateway probed. */
export interface RouteView {
  registration: Registration;
  state: RouteState;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "1 route" / "2 routes". */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * How long ago a timestamp was, in words a developer reads at a glance.
 *
 * The unit that fits is chosen, so the number stays short: seconds, minutes,
 * hours, then days.
 */
export function formatAge(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'just now';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${plural(minutes, '1 minute', `${minutes} minutes`)} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, '1 hour', `${hours} hours`)} ago`;
  const days = Math.round(hours / 24);
  return `${plural(days, '1 day', `${days} days`)} ago`;
}

/** Local wall clock time, to the second. */
export function formatClock(now: number = Date.now()): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** The command an agent runs to publish a dev server. */
export function registerCommand(): string {
  return 'node ~/projects/traefik-api/bin/traefik-dev.js register --project my-app --branch feature --port 5173';
}

interface ProjectGroup {
  projectSlug: string;
  routes: RouteView[];
}

/** Group the routes by project, keeping the order the registrations have. */
export function groupByProject(routes: RouteView[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const bySlug = new Map<string, ProjectGroup>();
  for (const route of routes) {
    const slug = route.registration.projectSlug;
    let group = bySlug.get(slug);
    if (!group) {
      group = { projectSlug: slug, routes: [] };
      bySlug.set(slug, group);
      groups.push(group);
    }
    group.routes.push(route);
  }
  return groups;
}

/**
 * A host name that may break at its dots.
 *
 * The text is the same; the only addition is a break opportunity after every
 * dot, so a long host name wraps between labels instead of inside one.
 */
function breakableFqdn(fqdn: string): string {
  return escapeHtml(fqdn).replace(/\./g, '.<wbr>');
}

/** The word that names the state, on the badge in the status column. */
function stateWord(state: RouteState): string {
  return state === 'up' ? 'Up' : 'Down';
}

/** The copy icon: two overlapping squares, drawn in one stroke. */
function copyIcon(): string {
  return [
    '<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"',
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
    '<rect width="14" height="14" x="8" y="8" rx="2"></rect>',
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
    '</svg>',
  ].join('');
}

/** The bin icon: a lid and a body, drawn in one stroke. */
function trashIcon(): string {
  return [
    '<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"',
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
    '<path d="M3 6h18"></path>',
    '<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>',
    '<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>',
    '<path d="M10 11v6"></path>',
    '<path d="M14 11v6"></path>',
    '</svg>',
  ].join('');
}

function renderRoute(route: RouteView, now: number): string {
  const registration = route.registration;
  const url = `https://${registration.fqdn}`;
  const label = registration.label
    ? `<div class="mt-0.5 text-xs text-muted-foreground">${escapeHtml(registration.label)}</div>`
    : '';
  const age = formatAge(registration.createdAt, now);

  return [
    `        <tr class="route-body flex flex-wrap md:table-row" data-registration-id="${escapeHtml(registration.id)}" data-state="${route.state}">`,
    `          <td class="route-edge order-1 min-w-0 flex-1 md:table-cell md:flex-none md:max-w-80">`,
    `            <div class="font-medium break-words">${escapeHtml(registration.branchSlug)}</div>`,
    label,
    '          </td>',
    `          <td class="route-address-cell order-3 w-full md:table-cell md:w-auto"><a class="route-address link break-words" href="${escapeHtml(url)}" target="_blank" rel="noopener">${breakableFqdn(registration.fqdn)}</a></td>`,
    `          <td class="route-inside order-4 hidden whitespace-nowrap tabular-nums text-muted-foreground md:table-cell">127.0.0.1:${registration.devPort}</td>`,
    `          <td class="route-age order-4 whitespace-nowrap tabular-nums text-muted-foreground md:table-cell">${escapeHtml(age)}</td>`,
    `          <td class="order-2 md:table-cell"><span class="route-state badge">${stateWord(route.state)}</span></td>`,
    '          <td class="order-5 ml-auto text-right md:table-cell md:ml-0 md:w-auto">',
    '            <div class="route-actions flex items-center justify-end gap-1">',
    `              <button type="button" class="btn btn-ghost btn-icon copy" data-copy="${escapeHtml(url)}" data-icon="1" aria-label="Copy address" title="Copy address">${copyIcon()}</button>`,
    `              <button type="button" class="btn btn-ghost btn-icon remove text-subtle-foreground hover:text-danger" data-registration-id="${escapeHtml(registration.id)}" data-project="${escapeHtml(registration.projectSlug)}" data-branch="${escapeHtml(registration.branchSlug)}" data-host="${escapeHtml(registration.fqdn)}" aria-label="Remove" title="Remove">${trashIcon()}</button>`,
    '            </div>',
    '          </td>',
    '        </tr>',
  ].join('\n');
}

function renderGroup(group: ProjectGroup, config: Config, now: number): string {
  const certificate =
    config.tlsMode === 'wildcard'
      ? `*.${group.projectSlug}.${config.zone}`
      : 'one certificate per route';
  const rows = group.routes.map((route) => renderRoute(route, now)).join('\n');

  return [
    `    <section class="card overflow-hidden" data-project-slug="${escapeHtml(group.projectSlug)}" data-project-name="${escapeHtml(group.routes[0]?.registration.project ?? group.projectSlug)}">`,
    '      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-4">',
    `        <h2 class="group__name text-lg font-semibold tracking-tight">${escapeHtml(group.projectSlug)}</h2>`,
    `        <span class="group__cert badge badge-muted font-mono"><code>${escapeHtml(certificate)}</code></span>`,
    `        <span class="group__count ml-auto text-xs text-muted-foreground">${group.routes.length} ${plural(group.routes.length, 'route', 'routes')}</span>`,
    '      </div>',
    '      <div class="overflow-x-auto">',
    '        <table class="table block md:table">',
    `          <caption class="sr-only">Routes published by ${escapeHtml(group.projectSlug)}</caption>`,
    '          <thead class="table-head hidden md:table-header-group">',
    '            <tr>',
    '              <th scope="col">Route</th>',
    '              <th scope="col">Endpoint</th>',
    '              <th scope="col" class="hidden md:table-cell">Port</th>',
    '              <th scope="col" class="hidden lg:table-cell">Age</th>',
    '              <th scope="col">Status</th>',
    '              <th scope="col" class="text-right"><span class="sr-only">Actions</span></th>',
    '            </tr>',
    '          </thead>',
    '          <tbody class="table-body block md:table-row-group">',
    rows,
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

/** The empty state: what to do instead of an empty table. */
export function renderEmptyState(): string {
  const command = registerCommand();
  return [
    '    <section class="card px-6 py-8">',
    '      <h2 class="text-2xl font-semibold tracking-tight">Nothing is running</h2>',
    '      <p class="mt-3 max-w-xl text-base font-light text-muted-foreground">',
    '        When an agent starts a dev server in this container and registers it, the route shows up here',
    '        within a few seconds.',
    '      </p>',
    '      <div class="mt-6 flex flex-wrap items-center gap-3">',
    `        <code class="command block rounded-lg border border-border bg-muted px-4 py-3 text-sm break-words">${escapeHtml(command)}</code>`,
    `        <button type="button" class="btn btn-primary copy" data-copy="${escapeHtml(command)}">Copy command</button>`,
    '      </div>',
    '    </section>',
  ].join('\n');
}

/** The list of routes: the content of the page, grouped by project. */
export function renderRoutes(routes: RouteView[], config: Config, now: number = Date.now()): string {
  if (routes.length === 0) return renderEmptyState();
  return groupByProject(routes)
    .map((group) => renderGroup(group, config, now))
    .join('\n');
}

/**
 * The whole page.
 *
 * The route list is the content; the masthead only says what the gateway is
 * and how fresh the data is.
 */
export function renderIndex(routes: RouteView[], config: Config, now: number = Date.now()): string {
  const answering = routes.filter((route) => route.state === 'up').length;
  const count = routes.length;
  const relay = `${config.advertisedHost || config.advertisedIp}:${config.relayPort}`;

  return `<!doctype html>
<html lang="en" class="h-full">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Dev gateway</title>
    <link rel="stylesheet" href="/index.css" />
    <link rel="preload" href="/fonts/hanken-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin />
  </head>
  <body class="min-h-full bg-background text-foreground antialiased">
    <div class="mx-auto w-full max-w-6xl px-6 py-10">
      <header class="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-border pb-6">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-3xl font-semibold tracking-tight">Dev gateway</h1>
            <button type="button" class="btn btn-outline" id="new-route-toggle" aria-expanded="false" aria-controls="new-route">New route</button>
          </div>
          <p class="head__subject max-w-xl text-base font-light text-muted-foreground">Routes for the dev servers agents run in this container.</p>
        </div>
        <div class="flex flex-col gap-2 sm:items-end">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:justify-end">
            <span class="head__counts flex items-center gap-x-5" aria-live="polite" aria-atomic="true">
              <span class="head__count text-muted-foreground" id="route-count">${count} ${plural(count, 'route', 'routes')}</span>
              <span class="badge ${answering > 0 ? 'badge-up' : 'badge-down'}" id="route-answering" title="${answering} of ${count} ${plural(count, 'route', 'routes')} ${plural(count, 'answers', 'answer')}">${answering} up</span>
            </span>
            <span class="head__checked text-xs text-subtle-foreground">checked <time class="tabular-nums" id="checked-at">${formatClock(now)}</time></span>
          </div>
          <p class="head__facts flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle-foreground sm:justify-end">
            <span>Zone <code class="font-mono">${escapeHtml(config.zone)}</code></span>
            <span>Relay <code class="font-mono">${escapeHtml(relay)}</code></span>
            <span>Registry port <code class="font-mono">${config.registryPort}</code></span>
          </p>
        </div>
      </header>

      <section class="new-route card mt-6" id="new-route" aria-labelledby="new-route-title" hidden>
        <form class="new-route__form" id="new-route-form" novalidate>
          <h2 class="new-route__title" id="new-route-title">New route</h2>
          <p class="new-route__hint">
            The route is served at <code class="font-mono">&lt;branch&gt;.&lt;project&gt;.${escapeHtml(config.zone)}</code>, with the
            project's wildcard certificate.
          </p>
          <div class="new-route__fields">
            <div class="field">
              <label class="field__label" for="new-route-project">Project</label>
              <input
                class="field__input"
                id="new-route-project"
                name="project"
                type="text"
                placeholder="my-app"
                autocomplete="off"
                spellcheck="false"
                data-hint="new-route-project-hint"
                aria-describedby="new-route-project-hint"
              />
              <p class="field__hint" id="new-route-project-hint">The project the route belongs to.</p>
              <p class="field__error" id="new-route-project-error" role="alert" hidden></p>
            </div>
            <div class="field">
              <label class="field__label" for="new-route-branch">Branch</label>
              <input
                class="field__input"
                id="new-route-branch"
                name="branch"
                type="text"
                placeholder="feature"
                autocomplete="off"
                spellcheck="false"
                data-hint="new-route-branch-hint"
                aria-describedby="new-route-branch-hint"
              />
              <p class="field__hint" id="new-route-branch-hint">The branch of the project.</p>
              <p class="field__error" id="new-route-branch-error" role="alert" hidden></p>
            </div>
            <div class="field">
              <label class="field__label" for="new-route-port">Port</label>
              <input
                class="field__input"
                id="new-route-port"
                name="port"
                type="text"
                inputmode="numeric"
                placeholder="5173"
                autocomplete="off"
                data-hint="new-route-port-hint"
                aria-describedby="new-route-port-hint"
              />
              <p class="field__hint" id="new-route-port-hint">The port the dev server listens on inside this container.</p>
              <p class="field__error" id="new-route-port-error" role="alert" hidden></p>
            </div>
          </div>
          <p class="new-route__error" id="new-route-error" role="alert" hidden></p>
          <p class="new-route__certificate" id="new-route-certificate" hidden>A new project's certificate is issued when its first route appears — the first request can take about ten seconds.</p>
          <div class="new-route__actions">
            <button type="submit" class="btn btn-primary">Create route</button>
            <button type="button" class="btn btn-ghost" id="new-route-cancel">Cancel</button>
          </div>
        </form>
      </section>

      <p class="message min-h-6 pt-4 text-sm text-muted-foreground" id="message" role="status" aria-live="polite"></p>
      <p class="sr-only" id="announcer" role="status" aria-live="polite"></p>

      <main class="routes mt-6 space-y-6" id="routes" aria-label="Published routes">
${renderRoutes(routes, config, now)}
      </main>
    </div>
    <script src="/index.js"></script>
  </body>
</html>
`;
}
