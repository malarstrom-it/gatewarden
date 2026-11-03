#!/usr/bin/env node
// gatewarden — the CLI an agent uses.
import { noBuildMessage, resolveEntry } from './entry.mjs';

const entry = resolveEntry(import.meta.url, '../src/cli/index.ts', '../dist/cli/index.js');
if (!entry) {
  process.stderr.write(noBuildMessage('gatewarden'));
  process.exit(1);
}

const { run } = await import(entry.href);
await run();
