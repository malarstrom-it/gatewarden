/**
 * The settings of the isolated test environment (D11, §11).
 *
 * The test environment has its own ports, its own domain, its own Traefik,
 * its own state directory and its own certificates. The values live here,
 * and every one of them can be overridden through the environment, so that
 * two runs never fight over a port.
 *
 * The defaults are the ones the specification names (§11.1):
 *
 * | | live | test |
 * | --- | --- | --- |
 * | registry port | 45002 | 46002 |
 * | relay port | 45001 | 46001 |
 * | domain | `home.malarstrom.com` | `gwtest.local` |
 * | state directory | `~/.local/state/dev-gateway/` | `/tmp/dev-gateway-test/` |
 *
 * The ports of the live system are named here as well, so that the test
 * can prove that it did not touch them: they are the ports the test must
 * never bind.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../../src/core/util/slug.ts';

/** The directory the test environment lives in. */
export const TOOLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The root of the repository. */
export const REPO_ROOT = path.resolve(TOOLS_DIR, '..');

export interface TestEnvSettings {
  /** Everything the environment writes lives under this directory. */
  root: string;
  /** The domain the routes are served under. */
  domain: string;
  /** The port the registry serves the dynamic configuration on. */
  registryPort: number;
  /** The port the relay dispatches to the dev servers on. */
  relayPort: number;
  /** The port the test proxy serves the routes on. */
  proxyPort: number;
  /** The port the test proxy answers its API on. */
  proxyApiPort: number;
  /** The version of Traefik the test downloads and runs. */
  traefikVersion: string;
  /** The project the test registers its route under. */
  project: string;
  /** The branch the test registers its route under. */
  branch: string;
  /** Where the downloaded Traefik binary is kept between the runs. */
  cacheDir: string;
  /** The ports of the live system. The test never binds them. */
  livePorts: number[];
}

/** The settings of the test environment, without any override. */
export const DEFAULT_SETTINGS: TestEnvSettings = {
  root: '/tmp/dev-gateway-test',
  domain: 'gwtest.local',
  registryPort: 46002,
  relayPort: 46001,
  proxyPort: 8443,
  proxyApiPort: 8444,
  traefikVersion: '3.7.16',
  project: 'dev-gateway-e2e',
  branch: 'main',
  cacheDir: path.join(TOOLS_DIR, 'testenv', '.cache'),
  livePorts: [45001, 45002],
};

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readPort(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = readEnv(env, name);
  if (raw === undefined) return fallback;
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} is not a port: "${raw}"`);
  }
  return port;
}

/**
 * The settings of the test environment.
 *
 * Every value has a default; the environment overrides it. The ports of
 * the live system are not overridable: they are the ports the test must
 * leave alone, and a test that could move them would prove nothing.
 */
export function testEnvSettings(env: NodeJS.ProcessEnv = process.env): TestEnvSettings {
  return {
    root: path.resolve(readEnv(env, 'DEV_GATEWAY_TESTENV_ROOT') ?? DEFAULT_SETTINGS.root),
    domain: readEnv(env, 'DEV_GATEWAY_TESTENV_DOMAIN') ?? DEFAULT_SETTINGS.domain,
    registryPort: readPort(env, 'DEV_GATEWAY_TESTENV_REGISTRY_PORT', DEFAULT_SETTINGS.registryPort),
    relayPort: readPort(env, 'DEV_GATEWAY_TESTENV_RELAY_PORT', DEFAULT_SETTINGS.relayPort),
    proxyPort: readPort(env, 'DEV_GATEWAY_TESTENV_PROXY_PORT', DEFAULT_SETTINGS.proxyPort),
    proxyApiPort: readPort(env, 'DEV_GATEWAY_TESTENV_API_PORT', DEFAULT_SETTINGS.proxyApiPort),
    traefikVersion: readEnv(env, 'DEV_GATEWAY_TESTENV_TRAEFIK_VERSION') ?? DEFAULT_SETTINGS.traefikVersion,
    project: readEnv(env, 'DEV_GATEWAY_TESTENV_PROJECT') ?? DEFAULT_SETTINGS.project,
    branch: readEnv(env, 'DEV_GATEWAY_TESTENV_BRANCH') ?? DEFAULT_SETTINGS.branch,
    cacheDir: path.resolve(readEnv(env, 'DEV_GATEWAY_TESTENV_CACHE') ?? DEFAULT_SETTINGS.cacheDir),
    livePorts: [...DEFAULT_SETTINGS.livePorts],
  };
}

/** The files and directories the environment uses. */
export interface TestEnvPaths {
  /** The configuration file of the gateway under test. */
  configFile: string;
  /** The state directory of the gateway under test. */
  stateDir: string;
  /** Where the proxy's configuration and its log live. */
  proxyDir: string;
  /** Where the certificates live. */
  certsDir: string;
  /** The static configuration of the test proxy. */
  proxyConfigFile: string;
  /** The dynamic configuration that carries the certificates. */
  certificatesFile: string;
  /** The log of the test proxy. */
  proxyLogFile: string;
}

/** The paths the environment uses, derived from its root. */
export function testEnvPaths(settings: TestEnvSettings): TestEnvPaths {
  const proxyDir = path.join(settings.root, 'proxy');
  const certsDir = path.join(settings.root, 'certs');
  return {
    configFile: path.join(settings.root, 'config.json'),
    stateDir: settings.root,
    proxyDir,
    certsDir,
    proxyConfigFile: path.join(proxyDir, 'traefik.yml'),
    certificatesFile: path.join(certsDir, 'certificates.yml'),
    proxyLogFile: path.join(proxyDir, 'traefik.log'),
  };
}

/** The public host name of the route the test registers. */
export function testRouteFqdn(settings: TestEnvSettings): string {
  return `${slugify(settings.branch)}.${slugify(settings.project)}.${settings.domain}`;
}

/** The wildcard domain the certificate has to cover (§11.1). */
export function testWildcardDomain(settings: TestEnvSettings): string {
  return `*.${slugify(settings.project)}.${settings.domain}`;
}

/** The name of the resolver the test proxy declares (§11.2). */
export const TEST_CERT_RESOLVER = 'testca';

/** The name of the entry point the routes attach to. */
export const TEST_ENTRY_POINT = 'testweb';
