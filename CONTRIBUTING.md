# Contributing

Thank you for wanting to help. This file says how to get the package running
on your machine, what a good commit looks like, and what a change has to
follow.

The short version:

- every change follows the technical specification of the project;
- every commit is a conventional commit;
- every pull request keeps `npm test`, `npm run typecheck` and `npm run
  build` green;
- a vulnerability is never a public issue.

## The base branch

The package work happens on `feat/npm-package`. Open your pull request
against that branch, not against `master`.

## What you need

| What | Why |
| --- | --- |
| Node 22.18 or later | the test files are TypeScript and Node runs them itself; the type stripping that makes that possible arrived in Node 22.6 and was on by default from Node 22.18 |
| npm 10 or later | it comes with Node 22 |
| a proxy for the end-to-end tests | the end-to-end suite (`npm run test:e2e`) needs a Traefik; the unit tests do not |

The **published package** supports Node 20.11 and later. The development
tools need a newer Node than the package does, because the tests are
TypeScript. Node 22 and Node 24 are the versions the CI runs.

## Getting the package

```bash
git clone <the repository>
cd <the repository>
npm ci
```

`npm ci` installs exactly what the lock file says. Use it, not
`npm install`: `npm install` may write to the lock file, and a lock file
that changes on its own is a lock file nobody reviews.

`npm ci` also runs `prepare`, which builds the package. That is expected.

## The commands

```bash
npm run clean       # empties dist/, the output of the build
npm run build       # the TypeScript build, into dist/
npm test            # node --test, one file per area
npm run typecheck   # tsc --noEmit
npm pack            # the tarball that would be published
npm run publish:dry-run   # what the publish would upload, without uploading it
npm run test:e2e    # the end-to-end suite; needs a proxy
```

**`npm test` takes a few minutes** — around three to five, depending on the
machine. It starts daemons, writes to temporary directories and talks to real
ports. Let it run.

**`npm run build` empties `dist/` before it writes it** — it runs
`npm run clean` first. Never run `npm run build` while the tests are
running: two of the test files read the compiled output, and a build in the
middle of them takes the output away.

**`npm pack` writes a tarball in the repository**, and `*.tgz` is not in
`.gitignore`. Remove the tarball when you are done, or write it somewhere
else:

```bash
npm pack --pack-destination /tmp
```

### The scripts of the manifest

The manifest holds thirteen scripts. They fall into two groups: the four
that travel with the package, and the nine that belong to the checkout.

**The four that ship with the package.** They are the scripts of the
installation of the package, on the machine of the reader:

- `postinstall` — `scripts/postinstall.mjs`
- `prepare` — `npm run build`
- `preuninstall` — `scripts/preuninstall.mjs`
- `postuninstall` — `scripts/postuninstall.mjs`

What each one does, and when npm runs it, is written down in
`docs/install-scripts.md`. That page is guarded against the manifest, so it
is the place to read it and not a copy of it here, which would drift.

**The nine of the checkout.** They belong to the work in the repository:

- `clean` — empties `dist/`, and only in a checkout: it looks for the build
  configuration that the package does not ship;
- `build` — the TypeScript build, into `dist/`;
- `test` — the unit tests, with `node --test`;
- `test:e2e` — the end-to-end suite;
- `test:e2e:stop` — stops what an interrupted run of the suite left behind;
- `typecheck` — the type check, with `tsc --noEmit`;
- `prepublishOnly` — builds and tests the package before a publish;
- `publish:dry-run` — shows what a publish would upload, without uploading
  it;
- `start` — starts the daemon.

## The tests

The tests are `node:test` files, one file per area, named
`<area>.test.ts`. They are plain TypeScript and they use the node test
runner — there is no test framework in this package.

**A new test file has to be added to the CI.** The CI runs one job per test
file, and the list of the files is written out in the CI workflow of the
repository. A test file that is not in that list never runs in CI, and a
change that is never run is not a change.

A new test follows the shape of the tests around it:

- the name of the test says what is true, not what the function is called:
  `✔ the write is atomic: no half-written document is left behind`;
- a test that needs a directory makes its own (`fs.mkdtempSync`), and
  removes it afterwards;
- a test that needs a port takes a free one; it never takes a fixed one;
- a test never talks to the machine it runs on outside of its own temporary
  directory.

## The code

The package is plain TypeScript on Node. No framework, no bundler, no
runtime build, no runtime download.

- **ESM only.** `"type": "module"`, and the imports carry the file
  extension: `import { loadConfig } from './config.ts'`. `tsc` rewrites the
  extension to `.js` in the output, because Node does not resolve `./x.js`
  to `./x.ts`.
- **The types have to be erasable.** `erasableSyntaxOnly` is on, because
  Node strips the types instead of compiling them: no `enum`, no
  `namespace`, no parameter properties. A type that survives the strip is a
  type the runtime cannot run.
- **No new runtime dependency without asking first.** The package ships
  with two: `env-paths` and `proper-lockfile`. A third one is a decision
  for the maintainer, not for a pull request.
- **The core knows nothing about the proxy.** Traefik is an adapter behind
  the `ProxyAdapter` contract. A change that teaches the core about a
  proxy breaks the contract.
- **The comments explain the why, not the what.** The code says what it
  does; the comment says why it does it that way, and which rule of the
  specification it follows.

## The specification

**Every contribution follows the specification.** The specification lives with
the sources of the project: the technical specification, the product
description and the decisions behind them.

That means:

- a change that the specification allows is a change in the code;
- a change that the specification does not allow is **two** changes: first
  the specification, then the code — in the same pull request, in that
  order, so that a reader sees what the rule became before it sees the
  code that follows it;
- a change that breaks a rule the specification states is a change of the
  rule, not a bypass of it. "The tests were wrong" is not an answer; the
  rule and the test were written by the same person on purpose.

The user-facing documentation is in `docs/` and in `README.md`. A change in
the behaviour of the package changes them in the same pull request.

## Commits

**Conventional commits.** The subject line of a commit ends up in the
changelog of the next release, so it has to mean something on its own.

```text
<type>(<scope>): <subject>
```

The scope is optional. The subject is in the imperative mood, starts with a
lower case letter, and has no trailing period.

| Type | When |
| --- | --- |
| `feat` | a new thing the package can do |
| `fix` | a bug that a consumer would report |
| `docs` | documentation only |
| `refactor` | a change of the inside, with the same behaviour |
| `test` | tests only |
| `build` | the build, the manifest, the dependencies |
| `ci` | the workflows |
| `chore` | everything else that a consumer does not see |
| `perf` | a change that makes it faster |

Examples:

```text
feat(cli): add a --json flag to list
fix(relay): refuse a dispatch header without a registration
docs(setup): show the wizard next to the manual path
test(registry): cover the 405 of a write request
```

One commit does one thing. A commit that needs "and" in its description is
two commits.

## Pull requests

- One change per pull request. A refactoring and a new feature in one pull
  request are two pull requests.
- The title of the pull request is the subject of the commit, so it follows
  the same rule.
- The description says what changes, why, and how it was checked.
- **The CI has to be green.** That is `npm run typecheck`, `npm test`,
  `npm run build`, the package check, `npm audit --audit-level=high`,
  `publint` and `@arethetypeswrong/cli`. A red check is fixed in the pull
  request, not explained in it.
- **New behaviour gets a test.** A bug fix gets a test that fails before the
  fix and passes after it.
- **A change a consumer can see gets a changelog entry**, under the
  heading in `CHANGELOG.md` that the change belongs to: Added, Changed,
  Deprecated, Removed, Fixed or Security.
- The specification is changed first, if the change needs it (see above).

## Security

**A vulnerability is not a public issue.** Do not open one, do not open a
pull request with it, and do not post it in a chat. Report it the way the
security policy of the project says: privately, to the maintainer, and
quickly.

A bug that is harmless to know about is a normal issue. If you are not sure
which one you have, report it privately and say that you are not sure.

## Releases

The maintainer cuts the releases, not the contributors.

1. The version in `package.json` is set to the next version, and the
   changelog gets its section.
2. The commit is tagged `vX.Y.Z`. The tag and the version must agree.
3. The publish workflow stages the version on the npm registry. It does not
   publish it: a maintainer approves the staged version with two-factor
   authentication, in the CLI or on npmjs.com.
4. The release notes are the section of the changelog.

Never publish, never tag a release, and never touch the registry from a
pull request.

## Moving the repository to public GitHub

The repository lives on a private gitea server today. The package is
published on npmjs.org, and the published package names no repository at
all: the source is where the maintainer keeps it, and the guard in
`test/published-identifiers.test.ts` keeps every git server out of the
tarball.

This section is the procedure that moves the repository to public GitHub.
It is one step and not a project: `.github/workflows/ci.yml` and
`.github/workflows/publish.yml` already mirror the workflows of the gitea
server step for step, so nothing has to be written when the move happens.
What is left is the move itself and the settings that go with it.

`<owner>` and `<repo>` are the owner and the name of the public repository,
and they are used in the commands and in the fields below. Write the real
ones.

### 1. Create the public repository and move the history to it

Create an empty repository on GitHub — no README, no licence, no
`.gitignore`, so that the push below has nothing to merge with. Then move
the history:

```bash
git remote add github git@github.com:<owner>/<repo>.git
git push github master:refs/heads/master feat/npm-package:refs/heads/feat/npm-package
git push github --tags
```

The push names the branches one by one on purpose. `git push --mirror`
pushes every local branch and every remote-tracking ref of the private
server, and the names of the work branches carry the internal numbering
of the project (`work/59-s54-...`), which the guard keeps out of the
published package. The public repository gets the branches the project
has — the base branch and `master` — and the tags, and nothing else.

The private server can keep being the place where the work happens: `git
remote remove github` takes the remote away again, and the two can live
side by side.

**Before the push, the history has to be free of the data of the
installation.** The private repository is not a public one, and it holds
the zone of the installation, the addresses of its machines and the names
of its containers — in `memory/`, in `specs/`, in `tools/`, in `test/`,
in `PRODUCT.md`, in `SECURITY.md`, in `.impeccable/`, and in the guard
itself, whose list of the identifiers of the installation names them one
by one so that they stay out of the tarball. The test files and the
golden files use the zone and the host name of the installation as their
examples; they have to get other example values. A public repository is
read by everybody, and the rule that keeps that data out of the npm
package is the same rule here.

So before the push:

- take the values out of the working tree, or keep the files that hold
  them out of the public repository;
- take them out of the history as well. A file that is deleted in the
  working tree is still in the history, and the push above takes the
  history with it. `git log --all -S'<the value>'` shows where a value
  came in, and `git filter-repo` takes it out again;
- if the scrubbing of the history is more than the maintainer wants, the
  public repository can start from a fresh history with only the files
  that may be public, and the private server keeps the full one. Both are
  fine; what matters is the same in both: no data of the installation
  reaches the public repository.

The list of the values is in `test/published-identifiers.test.ts`, in
`INSTALLATION_IDENTIFIERS`, and the guard holds every one of them. Search
the working tree and the history for each of them:

```bash
git grep -Il -F '<the value>' -- ':!test/published-identifiers.test.ts'
git log --all -S'<the value>' --oneline
```

The support address (`npm@malarstrom.se`) stays: it is public on
purpose, and the guard names it in `PUBLIC_CONTACT_ADDRESSES`.

### 2. Tell the guard about the public host

In `test/published-identifiers.test.ts`:

- set `PUBLIC_GIT_HOST` to `github.com`. It is the one host the published
  package may name: the fields of the manifest name it, and the allowance
  is what lets the name through;
- remove `'gitea'` from `GIT_SERVER_NAMES`. The published package may name
  a git server now — the public one — and the rule that forbade the word
  'gitea' belonged to the time when the private server was the server of
  the project. The rule that keeps the private git server out of the
  tarball must therefore be the *host* and not the *word*;
- the entry "the host of the git server of the project" in
  `INSTALLATION_IDENTIFIERS` becomes the public host, `github.com` — step 1
  takes the private host out of the list with the rest of the values.
  `github.com` is the value `PUBLIC_GIT_HOST` allows, and it is what
  makes the fields of the manifest legal;
- add the rule that catches the host of a git server, so that the private
  git server stays out of the tarball without being written down. The
  list of the identifiers leaves the repository in step 1, and this rule
  has to keep working after that:

  ```ts
  /**
   * The hosts of the git servers the published package must not name.
   *
   * The public host of the source is allowed (see PUBLIC_GIT_HOST). Every
   * other git server is not — the private server of the project among
   * them. The pattern matches the host of a git server and not the word:
   * the prose of the changelog says in words that the repository left
   * Gitea, and that is not a leak.
   */
  const GIT_SERVER_HOSTS = [/\bgitea\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi];
  ```

  The pattern needs the `g` flag: `matchAll` takes a global pattern, and
  the test uses it. The test `the tarball names no git server` reads that
  list next to `GIT_SERVER_NAMES`.

The test `the manifest of the package names no repository` changes with
this. The manifest names the public repository in `repository`, `homepage`
and `bugs` from now on, so the test has to check that those fields name
the public host, and not that they are absent. The comments that describe
the old arrangement change with the constants.

### 3. Put `repository`, `homepage` and `bugs` back into `package.json`

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/<owner>/<repo>.git"
},
"homepage": "https://github.com/<owner>/<repo>",
"bugs": {
  "url": "https://github.com/<owner>/<repo>/issues"
}
```

`funding` stays out: the guard forbids it, and the package needs no
money.

The `repository` field is not only a convenience. npm's trusted publishing
checks that it names the repository the workflow runs in, and refuses the
publish when it does not: a credential for one repository must not
publish another one. The three fields are also what the registry shows to
a reader.

### 4. Point the README at the public source

The README names no repository today. It names the public one after the
move: a "Source" section with the address, or a line in "Support" that
says where the source lives.

The README is in the tarball, so it may name the public host and nothing
else: no other git server, no address of a private network, and no e-mail
address but the support address.

### 5. Connect the npm account to the repository

On npmjs.com: the page of the package, its settings, the trusted publisher
for GitHub Actions. The fields are:

- **Organization or user** — the account or the organisation that owns the
  repository;
- **Repository** — the name of the repository;
- **Workflow filename** — `publish.yml`. Only the name of the file, with
  the `.yml`, and the file has to be at `.github/workflows/publish.yml`.
  npm checks the path, and a workflow somewhere else is not the workflow
  that was connected;
- **Allowed actions** — the permission that lets the trusted publisher
  publish directly with `npm publish`. npm's staged publishing (`npm stage
  publish`) is always allowed, and the direct publish is a separate
  permission that is off by default. **The workflow in
  `.github/workflows/publish.yml` publishes directly with `npm publish
  --provenance`, so this permission has to be on.** With it off, npm
  refuses the publish and the run fails in its last step;
- **Environment name** — leave it empty. The project uses no GitHub
  environment, and the workflow names none.

Only somebody with write access to the package can do this, and npm asks
for the two-factor authentication of that account. The connection is what
makes the run publish without a token: the run hands npm an OpenID
Connect token, and npm exchanges it for a short-lived credential for the
connected account.

npm does not check the configuration when it is saved. A wrong owner, a
wrong repository name or a missing permission shows up in the first
publish, and not before.

Do this before the first tag. A run without the connection fails, and it
fails in the last step, after the build and the tests have run.

### 6. Swap `.gitea/` for `.github/` and remove the old workflows

The workflows of the public repository are already in the repository:

- `.github/workflows/ci.yml` — the CI, the same jobs as the gitea one;
- `.github/workflows/publish.yml` — the publish, with npm's trusted
  publishing instead of npm's staged publishing.

When the work has moved to GitHub, the old workflows go with it:

```bash
git rm -r .gitea
```

While the work still happens on the private server, both sets of
workflows are in the repository and both work. The gitea one publishes
with a token and npm's staged publishing, and a maintainer approves the
staged version with two-factor authentication. The GitHub one publishes
with the trusted publisher and npm signs the version with its
provenance. They publish the same version; they differ in who signs it
and in who approves it afterwards.

Check the trigger of the CI while you are here: it runs on a push to
`master` or `main` and on every pull request. The work of the project
happens on `feat/npm-package` while the package is not merged, so add
that branch to the trigger, or let the runs come from the pull requests.

### 7. Check that nothing of the private host is left in the tarball

```bash
npm pack --dry-run
node --test test/published-identifiers.test.ts
```

`npm pack --dry-run` lists what would be uploaded, and the guard reads
every file of the tarball. After step 2 it fails when a file names a git
server but the public one — by its host, and that is the rule that keeps
the private git server out — or an address of a private network, or an
e-mail address of an account, or a repository that is not the public one.

Read the output of both, and do not stop at a green line: the list of the
tarball must not hold a path into the private server, and the fields of
the manifest must name the public host.

## When the repository is public

Two things change when the repository is public, and one thing stays.

**The source can be fetched.** A reader who wants to read the code, see
how it works or run it themselves does not have to write to the
maintainer first:

```bash
git clone https://github.com/<owner>/<repo>.git
```

The README names the address, and the package on npmjs.org names it too,
in `repository`, `homepage` and `bugs`. A reader who finds a hole can
read the code before reporting it, and a contributor can open an issue or
a pull request in a public place instead of sending a message.

**No data of the installation may travel with it.** The rule of the
package is the rule of the repository: the zone of the installation, the
addresses of its machines, the names of its containers, the e-mail
address of its certificate account and the private git server are data of
one installation, and they are not public. The guard keeps them out of
the tarball, and the same list is the checklist for the repository before
it goes public. A public repository that carries the data of an
installation has published it, and a published address cannot be taken
back.

**The published package stays what it is.** The package on npmjs.org is
not the repository: it ships the compiled package, the scripts and the
documentation, and it names the public repository and nothing else. It
does not grow when the repository becomes public, and the install still
starts no daemon and writes nothing but the configuration file.

## License

By contributing you agree that your contribution is licensed under the MIT
license of this repository, like the rest of it.
