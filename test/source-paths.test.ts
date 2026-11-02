/**
 * No message of the package points at a source path (S42).
 *
 * The package ships the compiled output, not the sources: the manifest
 * sends `dist` to npm, and `src` stays in the repository. A message that
 * names a source path is therefore a message that points at a file the
 * reader of the package does not have. The reader follows the pointer and
 * finds nothing — or, worse, finds the sources of the machine the package
 * was written for.
 *
 * Two places hold such a message, and the guard looks at both:
 *
 *   1. **the sources**: a message in `src/` that names a source path. The
 *      worker told the reader to run `node src/worker.ts`, although the
 *      reader of the installed package has no `src/` at all;
 *   2. **the compiled output**: the comments survive the build, so a
 *      pointer in a comment reaches the reader of the package as well.
 *      The source maps are left out: a map names the source it maps by
 *      definition, and it is metadata rather than a message.
 *
 * The guard is about the text the reader sees. It does not change what
 * the code does, and it does not say where the code lives: the code that
 * resolves a sibling module at runtime does that on its own.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const DIST_DIR = path.join(REPO_ROOT, 'dist');

/** The text that names a path of the sources. */
const SOURCE_PATH = 'src/';

/** Every file under a directory, with the extension the caller wants. */
function filesUnder(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

/** The places in a text that hold the text, with the line they are on. */
function hitsIn(text: string, needle: string): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line.includes(needle)) hits.push({ line: index + 1, text: line.trim() });
  });
  return hits;
}

before(async () => {
  // The guard looks at the output the package ships, so the build is
  // part of it: the compiled output has to be there before it is read.
  await execFileAsync('npm', ['run', 'build'], { cwd: REPO_ROOT, timeout: 300_000 });
});

test('no message in the sources points at a source path', () => {
  const hits: string[] = [];

  for (const file of filesUnder(SRC_DIR, ['.ts'])) {
    const text = fs.readFileSync(file, 'utf8');
    for (const hit of hitsIn(text, SOURCE_PATH)) {
      hits.push(`${path.relative(REPO_ROOT, file)}:${hit.line}: ${hit.text}`);
    }
  }

  assert.deepEqual(
    hits,
    [],
    'a message of the package points at a source path; the reader of the package has no sources:\n' + hits.join('\n'),
  );
});

test('the compiled output points at no source path', () => {
  const hits: string[] = [];

  // The source maps are not read: a map names the source it maps, and
  // that is what a map is. Everything else the reader may open is read.
  for (const file of filesUnder(DIST_DIR, ['.js', '.d.ts'])) {
    const text = fs.readFileSync(file, 'utf8');
    for (const hit of hitsIn(text, SOURCE_PATH)) {
      hits.push(`${path.relative(REPO_ROOT, file)}:${hit.line}: ${hit.text}`);
    }
  }

  assert.deepEqual(
    hits,
    [],
    'the compiled output points at a source path; the reader of the package has no sources:\n' + hits.join('\n'),
  );
});
