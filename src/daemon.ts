/**
 * The daemon entry point (`gatewarden-daemon`).
 *
 * The process that supervises the workers. It is deliberately thin: the
 * supervisor lives in the core (`src/core/daemon.ts`), and the entry point
 * is what wires the world together.
 *
 * Usage: node src/daemon.ts [--config <path>]
 */

import { runDaemon } from './core/daemon.ts';
import { log } from './core/log.ts';

const SCOPE = 'daemon';

runDaemon().catch((error: unknown) => {
  log('error', SCOPE, 'daemon failed to start', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
