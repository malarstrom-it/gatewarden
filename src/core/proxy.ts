/**
 * The proxy adapter contract.
 *
 * The core knows about routes, ports, host names and reachability. It does
 * not know what a router, a service or a middleware is: those belong to a
 * proxy, and a proxy is reached through this contract.
 *
 * The contract lives in the core, and not in the adapters, because the
 * core is the side that consumes it. The dependency runs one way: an
 * adapter may import the core, the core never imports an adapter.
 * The adapter types re-export it under the name the specification
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
  /**
   * The endpoints the gateway serves on.
   *
   * When they are given, the adapter reports whether the proxy already
   * points at one of them: that is the question the setup wizard asks
   * when it reads the environment. The list holds every name the machine
   * is known by — the advertised host name and the advertised IP — and
   * every port the gateway serves on, because the proxy may reach the
   * gateway by either of them.
   */
  expectEndpoints?: string[];
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
    /**
     * The port every entry point answers on.
     *
     * The public URL of a route has no port of its own when the proxy
     * serves it on the standard one. A proxy that serves it on another
     * port (8443, say) needs the port in the URL, and the wizard cannot
     * guess it.
     */
    entryPointPorts?: Record<string, number>;
    /** The name of the proxy's ACME resolver. */
    certResolver?: string;
    /** The provider that owns the shared middlewares. */
    middlewareProvider?: string;
  };
  /**
   * Does the proxy already point at this machine?
   *
   * `undefined` when the adapter could not tell: the proxy API does not
   * say, or the question was not asked.
   */
  wired?: boolean;
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
  /**
   * Where the proxy's API usually answers.
   *
   * The wizard asks the adapter where to look when nobody says:
   * the address belongs to the adapter, not to the wizard, so that a
   * second proxy does not have to be hard-coded in the wizard.
   */
  defaultApiBaseUrl?: string;
  /** Identify the proxy: find its API, read its version. */
  discover(options: DiscoverOptions): Promise<ProxyInfo | undefined>;
  /** Render the dynamic configuration for the current routes. */
  render(routes: Route[], config: Config): string;
  /** The static configuration the user must add to the proxy. */
  wiringSnippet(config: Config): string;
  /** Does the proxy currently know about this route? */
  verify?(route: Route, config: Config): Promise<boolean>;
}
