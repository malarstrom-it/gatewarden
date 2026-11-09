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
 *
 * The guard grew a third half in S105. The first half keeps the data of
 * the installation out of the package, and the second half keeps the
 * package from pointing at anything it does not carry. The third half
 * keeps the data of the installation out of the repository itself.
 *
 * The tarball is not the whole of the repository. The specification, the
 * memory of the project, the code of the project and the documents of
 * the repository are not in the tarball — and S101 took the values of
 * the installation out of them, because the repository is about to
 * become public. The guard read the tarball only, and the values could
 * come back into `specs/` and `memory/` without anything falling.
 *
 * The third half reads the files the package does not ship and asks one
 * question of every one of them: does it hold a value of the
 * installation? The question cannot be a question about a shape — the
 * zone of the DNS, the name of a host, the name of a service and the
 * path of an installation are ordinary words, and no rule of a shape
 * catches a word. The values are therefore read from the installation
 * itself: its own configuration file, its own route store and the DNS of
 * its zone. They are never written down here, and the rule reads
 * nothing on a machine that has no installation.
 *
 * The third half reads the generic rules of private data over the
 * documents of the repository as well: an address of a private network,
 * the address of an account and the host of a git server are private in
 * a document of the repository as much as they are in the tarball. The
 * rules that are about the reader of the *package* — the internal
 * numbering and the pointers at files the package does not ship — are
 * not read there: the specification is the internal numbering, and it
 * names the files of the repository by design.
 *
 * The guard grew a fourth half in S107. The third half reads the files
 * the package does not ship; the fourth half reads the files it does
 * ship. The tarball is the part of the repository that every user of the
 * package downloads, and a value of the installation in it is a value of
 * the installation in the world. The readme, the changelog, the
 * documentation and the skill were read by nobody but the maintainer,
 * and a zone or a host name in them was a leak that nothing caught.
 *
 * The values are the same values the third half reads: they are read
 * from the installation itself, and they are never written down here.
 * The same values are read over both sets of files, because the words of
 * the package are words in the repository and in the tarball alike: a
 * value the package publishes is a word of the package and not a value of
 * the installation. An installation whose host name is `server` would
 * otherwise make the guard report every `server` of the package, and the
 * guard would hold the publishing of the package for a word.
 *
 * The rule over the tarball asks the package nothing. A value of the
 * installation that stands in the tarball is a leak, and the package
 * cannot excuse it: the tarball is the file the value may have leaked
 * into, and a value the package publishes there is a value the package
 * publishes by mistake. A rule that asks the package whether it
 * publishes the value reads the very file it is about to scan, and the
 * leak excuses itself.
 *
 * What the tarball is read against is a list of the values that are no
 * values of the installation — a list the package does not decide:
 *
 *   - the names the package gives to the machines of its examples
 *     (`PACKAGE_MACHINE_NAMES`), for the name of a machine is an
 *     ordinary word and the package is full of ordinary words;
 *   - the domains the package publishes on purpose (`PUBLIC_DOMAINS`),
 *     the host of the public repository and the domain of the support
 *     address among them;
 *   - the names under the domains that RFC 2606 and RFC 6761 reserve,
 *     for those belong to nobody;
 *   - the addresses the documentation uses as examples, the ranges of
 *     RFC 5737 and of RFC 3849;
 *   - the paths in the home of the reader, for they are the paths of
 *     every installation of the package.
 *
 * The zone of the DNS is caught wherever it stands, for the package
 * publishes the zones of its examples in the domains that RFC 2606 and
 * RFC 6761 reserve, and those belong to nobody — so the zone of an
 * installation is never a word of the package.
 *
 * The files the package does not ship are read with the rule of S105,
 * which asks the package whether it publishes the value. The repository
 * is full of the words of the package, and the rule needs to know them.
 * A value the package publishes is a word of the package and not a value
 * of the installation: an installation whose host name is `build` would
 * otherwise make the guard report every `build` of the repository, and
 * the guard would hold the publishing of the package for a word.
 *
 * The message of the rule names the file and the line the value stands
 * on, and not the value itself. A red run of the guard is a log on a
 * public service, and a log that writes out the zone of the installation
 * publishes the very value the guard keeps out of the package.
 */

import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { objectName } from '../src/adapters/traefik.ts';
import { resolveConfigPath } from '../src/core/config.ts';
import { resolvePaths } from '../src/core/paths.ts';
import { RegistrationStore } from '../src/core/state.ts';
import { makeTempDir } from './helpers/tempdir.ts';

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
 * The domains the package publishes on purpose (S107).
 *
 * The zone of the DNS is caught even when the package publishes it, for
 * the package publishes it by mistake. The domains the package names on
 * purpose are the exception: the host of the public repository, the
 * domain of the support address, the registry the package is published
 * on and the conventions the package follows. They are public by the
 * decision of the maintainer, and they are the same for every reader of
 * the package.
 *
 * The domains that RFC 2606 and RFC 6761 reserve are not on this list:
 * they belong to nobody, and a name under them is not a value of an
 * installation at all (see `isReservedExample`).
 */
const PUBLIC_DOMAINS: string[] = [
  PUBLIC_GIT_HOST,
  ...PUBLIC_CONTACT_ADDRESSES.map((address) => address.split('@')[1] ?? ''),
  'npmjs.org',
  'keepachangelog.com',
  'semver.org',
];

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
 * the test command the pattern of the test files and the cleanup of the
 * suite, the end-to-end commands the tools of the end-to-end
 * environment, and the clean command the marker that says "this is a
 * checkout". A script that is not on this list names only files that the
 * package ships — or no file at all.
 *
 * The exception of the test command is the one that has to be earned
 * (S99): the package ships no test files, so a command that names them
 * and hands them to the test runner of node breaks in an installation —
 * the reader of the package has no test files to run. The command of the
 * manifest finds the test files itself, and the rule below proves that
 * it runs in the published package.
 */
const CHECKOUT_FILES: Record<string, string[]> = {
  build: ['tsconfig.build.json'],
  clean: ['tsconfig.build.json'],
  test: ['test/*.test.ts', 'test/helpers/suite.ts', 'test/helpers/cleanup.ts'],
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
 *
 * The allowance is a parameter: the tarball of the package allows the
 * support address of the package, and the files of the repository allow
 * the addresses the repository names on purpose (see
 * `REPOSITORY_ALLOWED_ADDRESSES`).
 */
function accountAddressTraps(
  file: string,
  text: string,
  allowed: string[] = PUBLIC_CONTACT_ADDRESSES,
): string[] {
  const hits: string[] = [];
  for (const match of text.matchAll(EMAIL)) {
    // The support address is public on purpose and is allowed.
    if (allowed.includes(match[0].toLowerCase())) continue;
    const domain = (match[0].split('@')[1] ?? '').toLowerCase();
    const last = domain.split('.').pop() ?? '';
    if (EXAMPLE_DOMAINS.has(domain) || EXAMPLE_DOMAINS.has(last)) continue;
    hits.push(`${file}:${lineOf(text, match.index ?? 0)}: "${match[0]}" — the address of an account`);
  }
  return hits;
}

/**
 * The addresses of accounts that the files of the repository name on
 * purpose.
 *
 * The specification names the address of the vendor of the proxy in the
 * record of the questions the human answered: it says that the address
 * was removed from the configuration channels. The address belongs to
 * the vendor and not to the installation, and the rule of the addresses
 * of accounts does not catch it.
 *
 * The allowance is narrow on purpose: it is the address itself and
 * nothing else, and every other address of an account is caught by the
 * rule of the reserved domains.
 */
const REPOSITORY_ALLOWED_ADDRESSES: string[] = ['api@traefik.io'];

/**
 * The generic rules of the guard, read over a file of the repository.
 *
 * The rules that are about private data are rules about every file of
 * the repository: an address of a private network, the address of an
 * account and the host of a git server are private in a file of the
 * repository as much as they are in the tarball, and the repository is
 * about to become public.
 *
 * Two of the rules of the guard are not read here, and the reason is
 * that they are rules about the reader of the *package*:
 *
 *   - the internal numbering is the numbering of the specification
 *     itself, and a file of the repository that names a paragraph of the
 *     specification points into a document the reader of the repository
 *     has;
 *   - a pointer at a file the package does not ship is a pointer at a
 *     file of the repository, and the reader of the repository has it.
 */
function repositoryFileTraps(file: string, text: string): string[] {
  return [
    ...privateNetworkTraps(file, text),
    ...gitServerTraps(file, text),
    ...accountAddressTraps(file, text, [...PUBLIC_CONTACT_ADDRESSES, ...REPOSITORY_ALLOWED_ADDRESSES]),
  ];
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
 * Where the values of the installation are read from.
 */
interface InstallationOptions {
  /** The environment the paths of the installation are resolved in. */
  env?: NodeJS.ProcessEnv;
  /**
   * Does the rule ask the resolver of the machine about the zone?
   *
   * The values of the DNS of the zone are values of the installation,
   * and the rule reads them for the installation that runs it. A probe
   * installation asks no resolver: the zone of the probe names nobody,
   * and the answer of the resolver would be the nameservers of a domain
   * that is not the probe's - the proof would depend on the machine that
   * runs it.
   */
  dns?: boolean;
}

/**
 * Escape the characters of a value that mean something in a regular
 * expression.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does the package publish the value?
 *
 * The words of the package are the package's own: the name of the
 * package, the name of the organisation, the names of the commands and
 * the words of the documentation. A value the package publishes is
 * public, and the guard does not have to catch it in the repository: an
 * installation whose host name is `build` would otherwise make the
 * guard report every `build` of the repository, and the guard would
 * report the words of the package as the values of an installation.
 *
 * The test is the same everywhere: the value stands in the text of the
 * package as it stands in the text of the repository, and not as a part
 * of a longer name.
 *
 * The rule of the values of the installation does not ask this question
 * about the file it is reading (see `wordOfThePackage`), for the file it
 * is reading is the file the value may have leaked into. This function
 * answers the question about the package as a whole, and the test of the
 * allowance of the domains of the package uses it.
 */
function packageUsesValue(value: string, packageDir: string, files: string[]): boolean {
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`, 'i');

  for (const file of files) {
    if (!/\.(?:md|json|js|mjs|ts|txt|yml|yaml)$/.test(file)) continue;
    let text = '';
    try {
      text = fs.readFileSync(path.join(packageDir, file), 'utf8');
    } catch {
      continue;
    }
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * How a value of the installation is read.
 *
 *   - `substring`: the value is caught wherever it stands, because it
 *     is a part of a bigger name — the zone, a path, a network;
 *   - `word`: the value has to stand as a word, and not as a part of a
 *     longer name — an address, the name of a service, a nameserver;
 *   - `machine`: the value is caught only where it names a machine — the
 *     name of the machine, which is an ordinary word.
 */
type InstallationMatch = 'substring' | 'word' | 'machine';

/**
 * The names the package gives to the machines of its examples (S107).
 *
 * The name of a machine is an ordinary word, and the package is full of
 * ordinary words: the guard cannot tell the name of the machine of an
 * installation from the name of a machine in the documentation of the
 * package. The names of the package are written down here, and the guard
 * leaves them alone.
 *
 * The list is the names the package uses in its documentation where a
 * name stands where the name of a machine stands: the host of a URL, the
 * host of a port, a segment of a path and the first label of a host
 * name. A test reads the documentation of the package and says that
 * every name in it stands on the list — so the list cannot go quiet, and
 * a new name in the documentation has to leave the guard alone as well.
 */
const PACKAGE_MACHINE_NAMES: string[] = [
  '0',
  '1',
  '100',
  '11',
  '113',
  '12',
  '127',
  '128',
  '19',
  '192',
  '198',
  '2',
  '20',
  '203',
  '24',
  '32',
  '45001',
  '45002',
  '51',
  '64',
  '8080',
  'application',
  'caches',
  'launchagents',
  'library',
  'preferences',
  'acme',
  'api',
  'com',
  'config',
  'daemon',
  'db8',
  'dev-gateway',
  'docker',
  'dynamic',
  'en',
  'entrypoints',
  'etc',
  'example',
  'gatewarden',
  'gateway',
  'github',
  'healthz',
  'home',
  'html',
  'http',
  'keepachangelog',
  'main',
  'malarstrom',
  'malarstrom-it',
  'my-app',
  'npmjs',
  'org',
  'probe',
  'proxy',
  'references',
  'routers',
  'routes',
  'run',
  's',
  'semver',
  'server',
  'services',
  'skills',
  'sock',
  'spec',
  'state',
  'the',
  'traefik',
  'types-of-changes',
  'user',
  'v2',
  'var',
  'version',
  'wiring',
  // Public documentation links and asset paths in the preview guides.
  'adapters',
  'ade1308f67fa2df167804263f1d7de46471cd231',
  'agent-endpoints',
  'assets',
  'blob',
  'branch',
  'caddyserver',
  'cloudflare',
  'cloudflare-one',
  'cloudflare-tunnel',
  'connectors',
  'core',
  'developers',
  'doc',
  'docs',
  'endpoints',
  'fatedier',
  'feat',
  'features',
  'firewall',
  'frp',
  'gatewarden-flow',
  'gatewarden-mascot',
  'githubusercontent',
  'install-configuration',
  'io',
  'issues',
  'localtunnel',
  'mcp',
  'md',
  'networks',
  'ngrok',
  'npm-package',
  'others',
  'overview',
  'png',
  'policy',
  'providers',
  'quick-starts',
  'raw',
  'readme',
  'reference',
  'remove',
  'reverse',
  'reverse-proxy',
  'security',
  'serve',
  'src',
  'tailscale',
  'tailscale-cli',
  'tailscale-funnel',
  'the-trust-list',
  'tls',
  'ts',
  'upstream',
  'v3',
  'what-is-frp',
];

/**
 * What the zone of the installation is called.
 *
 * The zone is the one value the package never publishes on purpose, and
 * the one value the guard reads even when the package publishes it.
 */
const THE_ZONE_OF_THE_INSTALLATION = 'the DNS zone of the installation';

/**
 * What the paths of the installation are called.
 *
 * The paths are the one kind of value the package publishes on purpose:
 * the path of the configuration and the path of the state are the same
 * for every installation of the package, and the documentation of the
 * package names them.
 */
const PATH_OF_THE_INSTALLATION = 'the path of the installation';

/**
 * A value that names the installation.
 *
 * The value is read from the installation itself and is never written
 * down in this repository: the repository is about to become public, and
 * a value of the installation in a public repository publishes the very
 * value the rule keeps out of it (S80).
 */
interface InstallationValue {
  /** The value itself. */
  value: string;
  /** What the value names of the installation. */
  what: string;
  /** How the value is read. */
  match: InstallationMatch;
}

/**
 * The configuration of an installation, read from its configuration file.
 *
 * The file is read as it is written: the guard wants the values the
 * installation wrote down, and not the defaults of the package. A file
 * that cannot be read holds no values, and the rule reads nothing.
 */
function readInstallationConfig(configPath: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    return raw as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Is the value an address of the loopback?
 *
 * The loopback is the loopback of every machine, and it is not a value
 * of an installation.
 */
function isLoopback(value: string): boolean {
  return (
    value === '0.0.0.0' ||
    value === '::1' ||
    value === 'localhost' ||
    value.startsWith('127.') ||
    value.startsWith('::1/')
  );
}

/**
 * Does the value belong to a domain that RFC 2606 and RFC 6761 reserve?
 *
 * The domains that are reserved for examples belong to nobody, and an
 * installation whose zone is `example.com` names nothing that is not
 * published already. The rule of the values of the installation has
 * nothing private to catch in such a value.
 *
 * The names under a reserved domain belong to nobody as well: the
 * package writes `my-app.example.com` as the address of its example,
 * and the zone of an installation is never a name under a reserved
 * domain. The rule reads the whole name and not only its last label,
 * for the name under a reserved domain is a name of nobody.
 */
function isReservedExample(value: string): boolean {
  if (value.includes('/')) return false;
  const labels = value.toLowerCase().split('.');

  for (let count = labels.length; count > 0; count -= 1) {
    if (EXAMPLE_DOMAINS.has(labels.slice(labels.length - count).join('.'))) return true;
  }

  return false;
}

/**
 * Is the value a domain name?
 *
 * A domain name has more than one part: `home.example.org`. A name
 * without a dot is an ordinary word, and the guard reads it as one: the
 * word `server` names a server of the package and the machine of the
 * reader, and the guard cannot tell the machine of an installation from
 * the words of the package.
 */
function isDomainName(value: string): boolean {
  return value.includes('.') && !isReservedExample(value);
}

/**
 * The addresses the documentation of the package uses as examples.
 *
 * The ranges of RFC 5737 (`192.0.2.0/24`, `198.51.100.0/24`,
 * `203.0.113.0/24`) and of RFC 3849 (`2001:db8::/32`) belong to nobody,
 * and the documentation of the package uses them for its examples. An
 * installation whose address is one of them names nothing that is not
 * published already.
 */
const EXAMPLE_ADDRESSES = [
  /^192\.0\.2\.\d{1,3}$/,
  /^198\.51\.100\.\d{1,3}$/,
  /^203\.0\.113\.\d{1,3}$/,
  /^2001:db8:[0-9a-f]*$/i,
];

/**
 * Is the value an address the documentation uses as an example?
 */
function isExampleAddress(value: string): boolean {
  return EXAMPLE_ADDRESSES.some((pattern) => pattern.test(value));
}

/**
 * Is the value a path of every reader?
 *
 * The path of the configuration and the path of the state are the same
 * for every installation of the package, and the documentation of the
 * package names them in the home of the reader. The path of the reader
 * is not the path of this installation: it names no installation.
 *
 * The configuration file of an installation may name its paths in the
 * short form (`~/.config/gatewarden/`), and the rule reads the value as
 * it is written. The short form is the path of every reader, and the
 * rule leaves it alone.
 */
function isPathOfEveryReader(value: string): boolean {
  return value.startsWith('~/');
}

/**
 * Add a value to the list of the values of the installation.
 *
 * A value that is empty, that is too short to name anything, that names
 * the loopback, that belongs to a reserved example domain, that is an
 * example address of the documentation, or that is a path of every
 * reader is not a value of an installation. A value that is already on
 * the list is not added twice: the guard says what a value names, not how
 * often it stands in a file.
 */
function addInstallationValue(
  values: InstallationValue[],
  value: unknown,
  what: string,
  match: InstallationMatch,
): void {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (text.length < 4) return;
  if (isLoopback(text)) return;
  if (isReservedExample(text)) return;
  if (isExampleAddress(text)) return;
  if (isPathOfEveryReader(text)) return;
  if (values.some((entry) => entry.value === text)) return;
  values.push({ value: text, what, match });
}

/**
 * The values of the installation, read from the installation itself (S105).
 *
 * The rule of the values of the installation cannot be a rule about a
 * shape: the zone of the DNS, the name of a host, the name of a service
 * and the path of an installation are ordinary words, and no rule of a
 * shape catches a word. The only way to catch them is to know them, and
 * the only place they may be known is outside the repository — the
 * repository is about to become public, and the values of the
 * installation in a public repository publish the very values the guard
 * keeps out of it (S80).
 *
 * The installation knows its own values, and the guard asks it:
 *
 *   1. **the configuration file of the installation** — the file the
 *      package reads and writes, in the home of the reader. It names the
 *      zone, the host name, the address, the networks the installation
 *      trusts and the paths of the installation;
 *   2. **the route store of the installation** — the routes it
 *      registered in the proxy, with the names of the services;
 *   3. **the DNS of the zone** — the addresses the zone points at and
 *      the nameservers that serve it. The zone is often a part of a
 *      bigger domain, and the nameservers of that domain are the
 *      nameservers of the zone.
 *
 * The values are read on the machine the guard runs on. A machine
 * without an installation has no values of an installation, and the rule
 * reads nothing there: the guard protects the repository of this
 * installation against the values of this installation, and there is
 * nothing of an installation to protect on a machine that has none.
 *
 * The values are read as they are, and the rule that reads them decides
 * what a value is: a value the package publishes is a word of the
 * package and not a value of the installation (see `publishedValue`).
 */
async function installationValues(opts: InstallationOptions = {}): Promise<InstallationValue[]> {
  const values: InstallationValue[] = [];
  const env = opts.env ?? process.env;

  const configPath = resolveConfigPath({ env });
  if (!fs.existsSync(configPath)) return values;

  const config = readInstallationConfig(configPath);
  if (config === undefined) return values;

  const stateDir =
    typeof config['stateDir'] === 'string' && config['stateDir'] !== ''
      ? config['stateDir']
      : resolvePaths({ env }).stateDir;

  const zone = typeof config['zone'] === 'string' ? config['zone'] : '';
  const host = typeof config['advertisedHost'] === 'string' ? config['advertisedHost'] : '';

  // The zone of the DNS. The zone of a DNS is a domain name: a name
  // under the zone carries the zone, and the guard catches the zone
  // wherever it stands because of that. A zone that is not a domain name
  // is not a zone of a DNS, and an ordinary word names nothing that the
  // guard can keep out of the package.
  if (isDomainName(zone)) {
    addInstallationValue(values, zone, THE_ZONE_OF_THE_INSTALLATION, 'substring');
  }

  // The host names of the installation: the name the proxy reaches the
  // machine under, and the name the machine has. The name of the machine
  // is a value of the installation only when the installation names
  // something: a machine with no installation of its own is not a value
  // of anything.
  if (zone !== '' || host !== '') {
    addInstallationValue(values, host, 'the host name of the installation', 'machine');
    addInstallationValue(values, os.hostname(), 'the host name of the installation', 'machine');
  }

  // The address of the installation.
  addInstallationValue(values, config['advertisedIp'], 'the address of the installation', 'word');

  // The networks the installation trusts.
  const cidrs = config['allowedCidrs'];
  if (Array.isArray(cidrs)) {
    for (const cidr of cidrs) {
      addInstallationValue(values, cidr, 'the network of the installation', 'substring');
    }
  }

  // The paths of the installation: the absolute form, which names the
  // machine of the installation. The short form a document uses
  // (`~/.config/gatewarden/`) is the path of every reader and names no
  // installation - the package publishes it on purpose - and the rule
  // leaves it alone (see `isPathOfEveryReader`).
  addInstallationValue(values, configPath, PATH_OF_THE_INSTALLATION, 'substring');
  addInstallationValue(values, path.dirname(configPath), PATH_OF_THE_INSTALLATION, 'substring');
  addInstallationValue(values, stateDir, PATH_OF_THE_INSTALLATION, 'substring');

  // The names of the services the installation registered in the proxy.
  for (const registration of new RegistrationStore(stateDir).list()) {
    addInstallationValue(values, objectName(registration), 'the name of a service of the installation', 'word');
    addInstallationValue(values, registration.fqdn, 'the host name of a service of the installation', 'word');
  }

  // The values of the DNS of the zone.
  if (opts.dns !== false) values.push(...(await zoneDnsValues(zone)));

  return values;
}

/**
 * An installation of the rule's own.
 *
 * The rule of the values of the installation reads the values of the
 * installation it runs on. A machine without an installation has no
 * values at all, and the rule reads nothing there: there is nothing of
 * an installation to keep out of the package, and a rule that catches
 * what is not there catches words.
 *
 * A rule that cannot fail guards nothing, and the proof that the rule
 * fires cannot wait for an installation to exist on the machine that
 * runs it: the runner of the build has none, and a contributor without
 * the package installed has none, and the guard of the package has to be
 * green on them too. The rule is therefore given an installation of its
 * own — a configuration file of its own, in a directory of its own, with
 * a route store of its own — and the values of that installation are
 * planted in the files the rule reads.
 *
 * The values of the probe installation name nothing of this project:
 *
 *   - the zone of the probe (`probe.installation`), a name no registry
 *     serves;
 *   - the host name of the probe (`probe-host`) and the name of the
 *     machine that runs the test;
 *   - the paths of the probe: the configuration file, the directory it
 *     is in and the state directory;
 *   - the name of a service of the probe and the host name of that
 *     service (`probeapp.main.probe.installation`).
 *
 * The probe asks no resolver: the zone of the probe names nobody, and
 * the answer of the resolver would be the nameservers of a domain that
 * is not the probe's - the proof would depend on the machine that runs
 * it. The probe writes no address: an address of the range of RFC 5737
 * belongs to nobody, and the rule leaves such an address out on
 * purpose. The values of the probe may be written down here in a public
 * repository.
 */
interface ProbeInstallation {
  /** The directory of the probe installation. */
  home: string;
  /** The environment that points at the probe installation. */
  env: NodeJS.ProcessEnv;
  /** The values of the probe installation. */
  values: () => Promise<InstallationValue[]>;
  /** The zone of the probe installation. */
  zone: string;
  /** The host name of the probe installation. */
  host: string;
  /** Remove the probe installation and everything in it. */
  remove: () => void;
}

/**
 * Build an installation of the rule's own.
 *
 * The installation lives in a directory of its own and is removed when
 * the proof is done: nothing of it reaches the disk of the repository.
 */
function probeInstallation(): ProbeInstallation {
  const home = makeTempDir('gatewarden-probe-installation-');
  const configFile = path.join(home, 'config.json');
  const stateDir = path.join(home, 'state');
  const zone = 'probe.installation';
  const host = 'probe-host';

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ zone, advertisedHost: host, stateDir }));
  fs.writeFileSync(
    path.join(stateDir, 'routes.json'),
    JSON.stringify({
      version: 1,
      registrations: [
        {
          id: 'probe-app-main',
          project: 'Probe App',
          branch: 'main',
          projectSlug: 'probeapp',
          branchSlug: 'main',
          fqdn: `probeapp.main.${zone}`,
          zone,
          devPort: 3000,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
  );

  // The home of the installation wins over the configuration file, and
  // the machine that runs the test may name one: the environment of the
  // probe installation names the configuration file and nothing else.
  const env: NodeJS.ProcessEnv = { ...process.env, GATEWARDEN_CONFIG: configFile };
  delete env['GATEWARDEN_HOME'];
  delete env['DEV_GATEWAY_HOME'];

  return {
    home,
    env,
    values: () => installationValues({ env, dns: false }),
    zone,
    host,
    remove: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

/**
 * The files of the package that use each value of the installation as a
 * word of the package (S105).
 *
 * The map serves the rule over the files the package does not ship: a
 * value the package uses in another file is a word of the package and
 * not a value of the installation. The rule never asks the map about the
 * file it is reading — a value that stands in the file the rule reads is
 * the value the rule is looking for.
 *
 * The rule over the tarball does not ask the map at all (S107): the
 * tarball is the file the value may have leaked into, and the package
 * cannot excuse the leak.
 */
function publishedIn(
  values: InstallationValue[],
  packageDir: string,
  files: string[],
): Map<string, Set<string>> {
  const published = new Map<string, Set<string>>();
  for (const entry of values) published.set(entry.value, new Set<string>());

  for (const file of files) {
    if (!/\.(?:md|json|js|mjs|ts|txt|yml|yaml)$/.test(file)) continue;

    let text = '';
    try {
      text = fs.readFileSync(path.join(packageDir, file), 'utf8');
    } catch {
      continue;
    }

    for (const entry of values) {
      const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(entry.value)}(?![A-Za-z0-9_])`, 'gi');
      for (const found of text.matchAll(pattern)) {
        const index = found.index ?? 0;
        if (entry.match === 'machine' && namesAMachine(text.slice(0, index), text.slice(index + entry.value.length))) {
          continue;
        }
        published.get(entry.value)?.add(file);
        break;
      }
    }
  }

  return published;
}

/**
 * Does the rule read the value as a value of the installation in the file?
 *
 * A value that the rule leaves alone is a value the rule does not look
 * for, and the probes of the rule must leave it alone as well.
 *
 *   - the domains the package publishes on purpose are published on
 *     purpose: the zone of the DNS is caught even when the package
 *     publishes it, and the domains of the package are the exception;
 *   - a value the package publishes in another file is a word of the
 *     package, and the rule over the files the package does not ship
 *     leaves it alone;
 *   - the name of a machine is read in the documentation of the package:
 *     the code is the package's own, and the names in it are the names
 *     of the package. A name the package gives to the machines of its
 *     examples is the name of the package and not the name of the
 *     machine of an installation.
 */
function ruleReadsValue(
  entry: InstallationValue,
  file: string,
  published?: Map<string, Set<string>>,
): boolean {
  if (entry.what === THE_ZONE_OF_THE_INSTALLATION && PUBLIC_DOMAINS.includes(entry.value.toLowerCase())) {
    return false;
  }

  if (published !== undefined && wordOfThePackage(entry, file, published)) return false;

  if (entry.match === 'machine') {
    if (!file.endsWith('.md')) return false;
    if (PACKAGE_MACHINE_NAMES.includes(entry.value.toLowerCase())) return false;
  }

  return true;
}

/**
 * Is the value a word of the package and not a value of the installation?
 *
 * A value the package publishes is public: the words of the package are
 * the package's own, and an installation whose host name is `build` would
 * otherwise make the guard report every `build` of the package — and the
 * guard would report the words of the package as the values of an
 * installation. The words of the package are the same for every
 * installation, and the package publishes them on purpose.
 *
 * The package publishes a value in the file the rule reads and in the
 * other files of the package. The other files are what tells the two
 * apart: a value that the package uses in another file is a word of the
 * package, and a value that stands in one file only is the value of the
 * installation — the package publishes it there by mistake.
 */
function wordOfThePackage(
  entry: InstallationValue,
  file: string,
  published: Map<string, Set<string>>,
): boolean {
  const files = published.get(entry.value);
  if (files === undefined) return false;

  for (const other of files) {
    if (other !== file) return true;
  }

  return false;
}

/**
 * The values of the installation that the DNS of the zone holds (S105).
 *
 * The zone of the installation points at the machine that runs the proxy,
 * and it is served by nameservers. Both are values of the installation,
 * and both are in the DNS: the guard asks the resolver of the machine.
 *
 * The zone of the installation is often a part of a bigger domain: the
 * zone `home.example.com` is served by the nameservers of
 * `example.com`. The guard asks the zone first and then the domain above
 * it, and stops there — the nameservers of the top-level domain are the
 * nameservers of the world.
 *
 * A resolver that does not answer, or a zone that does not resolve, gives
 * no values. The rule then knows less, and it knows no wrong thing.
 */
async function zoneDnsValues(zone: string): Promise<InstallationValue[]> {
  const values: InstallationValue[] = [];
  const host = zone.replace(/\.$/, '');
  if (host === '') return values;

  const addresses = await resolveAll([
    () => dns.promises.resolve4(host),
    () => dns.promises.resolve6(host),
  ]);
  for (const address of addresses) {
    addInstallationValue(values, address, 'the address of the installation', 'word');
  }

  for (const server of await nameserversOf(host)) {
    addInstallationValue(values, server, 'the nameserver of the installation', 'word');
  }

  return values;
}

/**
 * The nameservers that serve a host.
 *
 * The nameservers of the host itself, or — when the host has none of its
 * own — the nameservers of the domain above it. The walk stops at the
 * domain: the nameservers of the top-level domain are not the
 * nameservers of the installation.
 */
async function nameserversOf(host: string): Promise<string[]> {
  const labels = host.split('.');
  for (let count = labels.length; count >= 2; count -= 1) {
    const servers = await resolveAll([() => dns.promises.resolveNs(labels.slice(labels.length - count).join('.'))]);
    if (servers.length > 0) return servers;
  }
  return [];
}

/**
 * Ask the resolver for the answers, and wait no longer than it may.
 *
 * A resolver that does not answer must not hold the test: the answers
 * come back, or they do not, and the rule reads what it got.
 */
async function resolveAll(lookups: Array<() => Promise<string[]>>): Promise<string[]> {
  const answers: string[] = [];

  for (const lookup of lookups) {
    const answer = await withTimeout(lookup(), 2000);
    if (answer !== undefined) answers.push(...answer);
  }

  return answers;
}

/**
 * The answer of the resolver, or nothing when it takes too long.
 */
function withTimeout<T>(answer: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    if (typeof timer.unref === 'function') timer.unref();
    answer.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/**
 * The values of the installation that a file holds.
 *
/**
 * The rule is the rule of the words: a value of the installation is
 * caught where it stands, and the file and the line it stands on are
 * named. A value that names a whole thing — an address, the name of a
 * service, a nameserver — has to stand as a word: the name of one
 * service does not catch the name of another. A value that names a part
 * of a bigger name — the zone, a path — is caught wherever it stands,
 * because every name under the zone carries it.
 *
 * The name of the machine is an ordinary word, and an ordinary word is
 * not a value of an installation: the repository is full of ordinary
 * words, and a guard that reports every `staging` of the repository
 * reports nothing. The name is caught where it names a machine, and not
 * where it is a word — see `machineValueTraps`.
 *
 * The case does not matter: the zone of the DNS does not care about it,
 * and a name that differs in its case is the same name.
 *
 * The message of the trap names the file and the line and not the value
 * (S107): a red run of the guard is a log on a public service, and a log
 * that writes out the value writes out the zone of the installation.
 */
function installationValueTraps(
  file: string,
  text: string,
  values: InstallationValue[],
  published?: Map<string, Set<string>>,
): string[] {
  const hits: string[] = [];

  for (const { value, what, match } of values) {
    if (!ruleReadsValue({ value, what, match }, file, published)) continue;

    if (match === 'machine') {
      hits.push(...machineValueTraps(file, text, value, what));
      continue;
    }

    const escaped = escapeRegExp(value);
    const pattern =
      match === 'word'
        ? new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'gi')
        : new RegExp(escaped, 'gi');
    for (const found of text.matchAll(pattern)) {
      hits.push(`${file}:${lineOf(text, found.index ?? 0)}: ${what}`);
    }
  }

  return hits;
}

/**
 * The places where the name of a machine is the name of a machine.
 *
 * The name of a machine is an ordinary word, and the repository is full
 * of ordinary words. The name is caught where it names a machine:
 *
 *   - as a segment of a path: `/opt/buildhost-traefik-api`;
 *   - as the host of a URL: `http://buildhost:45002/traefik`;
 *   - as the host of a port: `buildhost:45002`;
 *   - as the first label of a host name: `buildhost.private`.
 *
 * The name in the prose of a sentence is not caught: `the machine is
 * called buildhost` names a word, and the guard would report every word of
 * the repository that is the name of the machine of some installation.
 *
 * The message of the trap names the file and the line and not the value,
 * for the same reason as the message of the other traps of the rule.
 */
function machineValueTraps(file: string, text: string, value: string, what: string): string[] {
  const hits: string[] = [];
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`, 'gi');

  for (const found of text.matchAll(pattern)) {
    const index = found.index ?? 0;
    if (!namesAMachine(text.slice(0, index), text.slice(index + value.length))) continue;
    hits.push(`${file}:${lineOf(text, index)}: ${what}`);
  }

  return hits;
}

/**
 * Does the name stand where a name is the name of a machine?
 *
 * The four places are the ones of the list above. The first label of a
 * host name is a host name when the label that follows it is not the
 * name of a file: the last label of `build.test.ts` is a file, and the
 * last label of `buildhost.private` is a domain.
 */
function namesAMachine(before: string, after: string): boolean {
  // A segment of a path: the name is a segment of its own, or the first
  // part of one. A dot ends the segment when the dot ends the sentence
  // and not when it begins the name of a file.
  if (/\/$/.test(before)) {
    if (/^(?:-[A-Za-z0-9_-]+)?(?:[\s"'`),;:/]|$)/.test(after)) return true;
    if (/^(?:-[A-Za-z0-9_-]+)?\.(?![A-Za-z0-9])/.test(after)) return true;
  }

  // The host of a URL.
  if (/\/\/[^\s]*$/.test(before) && /^(?::[\w.-]+)?(?:[\s"'`),;:/]|$)/.test(after)) return true;

  // The host of a port.
  if (/^:\d/.test(after)) return true;

  // The first label of a host name.
  const host = /^\.([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)/.exec(after);
  if (host === null) return false;
  const last = host[1].split('.').pop() ?? '';

  return !POINTER_EXTENSIONS.includes(`.${last}`);
}

/**
 * The values of the installation on this machine.
 *
 * They are read when the package is packed: the rule has to know the
 * words of the package before it can tell a value of the installation
 * from a word of the package.
 *
 * The same values are read over the files the package does not ship and
 * over the files it does (S105, S107): the values of the installation
 * are the values of the installation, and the files that hold them are
 * the ones that matter.
 */
let INSTALLATION_VALUES: InstallationValue[] = [];

/**
 * The files of the package that use each value of the installation as a
 * word of the package.
 *
 * The map is read for every file the rule scans, and the rule asks it
 * about the file it is reading: a value the package uses in another file
 * is a word of the package and not a value of the installation.
 */
let PUBLISHED_IN: Map<string, Set<string>> = new Map();

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
 * A probe: a value that breaks a rule, and the rule that catches it.
 */
interface RuleProbe {
  /** The rule that the value breaks. */
  what: string;
  /** The value that breaks the rule. */
  value: string;
  /** The file the value is planted in. */
  file: string;
  /** The rule itself, run over the planted file. */
  find: (file: string, text: string, context: GuardContext) => string[];
  /** Is the value planted in a file of the repository instead of the tarball? */
  inRepository?: boolean;
  /** Does the message of the rule leave the value out? */
  hidesValue?: boolean;
}

/**
 * The probes of the rule of the values of the installation (S105, S107).
 *
 * The values are the values of the installation, read from the
 * installation itself. They are not written down here: the repository is
 * about to become public, and a value of the installation written down in
 * it is the very thing the rule keeps out of it.
 *
 * The values are planted in the files the rule reads: a file of the
 * repository for the rule that reads the repository, and a file of the
 * tarball for the rule that reads the tarball. A probe that plants a
 * value in a file the rule does not read would prove a rule that is not
 * the one that is used.
 *
 * The name of a machine is planted where it names a machine: the rule
 * catches the name of the machine and not an ordinary word, and a probe
 * that planted the name in the prose of a sentence would prove nothing.
 *
 * The message of the rule leaves the value out, and the probe says so:
 * a log of a red run must not write out the value it caught.
 *
 * A machine without an installation has no values to plant, and the list
 * is empty there. The rule of the values of the installation is proved on
 * every machine by the test that gives it an installation of its own.
 */
function installationProbes(): RuleProbe[] {
  const probes: RuleProbe[] = [];

  for (const entry of INSTALLATION_VALUES) {
    const value = entry.match === 'machine' ? `${entry.value}:45002` : entry.value;

    for (const file of ['specs/tech-architecture/naming.md', 'README.md']) {
      const inRepository = file.startsWith('specs/');
      // A value that the rule leaves alone in that file is a value the
      // rule does not look for there. The probe proves the rule that is
      // used, and not a rule that is not.
      if (!ruleReadsValue(entry, file, inRepository ? PUBLISHED_IN : undefined)) continue;

      probes.push({
        what: entry.what,
        value,
        file,
        find: (file: string, text: string) =>
          installationValueTraps(file, text, INSTALLATION_VALUES, inRepository ? PUBLISHED_IN : undefined),
        inRepository,
        hidesValue: true,
      });
    }
  }

  return probes;
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
const RULE_PROBES: RuleProbe[] = [
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

/**
 * Run an npm command in a directory and collect what it wrote and how it
 * ended.
 *
 * The command may fail — that is what the rules below look for — so the
 * exit code is collected and the failure is not thrown.
 *
 * @param args the arguments of the npm command
 * @param cwd the directory the command runs in
 * @returns the exit code and everything the command wrote
 */
function runNpm(args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('npm', args, { cwd, env: npmEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
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
 * Every file of the repository, relative to its root.
 *
 * The repository is a checkout of git, and git knows which files belong
 * to it: the files that are tracked. The build output, the installed
 * packages, the files that are downloaded and the files that are left
 * behind are not tracked, and they are not files of the repository — the
 * guard reads the repository and not the leftovers of a machine.
 *
 * The walk of the file system is the answer when the directory is not a
 * checkout. It skips the hidden directories, the build output and the
 * installed packages, exactly as the walk above does.
 */
function everyRepositoryFile(): string[] {
  const tracked = trackedRepositoryFiles();
  if (tracked !== undefined) return tracked.filter((file) => fs.existsSync(path.join(REPO_ROOT, file)));

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
 * The files of the repository that git tracks.
 *
 * `undefined` when the directory is not a checkout of git, or when git
 * is not there: the walk of the file system answers then.
 */
function trackedRepositoryFiles(): string[] | undefined {
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter((file) => file !== '').sort();
  } catch {
    return undefined;
  }
}

/**
 * The files of the repository that the package does not ship (S105).
 *
 * The guard reads the tarball, and the tarball is what every reader of
 * the package gets. The repository holds more than the tarball: the
 * specification, the memory of the project, the code of the project and
 * the documents of the repository. None of them is published — and none
 * of them may carry a value of the installation either. The repository
 * is about to become public, and a value of the installation in a public
 * file is a value of the installation in the world.
 *
 * The list is computed from the tarball: a file the tarball holds is
 * shipped, and every other file of the repository is not.
 */
function unshippedRepositoryFiles(shipped: string[]): string[] {
  const inPackage = new Set(shipped);
  return everyRepositoryFile().filter((file) => !inPackage.has(file));
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
    workdir = makeTempDir('gatewarden-identifiers-');

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

    // The values of the installation are read now: the rule has to know
    // the words of the package before it can tell a value of the
    // installation from a word of the package.
    INSTALLATION_VALUES = await installationValues();
    PUBLISHED_IN = publishedIn(INSTALLATION_VALUES, packageDir, files);
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
    const copy = makeTempDir('gatewarden-code-probe-');
    try {
      fs.cpSync(packageDir, copy, { recursive: true });
      fs.appendFileSync(path.join(copy, file), `\n${line}\n`);

      return fs.readFileSync(path.join(copy, file), 'utf8');
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  };

  /**
   * A copy of the tarball with a line planted in each of its files.
   *
   * A rule that cannot fail guards nothing, so the rule is run against a
   * tarball that has been broken on purpose: a copy of the tarball with
   * a line planted in one of its files. The copy is a copy — the tarball
   * of the package is not written to, and the copy is removed when the
   * rule has been run over it.
   */
  const plantInTarball = (plantings: Array<{ file: string; line: string }>): string => {
    const copy = makeTempDir('gatewarden-tarball-probe-');
    try {
      fs.cpSync(packageDir, copy, { recursive: true });
      for (const planting of plantings) {
        fs.appendFileSync(path.join(copy, planting.file), `\n${planting.line}\n`);
      }
    } catch (error) {
      fs.rmSync(copy, { recursive: true, force: true });
      throw error;
    }

    return copy;
  };

  /**
   * The text of a file of the repository with a line planted in it.
   *
   * The file of the repository is not written to: its text is read and
   * the line is added to that text, and the rule is run over the text. A
   * planted value never reaches the disk.
   */
  const plantRepositoryFile = (file: string, line: string): string =>
    `${fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')}\n${line}\n`;

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

  test('the published package holds no value of the installation', async () => {
    // The tarball is what every user of the package downloads, and it is
    // the part of the repository that was read by nobody but the
    // maintainer until S107. A zone of the installation in the readme, in
    // the changelog or in the documentation was a leak that nothing
    // caught: the rule of the values of the installation read the files
    // the package does not ship, and the tarball was not among them.
    //
    // The values of the installation are the values of the installation,
    // and the files that hold them are the ones that matter: the rule
    // reads them over the files the package does not ship (S105) and
    // over the files it does ship (S107). A value the package publishes
    // is a word of the package and not a value of the installation, and
    // the zone of the DNS is the one exception (see `publishedValue`).
    //
    // The message of the rule names the file and the line and not the
    // value: a log of a red run must not publish the value it caught.
    const hits: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      hits.push(...installationValueTraps(file, text, INSTALLATION_VALUES));
    }

    assert.deepEqual(
      hits,
      [],
      'the published package holds a value of the installation; the published package names no zone and no host name of an installation:\n' +
        hits.join('\n'),
    );

    // The rule has to fire, and it has to fire on every machine.
    //
    // The values of the installation are read from the installation
    // itself, and a machine without an installation has none: there is
    // nothing of an installation to keep out of the package, and the
    // rule reads nothing there. A proof that waits for an installation
    // to exist is a proof that runs on some machines and not on others,
    // and the guard of the package is red on the machines that have no
    // installation — the runner of the build, a contributor without the
    // package installed.
    //
    // The rule is therefore given an installation of its own: a probe
    // installation, with a configuration file of its own, in a directory
    // of its own, with a route store of its own. The values of that
    // installation are planted in the tarball — the zone in the readme
    // and the host name in the documentation — and the rule has to
    // catch them there. A tarball that names them is caught, and the
    // message of the trap names the file and the line and not the
    // value.
    const probe = probeInstallation();

    try {
      const values = await probe.values();
      const copy = plantInTarball([
        { file: 'README.md', line: `The zone of the installation is ${probe.zone}.` },
        { file: 'docs/setup.md', line: `The machine of the installation is ${probe.host}:45002.` },
      ]);

      try {
        const planted: string[] = [];

        for (const file of filesUnder(copy)) {
          const text = fs.readFileSync(path.join(copy, file), 'utf8');
          planted.push(...installationValueTraps(file, text, values));
        }

        // The zone of the installation is caught in the readme and the
        // host name of the installation in the documentation: a tarball
        // that names them is a leak, and the rule of the leak is the
        // rule that is used over the tarball.
        assert.match(
          planted.find((hit) => hit.startsWith('README.md:') && hit.endsWith('the DNS zone of the installation')) ?? '',
          /^README\.md:\d+: the DNS zone of the installation$/,
          'the rule did not catch the zone of the installation in the readme of the tarball',
        );
        assert.match(
          planted.find(
            (hit) => hit.startsWith('docs/setup.md:') && hit.endsWith('the host name of the installation'),
          ) ?? '',
          /^docs\/setup\.md:\d+: the host name of the installation$/,
          'the rule did not catch the host name of the installation in the documentation of the tarball',
        );

        // The message of the rule names the file and the line and not
        // the value: a log of a red run must not publish the value it
        // caught.
        for (const hit of planted) {
          assert.ok(
            !hit.includes(probe.zone) && !hit.includes(probe.host),
            'the message of the rule wrote out the value of the installation',
          );
        }
      } finally {
        fs.rmSync(copy, { recursive: true, force: true });
      }
    } finally {
      probe.remove();
    }

    // The values of the installation of the machine that runs the test
    // are planted as well, when the machine has an installation: the
    // rule has to catch those too, and the message of the trap has to
    // leave them out.
    for (const entry of INSTALLATION_VALUES) {
      // A value the rule leaves alone in that file is a value the rule
      // does not look for there.
      if (!ruleReadsValue(entry, 'README.md')) continue;

      // The name of a machine is caught where it names a machine, and not
      // in the prose of a sentence.
      const line =
        entry.match === 'machine'
          ? `The machine of the installation is ${entry.value}:45002.`
          : `The installation of the package is ${entry.value}.`;
      const plantedHits = installationValueTraps('README.md', plant('README.md', line), INSTALLATION_VALUES);

      assert.ok(
        plantedHits.length > 0,
        `the rule did not catch a value of the installation in the readme of the tarball: ${entry.what}`,
      );
      assert.ok(
        plantedHits.every((hit) => !hit.includes(entry.value)),
        'the message of the rule wrote out the value of the installation',
      );
    }
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
    // the test files of the repository when it is a checkout, and
    // `npm run test:e2e` runs the end-to-end tools of the repository.
    // They are commands, not paths into the package, and npm does not
    // run them when the package is installed. The rule that reads them
    // is the one below.
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
    // one by one: `build` names the build configuration, `test` the
    // pattern of the test files, `test:e2e` the tools of the end-to-end
    // environment, and `clean` the marker that says "this is a
    // checkout". Every other script of the manifest names only files
    // that the package ships — or no file at all, which is what the
    // clean command does: the installed package has no build output of
    // its own to empty, and the manifest must not point at a file the
    // reader does not have.
    //
    // The test command is the one that has to run without the files it
    // names (S99), and the rule below proves that it does.
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

  test('the test command of the manifest runs in the published package', async () => {
    // S99: the package ships no test files, and the test command of the
    // manifest names the pattern of the test files of the checkout. The
    // command has to find those files itself: it runs them when they
    // are there, and it says that there are none when there are none.
    //
    // The rule runs the command in the package that is published, and
    // not in a checkout: the published package is what a reader of the
    // package gets, and a command that breaks there is a command that
    // cannot be run. The exception of the test command in the list of
    // the files of the checkout is earned here — without this rule, the
    // exception would hide a command that breaks in an installation.
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const command = manifest.scripts['test'];
    assert.ok(command !== undefined, 'the manifest has no test script');

    const result = await runNpm(['test'], packageDir);

    assert.equal(result.code, 0, `the test command of the published package failed:\n${result.output}`);
    assert.doesNotMatch(
      result.output,
      /Could not find/,
      'the test command of the published package looks for a file that the package does not ship',
    );
    assert.match(
      result.output,
      /no test files/,
      'the test command of the published package does not say that the package ships no test files',
    );
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
    // planted in a copy of the package — or in a file of the repository,
    // for the rule of the values of the installation — the rule that the
    // value breaks is run over the planted file, and the rule has to
    // catch the value.
    //
    // The values are the values of the standards, and none of them names
    // the installation the package was written for: the guard protects
    // the published package against private data, and not against the
    // values of this installation (S80). The values of the installation
    // are read from the installation itself, and they are not written
    // down here either.
    const context = guardContext(files);

    // The values of the installation are probes of the rule as well. They
    // are read from the installation itself, so they are not written
    // down here.
    for (const probe of [...RULE_PROBES, ...installationProbes()]) {
      const text = probe.inRepository
        ? plantRepositoryFile(probe.file, probe.value)
        : plant(probe.file, probe.value);
      const hits = probe.find(probe.file, text, context);

      // The message of a probe of the values of the installation names
      // what was planted and not the value: a log of a red run must not
      // publish the value it caught.
      const planted = probe.hidesValue === true ? 'the value of the installation' : `"${probe.value}"`;
      assert.ok(hits.length > 0, `the guard did not catch ${planted} — ${probe.what}`);

      // The rule of the values of the installation leaves the value out
      // of its message: a log of a red run must not publish the value it
      // caught. The message names the file and the line all the same.
      if (probe.hidesValue === true) {
        assert.match(
          hits[0],
          new RegExp(`^${escapeRegExp(probe.file)}:\\d+: `),
          `the message of the rule does not name the file and the line — ${probe.what}`,
        );
        for (const hit of hits) {
          assert.ok(
            !hit.includes(probe.value),
            `the message of the rule wrote out the value it caught — ${probe.what}`,
          );
        }
        continue;
      }

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

  test('the names of the machines of the package are the ones the allowance names', () => {
    // The name of a machine is an ordinary word, and the package is full
    // of ordinary words. The names the package gives to the machines of
    // its examples are written down in `PACKAGE_MACHINE_NAMES`, and the
    // guard leaves them alone.
    //
    // The list cannot go quiet in the other direction either: a name that
    // the package uses where a name of a machine stands is a name of the
    // package, and it has to be on the list. A new name in the
    // documentation of the package has to leave the guard alone as well,
    // and this test says so.
    const names = new Set<string>();
    // The values of the installation are not names of the package: a
    // value of the installation that stands in the documentation is a
    // leak, and the rule of the values of the installation catches it.
    const values = INSTALLATION_VALUES.map((entry) => entry.value.toLowerCase());
    const partOfAValue = (word: string): boolean =>
      values.some((value) => value.includes(word));

    for (const file of files.filter((name) => name.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(packageDir, file), 'utf8');
      for (const found of text.matchAll(/[A-Za-z0-9_][A-Za-z0-9_-]*/g)) {
        const word = found[0];
        const index = found.index ?? 0;
        if (!namesAMachine(text.slice(0, index), text.slice(index + word.length))) continue;
        names.add(word.toLowerCase());
      }
    }

    const missing = [...names]
      .filter((name) => !PACKAGE_MACHINE_NAMES.includes(name) && !partOfAValue(name))
      .sort();
    assert.deepEqual(
      missing,
      [],
      'the package uses names where the name of a machine stands, and they are not on the list:\n' + missing.join('\n'),
    );

    // The list cannot name a name the package does not use: an allowance
    // that nothing uses is a hole that may go quiet.
    const unused = PACKAGE_MACHINE_NAMES.filter((name) => !names.has(name)).sort();
    assert.deepEqual(
      unused,
      [],
      'the list names names the package does not use — the names have to leave the list:\n' + unused.join('\n'),
    );
  });

  test('the domains the package publishes on purpose are the ones the allowance names', () => {
    // The zone of the DNS is caught even when the package publishes it,
    // and the domains the package publishes on purpose are the
    // exception: the host of the public repository, the domain of the
    // support address, the registry and the conventions the package
    // follows.
    //
    // An allowance that nothing uses is a hole that may go quiet: every
    // domain on the list has to be a domain the package really
    // publishes, and when the package stops publishing one, the domain
    // has to leave the list.
    for (const domain of PUBLIC_DOMAINS) {
      assert.ok(
        packageUsesValue(domain, packageDir, files),
        `the package does not publish the domain "${domain}" — the domain has to leave the list`,
      );
    }
  });

  test('the files the package does not ship hold no private value', () => {
    // The tarball is not the whole of the repository. The specification,
    // the memory of the project, the code of the project and the
    // documents of the repository are not in the tarball — and S101 took
    // the values of the installation out of them, because the repository
    // is about to become public. The guard read the tarball only, and
    // the values could come back into `specs/` and `memory/` without
    // anything falling.
    //
    // The values of the installation are read from the installation
    // itself: its own configuration file, its own route store and the
    // DNS of its zone. A machine without an installation has no values,
    // and the rule reads nothing there.
    //
    // The generic rules of private data are read over the documents of
    // the repository as well: an address of a private network, the
    // address of an account and the host of a git server are private in
    // a document of the repository as much as they are in the tarball.
    // They are not read over the code of the project: the code carries
    // the addresses of the examples and the values of the probes of the
    // guard itself, and a rule of a shape would read them as private
    // data.
    const unshipped = unshippedRepositoryFiles(files);
    const documents = unshipped.filter((file) => file.endsWith('.md'));

    assert.ok(
      unshipped.length > 20,
      `the repository holds ${unshipped.length} files the package does not ship — the rule would read nothing`,
    );
    assert.ok(documents.length > 5, `the repository holds ${documents.length} documents — the rule would read nothing`);
    for (const file of ['specs/tech-architecture/naming.md', 'memory/boarden.md', 'MEMORY.md', 'CONTRIBUTING.md']) {
      assert.ok(unshipped.includes(file), `the rule does not read ${file}`);
    }

    const privateHits: string[] = [];
    const installationHits: string[] = [];

    for (const file of unshipped) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      installationHits.push(...installationValueTraps(file, text, INSTALLATION_VALUES, PUBLISHED_IN));
    }

    for (const file of documents) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      privateHits.push(...repositoryFileTraps(file, text));
    }

    assert.deepEqual(
      privateHits,
      [],
      'the documents of the repository hold private data:\n' + privateHits.join('\n'),
    );
    assert.deepEqual(
      installationHits,
      [],
      'the files the package does not ship hold a value of the installation:\n' + installationHits.join('\n'),
    );
  });

  test('the rule of the values of the installation catches the values of an installation', async () => {
    // A rule that cannot fail guards nothing. The rule is run against an
    // installation of its own — a configuration file of its own, in a
    // directory of its own, with a route store of its own — and the
    // values of that installation have to be caught where they stand. The
    // values of that installation are values of the standards: they name
    // nothing of this installation, and they may be written here in a
    // public repository.
    //
    // The installation of the probe is the same one the rule over the
    // tarball is proved with (S107): one installation of the rule's own,
    // used by both proofs.
    const probe = probeInstallation();

    try {
      const values = await probe.values();

      const zone = values.find((entry) => entry.what === 'the DNS zone of the installation');
      assert.ok(zone !== undefined, 'the rule did not read the zone of the installation');
      assert.deepEqual(
        installationValueTraps('specs/tech-architecture/naming.md', `The zone is ${zone.value}.`, values),
        ['specs/tech-architecture/naming.md:1: the DNS zone of the installation'],
        'the rule did not catch the zone of the installation',
      );

      // The message of the rule names the file and the line and not the
      // value: a log of a red run must not publish the value it caught.
      assert.ok(
        !installationValueTraps('specs/tech-architecture/naming.md', `The zone is ${zone.value}.`, values)[0].includes(
          zone.value,
        ),
        'the message of the rule wrote out the zone of the installation',
      );

      const host = values.find((entry) => entry.what === 'the host name of the installation');
      assert.ok(host !== undefined, 'the rule did not read the host name of the installation');

      // The name of the machine is an ordinary word, and an ordinary word
      // is not a value of an installation: the guard may not report every
      // word of the repository that is the name of the machine.
      assert.deepEqual(
        installationValueTraps('memory/boarden.md', `The machine is called ${host.value}.`, values),
        [],
        'the rule caught the name of the machine as an ordinary word',
      );

      // The name is caught where it names a machine.
      assert.deepEqual(
        installationValueTraps('memory/boarden.md', `The machine is ${host.value}:45002.`, values),
        ['memory/boarden.md:1: the host name of the installation'],
        'the rule did not catch the name of the machine',
      );
      assert.deepEqual(
        installationValueTraps('memory/boarden.md', `The installation lives in /opt/${host.value}-api.`, values),
        ['memory/boarden.md:1: the host name of the installation'],
        'the rule did not catch the name of the machine in a path',
      );
      assert.deepEqual(
        installationValueTraps('memory/boarden.md', `The proxy serves ${host.value}.private.`, values),
        ['memory/boarden.md:1: the host name of the installation'],
        'the rule did not catch the name of the machine in a host name',
      );

      const service = values.find((entry) => entry.what === 'the name of a service of the installation');
      assert.ok(service !== undefined, 'the rule did not read the name of a service of the installation');
      assert.ok(
        installationValueTraps('memory/boarden.md', `The service is ${service.value}.`, values).length > 0,
        'the rule did not catch the name of a service of the installation',
      );

      const serviceHost = values.find((entry) => entry.what === 'the host name of a service of the installation');
      assert.ok(serviceHost !== undefined, 'the rule did not read the host name of a service of the installation');
      assert.ok(
        installationValueTraps('memory/boarden.md', `The service answers at ${serviceHost.value}.`, values).length > 0,
        'the rule did not catch the host name of a service of the installation',
      );

      const installationPath = values.find((entry) => entry.what === 'the path of the installation');
      assert.ok(installationPath !== undefined, 'the rule did not read the path of the installation');
      assert.ok(
        installationValueTraps('memory/boarden.md', `The installation lives in ${installationPath.value}.`, values).length > 0,
        'the rule did not catch the path of the installation',
      );

      // A machine without an installation has no values of an
      // installation, and the rule reads nothing there.
      const without: NodeJS.ProcessEnv = {
        ...process.env,
        GATEWARDEN_CONFIG: path.join(probe.home, 'no-such-file.json'),
      };
      delete without['GATEWARDEN_HOME'];
      delete without['DEV_GATEWAY_HOME'];
      assert.deepEqual(
        await installationValues({ env: without }),
        [],
        'the rule read values without an installation',
      );
    } finally {
      probe.remove();
    }
  });
});
