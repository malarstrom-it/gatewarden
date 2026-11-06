/**
 * The dispatch protocol.
 *
 * The proxy tells the relay which route a request belongs to by stamping a
 * header on it; the relay resolves the value to `127.0.0.1:<port>` and
 * proxies the request.
 *
 * The names live in the core, because the core is the side that reads them:
 * an adapter stamps them, the relay reads them. The core does not know how
 * a proxy stamps a header, only which header carries the route.
 */

/** Header the proxy stamps with the dispatch target. */
export const DISPATCH_HEADER = 'X-Dev-Target';
/** Header carrying the optional shared secret to the relay. */
export const RELAY_SECRET_HEADER = 'X-Relay-Secret';
/** Header the proxy sends to the registry endpoint when a secret is configured. */
export const REGISTRY_SECRET_HEADER = 'X-Registry-Secret';
