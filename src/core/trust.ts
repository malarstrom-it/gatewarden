/**
 * The trust boundary of the gateway.
 *
 * Both listeners are bound on every address of the machine: the registry
 * serves the configuration document, the relay dispatches to the dev
 * servers. Neither of them may answer anybody: they answer the
 * addresses in the trust list (`allowedCidrs`) and nobody else, and a
 * caller that has to present the shared secret presents it.
 *
 * The registry has a list of its own (`registryAllowedCidrs`) on top of
 * the relay's. The two listeners have different jobs — one hands out
 * the document, the other forwards the requests — and an address that
 * may only read the document does not have to be allowed to dispatch.
 * The list of the registry is empty by default, and an empty list means
 * "the same list as the relay's": the machine that may talk to the
 * relay may read the document too.
 */

import type http from 'node:http';
import type { Config } from './types.ts';
import { isAddressAllowed, isLoopbackAddress, normaliseAddress } from './util/net.ts';

/** The listener's view of the caller. */
export interface Peer {
  address: string | undefined;
}

/** The decision of the trust check. */
export interface TrustDecision {
  /** May the caller be served? */
  ok: boolean;
  /** Why the caller was refused. Empty when it was not refused. */
  reason?: string;
}

/** What the trust check needs to know about the listener it guards. */
export interface TrustOptions {
  /** The addresses that may be served. */
  cidrs: string[];
  /**
   * The names of the configuration keys the list is written in.
   *
   * The refusal names them: a user who reads "the trust list
   * (allowedCidrs)" and has written `registryAllowedCidrs` is sent to
   * the wrong key.
   */
  keys?: string[];
  /** The header the shared secret is sent in. */
  secretHeader: string;
  /** The name of the listener, for the reason it gives. */
  scope: string;
  /**
   * May the machine itself always be served?
   *
   * The loopback is the machine, and not the network: only a process
   * here can use it. The daemon's own liveness probe needs it — a
   * trust list that leaves the loopback out must not make the daemon
   * report itself as broken.
   */
  allowLoopback?: boolean;
}

/** What the address check needs to know about the listener it guards. */
export type AddressTrust = Pick<TrustOptions, 'cidrs' | 'keys' | 'allowLoopback'>;

/**
 * The part of a refusal that says the address is not in the trust list.
 *
 * It is the same words in every refusal, so that the code that reads a
 * refusal (the setup wizard) can tell the gateway's own refusal from
 * the refusal of the proxy in front of it.
 */
export const TRUST_LIST_REFUSAL = 'not in the trust list';

/** The part of a refusal that says the secret is missing or wrong. */
export const SECRET_REFUSAL = 'secret is missing or wrong';

/** The key the trust list of the relay is written in. */
export const TRUST_LIST_KEY = 'allowedCidrs';

/**
 * The addresses that may read the configuration document.
 *
 * The list of the relay, and the list of the registry on top of it. An
 * empty list of the registry means the list of the relay: the two
 * listeners are trusted by the same addresses unless the installation
 * says otherwise.
 */
export function registryTrustList(config: Pick<Config, 'allowedCidrs' | 'registryAllowedCidrs'>): string[] {
  return [...new Set([...config.allowedCidrs, ...config.registryAllowedCidrs])];
}

/**
 * The names of the configuration keys the trust list of the registry is
 * written in.
 *
 * Both of them, when the installation has its own list for the
 * registry: the refusal has to name the key the user wrote.
 */
export function registryTrustKeys(config: Pick<Config, 'registryAllowedCidrs'>): string[] {
  return config.registryAllowedCidrs.length > 0
    ? [TRUST_LIST_KEY, 'registryAllowedCidrs']
    : [TRUST_LIST_KEY];
}

/** Read a header of the request. */
export function readHeader(headers: http.IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Is the address of the caller in the trust list?
 *
 * The reason says which address was refused and where the list is
 * written: "the source address 192.0.2.7 is not in the trust list
 * (allowedCidrs)". A refusal that only says "forbidden" sends the user
 * looking in the wrong place.
 */
export function isTrustedAddress(peer: Peer, options: AddressTrust): TrustDecision {
  if (isAddressAllowed(peer.address, options.cidrs)) return { ok: true };
  if (options.allowLoopback && isLoopbackAddress(peer.address)) return { ok: true };

  // The address is written as the caller knows it: the IPv4-mapped form
  // of an IPv6 socket is the same address with a longer name.
  const address = peer.address ? normaliseAddress(peer.address) || peer.address : '(unknown)';
  const keys = options.keys ?? [TRUST_LIST_KEY];
  return { ok: false, reason: `the source address ${address} is ${TRUST_LIST_REFUSAL} (${keys.join(', ')})` };
}

/**
 * Is the caller trusted?
 *
 * The source address has to be inside the trust list, and — when the
 * installation has a shared secret — the secret has to be presented in
 * the header of the listener. The relay checks the secret in its own
 * header and the registry in its own: the two are the same secret, and
 * they travel apart.
 */
export function isTrusted(
  peer: Peer,
  headers: http.IncomingHttpHeaders,
  config: Config,
  options: TrustOptions,
): TrustDecision {
  const address = isTrustedAddress(peer, options);
  if (!address.ok) return address;
  if (config.secret) {
    const provided = readHeader(headers, options.secretHeader);
    if (provided !== config.secret) {
      return { ok: false, reason: `the ${options.scope} ${SECRET_REFUSAL}` };
    }
  }
  return { ok: true };
}

/**
 * Is this body a refusal of the gateway itself?
 *
 * The gateway says who it is when it refuses: the trust list or the
 * secret. A proxy that refuses in front of it has a body of its own,
 * and the cause is somewhere else entirely.
 */
export function isGatewayRefusal(body: string): boolean {
  if (!body.startsWith('forbidden:')) return false;
  return body.includes(TRUST_LIST_REFUSAL) || body.includes(SECRET_REFUSAL);
}
