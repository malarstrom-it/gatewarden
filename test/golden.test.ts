/**
 * The golden test (S2, §12).
 *
 * The acceptance criterion of the slice is that the rendered document is
 * byte-identical to the one the gateway rendered before the core split: the
 * user's proxy is told about routes through this document, and a byte that
 * changes is a route that changes behaviour.
 *
 * The golden files were captured from the implementation as it was before
 * the split. They are the contract; the fixtures that produce them are
 * frozen in `test/helpers/golden.ts`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { traefikAdapter } from '../src/adapters/traefik.ts';
import { GOLDEN_CASES } from './helpers/golden.ts';

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');

for (const goldenCase of GOLDEN_CASES) {
  const extension = goldenCase.config.documentFormat === 'json' ? 'json' : 'yaml';

  test(`the ${goldenCase.name} document is byte-identical to the golden file`, () => {
    const file = path.join(GOLDEN_DIR, `${goldenCase.name}.${extension}`);
    assert.ok(fs.existsSync(file), `the golden file ${path.basename(file)} is missing`);

    const expected = fs.readFileSync(file);
    const actual = Buffer.from(traefikAdapter.render(goldenCase.routes, goldenCase.config), 'utf8');

    assert.deepEqual(actual, expected, `the ${goldenCase.name} document changed`);
  });
}

test('every golden case has a golden file', () => {
  const files = fs.readdirSync(GOLDEN_DIR).sort();
  const expected = GOLDEN_CASES.map((goldenCase) => {
    const extension = goldenCase.config.documentFormat === 'json' ? 'json' : 'yaml';
    return `${goldenCase.name}.${extension}`;
  }).sort();

  assert.deepEqual(files, expected);
});
