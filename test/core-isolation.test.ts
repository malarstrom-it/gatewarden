/**
 * The core is proxy-agnostic (D3, §12).
 *
 * The acceptance criterion of the slice is that the core has no import of
 * any adapter. The check is made on the source, because that is where the
 * dependency would be written: a core module that imports an adapter would
 * know about a proxy, and the whole point of the split is that it does not.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = path.join(REPO_ROOT, 'src', 'core');
const ADAPTERS_DIR = path.join(REPO_ROOT, 'src', 'adapters');

/** Every TypeScript file under a directory. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

/** The module specifiers a file imports. */
function importsOf(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) specifiers.push(match[1]);
  return specifiers;
}

test('the core imports no adapter', () => {
  for (const file of sourceFiles(CORE_DIR)) {
    for (const specifier of importsOf(file)) {
      assert.ok(
        !specifier.includes('adapters'),
        `${path.relative(REPO_ROOT, file)} imports "${specifier}" — the core must not know about adapters`,
      );
    }
  }
});

test('the core does not name a proxy it does not know', () => {
  // The core may mention Traefik in a comment, but it may not reach for it
  // in code: no import, no require, no dynamic import of the adapter.
  for (const file of sourceFiles(CORE_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /import\s*\(\s*['"][^'"]*adapters/, `${path.relative(REPO_ROOT, file)} imports an adapter`);
    assert.doesNotMatch(source, /require\s*\(\s*['"][^'"]*adapters/, `${path.relative(REPO_ROOT, file)} requires an adapter`);
  }
});

test('the adapter lives outside the core and the core contract lives inside it', () => {
  assert.ok(fs.existsSync(path.join(ADAPTERS_DIR, 'traefik.ts')), 'the Traefik adapter is missing');
  assert.ok(fs.existsSync(path.join(ADAPTERS_DIR, 'types.ts')), 'the adapter types are missing');
  assert.ok(fs.existsSync(path.join(CORE_DIR, 'proxy.ts')), 'the proxy contract is missing');

  // The contract is re-exported where the specification puts it.
  const types = fs.readFileSync(path.join(ADAPTERS_DIR, 'types.ts'), 'utf8');
  assert.match(types, /ProxyAdapter/);
});
