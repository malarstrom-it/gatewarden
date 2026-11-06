/**
 * The configuration of the test proxy (§11.2).
 *
 * The proxy is a Traefik that the test starts, with a generated static
 * configuration. It polls the gateway's registry over HTTP — the same
 * way the user's proxy polls it — and it serves the routes on an entry
 * point of its own.
 *
 * Two things are worth saying about the configuration:
 *
 * 1. The API of the proxy answers on a port of its own, and not on the
 *    default one (8080). The wizard of a live installation looks for a
 *    proxy on 8080 by default, and the test proxy must never be found
 *    there.
 * 2. The resolver `testca` is declared, because the routers the gateway
 *    generates ask for it by name. The resolver cannot do anything: the
 *    certificate of the test domain comes from the CA the test makes
 *    itself (§11.1), and the resolver points at an authority that does
 *    not answer, so it fails quietly instead of reaching out to the
 *    internet.
 */

import { TEST_CERT_RESOLVER, TEST_ENTRY_POINT, type TestEnvPaths, type TestEnvSettings } from './settings.ts';

export interface ProxyConfigInput {
  settings: TestEnvSettings;
  paths: TestEnvPaths;
}

/** The static configuration of the test proxy. */
export function traefikStaticConfig(input: ProxyConfigInput): string {
  const { settings, paths } = input;
  return [
    'log:',
    '  level: INFO',
    `  filePath: ${paths.proxyLogFile}`,
    '  format: common',
    'api:',
    // The API answers on the entry point named "traefik", and that one
    // is addressed below.
    '  insecure: true',
    '  dashboard: false',
    'entryPoints:',
    '  traefik:',
    `    address: "127.0.0.1:${settings.proxyApiPort}"`,
    `  ${TEST_ENTRY_POINT}:`,
    `    address: "127.0.0.1:${settings.proxyPort}"`,
    'providers:',
    '  http:',
    `    endpoint: "http://127.0.0.1:${settings.registryPort}/traefik"`,
    '    pollInterval: 2s',
    '  file:',
    // The certificates of the test live in this directory, and the file
    // provider is what hands them to the proxy.
    `    directory: "${paths.certsDir}"`,
    '    watch: false',
    'certificatesResolvers:',
    `  ${TEST_CERT_RESOLVER}:`,
    '    acme:',
    '      tlsChallenge: true',
    // Nothing answers here: the test does not need an authority, and it
    // does not reach out to one.
    '      caServer: "https://127.0.0.1:9/directory"',
    `      storage: "${paths.proxyDir}/acme.json"`,
    '',
  ].join('\n');
}

/**
 * The dynamic configuration that carries the certificate of the test.
 *
 * The file provider reads it, and the proxy serves the certificate for
 * the domain the routers ask for.
 */
export function certificatesDocument(certFile: string, keyFile: string): string {
  return [
    'tls:',
    '  certificates:',
    '    - certFile: ' + certFile,
    '      keyFile: ' + keyFile,
    '      stores:',
    '        - default',
    '',
  ].join('\n');
}
