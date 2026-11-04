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
3. The publish workflow publishes the version from GitHub, with npm's
   trusted publishing: no token is used and no secret is stored in the
   repository. The tag is the trigger, and the workflow publishes the
   version the tag names. What npm asks for by hand is written down in
   "Moving the repository to GitHub" below.
4. The release notes are the section of the changelog.

Never publish, never tag a release, and never touch the registry from a
pull request.

## Moving the repository to GitHub

The repository lives on GitHub: it is `github.com/malarstrom-it/gatewarden`,
in an organisation of its own, and it stays private while the migration runs.

The private server it left becomes an archive: no new work is developed on
it, and no new repository is created on it. Everything that was specific
to that server has been turned into GitHub.

### The three decisions

The three decisions below are taken. They are not questions, and a
change to one of them is a change to this section.

**1. The repository on GitHub is named `gatewarden`.** It is created in
the organisation `malarstrom-it`, and the address of the repository is
`github.com/malarstrom-it/gatewarden`. That organisation is the one the
automation of the project may create repositories in. The package is
`@malarstrom/gatewarden` and the command is `gatewarden`. The local
folder keeps the name it has today; only the repository on GitHub is
renamed.

**2. The repository is private while the migration runs.** The reason is
the repository itself: it still holds the data of the installation — the
zone of the installation, the private addresses, the names of the
machines and the containers — in `.impeccable/`, in `PRODUCT.md`, in
`memory/`, in `specs/`, in `test/`, in `tools/`, and in the history of
the branch. The zone of the installation is in 144 lines of the tip of
the branch — 127 of them in the folders named here and 17 in `tools/` —
and in 279 more lines in the history of the branch itself. The count
grows with every commit, and the maintainer counts it again before the
repository goes public:

```bash
git grep -c -F '<the zone>' feat/npm-package -- . | awk -F: '{s += $NF} END {print s}'
git log feat/npm-package -p -U0 | grep -c '^+.*<the zone>'
```

Making the repository public is a decision of its own and a work of its
own: it has to scrub the working tree and the history. It is not part
of this migration.

**3. The default branch on GitHub is `feat/npm-package`.** That is
where the development happens. `master` is pushed as well, so that the
whole history is kept. The worktrees of the project are created from the
default branch, so the base branch of a worktree is set explicitly to
`feat/npm-package` instead of being resolved from the checkout. That
setting is not in place yet: it is one of the steps that are left.

### What is different from the earlier plan

The earlier plan moved the repository to a public repository with a
scrubbed history. That is not part of this migration. The move to a
public repository comes after the migration is done and the package is
published from GitHub, and it is a decision of its own.

### What npm asks for by hand

npm's trusted publishing publishes the package from GitHub without a
token. It does not work with the actions of the server the repository
left — it works for GitHub Actions and for GitLab CI — and that is the
reason why the publication goes through GitHub.

npmjs.com asks for three things, and a person does them. Two of them can
be done from the command line as well, with npm CLI 11.15.0 or later:

1. **The scope `@malarstrom`.** The scope is the namespace the packages
   live under on the registry, and it is there already: the version
   `0.1.0` was published under it, and a scope that has been published
   under stays on the registry. A scope that is not there is an
   organisation, and an organisation is created on npmjs.com, on the page
   that creates one (`https://www.npmjs.com/org/create`). There is no
   command for that: `npm org` adds and removes the members of an
   organisation and does nothing else.
2. **The package `@malarstrom/gatewarden`.** The package comes into being
   with its first publish, and npm accepts a trusted publisher only for a
   package that is already on the registry — the package has to exist
   before the publisher can be connected to it. npm's staged publishing
   creates a package: `npm stage publish` puts a version in the staging
   queue of a package that does not exist yet, and the package is there
   from that moment. It needs npm CLI 11.15.0 or later, and it does not
   ask for the two-factor authentication — that comes with the approval.
   The staged version is not published: the workflow publishes `0.1.1`
   from the tag, so the staged version is rejected (`npm stage reject`)
   and its number is free again.
3. **Connect the package to the repository.** The package page, its
   settings, the trusted publisher for GitHub Actions. The fields are:
   - **Organization or user** — the organisation that owns the
     repository, `malarstrom-it`;
   - **Repository** — `gatewarden`;
   - **Workflow filename** — `publish.yml`. Only the name of the file,
     with the `.yml`, and the file has to live at
     `.github/workflows/publish.yml`. npm checks the path, and a
     workflow somewhere else is not the workflow that was connected;
   - **Allow actions to publish** — on. npm's staged publishing is
     always allowed, and the direct publish is a separate permission
     that is off by default. The workflow publishes directly with `npm
     publish --provenance`, so this permission has to be on; with it
     off, npm refuses the publish and the run fails in its last step;
   - **Environment name** — empty. The project uses no GitHub
     environment, and the workflow names none.

   The same connection can be made from the command line, with npm CLI
   11.15.0 or later:

   ```bash
   npm trust github @malarstrom/gatewarden \
     --file publish.yml \
     --repository malarstrom-it/gatewarden \
     --allow-publish \
     --allow-stage-publish
   ```

Only somebody with write access to the package can do this, and npm
asks for the two-factor authentication of that account.

The `repository` field of `package.json` has to name the same
repository: npm checks it, because a credential for one repository must
not publish another one.

npm does not check the configuration when it is saved. A wrong owner, a
wrong repository name or a missing permission shows up in the first
publish, and not before. Do this before the first tag: a run without the
connection fails, and it fails in the last step, after the build and the
tests have run.

### The steps that are done

- The three decisions above are taken.
- The workflows of GitHub are in the repository: `.github/workflows/ci.yml`
  and `.github/workflows/publish.yml`. The publish workflow uses npm's
  trusted publishing, and it is the workflow that npm is to be connected
  to.
- The repository exists on GitHub: `github.com/malarstrom-it/gatewarden`,
  private, with the history pushed to it and `feat/npm-package` as its
  default branch. The `master` of the private server is pushed as well,
  so that the whole history is kept.
- The manifest names the repository: `repository`, `homepage` and `bugs`
  point at the public repository, and npm checks the `repository` field
  against the repository the workflow runs in.
- The guard knows the new host. `PUBLIC_GIT_HOST` holds the host of the
  repository on GitHub, the names of the software left `GIT_SERVER_NAMES`,
  and the rule that catches the hosts of the other git servers came in:

  ```ts
  const GIT_SERVER_HOSTS = [/\bgitea\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi];
  ```

  The pattern needs the `g` flag, because the test takes it with
  `matchAll`. The pattern matches the host of a git server and not the
  word: the prose of the repository says in words that the repository
  left the private server, and that is not a leak.
- The README points at the source. The README is in the tarball, so it
  names the host of the repository on GitHub and nothing else.
- The workflows of the private server are gone: the directory with them
  is removed, and there is one CI and one publish workflow.
- The CI runs on a push to `feat/npm-package`. The work of the project
  happens on that branch, and a push to it starts the CI, so that a merge
  into it is checked on its own. `master` and `main` stay in the list,
  because the history of the server the repository left came with them.

### The steps that are left

1. Make the package `@malarstrom/gatewarden` exist on the registry, and
   connect it to the repository as the trusted publisher for GitHub
   Actions. The scope `@malarstrom` is there already. The package comes
   into being with npm's staged publishing (`npm stage publish`), because
   npm accepts a trusted publisher only for a package that is already
   there. npm does not check the connection when it is saved: a wrong
   owner, a wrong repository name or a missing permission shows up in the
   first publish, and not before.
2. Set the base branch of the worktrees explicitly to
   `feat/npm-package`. The setting `workspace.from` of the repository
   stands for `here` today, and `here` resolves the base from the
   checkout: it works as long as the checkout stays where it is, and it
   is not the same thing as naming the branch.
3. Publish the first version from GitHub: tag `vX.Y.Z`, and let the
   workflow publish it.
4. Check the tarball before the publish and after it:

    ```bash
    npm pack --dry-run
    node --test test/published-identifiers.test.ts
    ```

### Later: making the repository public

That is the next decision after the migration, and it is not this one.
It is a work of its own: the working tree has to be scrubbed, and so
does the history — a value that is deleted in the working tree is still
in the history, and the push takes the history with it.

The guard does not know the values of the installation: it protects the
package with rules, and the rules do not carry the values. The
maintainer does, and searches the working tree and the history for each
of them before the repository goes public:

```bash
git grep -Il -F '<the value>'
git log --all -S'<the value>' --oneline
```

The support address (`npm@malarstrom.se`) stays: it is public on
purpose, and the guard names it in `PUBLIC_CONTACT_ADDRESSES`.

## License

By contributing you agree that your contribution is licensed under the MIT
license of this repository, like the rest of it.
