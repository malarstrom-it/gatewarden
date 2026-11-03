/**
 * The worker entry point.
 *
 * The daemon forks one worker per listener. The worker is the process that
 * picks the proxy adapter: the core hands the adapter to the worker, and
 * the worker never learns which proxy it renders for — the core is
 * proxy-agnostic and Traefik is one adapter.
 *
 * The worker is an internal process of the daemon: the daemon starts it
 * with the role `registry` or `relay`. A user starts the daemon with
 * `gatewarden start`.
 */

import { loadConfig, configPathFromArgv } from './core/config.ts';
import { isUnknownProxyError, requireAdapter } from './adapters/index.ts';
import { runWorker, type WorkerRole } from './core/worker.ts';
import type { Config } from './core/types.ts';
import type { ProxyAdapter } from './core/proxy.ts';

const role = process.argv[2];
if (role !== 'registry' && role !== 'relay') {
  process.stderr.write(
    'worker: the role must be "registry" or "relay". The daemon starts the worker; "gatewarden start" starts the daemon.\n',
  );
  process.exit(2);
}

/**
 * Tell the daemon that this worker will not serve, and why.
 *
 * The daemon has to tell the failures apart: a worker that dies of
 * something a restart can fix is started again, and one that dies of a
 * mistake no restart can fix stops the daemon. The reason travels over
 * the channel the daemon opened, and the process ends when the message
 * is on its way — a message that is cut off by the exit is a message
 * the daemon never sees.
 */
async function reportFatal(message: string): Promise<never> {
  process.stderr.write(`worker failed: ${message}\n`);
  await new Promise<void>((resolve) => {
    if (!process.send) {
      resolve();
      return;
    }
    try {
      process.send({ type: 'fatal', message }, () => resolve());
    } catch {
      // The channel is gone: the daemon is gone with it.
      resolve();
    }
  });
  process.exit(1);
}

/**
 * The adapter this worker renders with.
 *
 * A proxy id the package does not know is not a failure the worker
 * keeps to itself: the daemon is told, because the worker dies of it at
 * once and would die of it again at once. The daemon stops instead of
 * starting the worker again, and says why.
 */
async function adapterFor(config: Config): Promise<ProxyAdapter> {
  try {
    return requireAdapter(config.proxy);
  } catch (error) {
    if (!isUnknownProxyError(error)) throw error;
    await reportFatal(error.message);
    throw error;
  }
}

// The daemon names the configuration file it resolved, so that the worker
// reads the same file as the daemon.
const configPath = configPathFromArgv(process.argv);
const config = loadConfig(configPath ? { configPath } : {});
const adapter = await adapterFor(config);

runWorker(role as WorkerRole, adapter, config).catch((error: unknown) => {
  process.stderr.write(`worker failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
