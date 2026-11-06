/**
 * The cleanup of the test suite removes the temporary directories it made.
 *
 * A test that makes a fixture makes a directory: the installation of the
 * test, the checkout of the test, the directory of the certificate. The
 * directory is made in the temporary directory of the machine, and it is
 * still there when the test is over. A suite that leaves its directories
 * behind fills the temporary directory of the machine, one directory per
 * test that makes a fixture.
 *
 * The suite therefore makes its temporary directories in one way only, and
 * the way leaves a mark that says that the directory belongs to the suite
 * (see `test/helpers/tempdir.ts`). The cleanup removes the marked
 * directories when a test file is over (see `test/helpers/suite.ts`), and
 * when the whole run is over (see `test/helpers/cleanup.ts`).
 *
 * Four things are proved here:
 *
 *   - the cleanup removes the temporary directory that the suite made;
 *   - the cleanup leaves a directory that the suite did not make alone. A
 *     directory of an installation on the machine is a directory like that
 *     one, and the cleanup must never touch it;
 *   - the suite leaves no directory of its own behind: after the cleanup
 *     of the file, no marked directory of the suite is left on the
 *     machine;
 *   - the cleanup of the run removes what a test file that died left
 *     behind.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  makeTempDir,
  removeOwnTempDirs,
  removeTempDirsOfTheSuite,
  tempDirsOfTheSuite,
} from './helpers/tempdir.ts';

test('the cleanup removes the temporary directory the suite made', () => {
  const dir = makeTempDir('gatewarden-tempdir-');
  assert.equal(fs.existsSync(dir), true, 'the directory of the suite should be there');
  assert.equal(
    tempDirsOfTheSuite().includes(dir),
    true,
    'the directory of the suite should be known to the cleanup',
  );

  const result = removeOwnTempDirs();

  assert.deepEqual(result.failed, [], 'the cleanup could not remove a directory of the suite');
  assert.equal(fs.existsSync(dir), false, 'the directory of the suite is still there');
});

test('the cleanup leaves a directory the suite did not make alone', () => {
  // A directory that the suite did not make is not the suite's: an
  // installation on the machine lives in a directory like this one, and
  // the cleanup must never take it away.
  const installation = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-installation-'));
  const dir = makeTempDir('gatewarden-tempdir-');

  const result = removeOwnTempDirs();

  assert.deepEqual(result.failed, [], 'the cleanup could not remove a directory of the suite');
  assert.equal(fs.existsSync(dir), false, 'the directory of the suite is still there');
  assert.equal(
    fs.existsSync(installation),
    true,
    'the cleanup removed a directory the suite did not make',
  );
  fs.rmSync(installation, { recursive: true, force: true });
});

test('the suite leaves no directory of its own behind', () => {
  // The proof of the whole rule: after the cleanup, no directory of the
  // suite is left on the machine. The directories of the files that ran
  // before this one are gone as well: every file cleans up after itself,
  // and the cleanup of the run removes what a file that died left behind.
  makeTempDir('gatewarden-tempdir-');
  makeTempDir('gatewarden-tempdir-');

  const result = removeTempDirsOfTheSuite();

  assert.deepEqual(result.failed, [], 'the cleanup could not remove a directory of the suite');
  assert.deepEqual(
    tempDirsOfTheSuite(),
    [],
    'the suite left a temporary directory of its own behind',
  );
});

test('the cleanup of the run removes what a test file left behind', () => {
  // A test file that dies before its own cleanup leaves its directories
  // behind, and the cleanup of the run removes them. The file here dies
  // for real: it is another process, it makes a directory of the suite,
  // and it is killed before it can clean up. The mark of the directory is
  // on the machine, and the directory is there with it.
  const helper = new URL('./helpers/tempdir.ts', import.meta.url).href;
  const script = [
    `import { makeTempDir } from '${helper}';`,
    `console.log(makeTempDir('gatewarden-tempdir-'));`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 2000,
    killSignal: 'SIGKILL',
  });
  assert.equal(child.signal, 'SIGKILL', 'the file that dies should be killed');
  const forgotten = (child.stdout ?? '').trim();
  assert.ok(forgotten.length > 0, 'the file that dies should say which directory it made');
  assert.equal(fs.existsSync(forgotten), true, 'the directory of the dead file should be there');

  const result = removeTempDirsOfTheSuite();

  assert.deepEqual(result.failed, [], 'the cleanup could not remove a directory of the suite');
  assert.equal(fs.existsSync(forgotten), false, 'the forgotten directory is still there');
});
