/**
 * The trust boundary of the gateway (D15).
 *
 * Both listeners answer the addresses in the trust list and nobody else.
 * The check itself lives in the core, so that the relay and the registry
 * cannot drift apart: one check, one reason, one way to say it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isGatewayRefusal,
  isTrusted,
  isTrustedAddress,
  registryTrustKeys,
  registryTrustList,
  type TrustOptions,
} from '../src/core/trust.ts';
import { RELAY_SECRET_HEADER } from '../src/core/protocol.ts';
import { DEFAULT_CONFIG } from '../src/core/config.ts';

const CONFIG = { ...DEFAULT_CONFIG, allowedCidrs: ['127.0.0.1/32', '::1/128'] };

/** The trust boundary of the relay. */
const RELAY: TrustOptions = {
  cidrs: CONFIG.allowedCidrs,
  secretHeader: RELAY_SECRET_HEADER,
  scope: 'relay',
};

test('an address in the trust list is trusted, an address outside it is not', () => {
  const inside = isTrustedAddress({ address: '127.0.0.1' }, RELAY);
  assert.equal(inside.ok, true);

  const outside = isTrustedAddress({ address: '192.0.2.7' }, RELAY);
  assert.equal(outside.ok, false);
});

test('the refusal of the trust list says which address and where the list is written', () => {
  const refused = isTrustedAddress({ address: '192.0.2.7' }, RELAY);
  assert.match(refused.reason ?? '', /192\.0\.2\.7/, 'the reason does not name the address');
  assert.match(refused.reason ?? '', /trust list/, 'the reason does not say that the address is not in the trust list');
  assert.match(refused.reason ?? '', /allowedCidrs/, 'the reason does not name the key of the trust list');
});

test('the refusal names every key the list of the listener is written in', () => {
  const registry: TrustOptions = {
    cidrs: ['192.0.2.0/24'],
    keys: registryTrustKeys({ registryAllowedCidrs: ['192.0.2.0/24'] }),
    secretHeader: 'X-Registry-Secret',
    scope: 'registry',
  };

  const refused = isTrustedAddress({ address: '127.0.0.1' }, registry);
  assert.match(refused.reason ?? '', /allowedCidrs/, 'the reason does not name the key of the relay');
  assert.match(refused.reason ?? '', /registryAllowedCidrs/, 'the reason does not name the key of the registry');

  // A registry without a list of its own names the one of the relay.
  assert.deepEqual(registryTrustKeys({ registryAllowedCidrs: [] }), ['allowedCidrs']);
});

test('an address that is not there is not trusted', () => {
  const refused = isTrustedAddress({ address: undefined }, RELAY);
  assert.equal(refused.ok, false);
  assert.match(refused.reason ?? '', /trust list/);
});

test('the machine itself may be served when the listener says so', () => {
  // The relay does not: its list is the whole truth.
  const refused = isTrustedAddress({ address: '127.0.0.1' }, { ...RELAY, cidrs: ['10.0.0.0/8'] });
  assert.equal(refused.ok, false);

  // The registry's probe does: the daemon's own liveness depends on it.
  const probe = isTrustedAddress(
    { address: '127.0.0.1' },
    { ...RELAY, cidrs: ['10.0.0.0/8'], allowLoopback: true },
  );
  assert.equal(probe.ok, true);

  // The IPv6 loopback is the machine as well.
  const ipv6 = isTrustedAddress(
    { address: '::1' },
    { ...RELAY, cidrs: ['10.0.0.0/8'], allowLoopback: true },
  );
  assert.equal(ipv6.ok, true);
});

test('the secret is asked for when the installation has one', () => {
  const config = { ...CONFIG, secret: 's3cret' };
  const options = { ...RELAY, cidrs: config.allowedCidrs };

  const without = isTrusted({ address: '127.0.0.1' }, {}, config, options);
  assert.equal(without.ok, false);
  assert.match(without.reason ?? '', /secret/, 'the reason does not say that the secret is missing or wrong');

  const wrong = isTrusted({ address: '127.0.0.1' }, { 'x-relay-secret': 'wrong' }, config, options);
  assert.equal(wrong.ok, false);

  const right = isTrusted({ address: '127.0.0.1' }, { 'x-relay-secret': 's3cret' }, config, options);
  assert.equal(right.ok, true);
});

test('no secret means no secret is asked for', () => {
  const trusted = isTrusted({ address: '127.0.0.1' }, {}, CONFIG, RELAY);
  assert.equal(trusted.ok, true);
});

test('the registry trusts the list of the relay and the list of its own', () => {
  assert.deepEqual(registryTrustList({ allowedCidrs: ['127.0.0.1/32'], registryAllowedCidrs: [] }), ['127.0.0.1/32']);
  assert.deepEqual(
    registryTrustList({ allowedCidrs: ['127.0.0.1/32'], registryAllowedCidrs: ['192.0.2.0/24'] }),
    ['127.0.0.1/32', '192.0.2.0/24'],
  );
});

test('the list of the registry never takes an address away from the relay', () => {
  const list = registryTrustList({ allowedCidrs: ['127.0.0.1/32'], registryAllowedCidrs: ['192.0.2.0/24'] });
  assert.ok(list.includes('127.0.0.1/32'), 'the loopback of the relay is gone');
});

test('a refusal of the gateway is told apart from a refusal of the proxy', () => {
  assert.equal(isGatewayRefusal('forbidden: the source address 192.0.2.7 is not in the trust list (allowedCidrs)'), true);
  assert.equal(isGatewayRefusal('forbidden: the relay secret is missing or wrong'), true);
  assert.equal(isGatewayRefusal('forbidden: the registry secret is missing or wrong'), true);

  // The proxy in front of the gateway has a body of its own.
  assert.equal(isGatewayRefusal('403 Forbidden'), false);
  assert.equal(isGatewayRefusal('forbidden by the middleware of the proxy'), false);
});
