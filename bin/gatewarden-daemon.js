#!/usr/bin/env node
// gatewarden-daemon — the gateway daemon (registry + relay supervisor).
import { noBuildMessage, resolveEntry } from './entry.mjs';

const entry = resolveEntry(import.meta.url, '../src/daemon.ts', '../dist/daemon.js');
if (!entry) {
  process.stderr.write(noBuildMessage('gatewarden-daemon'));
  process.exit(1);
}

await import(entry.href);
