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

## Vad som krävs (what you need)

This section is the whole installation: what has to be there, the steps in
the order you do them, a configuration file you can copy, a checklist that
tells you it works, and what to do when it does not.

The setup wizard (`dev-gateway setup`) is **optional**. It fills in the same
values from your proxy and writes them for you. Every value it can derive,
you can write by hand — and on a machine where the wizard cannot reach the
proxy, or where you do not want to answer its questions, the hand-written
file is the way. Nothing below needs the wizard to have succeeded.

### The prerequisites

**Must**

| What | Why it is needed |
| --- | --- |
| Node 20.11 or later on the machine that runs the dev servers | The package is plain JavaScript; nothing is built at install time. `node --version` tells you which one you have. |
| A Traefik proxy (v2 or v3) on another machine | The proxy terminates TLS and forwards the request. The gateway never terminates TLS itself. |
| A DNS zone the proxy already serves, e.g. `example.com` | Every route gets the host name `<branch>.<project>.<zone>`. Without a zone there is no host name, and `dev-gateway register` refuses to register a route. |
| TLS for that zone: a certificate resolver in the proxy | The user opens an `https://` address. The gateway asks the proxy's resolver for the certificate; the credentials stay in the proxy, and the gateway never reads them. |
| A machine the proxy can reach, and an address the proxy knows it by (a host name or an IP) | The proxy polls the configuration document on port `45002` and sends the requests to the relay on port `45001`. Both ports have to be open from the proxy to that machine. |

**Can** — every one of these is optional, and the gateway works without them

| What | What it gives you |
| --- | --- |
| `dev-gateway setup` | writes the configuration file for you, from the values it reads from your proxy, and asks for the ones it cannot read. A shortcut, not a requirement. |
| A shared secret (`"secret"`) in the configuration file | the proxy has to present it to the registry and to the relay |
| The shared middlewares of your proxy (`compress`, `default-security-headers`) | the dev routers get them too, when you name the provider that owns them |
| `dev-gateway install-service` | the daemon starts again after a reboot |
| More addresses in `allowedCidrs` | the relay accepts the dispatch header from more than one proxy |

### Step 1 — install the package

On the machine that runs the dev servers:

```bash
npm install -g @malarstrom/agent-dev-gateway
```

### Step 2 — wire the proxy

On the machine the proxy runs on, add the `http` provider to the `providers:`
block of the static configuration of Traefik:

```yaml
providers:
  http:
    endpoint: "http://<the address the proxy reaches the machine on>:45002/traefik"
    pollInterval: 2s
```

`<the address the proxy reaches the machine on>` is the host name or the IP
that the proxy resolves to the machine the dev servers run on — the same
value you put in `advertisedHost` in the configuration file (step 3).

Then restart the proxy: the static configuration is only read at start-up.

```bash
docker restart <the traefik container>
```

This is the one change on the proxy side, and it is yours to make: the
gateway runs on another machine and cannot write the proxy's configuration.
`dev-gateway setup` prints the same snippet with your values filled in and
writes it to `<state>/wiring/traefik.yml`, so that you can copy it.

What else the proxy side needs: [`docs/traefik.md`](docs/traefik.md).

### Step 3 — write the configuration file

The file is `~/.config/dev-gateway/config.json` on Linux
(`~/Library/Preferences/dev-gateway/config.json` on macOS,
`%APPDATA%\dev-gateway\Config\config.json` on Windows). `dev-gateway config`
prints the path it uses and every key it knows.

```json
{
  "proxy": "traefik",
  "registryPort": 45002,
  "relayPort": 45001,
  "advertisedIp": "",
  "advertisedHost": "gateway.example.com",
  "zone": "example.com",
  "entryPoints": ["websecure"],
  "certResolver": "example",
  "tlsMode": "wildcard",
  "securityHeaders": false,
  "compressMiddleware": false,
  "middlewareProvider": "",
  "allowedCidrs": ["127.0.0.1/32", "::1/128", "192.0.2.0/24"],
  "secret": "",
  "stateDir": "",
  "documentFormat": "yaml",
  "logMaxBytes": 5242880,
  "logKeep": 3,
  "autostart": true
}
```

Every field, one line each:

| Field | What it means | What to write |
| --- | --- | --- |
| `proxy` | which proxy adapter writes the configuration document | `"traefik"` |
| `registryPort` | the port the configuration document is served on; the proxy polls it | `45002` |
| `relayPort` | the port the requests arrive on; the relay forwards them to your dev server | `45001` |
| `advertisedIp` | the IP the proxy reaches this machine on | empty = detected from the network interfaces |
| `advertisedHost` | the host name the proxy reaches this machine on | the name the proxy can resolve — **must** agree with the `endpoint` of the provider in step 2 |
| `zone` | the DNS zone the host names are built from: `<branch>.<project>.<zone>` | **must** — without it there is no host name |
| `entryPoints` | the entry points of the proxy the dev routers attach to | `["websecure"]` |
| `certResolver` | the name of the certificate resolver of your proxy | the name your own routers use; empty = no TLS block, and the address is then plain HTTP |
| `tlsMode` | `wildcard` = one certificate per project (`*.<project>.<zone>`), `fqdn` = one per address | `wildcard` |
| `securityHeaders` | also apply the shared `default-security-headers` middleware | `false` — the frame-deny of that middleware can break a preview |
| `compressMiddleware` | also apply the shared `compress` middleware | `false` |
| `middlewareProvider` | the provider that owns the shared middlewares — the name of your file provider, for example | empty = the shared middlewares are not used |
| `allowedCidrs` | the addresses allowed to send the dispatch header to the relay | the address of your proxy, and the loopback |
| `secret` | a shared secret between the gateway and the proxy | empty = none |
| `stateDir` | the directory with the routes and the pid file | empty = the XDG state directory |
| `documentFormat` | `yaml` or `json` for the configuration document | `yaml` |
| `logMaxBytes` | the log is rotated above this size | `5242880` |
| `logKeep` | how many rotated log files to keep | `3` |
| `autostart` | whether the install may start the daemon | `true` |

The empty values are not placeholders you forgot to fill in. `advertisedIp`
and `advertisedHost` are detected on every run, and a file that pins the
address of the moment it was written keeps advertising an address the machine
does not have any more. An empty value means "derived".

`dev-gateway config --write` writes the file with your current values: the
same file, in the same format, when you want a starting point.

### Step 4 — start the daemon

```bash
dev-gateway start
```

It prints `started the daemon (pid 12345)`. The daemon serves the
configuration document and the relay, and it outlives the command.

The daemon also starts by itself the first time a route is registered, so
this step is not strictly necessary — doing it by hand tells you at once that
the daemon works.

### Step 5 — check that it works

| Command | What a working installation answers |
| --- | --- |
| `dev-gateway doctor` | `nothing is broken` (and the exit code is 0) |
| `dev-gateway status` | `daemon: running (pid …)` and `zone: example.com` |
| `curl -sS http://<the machine>:45002/healthz` | `ok` |
| `curl -sS http://<the machine>:45002/traefik` | the configuration document, in YAML — the same thing the proxy polls |
| `dev-gateway register --project probe --branch main --port 3999` | `url: https://main.probe.example.com` |
| open that address in a browser | your dev server |

`dev-gateway doctor` is the one to start with: it names every check it made
and every check that failed. What each check means is in
[`docs/setup.md`](docs/setup.md).

After registering, wait one poll interval (the proxy polls every 2 s) before
you open the address. Register a port where something actually listens — a
dev server — or the address answers `502`: the route works, the server does
not.

### When it does not work

| Symptom | Cause | Fix |
| --- | --- | --- |
| `dev-gateway register` says `no DNS zone is configured` | the configuration file has no `zone` | write the zone into the configuration file (`"zone": "example.com"`) and register again |
| the address answers `502` | the dev server is not listening on the port you registered | check it with `dev-gateway list` — the state column says `up` or `down` |
| the address answers `404` at the proxy | the proxy has not picked the route up yet, or the wiring is not in place | wait one poll interval; then check that the `http` provider is in the proxy's static configuration, and that the proxy was restarted after it was added |
| the relay answers `403` | the address of the proxy is not in `allowedCidrs` | add the address of the proxy to `allowedCidrs` in the configuration file, and restart the daemon |
| the certificate of the address is not trusted | the resolver was not asked for a wildcard of the project, or the zone is another one | look at the resolver in the log of the proxy; `"tlsMode": "fqdn"` asks for one certificate per address instead of one per project |
| the host name does not resolve | the DNS zone has no wildcard record for the subdomains | add a `*` record for the zone to your DNS |
| `dev-gateway doctor` says `not running` | the daemon is not up | `dev-gateway start`, and read the log file the command names |
| the proxy serves its dashboard instead of your dev server | the route is not in the document the proxy polls | `curl -sS http://<the machine>:45002/traefik` — the route has to be in it |

More cases, with the reason they happen: the skill's
[troubleshooting reference](skills/dev-gateway/references/troubleshooting.md).

## Quick start

**1. Install the package** on the machine that runs the dev servers:

```bash
npm install -g @malarstrom/agent-dev-gateway
```

**2. Connect it to your proxy.** One block in the static configuration of the
proxy, a restart of the proxy, a configuration file for the gateway and a
daemon:

```yaml
providers:
  http:
    endpoint: "http://<the address the proxy reaches the machine on>:45002/traefik"
    pollInterval: 2s
```

```bash
dev-gateway start
```

Every field of the configuration file, and every command with its flags, is
in [Vad som krävs](#vad-som-krävs-what-you-need) above.
`dev-gateway setup` does this step for you when your proxy answers on its
API: it derives the values, writes the configuration file and starts the
daemon. It is optional — the wizard is not a requirement for anything.

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
| `dev-gateway setup` | optional: walk a new installation through the six steps and write the configuration file ([`docs/setup.md`](docs/setup.md)) |
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

The configuration file (`~/.config/dev-gateway/config.json` on Linux).
Every key, what it means and what to write in it: [Vad som krävs](#vad-som-krävs-what-you-need).
`dev-gateway config` prints the same list for the installation you are in,
and `dev-gateway config --write` writes the file.

The defaults are the built-in ones, not your values: you write them, and
`dev-gateway setup` derives them from the proxy and writes them for you when
you would rather it did.

Not one value of one installation is in the defaults. The zone, the
certificate resolver, the provider of the shared middlewares and the host name
the proxy reaches this machine under are empty until you fill them in, and the
trust list holds the loopback addresses of every machine. A route needs a
zone: `dev-gateway register` says so when there is none.

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
script can ask it. What each check means: [`docs/setup.md`](docs/setup.md).

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
