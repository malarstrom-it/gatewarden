/**
 * The cleanup of the whole run: the temporary directories of the suite go away.
 *
 * The cleanup of a test file (see `test/helpers/suite.ts`) removes the
 * temporary directories of its own file. A test file that dies before its
 * cleanup runs leaves its directories behind, and the run removes them
 * when it is over.
 *
 * The file runs after the test runner, and it says what it removed. A
 * directory that cannot be removed makes the run fail: a directory that
 * stays behind is a directory that piles up on the machine.
 *
 * The file is a part of the checkout, and not a part of the package: the
 * package ships no test files, and a reader of the package has no
 * temporary directories of a suite to remove.
 */
import { removeTempDirsOfTheSuite } from './tempdir.ts';

const result = removeTempDirsOfTheSuite();

if (result.removed.length > 0) {
  console.log(
    `the run removed ${result.removed.length} temporary directory(ies) that a test file left behind`,
  );
}

if (result.failed.length > 0) {
  console.error(
    `the run could not remove ${result.failed.length} temporary directory(ies): ${result.failed.join(', ')}`,
  );
  process.exitCode = 1;
}
