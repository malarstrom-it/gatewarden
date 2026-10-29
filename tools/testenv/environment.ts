/**
 * The isolated test environment (D11, §11).
 *
 * Bringing the environment up means: a state directory of its own, a
 * configuration of its own, certificates of its own, a Traefik of its
 * own and a gateway of its own. Nothing of it is shared with the live
 * system, and nothing of the live system is touched.
 *
 * The gateway under test is the real one: the daemon of this repository,
 * started with the configuration of the test. The proxy is a real
 * Traefik, downloaded from its release.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../../src/core/types.ts';
import { loadConfig } from '../../src/core/config.ts';
import { ensureDaemon, stopDaemon } from '../../src/core/daemonControl.ts';
import { generateCertificates, type TestCertificates } from './certs.ts';
import { stopLeftovers } from './leftovers.ts';
import { certificatesDocument, traefikStaticConfig } from './proxy-config.ts';
import { portIsFree, pidsOnPort } from './ports.ts';
import {
  TEST_CERT_RESOLVER,
  TEST_ENTRY_POINT,
  testEnvPaths,
  testRouteFqdn,
  testWildcardDomain,
  type TestEnvPaths,
  type TestEnvSettings,
} from './settings.ts';
import { ensureTraefikBinary, startTraefik, stopTraefik, type TraefikProcess } from './traefik.ts';

export interface TestEnvironment {
  /** The settings the environment runs with. */
  settings: TestEnvSettings;
  /** The files the environment uses. */
  paths: TestEnvPaths;
  /** The certificates of the environment. */
  certs: TestCertificates;
  /** The test proxy. */
  proxy: TraefikProcess;
  /** The configuration of the gateway under test. */
  config: Config;
  /** What the directory of the environment held before the run. */
  ownership: Ownership;
}

/**
 * What the environment owns in its directory.
 *
 * The directory may be one the user pointed at, and it may hold files
 * that are none of the environment's business. The environment writes
 * into it and removes what it wrote; everything else stays.
 */
export interface Ownership {
  /** Did the directory exist before the run? */
  rootExisted: boolean;
  /** What the directory held before the run. */
  preexisting: string[];
  /** Did the environment add the domain to the hosts file? */
  hostsEntry: boolean;
}

/**
 * The configuration file of the gateway under test.
 *
 * Every value the test depends on is written down: the zone, the
 * domain, the resolver and the provider. The test does not lean on the
 * built-in defaults, because the defaults of the package are meant to
 * change (S12) and the test has to survive that.
 */
export function gatewayConfigFile(settings: TestEnvSettings): Record<string, unknown> {
  return {
    proxy: 'traefik',
    registryPort: settings.registryPort,
    relayPort: settings.relayPort,
    // The proxy runs on this machine, and it reaches the relay here.
    advertisedIp: '127.0.0.1',
    advertisedHost: '127.0.0.1',
    zone: settings.domain,
    entryPoints: [TEST_ENTRY_POINT],
    certResolver: TEST_CERT_RESOLVER,
    tlsMode: 'wildcard',
    securityHeaders: false,
    compressMiddleware: false,
    middlewareProvider: 'file',
    allowedCidrs: ['127.0.0.1/32', '::1/128'],
    secret: '',
    stateDir: settings.root,
    documentFormat: 'yaml',
    logMaxBytes: 1024 * 1024,
    logKeep: 2,
    // The test starts the daemon itself.
    autostart: false,
  };
}

/** Wait until a URL answers, or until the deadline says that it will not. */
export async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/** The hosts file of the machine. */
const HOSTS_FILE = '/etc/hosts';

/** Is the hosts file writable by this process? */
export function hostsFileWritable(): boolean {
  try {
    fs.accessSync(HOSTS_FILE, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make the domain of the test resolvable.
 *
 * The name of the route has to resolve for a client that asks for it by
 * name — the setup wizard does (§9.5). The hosts file is the way, and
 * only a process that may write it can do it: the test says so when it
 * cannot.
 */
export function addHostEntry(domain: string): boolean {
  if (!hostsFileWritable()) return false;
  let text: string;
  try {
    text = fs.readFileSync(HOSTS_FILE, 'utf8');
  } catch {
    return false;
  }
  const line = `127.0.0.1 ${domain}`;
  if (text.split('\n').some((entry) => entry.trim() === line)) return true;
  try {
    fs.appendFileSync(HOSTS_FILE, `\n${line} # dev-gateway test environment\n`);
  } catch {
    return false;
  }
  return true;
}

/** Remove the entry of the test domain from the hosts file. */
export function removeHostEntry(domain: string): void {
  if (!hostsFileWritable()) return;
  try {
    const text = fs.readFileSync(HOSTS_FILE, 'utf8');
    const kept = text
      .split('\n')
      .filter((entry) => !entry.includes(` ${domain} # dev-gateway test environment`))
      .join('\n');
    fs.writeFileSync(HOSTS_FILE, kept);
  } catch {
    // the hosts file belongs to the machine, not to the test
  }
}

/**
 * The names the environment uses in its directory.
 *
 * The environment owns these names: it writes them, and it removes
 * them again — also when a run that was interrupted left them behind.
 * Every other name in the directory belongs to whoever put it there.
 */
export const ENVIRONMENT_FILES = [
  'config.json',
  'daemon.pid',
  'daemon.log',
  'routes.json',
  'routes.json.lock',
  'proxy',
  'certs',
];

/**
 * Remove what the environment wrote in its directory.
 *
 * Only the entries that were not there before the run are removed, and
 * the entries that carry one of the names of the environment: the files
 * of the user stay where they are, and the directory itself is left
 * alone unless the environment created it and it is empty.
 */
export function cleanupEnvironment(root: string, ownership: Ownership): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(root)) return removed;
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return removed;
  }
  for (const entry of entries) {
    const ours = !ownership.preexisting.includes(entry) || ENVIRONMENT_FILES.includes(entry);
    if (!ours) continue;
    try {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
      removed.push(entry);
    } catch {
      // the file stays; it is not ours to remove
    }
  }
  if (!ownership.rootExisted) {
    try {
      // Only an empty directory goes: the directory of the user stays.
      fs.rmdirSync(root);
    } catch {
      // there is something in it that is not ours
    }
  }
  return removed;
}

/**
 * Bring the environment up.
 *
 * The ports of the environment have to be free: a port that is taken
 * belongs to another run, and the test would measure that one.
 */
export async function bringUp(
  settings: TestEnvSettings,
  log: (line: string) => void = () => {},
): Promise<TestEnvironment> {
  const paths = testEnvPaths(settings);

  // A run that was interrupted leaves the proxy and the daemon running,
  // and they hold the ports of the environment. They are stopped here,
  // so that the one command can always come up again.
  await stopLeftovers(settings, log);

  const taken: number[] = [];
  for (const port of [settings.registryPort, settings.relayPort, settings.proxyPort, settings.proxyApiPort]) {
    if (!portIsFree(port)) taken.push(port);
  }
  if (taken.length > 0) {
    const holders = taken
      .map((port) => `${port} (pid ${pidsOnPort(port).join(', ') || 'unknown'})`)
      .join(', ');
    throw new Error(`the ports ${holders} are in use by something that is not the test environment`);
  }

  const rootExisted = fs.existsSync(settings.root);
  const preexisting = rootExisted ? fs.readdirSync(settings.root) : [];
  fs.mkdirSync(settings.root, { recursive: true });
  fs.mkdirSync(paths.proxyDir, { recursive: true });
  fs.mkdirSync(paths.certsDir, { recursive: true });

  const certs = generateCertificates(paths.certsDir, [
    settings.domain,
    `*.${settings.domain}`,
    testWildcardDomain(settings),
    testRouteFqdn(settings),
  ]);
  log(`certificates: ${certs.caFile} (the certificate covers ${settings.domain})`);

  // The daemon and every child of it trust the authority of the test,
  // and so does this process: a client that asks for the public URL by
  // name trusts the certificate of the test.
  process.env['NODE_EXTRA_CA_CERTS'] = certs.caFile;

  fs.writeFileSync(paths.configFile, JSON.stringify(gatewayConfigFile(settings), null, 2) + '\n');
  fs.writeFileSync(paths.proxyConfigFile, traefikStaticConfig({ settings, paths }));
  fs.writeFileSync(paths.certificatesFile, certificatesDocument(certs.certFile, certs.keyFile));
  log(`configuration: ${paths.configFile}`);
  log(`proxy configuration: ${paths.proxyConfigFile}`);

  const hostsEntry = addHostEntry(settings.domain);
  log(
    hostsEntry
      ? `the domain ${settings.domain} resolves to 127.0.0.1 (the hosts file)`
      : `the domain ${settings.domain} does not resolve: the hosts file cannot be written by this process`,
  );

  const binary = await ensureTraefikBinary(settings.cacheDir, settings.traefikVersion, log);
  const proxy = startTraefik(binary, paths.proxyConfigFile, paths.proxyLogFile, paths.proxyDir);
  log(`the test proxy runs (pid ${proxy.pid})`);

  const apiUp = await waitForHttp(`http://127.0.0.1:${settings.proxyApiPort}/api/version`, 20_000);
  if (!apiUp) {
    await stopTraefik(proxy);
    throw new Error(`the test proxy did not answer its API (see ${paths.proxyLogFile})`);
  }

  const config = loadConfig({ configPath: paths.configFile, stateDir: paths.stateDir, migrate: false });
  const started = await ensureDaemon(config, { configPath: paths.configFile, timeoutMs: 30_000 });
  if (started.error) {
    // The daemon may be running even though it did not answer: it is
    // stopped here, so that it does not hold the ports of the next run.
    await stopDaemon(config);
    await stopTraefik(proxy);
    throw new Error(`${started.error} (see ${paths.stateDir}/daemon.log)`);
  }
  log(`the gateway under test runs (pid ${started.pid})`);

  return { settings, paths, certs, proxy, config, ownership: { rootExisted, preexisting, hostsEntry } };
}

/**
 * Tear the environment down.
 *
 * The gateway is stopped through the product's own function, so that the
 * daemon removes its own pidfile, and the proxy is stopped as a child of
 * the test.
 */
export async function tearDown(
  env: TestEnvironment,
  log: (line: string) => void = () => {},
): Promise<void> {
  const stopped = await stopDaemon(env.config);
  log(stopped.stopped ? 'the gateway under test is stopped' : 'the gateway under test was not running');
  await stopTraefik(env.proxy);
  log('the test proxy is stopped');
  if (env.ownership.hostsEntry) {
    removeHostEntry(env.settings.domain);
    log(`the domain ${env.settings.domain} is removed from the hosts file`);
  }
  if (process.env['DEV_GATEWAY_TESTENV_KEEP'] === '1') {
    log(`the directory ${env.settings.root} is kept`);
    return;
  }
  // Only what the environment wrote is removed. The files of the user
  // stay where they are, and so does the directory itself when it is
  // not empty afterwards.
  const removed = cleanupEnvironment(env.settings.root, env.ownership);
  log(
    removed.length > 0
      ? `the files of the environment are removed from ${env.settings.root} (${removed.join(', ')})`
      : `there was nothing of the environment left in ${env.settings.root}`,
  );
}
