/**
 * The test environment, without the network and without a proxy.
 *
 * The end-to-end test itself lives in `tools/testenv/` and runs with
 * `npm run test:e2e`: it downloads Traefik and starts it, and that does
 * not belong in a suite that runs on every change. What is checked here
 * is the part that can be checked everywhere: the settings of the
 * environment, the configuration it generates, and the isolation rules
 * it follows.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { gatewayConfigFile, cleanupEnvironment } from '../tools/testenv/environment.ts';
import { classifyCmdline } from '../tools/testenv/leftovers.ts';
import { certificatesDocument, traefikStaticConfig } from '../tools/testenv/proxy-config.ts';
import { extractFromTarGz, sha256, binaryPath } from '../tools/testenv/traefik.ts';
import { pidsOnPort, portIsFree, snapshotOf, snapshotsAreEqual } from '../tools/testenv/ports.ts';
import {
  DEFAULT_SETTINGS,
  testEnvPaths,
  testEnvSettings,
  testRouteFqdn,
  testWildcardDomain,
} from '../tools/testenv/settings.ts';

test('the settings of the test environment are the ones of the specification', () => {
  const settings = testEnvSettings({});
  assert.equal(settings.domain, 'gwtest.local');
  assert.equal(settings.registryPort, 46002);
  assert.equal(settings.relayPort, 46001);
  assert.equal(settings.root, '/tmp/dev-gateway-test');
  assert.equal(settings.traefikVersion, '3.7.16');
});

test('the settings of the test environment are not the ones of the live system', () => {
  const settings = testEnvSettings({});
  assert.notEqual(settings.registryPort, 45002);
  assert.notEqual(settings.relayPort, 45001);
  assert.notEqual(settings.domain, 'home.malarstrom.com');
  // The live ports are the ones the test must not bind.
  assert.deepEqual(settings.livePorts, [45001, 45002]);
});

test('the environment names its own ports, and the live ports cannot be moved', () => {
  const settings = testEnvSettings({
    DEV_GATEWAY_TESTENV_REGISTRY_PORT: '47100',
    DEV_GATEWAY_TESTENV_RELAY_PORT: '47101',
    DEV_GATEWAY_TESTENV_PROXY_PORT: '47102',
    DEV_GATEWAY_TESTENV_API_PORT: '47103',
  });
  assert.equal(settings.registryPort, 47100);
  assert.equal(settings.relayPort, 47101);
  assert.equal(settings.proxyPort, 47102);
  assert.equal(settings.proxyApiPort, 47103);
  // The live ports are the same, whatever the environment says.
  assert.deepEqual(settings.livePorts, [45001, 45002]);
});

test('a port that is not a port is refused', () => {
  assert.throws(() => testEnvSettings({ DEV_GATEWAY_TESTENV_REGISTRY_PORT: 'http' }), /not a port/);
});

test('the configuration of the gateway under test names its own values', () => {
  const settings = testEnvSettings({});
  const config = gatewayConfigFile(settings);
  // The values the test leans on are written down, and not left to the
  // built-in defaults of the package.
  assert.equal(config['zone'], 'gwtest.local');
  assert.equal(config['certResolver'], 'testca');
  assert.equal(config['middlewareProvider'], 'file');
  assert.deepEqual(config['entryPoints'], ['testweb']);
  assert.equal(config['registryPort'], 46002);
  assert.equal(config['relayPort'], 46001);
  assert.equal(config['advertisedHost'], '127.0.0.1');
  assert.equal(config['stateDir'], settings.root);
  assert.equal(config['autostart'], false);
});

test('the configuration of the gateway under test survives the defaults of the package', () => {
  const settings = testEnvSettings({});
  const config = gatewayConfigFile(settings);
  // Every value the test depends on is in the file: a change of the
  // defaults cannot reach the test environment.
  for (const key of ['zone', 'certResolver', 'middlewareProvider', 'entryPoints', 'registryPort', 'relayPort']) {
    assert.ok(config[key] !== undefined, `${key} is not in the configuration of the test environment`);
  }
});

test('the static configuration of the test proxy polls the registry of the test', () => {
  const settings = testEnvSettings({});
  const paths = testEnvPaths(settings);
  const yaml = traefikStaticConfig({ settings, paths });
  assert.match(yaml, /endpoint: "http:\/\/127\.0\.0\.1:46002\/traefik"/);
  assert.match(yaml, /address: "127\.0\.0\.1:8443"/);
  // The API of the test proxy does not answer on the default port of
  // Traefik: the wizard of a live installation must never find it.
  assert.match(yaml, /address: "127\.0\.0\.1:8444"/);
  assert.doesNotMatch(yaml, /:8080/);
  // The resolver the generated routers ask for is declared.
  assert.match(yaml, /testca:/);
});

test('the certificate of the test is handed to the proxy in the default store', () => {
  const document = certificatesDocument('/tmp/cert.pem', '/tmp/key.pem');
  assert.match(document, /certFile: \/tmp\/cert\.pem/);
  assert.match(document, /keyFile: \/tmp\/key\.pem/);
  assert.match(document, /- default/);
});

test('the names of the route and of the certificate belong to the test domain', () => {
  const settings = testEnvSettings({});
  assert.equal(testRouteFqdn(settings), 'main.dev-gateway-e2e.gwtest.local');
  assert.equal(testWildcardDomain(settings), '*.dev-gateway-e2e.gwtest.local');
});

test('the name of the route is slugified, like the name the store builds', () => {
  const settings = testEnvSettings({ DEV_GATEWAY_TESTENV_BRANCH: 'feature/x' });
  assert.equal(testRouteFqdn(settings), 'feature-x.dev-gateway-e2e.gwtest.local');
  assert.equal(testWildcardDomain(settings), '*.dev-gateway-e2e.gwtest.local');
});

test('the teardown removes the files of an interrupted run, and keeps the files of the user', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-testenv-'));
  try {
    fs.writeFileSync(path.join(root, 'keep.txt'), 'precious');
    // The files of an earlier run: they carry the names of the
    // environment, and they go even though they were there before.
    fs.writeFileSync(path.join(root, 'config.json'), '{}');
    fs.writeFileSync(path.join(root, 'routes.json'), '{}');
    const removed = cleanupEnvironment(root, { rootExisted: true, preexisting: ['keep.txt', 'config.json'], hostsEntry: false });
    assert.deepEqual(removed.sort(), ['config.json', 'routes.json']);
    assert.equal(fs.existsSync(path.join(root, 'keep.txt')), true);
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'precious');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the teardown removes the directory it created itself', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-testenv-'));
  const root = path.join(base, 'environment');
  try {
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'config.json'), '{}');
    cleanupEnvironment(root, { rootExisted: false, preexisting: [], hostsEntry: false });
    assert.equal(fs.existsSync(root), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a leftover of an earlier run is recognised, and nobody else is', () => {
  const settings = testEnvSettings({});
  const proxy = `${binaryPath(settings.cacheDir, settings.traefikVersion)} --configFile /tmp/x/traefik.yml`;
  const daemon = `node /src/daemon.ts --config ${settings.root}/config.json`;
  const other = 'node /opt/devbox-traefik-api/bin/traefik-devd.js';
  assert.equal(classifyCmdline(proxy, settings), 'proxy');
  assert.equal(classifyCmdline(daemon, settings), 'daemon');
  assert.equal(classifyCmdline(other, settings), 'unknown');
  assert.equal(classifyCmdline('', settings), 'unknown');
});

test('the archive of a release is read without an external tool', () => {
  // A tar archive with one file, made by hand: the header is 512 bytes,
  // the contents are padded to a multiple of 512 bytes.
  const name = 'traefik';
  const contents = Buffer.from('#!/bin/sh\n');
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write('0000644\0', 100, 'utf8');
  header.write('0000000\0', 108, 'utf8');
  header.write('0000000\0', 116, 'utf8');
  header.write(contents.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  header.write('00000000000\0', 136, 'utf8');
  header.write('        ', 148, 'utf8');
  header.write('0', 156, 'utf8');
  header.write('ustar  \0', 257, 'utf8');
  const archive = Buffer.concat([header, contents, Buffer.alloc(512 - (contents.length % 512))]);

  const extracted = extractFromTarGz(zlib.gzipSync(archive), 'traefik');
  assert.ok(extracted);
  assert.equal(extracted.toString(), '#!/bin/sh\n');
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the snapshot of the listeners says when a port changed hands', () => {
  const before = snapshotOf([45001, 45002]);
  const after = snapshotOf([45001, 45002]);
  assert.ok(snapshotsAreEqual(before, after));
  const changed = { ...before, '45001': [...(before['45001'] ?? []), 999999] };
  assert.equal(snapshotsAreEqual(before, changed), false);
});

test('a port that nothing listens on is free', async () => {
  // The test picks a port the operating system hands out and closes it
  // again, so that nothing listens on it.
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  assert.equal(portIsFree(port), true);
  assert.deepEqual(pidsOnPort(port), []);
});

test('the environment writes nothing outside its own directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-testenv-'));
  try {
    const settings = testEnvSettings({ DEV_GATEWAY_TESTENV_ROOT: root });
    const paths = testEnvPaths(settings);
    for (const file of [paths.configFile, paths.proxyConfigFile, paths.certificatesFile]) {
      assert.ok(file.startsWith(root), `${file} is outside ${root}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
