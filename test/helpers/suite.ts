/**
 * The cleanup of the test suite, after every test file.
 *
 * The suite starts daemons: the daemon tests, the tests of the CLI, the
 * tests of the MCP server and the tests of the install scripts all
 * start one. A daemon is a detached process: it keeps its ports, and it
 * keeps running on the machine after the test that started it is over.
 * A suite that leaves a daemon behind leaves a process behind, and the
 * process holds the ports of the gateway.
 *
 * The suite also makes temporary directories: every test that makes a
 * fixture makes one. A temporary directory that is left behind stays in
 * the temporary directory of the machine, and the directories pile up on
 * the machine the suite runs on.
 *
 * This module is the cleanup of the suite, and it runs in every test
 * file:
 *
 *   - it puts the marker of the suite in the environment of the
 *     process, so that every process the file starts carries it;
 *   - it stops the daemons of the suite before the file starts, so that
 *     a daemon a file before left behind cannot be mistaken for one of
 *     this file;
 *   - it stops the daemons of the suite after the file is over, and says
 *     so when one of them is still running;
 *   - it removes the temporary directories of the file after the file is
 *     over, and says so when one of them is still there.
 *
 * The file is loaded with `--import`, the same way in every run of the
 * suite: `npm test` and the CI both name it. A checkout that has no
 * helper of its own — a package that is installed, or a directory that
 * only looks like a checkout — runs the suite without it.
 */
import { after, before } from 'node:test';
import { SUITE_VARIABLE, stopDaemonsOfTheSuite, suiteMarker } from './daemons.ts';
import { removeOwnTempDirs } from './tempdir.ts';

// Every process the file starts carries the marker of the suite: the
// daemon it starts, the workers that daemon starts, and the commands
// the file runs.
process.env[SUITE_VARIABLE] = suiteMarker();

/**
 * The daemons of the suite that are still running.
 *
 * @returns The pids that are still running.
 */
async function leftovers(): Promise<number[]> {
  const result = await stopDaemonsOfTheSuite();
  return result.remaining;
}

before(async () => {
  // A daemon that a file before left behind is stopped here: the file
  // must not find the ports of another file taken.
  await leftovers();
});

after(async () => {
  const remaining = await leftovers();
  if (remaining.length > 0) {
    throw new Error(
      `the test file left ${remaining.length} daemon process(es) behind: ${remaining.join(', ')}`,
    );
  }
  // The daemons are gone, and the directories of the file can go with
  // them: a daemon that holds a file of a directory keeps the directory
  // from being removed on some machines.
  const directories = removeOwnTempDirs();
  if (directories.failed.length > 0) {
    throw new Error(
      `the test file left ${directories.failed.length} temporary directory(ies) behind: ${directories.failed.join(', ')}`,
    );
  }
});
