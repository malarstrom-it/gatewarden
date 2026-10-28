/**
 * The setup wizard (`dev-gateway setup`, §9).
 *
 * The wizard runs against a throwaway installation: a temporary directory
 * for the configuration, the state and the home directory, and free ports.
 *
 * The proxy the wizard talks to is a double that behaves like Traefik
 * (`test/helpers/proxy.ts`): it answers the API, it polls the dynamic
 * configuration document and it serves the public URLs. Nothing here
 * touches the proxy or the gateway of the user.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { DEFAULT_CONFIG } from '../src/core/config.ts';
import { cidrOf, proxyAddresses, runSetup } from '../src/cli/setup.ts';
import { createRelayServer } from '../src/core/relay.ts';
import { DISPATCH_HEADER } from '../src/core/protocol.ts';
import { RegistrationStore } from '../src/core/state.ts';
import type { Config } from '../src/core/types.ts';
import { freePort, makeCliFixture } from './helpers/cli.ts';
import { makeCertificate } from './helpers/cert.ts';
import { close, listen } from './helpers/fixtures.ts';
import { FakeTraefik, type FakeRouter, type FakeService } from './helpers/proxy.ts';
import { parseYaml } from './helpers/yaml.ts';

interface SetupReport {
  environment: { container: boolean; platform: string; stateDir: string; daemonRunning: boolean };
  proxy: {
    id: string;
    reachable: boolean;
    version?: string;
    zone?: string;
    entryPoints?: string[];
    certResolver?: string;
    middlewareProvider?: string;
  };
  wired: boolean;
  wiring: { path: string; content: string } | null;
  verification: { status: string; reason?: string; steps: Array<{ name: string; ok: boolean; detail: string }> };
  config: {
    path: string;
    written: boolean;
    zone: string;
    entryPoints: string[];
    certResolver: string;
    middlewareProvider: string;
    advertisedHost: string;
    sources: Record<string, string>;
    unconfirmed: string[];
  };
  daemon: { running: boolean; pid: number | null; restarted?: boolean };
  nextSteps: string[];
}

/**
 * A proxy that answers like Traefik.
 *
 * The services are the ones the proxy has: a list of `{ url }` entries.
 */
function fakeProxy(services: Array<{ url: string }>): http.Server {
  return http.createServer((req, res) => {
    const send = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/version') return send({ Version: '3.7.16-fake' });
    if (req.url === '/api/http/routers') return send([]);
    if (req.url === '/api/http/services') {
      return send(services.map((service) => ({ loadBalancer: { servers: [service] } })));
    }
    res.writeHead(404);
    res.end('no');
  });
}

/** The router of a proxy that serves one of our routes. */
function servedByHttpProvider(url: string): { routers: FakeRouter[]; services: FakeService[] } {
  return {
    routers: [
      {
        name: 'dev-ours',
        rule: 'Host(`app.gwtest.local`)',
        entryPoints: ['websecure'],
        service: 'dev-ours',
        provider: 'http',
      },
    ],
    services: [{ name: 'dev-ours', loadBalancer: { servers: [{ url }] } }],
  };
}

/** A stream that answers the wizard's questions, in order. */
function answering(answers: string[]): {
  input: PassThrough;
  output: PassThrough;
  asked: () => number;
  said: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  let index = 0;
  let said = '';
  output.on('data', (chunk: Buffer | string) => {
    const text = String(chunk);
    said += text;
    if (!text.includes(']:')) return;
    if (index >= answers.length) return;
    input.write(`${answers[index]}\n`);
    index += 1;
  });
  return { input, output, asked: () => index, said: () => said };
}

/** Stop the daemon a wizard started in a throwaway directory. */
async function stopDaemonIn(dir: string): Promise<void> {
  try {
    const pid = Number.parseInt(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8').trim(), 10);
    if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
  } catch {
    // not running
  }
}

/**
 * The address of a proxy that does not answer.
 *
 * The tests that expect no proxy say where to look for it: a machine
 * that runs a Traefik of its own must not change what these tests see.
 */
async function deadApiUrl(): Promise<string> {
  return `http://127.0.0.1:${await freePort()}`;
}

test('setup walks through the six steps and writes the wiring', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const report = await cli.runJson<SetupReport>(['setup', '--api-base-url', await deadApiUrl(), '--json']);

  // Step one: the environment.
  assert.equal(report.environment.platform, process.platform);
  assert.equal(report.environment.stateDir, cli.dir);
  assert.equal(typeof report.environment.container, 'boolean');

  // Step two and three: the proxy is not there, so it is not wired.
  assert.equal(report.proxy.id, 'traefik');
  assert.equal(report.proxy.reachable, false);
  assert.equal(report.wired, false);

  // Step four: the wiring is written where the user can copy it from.
  assert.ok(report.wiring, 'the wizard did not emit any wiring');
  const wiringFile = path.join(cli.dir, 'wiring', 'traefik.yml');
  assert.equal(report.wiring.path, wiringFile);
  assert.ok(fs.existsSync(wiringFile), 'the wiring was not written');
  assert.match(report.wiring.content, /providers:/);
  assert.match(report.wiring.content, /\/traefik/);

  // Step five: without a proxy there is no public URL to fetch, and the
  // wizard says so instead of claiming a verification that did not happen.
  assert.equal(report.verification.status, 'skipped');
  assert.match(report.verification.reason ?? '', /no proxy answers/);

  // Step six: the configuration is written and the daemon runs.
  assert.equal(report.config.written, true);
  assert.equal(report.config.path, cli.configPath);
  assert.equal(report.config.zone, 'gwtest.local');
  assert.deepEqual(report.config.entryPoints, ['websecure']);
  assert.equal(report.daemon.running, true);
  assert.equal(typeof report.daemon.pid, 'number');

  assert.ok(report.nextSteps.length > 0);
  assert.ok(report.nextSteps.some((step) => step.includes('install-service')));
});

test('setup tells the user what it could not do', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const output = await cli.run(['setup', '--api-base-url', await deadApiUrl()]);

  assert.match(output, /1\. environment/);
  assert.match(output, /2\. proxy/);
  assert.match(output, /3\. wiring/);
  assert.match(output, /4\. the wiring to add to the proxy/);
  assert.match(output, /5\. end-to-end verification/);
  assert.match(output, /6\. configuration and daemon/);
  assert.match(output, /no traefik API answered/);
  assert.match(output, /next: /);
});

test('setup keeps the configuration it found', async (t) => {
  const cli = await makeCliFixture({ config: { zone: 'kept.local', entryPoints: ['web', 'websecure'] } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const report = await cli.runJson<SetupReport>(['setup', '--api-base-url', await deadApiUrl(), '--json']);

  assert.equal(report.config.zone, 'kept.local');
  assert.deepEqual(report.config.entryPoints, ['web', 'websecure']);

  const written = JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { zone: string };
  assert.equal(written.zone, 'kept.local');
});

test('the gateway serves the document while the wizard verifies', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  // A proxy that answers like Traefik and polls the document the way
  // Traefik's HTTP provider does.
  let served = 0;
  let refused = 0;
  let sawTheThrowawayRoute = false;
  const fake = http.createServer((req, res) => {
    const send = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/version') return send({ Version: '3.7.16-fake' });
    if (req.url === '/api/http/routers') return send([]);
    if (req.url === '/api/http/services') return send([]);
    res.writeHead(404);
    res.end('no');
  });
  const fakePort = await listen(fake);
  t.after(async () => {
    await close(fake);
  });

  const poll = setInterval(() => {
    void (async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${registryPort}/traefik`);
        if (!response.ok) {
          refused += 1;
          return;
        }
        served += 1;
        const body = await response.text();
        if (body.includes('check.dev-gateway-setup')) sawTheThrowawayRoute = true;
      } catch {
        refused += 1;
      }
    })();
  }, 50);
  t.after(() => clearInterval(poll));

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${fakePort}`,
    '--poll-interval',
    '500',
    '--json',
  ]);
  clearInterval(poll);

  // The proxy was found.
  assert.equal(report.proxy.reachable, true);

  // The gateway served the document while the throwaway route existed:
  // the daemon was up before the verification, not after it.
  assert.equal(
    sawTheThrowawayRoute,
    true,
    `the gateway did not serve the document with the throwaway route (served ${served}, refused ${refused}): the daemon was not up during the verification`,
  );

  // Without a real proxy in front, the public URL cannot be fetched. The
  // wizard says so instead of claiming a verification that did not happen.
  assert.equal(report.verification.status, 'failed');
  const publicUrl = report.verification.steps.find((step) => step.name === 'public URL');
  assert.equal(publicUrl?.ok, false);
});

test('the wizard asks for the values it cannot derive', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-wizard-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const deadPort = await freePort();
  const answers = answering(['asked.local', 'web,websecure', 'myca', 'file', '10.0.0.0/8', 'myhost']);

  t.after(async () => {
    await stopDaemonIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const report = await runSetup({
    config: {
      ...DEFAULT_CONFIG,
      registryPort,
      relayPort,
      stateDir: dir,
      zone: 'kept.local',
      entryPoints: ['kept'],
      certResolver: 'keptca',
      middlewareProvider: 'keptprovider',
      advertisedHost: 'kepthost',
      advertisedIp: '127.0.0.1',
    },
    configPath: path.join(dir, 'config.json'),
    paths: {
      configFile: path.join(dir, 'config.json'),
      stateDir: dir,
      logFile: path.join(dir, 'daemon.log'),
      cacheDir: path.join(dir, 'cache'),
    },
    cwd: dir,
    interactive: true,
    input: answers.input,
    output: answers.output,
    // Nothing answers here: the wizard has to ask.
    apiBaseUrl: `http://127.0.0.1:${deadPort}`,
    promptTimeoutMs: 10_000,
  });

  // Every value §9.2 names was asked for, and the host name the wiring is
  // written with.
  assert.equal(answers.asked(), 6, 'the wizard did not ask for every value');
  assert.equal(report.proxy.reachable, false);
  assert.equal(report.config.zone, 'asked.local');
  assert.deepEqual(report.config.entryPoints, ['web', 'websecure']);
  assert.equal(report.config.certResolver, 'myca');
  assert.equal(report.config.middlewareProvider, 'file');
  assert.deepEqual(report.config.allowedCidrs, ['127.0.0.1/32', '::1/128', '10.0.0.0/8']);
  assert.equal(report.config.advertisedHost, 'myhost');
  assert.equal(report.config.sources['zone'], 'the user');
  assert.equal(report.config.sources['entryPoints'], 'the user');
  assert.equal(report.config.sources['certResolver'], 'the user');
  assert.equal(report.config.sources['allowedCidrs'], 'the user');
  assert.deepEqual(report.config.unconfirmed, []);

  // The value the configuration file held was the default in the
  // question, not an answer (§9.2): it was asked for anyway.
  assert.match(answers.said(), /\[kept\.local\]/, 'the question did not offer the value of the file');
  assert.match(answers.said(), /\[kept\]/, 'the question did not offer the entry points of the file');
  assert.match(answers.said(), /\[kepthost\]/, 'the question did not offer the host name of the file');
  assert.match(answers.said(), /dispatch header/, 'the question did not ask for the trust list');

  // What the user answered is what the configuration file holds.
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) as {
    zone: string;
    entryPoints: string[];
    certResolver: string;
  };
  assert.equal(written.zone, 'asked.local');
  assert.deepEqual(written.entryPoints, ['web', 'websecure']);
  assert.equal(written.certResolver, 'myca');
});

test('the wizard reports the values it could not confirm', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const report = await cli.runJson<SetupReport>(['setup', '--api-base-url', await deadApiUrl(), '--json']);

  // Nobody was there to answer: the values are kept, and the wizard says
  // that nobody confirmed them.
  for (const name of ['zone', 'entryPoints', 'certResolver', 'middlewareProvider', 'allowedCidrs']) {
    assert.ok(report.config.unconfirmed.includes(name), `${name} was not reported as unconfirmed`);
  }
  assert.equal(report.config.sources['zone'], 'the configuration');
  assert.ok(
    report.nextSteps.some((step) => step.includes('confirm')),
    'the wizard does not say that the values have to be confirmed',
  );
});

test('the proxy that reaches the gateway by another name is recognised', async (t) => {
  const cli = await makeCliFixture({ config: { advertisedHost: 'localhost' } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const relayPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { relayPort: number }).relayPort;

  // The proxy reaches the gateway by its address, while the configuration
  // advertises its name. That is the same machine.
  const proxy = new FakeTraefik();
  const { routers, services } = servedByHttpProvider(`http://127.0.0.1:${relayPort}`);
  proxy.ownRouters.push(...routers);
  proxy.ownServices.push(...services);
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--json',
  ]);

  assert.equal(report.wired, true, 'the proxy was not recognised as wired');
  assert.equal(report.wiring, null, 'the wizard emitted wiring the user does not need');
  assert.ok(
    !report.nextSteps.some((step) => step.includes('add the wiring')),
    'the wizard sends the user after wiring that is not needed',
  );
});

test('a router of another provider does not make the proxy wired', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const relayPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { relayPort: number }).relayPort;

  // The proxy has a router of its own that happens to point at the same
  // port: it is not the HTTP provider's router, so the proxy is not
  // wired to the gateway (§9.3).
  const proxy = new FakeTraefik();
  const { routers, services } = servedByHttpProvider(`http://127.0.0.1:${relayPort}`);
  proxy.ownRouters.push(...routers.map((router) => ({ ...router, provider: 'file' })));
  proxy.ownServices.push(...services);
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--json',
  ]);

  assert.equal(report.wired, false, 'a router of another provider was taken for ours');
  assert.ok(report.wiring, 'the wizard did not emit the wiring the user needs');
});

test('the advice of the wizard fits what happened', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const proxy = fakeProxy([{ url: 'http://127.0.0.1:1' }]);
  const proxyPort = await listen(proxy);
  t.after(async () => {
    await close(proxy);
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxyPort}`,
    '--json',
  ]);

  // The proxy answered, so the wizard does not send the user after the
  // wiring: the advice is about the public URL instead.
  assert.equal(report.proxy.reachable, true);
  assert.ok(
    !report.nextSteps.some((step) => step.includes('run the setup again once the proxy has the wiring')),
    'the wizard gives advice that does not fit',
  );
});

test('the wizard keeps the answers that arrive before their question', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-wizard-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const deadPort = await freePort();

  t.after(async () => {
    await stopDaemonIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Every answer at once, as a paste: the first question takes the first
  // line, the second the second, and none is lost.
  const input = new PassThrough();
  const output = new PassThrough();
  input.write('pasted.local\nweb,websecure\nmyca\nfile\n10.0.0.0/8\nmyhost\n');

  const report = await runSetup({
    config: {
      ...DEFAULT_CONFIG,
      registryPort,
      relayPort,
      stateDir: dir,
      zone: DEFAULT_CONFIG.zone,
      entryPoints: [...DEFAULT_CONFIG.entryPoints],
      certResolver: DEFAULT_CONFIG.certResolver,
      middlewareProvider: DEFAULT_CONFIG.middlewareProvider,
      advertisedHost: DEFAULT_CONFIG.advertisedHost,
      advertisedIp: '127.0.0.1',
    },
    configPath: path.join(dir, 'config.json'),
    paths: {
      configFile: path.join(dir, 'config.json'),
      stateDir: dir,
      logFile: path.join(dir, 'daemon.log'),
      cacheDir: path.join(dir, 'cache'),
    },
    cwd: dir,
    interactive: true,
    input,
    output,
    apiBaseUrl: `http://127.0.0.1:${deadPort}`,
    promptTimeoutMs: 10_000,
  });

  assert.equal(report.config.zone, 'pasted.local');
  assert.deepEqual(report.config.entryPoints, ['web', 'websecure']);
  assert.equal(report.config.certResolver, 'myca');
  assert.equal(report.config.middlewareProvider, 'file');
  assert.deepEqual(report.config.allowedCidrs, ['127.0.0.1/32', '::1/128', '10.0.0.0/8']);
  assert.equal(report.config.advertisedHost, 'myhost');
});

test('the wizard discovers the values of the proxy without being told them', async (t) => {
  const cli = await makeCliFixture({
    config: {
      zone: 'wrong.local',
      entryPoints: ['nope'],
      certResolver: 'noresolver',
      middlewareProvider: 'noprovider',
    },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // A proxy with a router of its own: the zone, the entry point, the
  // certificate resolver and the middleware provider are all in it.
  const proxy = new FakeTraefik();
  proxy.ownRouters.push({
    name: 'app',
    rule: 'Host(`app.gwtest.local`)',
    entryPoints: ['testweb'],
    middlewares: ['compress@file'],
    tls: { certResolver: 'testca' },
    service: 'app',
    provider: 'file',
  });
  proxy.ownServices.push({
    name: 'app',
    loadBalancer: { servers: [{ url: 'http://127.0.0.1:9999' }] },
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--json',
  ]);

  // Step two: the proxy answered, and the values came from it.
  assert.equal(report.proxy.reachable, true);
  assert.equal(report.proxy.version, '3.7.16');
  assert.equal(report.proxy.zone, 'gwtest.local');
  assert.deepEqual(report.proxy.entryPoints, ['testweb']);
  assert.equal(report.proxy.certResolver, 'testca');
  assert.equal(report.proxy.middlewareProvider, 'file');

  // What the proxy knows wins over what the file holds (§9.2).
  assert.equal(report.config.zone, 'gwtest.local');
  assert.deepEqual(report.config.entryPoints, ['testweb']);
  assert.equal(report.config.certResolver, 'testca');
  assert.equal(report.config.middlewareProvider, 'file');
  assert.equal(report.config.sources['zone'], 'the proxy');
  assert.equal(report.config.sources['entryPoints'], 'the proxy');
  assert.equal(report.config.sources['certResolver'], 'the proxy');
  assert.equal(report.config.sources['middlewareProvider'], 'the proxy');
  assert.ok(
    !report.config.unconfirmed.includes('zone'),
    'a value the proxy confirmed is reported as unconfirmed',
  );
});

test('the wiring the wizard emits is one the proxy accepts', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  const proxy = new FakeTraefik();
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--json',
  ]);

  assert.ok(report.wiring, 'the wizard did not emit any wiring');

  // The snippet is a static configuration: the proxy reads the provider
  // it names and polls it.
  const parsed = parseYaml(report.wiring.content) as {
    providers?: { http?: { endpoint?: string; pollInterval?: string } };
  };
  const endpoint = parsed.providers?.http?.endpoint;
  assert.equal(endpoint, `http://127.0.0.1:${registryPort}/traefik`);
  assert.match(parsed.providers?.http?.pollInterval ?? '', /^\d+s$/);

  // The proxy accepts it: it polls the endpoint the snippet names, and
  // the gateway answers with the document.
  proxy.setDocumentEndpoint(endpoint as string);
  await proxy.poll(endpoint as string);
  assert.ok(proxy.polled.length >= 1, 'the proxy did not poll the endpoint of the snippet');
  assert.doesNotThrow(() => parseYaml(proxy.polled[0] as string));
});

test('the end-to-end verification passes against a proxy that serves the route', async (t) => {
  const certificate = makeCertificate('*.dev-gateway-setup.localhost');
  if (!certificate) {
    t.skip('openssl is not there to make a certificate with');
    return;
  }

  const cli = await makeCliFixture({
    config: { zone: 'localhost', advertisedHost: '127.0.0.1', advertisedIp: '127.0.0.1' },
    env: { NODE_EXTRA_CA_CERTS: certificate.certFile },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
    fs.rmSync(certificate.dir, { recursive: true, force: true });
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  // The proxy polls the document the way Traefik's HTTP provider does,
  // and serves the public URLs with the certificate the test trusts. It
  // serves them on a port of its own: the wizard reads the port from the
  // API of the proxy, the way it does with a real Traefik, and puts it in
  // the URL it fetches.
  const proxy = new FakeTraefik({
    tls: { key: certificate.key, cert: certificate.cert },
    documentEndpoint: `http://127.0.0.1:${registryPort}/traefik`,
    pollIntervalMs: 100,
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '1000',
    '--json',
  ]);

  // Every step of §9.5 happened, and the chain works.
  const names = report.verification.steps.map((step) => step.name);
  assert.deepEqual(names, ['throwaway server', 'route registered', 'public URL', 'cleaned up']);
  assert.equal(report.verification.status, 'verified', report.verification.steps.map((s) => s.detail).join(' | '));

  // The public URL was fetched on the port of the entry point of the
  // proxy: the certificate of that URL was checked, and it was trusted.
  const publicUrl = report.verification.steps.find((step) => step.name === 'public URL');
  assert.match(publicUrl?.detail ?? '', new RegExp(`https://check\\.dev-gateway-setup\\.localhost:${proxy.publicPort}`));

  // The proxy served the public URL of the throwaway route.
  assert.ok(
    proxy.served.some((entry) => entry.startsWith('check.dev-gateway-setup.localhost')),
    `the proxy did not serve the public URL (${proxy.served.join(', ')})`,
  );

  // The route is gone again, and the throwaway server is stopped.
  const routes = JSON.parse(fs.readFileSync(path.join(cli.dir, 'routes.json'), 'utf8')) as {
    registrations: Array<{ fqdn: string }>;
  };
  assert.equal(routes.registrations.length, 0, 'the throwaway route was not removed');
});

test('the verification waits for a proxy that picks the route up late', async (t) => {
  const certificate = makeCertificate('*.dev-gateway-setup.localhost');
  if (!certificate) {
    t.skip('openssl is not there to make a certificate with');
    return;
  }

  const cli = await makeCliFixture({
    config: { zone: 'localhost', advertisedHost: '127.0.0.1', advertisedIp: '127.0.0.1' },
    env: { NODE_EXTRA_CA_CERTS: certificate.certFile },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
    fs.rmSync(certificate.dir, { recursive: true, force: true });
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  // The proxy polls the document every three seconds, and the wizard is
  // told that the proxy polls every second: the route is not in what
  // the proxy knows when the wizard fetches the public URL for the first
  // time. A proxy that polls slower than the wizard was told is not a
  // broken setup: the verification waits for the poll.
  const proxy = new FakeTraefik({
    tls: { key: certificate.key, cert: certificate.cert },
    documentEndpoint: `http://127.0.0.1:${registryPort}/traefik`,
    pollIntervalMs: 3000,
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '1000',
    '--json',
  ]);

  assert.equal(
    report.verification.status,
    'verified',
    `the verification gave up before the proxy picked the route up: ${report.verification.steps
      .map((step) => step.detail)
      .join(' | ')}`,
  );
  assert.ok(
    proxy.served.some((entry) => entry.startsWith('check.dev-gateway-setup.localhost')),
    'the proxy did not serve the public URL',
  );
});

test('the verification says why the public URL did not answer', async (t) => {
  const certificate = makeCertificate('*.dev-gateway-setup.localhost');
  if (!certificate) {
    t.skip('openssl is not there to make a certificate with');
    return;
  }

  // The machine does not trust the certificate of the public URL: the
  // verification has to fail, and to say that the certificate is the
  // reason. Nothing here is switched off.
  const cli = await makeCliFixture({
    config: { zone: 'localhost', advertisedHost: '127.0.0.1', advertisedIp: '127.0.0.1' },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
    fs.rmSync(certificate.dir, { recursive: true, force: true });
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  const proxy = new FakeTraefik({
    tls: { key: certificate.key, cert: certificate.cert },
    documentEndpoint: `http://127.0.0.1:${registryPort}/traefik`,
    pollIntervalMs: 100,
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '1000',
    '--json',
  ]);

  assert.equal(report.verification.status, 'failed');
  const publicUrl = report.verification.steps.find((step) => step.name === 'public URL');
  assert.match(publicUrl?.detail ?? '', /the certificate of the public URL is not trusted/);
  assert.ok(
    report.nextSteps.some((step) => step.includes('certificate')),
    'the wizard does not say that the certificate has to be trusted',
  );
});

test('the wizard restarts a daemon that runs with the old configuration', async (t) => {
  const cli = await makeCliFixture({ config: { zone: 'first.local' } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const first = await cli.runJson<SetupReport>(['setup', '--api-base-url', await deadApiUrl(), '--json']);
  assert.equal(first.daemon.restarted, false, 'a daemon that was not running cannot be restarted');

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  // A route, so that the document holds a host name to look at.
  const devPort = await freePort();
  await cli.run(['register', '--project', 'demo', '--branch', 'main', '--port', String(devPort)]);

  // The zone of the configuration changes: the daemon has to serve the
  // new one, or the document the proxy polls is the old one.
  const config = JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(cli.configPath, JSON.stringify({ ...config, zone: 'second.local' }, null, 2));

  const second = await cli.runJson<SetupReport>(['setup', '--api-base-url', await deadApiUrl(), '--json']);
  assert.equal(second.daemon.restarted, true, 'the daemon was not restarted');
  assert.notEqual(second.daemon.pid, first.daemon.pid, 'the daemon has the same pid as before');

  const document = await (await fetch(`http://127.0.0.1:${registryPort}/traefik`)).text();
  // The route keeps the host name it was registered with, and the
  // certificate covers that host name: both are built from the zone of
  // the route, not from the zone of the configuration the daemon runs
  // with (§9.6: a route keeps the host name it was registered with).
  assert.match(document, /\*\.demo\.first\.local/, 'the certificate does not cover the name of the route');
  assert.match(document, /Host\(`main\.demo\.first\.local`\)/, 'the route lost its name');
  assert.doesNotMatch(document, /\*\.demo\.second\.local/, 'the certificate is built from the zone of the configuration');
});

test('the gateway does not write its own middleware provider into the configuration', async (t) => {
  const cli = await makeCliFixture({ config: { middlewareProvider: 'file' } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // The proxy has a route of the gateway (its dispatch middleware lives
  // in the HTTP provider) and a route of the user.
  const proxy = new FakeTraefik();
  proxy.ownRouters.push({
    name: 'dev-demo-main',
    rule: 'Host(`main.demo.gwtest.local`)',
    entryPoints: ['websecure'],
    service: 'dev-demo-main',
    middlewares: ['devhdr-demo-main@http'],
    provider: 'http',
  });
  proxy.ownServices.push({
    name: 'dev-demo-main',
    loadBalancer: { servers: [{ url: 'http://127.0.0.1:9999' }] },
  });
  proxy.ownRouters.push({
    name: 'app',
    rule: 'Host(`app.gwtest.local`)',
    entryPoints: ['websecure'],
    service: 'app',
    middlewares: ['compress@file'],
    provider: 'file',
  });
  proxy.ownServices.push({
    name: 'app',
    loadBalancer: { servers: [{ url: 'http://127.0.0.1:9999' }] },
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--json',
  ]);

  // The provider of the shared middlewares is the one of the user, and
  // not the HTTP provider of the gateway's own dispatch middleware.
  assert.equal(report.proxy.middlewareProvider, 'file');
  assert.equal(report.config.middlewareProvider, 'file');
  assert.equal(report.config.sources['middlewareProvider'], 'the proxy');

  // The document asks for the middleware of the user.
  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;
  const document = await (await fetch(`http://127.0.0.1:${registryPort}/traefik`)).text();
  assert.doesNotMatch(document, /@http/, 'the document asks for a middleware of the HTTP provider');
});

test('a proxy that says nothing about the middlewares leaves the value alone', async (t) => {
  const cli = await makeCliFixture({ config: { middlewareProvider: 'file' } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // A proxy that serves only the routes of the gateway: it says nothing
  // about the middlewares of the user.
  const proxy = new FakeTraefik();
  proxy.ownRouters.push({
    name: 'dev-demo-main',
    rule: 'Host(`main.demo.gwtest.local`)',
    entryPoints: ['websecure'],
    service: 'dev-demo-main',
    middlewares: ['devhdr-demo-main@http'],
    provider: 'http',
  });
  proxy.ownServices.push({
    name: 'dev-demo-main',
    loadBalancer: { servers: [{ url: 'http://127.0.0.1:9999' }] },
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--json',
  ]);

  assert.equal(report.proxy.middlewareProvider, undefined);
  assert.equal(report.config.middlewareProvider, 'file', 'the value of the configuration was lost');
  assert.ok(
    report.config.unconfirmed.includes('middlewareProvider'),
    'a value nobody confirmed is not reported as unconfirmed',
  );
});

test('the trust list keeps what the wizard offered when the user answers with a list of their own', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-trust-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const deadPort = await freePort();
  const answers = answering(['asked.local', 'web', 'myca', 'file', '10.0.0.0/8', 'myhost']);
  const configPath = path.join(dir, 'config.json');

  t.after(async () => {
    await stopDaemonIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await runSetup({
    config: {
      ...DEFAULT_CONFIG,
      registryPort,
      relayPort,
      stateDir: dir,
      advertisedIp: '127.0.0.1',
      advertisedHost: '127.0.0.1',
    },
    configPath,
    paths: {
      configFile: configPath,
      stateDir: dir,
      logFile: path.join(dir, 'daemon.log'),
      cacheDir: path.join(dir, 'cache'),
    },
    cwd: dir,
    interactive: true,
    input: answers.input,
    output: answers.output,
    apiBaseUrl: `http://127.0.0.1:${deadPort}`,
    promptTimeoutMs: 10_000,
  });

  const written = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Config;

  // The list of the user is in the trust list, and so is everything the
  // wizard offered: an answer adds to the list, it does not replace it.
  assert.ok(written.allowedCidrs.includes('10.0.0.0/8'), 'the list of the user was dropped');
  assert.ok(written.allowedCidrs.includes('127.0.0.1/32'), 'the loopback was dropped');
  assert.ok(written.allowedCidrs.includes('::1/128'), 'the loopback of IPv6 was dropped');

  // The relay of that configuration accepts the request of the proxy:
  // the loopback is in the trust list, so the dispatch is not refused.
  const relay = createRelayServer(new RegistrationStore(dir), { ...written, relayPort: 0 });
  const relayAnswerPort = await listen(relay);
  t.after(async () => {
    await close(relay);
  });

  const response = await fetch(`http://127.0.0.1:${relayAnswerPort}/`, {
    headers: { [DISPATCH_HEADER]: 'nobody' },
  });
  assert.notEqual(response.status, 403, 'the relay refused the request of the proxy');
});

test('the addresses of the proxy are the ones the trust list needs', async () => {
  // The proxy is the one that sends the dispatch header: its addresses
  // are the sources the relay has to accept.
  assert.deepEqual(await proxyAddresses(undefined), []);
  assert.deepEqual(await proxyAddresses('not a url'), []);
  assert.deepEqual(await proxyAddresses('http://127.0.0.1:8080'), [], 'the loopback is allowed already');
  assert.deepEqual(await proxyAddresses('http://localhost:8080'), [], 'the loopback is allowed already');

  assert.equal(cidrOf('10.0.0.5'), '10.0.0.5/32');
  assert.equal(cidrOf('2001:db8::1'), '2001:db8::1/128');
});

test('the verification is skipped when there is no zone', async (t) => {
  const cli = await makeCliFixture({ config: { zone: '' } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // The proxy answers, but there is no zone: the host names cannot be
  // built, so there is no public URL to fetch. The wizard says so
  // instead of claiming a verification that did not happen.
  const proxy = new FakeTraefik();
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--json',
  ]);

  assert.equal(report.proxy.reachable, true);
  assert.equal(report.verification.status, 'skipped');
  assert.match(report.verification.reason ?? '', /no DNS zone is configured/);
  assert.ok(
    report.nextSteps.some((step) => step.includes('zone')),
    'the wizard does not say that the zone has to be set',
  );
});

test('the verification says that the relay refused the request', async (t) => {
  const certificate = makeCertificate('*.dev-gateway-setup.localhost');
  if (!certificate) {
    t.skip('openssl is not there to make a certificate with');
    return;
  }

  // The trust list of the installation does not hold the address of the
  // proxy: the relay refuses its request, and the wizard has to say so.
  // A refusal is not a certificate problem and not a proxy that does not
  // know the route.
  const cli = await makeCliFixture({
    config: {
      zone: 'localhost',
      advertisedHost: '127.0.0.1',
      advertisedIp: '127.0.0.1',
      allowedCidrs: ['10.0.0.0/8'],
    },
    env: { NODE_EXTRA_CA_CERTS: certificate.certFile },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
    fs.rmSync(certificate.dir, { recursive: true, force: true });
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  const proxy = new FakeTraefik({
    tls: { key: certificate.key, cert: certificate.cert },
    documentEndpoint: `http://127.0.0.1:${registryPort}/traefik`,
    pollIntervalMs: 100,
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '1000',
    '--json',
  ]);

  assert.equal(report.verification.status, 'failed', report.verification.steps.map((s) => s.detail).join(' | '));
  assert.match(report.verification.reason ?? '', /the relay refused the request/);
  assert.match(report.verification.reason ?? '', /allowedCidrs/, 'the reason does not name the trust list');
  assert.ok(
    report.nextSteps.some((step) => step.includes('allowedCidrs')),
    'the wizard does not say that the trust list has to hold the address of the proxy',
  );
});

test('a 403 from the proxy is not the refusal of the relay', async (t) => {
  const certificate = makeCertificate('*.dev-gateway-setup.localhost');
  if (!certificate) {
    t.skip('openssl is not there to make a certificate with');
    return;
  }

  // The proxy refuses the request itself: an ipAllowList, a forwardAuth,
  // a middleware of its own. The trust list of the relay has nothing to
  // do with it, and the user must not be sent there.
  const cli = await makeCliFixture({
    config: {
      zone: 'localhost',
      advertisedHost: '127.0.0.1',
      advertisedIp: '127.0.0.1',
    },
    env: { NODE_EXTRA_CA_CERTS: certificate.certFile },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
    fs.rmSync(certificate.dir, { recursive: true, force: true });
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  const proxy = new FakeTraefik({
    tls: { key: certificate.key, cert: certificate.cert },
    documentEndpoint: `http://127.0.0.1:${registryPort}/traefik`,
    pollIntervalMs: 100,
    refuse: true,
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '1000',
    '--json',
  ]);

  assert.equal(report.verification.status, 'failed', report.verification.steps.map((s) => s.detail).join(' | '));
  assert.match(report.verification.reason ?? '', /the proxy refused the request/);
  assert.doesNotMatch(report.verification.reason ?? '', /allowedCidrs/, 'the trust list is not the cause here');
  assert.ok(
    !report.nextSteps.some((step) => step.includes('the address of the proxy has to be in the trust list')),
    'the wizard sends the user to the trust list for a cause that is not there',
  );
  assert.ok(
    report.nextSteps.some((step) => step.includes('the middleware of the proxy')),
    'the wizard does not say that the middleware of the proxy refused the request',
  );
});

test('the wizard does not crash on a configuration file with a zone that is not a string', async (t) => {
  // A hand-written file may hold anything. A zone that is not a string is
  // no zone: the wizard says so instead of failing on the type.
  const cli = await makeCliFixture({ config: { zone: null } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const report = await cli.runJson<SetupReport>(['setup', '--api-base-url', await deadApiUrl(), '--json']);

  assert.equal(report.config.zone, '');
  assert.ok(
    ['skipped', 'failed'].includes(report.verification.status),
    `the verification was ${report.verification.status}`,
  );
  assert.ok(
    report.nextSteps.some((step) => step.includes('zone')),
    'the wizard does not say that the zone has to be set',
  );
  assert.ok(
    report.nextSteps.some((step) => step.includes('confirm')),
    'the wizard does not say that the values have to be confirmed',
  );
});

test('the setup tells a script that the verification failed', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // A proxy that answers, and a public URL that does not: the
  // verification fails, and the exit code says so in every mode.
  const proxy = new FakeTraefik();
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const text = await cli.runFail(['setup', '--api-base-url', `http://127.0.0.1:${proxy.apiPort}`]);
  assert.equal(text.code, 1, `the exit code was ${text.code}: ${text.stdout}${text.stderr}`);

  const json = await cli.runFail(['setup', '--api-base-url', `http://127.0.0.1:${proxy.apiPort}`, '--json']);
  assert.equal(json.code, 1, `the exit code was ${json.code}: ${json.stdout}${json.stderr}`);
});

test('a configuration file that cannot be written is a clear error', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-readonly-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cli = await makeCliFixture({ config: { stateDir: dir } });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // The configuration file of the installation cannot be written.
  fs.chmodSync(cli.configPath, 0o444);

  const result = await cli.runFail(['setup', '--api-base-url', await deadApiUrl()]);
  assert.equal(result.code, 1, `the exit code was ${result.code}: ${result.stdout}${result.stderr}`);
  assert.doesNotMatch(result.stderr, /at runSetup/, 'the wizard died with a stack trace');
  assert.match(result.stderr, /error:/, 'the wizard did not say what went wrong');
});

test('a new installation does not get the zone of another project', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-fresh-'));
  const registryPort = await freePort();
  const relayPort = await freePort();

  t.after(async () => {
    await stopDaemonIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A fresh installation: no configuration file, no proxy, nobody to ask.
  // The built-in defaults are the ones of another project, and they must
  // not end up in the file of this one.
  const configPath = path.join(dir, 'config.json');
  const report = await runSetup({
    config: {
      ...DEFAULT_CONFIG,
      registryPort,
      relayPort,
      stateDir: dir,
      advertisedIp: '127.0.0.1',
    },
    configPath,
    paths: {
      configFile: configPath,
      stateDir: dir,
      logFile: path.join(dir, 'daemon.log'),
      cacheDir: path.join(dir, 'cache'),
    },
    cwd: dir,
    apiBaseUrl: await deadApiUrl(),
  });

  const written = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  for (const key of ['zone', 'certResolver', 'advertisedHost', 'middlewareProvider', 'allowedCidrs']) {
    assert.ok(!(key in written), `the configuration file holds ${key}: ${String(written[key])}`);
    assert.ok(report.config.omitted.includes(key), `${key} is not reported as omitted`);
  }
  // The values that are not in doubt are written.
  assert.equal(written['relayPort'], relayPort);
  assert.equal(written['registryPort'], registryPort);
});

test('a question nobody answers is a value nobody confirmed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-timeout-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = path.join(dir, 'config.json');

  t.after(async () => {
    await stopDaemonIn(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A terminal, a wizard, and nobody who answers: every question times
  // out. The values that are kept are values nobody confirmed, and they
  // are not written to the file of a new installation.
  const input = new PassThrough();
  const output = new PassThrough();
  const report = await runSetup({
    config: {
      ...DEFAULT_CONFIG,
      registryPort,
      relayPort,
      stateDir: dir,
      advertisedIp: '127.0.0.1',
    },
    configPath,
    paths: {
      configFile: configPath,
      stateDir: dir,
      logFile: path.join(dir, 'daemon.log'),
      cacheDir: path.join(dir, 'cache'),
    },
    cwd: dir,
    interactive: true,
    input,
    output,
    apiBaseUrl: await deadApiUrl(),
    promptTimeoutMs: 200,
  });

  for (const name of ['zone', 'entryPoints', 'certResolver', 'middlewareProvider', 'allowedCidrs', 'advertisedHost']) {
    assert.ok(report.config.unconfirmed.includes(name), `${name} was not reported as unconfirmed`);
  }
  assert.ok(
    report.nextSteps.some((step) => step.includes('confirm')),
    'the wizard does not say that the values have to be confirmed',
  );

  // The zone of another project is not in the file.
  const written = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  assert.ok(!('zone' in written), `the configuration file holds the zone ${String(written['zone'])}`);
  assert.ok(!('certResolver' in written), 'the configuration file holds the resolver of another project');
  assert.equal(report.config.zone, DEFAULT_CONFIG.zone, 'the value of the wizard changed');
});

test('a plain HTTP answer does not verify a public URL with an untrusted certificate', async (t) => {
  const certificate = makeCertificate('*.dev-gateway-setup.localhost');
  if (!certificate) {
    t.skip('openssl is not there to make a certificate with');
    return;
  }

  const cli = await makeCliFixture({
    config: {
      zone: 'localhost',
      advertisedHost: '127.0.0.1',
      advertisedIp: '127.0.0.1',
      entryPoints: ['websecure', 'web'],
    },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
    fs.rmSync(certificate.dir, { recursive: true, force: true });
  });

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  // The proxy has an entry point with TLS and one without. The
  // certificate of the TLS one is not trusted by this machine.
  const proxy = new FakeTraefik({
    tls: { key: certificate.key, cert: certificate.cert },
    documentEndpoint: `http://127.0.0.1:${registryPort}/traefik`,
    pollIntervalMs: 100,
  });
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '1000',
    '--json',
  ]);

  // The public URL is served over HTTPS, and its certificate is not
  // trusted: the plain HTTP answer does not make the verification pass.
  assert.equal(report.verification.status, 'failed', report.verification.steps.map((s) => s.detail).join(' | '));
  const publicUrl = report.verification.steps.find((step) => step.name === 'public URL');
  assert.match(publicUrl?.detail ?? '', /the certificate of the public URL is not trusted/);
});

test('a proxy that does not serve the route yet is not a failed setup', async (t) => {
  const cli = await makeCliFixture({
    config: {
      zone: 'localhost',
      advertisedHost: '127.0.0.1',
      advertisedIp: '127.0.0.1',
      entryPoints: ['websecure', 'web'],
    },
  });
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // The proxy answers, but it does not poll the gateway yet: the wiring
  // has to be added by the user first.
  const proxy = new FakeTraefik();
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const result = await cli.runFail([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '500',
  ]);
  assert.equal(result.code, 0, `the exit code was ${result.code}: ${result.stdout}${result.stderr}`);

  const report = await cli.runJson<SetupReport>([
    'setup',
    '--api-base-url',
    `http://127.0.0.1:${proxy.apiPort}`,
    '--poll-interval',
    '500',
    '--json',
  ]);
  assert.equal(report.verification.status, 'skipped');
  assert.match(report.verification.reason ?? '', /the proxy does not serve the route/);
  assert.ok(
    report.nextSteps.some((step) => step.includes('add the wiring')),
    'the wizard does not say that the wiring has to be added',
  );
});

test('the verification puts a route of the user back', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  // A route of the user that has the same name as the throwaway route of
  // the verification.
  const devPort = await freePort();
  await cli.run(['register', '--project', 'dev-gateway-setup', '--branch', 'check', '--port', String(devPort)]);

  const proxy = new FakeTraefik();
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  await cli.run(['setup', '--api-base-url', `http://127.0.0.1:${proxy.apiPort}`]);

  const routes = JSON.parse(fs.readFileSync(path.join(cli.dir, 'routes.json'), 'utf8')) as {
    registrations: Array<{ project: string; branch: string; devPort: number }>;
  };
  assert.equal(routes.registrations.length, 1, 'the route of the user is gone');
  assert.equal(routes.registrations[0]?.devPort, devPort, 'the route of the user points at another port');
});
