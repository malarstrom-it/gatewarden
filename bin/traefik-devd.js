#!/usr/bin/env node
// traefik-devd — the gateway daemon (registry + relay supervisor).
//
// The name the daemon had before the package was published; it stays as
// an alias (R6), and it works exactly like `gatewarden-daemon`.
import { resolveEntry } from './entry.mjs';

const entry = resolveEntry(import.meta.url, '../src/daemon.ts', '../dist/daemon.js');
if (!entry) {
  process.stderr.write('traefik-devd: no build found — run "npm run build"\n');
  process.exit(1);
}

await import(entry.href);
