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

**The build deletes `dist/` before it writes it.** Never run `npm run build`
while the tests are running: two of the test files read the compiled
output, and a build in the middle of them takes the output away.

**`npm pack` writes a tarball in the repository**, and `*.tgz` is not in
`.gitignore`. Remove the tarball when you are done, or write it somewhere
else:

```bash
npm pack --pack-destination /tmp
```

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
- **A change a consumer can see gets a changelog entry**, under
  `Unreleased` in `CHANGELOG.md`.
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

## License

By contributing you agree that your contribution is licensed under the MIT
license of this repository, like the rest of it.
