/**
 * The setup wizard (§9).
 *
 * `dev-gateway setup` walks a new installation through six steps, five of
 * them automatic:
 *
 * 1. read the environment (§9.1);
 * 2. discover the proxy (§9.2);
 * 3. is the proxy already wired? (§9.3);
 * 4. emit the wiring (§9.4);
 * 5. verify end to end (§9.5);
 * 6. write the configuration and start (§9.6).
 *
 * The wizard never pretends: when it cannot verify something, it says so.
 * A setup that half worked and says so is worth more than a setup that
 * claims everything is fine.
 *
 * The wizard is a client of the core: it asks the proxy adapter to
 * discover the proxy and to render the wiring (D3), and it writes the route
 * store through the same store the CLI uses.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { requireAdapter } from '../adapters/index.ts';
import { DEFAULT_CONFIG, writeConfigFile } from '../core/config.ts';
import { daemonStatus, ensureDaemon } from '../core/daemonControl.ts';
import { RegistrationStore } from '../core/state.ts';
import { buildFqdn } from '../core/util/slug.ts';
import type { GatewayPaths } from '../core/paths.ts';
import type { Config } from '../core/types.ts';

/** How the wizard ends. */
export type VerificationStatus = 'verified' | 'failed' | 'skipped';

/** Why the verification was skipped when no proxy answers. */
export const NO_PROXY_REASON = 'no proxy answers, so there is no public URL to fetch';

/** One step of the end-to-end verification (§9.5). */
export interface VerificationStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SetupReport {
  environment: {
    container: boolean;
    platform: string;
    addresses: string[];
    cwd: string;
    stateDir: string;
    configPath: string;
    daemonRunning: boolean;
    daemonPid: number | null;
  };
  proxy: {
    id: string;
    reachable: boolean;
    version?: string;
    apiBaseUrl: string;
    zone?: string;
    entryPoints?: string[];
    certResolver?: string;
    middlewareProvider?: string;
  };
  /** Is the proxy already wired to this machine? (§9.3) */
  wired: boolean;
  /** The wiring the user has to add to the proxy (§9.4). */
  wiring: { path: string; content: string } | null;
  /** What the end-to-end verification found (§9.5). */
  verification: {
    status: VerificationStatus;
    reason?: string;
    steps: VerificationStep[];
  };
  /** What was written to the configuration file (§9.6). */
  config: {
    path: string;
    written: boolean;
    zone: string;
    entryPoints: string[];
    certResolver: string;
    middlewareProvider: string;
    advertisedHost: string;
    /**
     * Where every value came from: `the proxy`, `the user`,
     * `the configuration` or `the default` (§9.2).
     */
    sources: Record<string, string>;
    /**
     * The values nobody confirmed: the proxy did not answer and there was
     * nobody to ask (§9.2).
     */
    unconfirmed: string[];
  };
  /** The daemon after the wizard (§9.6). */
  daemon: { running: boolean; pid: number | null; error?: string };
  /** What the user should do next. */
  nextSteps: string[];
}

export interface SetupOptions {
  /** The configuration the wizard starts from. */
  config: Config;
  /** Where the configuration file is. */
  configPath: string;
  /** The paths of the installation. */
  paths: GatewayPaths;
  /** The directory the wizard runs in. */
  cwd: string;
  /** The proxy to set up. Defaults to the configured one. */
  proxy?: string;
  /** The base URL of the proxy API. */
  apiBaseUrl?: string;
  /** Ask the user for the values that are missing. */
  interactive?: boolean;
  /** Run the end-to-end verification. */
  verify?: boolean;
  /** How long the proxy gets to pick the route up. */
  pollIntervalMs?: number;
  /** How long a question waits for an answer. Zero waits forever. */
  promptTimeoutMs?: number;
  /** Where the wizard writes its progress. */
  log?: (line: string) => void;
  /** Where the questions are read from. Defaults to the standard input. */
  input?: NodeJS.ReadableStream;
  /** Where the questions are written to. Defaults to the standard output. */
  output?: NodeJS.WritableStream;
  /** The environment to read. Injectable for the tests. */
  env?: NodeJS.ProcessEnv;
  /** The home directory. Injectable for the tests. */
  home?: string;
}

/** Is this process running in a container? */
export function isContainer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['container']) return true;
  try {
    if (fs.existsSync('/.dockerenv')) return true;
  } catch {
    // ignore
  }
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd|kubepods|lxc/i.test(cgroup)) return true;
  } catch {
    // ignore
  }
  return false;
}

/** The addresses of this machine that a proxy could reach. */
export function localAddresses(): string[] {
  const found: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      found.push(info.address);
    }
  }
  return [...new Set(found)];
}

/**
 * The endpoints the gateway serves the dynamic configuration on.
 *
 * The proxy may reach the machine by its host name (`devbox`) or by its
 * IP, and the configuration may say either: every name the machine is
 * known by is an answer to the question "is the proxy already wired?"
 * (§9.3).
 */
export function expectedEndpoints(config: Config, proxyId: string): string[] {
  const hosts = [config.advertisedHost, config.advertisedIp].filter(
    (host): host is string => typeof host === 'string' && host.length > 0,
  );
  return [...new Set(hosts)].map((host) => `http://${host}:${config.registryPort}/${proxyId}`);
}

/** The directory the wiring is written to (§9.4). */
export function wiringDir(stateDir: string): string {
  return path.join(stateDir, 'wiring');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The questions of the wizard.
 *
 * One readline interface for the whole wizard, and the lines are queued:
 * a user who answers faster than the wizard asks — or pastes the answers
 * — must not lose them. The first line of the queue answers the first
 * question, the second the second.
 */
class Prompter {
  private readonly rl: Interface;
  private readonly queue: string[] = [];
  private readonly waiting: Array<(line: string) => void> = [];
  private discardNext = false;

  constructor(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
    this.rl = createInterface({ input, output });
    this.rl.on('line', (line: string) => {
      if (this.discardNext) {
        // The answer of a question that timed out: it answers nothing.
        this.discardNext = false;
        return;
      }
      const resolve = this.waiting.shift();
      if (resolve) resolve(line);
      else this.queue.push(line);
    });
  }

  /**
   * Ask a question. The answer may be empty: the fallback is used then.
   *
   * The question is bounded: a wizard that waits for an answer forever is
   * a wizard that hangs when nobody is there to answer it. When the time
   * runs out, the fallback is used and the wizard says that it did.
   */
  async ask(question: string, fallback: string, timeoutMs: number): Promise<{ answer: string; timedOut: boolean }> {
    this.rl.setPrompt(`${question} [${fallback}]: `);
    this.rl.prompt();

    const line = await this.readLine(timeoutMs);
    const answer = (line ?? '').trim();
    return { answer: answer.length > 0 ? answer : fallback, timedOut: line === null };
  }

  /** The next line, or null when the time runs out. */
  private readLine(timeoutMs: number): Promise<string | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (timeoutMs <= 0) {
      return new Promise((resolve) => this.waiting.push((line) => resolve(line)));
    }
    return new Promise((resolve) => {
      let expired = false;
      const waiter = (line: string): void => {
        if (expired) return;
        clearTimeout(timer);
        resolve(line);
      };
      const timer = setTimeout(() => {
        expired = true;
        this.discardNext = true;
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      this.waiting.push(waiter);
    });
  }

  /** Close the terminal. */
  close(): void {
    this.rl.close();
  }
}

/**
 * Run the wizard.
 *
 * The wizard never throws for a missing value: it asks, or it keeps the
 * value the configuration already has, and it says in its report which
 * value it used.
 */
export async function runSetup(opts: SetupOptions): Promise<SetupReport> {
  const log = opts.log ?? (() => {});
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const proxyId = opts.proxy ?? opts.config.proxy;
  const adapter = requireAdapter(proxyId);
  const config: Config = { ...opts.config };

  // Step one: read the environment (§9.1).
  const status = await daemonStatus(config);
  const environment: SetupReport['environment'] = {
    container: isContainer(env),
    platform: process.platform,
    addresses: localAddresses(),
    cwd: opts.cwd,
    stateDir: config.stateDir,
    configPath: opts.configPath,
    daemonRunning: status.healthy,
    daemonPid: status.pid,
  };
  log('1. environment');
  log(`   container:      ${environment.container ? 'yes' : 'no'}`);
  log(`   platform:       ${environment.platform}`);
  log(`   addresses:      ${environment.addresses.join(', ') || '(none)'}`);
  log(`   working dir:    ${environment.cwd}`);
  log(`   state dir:      ${environment.stateDir}`);
  log(`   daemon:         ${environment.daemonRunning ? `running (pid ${environment.daemonPid})` : 'not running'}`);

  // Step two: discover the proxy (§9.2).
  const apiBaseUrl = opts.apiBaseUrl ?? (proxyId === 'traefik' ? 'http://127.0.0.1:8080' : undefined);
  const discovered = await adapter.discover({
    apiBaseUrl,
    expectEndpoints: expectedEndpoints(config, proxyId),
  });
  const proxy: SetupReport['proxy'] = {
    id: proxyId,
    reachable: discovered !== undefined,
    version: discovered?.version,
    apiBaseUrl: apiBaseUrl ?? '(the default of the adapter)',
    zone: discovered?.derived.zone,
    entryPoints: discovered?.derived.entryPoints,
    certResolver: discovered?.derived.certResolver,
    middlewareProvider: discovered?.derived.middlewareProvider,
  };
  log('2. proxy');
  if (discovered) {
    log(`   found:          ${proxyId}${discovered.version ? ` ${discovered.version}` : ''}`);
    log(`   zone:           ${proxy.zone ?? '(not derived)'}`);
    log(`   entry points:   ${(proxy.entryPoints ?? []).join(', ') || '(not derived)'}`);
    log(`   cert resolver:  ${proxy.certResolver ?? '(not derived)'}`);
  } else {
    log(`   no ${proxyId} API answered at ${proxy.apiBaseUrl}`);
  }

  // The values the configuration needs (§9.2). What the proxy knows wins.
  // What the proxy does not know, the user is asked for: when no proxy
  // API answers, the wizard asks for the zone, the entry points, the
  // certificate resolver and the middleware provider. Nothing is
  // hard-coded, and a value nobody could confirm is reported as
  // unconfirmed instead of passing for a fact.
  const interactive = opts.interactive === true;
  const promptTimeoutMs = opts.promptTimeoutMs ?? 30_000;
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const prompter = interactive ? new Prompter(input, output) : undefined;
  const sources: Record<string, string> = {};
  const unconfirmed: string[] = [];

  /** Where a value comes from: the file it was in, or the built-in default. */
  const origin = (value: unknown, fallback: unknown): string =>
    JSON.stringify(value) === JSON.stringify(fallback) ? 'the default' : 'the configuration';

  /**
   * Settle one value: the proxy's, or the user's, or the one there is.
   */
  const settle = async (
    name: string,
    question: string,
    current: string,
    fallback: string,
    fromProxy: boolean,
  ): Promise<string> => {
    if (fromProxy) {
      sources[name] = 'the proxy';
      return current;
    }
    if (interactive && prompter) {
      const answer = await prompter.ask(question, current || fallback, promptTimeoutMs);
      sources[name] = answer.answer === current ? origin(current, fallback) : 'the user';
      return answer.answer;
    }
    sources[name] = origin(current, fallback);
    unconfirmed.push(name);
    return current;
  };

  config.zone = await settle(
    'zone',
    '   the DNS zone the host names are built from',
    proxy.zone ?? config.zone,
    DEFAULT_CONFIG.zone,
    proxy.zone !== undefined,
  );

  if (proxy.entryPoints !== undefined) {
    config.entryPoints = proxy.entryPoints;
    sources['entryPoints'] = 'the proxy';
  } else if (interactive && prompter) {
    const current = config.entryPoints.join(', ');
    const answer = await prompter.ask('   the entry points the routers attach to (comma separated)', current, promptTimeoutMs);
    const parsed = answer.answer
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (parsed.length > 0) config.entryPoints = parsed;
    sources['entryPoints'] = answer.answer === current ? origin(config.entryPoints, DEFAULT_CONFIG.entryPoints) : 'the user';
  } else {
    sources['entryPoints'] = origin(config.entryPoints, DEFAULT_CONFIG.entryPoints);
    unconfirmed.push('entryPoints');
  }

  config.certResolver = await settle(
    'certResolver',
    '   the certificate resolver (empty means no TLS block)',
    proxy.certResolver ?? config.certResolver,
    DEFAULT_CONFIG.certResolver,
    proxy.certResolver !== undefined,
  );

  config.middlewareProvider = await settle(
    'middlewareProvider',
    '   the proxy provider that owns the shared middlewares',
    proxy.middlewareProvider ?? config.middlewareProvider,
    DEFAULT_CONFIG.middlewareProvider,
    proxy.middlewareProvider !== undefined,
  );

  // The host name the proxy reaches this machine under is not something the
  // proxy's API says: it is this machine's own name. It is asked for when
  // it is the built-in default and no proxy answered, because the wiring
  // is written with it.
  const advertisedIsDefault = origin(config.advertisedHost, DEFAULT_CONFIG.advertisedHost) === 'the default';
  if (interactive && prompter && (!config.advertisedHost || (advertisedIsDefault && !discovered))) {
    const answer = await prompter.ask(
      '   the host name the proxy reaches this machine under',
      config.advertisedIp,
      promptTimeoutMs,
    );
    config.advertisedHost = answer.answer;
    sources['advertisedHost'] = 'the user';
  } else {
    sources['advertisedHost'] = advertisedIsDefault ? 'the default' : 'the configuration';
    if (advertisedIsDefault && !discovered) unconfirmed.push('advertisedHost');
  }
  prompter?.close();

  // Step three: is the proxy already wired? (§9.3).
  const wired = discovered?.wired === true;
  log('3. wiring');
  log(wired ? '   the proxy already points at this machine' : '   the proxy does not point at this machine yet');

  // Step four: emit the wiring (§9.4).
  let wiring: SetupReport['wiring'] = null;
  if (!wired) {
    const content = adapter.wiringSnippet(config);
    const file = path.join(wiringDir(config.stateDir), `${proxyId}.yml`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    wiring = { path: file, content };
    log('4. the wiring to add to the proxy');
    log(`   written to:     ${file}`);
    for (const line of content.split('\n')) log(`   ${line}`);
    log('   the wizard cannot apply it: the proxy runs on another machine');
  }

  // The verification needs a gateway that serves the document (§9.5): the
  // configuration is written and the daemon is started before it. §9 puts
  // both in step six, but a verification that runs against a gateway that
  // is not up yet verifies nothing — the proxy polls the document and gets
  // nothing back.
  writeConfigFile(opts.configPath, config);
  const daemon = await ensureDaemon(config, { configPath: opts.configPath });

  // Step five: verify end to end (§9.5).
  const verification = await verifyEndToEnd({
    config,
    proxyReachable: discovered !== undefined,
    enabled: opts.verify !== false,
    pollIntervalMs: opts.pollIntervalMs ?? 3000,
    log,
  });
  log('5. end-to-end verification');
  log(`   ${verification.status}${verification.reason ? `: ${verification.reason}` : ''}`);
  for (const step of verification.steps) log(`   ${step.ok ? 'ok' : 'failed'}  ${step.name}: ${step.detail}`);

  // Step six: the configuration and the daemon (§9.6). Both are in place:
  // they were needed for the verification.
  log('6. configuration and daemon');
  log(`   configuration:  ${opts.configPath}`);
  log(`   daemon:         ${daemon.error ? `not started (${daemon.error})` : `running (pid ${daemon.pid})`}`);

  const nextSteps: string[] = [];
  if (!wired && wiring) {
    nextSteps.push(`add the wiring from ${wiring.path} to the proxy's static configuration`);
  }
  if (unconfirmed.length > 0) {
    nextSteps.push(
      `confirm ${unconfirmed.join(', ')}: run "dev-gateway setup" again, or write them in ${opts.configPath}`,
    );
  }
  if (verification.status === 'skipped' && verification.reason === NO_PROXY_REASON) {
    nextSteps.push('run the setup again once the proxy has the wiring: the verification needs a proxy that answers');
  } else if (verification.status === 'failed') {
    nextSteps.push('the public URL did not answer: the proxy has to route the route, and the certificate has to be in place');
  }
  nextSteps.push('run "dev-gateway install-service" so the daemon survives a reboot');

  return {
    environment,
    proxy,
    wired,
    wiring,
    verification,
    config: {
      path: opts.configPath,
      written: true,
      zone: config.zone,
      entryPoints: config.entryPoints,
      certResolver: config.certResolver,
      middlewareProvider: config.middlewareProvider,
      advertisedHost: config.advertisedHost,
      sources,
      unconfirmed,
    },
    daemon: { running: !daemon.error, pid: daemon.pid, error: daemon.error },
    nextSteps,
  };
}

interface VerifyOptions {
  config: Config;
  proxyReachable: boolean;
  enabled: boolean;
  pollIntervalMs: number;
  log: (line: string) => void;
}

/**
 * Verify the whole chain end to end (§9.5).
 *
 * A throwaway server is started, registered, given a poll interval to be
 * picked up, and fetched through the public URL. The route and the server
 * are removed again, whatever the outcome.
 */
async function verifyEndToEnd(opts: VerifyOptions): Promise<SetupReport['verification']> {
  const steps: VerificationStep[] = [];
  if (!opts.enabled) {
    return { status: 'skipped', reason: 'the verification was turned off', steps };
  }
  if (!opts.proxyReachable) {
    return { status: 'skipped', reason: NO_PROXY_REASON, steps };
  }

  const project = 'dev-gateway-setup';
  const branch = 'check';
  const fqdn = buildFqdn(project, branch, opts.config.zone);
  const store = new RegistrationStore(opts.config.stateDir);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('dev-gateway setup check\n');
  });

  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('the throwaway server did not get a port'));
      });
    });
    steps.push({ name: 'throwaway server', ok: true, detail: `127.0.0.1:${port}` });

    store.upsert({ project, branch, devPort: port, zone: opts.config.zone });
    steps.push({ name: 'route registered', ok: true, detail: fqdn });

    await sleep(opts.pollIntervalMs);

    let ok = false;
    let detail = '';
    try {
      const response = await fetch(`https://${fqdn}`, { signal: AbortSignal.timeout(5000) });
      ok = response.ok;
      detail = `${response.status} ${response.statusText}`.trim();
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    steps.push({ name: 'public URL', ok, detail: `https://${fqdn} — ${detail}` });

    return { status: ok ? 'verified' : 'failed', steps };
  } catch (error) {
    steps.push({ name: 'throwaway server', ok: false, detail: (error as Error).message });
    return { status: 'failed', reason: (error as Error).message, steps };
  } finally {
    store.remove(project, branch);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    steps.push({ name: 'cleaned up', ok: true, detail: 'the route was removed and the server stopped' });
  }
}
