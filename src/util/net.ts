/** Small networking helpers (no dependencies). */

import net from 'node:net';

/** Parse an IPv4 address into a 32 bit integer, or null. */
export function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/** Normalise an address: strip IPv4-mapped IPv6 prefixes and zone ids. */
export function normaliseAddress(address: string | undefined | null): string {
  let addr = (address ?? '').trim();
  if (addr.startsWith('[') && addr.includes(']')) addr = addr.slice(1, addr.indexOf(']'));
  const pct = addr.indexOf('%');
  if (pct >= 0) addr = addr.slice(0, pct);
  if (addr.toLowerCase().startsWith('::ffff:')) addr = addr.slice(7);
  return addr;
}

/** True when `address` falls inside the CIDR `cidr` (IPv4 only). */
export function addressInCidr(address: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/');
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  const addr = ipv4ToInt(normaliseAddress(address));
  const net = ipv4ToInt(normaliseAddress(network));
  if (addr === null || net === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) === (net & mask);
}

/** True when the remote address is allowed by any of the CIDRs. */
export function isAddressAllowed(address: string | undefined, cidrs: string[]): boolean {
  if (!address) return false;
  const addr = normaliseAddress(address);
  if (addr === '::1' || addr === '127.0.0.1') return cidrs.some((c) => c === '::1/128' || c === '127.0.0.1/32');
  return cidrs.some((cidr) => addressInCidr(addr, cidr));
}

/** True when the TCP port on 127.0.0.1 accepts a connection. */
export function isPortListening(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
