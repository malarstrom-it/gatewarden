import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { addressInCidr, isAddressAllowed, ipv6ToBigInt, normaliseAddress } from '../src/core/util/net.ts';
import { detectIpv6Prefixes, listenHost, loadConfig } from '../src/core/config.ts';

/**
 * A home directory of its own, so that a configuration load never reaches
 * the home directory of the user who runs the tests (D11).
 */
const homes: string[] = [];

function isolatedHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-net-'));
  homes.push(home);
  return home;
}

after(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});

/**
 * The addresses of the tests below come from the ranges that RFC 5737
 * reserves for documentation: 192.0.2.0/24, 198.51.100.0/24 and
 * 203.0.113.0/24, and from 2001:db8::/32, the range that RFC 3849
 * reserves for documentation. An address from one of them names no
 * network that exists, and the ranges are the ones the documentation
 * of the package uses in its examples. The IPv6 addresses therefore
 * never carry the prefix of the installation that runs the test.
 */
test('IPv4 CIDRs match', () => {
  assert.equal(addressInCidr('192.0.2.6', '192.0.2.0/24'), true);
  assert.equal(addressInCidr('198.51.100.6', '192.0.2.0/24'), false);
  assert.equal(addressInCidr('203.0.113.40', '203.0.113.40'), true);
});

test('IPv4-mapped IPv6 addresses are matched as IPv4', () => {
  assert.equal(normaliseAddress('::ffff:192.0.2.6'), '192.0.2.6');
  assert.equal(addressInCidr('::ffff:192.0.2.6', '192.0.2.0/24'), true);
  assert.equal(addressInCidr('::ffff:192.0.2.6', '192.0.2.0/24'), true);
});

test('IPv6 CIDRs match', () => {
  assert.equal(ipv6ToBigInt('2001:db8::d') !== null, true);
  assert.equal(addressInCidr('2001:db8::6', '2001:db8::/64'), true);
  assert.equal(addressInCidr('2001:db8:0:3::6', '2001:db8::/64'), false);
  assert.equal(addressInCidr('::1', '::1/128'), true);
  assert.equal(addressInCidr('::2', '::1/128'), false);
});

test('isAddressAllowed accepts any listed range', () => {
  const cidrs = ['192.0.2.0/24', '127.0.0.1/32', '::1/128', '2001:db8::/64'];
  assert.equal(isAddressAllowed('192.0.2.6', cidrs), true);
  assert.equal(isAddressAllowed('127.0.0.1', cidrs), true);
  assert.equal(isAddressAllowed('::1', cidrs), true);
  assert.equal(isAddressAllowed('2001:db8::6', cidrs), true);
  assert.equal(isAddressAllowed('203.0.113.40', cidrs), false);
  assert.equal(isAddressAllowed(undefined, cidrs), false);
});

test('the container IPv6 prefixes are detected and the listener is dual stack', () => {
  const prefixes = detectIpv6Prefixes();
  assert.ok(Array.isArray(prefixes));
  for (const prefix of prefixes) assert.match(prefix, /^[0-9a-f:]+::\/64$/);
  assert.equal(listenHost(), prefixes.length > 0 ? '::' : '0.0.0.0');
});

test('the loaded configuration accepts the container IPv6 prefix', () => {
  const config = loadConfig({ home: isolatedHome(), env: {}, overrides: { allowedCidrs: ['192.0.2.0/24', '127.0.0.1/32', '::1/128'] } });
  for (const prefix of detectIpv6Prefixes()) {
    assert.ok(config.allowedCidrs.includes(prefix), `${prefix} should be allowed`);
  }
  assert.ok(config.allowedCidrs.includes('::1/128'));
});

test('the advertised host is the detected address, not a name of another installation', () => {
  const config = loadConfig({ home: isolatedHome(), env: {}, overrides: { stateDir: '/tmp/traefik-dev-test' } });
  // The built-in default names nothing: the host name of the machine is
  // derived, and the setup wizard asks for the name the proxy uses.
  assert.equal(config.advertisedHost, config.advertisedIp);
  assert.ok(config.advertisedIp.length > 0);
});
