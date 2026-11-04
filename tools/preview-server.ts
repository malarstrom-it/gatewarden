/**
 * Review harness: the index page on a local port with made-up routes.
 *
 * It renders the same HTML, CSS and JS the registry serves, but the routes
 * are invented and the ports are real listeners, so the page can be reviewed
 * with content, with a "not answering" route and with an empty state
 * without touching the live registry.
 *
 * The state directory is a throwaway one, so the CLI can drive it too:
 *
 *   node bin/gatewarden.js register --state-dir /tmp/traefik-preview \
 *     --config /tmp/traefik-preview/config.json --project x --branch y --port 5173
 *
 * A review tool: the daemon never loads it.
 *
 *   node tools/preview-server.ts [port]
 */

import fs from 'node:fs';
import net from 'node:net';
import { createRegistryServer } from '../src/core/registry.ts';
import { RegistrationStore } from '../src/core/state.ts';
import { loadConfig } from '../src/core/config.ts';
import { traefikAdapter } from '../src/adapters/traefik.ts';

const port = Number(process.argv[2] ?? 45099);
const stateDir = process.argv[3] ?? '/tmp/traefik-preview';
const empty = process.env['PREVIEW_EMPTY'] === '1';

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(
  `${stateDir}/config.json`,
  JSON.stringify(
    { registryPort: port, relayPort: 45001, advertisedHost: 'gateway', zone: 'example.com' },
    null,
    2,
  ) + '\n',
);

const config = loadConfig({ stateDir, overrides: { registryPort: port } });

const store = new RegistrationStore(stateDir);

const routes: Array<{ project: string; branch: string; port: number; label?: string }> = [
  { project: 'my-app', branch: 'main', port: 45101 },
  { project: 'my-app', branch: 'feat/index-polish', port: 45102, label: 'polish the index page' },
  { project: 'other-app', branch: 'feature/work', port: 45103 },
  { project: 'probe', branch: 'feature-probe', port: 45999 },
  { project: 'site', branch: 'main', port: 45998 },
];

const listeners: net.Server[] = [];
for (const route of routes) {
  if (empty) break;
  if (route.port > 45990) continue; // the ports above stay closed: "not answering"
  const server = net.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(route.port, '127.0.0.1', resolve));
  listeners.push(server);
}

for (const route of routes) {
  if (empty) break;
  store.upsert({
    project: route.project,
    branch: route.branch,
    devPort: route.port,
    label: route.label,
    zone: config.zone,
  });
}

const server = createRegistryServer(store, config, traefikAdapter);
server.listen(port, '127.0.0.1', () => {
  console.log(`preview on http://127.0.0.1:${port}/ (${routes.length} routes, state ${stateDir})`);
});

process.on('SIGTERM', () => {
  for (const listener of listeners) listener.close();
  server.close(() => process.exit(0));
});
