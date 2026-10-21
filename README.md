# Traefik dev gateway — container side

Exposes the dev servers that AI agents run **inside this container** on the user's LAN through the
user's Traefik.

* A **registry** serves the Traefik dynamic-configuration document (HTTP provider) and an index page
  listing everything that is currently registered.
* A **relay** forwards a request to the right dev server on `127.0.0.1:<port>`, including WebSocket
  upgrades (Vite HMR, Next.js) and `X-Forwarded-*` headers untouched.
* A **CLI** (`traefik-dev`) registers and unregisters a dev server and starts the daemon if it is not
  running.

The user's Traefik is **not** touched by this repository. The one change the user makes is the
static configuration patch in [`docs/traefik-wiring.md`](docs/traefik-wiring.md).

## How it fits together

```
user laptop ──https://<branch>.<project>.home.malarstrom.com──▶ Traefik (host, 10.10.1.50)
                                                                    │  HTTP provider polls /traefik
                                                                    ▼
   this container ("devbox" on the Docker network "private", 172.16.2.13)
     ├─ registry :45002  ── /traefik  (dynamic configuration document)
     │                ── /         (HTML index: what is running)
     │                ── /api/registrations
     │                ── /healthz
     └─ relay    :45001  ── dispatches on the X-Dev-Target header to 127.0.0.1:<dev port>
```

One registration = one Traefik router + one service + one dispatch middleware, added and removed
atomically. A section without entries is **omitted** from the document (never rendered as `{}`):
Traefik's decoder rejects an empty map. The FQDN is `<branch>.<project>.home.malarstrom.com`; the branch label is a DNS-safe
slug (GitLab `CI_COMMIT_REF_SLUG` convention).

## What an agent needs to run

```bash
traefik-dev register --project <project> --branch <branch> --port <dev port>
# → registered feature-login.alpha.home.malarstrom.com -> 127.0.0.1:5173
#   url: https://feature-login.alpha.home.malarstrom.com

traefik-dev unregister --project <project> --branch <branch>
```

`register` writes the registration to the persistent state and **starts the daemon if it is not
running**, so the first `register` after a container restart brings the whole gateway back up.
Nothing else has to be started by hand.

Other commands:

| Command | What it does |
| --- | --- |
| `traefik-dev register --project p --branch b --port N [--label text]` | register (or update the port of) a dev server |
| `traefik-dev unregister --project p --branch b` | remove the registration |
| `traefik-dev list` | list the registrations (`--json` for scripts) |
| `traefik-dev status` | daemon state, ports, configuration summary |
| `traefik-dev config [--write]` | show the configuration and every key (`--write` writes the file) |

Global options: `--config <path>`, `--state-dir <path>`, `--json`.

## URLs the user can click

| URL | What it shows |
| --- | --- |
| `https://<branch>.<project>.home.malarstrom.com` | the registered dev server |
| `https://index.home.malarstrom.com` | the index: every registration, its URL, port and up/down state |

## The `traefik-dev-gateway` pi skill

A **pi skill** in [`skills/traefik-dev-gateway/`](skills/traefik-dev-gateway/) teaches any pi agent
— in this project or in any other — that a dev server started inside this container can be
published on the user's LAN. The skill is advertised to pi by name and description, and its body is
loaded only when a task matches ("start a dev server and give me a URL").

Install it globally by adding the skills directory to the **user** settings
(`~/.pi/agent/settings.json`):

```json
"skills": ["~/projects/traefik-api/skills"]
```

Then, in any project, the agent registers a dev server with the same command as above and hands the
user `https://<branch>.<project>.home.malarstrom.com`.

The skill body is short on purpose; the depth lives in
[`references/troubleshooting.md`](skills/traefik-dev-gateway/references/troubleshooting.md) and
[`references/architecture.md`](skills/traefik-dev-gateway/references/architecture.md).

## Installation

Nothing to install: Node 24 (native TypeScript execution) is enough, and there are **no runtime
dependencies**.

```bash
git clone <this repo> ~/projects/traefik-api
cd ~/projects/traefik-api
npm install          # dev-only tooling (typescript, @types/node)
```

The commands are plain scripts:

```bash
node bin/traefik-dev.js  register --project alpha --branch main --port 5173
node bin/traefik-devd.js                        # run the daemon in the foreground
```

`npm link` (or a symlink into `~/.local/bin`) makes `traefik-dev` available on the `PATH`.

## State directory

Everything lives in `~/.traefik-dev/` (a mounted volume, so it survives container restarts):

| File | Content |
| --- | --- |
| `registrations.json` | the registrations (the single source of truth, written atomically) |
| `config.json` | the configuration |
| `daemon.pid` | pid of the running daemon |
| `daemon.log` | daemon log (rotated at 5 MB, 3 files kept) |

## Configuration

`~/.traefik-dev/config.json` (create it with `traefik-dev config --write`). Every key:

| Key | Default | Meaning |
| --- | --- | --- |
| `registryPort` | `45002` | port the registry binds on `0.0.0.0` |
| `relayPort` | `45001` | port the relay binds on `0.0.0.0` |
| `advertisedIp` | detected (`172.16.2.13`) | IP this container has on the Docker network (used in the status output) |
| `advertisedHost` | `devbox` | host name the Traefik container reaches this container under; `devbox` is the compose service name and resolves on the `private` network, so it survives an IP change |
| `zone` | `home.malarstrom.com` | DNS zone the FQDNs are built from |
| `indexHost` | `index.home.malarstrom.com` | host name of the index router |
| `entryPoints` | `["websecure"]` | Traefik entryPoints the routers attach to |
| `certResolver` | `cloudflare` | ACME resolver used for the `tls` block (empty = no `tls` block) |
| `tlsMode` | `wildcard` | `wildcard` = one certificate per project (`*.<project>.<zone>`), `fqdn` = one per branch |
| `securityHeaders` | `false` | also apply the user's `default-security-headers@file` middleware |
| `compressMiddleware` | `false` | also apply the user's `compress@file` middleware |
| `middlewareProvider` | `file` | provider that owns those shared middlewares |
| `allowedCidrs` | `["172.16.2.0/24", "127.0.0.1/32", "::1/128"]` | sources allowed to use the `X-Dev-Target` header; the container's own IPv6 prefix is added automatically |
| `secret` | `""` | optional shared secret (checked on the registry document and the relay dispatch) |
| `stateDir` | `~/.traefik-dev` | state, pidfile and logs |
| `documentFormat` | `yaml` | `yaml` or `json` for the dynamic configuration document |
| `logMaxBytes` | `5242880` | rotate the log file above this size |
| `logKeep` | `3` | rotated log files to keep |

## Self-healing

* `traefik-dev register` probes `/healthz` and the pidfile; if the daemon is not running it starts it
  detached and waits until it answers.
* The daemon supervises two workers (registry, relay). A worker that dies is respawned; the other
  listener keeps serving.
* Registrations live in a file, so nothing is lost when a listener restarts.

Optional host-side autostart (not applied by this repository — the container entrypoint
`/usr/local/bin/devbox-entrypoint` is root-owned and not writable by the `node` user):

```bash
# run the gateway when the container starts
docker exec <container> sh -lc 'nohup node /home/node/projects/traefik-api/bin/traefik-devd.js >> /home/node/.traefik-dev/daemon.log 2>&1 &'
```

Lazy start makes this optional: the first `traefik-dev register` after a restart is enough.

## Tests

```bash
npm test          # node --test test/*.test.ts
npm run typecheck # tsc --noEmit
```

Covered: slug and FQDN derivation, the registration lifecycle and its atomicity, idempotent
re-registration, the rendered document parsing back to the same object, relay dispatch, `404`/`403`/
`502` paths, `X-Forwarded-*` passthrough, streaming and SSE, the WebSocket upgrade, the registry
endpoints, the CLI, `ensureDaemon()` starting the daemon, the daemon restarting after a kill and
the daemon respawning a dead worker.
