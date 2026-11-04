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
 * This test is the guard that keeps private data out. It packs the package
 * the way `test/packaging.test.ts` does, reads the files that go into the
 * tarball, and fails when one of them carries something private.
 *
 * The rules it applies, and why:
 *
 *   1. **no address of a private network**: the IPv4 ranges of RFC 1918
 *      (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and the IPv6
 *      range that is their equivalent (`fc00::/7`). A network that exists
 *      only inside somebody's house names the house;
 *   2. **no e-mail address of an account** outside the domains that are
 *      reserved for examples (RFC 2606 and RFC 6761). The one address the
 *      package may carry is the support address of the package, which is
 *      public by the decision of its maintainer (see
 *      `PUBLIC_CONTACT_ADDRESSES` below). The rule reads the documents of
 *      the repository as well: the security policy and the contributing
 *      guide are not in the tarball, and they name the same address as
 *      the readme;
 *   3. **no number of the internal numbering**: the number of a paragraph,
 *      a story or a decision points into a text the reader of the package
 *      does not have;
 *   4. **no pointer at a file the package does not ship**, in the
 *      documentation and in the code;
 *   5. **no git server but the public one**: the published package names
 *      the host of the public repository and no other git server. The
 *      host of the public repository goes into `PUBLIC_GIT_HOST` below,
 *      and the hosts of the other git servers are caught by the patterns
 *      of `GIT_SERVER_HOSTS` below.
 *
 * The rules are the guard, and they are the whole of it. The values of the
 * installation the package was written for are not written down in this
 * file, and they must not be: the repository is about to become public,
 * and a list of the values of the installation in a public repository
 * publishes the very values the guard keeps out of the tarball. The one
 * name that is left is the support address of the package, in
 * `PUBLIC_CONTACT_ADDRESSES` below. It is public by the decision of the
 * maintainer of the package, it is in the README of the package, and the
 * rule of the reserved domains would catch it if it were not allowed on
 * purpose.
 *
 * The rules above stand in their place, and they are narrower than the
 * list of the identifiers was. They catch the address that was added
 * yesterday and the account of another installation — the two kinds of
 * value that have a shape a rule can recognise: an address and an
 * account. A host name, a service name, the zone of the DNS and the path
 * of the installation have no such shape. A plain word is not a private
 * address and not the address of an account, so no rule of the guard
 * catches them, and the guard does not catch them today either. Nothing
 * of that kind is in the tarball, and the values of the installation are
 * not written down in this repository any more, so the guard has no way
 * of knowing them. When the repository goes public, the values go out of
 * it with the scrubbing of the history (see the procedure in
 * `CONTRIBUTING.md`), and the guard keeps what has a shape out of the
 * tarball.
 *
 * A rule that cannot fail guards nothing, so every rule has a value that
 * proves that it fires. The values are in `RULE_PROBES` below: they are the
 * values of the standards — the ranges of the private networks, an address
 * of an account outside the reserved domains, a number of the internal
 * numbering, a path of a file the package does not ship, the name of a git
 * server — and not one of them names anything of this installation.
 *
 * What stays on purpose: the name of the package and the organisation it
 * belongs to. They are the name of the package, not the data of an
 * installation, and the guard does not touch them. The Docker network name
 * of that installation is not guarded either: it is an ordinary word, and
 * the compiled type declarations of the package use it. The network name is
 * an example in the documentation, and the rules are what keep the
 * addresses of a private network out.
 *
 * The published package names the public repository (S23). It used to name
 * no repository at all: the manifest named no repository, the README named
 * no place where the source of the package lives, and the guard kept the
 * package from naming any. The repository of the project lives on GitHub
 * now, and the package points at it: the manifest names it in
 * `repository`, `homepage` and `bugs`, and the README names it as the
 * place where the source of the package lives.
 *
 * The guard follows that move. The host of the public repository goes into
 * `PUBLIC_GIT_HOST` below, and it is the one host the package may name.
 * The host of the private server the repository left is caught by the
 * patterns of `GIT_SERVER_HOSTS` below, and that rule is a rule about the
 * host and not about the word: the prose of the repository may say in
 * words that the repository left the private server, and that is not a
 * leak.
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
 * The second half reads the code of the package as well (S56). The code
 * is not prose for the reader, but it names files in the same way: an
 * import that points into a directory the package does not ship, a path
 * in a message, a file the code looks for. The reader of the installed
 * package follows the imports of the code as surely as the links of the
 * documentation, so the code is read with the same rule.
 *
 * The paths of the code are resolved the way the code resolves them: a
 * path in a compiled file is relative to the file that names it, and a
 * module that the code names without its extension is the module with
 * the extension of the world the code runs in.
 *
 * Two kinds of name in the code are not pointers, and the guard reads
 * them as what they are: the names of the methods of the MCP protocol
 * (`tools/list` is a method, not a path into the `tools/` directory of
 * the repository), and the files of a checkout that the code looks for on
 * purpose (the marker that says that the package sits in a checkout, and
 * the name of the file of the daemon that a sentence names). They are
 * listed in `PROTOCOL_METHOD_NAMES`, `CHECKOUT_NAMES` and
 * `CHECKOUT_FILE_NAMES` below, and the reason is written there.
 *
 * The rule that reads the code was sharpened in S83. It had four gaps,
 * and they are closed:
 *
 *   1. **a name without a directory part is a pointer too.** The code
 *      that says "run `worker.ts`" points at a file of the repository
 *      that the reader of the package does not have, and the rule
 *      reads such names now;
 *   2. **an exception is read the way it is written.** A method of the
 *      protocol is a name the code uses when the whole path is that
 *      name; a file of a checkout is a file the code names when the
 *      path it points at is that file. An exception is never a word
 *      that happens to be in a path, and it never silences a path that
 *      points into a directory the package does not ship;
 *   3. **a path into a directory the package ships is a trap when the
 *      file is not there.** The reader of the package follows the path,
 *      and the file has to be there to be found;
 *   4. **the internal numbering is read in the code as well.** The
 *      code of the package is published too, and a number of a
 *      paragraph, a story or a decision of the internal specification
 *      points into a text that is not published.
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
 * There is no list of the identifiers of the installation, and there may
 * not be one (S80).
 *
 * The list stood here until S80: nineteen values that named the
 * installation the package was written for — the e-mail address of its
 * certificate account, its personal domain, the zone of its DNS, the
 * private address ranges and the host names of its machines. The list was
 * a good rule for a repository of one installation: a failure said what
 * leaked and in which file.
 *
 * The repository is about to become public, and there the list publishes
 * the very values it is meant to keep out of the tarball. The values are
 * also stale the day somebody renames something, and a list that is stale
 * is a list that no longer guards anything.
 *
 * The rules of the guard take their place, and they are narrower than the
 * list was. They catch the two kinds of value that have a shape a rule can
 * recognise — an address and an account — and they do not catch a host
 * name, a service name, the zone of the DNS or the path of the
 * installation: a plain word is neither an address nor an account. The
 * header of this file says the same, and the values themselves are not
 * written down in this repository any more.
 */

/**
 * The public host of the source of the package.
 *
 * The repository of the project lives on GitHub, and the published package
 * points at it: the manifest names it in `repository`, `homepage` and
 * `bugs`, and the README names it as the place where the source of the
 * package lives. The host of that repository is the one host the published
 * package may name, and it is the constant here.
 *
 * The host is the whole of the allowance. The rule does not ask who wrote
 * a text and it does not ask for a permission: it asks whether the name
 * that stands in the text is the host of the public repository. A text
 * that names another host is caught, whether it names it in a URL or in
 * the prose of a sentence.
 */
const PUBLIC_GIT_HOST: string = 'github.com';

/**
 * The names of the git servers the package must not name.
 *
 * The list is empty, and it is empty on purpose. The published package
 * names a git server now: the source of the package lives on one, and the
 * package says so. A list of the names of the software would keep the
 * package from naming the server its own source lives on, and the name of
 * the software is not a private address in the first place.
 *
 * The rule that keeps the private server out is the rule of the hosts
 * below: that rule is about the address, and not about the word.
 */
const GIT_SERVER_NAMES: string[] = [];

/**
 * The hosts of the git servers the package must not name.
 *
 * The repository left a private server of its own, and the address of that
 * server is a trace of it: a reader learns which service holds the source
 * of the project, and where to ask for it. The address is not written down
 * here, and it may not be: the repository is about to become public, and
 * an address written down in a public repository is the very thing this
 * rule keeps out of the tarball.
 *
 * The patterns catch the shape of such an address instead of the address
 * itself: the name of the software, a dot, and a domain. Every host of
 * that shape is caught, wherever it hides — in the manifest, in the
 * readme, in a link or in a path of a workflow file. The host of the
 * public repository is the one place a name may stand, and it is in
 * `PUBLIC_GIT_HOST` above.
 *
 * The patterns need the `g` flag: the rule takes them with `matchAll`.
 */
const GIT_SERVER_HOSTS = [/\bgitea\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi];

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
 * The allowance is narrow on purpose. It is the address itself and nothing
 * else, and every other address of an account is caught by the rule of the
 * reserved domains.
 *
 * The address of the ACME account is not on this list. That account belongs
 * to the installation the package was written for, and its address says
 * nothing to a reader of the package. It is caught by the rule of the
 * reserved domains, like every other address of an account.
 */
const PUBLIC_CONTACT_ADDRESSES: string[] = ['npm@malarstrom.se'];

/**
 * The documents of the repository that name an address to write to.
 *
 * The rule of the addresses above reads the tarball. Two of the documents
 * that name an address are not in the tarball: the security policy and
 * the contributing guide. They are read by the people who write to the
 * package, and they are part of the repository that goes public. They name
 * the same address as the readme — the support address of the package —
 * and the rule reads them too.
 */
const CONTACT_DOCUMENTS = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md'];

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
 * The script that emptied the build output of a checkout is gone (S62):
 * the manifest names no file for it, so the package ships no script of
 * the build at all. The command that empties the build output removes it
 * itself.
 */
const SHIPPED_SCRIPTS = [
  'scripts/paths.mjs',
  'scripts/postinstall.mjs',
  'scripts/postuninstall.mjs',
  'scripts/preuninstall.mjs',
];

/**
 * The files of the checkout that the commands of the manifest name (S62).
 *
 * The manifest names the files of the package: a script of it that runs
 * for the reader names a file of the tarball, and so does every other
 * script that names a file at all.
 *
 * The commands of the checkout are the exception, and they are named one
 * by one here: the build names the build configuration of the project,
 * the test command the test files, the end-to-end commands the tools of
 * the end-to-end environment, and the clean command the marker that says
 * "this is a checkout". A script that is not on this list names only
 * files that the package ships — or no file at all.
 */
const CHECKOUT_FILES: Record<string, string[]> = {
  build: ['tsconfig.build.json'],
  clean: ['tsconfig.build.json'],
  test: ['test/*.test.ts'],
  'test:e2e': ['tools/testenv/run.ts'],
  'test:e2e:stop': ['tools/testenv/stop.ts'],
};

/**
 * The scripts npm runs for the life of an installation (S62).
 *
 * `prepare` runs when the package is installed from a git repository and
 * when it is packed, `postinstall` when the package is installed, and
 * `preuninstall` and `postuninstall` when it is removed. The four have to
 * be in the manifest.
 *
 * The files the install scripts name have to be in the tarball: a reader
 * of an installed package has nothing else. `prepare` and
 * `prepublishOnly` name no file at all: they run the build and the tests
 * of the checkout, and the checkout is there when they run.
 */
const LIFECYCLE_SCRIPTS = ['prepare', 'postinstall', 'preuninstall', 'postuninstall'];

/**
 * The code the published package ships (S56).
 *
 * The guard reads the code of the package with the rule it uses for the
 * documentation: a path that names a file the package does not ship is a
 * trap, in the code as well as in the prose.
 *
 * The list is the extensions of the code the package ships — the
 * compiled output under `dist/`, the launchers under `bin/` and the
 * scripts of the installation under `scripts/`. The declarations under
 * `dist/` are not read: a declaration names the source it describes
 * (`./state.ts` for a file the package ships as `state.d.ts`), and that
 * is what a declaration file is.
 */
const SHIPPED_CODE_EXTENSIONS = ['.js', '.mjs'];

/**
 * The names of the methods of the MCP protocol.
 *
 * `tools/list` and `tools/call` are the names of the methods of the Model
 * Context Protocol, not paths: the protocol names a method with two words
 * and a slash. The repository of the project happens to have a `tools/`
 * directory, and the guard would read the name of the method as a path
 * into it. The names are listed here so that the guard knows them.
 */
const PROTOCOL_METHOD_NAMES = ['tools/call', 'tools/list'];

/**
 * The files of the repository the code of the package names on purpose.
 *
 * The names are names the code uses rather than pointers a reader
 * follows:
 *
 *   - `tsconfig.build.json`, the marker the code looks for to know that
 *     it sits in a checkout. The code probes for the file; it does not
 *     read it.
 *
 * The source the launchers run in a checkout is not on the list: a
 * launcher names the compiled module it runs, and the source is derived
 * from that name. A path of the source in the package is a path the
 * reader of the package cannot follow, and the rule catches it.
 */
const CHECKOUT_NAMES = ['tsconfig.build.json'];

/**
 * The names of the files of a checkout that the code names on its own.
 *
 * A name without a directory part is a pointer at a file of the
 * repository, and the reader of the package does not have the file. The
 * code names `daemon.ts` in a sentence about the launcher of the daemon,
 * so the name is allowed here.
 */
const CHECKOUT_FILE_NAMES = ['daemon.ts'];

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
 * Does the place at `index` lie inside the allowed text?
 *
 * The guard reads the files of the tarball as text, and the public host of
 * the project is a part of that text. A place inside it is not a leak: it
 * is the place where the source of the package lives.
 */
function inside(text: string, index: number, allowed: string): boolean {
  if (allowed === '') return false;
  let start = text.indexOf(allowed);
  while (start !== -1) {
    if (index >= start && index < start + allowed.length) return true;
    start = text.indexOf(allowed, start + 1);
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
 * What the rules of the guard read when they look at the package.
 */
interface GuardContext {
  /** Every file of the tarball. */
  files: string[];
  /** The directories of the repository of the project. */
  directories: string[];
  /** The files of the root of the repository that the package does not ship. */
  unshippedFiles: string[];
  /** The directories the tarball holds, by the path that names them. */
  shippedDirectories: Set<string>;
  /** The names of the files of the repository that the package does not ship. */
  unshippedNames: Set<string>;
}

/**
 * What the rules need to know about a package and about the repository.
 */
function guardContext(files: string[]): GuardContext {
  const shippedDirectories = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      shippedDirectories.add(parts.slice(0, index).join('/'));
    }
  }

  return {
    files,
    directories: repositoryDirectories(),
    unshippedFiles: repositoryFiles().filter((file) => !SHIPPED_ROOT_FILES.includes(file)),
    shippedDirectories,
    unshippedNames: unshippedRepositoryNames(files),
  };
}

/**
 * The addresses of a private network in a file.
 *
 * The ranges of RFC 1918 and the IPv6 range that is their equivalent. A
 * network that exists only inside somebody's house names the house.
 */
function privateNetworkTraps(file: string, text: string): string[] {
  const hits: string[] = [];
  for (const pattern of [PRIVATE_IPV4, PRIVATE_IPV6]) {
    for (const match of text.matchAll(pattern)) {
      hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — an address of a private network`);
    }
  }
  return hits;
}

/**
 * The addresses of an account in a file.
 *
 * The domains that RFC 2606 and RFC 6761 reserve belong to nobody, and the
 * support address of the package is public by the decision of its
 * maintainer. Every other address names an account, and the guard catches
 * it.
 */
function accountAddressTraps(file: string, text: string): string[] {
  const hits: string[] = [];
  for (const match of text.matchAll(EMAIL)) {
    // The support address is public on purpose and is allowed.
    if (PUBLIC_CONTACT_ADDRESSES.includes(match[0].toLowerCase())) continue;
    const domain = (match[0].split('@')[1] ?? '').toLowerCase();
    const last = domain.split('.').pop() ?? '';
    if (EXAMPLE_DOMAINS.has(domain) || EXAMPLE_DOMAINS.has(last)) continue;
    hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — the address of an account`);
  }
  return hits;
}

/**
 * The number of the times a text names the support address of the package.
 *
 * The allowance is not a hole that may go quiet: the package has to name
 * the support address, or a reader has nowhere to write.
 */
function supportAddressCount(text: string): number {
  let count = 0;
  for (const match of text.matchAll(EMAIL)) {
    if (PUBLIC_CONTACT_ADDRESSES.includes(match[0].toLowerCase())) count += 1;
  }
  return count;
}

/**
 * The names of the git servers in a file.
 *
 * The published package names the host of the public repository and no
 * other git server. The names of the software are not caught any more —
 * the package names a git server now, and the name of the software is not
 * a private address — and the hosts of the other git servers are caught
 * by the patterns of `GIT_SERVER_HOSTS`.
 *
 * The host of the public repository is the one place a name may stand: the
 * guard protects the private host and not the public one.
 */
function gitServerTraps(file: string, text: string, publicHost: string = PUBLIC_GIT_HOST): string[] {
  const hits: string[] = [];

  for (const name of GIT_SERVER_NAMES) {
    const pattern = new RegExp(name, 'gi');
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (inside(text, index, publicHost)) continue;
      hits.push(`${file}:${lineOf(text, index)}: "${match[0]}" — the name of a git server`);
    }
  }

  for (const pattern of GIT_SERVER_HOSTS) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (inside(text, index, publicHost)) continue;
      hits.push(`${file}:${lineOf(text, index)}: "${match[0]}" — the host of a git server`);
    }
  }

  return hits;
}

/**
 * The fields of the manifest that point at a repository.
 *
 * The manifest of the published package names the public repository: the
 * `repository`, `homepage` and `bugs` fields point at it, and the rule
 * checks that they name the host of `PUBLIC_GIT_HOST`.
 *
 * The `funding` field stays out. The package needs no money, and a field
 * that points at a place to send money is a field the rule does not want.
 */
const REPOSITORY_FIELDS = ['repository', 'homepage', 'bugs'];

/**
 * The traps of the fields of the manifest.
 *
 * The manifest of the published package names the public repository, and
 * it names it in every field that points at one: the three fields of
 * `REPOSITORY_FIELDS` have to be there, and each of them has to name the
 * host of `PUBLIC_GIT_HOST`. A field that names another host is a trap: a
 * reader of the package follows it and lands on a server the package does
 * not live on.
 *
 * The `funding` field is a trap of its own: the package needs no money,
 * and the field has no business being in the manifest.
 */
function repositoryTraps(manifest: Record<string, unknown>): string[] {
  const traps: string[] = [];

  for (const field of REPOSITORY_FIELDS) {
    const value = manifest[field];
    if (value === undefined) {
      traps.push(`${field}: the manifest has no such field`);
      continue;
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text.includes(PUBLIC_GIT_HOST)) {
      traps.push(`${field}: "${text}" — the field does not name the public repository`);
    }
  }

  if (manifest.funding !== undefined) {
    traps.push('funding: the manifest has a "funding" field');
  }

  return traps;
}

/**
 * The paths of one documentation file of the package that the package does
 * not ship.
 *
 * A reader of the installed package follows the paths the documentation
 * names. A path into a directory the package does not ship leads nowhere:
 * the file is in the repository of the project, and the reader of the
 * package does not have the repository. A path into a directory the package
 * does ship has to name a file that is really in the tarball — otherwise it
 * leads nowhere either.
 */
function documentationPathTraps(file: string, text: string, context: GuardContext): string[] {
  const traps: string[] = [];
  const lines = text.split('\n');
  const directory = path.posix.dirname(file);

  lines.forEach((line, index) => {
    for (const token of pathTokens(line)) {
      const first = token.split('/')[0];
      if (SHIPPED_DIRECTORIES.includes(`${first}/`)) {
        // A path into a directory of the package: the file it names has
        // to be in the tarball.
        if (!resolvesInPackage(token, context.files)) {
          traps.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
        }
        continue;
      }
      if (context.directories.includes(first)) {
        traps.push(`${file}:${index + 1}: "${token}" — the package ships no "${first}/" directory`);
        continue;
      }
      // A path that is relative to the file that names it: the skill
      // points at the files next to it. It is a pointer into the
      // package, and the file it names has to be there.
      if (
        context.shippedDirectories.has(`${directory}/${first}`) &&
        !resolvesInPackage(`${directory}/${token}`, context.files)
      ) {
        traps.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
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
        !resolvesInPackage(token, context.files) &&
        !resolvesInPackage(`${directory}/${token}`, context.files)
      ) {
        traps.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
      }
    }

    // A file of the root of the repository that the package does not
    // ship: the security policy, the product description, the lock
    // file. The name of such a file is a pointer to a file the reader
    // of the package does not have.
    for (const name of context.unshippedFiles) {
      const pattern = new RegExp(`(?<![\\w.-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`);
      if (pattern.test(line)) traps.push(`${file}:${index + 1}: "${name}" — the package does not ship that file`);
    }
  });

  return traps;
}

/**
 * The values that prove that the rules of the guard fire.
 *
 * A rule that cannot fail guards nothing. Every entry of the list is a
 * value that breaks one rule of the guard, the file of the tarball the
 * value is planted in, and the rule itself.
 *
 * The values are the values of the standards and nothing else: an address
 * of the ranges of RFC 1918, an address of the IPv6 range that is their
 * equivalent, an address of an account outside the domains RFC 2606 and
 * RFC 6761 reserve, a number of the internal numbering, a path of a file
 * the package does not ship, the host of a git server. They name no
 * installation and no host of this project, and they may be written here
 * in a public repository.
 *
 * The list is the proof that the guard still catches what it has to catch
 * after the identifiers of the installation left it (S80): the guard
 * protects the published package against private data, and not against the
 * values of the installation the package was written for.
 */
const RULE_PROBES: Array<{
  /** The rule that the value breaks. */
  what: string;
  /** The value that breaks the rule. */
  value: string;
  /** The file of the tarball the value is planted in. */
  file: string;
  /** The rule itself, run over the planted file. */
  find: (file: string, text: string, context: GuardContext) => string[];
}> = [
  {
    what: 'an address of a private network (the ranges of RFC 1918)',
    value: '192.168.7.21',
    file: 'README.md',
    find: (file, text) => privateNetworkTraps(file, text),
  },
  {
    what: 'an address of a private network (the IPv6 range that is their equivalent)',
    value: 'fd12:3456::1',
    file: 'README.md',
    find: (file, text) => privateNetworkTraps(file, text),
  },
  {
    what: 'the address of an account outside the reserved domains',
    value: 'operator@acme-account.org',
    file: 'README.md',
    find: (file, text) => accountAddressTraps(file, text),
  },
  {
    what: 'the number of a paragraph of the internal specification',
    value: '§4.2',
    file: 'README.md',
    find: (file, text) => internalNumberingTraps(file, text),
  },
  {
    what: 'the number of a story of the internal plan',
    value: 'S8',
    file: 'README.md',
    find: (file, text) => internalNumberingTraps(file, text),
  },
  {
    what: 'the number of a decision of the internal specification',
    value: 'D3',
    file: 'README.md',
    find: (file, text) => internalNumberingTraps(file, text),
  },
  {
    what: 'the number of a paragraph of the internal specification, in words',
    value: 'avsnitt 4',
    file: 'README.md',
    find: (file, text) => internalNumberingTraps(file, text),
  },
  {
    what: 'the host of a git server',
    value: 'gitea.example.com',
    file: 'README.md',
    find: (file, text) => gitServerTraps(file, text),
  },
  {
    what: 'a pointer at a file the package does not ship, in the documentation',
    value: 'docs/not-shipped.md',
    file: 'README.md',
    find: (file, text, context) => documentationPathTraps(file, text, context),
  },
  {
    what: 'a pointer at a file the package does not ship, in the code',
    value: 'dist/not-shipped.js',
    file: 'bin/gatewarden.js',
    find: (file, text, context) => codePathTraps(file, text, context),
  },
];

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

/**
 * A name in a command of the manifest.
 *
 * The name is read out of the command as a whole and not word by word:
 * the command of the clean script is a piece of code, and a name between
 * two slashes is a part of a path as much as a name that stands alone.
 */
const SCRIPT_NAME = /[A-Za-z0-9_*][\w.*-]*(?:\/[A-Za-z0-9_*][\w.*-]*)*/g;

/**
 * The files a command of the manifest names.
 *
 * The command of a script is a line of a shell: `npm run clean && tsc -p
 * tsconfig.build.json`. The words of the line are not files, and neither
 * are the flags. What is left is a path: a file of the repository, or a
 * pattern of files.
 */
function filesNamed(command: string): string[] {
  const named: string[] = [];

  for (const match of command.matchAll(SCRIPT_NAME)) {
    const file = match[0].replace(/^\.\//, '');
    if (!file.includes('/') && !/\.(?:js|mjs|cjs|ts|json)$/.test(file)) continue;

    named.push(file);
  }

  return named;
}

/** Is there such a file in the checkout? */
function existsInCheckout(file: string): boolean {
  const star = file.indexOf('*');
  if (star === -1) return fs.existsSync(path.join(REPO_ROOT, file));

  // A pattern of files: the directory of the pattern and the pattern
  // itself.
  const directory = file.slice(0, star).replace(/\/?[^/]*$/, '');
  const pattern = file
    .slice(star)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const full = path.join(REPO_ROOT, directory);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return false;

  return fs.readdirSync(full).some((entry) => new RegExp(`^${pattern}$`).test(entry));
}

/** The line a hit is on, counted from one. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/**
 * The numbers of the internal specification that a text names.
 *
 * The published text says the thing itself, and so does the published
 * code: a number of a paragraph, a story or a decision of the internal
 * specification points into a document the reader of the package does
 * not have.
 */
function internalNumberingTraps(file: string, text: string): string[] {
  const hits: string[] = [];

  for (const { pattern, what } of INTERNAL_NUMBERING) {
    for (const match of text.matchAll(pattern)) {
      hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — ${what}`);
    }
  }

  return hits;
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

/**
 * A path in the code: segments separated by slashes, with the relative
 * beginning kept.
 *
 * The pattern of the documentation throws the relative beginning away,
 * because a path of the documentation is read against the root of the
 * package. A path of the code is read against the file that names it,
 * so the beginning has to survive: `../worker` in `dist/core/daemon.js`
 * is `dist/worker.js` in the package, and `src/worker.ts` in a checkout.
 */
const CODE_PATH_TOKEN = /(?:\.\.\/|\.\/)*[A-Za-z0-9_][\w.-]*(?:\/[A-Za-z0-9_*][\w.*-]*)*\/?/g;

/**
 * Does the path that starts at `index` begin at the file that names it?
 *
 * A path that begins at `./` or at `../` is relative to the file that
 * names it. Every other path is read against the root of the package.
 *
 * The beginning of the path is the beginning of the path itself: the
 * path says whether it is relative, not the word in front of it.
 */
function isRelativePath(text: string, index: number): boolean {
  return text.startsWith('../', index) || text.startsWith('./', index);
}

/**
 * The paths the code names.
 *
 * The paths of the reader's own machine are not pointers at a file of
 * the package, and they are left out here, exactly as they are left out
 * of the documentation. A path that is relative to the file that names
 * it is kept: it is a pointer into the package, and the rule has to
 * follow it there.
 */
function codePathTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(CODE_PATH_TOKEN)) {
    const token = match[0].replace(/[.,;:)]+$/, '');
    if (!token.includes('/')) continue;
    const index = match.index ?? 0;
    if (!isRelativePath(text, index) && isPathOfTheReader(text, index)) continue;
    tokens.push(token.replace(/\/$/, ''));
  }
  return tokens;
}

/**
 * The names the code uses without a directory part.
 *
 * A name on its own is a pointer as well: the code that says "run
 * `worker.ts`" points at a file of the repository that the reader of the
 * package does not have. The names that are a part of a path are left
 * out here — the path rule reads those, and it reads the whole path.
 */
function codeNameTokens(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(CODE_PATH_TOKEN)) {
    const token = match[0].replace(/[.,;:)]+$/, '');
    if (token.includes('/')) continue;
    if (isPathOfTheReader(text, match.index ?? 0)) continue;
    names.push(token);
  }
  return names;
}

/**
 * Is the module that the path names a file the package ships?
 *
 * The code of the package names a module without its extension when it
 * resolves it at runtime: `../worker` is `dist/worker.js` in the package
 * and `src/worker.ts` in a checkout. The rule follows the name to the
 * file it stands for.
 */
function resolvesAsModule(candidate: string, shipped: string[]): boolean {
  return shipped.some((file) => file.startsWith(`${candidate}.`));
}

/**
 * Does the package ship the file that the path names, under one of its
 * directories?
 *
 * The code of the package names a file of the core by the path it has
 * inside the core: `core/config.js` is `dist/core/config.js` in the
 * package. Such a name is a pointer into the package, and the package
 * holds the file.
 */
function shipsUnderShippedDirectory(token: string, shipped: string[]): boolean {
  return shipped.some((file) => file.endsWith(`/${token}`));
}

/**
 * Every file of the repository, relative to its root.
 *
 * The build output and the hidden directories are not part of the
 * repository: `dist/` is written by the build, and the hidden
 * directories belong to the tools of the project. `node_modules` is
 * installed, not written.
 */
function allRepositoryFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'dist') continue;
        walk(full);
      } else {
        found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(REPO_ROOT);
  return found.sort();
}

/**
 * The names of the files of the repository that the package does not
 * ship (S83).
 *
 * A name on its own is a pointer at a file of the repository, and the
 * reader of the package does not have the repository. The names of the
 * files of a checkout that the code names on purpose are left out: the
 * code may name such a file by its name alone (`daemon.ts` in a comment
 * about the launcher of the daemon).
 */
function unshippedRepositoryNames(shipped: string[]): Set<string> {
  const allowed = new Set([
    ...CHECKOUT_NAMES.map((name) => path.posix.basename(name)),
    ...CHECKOUT_FILE_NAMES,
  ]);
  const names = new Set<string>();

  for (const file of allRepositoryFiles()) {
    if (shipped.includes(file)) continue;
    const name = path.posix.basename(file);
    if (allowed.has(name)) continue;
    if (!POINTER_EXTENSIONS.some((extension) => name.endsWith(extension))) continue;
    names.add(name);
  }

  return names;
}

/**
 * The paths of one code file of the package that the package does not
 * ship (S56, S83).
 *
 * The rule is the rule of the documentation, with the paths of the code
 * resolved the way the code resolves them:
 *
 *   1. a path into a directory the package ships is a trap when the
 *      file is not there: the reader of the package follows the path,
 *      and the file has to be there to be found;
 *   2. a path into a directory of the repository is a trap: the package
 *      ships no such directory;
 *   3. a path that names a file of the project has to be a file the
 *      package ships.
 *
 * A path of the code is read in two ways, because the code names the
 * files of the package in two ways: against the root of the package
 * (`dist/core/config.js`) and against the file that names it
 * (`../worker` in `dist/core/daemon.js`). Both have to name a file that
 * the tarball holds.
 *
 * A name without a directory part is read as well: it is a pointer at a
 * file of the repository just as much as a path is.
 *
 * The two lists of exceptions are read the way they are written. A
 * method of the protocol is a name the code uses when the whole of the
 * path is that name (`tools/list`); a file of a checkout is a file the
 * code names when the path it points at is that file, or when it names
 * the file on its own (`tsconfig.build.json`). An exception is never a
 * word that happens to be in a path, and it never silences a path that
 * points into a directory the package does not ship.
 */
function codePathTraps(
  file: string,
  text: string,
  context: { files: string[]; directories: string[]; unshippedNames: Set<string> },
): string[] {
  const traps: string[] = [];
  const directory = path.posix.dirname(file);
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    for (const token of codePathTokens(line)) {
      // A method of the protocol is a name the code uses, and not a
      // path: the name has to be the whole of the path it is written
      // as. A path that only carries the name is a path, and it is
      // read as one.
      if (PROTOCOL_METHOD_NAMES.includes(token)) continue;

      const relative = token.startsWith('./') || token.startsWith('../');
      const rooted = token.replace(/^\.\/+/, '');
      const candidate = path.posix.normalize(path.posix.join(directory === '.' ? '' : directory, rooted));
      const first = (relative ? candidate : rooted).split('/')[0];

      // A file of a checkout that the code names on purpose: the
      // exception holds the path the code points at.
      if (CHECKOUT_NAMES.includes(candidate)) continue;

      const shipped =
        resolvesInPackage(rooted, context.files) ||
        resolvesInPackage(candidate, context.files) ||
        resolvesAsModule(candidate, context.files);

      if (SHIPPED_DIRECTORIES.includes(`${first}/`)) {
        if (!shipped) traps.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
        continue;
      }
      if (context.directories.includes(first)) {
        traps.push(`${file}:${index + 1}: "${token}" — the package ships no "${first}/" directory`);
        continue;
      }
      if (
        POINTER_EXTENSIONS.some((extension) => token.endsWith(extension)) &&
        !shipped &&
        !shipsUnderShippedDirectory(rooted, context.files)
      ) {
        traps.push(`${file}:${index + 1}: "${token}" — the package does not ship that file`);
      }
    }

    // A name of a file of the repository that the package does not
    // ship: the lock file, the build configuration, a script of the
    // project. The name alone is a pointer to a file the reader of the
    // package does not have.
    for (const name of codeNameTokens(line)) {
      if (context.unshippedNames.has(name)) {
        traps.push(`${file}:${index + 1}: "${name}" — the package does not ship that file`);
      }
    }
  });

  return traps;
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

  /**
   * The context the rule reads the code with.
   */
  const codeContext = (): GuardContext => guardContext(files);

  /**
   * The text of a copy of the tarball in which a line is planted in one
   * of its code files.
   *
   * A rule that cannot fail guards nothing, so the rule is run against
   * a tarball that has been broken on purpose.
   */
  const plant = (file: string, line: string): string => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-code-probe-'));
    try {
      fs.cpSync(packageDir, copy, { recursive: true });
      fs.appendFileSync(path.join(copy, file), `\n${line}\n`);

      return fs.readFileSync(path.join(copy, file), 'utf8');
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  };

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
    //   - a script that empties the build output of a checkout. The
    //     installed package has no build output of its own, and npm
    //     never runs the build of an installed package; the manifest
    //     names no file for it (S62), so the repository holds no such
    //     script either;
    //   - a source map carries the whole TypeScript source of the
    //     package in `sourcesContent`. The package ships the compiled
    //     output and its declarations; the source is the source of the
    //     repository, and it is not needed to install the package or to
    //     run it.
    assert.ok(!files.includes('CONTRIBUTING.md'), 'the tarball holds CONTRIBUTING.md, which the package does not need');

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

  test('the tarball names no git server', () => {
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      hits.push(...gitServerTraps(file, text));
    }

    assert.deepEqual(
      hits,
      [],
      'the published package names a git server; the published package names the public repository and no other:\n' +
        hits.join('\n'),
    );
  });

  test('the manifest of the package names the public repository', () => {
    // The manifest names the repository of the project: `repository`,
    // `homepage` and `bugs` point at the public repository, and every one
    // of them names the host of `PUBLIC_GIT_HOST`. A field that names
    // another host is caught, and a field that is missing is caught too:
    // the package points at its source, and the reader finds it.
    //
    // The `funding` field stays out: the package needs no money, and the
    // field has no business being in the manifest.
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    const traps = repositoryTraps(manifest);

    assert.deepEqual(traps, [], `the manifest of the tarball does not name the public repository:\n${traps.join('\n')}`);
  });

  test('the tarball holds no address of a private network', () => {
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      hits.push(...privateNetworkTraps(file, text));
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
      hits.push(...accountAddressTraps(file, text));
      support += supportAddressCount(text);
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

  test('the documents of the repository name the support address and no other address', () => {
    // The security policy and the contributing guide are not in the
    // tarball, and the rule of the tarball does not read them. They name
    // the address a reader writes to, and they name the same one as the
    // readme: the support address of the package.
    const hits: string[] = [];

    for (const file of CONTACT_DOCUMENTS) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      hits.push(...accountAddressTraps(file, text));
    }

    assert.deepEqual(
      hits,
      [],
      'a document of the repository names the address of an account; the documents of the project name the support address:\n' +
        hits.join('\n'),
    );

    // The security policy is the place a report goes to. It has to name
    // the support address, or a report has nowhere to go.
    const policy = fs.readFileSync(path.join(REPO_ROOT, 'SECURITY.md'), 'utf8');
    assert.ok(supportAddressCount(policy) > 0, 'the security policy names no support address');

    // The rule has to fire: a document that names another address is
    // caught. The value is the value of the standard and names nothing of
    // this installation.
    const planted = `${policy}\nWrite to operator@acme-account.org.\n`;
    assert.ok(
      accountAddressTraps('SECURITY.md', planted).length > 0,
      'the rule did not catch the address of an account in a document of the repository',
    );
  });

  test('the published documentation points at no file the package does not ship', () => {
    // A reader of the installed package follows the paths the
    // documentation names. A path into a directory the package does not
    // ship leads nowhere: the file is in the repository of the project,
    // and the reader of the package does not have the repository. A path
    // into a directory the package does ship has to name a file that is
    // really in the tarball — otherwise it leads nowhere either.
    const hits: string[] = [];
    const context = guardContext(files);

    for (const file of files.filter((name) => name.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      hits.push(...documentationPathTraps(file, text, context));
    }

    assert.deepEqual(
      hits,
      [],
      'the published documentation points at files the package does not ship:\n' + hits.join('\n'),
    );
  });

  test('the rule reads the code the package ships', () => {
    // A guard that reads nothing guards nothing (S56). The code of the
    // package is the compiled output under `dist/`, the launchers under
    // `bin/` and the scripts of the installation under `scripts/`. The
    // list of what the rule reads is written out here, so that a reader
    // of the guard sees what it looks at.
    const codeFiles = files.filter((name) => SHIPPED_CODE_EXTENSIONS.some((extension) => name.endsWith(extension)));

    assert.ok(codeFiles.length > 20, `the tarball holds ${codeFiles.length} code files — the rule would read nothing`);
    for (const file of ['bin/gatewarden.js', 'bin/entry.mjs', 'scripts/paths.mjs', 'dist/core/config.js']) {
      assert.ok(codeFiles.includes(file), `the rule does not read ${file}`);
    }

    console.log(`the published code the rule reads (${codeFiles.length} files):\n${codeFiles.join('\n')}`);
  });

  test('the published code points at no file the package does not ship', () => {
    // The code of the package is read by the rule of the documentation
    // (S56). A reader of the installed package follows the imports of
    // the code as surely as the links of the documentation: an import
    // that points at a file the package does not ship leads nowhere, and
    // a path in a message of the code is a pointer to a file the reader
    // of the package does not have.
    const hits: string[] = [];
    const context = codeContext();

    for (const file of files.filter((name) => SHIPPED_CODE_EXTENSIONS.some((extension) => name.endsWith(extension)))) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      hits.push(...codePathTraps(file, text, context));
    }

    assert.deepEqual(
      hits,
      [],
      'the published code points at files the package does not ship:\n' + hits.join('\n'),
    );
  });

  test('the allowances of the rule are names the shipped code uses', () => {
    // An allowance that nothing uses is a hole that may go quiet: the
    // name sits in the list and hides a path that is a trap. Every name
    // in the two lists has to be a name the shipped code really uses,
    // in the form the list holds it, and when the code stops using a
    // name, the name has to leave the list.
    //
    //   - a method of the protocol is used as the whole of a path;
    //   - a file of a checkout is used as the path the code points at,
    //     or as the name of the file when the file lies in the root of
    //     the repository (`tsconfig.build.json`).
    const codeFiles = files.filter((name) => SHIPPED_CODE_EXTENSIONS.some((extension) => name.endsWith(extension)));
    const paths = new Set<string>();
    const names = new Set<string>();
    const pointed = new Set<string>();

    for (const file of codeFiles) {
      const directory = path.posix.dirname(file);
      for (const line of fs.readFileSync(path.join(packageDir, file), 'utf8').split('\n')) {
        for (const token of codePathTokens(line)) {
          paths.add(token);
          const rooted = token.replace(/^\.\/+/, '');
          pointed.add(path.posix.normalize(path.posix.join(directory === '.' ? '' : directory, rooted)));
        }
        for (const name of codeNameTokens(line)) names.add(name);
      }
    }

    for (const name of PROTOCOL_METHOD_NAMES) {
      assert.ok(paths.has(name), `the shipped code does not use the method "${name}" — the name has to leave the list`);
    }

    for (const name of CHECKOUT_NAMES) {
      const used = pointed.has(name) || names.has(path.posix.basename(name));
      assert.ok(used, `the shipped code does not name the file "${name}" — the name has to leave the list`);
    }

    for (const name of CHECKOUT_FILE_NAMES) {
      assert.ok(names.has(name), `the shipped code does not name the file "${name}" — the name has to leave the list`);
    }
  });

  test('the rule catches a path in a code file of the tarball', () => {
    // A rule that cannot fail guards nothing. The rule is run against a
    // copy of the tarball in which a code file names a file that the
    // package does not ship; the rule has to catch it and say where it
    // is.
    const file = 'bin/gatewarden.js';
    const planted = 'docs/not-shipped.md';
    const hits = codePathTraps(file, plant(file, `const missing = '${planted}';`), codeContext());

    assert.equal(hits.length, 1, `the rule did not catch the planted path: ${JSON.stringify(hits)}`);
    assert.match(hits[0], new RegExp(`^${file}:\\d+: "${planted}" — the package does not ship that file$`));
  });

  test('the rule catches a name without a directory part in a code file', () => {
    // A name on its own is a pointer at a file of the repository: the
    // reader of the package does not have the repository, and the file
    // is not there to be found.
    const file = 'bin/gatewarden.js';
    const planted = 'worker.ts';
    const hits = codePathTraps(file, plant(file, `const missing = '${planted}';`), codeContext());

    assert.equal(hits.length, 1, `the rule did not catch the planted name: ${JSON.stringify(hits)}`);
    assert.match(hits[0], new RegExp(`^${file}:\\d+: "${planted}" — the package does not ship that file$`));
  });

  test('the rule catches a path that carries the name of an allowance in it', () => {
    // The name of a method of the protocol is a name the code uses when
    // the whole of the path is that name. A path that carries the name
    // in it is a path, and it points into the `tools/` directory of the
    // repository, which the package does not ship.
    const file = 'dist/worker.js';
    const planted = '../tools/list';
    const hits = codePathTraps(file, plant(file, `const missing = '${planted}';`), codeContext());

    assert.equal(hits.length, 1, `the rule did not catch the planted path: ${JSON.stringify(hits)}`);
    assert.match(hits[0], new RegExp(`^${file}:\\d+: "${planted}" — the package ships no "tools/" directory$`));
  });

  test('the rule catches a number of the internal numbering in a code file', () => {
    // The code of the package is published too, so it says the thing
    // itself and not in which paragraph of the internal specification
    // the thing stands.
    const file = 'bin/gatewarden.js';
    const text = plant(file, 'const story = "S8";\nconst decision = "D3";\nconst paragraph = "§9";');
    const hits = internalNumberingTraps(file, text);

    assert.equal(hits.length, 3, `the rule did not catch the planted numbers: ${JSON.stringify(hits)}`);
    assert.match(hits[0], new RegExp(`^${file}:\\d+: "§9" — the number of a paragraph of the internal specification$`));
    assert.match(hits[1], new RegExp(`^${file}:\\d+: "S8" — the number of a story of the internal plan$`));
    assert.match(hits[2], new RegExp(`^${file}:\\d+: "D3" — the number of a decision of the internal specification$`));
  });

  test('the published package uses no number of the internal specification', () => {
    // The published text says the thing itself. A number of a paragraph,
    // a story or a decision of the internal specification points into a
    // document the reader of the package does not have.
    //
    // The code of the package is read as well (S83): it is published
    // too, and a number in it points into the same document that the
    // reader does not have.
    const hits: string[] = [];
    const read = files.filter(
      (name) => name.endsWith('.md') || SHIPPED_CODE_EXTENSIONS.some((extension) => name.endsWith(extension)),
    );

    for (const file of read) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      hits.push(...internalNumberingTraps(file, text));
    }

    assert.deepEqual(
      hits,
      [],
      'the published package names the internal numbering of the project:\n' + hits.join('\n'),
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

  test('the scripts of the manifest point at files that are there', () => {
    // S62: the manifest must not name a file the package does not ship.
    //
    // npm runs the scripts of the install on the machine of the reader,
    // so the files they name have to be in the tarball: `postinstall`,
    // `preuninstall` and `postuninstall` are the moments of the life of
    // an installation, and the reader has nothing but the package.
    //
    // The commands of the checkout are the exception, and they are named
    // one by one: `build` names the build configuration, `test` the test
    // files, `test:e2e` the tools of the end-to-end environment, and
    // `clean` the marker that says "this is a checkout". Every other
    // script of the manifest names only files that the package ships —
    // or no file at all, which is what the clean command does: the
    // installed package has no build output of its own to empty, and the
    // manifest must not point at a file the reader does not have.
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const hits: string[] = [];

    for (const script of LIFECYCLE_SCRIPTS) {
      if (manifest.scripts[script] === undefined) hits.push(`${script}: the manifest has no such script`);
    }

    for (const [name, command] of Object.entries(manifest.scripts)) {
      for (const file of filesNamed(command)) {
        if ((CHECKOUT_FILES[name] ?? []).includes(file)) {
          // A file of the checkout, named on purpose: it has to be there.
          if (!existsInCheckout(file)) hits.push(`${name}: "${file}" — the checkout has no such file`);
          continue;
        }
        if (!files.includes(file)) hits.push(`${name}: "${file}" — the package does not ship that file`);
      }
    }

    // The list of the files of the checkout is a list and not a rule: a
    // file that is on it and that no command names any more is a rule
    // that has gone quiet.
    for (const [name, allowed] of Object.entries(CHECKOUT_FILES)) {
      const command = manifest.scripts[name];
      if (command === undefined) continue;

      for (const file of allowed) {
        if (!filesNamed(command).includes(file)) {
          hits.push(`${name}: "${file}" — the list names a file the command does not name`);
        }
      }
    }

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

  test('every rule of the guard catches the value that breaks it', () => {
    // A rule that cannot fail guards nothing. Every value of the list is
    // planted in a copy of the package, the rule that the value breaks is
    // run over the planted file, and the rule has to catch the value.
    //
    // The values are the values of the standards, and none of them names
    // the installation the package was written for: the guard protects
    // the published package against private data, and not against the
    // values of this installation (S80).
    const context = guardContext(files);

    for (const probe of RULE_PROBES) {
      const text = plant(probe.file, probe.value);
      const hits = probe.find(probe.file, text, context);

      assert.ok(hits.length > 0, `the guard did not catch "${probe.value}" — ${probe.what}`);

      // The rule may catch the part of the value it knows: the number of
      // a paragraph is `§4` when the paragraph is `§4.2`.
      const caught = hits.map((hit) => /"([^"]*)"/.exec(hit)?.[1] ?? '');
      assert.ok(
        caught.some((value) => value.includes(probe.value) || probe.value.includes(value)),
        `the guard caught "${caught[0]}" instead of "${probe.value}" — ${probe.what}`,
      );
    }
  });

  test('the guard catches a repository that names another host', () => {
    // The rule of the manifest is a rule of the published package: the
    // fields that point at a repository name the public repository, and
    // nothing else. A field that names another host is caught, and the
    // fields are named one by one, so that every one of them is checked.
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(repositoryTraps(manifest), [], 'the manifest of the tarball does not name the public repository');

    for (const field of REPOSITORY_FIELDS) {
      const planted = { ...manifest, [field]: 'https://gitea.example.org/malarstrom/traefik-api.git' };
      assert.ok(repositoryTraps(planted).length > 0, `the rule did not catch the planted "${field}"`);
    }

    const funded = { ...manifest, funding: 'https://example.com/donate' };
    assert.ok(repositoryTraps(funded).length > 0, 'the rule did not catch the planted "funding"');
  });

  test('the guard protects the private host and not the public one', () => {
    // The published package names the host of the public repository, and
    // the host of every other git server is caught. The public host is
    // the one place a name may stand — and it is the one place, even
    // when another host stands next to it.
    const privateText = 'The source of the package lives at gitea.example.com.';
    const publicText = 'The source of the package lives at github.com/malarstrom-it/gatewarden.';

    assert.deepEqual(
      gitServerTraps('README.md', privateText),
      ['README.md:1: "gitea.example.com" — the host of a git server'],
      'the guard did not catch the host of a git server',
    );
    assert.deepEqual(
      gitServerTraps('README.md', publicText),
      [],
      'the guard caught the public host of the project',
    );
    assert.deepEqual(
      gitServerTraps(
        'README.md',
        'The source of the package lives at github.com/malarstrom-it/gatewarden, and the old mirror at gitea.internal.example.',
      ),
      ['README.md:1: "gitea.internal.example" — the host of a git server'],
      'the guard let a host of a git server through that stands next to the public host',
    );
  });

  test('the guard allows the support address and the reserved domains', () => {
    // The one address the published package may carry is the support
    // address of the package, and the domains that RFC 2606 and RFC 6761
    // reserve belong to nobody. Every other address of an account is
    // caught.
    assert.deepEqual(accountAddressTraps('README.md', 'Write to npm@malarstrom.se.'), [], 'the support address was caught');
    assert.deepEqual(accountAddressTraps('README.md', 'Write to admin@example.com.'), [], 'a reserved domain was caught');
    assert.deepEqual(
      accountAddressTraps('README.md', 'Write to operator@acme-account.org.'),
      ['README.md:1: "operator@acme-account.org" — the address of an account'],
      'the address of an account was not caught',
    );
  });
});
