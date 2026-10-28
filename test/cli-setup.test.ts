/**
 * The setup wizard (`dev-gateway setup`, §9).
 *
 * The wizard runs against a throwaway installation: a temporary directory
 * for the configuration, the state and the home directory, and free ports.
 * No proxy answers in the test environment, so the wizard says that it
 * could not discover one, and that it could not verify the chain end to
 * end. That is the honest answer, and the wizard has to give it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { DEFAULT_CONFIG } from '../src/core/config.ts';
import { runSetup } from '../src/cli/setup.ts';
import { freePort, makeCliFixture } from './helpers/cli.ts';
import { close, listen } from './helpers/fixtures.ts';

interface SetupReport {
  environment: { container: boolean; platform: string; stateDir: string; daemonRunning: boolean };
  proxy: { id: string; reachable: boolean };
  wired: boolean;
  wiring: { path: string; content: string } | null;
  verification: { status: string; reason?: string; steps: Array<{ name: string; ok: boolean }> };
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
  daemon: { running: boolean; pid: number | null };
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

/** A stream that answers the wizard's questions, in order. */
function answering(answers: string[]): { input: PassThrough; output: PassThrough; asked: () => number } {
  const input = new PassThrough();
  const output = new PassThrough();
  let index = 0;
  output.on('data', (chunk: Buffer | string) => {
    if (!String(chunk).includes(']:')) return;
    if (index >= answers.length) return;
    input.write(`${answers[index]}\n`);
    index += 1;
  });
  return { input, output, asked: () => index };
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

test('setup walks through the six steps and writes the wiring', async (t) => {
  const cli = await makeCliFixture();
  t.after(async () => {
    await cli.stopDaemon();
    cli.cleanup();
  });

  const report = await cli.runJson<SetupReport>(['setup', '--json']);

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

  const output = await cli.run(['setup']);

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

  const report = await cli.runJson<SetupReport>(['setup', '--json']);

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
  const answers = answering(['asked.local', 'web,websecure', 'myca', 'file', 'myhost']);

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
    input: answers.input,
    output: answers.output,
    // Nothing answers here: the wizard has to ask.
    apiBaseUrl: `http://127.0.0.1:${deadPort}`,
    promptTimeoutMs: 10_000,
  });

  // Every value §9.2 names was asked for, and the host name the wiring is
  // written with.
  assert.equal(answers.asked(), 5, 'the wizard did not ask for every value');
  assert.equal(report.proxy.reachable, false);
  assert.equal(report.config.zone, 'asked.local');
  assert.deepEqual(report.config.entryPoints, ['web', 'websecure']);
  assert.equal(report.config.certResolver, 'myca');
  assert.equal(report.config.middlewareProvider, 'file');
  assert.equal(report.config.advertisedHost, 'myhost');
  assert.equal(report.config.sources['zone'], 'the user');
  assert.equal(report.config.sources['entryPoints'], 'the user');
  assert.equal(report.config.sources['certResolver'], 'the user');
  assert.deepEqual(report.config.unconfirmed, []);

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

  const report = await cli.runJson<SetupReport>(['setup', '--json']);

  // Nobody was there to answer: the values are kept, and the wizard says
  // that nobody confirmed them.
  for (const name of ['zone', 'entryPoints', 'certResolver', 'middlewareProvider']) {
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

  const registryPort = (JSON.parse(fs.readFileSync(cli.configPath, 'utf8')) as { registryPort: number }).registryPort;

  // The proxy reaches the gateway by its address, while the configuration
  // advertises its name. That is the same machine.
  const proxy = fakeProxy([{ url: `http://127.0.0.1:${registryPort}` }]);
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

  assert.equal(report.wired, true, 'the proxy was not recognised as wired');
  assert.equal(report.wiring, null, 'the wizard emitted wiring the user does not need');
  assert.ok(
    !report.nextSteps.some((step) => step.includes('add the wiring')),
    'the wizard sends the user after wiring that is not needed',
  );
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
  input.write('pasted.local\nweb,websecure\nmyca\nfile\nmyhost\n');

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
  assert.equal(report.config.advertisedHost, 'myhost');
});
