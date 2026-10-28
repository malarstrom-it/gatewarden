#!/usr/bin/env node
// dev-gateway-daemon — the gateway daemon (registry + relay supervisor).
import { resolveEntry } from './entry.mjs';

const entry = resolveEntry(import.meta.url, '../src/daemon.ts', '../dist/daemon.js');
if (!entry) {
  process.stderr.write('dev-gateway-daemon: no build found — run "npm run build"\n');
  process.exit(1);
}

await import(entry.href);
