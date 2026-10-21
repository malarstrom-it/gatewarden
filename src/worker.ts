/**
 * Worker entry point.
 *
 * The daemon supervises one worker per listener (registry, relay) so a crash
 * in one listener cannot take the other down.
 *
 * Usage: node src/worker.ts <registry|relay>
 */

import { loadConfig, listenHost } from './config.ts';
import { RegistrationStore } from './state.ts';
import { createRegistryServer } from './registry.ts';
import { createRelayServer } from './relay.ts';
import { log, setLogLevel } from './log.ts';

const SCOPE = 'worker';

async function main(): Promise<void> {
  const role = process.argv[2];
  if (role !== 'registry' && role !== 'relay') {
    process.stderr.write('usage: node src/worker.ts <registry|relay>\n');
    process.exit(2);
  }

  const config = loadConfig();
  setLogLevel(process.env['TRAEFIK_DEV_LOG_LEVEL'] === 'debug' ? 'debug' : 'info');
  const store = new RegistrationStore(config.stateDir);

  const server = role === 'registry' ? createRegistryServer(store, config) : createRelayServer(store, config);
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

main().catch((error: unknown) => {
  log('error', SCOPE, 'worker failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
