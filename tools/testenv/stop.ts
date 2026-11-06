/**
 * Stop what an interrupted run left behind.
 *
 *   npm run test:e2e:stop
 *
 * A run that is killed — with SIGKILL, or with the power of the
 * machine — cannot clean up after itself. The proxy and the daemon are
 * then still running, and they hold the ports of the environment.
 *
 * This command finds them and stops them. Only the processes that are
 * provably ours are stopped: the Traefik binary the test downloaded and
 * the daemon that runs with the configuration file of the test. A
 * process that holds one of our ports and is not one of those is
 * reported and left alone.
 */

import { stopLeftovers } from './leftovers.ts';
import { testEnvSettings } from './settings.ts';

async function main(): Promise<number> {
  const settings = testEnvSettings();
  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  const leftovers = await stopLeftovers(settings, log);
  const ours = leftovers.filter((leftover) => leftover.kind !== 'unknown');
  const foreign = leftovers.filter((leftover) => leftover.kind === 'unknown');

  if (ours.length === 0 && foreign.length === 0) {
    log('there is nothing left of an earlier run');
    return 0;
  }
  if (foreign.length > 0) {
    process.stderr.write(
      `error: ${foreign.length} process(es) hold the ports of the environment and are not ours: ` +
        foreign.map((leftover) => `pid ${leftover.pid} (${leftover.cmdline})`).join(', ') +
        '\n',
    );
    return 1;
  }
  log(`the leftovers of an earlier run are stopped (${ours.map((leftover) => leftover.pid).join(', ')})`);
  return 0;
}

void main().then((code) => {
  process.exitCode = code;
});
