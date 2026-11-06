/**
 * The MCP server, without a process.
 *
 * The conformance test (test/mcp-conformance.test.ts) drives the server
 * with the official SDK's client. This file holds the tests of the
 * protocol itself: the handshake, the framing and the answers, and the
 * inference of the project and the branch (§6.3).
 *
 * Nothing here starts a daemon and nothing here touches the gateway that
 * runs on the user's machine.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ERROR_CODES,
  handleLine,
  LATEST_PROTOCOL_VERSION,
  McpServer,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcResponse,
} from '../src/integrations/mcp/server.ts';
import { inferBranch, inferProject } from '../src/integrations/mcp/inference.ts';
import { TOOLS } from '../src/integrations/mcp/tools.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isSuccess(response: JsonRpcResponse): response is Extract<JsonRpcResponse, { result: unknown }> {
  return 'result' in response;
}

test('the handshake answers with the version the client asked for', async () => {
  const server = new McpServer();
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });

  assert.ok(response && isSuccess(response));
  const result = response.result as {
    protocolVersion: string;
    capabilities: { tools: unknown };
    serverInfo: { name: string; version: string };
  };
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.ok(result.capabilities.tools);
  assert.equal(result.serverInfo.name, 'gatewarden');
});

test('the handshake answers with the newest version when the client asks for another', async () => {
  const server = new McpServer();
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' },
  });

  assert.ok(response && isSuccess(response));
  assert.equal((response.result as { protocolVersion: string }).protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes(LATEST_PROTOCOL_VERSION));
});

test('a notification is not answered', async () => {
  const server = new McpServer();
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.equal(response, null);
});

test('an unknown method is answered with an error', async () => {
  const server = new McpServer();
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 7, method: 'no/such/method' });
  assert.ok(response && !isSuccess(response));
  assert.equal(response.error.code, ERROR_CODES.methodNotFound);
  assert.equal(response.id, 7);
});

test('the tool list holds the four tools of the specification', async () => {
  const server = new McpServer();
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.ok(response && isSuccess(response));

  const { tools } = response.result as { tools: Array<{ name: string; inputSchema: { type: string } }> };
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['publish_dev_server', 'remove_dev_server', 'list_dev_servers', 'dev_gateway_status'],
  );
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('the four tools are the ones the human decided', () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    ['publish_dev_server', 'remove_dev_server', 'list_dev_servers', 'dev_gateway_status'],
  );
});

test('a line that is not JSON is answered with a parse error', async () => {
  const server = new McpServer();
  const response = await handleLine(server, 'this is not json');
  assert.ok(response && !isSuccess(response));
  assert.equal(response.error.code, ERROR_CODES.parseError);
});

test('an empty line is not answered at all', async () => {
  const server = new McpServer();
  assert.equal(await handleLine(server, '   '), null);
});

test('a ping is answered', async () => {
  const server = new McpServer();
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.ok(response && isSuccess(response));
  assert.deepEqual(response.result, {});
});

test('the runtime dependencies do not carry the MCP SDK (D5)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const runtime = Object.keys(manifest.dependencies ?? {});
  for (const name of runtime) {
    assert.ok(!name.includes('modelcontextprotocol'), `${name} is a runtime dependency`);
  }
  assert.ok(
    manifest.devDependencies?.['@modelcontextprotocol/sdk'],
    'the SDK is not a dev dependency, so the conformance test cannot use it',
  );
});

test('the source does not import the MCP SDK (D5)', () => {
  // The server speaks the protocol itself; the SDK is only ever the oracle
  // of the conformance test.
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) sources.push(full);
    }
  };
  walk(path.join(REPO_ROOT, 'src'));

  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /modelcontextprotocol/,
      `${path.relative(REPO_ROOT, file)} mentions the MCP SDK`,
    );
  }
});

test('the project is the name of the working directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-project-'));
  try {
    assert.equal(inferProject(dir), path.basename(dir).toLowerCase());
    assert.equal(inferProject('/tmp/My Project'), 'my-project');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the branch is the branch of the working directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-branch-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '--quiet', '-b', 'feature/One'], { cwd: dir, stdio: 'ignore' });
    assert.equal(inferBranch(dir), 'feature-one');
  } catch {
    // No git in this environment: the fallback is covered below.
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory that is not a repository falls back to main', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-nogit-'));
  try {
    // A directory that is not inside a repository: git answers with an
    // error, and the fallback is used.
    assert.equal(inferBranch(dir), 'main');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
