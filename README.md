# @malarstrom/agent-dev-gateway

Publish a development server that runs on this machine to an address the user can
open in a browser, on their own network.

An agent starts a dev server — Vite, Next, Nuxt, `python -m http.server`, any
local port — and hands the user a URL. The gateway does the rest: it tells the
proxy about the route, the proxy terminates TLS, and a relay forwards the
request to the dev server on `127.0.0.1:<port>`, WebSocket upgrades included.

```text
user laptop ──https://main.my-app.example.com──▶ the proxy
                                                        │  polls the document
                                                        ▼
   the machine the dev server runs on
     ├─ registry :45002  ── /traefik  (the dynamic configuration document)
     │                ── /healthz
     └─ relay    :45001  ── dispatches on X-Dev-Target to 127.0.0.1:<dev port>
```

* A **registry** serves the dynamic-configuration document and answers a health
  probe. Nothing else: there is no web interface and no write endpoint.
* A **relay** forwards a request to the right dev server, with the
  `X-Forwarded-*` headers untouched.
* A **daemon** supervises the two listeners and outlives the process that
  started it.
* **Five surfaces**, all clients of the same core: an MCP server, a pi
  extension, a CLI, an Agent Skill and an `AGENTS.md` block.

The core is proxy-agnostic: Traefik is one adapter behind the `ProxyAdapter`
contract, and the adapter is picked by the `proxy` key of the configuration.

## Install

```bash
npm install -g @malarstrom/agent-dev-gateway
```

Node 20.11 or later. The package ships compiled JavaScript; the runtime
dependencies are `env-paths`, the XDG path resolution, and `proper-lockfile`,
the lock around the route store.

The same package is a pi package. pi installs it like any other:

```bash
pi install npm:@malarstrom/agent-dev-gateway
```

It installs from a git repository too. The compiled output is not in the
repository, so the package builds itself when it is installed from one:

```bash
npm install git+github.com/malarstrom/agent-dev-gateway
```

From a tarball — a checkout, or a build of your own — the same thing:

```bash
npm install -g ./<the tarball>.tgz
```

## Quick start

**1. Install the package.**

```bash
npm install -g @malarstrom/agent-dev-gateway
```

**2. Wire the proxy.** Once, on the machine the proxy runs on:

```bash
dev-gateway setup
```

The wizard finds the proxy, writes the wiring the proxy needs (to
`<state>/wiring/traefik.yml`), writes the configuration and starts the daemon.
The zone, the certificate resolver, the provider of the shared middlewares and
the host name the proxy reaches this machine under are not built into the
package: the wizard derives them from the proxy, and asks for the ones it
cannot derive. The one thing it cannot do is apply the wiring — the proxy's
configuration belongs to you. It prints the snippet; you paste it into the
proxy's static configuration and restart the proxy. See
[`docs/traefik.md`](docs/traefik.md).

**3. Publish a dev server.** From the agent, with the MCP tool:

```json
{ "port": 5173 }
```

or with the CLI:

```bash
dev-gateway register --project my-app --branch main --port 5173
```

```text
registered main.my-app.example.com -> 127.0.0.1:5173 (dev server is up)
url: https://main.my-app.example.com
```

**4. Give the user that URL**, verbatim. The address is built from the zone,
the project and the branch of the installation; an agent must never compose it
by hand.

The daemon starts itself the first time a route is written, so there is no
other step.

## The agent surfaces

### The MCP server — the primary surface

The server speaks the Model Context Protocol over the standard input and the
standard output. The protocol is spoken directly; the official SDK is not a
runtime dependency, it is only the oracle of the conformance test.

```json
{
  "mcpServers": {
    "dev-gateway": {
      "command": "dev-gateway-mcp",
      "args": [],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

The `mcpServers` format is the one pi documents as matching the other MCP
clients, so the same entry works in Claude Code, Cursor, VS Code, Windsurf,
Zed, Continue, Goose and OpenCode.

| Tool | Input | Output |
| --- | --- | --- |
| `publish_dev_server` | `{ port, project?, branch?, label? }` | `{ url, fqdn, project, branch, port, state }` |
| `remove_dev_server` | `{ project, branch }` | `{ removed, fqdn? }` |
| `list_dev_servers` | `{}` | `{ routes: [{ project, branch, port, fqdn, url, state }] }` |
| `dev_gateway_status` | `{}` | `{ daemon, proxy, config, reachable }` |

The project and the branch may be left out: the project is then the name of
the working directory and the branch is the branch of the working directory,
both slugified.

The server starts no daemon when it starts. The first tool call starts it, so
running the server changes nothing until an agent asks it to.

### The pi extension

```bash
pi install npm:@malarstrom/agent-dev-gateway
```

The extension gives pi users what MCP alone does not: the three tools as
native tools with an `outputSchema`, a `/routes` command that renders the
route table, and a status line with the number of live routes.

### The skill

The package ships an [Agent Skill](skills/dev-gateway/SKILL.md). pi, Claude
Code, Codex and OpenCode read it; the description is what makes the agent load
it when a dev server is started.

```json
"skills": ["<the directory of the package>/skills"]
```

### The agent instructions

[`docs/AGENTS.md`](docs/AGENTS.md) is a short, portable block for a harness
that reads context files: publish the server, give the user the returned URL,
remove the route when the server is gone.

## The CLI

| Command | What it does |
| --- | --- |
| `dev-gateway register --project p --branch b --port N [--label text]` | register (or update the port of) a dev server |
| `dev-gateway unregister --project p --branch b` | remove the registration |
| `dev-gateway list` | list the registrations (`--json` for scripts) |
| `dev-gateway status` | daemon state, ports, configuration summary |
| `dev-gateway config [--write]` | show the configuration and every key (`--write` writes the file) |
| `dev-gateway setup` | walk a new installation through the six steps ([`docs/setup.md`](docs/setup.md)) |
| `dev-gateway start` | start the daemon and wait for it |
| `dev-gateway stop` | stop the daemon |
| `dev-gateway doctor` | report what is broken, if anything |
| `dev-gateway install-service` | install the daemon as a service, so it survives a reboot |
| `dev-gateway migrate [--dry-run]` | move the old layout (`~/.traefik-dev/`) to the new one, and report what moved |

Global options: `--config <path>`, `--state-dir <path>`, `--json`. They are
global: they work before the command and after it.

The old names of the commands still work: `register`, `unregister`, `list`,
`status` and `config` are the same commands under the same names.

Every command that reports something can report it as JSON: `--json` writes one
object to the standard output and nothing else. `dev-gateway list --json` writes
the routes in the shape the MCP tool `list_dev_servers` uses:

```json
{
  "routes": [
    {
      "project": "my-app",
      "branch": "main",
      "port": 5173,
      "fqdn": "main.my-app.example.com",
      "url": "https://main.my-app.example.com",
      "state": "up"
    }
  ],
  "registrations": []
}
```

`routes` is the shape an agent reads; `registrations` is the raw state, for the
scripts that want every field of the store.

`state` is `up` or `down`, from the gateway's own probe of the port, so a route
that is registered but dead cannot pass as working.

## The configuration

The configuration file (`~/.config/dev-gateway/config.json` on Linux). Every
key:

| Key | Default | Meaning |
| --- | --- | --- |
| `proxy` | `"traefik"` | which proxy adapter writes the dynamic configuration |
| `registryPort` | `45002` | port the registry binds on `0.0.0.0` |
| `relayPort` | `45001` | port the relay binds on `0.0.0.0` |
| `advertisedIp` | detected | IP this machine advertises to the proxy |
| `advertisedHost` | detected | host name the proxy reaches this machine under || `zone` | `""` | DNS zone the host names are built from |
| `entryPoints` | `["websecure"]` | proxy entry points the routers attach to |
| `certResolver` | `""` | certificate resolver the routers ask for (empty = no TLS block) |
| `tlsMode` | `"wildcard"` | `wildcard` = one certificate per project, `fqdn` = one per address |
| `securityHeaders` | `false` | also apply the shared security-headers middleware |
| `compressMiddleware` | `false` | also apply the shared compress middleware |
| `middlewareProvider` | `""` | provider that owns the shared middlewares (empty = they are not used) |
| `allowedCidrs` | `["127.0.0.1/32", "::1/128"]` | sources allowed to send the `X-Dev-Target` header |
| `secret` | `""` | optional shared secret |
| `stateDir` | the XDG state directory | the route store and the pidfile |
| `documentFormat` | `"yaml"` | `yaml` or `json` for the configuration document |
| `logMaxBytes` | `5242880` | rotate the log file above this size |
| `logKeep` | `3` | rotated log files to keep |
| `autostart` | `true` | whether `postinstall` may start the daemon |

The defaults are the built-in ones, not your values: `dev-gateway setup`
derives them from the proxy and writes them, and asks for the ones it cannot
derive.

Not one value of one installation is in the defaults. The zone, the
certificate resolver, the provider of the shared middlewares and the host name
the proxy reaches this machine under are empty until the wizard fills them in,
and the trust list holds the loopback addresses of every machine. A route needs
a zone: `dev-gateway register` says so when there is none, and `dev-gateway
setup` derives one from the proxy.

The values that are derived at runtime are not written to the file either: the
address of this machine, the host name that is the address, and the IPv6
prefixes of the machine's own networks. They are derived again on every run,
and a file that pins the address of the moment it was written keeps
advertising an address the machine does not have any more. An empty value in
the file means "derived".

## The files

The files follow the XDG Base Directory specification:

| Purpose | Linux | macOS | Windows |
| --- | --- | --- | --- |
| configuration | `~/.config/dev-gateway/config.json` | `~/Library/Preferences/dev-gateway/` | `%APPDATA%\dev-gateway\Config\` |
| state (routes, pid) | `~/.local/state/dev-gateway/` | `~/Library/Application Support/dev-gateway/` | `%LOCALAPPDATA%\dev-gateway\State\` |
| log | `~/.local/state/dev-gateway/daemon.log` | `~/Library/Logs/dev-gateway/` | `%LOCALAPPDATA%\dev-gateway\Log\` |
| cache | `~/.cache/dev-gateway/` | `~/Library/Caches/dev-gateway/` | `%LOCALAPPDATA%\dev-gateway\Cache\` |

The state directory holds `routes.json` (the routes, the single source of
truth, written atomically and guarded by a lock file), `daemon.pid` and
`daemon.log`.

Three environment variables move the files:

| Variable | Effect |
| --- | --- |
| `DEV_GATEWAY_HOME` | everything in one directory: the configuration, the state, the log and the cache |
| `DEV_GATEWAY_CONFIG` | the configuration file only |
| `DEV_GATEWAY_STATE_DIR` | the state directory only |

The old layout (`~/.traefik-dev/`) is picked up on the first run: when the new
configuration file does not exist and the old one does, the old values become
the new configuration and the old route store is imported. The old directory is
left in place. `dev-gateway migrate` does the same import explicitly and
reports what it moved; `dev-gateway migrate --dry-run` only reports.

## The daemon lifecycle

Three layers start the daemon, and each one is enough on its own:

| Layer | What it does | When |
| --- | --- | --- |
| the lazy start | every command that needs the daemon starts it and waits for it | always |
| `postinstall` | the install starts it once | after `npm install` |
| `install-service` | the daemon is a service of the user | survives a reboot |

`postinstall` never fails the install: it exits 0 whatever it does, and it
does nothing as root, in CI, or when `DEV_GATEWAY_AUTOSTART=0` is set.

`install-service` writes the unit of the platform and enables it:

| Platform | Unit |
| --- | --- |
| Linux | `~/.config/systemd/user/dev-gateway.service` |
| macOS | `~/Library/LaunchAgents/dev.mal.arstrom.dev-gateway.plist` |
| Windows | a scheduled task running `dev-gateway-daemon.js` |

The unit runs the daemon directly, not the CLI. `--no-enable` writes the unit
without enabling it, which is what a machine without `systemctl --user` needs.

## When something does not work

`dev-gateway doctor` reads the installation and reports every check it made:
the configuration file, the state directory, the daemon, the two ports, the
routes, the proxy and the service unit. It exits 1 when a check fails, so a
script can ask it.

The skill's [troubleshooting reference](skills/dev-gateway/references/troubleshooting.md)
lists the failures that actually happen.

## Development

```bash
npm install
npm run build      # tsc -p tsconfig.build.json
npm test           # node --test test/*.test.ts
npm run typecheck  # tsc --noEmit
npm run publish:dry-run   # what the publish would upload, without uploading it
```

The build writes `dist/`: the compiled JavaScript, the type declarations and
the source maps. The source keeps its `.ts` import specifiers — Node does not
resolve `./config.js` to `./config.ts` — and `tsc` rewrites them to `.js` in
the output (`rewriteRelativeImportExtensions`).

The launchers in `bin/` are thin. In a checkout they run the TypeScript source,
so the working tree is always what runs. In an installed package — under
`node_modules`, where Node cannot strip types — they run the compiled `dist/`.

## License

MIT.
