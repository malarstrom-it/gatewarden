# The board

An overview of what has moved from the 0.2 project (which lives outside the repository) into the repository, what is still there, and where the board's backlog for the repository lives.

## Now in the repository

- `MEMORY.md` — the index of the memory files.
- `memory/context-policy.md` — a pointer to the global context policy (the task continues,
  the handover is written in the closing note).
- `memory/context-usage.mjs` — the measuring tool for the context usage (40 % / 50 %).
- `memory/boarden.md` — this file.

## Still outside the repository

Everything that is left lies in the 0.2 project, outside the repository. The path there is
in the board's own files, not in the repository.

- `AGENTS.md` (and `CLAUDE.md`, a symlink to it) — the standing instructions of the project.
  What concerns the dev server is already in the repository: `skills/gatewarden/SKILL.md`,
  `README.md` and `docs/traefik.md`.
- `PROJECT.md` — the name, the goal and the role settings of the project (goal, `[[repos]]`).
- `TASKS.md` — the backlog of the 0.2 project. It was empty.
- `threads/` — seven threads, `t-0001` to `t-0007`, with `.md`, `.task.md` and `.toml` per thread.
- `library/` — the material the threads produced: `t-0002` saved the Traefik configuration as
  json/yaml, `t-0007` saved the "daylight" world and the candidates.
- `routines/pr-followup.md` — the routine for following up a PR.
- `inbox/`, `scratch/`, `uploads/`, `.state/` — the own operation of herdr-projects
  (inbox, locks, tickers, coordinator-state). Not material.
- `memory/traefik-namespace.md` — the confirmed facts about the installation (the DNS namespace,
  the FQDN template, the routing model, the container facts, the TLS rules) plus a chronological
  log of the index page and the decisions that followed. The file left the repository here: the
  repository is public since 2026-11-05, and these values belong to the installation, not to the package.

## Where the backlog lives

The tasks for the repository live on the board, not in the repository. The board's *to do* list
is shown by `herdr-projects list`, and the tasks for this repository are named `traefik-api/<n>`
(for example `traefik-api/1`, this task). The key `traefik-api` is the name the board knows
the repository by — the project itself is called Gatewarden, and the repository on GitHub is
`malarstrom-it/gatewarden`. `TASKS.md` in the 0.2 project was empty and stays as history.

## What the board may and may not do with the release branch

- **The work lands on `feat/npm-package`.** It is the release branch and the default branch of
  the repository on GitHub. `master` is a mirror of it, and it is updated at the release, not at
  every commit.
- **A change goes in through a pull request whose CI is green.** The branch is guarded by two
  rulesets of the organisation: a pull request is required, the CI workflow has to pass, the
  branch cannot be force-pushed and it cannot be deleted. `master` cannot be deleted and cannot
  be force-pushed. An administrator cannot go around the rules either.
- **The board never publishes.** No tag, no version change, no push to the registry. The version
  is the human's: the human bumps the version in a pull request, the human tags it, the
  workflow stages it on npmjs.org, and the human promotes the stage with their two-factor code.
  A staged version is not installable, so a version reaches a reader only when the human says
  so.
- **The board may work on its own.** Nothing above asks the human for a word before a change
  lands: the board reviews its own work, merges it when the CI is green, and cleans up its
  branches. The human is needed for the release and for nothing else.
