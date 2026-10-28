/**
 * The proxy adapter contract (D3, §4.2).
 *
 * The core knows about routes, ports, host names and reachability. It does
 * not know what a router, a service or a middleware is: those belong to a
 * proxy, and a proxy is reached through this contract.
 *
 * The contract lives in the core, and not in `src/adapters/`, because the
 * core is the side that consumes it. The dependency runs one way: an
 * adapter may import the core, the core never imports an adapter.
 * `src/adapters/types.ts` re-exports it under the name the specification
 * gives it.
 */

import type { Config, Route } from './types.ts';

/** What an adapter needs to find the proxy it is talking to. */
export interface DiscoverOptions {
  /**
   * The base URL of the proxy's API.
   *
   * Traefik serves its API on the `traefik` entry point, which is
   * `http://127.0.0.1:8080` in the usual setup.
   */
  apiBaseUrl?: string;
  /** How long to wait for the API to answer. */
  timeoutMs?: number;
}

/** What an adapter learned about the proxy it found. */
export interface ProxyInfo {
  /** The id of the adapter that found it. */
  id: string;
  /** The version the proxy reported, when it reports one. */
  version?: string;
  /** Values derived from the proxy's own current configuration. */
  derived: {
    /** The DNS zone the proxy's host names are built from. */
    zone?: string;
    /** The entry points the proxy's routers attach to. */
    entryPoints?: string[];
    /** The name of the proxy's ACME resolver. */
    certResolver?: string;
    /** The provider that owns the shared middlewares. */
    middlewareProvider?: string;
  };
}

/**
 * One proxy, behind one interface.
 *
 * The core asks an adapter to render the document it serves and, when it
 * needs to know the proxy, to describe itself.
 */
export interface ProxyAdapter {
  /** The id of the proxy this adapter speaks for (`traefik`). */
  id: string;
  /** Identify the proxy: find its API, read its version. */
  discover(options: DiscoverOptions): Promise<ProxyInfo | undefined>;
  /** Render the dynamic configuration for the current routes. */
  render(routes: Route[], config: Config): string;
  /** The static configuration the user must add to the proxy. */
  wiringSnippet(config: Config): string;
  /** Does the proxy currently know about this route? */
  verify?(route: Route, config: Config): Promise<boolean>;
}
