/**
 * The configuration layer (§3.2).
 *
 * The layout of the configuration file, the precedence of the environment
 * overrides and the migration from the old layout.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG, configFileContent, loadConfig, requireZone, resolveConfigPath, writeConfigFile } from '../src/core/config.ts';
import { resolvePaths } from '../src/core/paths.ts';

function isolatedHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-config-'));
}

function configPathIn(home: string): string {
  return path.join(home, '.config', 'dev-gateway', 'config.json');
}

test('the configuration file is read from the XDG configuration directory', () => {
  const home = isolatedHome();
  try {
    fs.mkdirSync(path.dirname(configPathIn(home)), { recursive: true });
    fs.writeFileSync(configPathIn(home), JSON.stringify({ zone: 'from.the.file' }));

    const config = loadConfig({ home, env: {} });

    assert.equal(config.zone, 'from.the.file');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a state directory named by the configuration file is kept', () => {
  const home = isolatedHome();
  const stateDir = path.join(home, 'somewhere', 'state');
  try {
    fs.mkdirSync(path.dirname(configPathIn(home)), { recursive: true });
    fs.writeFileSync(configPathIn(home), JSON.stringify({ stateDir }));

    const config = loadConfig({ home, env: {} });

    assert.equal(config.stateDir, stateDir);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('DEV_GATEWAY_STATE_DIR wins over the state directory of the configuration file', () => {
  const home = isolatedHome();
  const stateDir = path.join(home, 'from', 'the', 'environment');
  try {
    fs.mkdirSync(path.dirname(configPathIn(home)), { recursive: true });
    fs.writeFileSync(configPathIn(home), JSON.stringify({ stateDir: path.join(home, 'from', 'the', 'file') }));

    const config = loadConfig({ home, env: { DEV_GATEWAY_STATE_DIR: stateDir } });

    assert.equal(config.stateDir, stateDir);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an explicit state directory wins over the environment', () => {
  const home = isolatedHome();
  try {
    const config = loadConfig({
      home,
      env: { DEV_GATEWAY_STATE_DIR: path.join(home, 'from', 'the', 'environment') },
      stateDir: path.join(home, 'from', 'the', 'flag'),
    });

    assert.equal(config.stateDir, path.join(home, 'from', 'the', 'flag'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the configuration file path is the same, whichever function asks for it', () => {
  // `resolveConfigPath` and `resolvePaths` must answer the same, or the
  // daemon and the CLI end up reading different files (§3.1).
  const environments = [
    {},
    { DEV_GATEWAY_HOME: path.join(path.sep, 'h') },
    { DEV_GATEWAY_CONFIG: path.join(path.sep, 'c.json') },
    { DEV_GATEWAY_HOME: path.join(path.sep, 'h'), DEV_GATEWAY_CONFIG: path.join(path.sep, 'c.json') },
    { DEV_GATEWAY_STATE_DIR: path.join(path.sep, 's') },
    { TRAEFIK_DEV_CONFIG: path.join(path.sep, 'old.json') },
  ];

  for (const env of environments) {
    const resolved = resolvePaths({ env, home: path.join(path.sep, 'home', 'user') });
    const asked = resolveConfigPath({ env, home: path.join(path.sep, 'home', 'user') });
    assert.equal(asked, resolved.configFile, `${JSON.stringify(env)}`);
  }
});

test('DEV_GATEWAY_HOME wins over DEV_GATEWAY_CONFIG, as the order of §3.1 says', () => {
  const env = {
    DEV_GATEWAY_HOME: path.join(path.sep, 'h'),
    DEV_GATEWAY_CONFIG: path.join(path.sep, 'c.json'),
  };

  assert.equal(resolveConfigPath({ env }), path.join(path.sep, 'h', 'config.json'));
});

test('the state directory follows XDG_STATE_HOME, even when the file names one', () => {
  const home = isolatedHome();
  const first = path.join(home, '.state1');
  const second = path.join(home, '.state2');
  try {
    fs.mkdirSync(path.dirname(configPathIn(home)), { recursive: true });
    fs.writeFileSync(configPathIn(home), JSON.stringify({ stateDir: path.join(first, 'dev-gateway') }));

    const config = loadConfig({ home, env: { XDG_STATE_HOME: second } });

    assert.equal(config.stateDir, path.join(second, 'dev-gateway'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the state directory of the configuration file is kept when the environment names none', () => {
  const home = isolatedHome();
  const stateDir = path.join(home, 'somewhere', 'state');
  try {
    fs.mkdirSync(path.dirname(configPathIn(home)), { recursive: true });
    fs.writeFileSync(configPathIn(home), JSON.stringify({ stateDir }));

    const config = loadConfig({ home, env: {} });

    assert.equal(config.stateDir, stateDir);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the new layout has the keys of §3.2', () => {
  const home = isolatedHome();
  try {
    const config = loadConfig({ home, env: {} });

    assert.equal(config.proxy, 'traefik');
    assert.equal(config.autostart, true);
    assert.equal(config.registryPort, 45002);
    assert.equal(config.relayPort, 45001);
    assert.deepEqual(config.entryPoints, ['websecure']);
    assert.equal(config.tlsMode, 'wildcard');
    assert.equal(config.securityHeaders, false);
    assert.equal(config.compressMiddleware, false);
    assert.equal(config.documentFormat, 'yaml');
    assert.equal(config.logMaxBytes, 5242880);
    assert.equal(config.logKeep, 3);
    assert.equal(config.secret, '');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the built-in defaults carry no value of one installation', () => {
  // The package is for anybody: the defaults name nobody's zone, nobody's
  // certificate resolver, nobody's host name and nobody's network
  // (§3.2). The setup wizard derives them or asks for them (§9.2).
  assert.equal(DEFAULT_CONFIG.zone, '');
  assert.equal(DEFAULT_CONFIG.certResolver, '');
  assert.equal(DEFAULT_CONFIG.middlewareProvider, '');
  assert.equal(DEFAULT_CONFIG.advertisedHost, '');
  assert.equal(DEFAULT_CONFIG.advertisedIp, '');
  assert.deepEqual(DEFAULT_CONFIG.allowedCidrs, ['127.0.0.1/32', '::1/128']);

  // Nothing in the defaults names a host, a zone or a network that is
  // not the loopback of every machine.
  for (const value of Object.values(DEFAULT_CONFIG)) {
    if (typeof value !== 'string') continue;
    assert.doesNotMatch(value, /malarstrom|devbox|cloudflare|172\.16\./, `${value} is a value of one installation`);
  }
});

test('a configuration without a zone says that the zone is missing', () => {
  const home = isolatedHome();
  try {
    const config = loadConfig({ home, env: {} });

    assert.equal(config.zone, '');
    assert.throws(() => requireZone(config), /no DNS zone is configured/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a value of the wrong type falls back to the default', () => {
  const home = isolatedHome();
  try {
    fs.mkdirSync(path.dirname(configPathIn(home)), { recursive: true });
    fs.writeFileSync(
      configPathIn(home),
      JSON.stringify({
        zone: null,
        allowedCidrs: '127.0.0.1/32',
        registryPort: '46002',
        entryPoints: ['web', 5],
        secret: 7,
      }),
    );

    const config = loadConfig({ home, env: {} });

    // A zone that is not a string is no zone.
    assert.equal(config.zone, '');
    assert.throws(() => requireZone(config), /no DNS zone is configured/);
    // A list that is not a list is the default list.
    assert.deepEqual(config.allowedCidrs.slice(0, 2), ['127.0.0.1/32', '::1/128']);
    // A number written as a string is the number it names.
    assert.equal(config.registryPort, 46002);
    // A list holds the strings of it.
    assert.deepEqual(config.entryPoints, ['web']);
    // A secret that is not a string is no secret.
    assert.equal(config.secret, '');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('unknown keys of the configuration file are dropped', () => {
  const home = isolatedHome();
  try {
    fs.mkdirSync(path.dirname(configPathIn(home)), { recursive: true });
    fs.writeFileSync(configPathIn(home), JSON.stringify({ zone: 'kept.example', nonsense: 'dropped' }));

    const config = loadConfig({ home, env: {} });

    assert.equal(config.zone, 'kept.example');
    assert.equal((config as unknown as Record<string, unknown>)['nonsense'], undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the written configuration file holds every key of the layout', () => {
  const home = isolatedHome();
  try {
    const config = loadConfig({ home, env: {} });
    const file = configPathIn(home);
    writeConfigFile(file, config);

    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(written), Object.keys(DEFAULT_CONFIG));
    assert.equal(written.proxy, 'traefik');
    assert.equal(written.autostart, true);
    assert.equal(written.stateDir, config.stateDir);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the content of the configuration file keeps the auto-detected prefixes out', () => {
  const home = isolatedHome();
  try {
    const config = loadConfig({ home, env: {} });
    const content = configFileContent(config) as { allowedCidrs: string[] };

    for (const cidr of content.allowedCidrs) {
      if (!cidr.includes(':')) continue;
      assert.ok(DEFAULT_CONFIG.allowedCidrs.includes(cidr), `${cidr} is derived and must not be written`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the detected address is not written to the configuration file', () => {
  const home = isolatedHome();
  try {
    const config = loadConfig({ home, env: {} });
    const content = configFileContent(config) as { advertisedIp: string; advertisedHost: string };

    // The address of this machine is derived on every run. A file that
    // pins the address of the moment it was written keeps advertising an
    // address the machine does not have any more.
    assert.equal(content.advertisedIp, '', 'the detected address was written to the file');
    assert.equal(content.advertisedHost, '', 'the derived host name was written to the file');

    // A value that is not the detected address belongs to the
    // installation, and it is written.
    const own = configFileContent({ ...config, advertisedIp: '10.9.8.7', advertisedHost: 'myhost' });
    assert.equal(own['advertisedIp'], '10.9.8.7');
    assert.equal(own['advertisedHost'], 'myhost');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
