/** Shared types for the dev gateway. */

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
  /** IP this container advertises to Traefik for the relay/registry services. */
  advertisedIp: string;
  /**
   * Host name or IP this container is reachable under from the Traefik
   * container (the Docker network `private`). Defaults to `advertisedIp`;
   * set it to the stable container name once the user has one.
   */
  advertisedHost: string;
  /** DNS zone the FQDNs are built from. */
  zone: string;
  /** Host name of the index router. */
  indexHost: string;
  /** Traefik entryPoint names the routers attach to. */
  entryPoints: string[];
  /** Name of the Traefik ACME certificate resolver (empty = no tls block). */
  certResolver: string;
  /** Certificate granularity: `wildcard` (one certificate per project) or `fqdn` (one per branch). */
  tlsMode: 'wildcard' | 'fqdn';
  /** Reference the user's `default-security-headers` middleware (file provider) on dev routers. */
  securityHeaders: boolean;
  /** Reference the user's `compress` middleware (file provider) on dev routers. */
  compressMiddleware: boolean;
  /** Name of the Traefik provider that owns the shared middlewares (`file` in the user's setup). */
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
  /** Whether `postinstall` may start the daemon (D7). */
  autostart: boolean;
}
