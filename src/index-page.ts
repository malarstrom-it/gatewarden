/**
 * The index page: a live console of the dev servers that agents publish
 * through the gateway.
 *
 * The page is server rendered and self contained: one HTML document, one
 * stylesheet, one script and two self hosted fonts, all served by the
 * registry itself. No build step, no framework, no CDN request.
 *
 * The subject is a routing panel. Rows are grouped by project, because a
 * project is the unit the proxy certificate is issued for; every row is one
 * route, from the public host name to the port the dev server listens on
 * inside the container, with a lamp that shows whether anything answers
 * there.
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

function renderRoute(route: RouteView, now: number): string {
  const registration = route.registration;
  const url = `https://${registration.fqdn}`;
  const label = registration.label ? `<span class="route__label">${escapeHtml(registration.label)}</span>` : '';
  const age = formatAge(registration.createdAt, now);
  const stateText = route.state === 'up' ? 'answering' : 'not answering';

  return [
    `      <li class="route" data-registration-id="${escapeHtml(registration.id)}" data-state="${route.state}">`,
    `        <span class="route__lamp" aria-hidden="true"></span>`,
    `        <span class="route__name"><span class="route__branch">${escapeHtml(registration.branchSlug)}</span>${label}</span>`,
    `        <span class="route__route"><a class="route__address" href="${escapeHtml(url)}" target="_blank" rel="noopener">${breakableFqdn(registration.fqdn)}</a><span class="route__inside">127.0.0.1:${registration.devPort}</span><span class="route__age">${escapeHtml(age)}</span><span class="route__state">${stateText}</span></span>`,
    `        <span class="route__actions">`,
    `          <button type="button" class="copy" data-copy="${escapeHtml(url)}">Copy address</button>`,
    `          <button type="button" class="remove" data-registration-id="${escapeHtml(registration.id)}" data-project="${escapeHtml(registration.projectSlug)}" data-branch="${escapeHtml(registration.branchSlug)}" data-host="${escapeHtml(registration.fqdn)}">Remove</button>`,
    `        </span>`,
    '      </li>',
  ].join('\n');
}

function renderGroup(group: ProjectGroup, config: Config, now: number): string {
  const certificate =
    config.tlsMode === 'wildcard'
      ? `*.${group.projectSlug}.${config.zone}`
      : 'one certificate per route';
  const rows = group.routes.map((route) => renderRoute(route, now)).join('\n');

  return [
    `    <section class="group" data-project="${escapeHtml(group.projectSlug)}">`,
    `      <div class="group__head">`,
    `        <h2 class="group__name">${escapeHtml(group.projectSlug)}</h2>`,
    `        <p class="group__certificate"><span class="group__certificate-label">certificate</span> <code>${escapeHtml(certificate)}</code></p>`,
    `        <p class="group__count">${group.routes.length} ${plural(group.routes.length, 'route', 'routes')}</p>`,
    '      </div>',
    '      <ul class="group__routes">',
    rows,
    '      </ul>',
    '    </section>',
  ].join('\n');
}

/** The empty state: what to do instead of an empty table. */
export function renderEmptyState(): string {
  const command = registerCommand();
  return [
    '    <section class="empty">',
    '      <h2 class="empty__title">Nothing is running</h2>',
    '      <p class="empty__body">When an agent starts a dev server in this container and registers it, the route shows up here within a few seconds.</p>',
    '      <div class="empty__command">',
    `        <code class="command">${escapeHtml(command)}</code>`,
    `        <button type="button" class="copy" data-copy="${escapeHtml(command)}">Copy command</button>`,
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
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Traefik dev gateway</title>
    <link rel="stylesheet" href="/index.css" />
    <link rel="preload" href="/fonts/familjen-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/azeret-mono-latin.woff2" as="font" type="font/woff2" crossorigin />
  </head>
  <body>
    <div class="page">
      <header class="masthead">
        <div class="masthead__identity">
          <h1 class="masthead__title">Dev gateway</h1>
          <p class="masthead__subject">Routes for the dev servers agents run in this container.</p>
        </div>
        <div class="masthead__state">
          <p class="masthead__counts">
            <span id="route-count">${count} ${plural(count, 'route', 'routes')}</span>
            <span id="route-answering" data-live="${answering > 0}">${answering} answering</span>
          </p>
          <p class="masthead__checked">checked <time id="checked-at">${formatClock(now)}</time></p>
        </div>
      </header>

      <p class="message" id="message" role="status" aria-live="polite"></p>

      <main class="routes" id="routes" aria-label="Published routes">
${renderRoutes(routes, config, now)}
      </main>

      <footer class="footer">
        <span>Zone <code>${escapeHtml(config.zone)}</code></span>
        <span>Relay <code>${escapeHtml(relay)}</code></span>
        <span>Registry port <code>${config.registryPort}</code></span>
      </footer>
    </div>
    <script src="/index.js"></script>
  </body>
</html>
`;
}
