/**
 * The Traefik binary of the test environment (§11.2).
 *
 * The container has no Docker and no Docker socket, so the test proxy
 * cannot be a container. The test therefore downloads the Traefik
 * binary — the same version as the user's (3.7.16) — from the GitHub
 * releases, and runs it as a process of its own.
 *
 * The binary is kept in a cache directory between the runs, so that the
 * test does not download fifty megabytes every time. The download is
 * checked against the checksum file of the release.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** The name of the release asset for a platform. */
function assetName(version: string, platform: NodeJS.Platform, arch: string): string {
  const os = platform === 'win32' ? 'windows' : platform;
  const cpu = arch === 'arm64' ? 'arm64' : 'amd64';
  if (platform === 'win32') {
    throw new Error('the test environment does not run on Windows: Traefik is not extracted there');
  }
  return `traefik_v${version}_${os}_${cpu}.tar.gz`;
}

/** The URL of the release asset. */
export function assetUrl(version: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return `https://github.com/traefik/traefik/releases/download/v${version}/${assetName(version, platform, arch)}`;
}

/** The URL of the checksum file of the release. */
export function checksumsUrl(version: string): string {
  return `https://github.com/traefik/traefik/releases/download/v${version}/traefik_v${version}_checksums.txt`;
}

/**
 * Extract one file out of a gzipped tar archive.
 *
 * The archive of a release holds a handful of files, and the tar format
 * is simple enough to read here: a header of 512 bytes, the name, the
 * size in octal, and the contents padded to a multiple of 512 bytes.
 */
export function extractFromTarGz(archive: Buffer, wanted: string): Buffer | undefined {
  const tar = zlib.gunzipSync(archive);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const type = header.subarray(156, 157).toString('utf8');
    offset += 512;
    if (name && (name === wanted || path.basename(name) === wanted)) {
      return tar.subarray(offset, offset + size);
    }
    if (type === '5') continue; // a directory: the contents follow
    offset += Math.ceil(size / 512) * 512;
    void prefix;
  }
  return undefined;
}

/** The checksum of a buffer. */
export function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** The checksum of a file on disk. */
export function sha256File(file: string): string {
  return sha256(fs.readFileSync(file));
}

/** The path of the Traefik binary in the cache. */
export function binaryPath(cacheDir: string, version: string): string {
  const name = process.platform === 'win32' ? 'traefik.exe' : 'traefik';
  return path.join(cacheDir, `traefik-v${version}`, name);
}

/**
 * Make sure the Traefik binary is there, and return its path.
 *
 * A binary that is already in the cache is used as it is. Otherwise the
 * release is downloaded, checked against the checksum file of the
 * release, and the binary is written next to it.
 */
export async function ensureTraefikBinary(
  cacheDir: string,
  version: string,
  log: (line: string) => void = () => {},
): Promise<string> {
  const target = binaryPath(cacheDir, version);
  if (fs.existsSync(target)) {
    log(`traefik v${version} is already in the cache (${target})`);
    return target;
  }

  const url = assetUrl(version);
  log(`downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`the download of ${url} failed with ${response.status} ${response.statusText}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());

  const checksums = await fetch(checksumsUrl(version), { redirect: 'follow' });
  if (!checksums.ok) {
    throw new Error(
      `the checksum file of the release could not be read (${checksums.status} ${checksums.statusText}): ` +
        'the download is not used without it',
    );
  }
  const text = await checksums.text();
  const wanted = assetName(version, process.platform, process.arch);
  const line = text.split('\n').find((entry) => entry.trim().endsWith(` ${wanted}`));
  const expected = line?.trim().split(/\s+/)[0];
  if (!expected) {
    throw new Error(`the checksum file of the release does not name ${wanted}: the download is not used without it`);
  }
  const actual = sha256(archive);
  if (actual !== expected) {
    throw new Error(`the checksum of ${wanted} does not match the one of the release (${actual} != ${expected})`);
  }
  log(`the checksum of ${wanted} is the one of the release`);

  const binary = extractFromTarGz(archive, process.platform === 'win32' ? 'traefik.exe' : 'traefik');
  if (!binary) {
    throw new Error(`the archive of the release does not hold a Traefik binary for ${process.platform}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, binary, { mode: 0o755 });
  log(`traefik v${version} is ready (${target})`);
  return target;
}

export interface TraefikProcess {
  /** The process of the proxy. */
  child: ChildProcess;
  /** The pid of the proxy. */
  pid: number;
  /** The log of the proxy. */
  logFile: string;
}

/**
 * Start the test proxy.
 *
 * The proxy is a child of the test: the test stops it when it is done,
 * and nothing else has to know about it.
 */
export function startTraefik(
  binary: string,
  configFile: string,
  logFile: string,
  cwd: string = path.dirname(logFile),
): TraefikProcess {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  const child = spawn(binary, ['--configFile', configFile], {
    stdio: ['ignore', out, out],
    // The proxy writes its own files (the storage of the resolver) in
    // the directory of the environment, and never in the repository.
    cwd,
    env: { ...process.env, GODEBUG: 'x509sha1=1' },
  });
  fs.closeSync(out);
  if (child.pid === undefined) {
    throw new Error('the test proxy did not start');
  }
  return { child, pid: child.pid, logFile };
}

/** Stop the test proxy and wait for it to be gone. */
export async function stopTraefik(proxy: TraefikProcess, timeoutMs = 5000): Promise<void> {
  if (proxy.child.exitCode !== null || proxy.child.signalCode !== null) return;
  proxy.child.kill('SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proxy.child.exitCode !== null || proxy.child.signalCode !== null) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  proxy.child.kill('SIGKILL');
}
