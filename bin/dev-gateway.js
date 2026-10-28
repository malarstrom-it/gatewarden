#!/usr/bin/env node
// dev-gateway — the CLI an agent uses.
import { resolveEntry } from './entry.mjs';

const entry = resolveEntry(import.meta.url, '../src/cli.ts', '../dist/cli.js');
if (!entry) {
  process.stderr.write('dev-gateway: no build found — run "npm run build"\n');
  process.exit(1);
}

const { run } = await import(entry.href);
await run();
