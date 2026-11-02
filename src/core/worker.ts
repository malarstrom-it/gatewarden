/**
 * Worker: one supervised listener.
 *
 * The daemon supervises one worker per listener (registry, relay) so a crash
 * in one listener cannot take the other down.
 *
 * The worker renders the dynamic configuration with the proxy adapter it is
 * handed: the core does not know which proxy it serves (D3).
 *
 * The worker is an internal process of the daemon: the daemon starts it
 * with the role `registry` or `relay`. A user starts the daemon with
 * `gatewarden start`.
 */

import { loadConfig, configPathFromArgv, listenHost } from './config.ts';
import type { Config } from './types.ts';
import type { ProxyAdapter } from './proxy.ts';
import { RegistrationStore } from './state.ts';
import { createRegistryServer } from './registry.ts';
import { createRelayServer } from './relay.ts';
import { log, setLogLevel } from './log.ts';

const SCOPE = 'worker';

/** The listener a worker runs. */
export type WorkerRole = 'registry' | 'relay';

/**
 * Run a worker until it is stopped.
 *
 * The adapter is only needed by the registry worker; the relay worker
 * dispatches on the header the adapter stamps.
 */
export async function runWorker(role: WorkerRole, adapter: ProxyAdapter, config: Config): Promise<void> {
  setLogLevel(
    (process.env['GATEWARDEN_LOG_LEVEL'] ??
      process.env['DEV_GATEWAY_LOG_LEVEL'] ??
      process.env['TRAEFIK_DEV_LOG_LEVEL']) === 'debug'
      ? 'debug'
      : 'info',
  );
  const store = new RegistrationStore(config.stateDir);

  const server = role === 'registry' ? createRegistryServer(store, config, adapter) : createRelayServer(store, config);
  const port = role === 'registry' ? config.registryPort : config.relayPort;
  const host = listenHost();

  server.on('error', (error: Error) => {
    log('error', SCOPE, `${role} listener failed`, error.message);
    process.exit(1);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  log('info', SCOPE, `${role} listening on ${host}:${port}`);

  const shutdown = () => {
    log('info', SCOPE, `${role} shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('message', (message: unknown) => {
    if (message === 'shutdown') shutdown();
  });
}
