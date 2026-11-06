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

/** Parse an IPv6 address into a 128 bit BigInt, or null. */
export function ipv6ToBigInt(address: string): bigint | null {
  let text = address;
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(':')) return null;

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toBytes = (group: string): number[] | null => {
    if (group.includes('.')) {
      const value = ipv4ToInt(group);
      if (value === null) return null;
      return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    return [(value >>> 8) & 0xff, value & 0xff];
  };

  const groups: string[] = [];
  if (halves.length === 2) {
    const head = halves[0] === '' ? [] : halves[0].split(':');
    const tail = halves[1] === '' ? [] : halves[1].split(':');
    if (head.length + tail.length > 7) return null;
    groups.push(...head);
    for (let index = head.length; index < 8 - tail.length; index += 1) groups.push('0');
    groups.push(...tail);
  } else {
    groups.push(...(halves[0] === '' ? [] : halves[0].split(':')));
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const part = toBytes(group);
    if (!part) return null;
    bytes.push(...part);
  }
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

/** Mask for a prefix length in a 32 bit address. */
function ipv4Mask(bits: number): number {
  if (bits <= 0) return 0;
  return (0xffffffff << (32 - bits)) >>> 0;
}

/** Mask for a prefix length in a 128 bit address. */
function ipv6Mask(bits: number): bigint {
  if (bits <= 0) return 0n;
  return ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
}

/** True when `address` falls inside the CIDR `cidr` (IPv4 or IPv6). */
export function addressInCidr(address: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/');
  const addr = normaliseAddress(address);
  const net = normaliseAddress(network);
  if (bitsRaw === undefined) return addr === net;
  const bits = Number(bitsRaw);

  const addr4 = ipv4ToInt(addr);
  const net4 = ipv4ToInt(net);
  if (addr4 !== null && net4 !== null) {
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    return (addr4 & ipv4Mask(bits)) === (net4 & ipv4Mask(bits));
  }

  const addr6 = ipv6ToBigInt(addr);
  const net6 = ipv6ToBigInt(net);
  if (addr6 !== null && net6 !== null) {
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) return false;
    return (addr6 & ipv6Mask(bits)) === (net6 & ipv6Mask(bits));
  }

  return false;
}

/** True when the remote address is allowed by any of the CIDRs. */
export function isAddressAllowed(address: string | undefined, cidrs: string[]): boolean {
  if (!address) return false;
  const addr = normaliseAddress(address);
  return cidrs.some((cidr) => addressInCidr(addr, cidr));
}

/**
 * True when the address is the loopback of the machine itself.
 *
 * `127.0.0.0/8` and `::1` — the addresses a process on this machine
 * uses to talk to this machine. They are not the network: only a
 * process here can have one.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const addr = normaliseAddress(address);
  if (addr === '::1') return true;
  return addressInCidr(addr, '127.0.0.0/8');
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
