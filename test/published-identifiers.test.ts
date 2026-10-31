/**
 * The published package carries no data of this installation (S14).
 *
 * What is in the tarball is what the world gets: the package is published
 * on npmjs.org, and every file that goes into it is read by every user who
 * installs it. The package was written for one installation, and the data of
 * that installation — the zone of its DNS, the addresses of its machines,
 * the host names of its containers, the e-mail address of its certificate
 * account — must not travel with it.
 *
 * This test is the guard that keeps it out. It packs the package the way
 * `test/packaging.test.ts` does, reads the files that go into the tarball,
 * and fails when one of them holds an identifier of that installation.
 *
 * The lists it checks, and why:
 *
 *   1. **the identifiers of that installation**, one by one: the ACME
 *      account e-mail, the DNS zone, the private address ranges and the
 *      internal host names. They are named one by one, so that a failure
 *      says what leaked and in which file — and so that the next person
 *      can see what the guard is for;
 *   2. **the generic rules**: no address of a private network (the IPv4
 *      ranges of RFC 1918 and the IPv6 range that is their equivalent) and
 *      no e-mail address outside the domains that are reserved for
 *      examples. They catch the leak that is not in the list above: the
 *      address that was added yesterday, the account of another
 *      installation.
 *
 * What stays on purpose: the name of the package and the organisation it
 * belongs to. They are the name of the package, not the data of an
 * installation, and the guard does not touch them. The Docker network name
 * of that installation is not in the list either: it is an ordinary word,
 * and the compiled type declarations of the package use it. The network name
 * is an example in the documentation, and the generic rules are what keep
 * the addresses of a private network out.
 *
 * The git server of the project is an exception of the same kind. The
 * manifest names it in `repository`, `homepage`, `bugs` and `funding`, and
 * the README names it as the place the source of the package lives. That is
 * where the source is, and a package without it is a package nobody can
 * look into. The host carries the DNS zone of the installation in its name,
 * and the guard would otherwise read every one of those lines as a leak.
 * The exception is the host of the git server, not the zone: the zone on its
 * own is still a leak.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The identifiers of the installation the package was written for.
 *
 * Every entry is a value that names that installation and nobody else: an
 * account, a domain, an address, a host name. A package for the world
 * carries none of them.
 */
const INSTALLATION_IDENTIFIERS: Array<{ value: string; what: string }> = [
  { value: 'mikael@malarstrom.se', what: 'the ACME account e-mail of that installation' },
  { value: 'malarstrom.se', what: 'the personal domain of that installation' },
  { value: 'home.malarstrom.com', what: 'the DNS zone of that installation' },
  { value: '172.16.2.0/24', what: 'the trust list (the CIDR) of that installation' },
  { value: '172.16.2.13', what: 'the address of the gateway host of that installation' },
  { value: '172.16.2.1', what: 'the gateway address of the Docker network of that installation' },
  { value: '172.16.2.6', what: 'the address of the proxy of that installation' },
  { value: 'fdd0:0:0:2::d', what: 'the IPv6 address of that installation' },
  { value: 'fdd0:0:0:2::/64', what: 'the IPv6 prefix of that installation' },
  { value: 'devbox', what: 'the host name of that installation' },
  { value: 'devbox.private', what: 'the host name of that installation on its Docker network' },
  { value: 'e1e518cfcc56', what: 'the Docker-generated host name of that installation' },
  { value: 'ix-traefik-traefik-1.private', what: 'the fqdn of the proxy of that installation' },
  { value: 'truenas', what: 'the name of a service of that installation' },
  { value: 'homebridge', what: 'the name of a service of that installation' },
  { value: 'gitea-ssh', what: 'the name of an entry point of that installation' },
  { value: 'herdr-ssh', what: 'the name of an entry point of that installation' },
  { value: '/opt/devbox-traefik-api', what: 'the path of that installation on its machine' },
];

/**
 * The host of the git server of the project.
 *
 * The source of the package lives there, and the manifest names it. The
 * host is an exception to the zone it carries in its name.
 */
const PROJECT_HOST = 'gitea.home.malarstrom.com';

/**
 * The addresses of a private network.
 *
 * `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16` are the IPv4 ranges of
 * RFC 1918, and `fc00::/7` is their IPv6 equivalent. An address in one of
 * them names a network that exists only inside somebody's house: the
 * documentation uses the ranges of RFC 5737 (`192.0.2.0/24`,
 * `198.51.100.0/24`, `203.0.113.0/24`) and of RFC 3849 (`2001:db8::/32`)
 * instead.
 */
const PRIVATE_IPV4 = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;
const PRIVATE_IPV6 = /\b(?:f[cd][0-9a-f]{2}:[0-9a-f]{0,4}(?::[0-9a-f]{0,4})*)\b/gi;

/** An e-mail address. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * The domains that are reserved for examples.
 *
 * RFC 2606 reserves `example.com`, `example.net` and `example.org`, and
 * RFC 6761 reserves `.test` and `.invalid`. An address in one of them
 * belongs to nobody.
 */
const EXAMPLE_DOMAINS = new Set(['example.com', 'example.net', 'example.org', 'example', 'test', 'invalid']);

/**
 * The environment of a nested npm.
 *
 * The configuration of the npm that runs the test would otherwise leak into
 * the npm the test runs: `npm publish --dry-run` sets `npm_config_dry_run`,
 * and a nested npm that inherits it packs nothing.
 */
function npmEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_config_')) continue;
    if (key.startsWith('npm_lifecycle_') || key === 'npm_command' || key === 'npm_execpath') continue;
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Every file of a directory, relative to it. */
function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return found.sort();
}

/** The line a hit is on, counted from one. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('the published package', () => {
  let workdir = '';
  let packageDir = '';
  let files: string[] = [];

  before(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-identifiers-'));

    // 1. Pack the package, the way `test/packaging.test.ts` does. The
    //    `prepare` script builds it, so the tarball carries the compiled
    //    output the package ships.
    const packed = await execFileAsync('npm', ['pack', '--pack-destination', workdir], {
      cwd: REPO_ROOT,
      timeout: 600_000,
      env: npmEnv(),
    });
    const name = packed.stdout.trim().split('\n').pop() as string;

    // 2. Unpack it: the files that go into the tarball are the files the
    //    guard reads.
    packageDir = path.join(workdir, 'package');
    fs.mkdirSync(packageDir, { recursive: true });
    await execFileAsync('tar', ['-xzf', path.join(workdir, name), '-C', packageDir, '--strip-components=1'], {
      timeout: 120_000,
    });

    files = filesUnder(packageDir);
  });

  after(async () => {
    if (workdir === '') return;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  test('the tarball holds the files of the package', () => {
    // A guard that reads nothing guards nothing: the files below are the
    // ones that carried the data of the installation, and they have to be
    // in the tarball for the guard to mean anything.
    assert.ok(files.length > 50, `the tarball holds ${files.length} files — the guard would read nothing`);
    for (const file of ['README.md', 'LICENSE', 'docs/traefik.md', 'docs/setup.md', 'skills/gatewarden/SKILL.md', 'dist/core/config.js']) {
      assert.ok(files.includes(file), `the tarball does not hold ${file}`);
    }
  });

  test('the tarball holds no identifier of this installation', () => {
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const { value, what } of INSTALLATION_IDENTIFIERS) {
        let index = text.indexOf(value);
        while (index !== -1) {
          // The host of the git server of the project is named by the
          // manifest and by the README; the zone it carries in its name
          // is not a leak there.
          const onProjectHost =
            PROJECT_HOST.includes(value) && text.startsWith(PROJECT_HOST, index - (PROJECT_HOST.length - value.length));
          if (!onProjectHost) hits.push(`${file}:${lineOf(text, index)}: "${value}" — ${what}`);
          index = text.indexOf(value, index + value.length);
        }
      }
    }

    assert.deepEqual(
      hits,
      [],
      'the published package carries the data of the installation it was written for:\n' + hits.join('\n'),
    );
  });

  test('the tarball holds no address of a private network', () => {
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const pattern of [PRIVATE_IPV4, PRIVATE_IPV6]) {
        for (const match of text.matchAll(pattern)) {
          hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — an address of a private network`);
        }
      }
    }

    assert.deepEqual(
      hits,
      [],
      'the published package holds an address of a private network; the documentation uses the ranges of RFC 5737 and RFC 3849:\n' +
        hits.join('\n'),
    );
  });

  test('the tarball holds no e-mail address of an account', () => {
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const match of text.matchAll(EMAIL)) {
        const domain = (match[0].split('@')[1] ?? '').toLowerCase();
        const last = domain.split('.').pop() ?? '';
        if (EXAMPLE_DOMAINS.has(domain) || EXAMPLE_DOMAINS.has(last)) continue;
        hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — the address of an account`);
      }
    }

    assert.deepEqual(
      hits,
      [],
      'the published package holds the address of an account; the examples use the domains that RFC 2606 and RFC 6761 reserve:\n' +
        hits.join('\n'),
    );
  });
});
