/**
 * Minimal WebSocket helpers for the tests: an echo server and a client that
 * speaks RFC 6455 by hand (no dependencies).
 */

import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** Encode a text frame (unmasked, server to client). */
export function encodeTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  if (data.length < 126) {
    return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  }
  const header = Buffer.from([0x81, 126]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length, 0);
  return Buffer.concat([header, length, data]);
}

/** Encode a masked text frame (client to server). */
export function encodeMaskedTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  const mask = randomBytes(4);
  const masked = Buffer.from(data);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index] ^ mask[index % 4];
  }
  if (data.length < 126) {
    return Buffer.concat([Buffer.from([0x81, 0x80 | data.length]), mask, masked]);
  }
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length, 0);
  return Buffer.concat([Buffer.from([0x81, 0x80 | 126]), length, mask, masked]);
}

/** Decode one frame from a buffer. Returns null when more data is needed. */
export function decodeFrame(buffer: Buffer): { opcode: number; payload: Buffer; size: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  let maskKey: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (maskKey) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = payload[index] ^ maskKey[index % 4];
    }
  }
  return { opcode, payload, size: offset + length };
}

export interface EchoServer {
  port: number;
  close: () => Promise<void>;
  /** Headers of the last handshake seen by the server. */
  lastHandshake: () => Record<string, string>;
}

/** Start a WebSocket echo server on an ephemeral port. */
export function startEchoServer(): Promise<EchoServer> {
  let handshake: Record<string, string> = {};
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let upgraded = false;

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString('utf8');
        buffer = buffer.subarray(end + 4);
        const lines = head.split('\r\n');
        handshake = {};
        for (const line of lines.slice(1)) {
          const colon = line.indexOf(':');
          if (colon > 0) handshake[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
        const key = handshake['sec-websocket-key'] ?? '';
        socket.write(
          ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(key)}`, '', ''].join('\r\n'),
        );
        upgraded = true;
      }
      while (true) {
        const frame = decodeFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.size);
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x1) socket.write(encodeTextFrame(frame.payload.toString('utf8')));
      }
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        lastHandshake: () => handshake,
        close: async () => {
          for (const socket of sockets) socket.destroy();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

/**
 * Open a WebSocket connection to `port`, send `message` and wait for the
 * echoed reply.
 */
export function wsRoundTrip(
  port: number,
  path: string,
  message: string,
  headers: Record<string, string> = {},
): Promise<{ reply: string; handshake: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    let handshake: Record<string, string> = {};
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('websocket round trip timed out'));
    }, 5000);

    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.on('connect', () => {
      const key = randomBytes(16).toString('base64');
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        '',
      ];
      socket.write(lines.join('\r\n'));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString('utf8');
        buffer = buffer.subarray(end + 4);
        handshake = {};
        for (const line of head.split('\r\n').slice(1)) {
          const colon = line.indexOf(':');
          if (colon > 0) handshake[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
        if (!/^HTTP\/1\.1 101/.test(head)) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`handshake failed: ${head.split('\r\n')[0]}`));
          return;
        }
        upgraded = true;
        socket.write(encodeMaskedTextFrame(message));
      }
      while (true) {
        const frame = decodeFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.size);
        if (frame.opcode === 0x1) {
          clearTimeout(timer);
          socket.end();
          resolve({ reply: frame.payload.toString('utf8'), handshake });
          return;
        }
      }
    });
  });
}
