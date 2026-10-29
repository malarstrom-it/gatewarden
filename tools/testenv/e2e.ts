/**
 * The end-to-end test of the test environment (§11.3, L5).
 *
 * The test proves the whole chain: a throwaway dev server, the gateway
 * under test (the real daemon), the real relay, the real Traefik, and
 * the public URL. Nothing of it is a double: the only thing that is
 * made up is the dev server, which is what a dev server is.
 *
 * The test also proves the isolation: the ports of the live system are
 * not bound by the test, and the test binds nothing but the ports of
 * its own environment.
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { withRouteLock } from '../../src/core/lock.ts';
import { RegistrationStore } from '../../src/core/state.ts';
import { buildFqdn } from '../../src/core/util/slug.ts';
import type { TestEnvironment } from './environment.ts';
import { describeSnapshot, pidsOnPort, snapshotOf, snapshotsAreEqual } from './ports.ts';
import { testRouteFqdn } from './settings.ts';

/** The answer of the throwaway server. */
export const MARKER = 'dev-gateway test environment';

export interface E2eStep {
  /** What was checked. */
  name: string;
  /** Did it hold? */
  ok: boolean;
  /** What was found. */
  detail: string;
}

export interface E2eResult {
  /** Did every step hold? */
  ok: boolean;
  /** The steps, in the order they ran. */
  steps: E2eStep[];
}

/**
 * Fetch the public URL of a route.
 *
 * The name of the route does not resolve (the test domain is not in the
 * hosts file), so the request goes to the proxy by address and carries
 * the name of the route: as the host of the request, and as the name of
 * the server in the TLS handshake.
 */
export function fetchPublicUrl(
  fqdn: string,
  port: number,
  ca: string,
): Promise<{ status: number | null; body: string; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { status: number | null; body: string; error?: string }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = https.request(
      {
        host: '127.0.0.1',
        port,
        servername: fqdn,
        path: '/',
        method: 'GET',
        headers: { host: fqdn },
        ca,
        rejectUnauthorized: true,
        timeout: 5000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => finish({ status: response.statusCode ?? null, body }));
      },
    );
    request.on('error', (error: Error) => finish({ status: null, body: '', error: error.message }));
    request.on('timeout', () => {
      request.destroy();
      finish({ status: null, body: '', error: 'the request timed out' });
    });
    request.end();
  });
}

/**
 * Run the end-to-end test.
 *
 * `liveBefore` is the snapshot of the listeners of the live ports from
 * before the environment came up: the test compares it with the
 * snapshot it takes when it is done.
 */
export async function runEndToEnd(
  env: TestEnvironment,
  liveBefore: Record<string, number[]>,
  log: (line: string) => void = () => {},
): Promise<E2eResult> {
  const steps: E2eStep[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    steps.push({ name, ok, detail });
    log(`${ok ? 'ok' : 'FAILED'}  ${name}: ${detail}`);
  };

  const { settings, config } = env;
  const fqdn = testRouteFqdn(settings);
  const ca = fs.readFileSync(env.certs.caFile, 'utf8');

  // The throwaway dev server.
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`${MARKER}\n`);
  });
  const devPort = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('the throwaway server did not get a port'));
    });
  });
  record('the throwaway dev server', true, `127.0.0.1:${devPort}`);

  // The route, written through the store of the gateway.
  const store = new RegistrationStore(config.stateDir);
  await withRouteLock(config.stateDir, () =>
    store.upsert({ project: settings.project, branch: settings.branch, devPort, zone: settings.domain }),
  );
  const registered = store.findByProjectBranch(settings.project, settings.branch);
  const fqdnFromStore = registered?.fqdn ?? buildFqdn(settings.project, settings.branch, settings.domain);
  record('the route is registered', fqdnFromStore === fqdn, `${fqdnFromStore} -> 127.0.0.1:${devPort}`);

  try {
    // The document the proxy polls: the routers of the routes.
    const document = await fetch(`http://127.0.0.1:${settings.registryPort}/traefik`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await document.text();
    const hasRouter = body.includes(`Host(\`${fqdn}\`)`);
    const hasService = body.includes(`127.0.0.1:${settings.relayPort}`);
    record(
      'the document the proxy polls',
      document.ok && hasRouter && hasService,
      document.ok
        ? `the router of ${fqdn} ${hasRouter ? 'is' : 'is not'} in the document, the relay ${hasService ? 'is' : 'is not'} in it`
        : `the registry answered with ${document.status}`,
    );

    // The public URL, through the real proxy.
    const deadline = Date.now() + 30_000;
    let answer = await fetchPublicUrl(fqdn, settings.proxyPort, ca);
    while (Date.now() < deadline && (answer.status !== 200 || !answer.body.includes(MARKER))) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      answer = await fetchPublicUrl(fqdn, settings.proxyPort, ca);
    }
    record(
      'the public URL answers through the proxy',
      answer.status === 200 && answer.body.includes(MARKER),
      answer.status === 200
        ? `https://${fqdn}:${settings.proxyPort} answered with ${JSON.stringify(answer.body.trim().slice(0, 40))}`
        : `https://${fqdn}:${settings.proxyPort} did not answer: ${answer.error ?? `status ${answer.status}`}`,
    );

    // The isolation: the ports of the live system.
    const liveAfter = snapshotOf(settings.livePorts);
    const same = snapshotsAreEqual(liveBefore, liveAfter);
    record(
      'the live ports are not bound by the test',
      same,
      `before: ${describeSnapshot(liveBefore)}; after: ${describeSnapshot(liveAfter)}`,
    );

    // The isolation: the test binds the ports of its own environment.
    const own = [settings.registryPort, settings.relayPort, settings.proxyPort, settings.proxyApiPort];
    const bound: string[] = [];
    let foreign = false;
    for (const port of [...own, devPort]) {
      const pids = pidsOnPort(port);
      bound.push(`${port}: ${pids.length > 0 ? pids.join(', ') : 'nothing'}`);
      if (port !== devPort && pids.length === 0) foreign = true;
    }
    const livePids = new Set(settings.livePorts.flatMap((port) => pidsOnPort(port)));
    const testPids = new Set(own.flatMap((port) => pidsOnPort(port)));
    const overlap = [...livePids].filter((pid) => testPids.has(pid));
    if (overlap.length > 0) foreign = true;
    record(
      'the test binds only the ports of its own environment',
      !foreign,
      `${bound.join('; ')}; the processes of the live ports and of the test do not overlap`,
    );
  } finally {
    await withRouteLock(config.stateDir, () => store.remove(settings.project, settings.branch));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { ok: steps.every((step) => step.ok), steps };
}
