/**
 * Reachability probing.
 *
 * A route is up when something answers on the port the dev server listens
 * on, on the loopback interface: the dev server runs next to the gateway.
 *
 * The answer is cached for a short time. The registry is asked about the
 * same routes on every request, and a probe costs a connection.
 */

import type { Registration } from './types.ts';
import { isPortListening } from './util/net.ts';

/** How long a probe result is trusted. */
export const PROBE_TTL_MS = 2000;

/** How long a probe waits for the port to answer. */
export const PROBE_TIMEOUT_MS = 400;

/** Probes whether the dev servers behind the routes are listening. */
export class RouteProbe {
  private readonly cache = new Map<string, { value: boolean; at: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = PROBE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Is the dev server behind this route listening? */
  async isUp(route: Registration): Promise<boolean> {
    const cached = this.cache.get(route.id);
    const now = Date.now();
    if (cached && now - cached.at < this.ttlMs) return cached.value;
    const value = await isPortListening(route.devPort, '127.0.0.1', PROBE_TIMEOUT_MS);
    this.cache.set(route.id, { value, at: now });
    return value;
  }

  /** The state of every route, by route id. */
  async states(routes: Registration[]): Promise<Map<string, boolean>> {
    const states = new Map<string, boolean>();
    for (const route of routes) {
      states.set(route.id, await this.isUp(route));
    }
    return states;
  }
}
