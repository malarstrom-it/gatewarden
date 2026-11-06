/**
 * The adapter types.
 *
 * The contract itself is defined in the core module `proxy`, because
 * the core consumes it and the core must never import an adapter. This
 * module re-exports it, so that an adapter, and everything that writes an
 * adapter, has one place to import the contract from.
 */

export type { DiscoverOptions, ProxyAdapter, ProxyInfo } from '../core/proxy.ts';
