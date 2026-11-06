/**
 * The temporary directories of the test suite, and the cleanup that removes them.
 *
 * A test that makes a fixture makes a directory: the installation of the
 * test, the checkout of the test, the directory of the certificate. The
 * directory is made in the temporary directory of the machine, and it is
 * still there when the test is over. A suite that leaves its directories
 * behind fills the temporary directory of the machine, one directory per
 * test that makes a fixture, and the directories pile up on the machine
 * the suite runs on.
 *
 * The suite therefore makes its temporary directories in one way only, and
 * the way leaves a mark: a file in the temporary directory of the machine
 * says that a directory belongs to the suite. The mark is the proof of
 * ownership. The cleanup removes what carries a mark of the suite, and
 * nothing else: a directory of an installation on the machine carries no
 * mark, and the cleanup does not see it.
 *
 * The mark carries the name of the suite, so that two suites on the same
 * machine do not touch the directories of each other. The name of the
 * suite is the root of the checkout, and two checkouts of the same
 * repository are two suites.
 *
 * The cleanup runs twice: when a test file is over (see
 * `test/helpers/suite.ts`), and when the whole run is over (see
 * `test/helpers/cleanup.ts`). The second run is the safety net: a test
 * file that dies leaves its directories behind, and the run removes them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { suiteMarker } from './daemons.ts';

/**
 * The temporary directories that this process made.
 */
const made = new Set<string>();

// The directories of this process go away with the process: a test file
// that runs without the cleanup of the suite (see
// `test/helpers/suite.ts`) leaves nothing behind either.
process.on('exit', () => {
  removeOwnTempDirs();
});

/**
 * The suffix that every mark of the suite carries.
 *
 * The suffix carries a digest of the name of the suite, so that the marks
 * of one suite are not the marks of another one.
 *
 * @returns The suffix of the marks of the suite.
 */
function markSuffix(): string {
  const digest = createHash('sha256').update(suiteMarker()).digest('hex').slice(0, 16);
  return `.suite-${digest}.mark`;
}

/**
 * The path of the mark of a directory.
 *
 * The name of the mark carries the name of the directory and a digest of
 * its path: two directories of the suite can have the same name, and the
 * mark of one of them must not name the other one.
 *
 * @param directory The directory the mark belongs to.
 * @returns The path of the mark of the directory.
 */
function markPath(directory: string): string {
  const dir = path.resolve(directory);
  const digest = createHash('sha256').update(dir).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), `${path.basename(dir)}-${digest}${markSuffix()}`);
}

/**
 * Make a temporary directory for the suite.
 *
 * The directory is marked as a directory of the suite, and the cleanup of
 * the suite removes it when the test that made it is over.
 *
 * @param prefix The beginning of the name of the directory.
 * @returns The path of the directory.
 */
export function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  registerTempDir(dir);
  return dir;
}

/**
 * Remember a directory of the suite that was made in another way.
 *
 * A directory that the suite made without `makeTempDir` is marked here,
 * and the cleanup of the suite removes it like every other directory of
 * the suite.
 *
 * @param directory The directory to remember.
 */
export function registerTempDir(directory: string): void {
  const dir = path.resolve(directory);
  made.add(dir);
  fs.writeFileSync(markPath(dir), JSON.stringify({ dir, marker: suiteMarker() }));
}

/**
 * A mark of the suite, and the directory it names.
 */
interface Mark {
  /** The path of the mark itself. */
  file: string;
  /** The directory the mark names. */
  dir: string;
}

/**
 * The marks of the suite that lie in the temporary directory of the machine.
 *
 * The marks of another suite are not read: their suffix is another one,
 * and their content names another suite.
 *
 * @returns The marks of the suite.
 */
function marksOfTheSuite(): Mark[] {
  const found: Mark[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    // A machine without a temporary directory has no marks to read.
    return found;
  }
  const suffix = markSuffix();
  for (const entry of entries) {
    if (!entry.endsWith(suffix)) continue;
    const file = path.join(os.tmpdir(), entry);
    try {
      const mark = JSON.parse(fs.readFileSync(file, 'utf8')) as { dir?: unknown; marker?: unknown };
      if (mark.marker !== suiteMarker()) continue;
      if (typeof mark.dir !== 'string' || mark.dir.length === 0) continue;
      found.push({ file, dir: path.resolve(mark.dir) });
    } catch {
      // A mark that cannot be read is no mark: the directory it names is
      // not a directory of the suite, and the cleanup leaves it alone.
    }
  }
  return found;
}

/**
 * The temporary directories of the suite that are still there.
 *
 * @returns The directories of the suite that are still on the machine.
 */
export function tempDirsOfTheSuite(): string[] {
  const found: string[] = [];
  for (const mark of marksOfTheSuite()) {
    if (fs.existsSync(mark.dir)) found.push(mark.dir);
  }
  return found;
}

/**
 * Remove a directory of the suite.
 *
 * Three things are true of a directory that the cleanup removes: it lies
 * in the temporary directory of the machine, it is a directory and not a
 * link, and the suite knows it. A directory outside the temporary
 * directory of the machine is an installation, and the cleanup never
 * touches it. A link is the name of another directory, and the directory
 * the link names is not the suite's.
 *
 * @param directory The directory to remove.
 * @returns Whether the directory is gone afterwards.
 */
function removeDirectory(directory: string): boolean {
  const dir = path.resolve(directory);
  const temp = path.resolve(os.tmpdir());
  if (dir === temp || !dir.startsWith(temp + path.sep)) return false;
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    // The directory is already gone.
    return true;
  }
  if (!stat.isDirectory()) return false;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the mark of a directory.
 *
 * @param file The path of the mark.
 */
function removeMark(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // The mark is gone already, or it cannot be removed. The directory
    // it names is gone in the first case.
  }
}

/**
 * Remove the marks of the directories that are gone.
 *
 * A mark of a directory that is not there any more is a mark of nothing,
 * and it is removed with the directory.
 */
function removeStaleMarks(): void {
  for (const mark of marksOfTheSuite()) {
    if (fs.existsSync(mark.dir)) continue;
    removeMark(mark.file);
  }
}

/** What a cleanup did. */
export interface TempDirCleanup {
  /** The directories that are gone. */
  removed: string[];
  /** The directories that are still there. */
  failed: string[];
}

/**
 * Remove the temporary directories that this process made.
 *
 * The cleanup of a test file removes the directories of its own file, and
 * not the directories of another file: two files of the suite can run at
 * the same time, and the cleanup of one of them must not take the
 * directories of the other one away.
 *
 * @returns The directories that are gone, and the directories that are still there.
 */
export function removeOwnTempDirs(): TempDirCleanup {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const dir of [...made]) {
    if (removeDirectory(dir)) removed.push(dir);
    else if (fs.existsSync(dir)) failed.push(dir);
    made.delete(dir);
    removeMark(markPath(dir));
  }
  return { removed, failed };
}

/**
 * Remove every temporary directory of the suite.
 *
 * The directories of the whole suite are found through their marks, and
 * the marks of the directories that are gone are removed with them. This
 * is the cleanup of the run: it removes what a test file that died left
 * behind.
 *
 * @returns The directories that are gone, and the directories that are still there.
 */
export function removeTempDirsOfTheSuite(): TempDirCleanup {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const mark of marksOfTheSuite()) {
    if (removeDirectory(mark.dir)) removed.push(mark.dir);
    else if (fs.existsSync(mark.dir)) failed.push(mark.dir);
    removeMark(mark.file);
  }
  removeStaleMarks();
  return { removed, failed };
}
