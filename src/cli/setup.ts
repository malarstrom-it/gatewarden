/**
 * The setup wizard (§9).
 *
 * `gatewarden setup` walks a new installation through six steps, five of
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
import dns from 'node:dns/promises';
import { createInterface, type Interface } from 'node:readline';
import { requireAdapter } from '../adapters/index.ts';
import { DEFAULT_CONFIG, writeConfigFile, zoneOf } from '../core/config.ts';
import { daemonStatus, ensureDaemon, stopDaemon } from '../core/daemonControl.ts';
import { RegistrationStore } from '../core/state.ts';
import { withRouteLock } from '../core/lock.ts';
import { isGatewayRefusal, SECRET_REFUSAL, TRUST_LIST_REFUSAL } from '../core/trust.ts';
import { buildFqdn } from '../core/util/slug.ts';
import type { GatewayPaths } from '../core/paths.ts';
import type { Config } from '../core/types.ts';

/** How the wizard ends. */
export type VerificationStatus = 'verified' | 'failed' | 'skipped';

/** Why the verification was skipped when no proxy answers. */
export const NO_PROXY_REASON = 'no proxy answers, so there is no public URL to fetch';

/**
 * Why the verification was skipped when there is no zone.
 *
 * The host names are built from the zone. Without one there is no public
 * URL to fetch, and a route with an empty zone would be a host name with
 * a trailing dot.
 */
export const NO_ZONE_REASON = 'no DNS zone is configured, so there is no public URL to fetch';

/**
 * Why the verification was skipped when the public URL could not be
 * fetched at all.
 *
 * The chain was never reached: the name of the public URL does not
 * resolve, or nothing listens on the port. That is the shape of a
 * machine without a public URL — a CI runner, a laptop with no DNS for
 * the zone — and not a broken installation. A chain that answered with an
 * error is a different thing, and it is a `failed` (§9.7).
 */
export const NOT_FETCHABLE_REASON =
  'the public URL could not be fetched: nothing answered there (the zone does not resolve, or nothing listens on the port)';

/**
 * Why the verification failed when the public URL answered with an error.
 *
 * The chain answered — a 500, a 502, anything that is not a 404 and not a
 * 403. The answer is the reason, and it is not the certificate: a port
 * that speaks plain HTTP and not TLS says something else entirely.
 */
export const HTTP_ERROR_REASON = 'the public URL answered with an error';

/**
 * Why the verification failed when the relay refused the request.
 *
 * The relay only serves the addresses in the trust list (`allowedCidrs`)
 * — and the secret, when there is one. A refusal is neither a missing
 * certificate nor a proxy that does not know the route, and saying so
 * saves the user from looking in the wrong place.
 */
export const FORBIDDEN_REASON =
  'the relay refused the request: the address of the proxy is not in the trust list (allowedCidrs), or the secret is wrong';

/**
 * Why the verification failed when the registry refused the document.
 *
 * The registry answers the trust list and nobody else (D15). When the
 * poll of the proxy is refused, the proxy has no configuration, the
 * route never reaches it, and the public URL answers 404 — a wizard
 * that stopped there would blame the wiring, and the cause is the
 * trust list. The refusal says who it is: the address of the proxy is
 * not in the list, or the secret is wrong.
 */
export const REGISTRY_REFUSED_REASON =
  'the registry refused the document: the address of the proxy is not in the trust list (allowedCidrs), or the secret is wrong';

/**
 * Why the verification failed when the proxy refused the request.
 *
 * The proxy may refuse a request itself: an `ipAllowList`, a
 * `forwardAuth`, a middleware of its own. That has nothing to do with the
 * trust list of the relay, and sending the user there would send them to
 * the wrong place.
 */
export const PROXY_REFUSED_REASON =
  'the proxy refused the request (403): the middleware of the proxy did not let it through (an ipAllowList, a forwardAuth)';

/**
 * Why the verification was skipped when the proxy does not serve the
 * route.
 *
 * The wiring may not be in the proxy's configuration yet: the wizard
 * cannot apply it (§9.4), and the user has to. The chain cannot be
 * verified before that, and that is not a failure of the setup.
 */
export const NOT_SERVED_REASON = 'the proxy does not serve the route: the wiring may not be in place yet';

/**
 * The answer of the throwaway server.
 *
 * The public URL has to answer with it: something else may answer a
 * request for a route with a successful response (the dashboard of the
 * proxy does), and that is not the route.
 */
export const THROWAWAY_MARKER = 'gatewarden setup check';

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
    /** The port every entry point of the proxy answers on. */
    entryPointPorts?: Record<string, number>;
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
    /**
     * The values that were not written: they are the built-in defaults,
     * and the defaults belong to the package (§3.2).
     */
    omitted: string[];
    zone: string;
    entryPoints: string[];
    certResolver: string;
    middlewareProvider: string;
    advertisedHost: string;
    /**
     * The sources that may talk to the gateway: the proxy that polls
     * the document and sends the dispatch header.
     */
    allowedCidrs: string[];
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
  daemon: { running: boolean; pid: number | null; restarted?: boolean; error?: string };
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
 * The endpoints of this machine the proxy may point at.
 *
 * The machine is known by more than one name: the advertised host name and
 * the advertised IP. The proxy may reach it by either of them, and a name
 * that resolves to an address is the same machine as that address.
 *
 * The ports are the ones the gateway serves on: the relay, which the
 * proxy's services point at, and the registry, which the proxy's HTTP
 * provider polls.
 */
export function expectedEndpoints(config: Config): string[] {
  const hosts = [config.advertisedHost, config.advertisedIp].filter(
    (host): host is string => typeof host === 'string' && host.length > 0,
  );
  const ports = [config.relayPort, config.registryPort];
  return [...new Set(hosts.flatMap((host) => ports.map((port) => `http://${host}:${port}`)))];
}

/** The directory the wiring is written to (§9.4). */
export function wiringDir(stateDir: string): string {
  return path.join(stateDir, 'wiring');
}

/** Is the address a loopback address? */
function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized.startsWith('::ffff:')) return isLoopbackAddress(normalized.slice('::ffff:'.length));
  return normalized.startsWith('127.');
}

/**
 * The value of a promise, or nothing when it takes too long.
 *
 * A name that does not resolve can keep a lookup busy for a long time.
 * The wizard asks a question about it, and a wizard that hangs is a
 * wizard that hangs.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`the lookup took more than ${ms} ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The addresses of the proxy, as far as the wizard can tell.
 *
 * The wizard talks to the proxy's API at a URL, and the host of that URL
 * is the proxy. The proxy is the one that sends the dispatch header to
 * the relay, so the relay has to accept its addresses. A proxy on the
 * loopback address needs nothing: the loopback is allowed already.
 */
export async function proxyAddresses(apiBaseUrl: string | undefined): Promise<string[]> {
  if (!apiBaseUrl) return [];
  let host: string;
  try {
    host = new URL(apiBaseUrl).hostname;
  } catch {
    return [];
  }
  if (!host || host === 'localhost') return [];
  try {
    const found = await withTimeout(dns.lookup(host, { all: true }), 2000);
    return found.map((entry) => entry.address).filter((address) => !isLoopbackAddress(address));
  } catch {
    return [];
  }
}

/** The CIDR that holds exactly one address. */
export function cidrOf(address: string): string {
  return address.includes(':') ? `${address}/128` : `${address}/32`;
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
  /** The timers of the questions that are waiting for an answer. */
  private readonly timers = new Set<NodeJS.Timeout>();
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
   * runs out, the fallback is used and the wizard says that it did — the
   * question was not answered, and the value that is kept is a value
   * nobody confirmed.
   */
  async ask(question: string, fallback: string, timeoutMs: number): Promise<{ answer: string; timedOut: boolean }> {
    // A value that is not set has no name in the question: "(none)" says
    // that there is nothing to keep, where an empty bracket says nothing.
    this.rl.setPrompt(`${question} [${fallback || 'none'}]: `);
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
        this.timers.delete(timer);
        resolve(line);
      };
      const timer = setTimeout(() => {
        expired = true;
        this.timers.delete(timer);
        this.discardNext = true;
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        resolve(null);
      }, timeoutMs);
      // The timer is not unref'd: the timeout is the promise the wizard
      // waits for, and a program that has nothing else pending has to
      // reach it.
      this.timers.add(timer);
      this.waiting.push(waiter);
    });
  }

  /** Close the terminal. */
  close(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
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
    daemonRunning: status.running,
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
  const apiBaseUrl = opts.apiBaseUrl ?? adapter.defaultApiBaseUrl;
  const discovered = await adapter.discover({
    apiBaseUrl,
    expectEndpoints: expectedEndpoints(config),
  });
  const proxy: SetupReport['proxy'] = {
    id: proxyId,
    reachable: discovered !== undefined,
    version: discovered?.version,
    apiBaseUrl: apiBaseUrl ?? '(the default of the adapter)',
    zone: discovered?.derived.zone,
    entryPoints: discovered?.derived.entryPoints,
    entryPointPorts: discovered?.derived.entryPointPorts,
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
   * Where the advertised host comes from.
   *
   * The address that was detected is not a value the user configured: it
   * is derived from the network interfaces of this machine, and it goes
   * stale when the machine gets another address. It is therefore not
   * written to the configuration file: the file holds an empty value,
   * which means "derived" (§3.2).
   */
  const advertisedOrigin = (value: string): string => {
    if (!value) return 'the default';
    if (value === config.advertisedIp) return 'the default';
    return origin(value, DEFAULT_CONFIG.advertisedHost);
  };

  /**
   * The string of a value, or the empty string.
   *
   * The configuration file is written by hand as often as by the wizard,
   * and a hand-written file may hold a value of any type. The wizard
   * asks about strings and lists: a value of another type is no value.
   */
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');

  /**
   * The strings of a list, or the empty list.
   */
  const texts = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

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
      if (answer.timedOut) {
        // Nobody answered: the value that is kept is a value nobody
        // confirmed, exactly like in a run without anybody to ask (§9.2).
        sources[name] = origin(current, fallback);
        unconfirmed.push(name);
        return current;
      }
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
    proxy.zone ?? zoneOf(config),
    DEFAULT_CONFIG.zone,
    proxy.zone !== undefined,
  );

  if (proxy.entryPoints !== undefined && proxy.entryPoints.length > 0) {
    config.entryPoints = proxy.entryPoints;
    sources['entryPoints'] = 'the proxy';
  } else if (interactive && prompter) {
    const current = texts(config.entryPoints).join(', ');
    const answer = await prompter.ask('   the entry points the routers attach to (comma separated)', current, promptTimeoutMs);
    if (answer.timedOut) {
      // Nobody answered: the value that is kept is a value nobody
      // confirmed (§9.2).
      sources['entryPoints'] = origin(texts(config.entryPoints), DEFAULT_CONFIG.entryPoints);
      unconfirmed.push('entryPoints');
    } else {
      const parsed = answer.answer
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (parsed.length > 0) config.entryPoints = parsed;
      sources['entryPoints'] = answer.answer === current ? origin(texts(config.entryPoints), DEFAULT_CONFIG.entryPoints) : 'the user';
    }
  } else {
    sources['entryPoints'] = origin(texts(config.entryPoints), DEFAULT_CONFIG.entryPoints);
    unconfirmed.push('entryPoints');
  }

  config.certResolver = await settle(
    'certResolver',
    '   the certificate resolver (empty means no TLS block)',
    proxy.certResolver ?? text(config.certResolver),
    DEFAULT_CONFIG.certResolver,
    proxy.certResolver !== undefined,
  );

  config.middlewareProvider = await settle(
    'middlewareProvider',
    '   the proxy provider that owns the shared middlewares',
    proxy.middlewareProvider ?? text(config.middlewareProvider),
    DEFAULT_CONFIG.middlewareProvider,
    proxy.middlewareProvider !== undefined,
  );

  // The trust list: the sources that may talk to the gateway (§9.2).
  // The proxy is the one that polls the document and sends the dispatch
  // header, and the wizard knows where the proxy is: its API answered
  // there. The addresses of the proxy are therefore part of the list;
  // the user may add more.
  const proxyCidrs = (await proxyAddresses(apiBaseUrl)).map(cidrOf);
  // The IPv6 prefixes of this machine's own networks are derived at
  // runtime: they are not part of the list the user is asked about, and
  // they do not go stale in the configuration file.
  const allowed = texts(config.allowedCidrs);
  const derivedIpv6 = allowed.filter(
    (cidr) => cidr.includes(':') && !DEFAULT_CONFIG.allowedCidrs.includes(cidr),
  );
  const currentCidrs = allowed.filter(
    (cidr) => !cidr.includes(':') || DEFAULT_CONFIG.allowedCidrs.includes(cidr),
  );
  const suggestedCidrs = [...new Set([...currentCidrs, ...proxyCidrs])];

  /**
   * Where the trust list came from.
   *
   * The list that is written holds the offered list and the answer: the
   * addresses of the proxy are in it, and so is everything the user
   * added. The label names the source that has something to show.
   */
  const trustSource = (answer: string): string => {
    const parsed = answer
      .split(',')
      .map((cidr) => cidr.trim())
      .filter((cidr) => cidr.length > 0);
    if (parsed.some((cidr) => !suggestedCidrs.includes(cidr))) return 'the user';
    if (proxyCidrs.length > 0) return 'the proxy';
    return origin(currentCidrs, DEFAULT_CONFIG.allowedCidrs);
  };

  if (interactive && prompter) {
    const answer = await prompter.ask(
      '   the addresses that may talk to the gateway: the proxy that polls the document and sends the dispatch header (comma separated CIDRs, added to the ones already allowed)',
      suggestedCidrs.join(', '),
      promptTimeoutMs,
    );
    if (answer.timedOut) {
      // Nobody answered: the value that is kept is a value nobody
      // confirmed (§9.2).
      sources['allowedCidrs'] = origin(currentCidrs, DEFAULT_CONFIG.allowedCidrs);
      unconfirmed.push('allowedCidrs');
    } else {
      const parsed = answer.answer
        .split(',')
        .map((cidr) => cidr.trim())
        .filter((cidr) => cidr.length > 0);
      // The answer adds to the list that was offered. A wizard that
      // replaced what it offered would take the loopback away from
      // somebody who typed a list of their own, and the relay would
      // answer 403 to every request of the proxy: the routes would break
      // without a word about the trust list.
      config.allowedCidrs = [...new Set([...suggestedCidrs, ...parsed, ...derivedIpv6])];
      sources['allowedCidrs'] = trustSource(answer.answer);
    }
  } else if (proxyCidrs.length > 0) {
    // Nobody to ask, but the proxy answered at an address of its own:
    // that address is a source of the dispatch header.
    config.allowedCidrs = [...new Set([...suggestedCidrs, ...derivedIpv6])];
    sources['allowedCidrs'] = 'the proxy';
  } else {
    sources['allowedCidrs'] = origin(currentCidrs, DEFAULT_CONFIG.allowedCidrs);
    unconfirmed.push('allowedCidrs');
  }

  // The host name the proxy reaches this machine under is not something the
  // proxy's API says: it is this machine's own name. It is asked for when
  // there is somebody to ask, because the wiring is written with it, and
  // it is reported as unconfirmed when there is not (§9.2).
  if (interactive && prompter) {
    const current = config.advertisedHost || config.advertisedIp;
    const answer = await prompter.ask('   the host name the proxy reaches this machine under', current, promptTimeoutMs);
    if (answer.timedOut) {
      // Nobody answered: the value that is kept is a value nobody
      // confirmed (§9.2).
      sources['advertisedHost'] = advertisedOrigin(current);
      unconfirmed.push('advertisedHost');
    } else {
      config.advertisedHost = answer.answer;
      sources['advertisedHost'] = answer.answer === current ? advertisedOrigin(current) : 'the user';
    }
  } else {
    sources['advertisedHost'] = advertisedOrigin(config.advertisedHost || config.advertisedIp);
    unconfirmed.push('advertisedHost');
  }
  prompter?.close();

  // The values the configuration gets, and where every one of them came
  // from. The user reads this before the daemon serves anything.
  log('   the values');
  log(`   zone:           ${zoneOf(config) || '(none)'}`);
  log(`   entry points:   ${texts(config.entryPoints).join(', ') || '(none)'}`);
  log(`   cert resolver:  ${text(config.certResolver) || '(none)'}`);
  log(`   middleware:     ${text(config.middlewareProvider) || '(none)'}`);
  log(`   allowed cidrs:  ${texts(config.allowedCidrs).join(', ') || '(none)'}`);
  log(`   advertised host:${text(config.advertisedHost) || '(none)'}`);

  // Step three: is the proxy already wired? (§9.3).
  const wired = discovered?.wired === true;
  log('3. wiring');
  log(
    wired
      ? '   the proxy already points at this machine'
      : '   the proxy has no route of this machine yet (the wiring may be in place already)',
  );

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

  // The configuration the daemon serves is the one the wizard just
  // wrote: a daemon that runs with the old configuration serves the old
  // document, and the verification of §9.5 would check the old
  // configuration. The daemon is therefore restarted. The routes live in
  // the route store, not in the daemon, so a restart does not lose them.
  //
  // The values that are the built-in default are not written: the file
  // holds what belongs to this installation, and the default belongs to
  // the package (§3.2). A new installation would otherwise get the zone
  // of another project in its configuration file.
  const omitted = Object.keys(sources).filter((name) => sources[name] === 'the default');
  writeConfigFile(opts.configPath, config, { omit: omitted });
  const daemon = await startDaemonWith(config, opts.configPath);
  if (daemon.error) {
    log(`   the daemon was not restarted: ${daemon.error}`);
  }

  // Step five: verify end to end (§9.5).
  log('5. end-to-end verification');
  const verification = await verifyEndToEnd({
    config,
    proxyReachable: discovered !== undefined,
    enabled: opts.verify !== false,
    pollIntervalMs: opts.pollIntervalMs ?? 3000,
    entryPointPorts: proxy.entryPointPorts,
    logFile: opts.paths.logFile,
    knowsRoute: async () => {
      // The proxy is asked again: does it point at this machine? The
      // throwaway route is still registered when the question is asked.
      const again = await adapter.discover({
        apiBaseUrl,
        expectEndpoints: expectedEndpoints(config),
      });
      return again?.wired === true;
    },
    onStep: (step) => log(`   ${step.ok ? 'ok' : 'failed'}  ${step.name}: ${step.detail}`),
  });
  log(`   ${verification.status}${verification.reason ? `: ${verification.reason}` : ''}`);

  // Step six: the configuration and the daemon (§9.6). Both are in place:
  // they were needed for the verification.
  log('6. configuration and daemon');
  log(`   configuration:  ${opts.configPath}`);
  log(
    `   daemon:         ${
      daemon.error
        ? `not started (${daemon.error})`
        : `${daemon.restarted ? 'restarted' : 'running'} (pid ${daemon.pid})`
    }`,
  );

  const nextSteps: string[] = [];
  if (!zoneOf(config)) {
    // Without a zone there is no host name: no route, no public URL.
    nextSteps.push(
      `set the DNS zone in ${opts.configPath}, or run the setup again where the proxy answers: the host names are built from it`,
    );
  }
  if (!wired && wiring) {
    // The wiring may already be in the proxy: a proxy that polls the
    // gateway has no route of ours to show before the first one is
    // registered. The advice says so instead of sending the user after
    // a wiring that is already there.
    nextSteps.push(
      `add the wiring from ${wiring.path} to the proxy's static configuration, if it is not there already`,
    );
  }
  if (unconfirmed.length > 0) {
    nextSteps.push(
      `confirm ${unconfirmed.join(', ')}: run "gatewarden setup" again, or write them in ${opts.configPath}`,
    );
  }
  if (verification.status === 'skipped' && verification.reason === NO_PROXY_REASON) {
    nextSteps.push('run the setup again once the proxy has the wiring: the verification needs a proxy that answers');
  } else if (verification.status === 'skipped' && verification.reason === NOT_SERVED_REASON) {
    nextSteps.push(
      'the proxy does not serve the route: add the wiring, and check that the entry points of the proxy are the ones the routes attach to',
    );
  } else if (verification.status === 'skipped' && verification.reason === NOT_FETCHABLE_REASON) {
    nextSteps.push(
      'the public URL could not be fetched: check that the zone of the installation resolves, and that the proxy serves it',
    );
  } else if (verification.status === 'failed' && verification.reason === FORBIDDEN_REASON) {
    nextSteps.push(
      'the relay refused the request: the address of the proxy has to be in the trust list (allowedCidrs) of the configuration file',
    );
  } else if (verification.status === 'failed' && verification.reason === REGISTRY_REFUSED_REASON) {
    nextSteps.push(
      'the registry refused the document: the address of the proxy has to be in the trust list (allowedCidrs) of the configuration file, and the secret has to be the one of the installation',
    );
  } else if (verification.status === 'failed' && verification.reason === PROXY_REFUSED_REASON) {
    nextSteps.push(
      'the proxy refused the request: the middleware of the proxy (an ipAllowList, a forwardAuth) did not let the request through',
    );
  } else if (verification.status === 'failed' && verification.reason?.startsWith(HTTP_ERROR_REASON)) {
    nextSteps.push(
      'the public URL answered with an error: the proxy has to serve the route, and the answer it gave has to be looked at',
    );
  } else if (verification.status === 'failed') {
    nextSteps.push(
      'the public URL did not answer: the proxy has to route the route, and the certificate of the public URL has to be trusted by this machine',
    );
  }
  nextSteps.push('run "gatewarden install-service" so the daemon survives a reboot');

  return {
    environment,
    proxy,
    wired,
    wiring,
    verification,
    config: {
      path: opts.configPath,
      written: true,
      omitted,
      zone: zoneOf(config),
      entryPoints: texts(config.entryPoints),
      certResolver: text(config.certResolver),
      middlewareProvider: text(config.middlewareProvider),
      advertisedHost: text(config.advertisedHost),
      allowedCidrs: texts(config.allowedCidrs),
      sources,
      unconfirmed,
    },
    daemon: { running: !daemon.error, pid: daemon.pid, restarted: daemon.restarted, error: daemon.error },
    nextSteps,
  };
}

/**
 * Start the daemon with the configuration the wizard just wrote.
 *
 * A daemon that is already running serves the configuration it was
 * started with. The wizard has written a new one, so a running daemon is
 * stopped first: otherwise the document the proxy polls is the old one,
 * and the verification of §9.5 would check the old configuration.
 */
async function startDaemonWith(
  config: Config,
  configPath: string,
): Promise<{ running: boolean; pid: number | null; restarted: boolean; error?: string }> {
  const before = await daemonStatus(config);
  if (before.running && before.pid !== null) {
    const stopped = await stopDaemon(config);
    if (!stopped.stopped) {
      return {
        running: true,
        pid: before.pid,
        restarted: false,
        error: stopped.error ?? 'the daemon did not stop',
      };
    }
  }
  const started = await ensureDaemon(config, { configPath });
  return {
    running: !started.error,
    pid: started.pid,
    restarted: before.running,
    error: started.error,
  };
}

interface VerifyOptions {
  config: Config;
  proxyReachable: boolean;
  enabled: boolean;
  pollIntervalMs: number;
  /** The port every entry point of the proxy answers on. */
  entryPointPorts?: Record<string, number>;
  /** The log file of the daemon: it says what the registry refused. */
  logFile?: string;
  /**
   * Does the proxy know about the routes of this machine?
   *
   * It is asked after the public URL did not answer: a proxy that does
   * not know the route has not picked up the wiring yet, and a proxy
   * that knows it serves it in some other way (over TLS, say).
   */
  knowsRoute?: () => Promise<boolean>;
  /** Called for every step, as it happens (§9.5). */
  onStep?: (step: VerificationStep) => void;
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
  const record = (step: VerificationStep): void => {
    steps.push(step);
    opts.onStep?.(step);
  };
  if (!opts.enabled) {
    return { status: 'skipped', reason: 'the verification was turned off', steps };
  }
  if (!opts.proxyReachable) {
    return { status: 'skipped', reason: NO_PROXY_REASON, steps };
  }
  if (!zoneOf(opts.config)) {
    // The host names are built from the zone. Without one there is no
    // public URL to fetch, and the throwaway route would be a host name
    // with a trailing dot.
    return { status: 'skipped', reason: NO_ZONE_REASON, steps };
  }

  const project = 'gatewarden-setup';
  const branch = 'check';
  const zone = zoneOf(opts.config);
  const fqdn = buildFqdn(project, branch, zone);
  const store = new RegistrationStore(opts.config.stateDir);
  // A route of the user may have the same name: it is put back when the
  // verification is done.
  const previous = store.findByProjectBranch(project, branch);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`${THROWAWAY_MARKER}\n`);
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
    record({ name: 'throwaway server', ok: true, detail: `127.0.0.1:${port}` });

    await withRouteLock(opts.config.stateDir, () =>
      store.upsert({ project, branch, devPort: port, zone }),
    );
    record({ name: 'route registered', ok: true, detail: fqdn });

    await sleep(opts.pollIntervalMs);

    // The proxy serves a route only after it has polled the document
    // that carries it. One fetch after a fixed wait is a race with that
    // poll, and a race does not belong in a verification: the URL is
    // fetched until it answers, or until the deadline says that it will
    // not.
    //
    // The wait does not end early when the proxy is wired. Being wired
    // says that the proxy polls this machine at all — not that it has
    // polled the route yet, and not that it serves it on the next
    // request. The verdict is made when the wait is over.
    const deadline = Date.now() + Math.min(Math.max(opts.pollIntervalMs * 2 + 2000, 3000), 20000);
    let fetched = await fetchPublicUrl(fqdn, publicUrlPorts(opts));
    while (!fetched.ok && fetched.notFound && Date.now() < deadline) {
      await sleep(250);
      fetched = await fetchPublicUrl(fqdn, publicUrlPorts(opts));
    }
    record({ name: 'public URL', ok: fetched.ok, detail: fetched.detail });

    if (fetched.ok) return { status: 'verified', steps };
    if (fetched.forbidden) {
      // The relay refused the request. The address of the proxy is not
      // in the trust list, or the secret is wrong. The trust list is the
      // usual reason, and the refusal is not a certificate problem.
      return {
        status: 'failed',
        reason: FORBIDDEN_REASON,
        steps,
      };
    }
    if (fetched.refusedByProxy) {
      // The proxy refused the request itself: an ipAllowList, a
      // forwardAuth, a middleware of its own. The trust list of the
      // relay has nothing to do with it.
      return {
        status: 'failed',
        reason: PROXY_REFUSED_REASON,
        steps,
      };
    }
    if (fetched.httpError) {
      // The chain answered, and the answer was an error. The answer is
      // the reason: a port that speaks plain HTTP is not a certificate
      // the machine does not trust.
      return {
        status: 'failed',
        reason: `${HTTP_ERROR_REASON}: ${fetched.httpError}`,
        steps,
      };
    }
    if (fetched.notFound) {
      // The proxy knows the URL and does not serve it. Does it know the
      // route? A proxy that does not know it has not picked up the
      // wiring yet — the wizard cannot apply the wiring (§9.4), and the
      // user has to. That is not a failed setup. A proxy that knows the
      // route and does not serve it over plain HTTP serves it in some
      // other way, and that is a failure.
      const knows = opts.knowsRoute ? await opts.knowsRoute() : false;
      if (knows) {
        return {
          status: 'failed',
          reason: 'the proxy knows the route but does not serve it',
          steps,
        };
      }
      // The proxy knows nothing of our routes because the registry
      // never gave it any: it refused the poll of the proxy. The
      // registry writes every refusal down, and the log is where the
      // answer is — without it the wizard would blame the wiring for a
      // trust list that is the cause.
      if (opts.logFile && registryRefusedDocument(opts.logFile)) {
        return {
          status: 'failed',
          reason: REGISTRY_REFUSED_REASON,
          steps,
        };
      }
      return { status: 'skipped', reason: NOT_SERVED_REASON, steps };
    }
    if (fetched.certificateFailure) {
      // The chain answered, and its certificate is not one this machine
      // trusts. That is an error of the installation: the certificate
      // has to be trusted before the route can be opened.
      return {
        status: 'failed',
        reason: fetched.certificateFailure,
        steps,
      };
    }
    if (!fetched.answered) {
      // Nothing answered at all: the name does not resolve, or nothing
      // listens on the port. The verification could not run — it is not
      // a chain that answered with an error.
      return { status: 'skipped', reason: NOT_FETCHABLE_REASON, steps };
    }
    return { status: 'failed', steps };
  } catch (error) {
    record({ name: 'throwaway server', ok: false, detail: (error as Error).message });
    return { status: 'failed', reason: (error as Error).message, steps };
  } finally {
    await withRouteLock(opts.config.stateDir, () => store.remove(project, branch));
    if (previous) {
      // The route of the user is back where it was.
      await withRouteLock(opts.config.stateDir, () =>
        store.upsert({
          project: previous.project,
          branch: previous.branch,
          devPort: previous.devPort,
          label: previous.label,
          zone,
        }),
      );
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    record({ name: 'cleaned up', ok: true, detail: 'the route was removed and the server stopped' });
  }
}

/**
 * The ports the public URL of a route may be served on.
 *
 * The ports of the entry points the routes attach to. The standard ports
 * are left out: the URL without a port is one of them.
 *
 * Only the entry points the routes attach to are looked at. The other
 * ports of the proxy are not tried: the API of Traefik answers on one of
 * them, and its dashboard would answer a request for a route with a
 * successful response.
 */
function publicUrlPorts(opts: VerifyOptions): number[] {
  const ports = opts.entryPointPorts ?? {};
  const wanted = opts.config.entryPoints
    .map((name) => ports[name])
    .filter((port): port is number => typeof port === 'number');
  return [...new Set(wanted)].filter((port) => port !== 443 && port !== 80);
}

/**
 * Fetch the public URL of a route (§9.5).
 *
 * The URL is the host name the route is served under. HTTPS is tried
 * first; a proxy that serves the zone over plain HTTP answers the second
 * try. The port of the entry point the routes attach to is tried as well:
 * a proxy that serves them on another port (8443, say) needs the port in
 * the URL, and nobody can guess it.
 *
 * Every attempt is reported: a URL that did not answer is a fact the
 * user needs, not something to hide behind a verdict.
 *
 * The report says whether the chain answered at all (`answered`) and
 * whether the certificate was the problem (`certificateFailure`). The
 * verification needs both: a chain that answered with an error is a
 * failed setup, and a chain that was never reached is a verification that
 * could not run.
 */
async function fetchPublicUrl(
  fqdn: string,
  ports: number[] = [],
): Promise<{
  ok: boolean;
  detail: string;
  notFound: boolean;
  forbidden: boolean;
  refusedByProxy: boolean;
  answered: boolean;
  certificateFailure?: string;
  httpError?: string;
}> {
  const details: string[] = [];
  const candidates: string[] = [];

  for (const scheme of ['https', 'http']) {
    candidates.push(`${scheme}://${fqdn}`);
    for (const port of ports) candidates.push(`${scheme}://${fqdn}:${port}`);
  }

  /** The certificate of the public URL, when it is not trusted. */
  let certificateFailure: string | undefined;
  /** Did the proxy answer that it does not know the host name? */
  let notFound = false;
  /** Did the relay refuse the request? */
  let forbidden = false;
  /** Did the proxy refuse the request itself? */
  let refusedByProxy = false;
  /** Did anything answer at all? */
  let answered = false;
  /** The answer of a request that got an error, when there was one. */
  let httpError: string | undefined;

  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      answered = true;
      const status = `${response.status} ${response.statusText}`.trim();
      if (response.status === 404) {
        // The proxy knows the URL and does not serve it.
        notFound = true;
        details.push(`${url} — ${status}`);
        continue;
      }
      if (response.status === 403) {
        // Who refused? The gateway refuses with a body of its own, and
        // it says why: the trust list or the secret. A proxy that
        // refuses in front of it has a body of its own, and the cause is
        // somewhere else entirely. The bodies are the ones of the core
        // (`isGatewayRefusal`), so that the two cannot drift apart.
        const body = await response.text().catch(() => '');
        if (isGatewayRefusal(body)) {
          forbidden = true;
          details.push(`${url} — ${status}: the relay refused the request`);
        } else {
          refusedByProxy = true;
          details.push(`${url} — ${status}: the proxy refused the request`);
        }
        continue;
      }
      if (!response.ok) {
        // The chain answered, and the answer was an error. That is the
        // reason — not the certificate of the attempts that never got
        // that far.
        httpError = httpError ?? status;
        details.push(`${url} — ${status}`);
        continue;
      }
      const body = await response.text();
      if (!body.includes(THROWAWAY_MARKER)) {
        // Something answered, but it is not the throwaway server: the
        // dashboard of the proxy answers a request for a route as well.
        details.push(`${url} — ${status}, but the answer is not the one of the throwaway server`);
        continue;
      }
      if (url.startsWith('http://') && certificateFailure) {
        // The public URL is served over HTTPS and its certificate is not
        // trusted. A plain HTTP answer does not make it usable, and the
        // verification of it would prove nothing.
        details.push(`${url} — ${status}, but ${certificateFailure}`);
        return {
          ok: false,
          detail: details.join('; '),
          notFound,
          forbidden,
          refusedByProxy,
          answered,
          certificateFailure,
          httpError,
        };
      }
      details.push(`${url} — ${status}`);
      return { ok: true, detail: details.join('; '), notFound, forbidden, refusedByProxy, answered, httpError };
    } catch (error) {
      const reason = describeFetchError(error);
      if (url.startsWith('https://') && reason.includes('certificate')) certificateFailure = reason;
      details.push(`${url} — ${reason}`);
    }
  }
  return {
    ok: false,
    detail: details.join('; ') || 'no URL was tried',
    notFound,
    forbidden,
    refusedByProxy,
    answered,
    certificateFailure,
    httpError,
  };
}

/**
 * The last bytes of a file.
 *
 * The log of an installation can be big, and the wizard reads the end
 * of it: the lines it needs are the ones of the daemon that runs now.
 */
function readLogTail(logFile: string, bytes: number): string {
  const fd = fs.openSync(logFile, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    if (length > 0) fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The lines the daemon that runs now has written.
 *
 * The log of an installation holds the lines of every run before it.
 * The daemon writes a line when it starts, and everything after that
 * line belongs to the run that is up.
 */
function logLinesOfTheCurrentRun(logFile: string): string[] {
  let content: string;
  try {
    content = readLogTail(logFile, 64 * 1024);
  } catch {
    return [];
  }
  const lines = content.split('\n');
  const lastStart = lines.findLastIndex((line) => line.includes('[daemon] daemon started'));
  return lastStart >= 0 ? lines.slice(lastStart + 1) : lines;
}

/**
 * Did the registry refuse the document?
 *
 * The registry answers the trust list and nobody else (D15). When the
 * poll of the proxy is refused, the proxy has no configuration, the
 * route never reaches it, and the public URL answers 404. The daemon
 * writes every refusal down, with the address it refused, so the log
 * is where the answer is.
 *
 * The probe is not the document: a refusal of the probe says that the
 * caller is not trusted either, but it is not the reason the proxy has
 * no routes.
 */
export function registryRefusedDocument(logFile: string): boolean {
  for (const line of logLinesOfTheCurrentRun(logFile)) {
    if (!line.includes('[registry] rejected request')) continue;
    if (line.includes('/healthz')) continue;
    if (!line.includes(TRUST_LIST_REFUSAL) && !line.includes(SECRET_REFUSAL)) continue;
    return true;
  }
  return false;
}

/**
 * What went wrong when a URL did not answer.
 *
 * The reasons are told apart, because they ask different things of the
 * user: a certificate that is not trusted is not a route that does not
 * work, and a name that does not resolve is not a proxy that is down.
 */
export function describeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? '';
  const detail = (cause?.message ?? message).replace(/\s+/g, ' ').trim();

  // The port speaks another protocol than the one that was asked for:
  // an HTTPS request to a plain HTTP port. That is not a certificate the
  // machine does not trust — the certificate was never seen.
  if (code === 'ERR_SSL_WRONG_VERSION_NUMBER' || /wrong version number/i.test(detail)) {
    return `the port does not speak TLS: ${detail}`;
  }
  if (/certificate|self.signed|self signed|SSL|TLS|trust/i.test(detail) || /CERT_|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
    return `the certificate of the public URL is not trusted: ${detail}`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `the name of the public URL does not resolve: ${detail}`;
  if (code === 'ECONNREFUSED') return `nothing answers at the public URL: ${detail}`;
  return detail;
}
