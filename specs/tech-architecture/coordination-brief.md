# Coordination brief — the gatewarden package

This is the brief the board's coordinator works from. It points at the
specification; the specification is the contract.

Read `specs/tech-architecture/gatewarden.md` first. It holds the
decisions, the acceptance criteria for every slice, and the list of
`PRODUCT.md` constraints this work supersedes.

The branch `feat/npm-package` holds the specification. Its tip is the commit
`8bcea4e` ("docs(spec): the package specification").

---

## 1. The goal

Turn this repository into the npm package `@malarstrom/gatewarden`:
a proxy-agnostic core, an MCP server as the primary agent surface, and
adapters for pi, the CLI, an Agent Skill and `AGENTS.md`.

The specification holds the design. Nothing outside it is in scope.

---

## 2. The branch rule

**Everything happens on `feat/npm-package`.** That branch is the base for
every task and the branch every task's work lands on.

- The repository checkout is on `feat/npm-package`. `workspace.from here`
  therefore starts each task from the current commit of that branch.
- **Never commit on `master`.** A git guard refuses commits on `master` and
  on `main`. It says: *"Direct commits to 'master' are forbidden. Use a
  feature branch."*
- `merge.by` is `itself` and `merge.pr` is `false`, so a task that passes its
  review merges by itself, squashed, into the base branch. No pull request,
  and no remote is needed: the repository has none.

---

## 3. The slices, in order

Each slice is one task. Each task's description repeats that slice's
acceptance criteria from §12 of the specification and names the sections it
must satisfy. Each task waits for the one before it with `--after`, so they
run in order and each agent is told what the previous one did.

| Order | Slice | What it must satisfy |
| --- | --- | --- |
| 1 | **S0** — the build step | D2, §2.1 |
| 2 | **S1** — paths and configuration | D6, §3 |
| 3 | **S2** — the core split and the Traefik adapter | D3, §4 |
| 4 | **S3** — the web interface goes | D8, D9, §10 |
| 5 | **S4** — the CLI | §5, §9 |
| 6 | **S5** — the MCP server | D4, D5, §6 |
| 7 | **S6** — the pi extension | §7 |
| 8 | **S7** — the skill, the agent instructions, the documentation | §8 |
| 9 | **S8** — the setup wizard | §9 |
| 10 | **S10** — packaging and release | §2 |

**S9 — the test environment — is parked.** It is added to the board as a
task after S10, and it is **not delegated**. The human decided to build
first and test later. Nothing else waits for it.

---

## 4. What S0 must get right, because everything else stands on it

Node cannot execute TypeScript under `node_modules`:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is
currently unsupported for files under node_modules
```

So the package ships compiled JavaScript. Four things in the current tree do
not survive a build as they are, and S0 must settle all four:

1. **Relative import specifiers.** The source imports `./config.ts`. Node
   does not resolve `./config.js` to `./config.ts`, so the source keeps the
   `.ts` specifiers and `tsc`'s `rewriteRelativeImportExtensions` rewrites
   them in the output.
2. **`new URL('./worker.ts', import.meta.url)`** in `src/daemon.ts` and
   `new URL('./daemon.ts', import.meta.url)` in `src/daemonControl.ts`. These
   are runtime strings, so the compiler does not touch them. They need a
   resolution that works from both `src/` (`.ts`) and `dist/` (`.js`).
3. **The assets.** `src/registry.ts` reads `./assets/` relative to its own
   module. The build must place them next to the compiled code.
4. **The local TypeScript.** The repository has TypeScript 5.9.3 in
   `node_modules`. The `tsc` on the `PATH` is version 7.0.2. Use the local
   one (`node_modules/.bin/tsc`); the pinned version is what the package
   declares.

S0's own acceptance: `npm run build && npm test` is green, `npm pack` produces
a tarball whose binary runs, and the 103 existing tests pass unchanged.

---

## 5. The constraints that hold for every slice

- **The live system is not touched.** A separate copy of the gateway runs
  from `/opt/devbox-traefik-api`, on ports 45001 and 45002, serving
  `home.malarstrom.com`. Do not start, stop or reconfigure it. Do not
  change the user's Traefik. The tests use temporary directories and must
  keep doing so.
- **The tests stay green.** `npm test` and `npm run typecheck` pass before a
  task reports itself done.
- **Conventional Commits.** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `build:`, `chore:`.
- **No new runtime dependencies** beyond `env-paths` and `proper-lockfile`.
  The MCP SDK is a **dev** dependency only (D5). The "zero runtime
  dependencies" value in `PRODUCT.md` is narrowed, not dropped, and the
  specification says by how much.
- **The specification is the contract.** When the code and the specification
  disagree, one of them is a bug. If a slice turns out to be wrong in the
  specification, say so in the report — do not silently change the design.

---

## 6. Two decisions the human deliberately left open

- **The CLI command names.** The human did not decide whether `register`
  should be called `publish`. S4 therefore **keeps** the current names
  (`register`, `unregister`, `list`, `status`, `config`) and adds the ones
  the specification names (`setup`, `start`, `stop`, `doctor`,
  `install-service`, `migrate`). It does not rename anything. The MCP tool
  names in §6.2 *are* decided and are implemented as written.
- **The npm organisation.** The human confirmed that `malarstrom` exists on
  npm, so R5 is closed. The first publish itself waits for the human.

---

## 7. What each task reports

The report says what was built, which acceptance criteria are met, which
tests were run and what they said, what could **not** be verified and why,
and a `## Next` list. When a slice cannot be fully verified — S8's
end-to-end verification needs the test environment that is parked — the
report says so plainly rather than claiming a check that did not happen.
