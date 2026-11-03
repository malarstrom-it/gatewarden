#!/usr/bin/env node
// gatewarden-daemon — the gateway daemon (registry + relay supervisor).
import { resolveEntry } from './entry.mjs';

const entry = resolveEntry(import.meta.url, '../src/daemon.ts', '../dist/daemon.js');
if (!entry) {
  process.stderr.write(
    'gatewarden-daemon: the installed package has no build — reinstall with "npm install -g @malarstrom/gatewarden"\n',
  );
  process.exit(1);
}

await import(entry.href);
