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
 *      ranges of RFC 1918 and the IPv6 range that are their equivalent) and
 *      no e-mail address outside the domains that are reserved for
 *      examples. They catch the leak that is not in the list above: the
 *      address that was added yesterday, the account of another
 *      installation;
 *   3. **the one e-mail address the package may carry**: the support
 *      address, which is named on purpose (see
 *      `PUBLIC_CONTACT_ADDRESSES` below).
 *
 * What stays on purpose: the name of the package and the organisation it
 * belongs to. They are the name of the package, not the data of an
 * installation, and the guard does not touch them. The Docker network name
 * of that installation is not in the list either: it is an ordinary word,
 * and the compiled type declarations of the package use it. The network name
 * is an example in the documentation, and the generic rules are what keep
 * the addresses of a private network out.
 *
 * The git server of the project is in the list now (S31). It used to be an
 * exception: the manifest named it in `repository`, `homepage`, `bugs` and
 * `funding`, and the README named it as the place the source of the package
 * lives. The published package names no repository at all now — a package
 * that everybody can install from npmjs.org does not point a reader at a
 * private host — and the guard keeps it that way. When the project gets a
 * public mirror, its host goes into `PUBLIC_GIT_HOST` below, the fields of
 * the manifest come back, and the guard stops protecting that one host.
 *
 * The guard grew a second half in S35. The first half keeps the data of
 * the installation out of the package; the second half keeps the package
 * from pointing at anything it does not carry. A published package that
 * names a file it does not ship is a trap: the reader follows the pointer
 * and finds nothing, or — worse — finds something of the machine the
 * package was written for. The traps that were found in S35 were of that
 * kind: the skill's architecture reference named the design document of
 * the repository, and the setup guide named a paragraph of it. Neither
 * file is in the tarball.
 *
 * The second half reads the documentation the package ships and asks two
 * questions of every path it names:
 *
 *   1. **does the package ship it?** The directories the package ships
 *      are listed in `SHIPPED_DIRECTORIES` below, one by one, so that the
 *      rule can be read instead of guessed. A path into a directory the
 *      package does not ship is a trap; a path into one it does ship has
 *      to name a file that is really there. A path into a name that is
 *      neither — a directory that exists nowhere, not even in the
 *      repository — is a trap as well, when the name it ends in is a
 *      file of the project. The paths of the reader's own machine
 *      (`/etc/traefik/config.yml`), the paths inside a URL and the
 *      paths of an API are not files of the package, and the guard does
 *      not ask about them;
 *   2. **is it the internal numbering of the project?** A number of a
 *      paragraph, a story or a decision of the internal specification is
 *      a pointer into a text that is not published. The published text
 *      says the thing itself, not where it stands in a document the
 *      reader does not have.
 *
 * What the second half does not read: the compiled output under `dist/`
 * and the code under `scripts/` and `bin/`. That is code, not prose for
 * the reader, and the code of a checkout refers to the sources on purpose
 * — the launcher of the package runs the TypeScript source when it is in
 * a checkout and the compiled output when it is installed.
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
  { value: 'gitea.home.malarstrom.com', what: 'the host of the git server of the project' },
];

/**
 * The public host of the source of the package.
 *
 * There is none: the project has no public mirror yet, and the published
 * package names no repository. The constant is empty on purpose — an empty
 * host means that no host is allowed to appear in the tarball. When a
 * public mirror exists, its host goes here and the guard protects that one
 * host instead of protecting the private one.
 */
const PUBLIC_GIT_HOST: string = '';

/**
 * The names of the git servers the package must not name.
 *
 * The internal installation runs its own git server, and the name of that
 * server in the published package is a trace of it: a reader learns which
 * service holds the source, and where to ask for it. The name is listed
 * here so that the guard catches it wherever it hides — in the manifest, in
 * the readme, in a link or in a path of a workflow file.
 */
const GIT_SERVER_NAMES = ['gitea'];

/**
 * The contact addresses that the published package names on purpose.
 *
 * The support address of the package is the address a reader writes to, so
 * it has to be public and it has to be in the published package: the README
 * names it in the support section and in the security section. The
 * maintainer of the package decided on 2026-11-01 that this address is the
 * support channel of the package and that it may be published. It is the one
 * e-mail address the published package carries, and the guard accepts it
 * exactly.
 *
 * The allowance is narrow on purpose. The domain of the address is the
 * personal domain of the installation the package was written for, and the
 * guard keeps that domain forbidden everywhere else: only the places that
 * lie inside this exact address are allowed.
 *
 * The address of the ACME account is not on this list. That account belongs
 * to the installation the package was written for, and its address says
 * nothing to a reader of the package. It stays forbidden, like every other
 * identifier of that installation.
 */
const PUBLIC_CONTACT_ADDRESSES: string[] = ['npm@malarstrom.se'];

/**
 * The directories the published package ships.
 *
 * The list is written out one by one, so that the rule the guard applies
 * can be read instead of guessed: a path into a directory that is not on
 * this list is a path into the repository of the project, and the reader
 * of the installed package does not have that directory. A path into a
 * directory that is on the list has to name a file that is really in the
 * tarball.
 *
 * The list is the allow-list of the manifest (`files`): `dist`, `bin`,
 * `scripts`, `skills` and `docs`.
 */
const SHIPPED_DIRECTORIES = ['bin/', 'dist/', 'docs/', 'scripts/', 'skills/'];

/**
 * The files the published package ships in its root.
 *
 * The same rule as above, for the files that are not in a directory: the
 * manifest, the readme, the changelog and the licence. Every other file
 * of the root of the repository — the contributing guide, the security
 * policy, the product description, the lock file — is not in the package,
 * and the documentation must not point at it.
 *
 * The contributing guide left the package in S43: it describes the
 * repository of the project, not the package, and it names the branch the
 * pull requests of the project go to. A reader of the installed package
 * has no pull request to open.
 */
const SHIPPED_ROOT_FILES = ['CHANGELOG.md', 'LICENSE', 'README.md', 'package.json'];

/**
 * The scripts the published package ships (S43).
 *
 * The package runs four scripts at the moments of the life of an
 * installation: `postinstall` writes the configuration and starts
 * nothing, `preuninstall` stops the daemon and `postuninstall` removes
 * the state that belongs to the installation. All three read the paths of
 * the installation out of `paths.mjs`, so that script travels with them.
 *
 * The fifth script of the repository — `clean-dist.mjs`, which removes
 * the build output — stays out: it belongs to the build of a checkout,
 * and the installed package has no build output of its own to remove.
 */
const SHIPPED_SCRIPTS = [
  'scripts/paths.mjs',
  'scripts/postinstall.mjs',
  'scripts/postuninstall.mjs',
  'scripts/preuninstall.mjs',
];

/**
 * The numbers of the internal specification.
 *
 * The published text says the thing itself. It does not say in which
 * paragraph of a document the reader does not have the thing stands.
 *
 *   - `§9.6` — a paragraph of the internal specification;
 *   - `S8` — a story of the internal plan;
 *   - `D3` — a decision of the internal specification;
 *   - `avsnitt 4` — the same as the paragraph, in words.
 */
const INTERNAL_NUMBERING: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /§\s*\d/g, what: 'the number of a paragraph of the internal specification' },
  { pattern: /\bS\d+\b/g, what: 'the number of a story of the internal plan' },
  { pattern: /\bD\d+\b/g, what: 'the number of a decision of the internal specification' },
  { pattern: /\bavsnitt\s+\d/gi, what: 'the number of a paragraph of the internal specification' },
];

/**
 * A path in a text: segments separated by slashes.
 *
 * The pattern is deliberately greedy about the segments and lazy about
 * everything around them: a word is not a path, and the guard only looks
 * at the texts that hold a slash.
 */
const PATH_TOKEN = /[A-Za-z0-9_][\w.-]*(?:\/[A-Za-z0-9_*][\w.*-]*)*\/?/g;

/**
 * The kinds of file the project itself carries.
 *
 * A path that ends in one of these names a file of the project: a
 * document, a source, a piece of code, a configuration. A path that ends
 * in something else is something else than a pointer at a file — a host
 * name, a port, a network, a path on the machine of the reader.
 *
 * The list is here so that the rule "a path into a name that exists
 * nowhere is a trap" does not fire on the paths the documentation has a
 * right to name: the configuration of the proxy on the reader's own
 * machine, the address of an API, the number of a network.
 */
const POINTER_EXTENSIONS = ['.md', '.ts', '.js', '.mjs', '.json', '.yml', '.yaml', '.txt'];

/**
 * Is the path that starts at `index` a path of the reader's own machine?
 *
 * Three things are not pointers at a file of the package:
 *
 *   - a path inside a URL: the reader follows the link, not a file of
 *     the installation;
 *   - a path that begins at the root of a file system
 *     (`/etc/traefik/config.yml`): a file of the machine of the reader;
 *   - a path that begins at the home of the reader
 *     (`~/.config/gatewarden/config.json`): the same.
 *
 * The placeholder of the documentation (`<state>/wiring/traefik.yml`) is
 * a path of the reader too: the reader fills it in.
 */
function isPathOfTheReader(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/\.+$/, '');
  if (/(?:\/\/|:\/\/)$/.test(before)) return true;
  return /[~$</]$/.test(before);
}

/**
 * Does the place at `index` lie inside one of the allowed contact
 * addresses?
 *
 * The guard reads the files of the tarball as text, and the domain of the
 * support address is a part of that text. A place inside an allowed address
 * is not a leak: it is the address the package is allowed to carry.
 */
function insidePublicAddress(text: string, index: number): boolean {
  for (const address of PUBLIC_CONTACT_ADDRESSES) {
    let start = text.indexOf(address);
    while (start !== -1) {
      if (index >= start && index < start + address.length) return true;
      start = text.indexOf(address, start + 1);
    }
  }
  return false;
}

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

/**
 * The names of the top-level directories of the repository.
 *
 * The directories the project is made of: the ones the package ships and
 * the ones it does not. The hidden directories and `node_modules` are not
 * part of the project and are not counted.
 */
function repositoryDirectories(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .sort();
}

/**
 * The names of the files in the root of the repository.
 *
 * The same rule for the files: the ones the package ships and the ones it
 * does not.
 */
function repositoryFiles(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The paths a text names.
 *
 * Only the texts that hold a slash are paths; a word on its own is not.
 * The punctuation of the sentence is not part of the path, so the trailing
 * dots and commas are taken off before the path is looked up.
 */
function pathTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(PATH_TOKEN)) {
    const token = match[0].replace(/[.,;:)]+$/, '');
    if (!token.includes('/')) continue;
    // A path of the reader's own machine is not a pointer at a file of
    // the package. It is skipped here, so that it is never asked about.
    if (isPathOfTheReader(text, match.index ?? 0)) continue;
    tokens.push(token.replace(/\/$/, ''));
  }
  return tokens;
}

/**
 * Does the package ship this path?
 *
 * A path is in the package when the tarball holds the file itself, or
 * when it holds files under it — that is how a directory of the package
 * is in the package.
 */
function resolvesInPackage(token: string, shipped: string[]): boolean {
  const wanted = token.replace(/^\.\//, '');
  return shipped.some((file) => file === wanted || file.startsWith(`${wanted}/`));
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

  test('the tarball holds only the files the package needs', () => {
    // The tarball is what every user of the package downloads, and the
    // rule of the package is that it carries what the installation and
    // the running of it need — and nothing else. The files below are the
    // ones that do not belong there, and each of them has a reason:
    //
    //   - the contributing guide describes the repository of the project
    //     and names the branch the pull requests go to. It is a document
    //     for the people who work on the project, not for the people who
    //     install the package;
    //   - `clean-dist.mjs` removes the build output of a checkout. The
    //     installed package has no build output of its own, and npm
    //     never runs the build of an installed package;
    //   - a source map carries the whole TypeScript source of the
    //     package in `sourcesContent`. The package ships the compiled
    //     output and its declarations; the source is the source of the
    //     repository, and it is not needed to install the package or to
    //     run it.
    for (const file of ['CONTRIBUTING.md', 'scripts/clean-dist.mjs']) {
      assert.ok(!files.includes(file), `the tarball holds ${file}, which the package does not need`);
    }

    const maps = files.filter((file) => file.endsWith('.map'));
    assert.deepEqual(maps, [], `the tarball holds source maps: ${maps.join(', ')}`);

    // The scripts of the package are named one by one, so that a script
    // that comes along without being needed is caught here.
    const scripts = files.filter((file) => file.startsWith('scripts/')).sort();
    assert.deepEqual(scripts, [...SHIPPED_SCRIPTS].sort(), 'the tarball holds the wrong scripts');

    // The root of the package holds the files the reader of the package
    // needs, and no other file of the root of the repository.
    const rootFiles = files.filter((file) => !file.includes('/')).sort();
    assert.deepEqual(rootFiles, [...SHIPPED_ROOT_FILES].sort(), 'the tarball holds the wrong files in its root');
  });

  test('the tarball holds no identifier of this installation', () => {
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const { value, what } of INSTALLATION_IDENTIFIERS) {
        let index = text.indexOf(value);
        while (index !== -1) {
          // A public mirror of the source, when there is one, is allowed.
          const onPublicHost = PUBLIC_GIT_HOST !== '' && text.startsWith(PUBLIC_GIT_HOST, index - PUBLIC_GIT_HOST.length + value.length);
          // The domain of the support address is a part of that address.
          const inPublicAddress = insidePublicAddress(text, index);
          if (!onPublicHost && !inPublicAddress) hits.push(`${file}:${lineOf(text, index)}: "${value}" — ${what}`);
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

  test('the tarball names no git server', () => {
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const name of GIT_SERVER_NAMES) {
        const pattern = new RegExp(name, 'gi');
        for (const match of text.matchAll(pattern)) {
          hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — the name of a git server`);
        }
      }
    }

    assert.deepEqual(
      hits,
      [],
      'the published package names a git server; the published package names no repository:\n' + hits.join('\n'),
    );
  });

  test('the manifest of the package names no repository', () => {
    // The fields of the manifest that point at a repository are gone
    // (S31): `repository`, `homepage`, `bugs` and `funding`.
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    for (const field of ['repository', 'homepage', 'bugs', 'funding']) {
      assert.equal(manifest[field], undefined, `the manifest of the tarball still has "${field}"`);
    }
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

  test('the tarball holds no e-mail address of an account but the support address', () => {
    const hits: string[] = [];
    let support = 0;

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const match of text.matchAll(EMAIL)) {
        // The support address is public on purpose and is allowed.
        if (PUBLIC_CONTACT_ADDRESSES.includes(match[0].toLowerCase())) {
          support += 1;
          continue;
        }
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

    // The allowance is not a hole that may go quiet: the package has to
    // name the support address, or a reader has nowhere to write.
    assert.ok(support > 0, 'the published package names no support address');
  });

  test('the published documentation points at no file the package does not ship', () => {
    // A reader of the installed package follows the paths the
    // documentation names. A path into a directory the package does not
    // ship leads nowhere: the file is in the repository of the project,
    // and the reader of the package does not have the repository. A path
    // into a directory the package does ship has to name a file that is
    // really in the tarball — otherwise it leads nowhere either.
    const hits: string[] = [];
    const directories = repositoryDirectories();
    const unshippedFiles = repositoryFiles().filter((file) => !SHIPPED_ROOT_FILES.includes(file));
    const shippedDirectories = new Set<string>();
    for (const file of files) {
      const parts = file.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        shippedDirectories.add(parts.slice(0, index).join('/'));
      }
    }

    for (const file of files.filter((name) => name.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      const lines = text.split('\n');
      const directory = path.posix.dirname(file);

      lines.forEach((line, index) => {
        for (const token of pathTokens(line)) {
          const first = token.split('/')[0];
          if (SHIPPED_DIRECTORIES.includes(`${first}/`)) {
            // A path into a directory of the package: the file it names
            // has to be in the tarball.
            if (!resolvesInPackage(token, files)) {
              hits.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
            }
            continue;
          }
          if (directories.includes(first)) {
            hits.push(`${file}:${index + 1}: "${token}" — the package ships no "${first}/" directory`);
            continue;
          }
          // A path that is relative to the file that names it: the skill
          // points at the files next to it. It is a pointer into the
          // package, and the file it names has to be there.
          if (shippedDirectories.has(`${directory}/${first}`) && !resolvesInPackage(`${directory}/${token}`, files)) {
            hits.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
            continue;
          }
          // A path into a name that is neither a directory of the package
          // nor a directory of the repository: it exists nowhere. The
          // rule of the guard says that a path into a directory the
          // package does not ship is a trap, and this is one. It is only
          // a pointer when the name it ends in is a file of the project;
          // a host name, a port, a network and a path on the machine of
          // the reader are something else, and those are not asked about
          // here.
          if (
            POINTER_EXTENSIONS.some((extension) => token.endsWith(extension)) &&
            !resolvesInPackage(token, files) &&
            !resolvesInPackage(`${directory}/${token}`, files)
          ) {
            hits.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
          }
        }

        // A file of the root of the repository that the package does not
        // ship: the security policy, the product description, the lock
        // file. The name of such a file is a pointer to a file the
        // reader does not have.
        for (const name of unshippedFiles) {
          const pattern = new RegExp(`(?<![\\w.-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`);
          if (pattern.test(line)) hits.push(`${file}:${index + 1}: "${name}" — the package does not ship that file`);
        }
      });
    }

    assert.deepEqual(
      hits,
      [],
      'the published documentation points at files the package does not ship:\n' + hits.join('\n'),
    );
  });

  test('the published documentation uses no number of the internal specification', () => {
    // The published text says the thing itself. A number of a paragraph,
    // a story or a decision of the internal specification points into a
    // document the reader of the package does not have.
    const hits: string[] = [];

    for (const file of files.filter((name) => name.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const { pattern, what } of INTERNAL_NUMBERING) {
        for (const match of text.matchAll(pattern)) {
          hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — ${what}`);
        }
      }
    }

    assert.deepEqual(
      hits,
      [],
      'the published documentation names the internal numbering of the project:\n' + hits.join('\n'),
    );
  });

  test('the manifest points at the files the package ships', () => {
    // The manifest is what npm reads to build the tarball and what a
    // consumer reads to find the package. Every path in it has to be in
    // the tarball: a path that is not there is a pointer into a file the
    // reader of the package does not have.
    //
    // The `scripts` of the manifest are not read here, and that is on
    // purpose: they are the commands of the checkout — `npm test` runs
    // the test files of the repository, and `npm run test:e2e` runs the
    // end-to-end tools of the repository. They are commands, not paths
    // into the package, and npm does not run them when the package is
    // installed.
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      main: string;
      types: string;
      files: string[];
      bin: Record<string, string>;
      exports: Record<string, Record<string, string>>;
      pi: { extensions: string[]; skills: string[] };
    };
    const hits: string[] = [];

    const check = (value: string, what: string): void => {
      if (!resolvesInPackage(value, files)) hits.push(`${what}: "${value}" — the tarball does not hold it`);
    };

    for (const entry of manifest.files) check(entry, 'files');
    for (const [name, entry] of Object.entries(manifest.bin)) check(entry, `bin.${name}`);
    check(manifest.main, 'main');
    check(manifest.types, 'types');
    for (const [subpath, conditions] of Object.entries(manifest.exports)) {
      for (const [condition, value] of Object.entries(conditions)) check(value, `exports.${subpath}.${condition}`);
    }
    for (const entry of manifest.pi.extensions) check(entry, 'pi.extensions');
    for (const entry of manifest.pi.skills) check(entry, 'pi.skills');

    assert.deepEqual(hits, [], 'the manifest points at files the package does not ship:\n' + hits.join('\n'));
  });

  test('the package ships the directories it says it ships', () => {
    // The list of the shipped directories is the rule the check above
    // uses. It has to be true: a directory that is not in the tarball
    // cannot be pointed at.
    for (const directory of SHIPPED_DIRECTORIES) {
      const name = directory.replace(/\/$/, '');
      assert.ok(
        files.some((file) => file === name || file.startsWith(`${name}/`)),
        `the tarball holds no "${directory}" directory`,
      );
    }
    for (const file of SHIPPED_ROOT_FILES) {
      assert.ok(files.includes(file), `the tarball holds no "${file}"`);
    }
  });
});
