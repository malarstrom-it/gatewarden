#!/usr/bin/env node
// traefik-dev — CLI for registering a dev server with the Traefik dev gateway.
//
// The old name of `dev-gateway`; it stays as an alias.
import { resolveEntry } from './entry.mjs';

const entry = resolveEntry(import.meta.url, '../src/cli/index.ts', '../dist/cli/index.js');
if (!entry) {
  process.stderr.write('traefik-dev: no build found — run "npm run build"\n');
  process.exit(1);
}

const { run } = await import(entry.href);
await run();
