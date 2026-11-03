#!/usr/bin/env node
// gatewarden-mcp — the MCP server (stdio JSON-RPC).
import { noBuildMessage, resolveEntry } from './entry.mjs';

const entry = resolveEntry(
  import.meta.url,
  '../src/integrations/mcp/server.ts',
  '../dist/integrations/mcp/server.js',
);
if (!entry) {
  process.stderr.write(noBuildMessage('gatewarden-mcp'));
  process.exit(1);
}

const { run } = await import(entry.href);
await run(process.argv.slice(2));
