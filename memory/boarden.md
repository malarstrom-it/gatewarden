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
  repository is to become public, and these values belong to the installation, not to the package.

## Where the backlog lives

The tasks for the repository live on the board, not in the repository. The board's *to do* list
is shown by `herdr-projects list`, and the tasks for this repository are named `traefik-api/<n>`
(for example `traefik-api/1`, this task). `TASKS.md` in the 0.2 project was empty and stays as
history.
