/**
 * The stylesheet must not be stale.
 *
 * The page is styled with Tailwind classes that live in the markup
 * (`src/index-page.ts`) and the compiled stylesheet (`src/assets/index.css`)
 * is committed. When the markup gains or loses a utility class and nobody
 * compiles the stylesheet again, the class is silently missing from the
 * page: it renders unstyled, and it looks like a CSS bug rather than a
 * stale build.
 *
 * This test compiles the source into a temporary file — never into the
 * tracked one — and compares it with the committed artifact. It works
 * offline: the CLI is a pinned devDependency (`tailwindcss` and
 * `@tailwindcss/cli`, both 4.3.3), so `npm ci` is enough.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src', 'assets', 'index.src.css');
const COMMITTED = path.join(ROOT, 'src', 'assets', 'index.css');
const CLI = path.join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');

/** The first line where two texts differ, and what differs there. */
function firstDifference(left: string, right: string): string {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const count = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < count; i += 1) {
    if (leftLines[i] !== rightLines[i]) {
      return `line ${i + 1}\n  compiled: ${leftLines[i] ?? '<end of file>'}\n  committed: ${rightLines[i] ?? '<end of file>'}`;
    }
  }
  return 'the files are identical';
}

test('the committed stylesheet is what the source compiles to', () => {
  assert.ok(
    fs.existsSync(CLI),
    `the Tailwind CLI is missing (${CLI}). Run npm ci: the build must work offline.`,
  );

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'traefik-css-'));
  const output = path.join(temporary, 'index.css');

  try {
    execFileSync(process.execPath, [CLI, '-i', SOURCE, '-o', output], {
      cwd: ROOT,
      stdio: 'pipe',
    });

    const compiled = fs.readFileSync(output, 'utf8');
    const committed = fs.readFileSync(COMMITTED, 'utf8');

    assert.equal(
      compiled,
      committed,
      `src/assets/index.css is stale. Run "npm run build:css" and commit the result.\n${firstDifference(compiled, committed)}`,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
