#!/usr/bin/env node
/** Remove the build output. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
// The line goes to the standard error: `npm pack --json` writes its
// report to the standard output, and a build step that writes there
// breaks the report.
process.stderr.write(`removed ${path.relative(ROOT, DIST)}\n`);
