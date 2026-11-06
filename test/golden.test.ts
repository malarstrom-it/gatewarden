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
 *
 * S3 changed the contract in exactly one place: the index router is gone
 * (D8, §10.1). The golden files hold the same document without that router,
 * and the test below proves that the rest of the document did not move.
 *
 * S81 changed the values of the fixtures once, and the golden files with
 * them: the zone and the host name of the installation became the example
 * values of the repository. The shape of the documents did not move.
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

test('no golden document holds an index router any more (D8)', () => {
  for (const goldenCase of GOLDEN_CASES) {
    const document = traefikAdapter.render(goldenCase.routes, goldenCase.config);
    assert.ok(!document.includes('dev-index'), `the ${goldenCase.name} document still holds the index router`);
    assert.ok(!document.includes('index.example.com'), `the ${goldenCase.name} document still holds the index host`);
  }
});
