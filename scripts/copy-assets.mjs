#!/usr/bin/env node
/**
 * Copy the runtime assets next to the compiled code.
 *
 * `src/core/registry.ts` serves `src/assets/` relative to its own module, so the
 * compiled registry in `dist/` needs the same files next to it. `tsc` only
 * emits TypeScript, so the assets are copied here.
 *
 * The assets belong to the web interface, which the package drops later on.
 * When they are gone there is nothing to copy, and that is not an error: the
 * build still succeeds, it just ships no assets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROM = path.join(ROOT, 'src', 'assets');
const TO = path.join(ROOT, 'dist', 'assets');

if (!fs.existsSync(FROM)) {
  fs.rmSync(TO, { recursive: true, force: true });
  process.stdout.write(`no assets to copy: ${path.relative(ROOT, FROM)}\n`);
  process.exit(0);
}

fs.rmSync(TO, { recursive: true, force: true });
fs.cpSync(FROM, TO, { recursive: true });

process.stdout.write(`copied ${path.relative(ROOT, FROM)} -> ${path.relative(ROOT, TO)}\n`);
