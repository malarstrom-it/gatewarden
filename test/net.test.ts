import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { addressInCidr, isAddressAllowed, ipv6ToBigInt, normaliseAddress } from '../src/util/net.ts';
import { detectIpv6Prefixes, listenHost, loadConfig } from '../src/config.ts';

/**
 * A home directory of its own, so that a configuration load never reaches
 * the home directory of the user who runs the tests (D11).
 */
const homes: string[] = [];

function isolatedHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-net-'));
  homes.push(home);
  return home;
}

after(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});

test('IPv4 CIDRs match', () => {
  assert.equal(addressInCidr('172.16.2.6', '172.16.2.0/24'), true);
  assert.equal(addressInCidr('172.16.3.6', '172.16.2.0/24'), false);
  assert.equal(addressInCidr('10.10.1.50', '10.10.1.50'), true);
});

test('IPv4-mapped IPv6 addresses are matched as IPv4', () => {
  assert.equal(normaliseAddress('::ffff:172.16.2.6'), '172.16.2.6');
  assert.equal(addressInCidr('::ffff:172.16.2.6', '172.16.2.0/24'), true);
  assert.equal(addressInCidr('::ffff:172.16.2.6', '172.16.2.0/24'), true);
});

test('IPv6 CIDRs match', () => {
  assert.equal(ipv6ToBigInt('fdd0:0:0:2::d') !== null, true);
  assert.equal(addressInCidr('fdd0:0:0:2::6', 'fdd0:0:0:2::/64'), true);
  assert.equal(addressInCidr('fdd0:0:0:3::6', 'fdd0:0:0:2::/64'), false);
  assert.equal(addressInCidr('::1', '::1/128'), true);
  assert.equal(addressInCidr('::2', '::1/128'), false);
});

test('isAddressAllowed accepts any listed range', () => {
  const cidrs = ['172.16.2.0/24', '127.0.0.1/32', '::1/128', 'fdd0:0:0:2::/64'];
  assert.equal(isAddressAllowed('172.16.2.6', cidrs), true);
  assert.equal(isAddressAllowed('127.0.0.1', cidrs), true);
  assert.equal(isAddressAllowed('::1', cidrs), true);
  assert.equal(isAddressAllowed('fdd0:0:0:2::6', cidrs), true);
  assert.equal(isAddressAllowed('10.10.1.50', cidrs), false);
  assert.equal(isAddressAllowed(undefined, cidrs), false);
});

test('the container IPv6 prefixes are detected and the listener is dual stack', () => {
  const prefixes = detectIpv6Prefixes();
  assert.ok(Array.isArray(prefixes));
  for (const prefix of prefixes) assert.match(prefix, /^[0-9a-f:]+::\/64$/);
  assert.equal(listenHost(), prefixes.length > 0 ? '::' : '0.0.0.0');
});

test('the loaded configuration accepts the container IPv6 prefix', () => {
  const config = loadConfig({ home: isolatedHome(), env: {}, overrides: { allowedCidrs: ['172.16.2.0/24', '127.0.0.1/32', '::1/128'] } });
  for (const prefix of detectIpv6Prefixes()) {
    assert.ok(config.allowedCidrs.includes(prefix), `${prefix} should be allowed`);
  }
  assert.ok(config.allowedCidrs.includes('::1/128'));
});

test('the default advertised host is the compose service name', () => {
  const config = loadConfig({ home: isolatedHome(), env: {}, overrides: { stateDir: '/tmp/traefik-dev-test' } });
  assert.equal(config.advertisedHost, 'devbox');
  assert.ok(config.advertisedIp.length > 0);
});
