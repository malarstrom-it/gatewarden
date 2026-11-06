/**
 * The one command of the test environment (S9).
 *
 *   npm run test:e2e
 *
 * It brings the whole isolated environment up, runs the end-to-end test
 * against it, and tears it down again — whatever the outcome. The
 * environment is the one of §11: its own ports, its own domain, its own
 * Traefik, its own state directory and its own certificates. The live
 * gateway and the live proxy of the user are not touched, and the test
 * proves it.
 *
 * A run that is interrupted is torn down as well: the proxy and the
 * daemon are stopped when the command gets a signal. A run that is
 * killed cannot do that, and `npm run test:e2e:stop` stops what is left
 * — the next run stops it too.
 */

import { bringUp, tearDown, type TestEnvironment } from './environment.ts';
import { runEndToEnd } from './e2e.ts';
import { stopLeftovers } from './leftovers.ts';
import { snapshotOf } from './ports.ts';
import { testEnvSettings } from './settings.ts';

async function main(): Promise<number> {
  const settings = testEnvSettings();
  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  log('the test environment (D11, §11)');
  log(`  root:      ${settings.root}`);
  log(`  domain:    ${settings.domain}`);
  log(`  registry:  ${settings.registryPort}`);
  log(`  relay:     ${settings.relayPort}`);
  log(`  proxy:     ${settings.proxyPort} (the API on ${settings.proxyApiPort})`);

  // The snapshot of the live ports, taken before anything of the test
  // runs: the comparison with the one at the end is the proof that the
  // live system was not touched.
  const liveBefore = snapshotOf(settings.livePorts);

  let environment: TestEnvironment | undefined;
  let environmentTornDown = false;
  let interrupted = false;

  /** Tear the environment down. */
  const cleanup = async (): Promise<void> => {
    if (environment && !environmentTornDown) {
      environmentTornDown = true;
      await tearDown(environment, log);
    }
    // The last sweep: a run that was interrupted in the middle of the
    // bring-up may have left the proxy or the daemon behind.
    await stopLeftovers(settings, log);
  };

  // A run that is interrupted is torn down: the proxy and the daemon
  // must not be left behind. The teardown waits for the run itself, so
  // that nothing is started after the cleanup.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      interrupted = true;
      log(`${signal} received: the test environment is torn down when the run is done`);
      void cleanup();
    });
  }
  process.on('uncaughtException', (error: Error) => {
    process.stderr.write(`error: ${error.message}\n`);
    interrupted = true;
    void cleanup().then(() => {
      process.exit(1);
    });
  });
  process.on('unhandledRejection', (reason: unknown) => {
    process.stderr.write(`error: ${reason instanceof Error ? reason.message : String(reason)}\n`);
    interrupted = true;
    void cleanup().then(() => {
      process.exit(1);
    });
  });

  try {
    environment = await bringUp(settings, log);
  } catch (error) {
    process.stderr.write(`error: the test environment did not come up: ${(error as Error).message}\n`);
    await cleanup();
    return 1;
  }

  let ok = false;
  try {
    const result = await runEndToEnd(environment, liveBefore, log);
    ok = result.ok;
  } catch (error) {
    process.stderr.write(`error: the end-to-end test failed: ${(error as Error).message}\n`);
  } finally {
    await cleanup();
  }

  if (interrupted) {
    process.stderr.write('the run was interrupted\n');
    return 130;
  }
  if (!ok) {
    process.stderr.write('the end-to-end test did not pass\n');
    return 1;
  }
  log('the end-to-end test passed');
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
