/**
 * The worker entry point.
 *
 * The daemon forks one worker per listener. The worker is the process that
 * picks the proxy adapter: the core hands the adapter to the worker, and
 * the worker never learns which proxy it renders for (D3).
 *
 * The worker is an internal process of the daemon: the daemon starts it
 * with the role `registry` or `relay`. A user starts the daemon with
 * `gatewarden start`.
 */

import { loadConfig, configPathFromArgv } from './core/config.ts';import { requireAdapter } from './adapters/index.ts';
import { runWorker, type WorkerRole } from './core/worker.ts';

const role = process.argv[2];
if (role !== 'registry' && role !== 'relay') {
  process.stderr.write(
    'worker: the role must be "registry" or "relay". The daemon starts the worker; "gatewarden start" starts the daemon.\n',
  );
  process.exit(2);
}

// The daemon names the configuration file it resolved, so that the worker
// reads the same file as the daemon.
const configPath = configPathFromArgv(process.argv);
const config = loadConfig(configPath ? { configPath } : {});
const adapter = requireAdapter(config.proxy);

runWorker(role as WorkerRole, adapter, config).catch((error: unknown) => {
  process.stderr.write(`worker failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
