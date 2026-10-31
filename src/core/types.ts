/** Shared types for the gateway. */

export interface Registration {
  /** Stable dispatch id, also used as the `X-Dev-Target` header value. */
  id: string;
  /** Raw project label as given on the command line. */
  project: string;
  /** Raw branch name as given on the command line. */
  branch: string;
  /** DNS-safe project label. */
  projectSlug: string;
  /** DNS-safe branch label. */
  branchSlug: string;
  /** Fully qualified domain name served for this registration. */
  fqdn: string;
  /**
   * The DNS zone the route was registered with.
   *
   * A route keeps the zone it was named from: the certificate of the
   * route is built from it, not from the zone of the configuration the
   * daemon happens to run with.
   */
  zone: string;
  /** Port the dev server listens on inside this container (loopback). */
  devPort: number;
  /** Free-form extra label shown in the index. */
  label?: string;
  /** ISO timestamp of the first registration. */
  createdAt: string;
  /** ISO timestamp of the last change to the registration. */
  updatedAt: string;
}

export type DocumentFormat = 'yaml' | 'json';

/**
 * A route is a registration: the core's word for a published dev server.
 *
 * The `ProxyAdapter` contract speaks of routes (§4.2); the store keeps
 * registrations. They are the same thing.
 */
export type Route = Registration;

export interface Config {
  /** Which proxy adapter writes the dynamic configuration (D3). */
  proxy: string;
  /** Port the registry listener binds (0.0.0.0). */
  registryPort: number;
  /** Port the relay listener binds (0.0.0.0). */
  relayPort: number;
  /** IP this machine advertises to the proxy for the relay/registry services. */
  advertisedIp: string;
  /**
   * Host name or IP this machine is reachable under from the proxy.
   * Defaults to `advertisedIp`; the setup wizard asks for the name the
   * proxy knows this machine by.
   */
  advertisedHost: string;
  /** DNS zone the FQDNs are built from. Empty until the wizard fills it in. */
  zone: string;
  /** Traefik entryPoint names the routers attach to. */
  entryPoints: string[];
  /** Name of the Traefik ACME certificate resolver (empty = no tls block). */
  certResolver: string;
  /** Certificate granularity: `wildcard` (one certificate per project) or `fqdn` (one per branch). */
  tlsMode: 'wildcard' | 'fqdn';
  /** Reference the shared `default-security-headers` middleware on the dev routers. */
  securityHeaders: boolean;
  /** Reference the shared `compress` middleware on the dev routers. */
  compressMiddleware: boolean;
  /**
   * Name of the proxy provider that owns the shared middlewares.
   * Empty means the shared middlewares are not referenced: a middleware
   * of another provider cannot be named without its provider.
   */
  middlewareProvider: string;
  /** CIDRs allowed to use the relay dispatch header. */
  allowedCidrs: string[];
  /** Optional shared secret (registry endpoint and relay dispatch). */
  secret: string;
  /** Directory holding state, pidfile and logs. */
  stateDir: string;
  /** Format of the served dynamic configuration document. */
  documentFormat: DocumentFormat;
  /** Maximum size of the log file before rotation. */
  logMaxBytes: number;
  /** Number of rotated log files to keep. */
  logKeep: number;
  /**
   * Whether the daemon may be started automatically (D7).
   *
   * Kept for compatibility: the install starts no daemon, and the lazy
   * start is always on. The value is read and ignored.
   */
  autostart: boolean;
}
