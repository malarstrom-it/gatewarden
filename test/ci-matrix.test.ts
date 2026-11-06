/**
 * Every test file of the repository runs in CI (S78).
 *
 * The CI runs one job per test file: the matrix of the workflow names
 * the files, and every job runs one of them with `node --test`. A test
 * file that is not in the matrix runs nowhere in CI. It runs in `npm
 * test`, on the machine of whoever runs it, and a red build never says
 * anything about it — the file is not a part of any job.
 *
 * This file is the guard against that. It reads the matrix out of the
 * workflow files and compares it with the test files of the repository,
 * in both directions:
 *
 *   - a test file of the repository that the matrix does not name runs
 *     nowhere in CI;
 *   - a file the matrix names that the repository does not have makes a
 *     job red, and the red job says nothing about the tests.
 *
 * The workflows of the repository are compared with each other as well.
 * A file that is added to one of them and forgotten in the other runs
 * in one of them only, and the two drift apart without anyone
 * noticing.
 *
 * The list of the test files is read out of the command of the manifest
 * that runs the suite (`npm test`), and not out of a list this file
 * carries: a guard that knows the answer itself cannot catch the answer
 * changing. The same holds for the matrix — it is read out of the
 * workflow files, and not written down here.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The manifest of the package. */
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * The directory the workflows of the repository live in.
 *
 * The repository runs its CI on GitHub, and the workflows of the server
 * the repository left are gone. The directory is read, and not written
 * down as one file, so that a workflow that is added later is checked
 * as well.
 */
const WORKFLOW_DIRECTORY = '.github/workflows';

/**
 * The workflow that has to hold the matrix of the test files.
 *
 * The file has to be there: without it the repository has no CI, and
 * no test file of it runs anywhere.
 */
const CI_WORKFLOW = '.github/workflows/ci.yml';

/**
 * The directories of the repository that are not a part of its source.
 *
 * The dependencies are installed, and the build output is written by the
 * build. Neither of them holds a test file, and both of them are big.
 */
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage']);

/**
 * A matrix of test files, read out of a workflow file.
 */
interface Matrix {
  /** The files the matrix names, in the order the matrix names them. */
  files: string[];
  /** How many times the workflow holds a matrix key of the test files. */
  keys: number;
  /** The line the matrix key stands on, counted from one. */
  line: number;
}

/**
 * The matrix of the test files of a workflow file.
 *
 * The workflow is read as text, and not through a YAML parser: the
 * repository has no YAML library among its dependencies, and the matrix
 * is a list of names under one key. The key is found by its name, and
 * the list is the lines that stand deeper under it.
 *
 * A key of the test files is only a key of the test files when it
 * stands under a `matrix:` key, so that a `file:` key of another
 * meaning is not read as one.
 *
 * @param text the text of the workflow file
 * @returns the matrix the workflow holds
 */
function readMatrix(text: string): Matrix {
  const lines = text.split('\n');
  const files: string[] = [];
  let keys = 0;
  let line = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const matrixKey = /^(\s*)matrix:\s*$/.exec(lines[index] ?? '');
    if (!matrixKey) continue;

    const matrixIndent = (matrixKey[1] ?? '').length;

    // The matrix of the workflow is the block that stands deeper than
    // the key, and it ends at the first line that does not.
    for (let next = index + 1; next < lines.length; next += 1) {
      const item = lines[next] ?? '';
      if (item.trim() === '') continue;

      const itemIndent = item.length - item.trimStart().length;
      if (itemIndent <= matrixIndent) break;

      const key = /^(\s*)file:\s*$/.exec(item);
      if (!key) continue;

      const indent = (key[1] ?? '').length;
      keys += 1;
      if (keys === 1) line = next + 1;

      // The list of the matrix is the lines that stand deeper than the
      // key, and it ends at the first line that does not.
      for (let itemIndex = next + 1; itemIndex < lines.length; itemIndex += 1) {
        const entry = lines[itemIndex] ?? '';
        if (entry.trim() === '') continue;

        const entryIndent = entry.length - entry.trimStart().length;
        if (entryIndent <= indent) break;

        const name = /^\s*-\s*(\S+)\s*$/.exec(entry);
        if (!name) break;
        files.push(name[1] ?? '');
      }
    }
  }

  return { files, keys, line };
}

/**
 * The path of a file of the test directory, the way the matrix names it.
 *
 * The matrix names the file by its name, and the repository knows it by
 * its path. A matrix that names the path itself is read as it is
 * written.
 *
 * @param name the name the matrix writes
 * @returns the path of the file, relative to the root of the repository
 */
function repositoryPath(name: string): string {
  return name.includes('/') ? name : `test/${name}`;
}

/**
 * Every file of the repository, relative to its root.
 *
 * @returns the paths of the files, in alphabetical order
 */
function repositoryFiles(): string[] {
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }

      found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
    }
  };
  walk(REPO_ROOT);

  return found.sort();
}

/**
 * The pattern of the files that the test command of the manifest runs.
 *
 * The command is `node --test --test-concurrency=1 test/*.test.ts`, and
 * the pattern is the part of it that holds a star. The pattern is read
 * out of the manifest, and not written down here: a guard that carries
 * the answer itself cannot catch the answer changing.
 *
 * @returns the pattern, relative to the root of the repository
 */
function testPattern(): string {
  const command = MANIFEST.scripts['test'];
  assert.ok(command !== undefined, 'package.json has no "test" script');

  const match = /(?:^|\s)([\w./*?{}-]*\*[\w./*?{}-]*)/.exec(command);
  assert.ok(match, `the test command of package.json runs no pattern of test files ("${command}")`);

  return match[1] ?? '';
}

/**
 * The files of the repository that a pattern names.
 *
 * The pattern is read as the shell reads it: a star stands for the
 * characters that are not a slash, so that `test/*.test.ts` names the
 * files of the test directory and not the files of the directories
 * below it.
 *
 * @param pattern the pattern, relative to the root of the repository
 * @returns the paths of the files, in alphabetical order
 */
function filesOfPattern(pattern: string): string[] {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  const matcher = new RegExp(`^${escaped}$`);

  return repositoryFiles().filter((file) => matcher.test(file));
}

/**
 * The workflow files of the repository that hold a matrix of the test
 * files.
 *
 * A workflow that holds no matrix of the test files is not one of
 * them: the publishing workflow runs no test job of its own.
 *
 * @returns the paths of the workflows, relative to the root of the repository
 */
function workflowsWithAMatrix(): string[] {
  const directory = path.join(REPO_ROOT, WORKFLOW_DIRECTORY);
  if (!fs.existsSync(directory)) return [];

  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.ya?ml$/.test(entry.name)) continue;

    const relative = `${WORKFLOW_DIRECTORY}/${entry.name}`;
    const text = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
    if (readMatrix(text).keys > 0) found.push(relative);
  }

  return found.sort();
}

describe('the matrix of the test files', () => {
  const pattern = testPattern();
  const testFiles = filesOfPattern(pattern);
  const workflows = workflowsWithAMatrix();

  test('the test command of the manifest names the test files of the repository', () => {
    // The guard reads the list of the test files out of the command of
    // the manifest. A command that names no files would leave the guard
    // with nothing to compare, and a guard that compares nothing guards
    // nothing.
    assert.ok(testFiles.length > 0, `the pattern "${pattern}" of the test command names no test file`);
  });

  test('the repository holds a CI workflow with a matrix of the test files', () => {
    // Without the workflow the repository has no CI, and no test file
    // of it runs anywhere.
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, CI_WORKFLOW)),
      `the repository has no CI workflow at ${CI_WORKFLOW}`,
    );

    assert.ok(
      workflows.includes(CI_WORKFLOW),
      `${CI_WORKFLOW} holds no matrix of the test files, so no test file of the repository runs in CI`,
    );
  });

  for (const workflow of workflows) {
    test(`the matrix of ${workflow} names every test file of the repository`, () => {
      const text = fs.readFileSync(path.join(REPO_ROOT, workflow), 'utf8');
      const matrix = readMatrix(text);

      assert.equal(matrix.keys, 1, `${workflow} holds ${matrix.keys} matrix keys of the test files`);
      assert.ok(matrix.files.length > 0, `${workflow} holds an empty matrix of the test files`);

      // Every test file of the repository runs in CI. A file that the
      // matrix does not name runs nowhere in CI, and the red build of
      // somebody else never says so.
      const missing = testFiles.filter((file) => !matrix.files.some((name) => repositoryPath(name) === file));
      assert.deepEqual(
        missing,
        [],
        `the matrix of ${workflow} does not name ${missing.join(', ')}: the test file(s) run nowhere in CI`,
      );

      // Every file the matrix names is a test file of the repository. A
      // file that is not there makes a job red, and the red job says
      // nothing about the tests.
      const unknown = matrix.files.filter((name) => !testFiles.includes(repositoryPath(name)));
      assert.deepEqual(
        unknown,
        [],
        `the matrix of ${workflow} names ${unknown.join(', ')}, and the repository has no such test file`,
      );
    });

    test(`the matrix of ${workflow} is in alphabetical order`, () => {
      const text = fs.readFileSync(path.join(REPO_ROOT, workflow), 'utf8');
      const matrix = readMatrix(text);
      const sorted = [...matrix.files].sort();

      assert.deepEqual(
        matrix.files,
        sorted,
        `the matrix of ${workflow} is not in alphabetical order: ${matrix.files.join(', ')}`,
      );
    });

    test(`the workflow of ${workflow} runs the file of the matrix`, () => {
      const text = fs.readFileSync(path.join(REPO_ROOT, workflow), 'utf8');

      assert.ok(
        text.includes('matrix.file'),
        `${workflow} does not use "matrix.file", so the matrix of the test files runs nothing`,
      );
    });
  }

  test('the workflows of the repository name the same test files', () => {
    // A file that is added to one workflow and forgotten in the other
    // runs in one of them only. The matrices have to name the same
    // files, so that they cannot drift apart.
    assert.ok(workflows.length >= 1, `no workflow of ${WORKFLOW_DIRECTORY} holds a matrix of the test files`);

    const [first, ...others] = workflows;
    for (const other of others) {
      const firstMatrix = readMatrix(fs.readFileSync(path.join(REPO_ROOT, first), 'utf8'));
      const otherMatrix = readMatrix(fs.readFileSync(path.join(REPO_ROOT, other), 'utf8'));

      const only = otherMatrix.files.filter((name) => !firstMatrix.files.includes(name));
      const missing = firstMatrix.files.filter((name) => !otherMatrix.files.includes(name));

      assert.deepEqual(
        only,
        [],
        `the matrix of ${other} names ${only.join(', ')}, and the matrix of ${first} does not: the two matrices have drifted apart`,
      );
      assert.deepEqual(
        missing,
        [],
        `the matrix of ${first} names ${missing.join(', ')}, and the matrix of ${other} does not: the two matrices have drifted apart`,
      );
    }
  });
});
