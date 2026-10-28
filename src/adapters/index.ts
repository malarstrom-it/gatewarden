/**
 * The catalog of proxy adapters (D3, §4.2).
 *
 * The core does not know which proxies exist: it asks for one by id and is
 * handed it. This module is where the ids and the adapters meet, and it is
 * the only place that knows that "traefik" means the Traefik adapter.
 */

import type { ProxyAdapter } from './types.ts';
import { traefikAdapter } from './traefik.ts';

const ADAPTERS: Record<string, ProxyAdapter> = {
  [traefikAdapter.id]: traefikAdapter,
};

/** The adapter for a proxy id, when there is one. */
export function adapterFor(id: string): ProxyAdapter | undefined {
  return ADAPTERS[id];
}

/** The adapter for a proxy id. Throws when the id is unknown. */
export function requireAdapter(id: string): ProxyAdapter {
  const adapter = adapterFor(id);
  if (!adapter) {
    throw new Error(`unknown proxy "${id}" (known: ${adapterIds().join(', ')})`);
  }
  return adapter;
}

/** Every proxy id the package can serve. */
export function adapterIds(): string[] {
  return Object.keys(ADAPTERS);
}

export { traefikAdapter };
