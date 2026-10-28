# Traefik dev gateway — container side

Exposes the dev servers that AI agents run **inside this container** on the user's LAN through the
user's Traefik.

* A **registry** serves the Traefik dynamic-configuration document (HTTP provider) and answers a
  health probe. Nothing else: the web interface is gone (D8).
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
     │                ── /healthz
     └─ relay    :45001  ── dispatches on the X-Dev-Target header to 127.0.0.1:<dev port>
```

One registration = one Traefik router + one service + one dispatch middleware, added and removed
atomically. A section without entries is **omitted** from the document (never rendered as `{}`):
Traefik's decoder rejects an empty map. The FQDN is `<branch>.<project>.home.malarstrom.com`; the branch label is a DNS-safe
slug (GitLab `CI_COMMIT_REF_SLUG` convention).

## How the code is laid out

```text
src/
├── core/         # proxy-agnostic: routes, ports, host names, reachability
├── adapters/     # one per proxy: Traefik's document format lives here
├── cli.ts        # the command line, a client of the core
├── daemon.ts     # the daemon entry point
└── worker.ts     # the worker entry point
```

The core knows about routes, ports, host names and whether a dev server
answers. It does not know what a router, a service or a middleware is: a
proxy is reached through the `ProxyAdapter` contract in `src/core/proxy.ts`,
and the Traefik implementation of it lives in `src/adapters/traefik.ts`. The
core never imports an adapter — the entry points pick one and hand it to the
core. The document the registry serves is rendered by the adapter, under the
adapter's id (`/traefik`).

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
| `traefik-dev migrate [--dry-run]` | move the old layout (`~/.traefik-dev/`) to the new one, and report what moved |

Global options: `--config <path>`, `--state-dir <path>`, `--json`.

Environment: `DEV_GATEWAY_HOME` (everything in one directory), `DEV_GATEWAY_CONFIG` (the
configuration file), `DEV_GATEWAY_STATE_DIR` (the state directory).

## The route list

What is running is a list, not a page. The web interface is gone (D8, §10.1): it was a browser
UI for a person who is not in the container, and everything it carried is available to the agent,
to the user's shell and to the user's terminal.

```bash
traefik-dev list
# PROJECT  BRANCH  FQDN                                 PORT  STATE  UPDATED
# alpha    main    main.alpha.home.malarstrom.com        5173  up     2026-02-11T09:14:02.104Z
```

`--json` gives the same list to a script. The agent's own surface is the MCP tool
`list_dev_servers` and, in pi, the `/routes` command; both read the same state file the CLI reads.

The state is honest: `up` and `down` come from the gateway's own probe of the dev server's port,
so a route that is registered but dead cannot pass as working.

## Removing a registration by hand

The route list has a remove: `traefik-dev unregister --project <p> --branch <b>`. The router, the
service and the middleware disappear from the dynamic configuration document, and Traefik drops the
route on its next poll (≈5 s).

This exists for the case where an agent forgot to unregister a dev server it stopped: the user can
clean up without an agent. An agent that stops a dev server should still unregister it itself.

There is no HTTP endpoint for it: the registry serves the configuration document and the health
probe, and nothing else (D9). The extension, the CLI and the MCP server write the route state file
directly, so there is no write path left to guard.

## URLs the user can click

| URL | What it shows |
| --- | --- |
| `https://<branch>.<project>.home.malarstrom.com` | the registered dev server |

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

Nothing to install: Node 24 (native TypeScript execution) is enough, and the only runtime
dependency is `env-paths` (the XDG path resolution).

```bash
git clone <this repo> ~/projects/traefik-api
cd ~/projects/traefik-api
npm install          # dev-only tooling (typescript, @types/node)
```

The commands are plain scripts:

```bash
node bin/traefik-dev.js  register --project alpha --branch main --port 5173
node bin/traefik-devd.js                        # run the daemon in the foreground
node bin/traefik-devd.js --config <path>        # ... with another configuration file
```

The daemon reads the configuration file of the XDG configuration directory, the same file the CLI
reads. `--config <path>` names another one; the daemon hands that file to the workers it forks, so
that all three read the same configuration.

`npm link` (or a symlink into `~/.local/bin`) makes `traefik-dev` available on the `PATH`.

## Files and configuration

The files follow the XDG Base Directory specification (D6):

| Purpose | Linux | macOS | Windows |
| --- | --- | --- | --- |
| configuration | `~/.config/dev-gateway/config.json` | `~/Library/Preferences/dev-gateway/` | `%APPDATA%\dev-gateway\Config\` |
| state (routes, pid) | `~/.local/state/dev-gateway/` | `~/Library/Application Support/dev-gateway/` | `%LOCALAPPDATA%\dev-gateway\State\` |
| log | `~/.local/state/dev-gateway/daemon.log` | `~/Library/Logs/dev-gateway/` | `%LOCALAPPDATA%\dev-gateway\Log\` |
| cache | `~/.cache/dev-gateway/` | `~/Library/Caches/dev-gateway/` | `%LOCALAPPDATA%\dev-gateway\Cache\` |

The state directory holds:

| File | Content |
| --- | --- |
| `routes.json` | the routes (the single source of truth, written atomically) |
| `daemon.pid` | pid of the running daemon |
| `daemon.log` | daemon log (rotated at 5 MB, 3 files kept) |

Three environment variables move the files:

| Variable | Effect |
| --- | --- |
| `DEV_GATEWAY_HOME` | everything in one directory: the configuration, the state, the log and the cache |
| `DEV_GATEWAY_CONFIG` | the configuration file only |
| `DEV_GATEWAY_STATE_DIR` | the state directory only |

The old layout (`~/.traefik-dev/`) is picked up on the first run: when the new configuration file
does not exist and the old one does, the old values become the new configuration and the old route
store is imported. The old directory is left in place. `dev-gateway migrate` does the same import
explicitly and reports what it moved; `dev-gateway migrate --dry-run` only reports.

## Configuration

The configuration file (`~/.config/dev-gateway/config.json` on Linux; create it with
`traefik-dev config --write`). Every key:

| Key | Default | Meaning |
| --- | --- | --- |
| `proxy` | `"traefik"` | which proxy adapter writes the dynamic configuration |
| `registryPort` | `45002` | port the registry binds on `0.0.0.0` |
| `relayPort` | `45001` | port the relay binds on `0.0.0.0` |
| `advertisedIp` | detected (`172.16.2.13`) | IP this container has on the Docker network (used in the status output) |
| `advertisedHost` | `devbox` | host name the Traefik container reaches this container under; `devbox` is the compose service name and resolves on the `private` network, so it survives an IP change |
| `zone` | `home.malarstrom.com` | DNS zone the FQDNs are built from |
| `entryPoints` | `["websecure"]` | Traefik entryPoints the routers attach to |
| `certResolver` | `cloudflare` | ACME resolver used for the `tls` block (empty = no `tls` block) |
| `tlsMode` | `wildcard` | `wildcard` = one certificate per project (`*.<project>.<zone>`), `fqdn` = one per branch |
| `securityHeaders` | `false` | also apply the user's `default-security-headers@file` middleware |
| `compressMiddleware` | `false` | also apply the user's `compress@file` middleware |
| `middlewareProvider` | `file` | provider that owns those shared middlewares |
| `allowedCidrs` | `["172.16.2.0/24", "127.0.0.1/32", "::1/128"]` | sources allowed to use the `X-Dev-Target` header; the container's own IPv6 prefix is added automatically |
| `secret` | `""` | optional shared secret (checked on the registry document and the relay dispatch) |
| `stateDir` | the XDG state directory | the route store and the pidfile |
| `documentFormat` | `yaml` | `yaml` or `json` for the dynamic configuration document |
| `logMaxBytes` | `5242880` | rotate the log file above this size |
| `logKeep` | `3` | rotated log files to keep |
| `autostart` | `true` | whether `postinstall` may start the daemon |

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
docker exec <container> sh -lc 'nohup node /home/node/projects/traefik-api/bin/traefik-devd.js >> /home/node/.local/state/dev-gateway/daemon.log 2>&1 &'
```

Lazy start makes this optional: the first `traefik-dev register` after a restart is enough.

## Building

```bash
npm run build # tsc -p tsconfig.build.json
```

The build writes `dist/`: the compiled JavaScript, the type declarations and the source maps. The
source keeps its `.ts` import specifiers — Node does not resolve `./config.js` to `./config.ts` —
and `tsc` rewrites them to `.js` in the output (`rewriteRelativeImportExtensions`).

The launchers in `bin/` are thin. In a checkout they run the TypeScript source, so the working tree
is always what runs. In an installed package — under `node_modules`, where Node cannot strip types —
they run the compiled `dist/`.

Two paths are runtime strings that the compiler cannot rewrite: the daemon names the worker next to
it, and the daemon control names the daemon next to it. Both are resolved against the module that
asks for them, with the extension of the world they run in, so they work in `src/` and in `dist/`.

`prepublishOnly` runs the build and the tests before the package is published.

## Tests

```bash
npm test          # node --test test/*.test.ts
npm run typecheck # tsc --noEmit
```

Covered: slug and FQDN derivation, the registration lifecycle and its atomicity, idempotent
re-registration, the rendered document parsing back to the same object, the golden document
(byte for byte), relay dispatch, `404`/`403`/`502` paths, `X-Forwarded-*` passthrough, streaming and
SSE, the WebSocket upgrade, the registry endpoints (the configuration path, the health probe, and
the 404 for everything else), the CLI, `ensureDaemon()` starting the daemon, the daemon restarting
after a kill and the daemon respawning a dead worker.
