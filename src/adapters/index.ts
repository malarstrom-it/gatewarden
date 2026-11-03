/**
 * The catalog of proxy adapters.
 *
 * The core does not know which proxies exist: it asks for one by id and is
 * handed it. This module is where the ids and the adapters meet, and it is
 * the only place that knows that "traefik" means the Traefik adapter.
 */

import type { ProxyStatus } from '../core/status.ts';
import type { ProxyAdapter } from './types.ts';
import { traefikAdapter } from './traefik.ts';

const ADAPTERS: Record<string, ProxyAdapter> = {
  [traefikAdapter.id]: traefikAdapter,
};

/** The adapter for a proxy id, when there is one. */
export function adapterFor(id: string): ProxyAdapter | undefined {
  return ADAPTERS[id];
}

/** Every proxy id the package can serve. */
export function adapterIds(): string[] {
  return Object.keys(ADAPTERS);
}

/**
 * The sentence the catalog says about a proxy id it does not know.
 *
 * It is one sentence everywhere: the catalog raises it, the doctor
 * reports it, the daemon stops with it, and the command that waits for
 * the daemon says it. The id that was asked for and the ids that exist
 * are both in it, so that the reader does not have to look them up.
 */
export function unknownProxyMessage(proxyId: string, known: string[] = adapterIds()): string {
  return `unknown proxy "${proxyId}" (known: ${known.join(', ')})`;
}

/**
 * The error the catalog raises for a proxy id it does not know.
 *
 * It is an error of its own: the worker that gets it dies at once, and
 * it would die again at once. A daemon that gets it must not start the
 * worker again — it stops and says why.
 */
export class UnknownProxyError extends Error {
  /** The id that was asked for. */
  readonly proxyId: string;
  /** Every id the catalog knows. */
  readonly known: string[];

  constructor(proxyId: string, known: string[] = adapterIds()) {
    super(unknownProxyMessage(proxyId, known));
    this.name = 'UnknownProxyError';
    this.proxyId = proxyId;
    this.known = known;
  }
}

/** The reason an id is not known, or null when the catalog knows it. */
export function unknownProxyReason(proxyId: string): string | null {
  if (adapterFor(proxyId)) return null;
  return unknownProxyMessage(proxyId);
}

/** Is this the error of a proxy id the catalog does not know? */
export function isUnknownProxyError(error: unknown): error is UnknownProxyError {
  return error instanceof UnknownProxyError;
}

/** The adapter for a proxy id. Throws when the id is unknown. */
export function requireAdapter(id: string): ProxyAdapter {
  const adapter = adapterFor(id);
  if (!adapter) {
    throw new UnknownProxyError(id);
  }
  return adapter;
}

/**
 * Ask the proxy what it is, and report what it answered.
 *
 * The core does not know about proxies, so the question is asked here,
 * in the catalog, and only the answer travels further. A proxy that does
 * not answer is not an error: the report says it is not reachable.
 */
export async function discoverProxyStatus(proxyId: string, timeoutMs = 1000): Promise<ProxyStatus> {
  try {
    const adapter = requireAdapter(proxyId);
    const discovered = await adapter.discover({ timeoutMs });
    return { id: adapter.id, reachable: discovered !== undefined, version: discovered?.version };
  } catch {
    // An unknown proxy id is an error, and the doctor reports it as
    // one (with the id that is unknown and the ids that exist). Here it
    // only means that there is no proxy to ask.
    return { id: proxyId, reachable: false };
  }
}

export { traefikAdapter };
