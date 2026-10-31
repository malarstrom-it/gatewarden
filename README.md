# @malarstrom/gatewarden

[![npm version](https://img.shields.io/npm/v/@malarstrom/gatewarden)](https://www.npmjs.com/package/@malarstrom/gatewarden)
[![license](https://img.shields.io/npm/l/@malarstrom/gatewarden)](https://www.npmjs.com/package/@malarstrom/gatewarden)
[![node](https://img.shields.io/badge/node-%3E%3D20.11-5FA04E?logo=node&logoColor=white)](https://nodejs.org/)
[![ci](https://gitea.home.malarstrom.com/malarstrom/traefik-api/actions/workflows/ci.yml/badge.svg)](https://gitea.home.malarstrom.com/malarstrom/traefik-api/actions)

Give a development server that runs on this machine an https address on your
own domain: a URL you can open in a browser, on your own network.

The dev server keeps running the way it does — Vite, Next, Nuxt,
`python -m http.server`, any local port. The gateway does the rest: it tells
the proxy about the route, the proxy terminates TLS, and a relay forwards the
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

## What this is not

The name says gateway, and it is worth saying what the package is not,
because the expectation it raises is wrong in most cases.

* **Not a tunnel.** No third party is in the path. The request goes from the
  browser of the user to the proxy you already run, and from there to
  `127.0.0.1:<port>` on the machine the dev server runs on. Nothing is
  relayed through somebody else's server.
* **Not hosting.** The gateway does not run your dev server, does not deploy
  anything and does not keep your application alive. It registers a route
  and, when you unregister it, the route is gone.
* **Not TLS termination.** The proxy terminates TLS, with the certificate of
  your own resolver. The gateway never holds a certificate and never sees a
  private key.
* **Not a process manager for dev servers.** It does not start, stop or
  watch your dev server. It checks whether the port answers, so the route
  table can say `up` or `down`.
* **Not Traefik-specific.** Traefik is one adapter behind the `ProxyAdapter`
  contract. The core, the CLI, the MCP server and the route store know
  nothing about it.

## Install

```bash
npm install -g @malarstrom/gatewarden
```

Node 20.11 or later. The package ships compiled JavaScript; the runtime
dependencies are `env-paths`, the XDG path resolution, and `proper-lockfile`,
the lock around the route store.

**The package is ESM-only.** Its manifest says `"type": "module"` and it
ships ES modules. A CommonJS consumer cannot `require()` it as an ES module:
the tools that check a package report it as `ESM (dynamic import only)`, and
on Node 20 the `require()` call ends in `ERR_REQUIRE_ESM`. Use a dynamic
import instead:

```js
const gatewarden = await import('@malarstrom/gatewarden');
```

Node 22.12 and later can `require()` an ES module, so the call may work
there. That is the `require(esm)` support of Node, not a CommonJS build of
this package, and it is not available on every Node version the package
supports. The CLI, the MCP server and the pi extension are started as their
own processes, so this concerns only code that imports the package itself.

The same package is a pi package. pi installs it like any other:

```bash
pi install npm:@malarstrom/gatewarden
```

It installs from a git repository too. The compiled output is not in the
repository, so the package builds itself when it is installed from one:

```bash
npm install git+https://gitea.home.malarstrom.com/malarstrom/traefik-api.git
```

The source of the package lives at
[gitea.home.malarstrom.com/malarstrom/traefik-api](https://gitea.home.malarstrom.com/malarstrom/traefik-api).

From a tarball — a checkout, or a build of your own — the same thing:

```bash
npm install -g ./<the tarball>.tgz
```

The install starts nothing: no daemon, no open port, no process in the
background. It writes a configuration file with the default values and leaves
the machine the way it found it. The daemon starts itself the first time a
command needs it, and `gatewarden install-service` is the way to get it back
after a reboot:

```bash
gatewarden install-service
```

## What you need

This section is the whole installation: what has to be there, the steps in
the order you do them, a configuration file you can copy, a checklist that
tells you it works, and what to do when it does not.

The setup wizard (`gatewarden setup`) is **optional**. It fills in the same
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
| A DNS zone the proxy already serves, e.g. `example.com` | Every route gets the host name `<branch>.<project>.<zone>`. Without a zone there is no host name, and `gatewarden register` refuses to register a route. |
| TLS for that zone: a certificate resolver in the proxy | The user opens an `https://` address. The gateway asks the proxy's resolver for the certificate; the credentials stay in the proxy, and the gateway never reads them. |
| A machine the proxy can reach, and an address the proxy knows it by (a host name or an IP) | The proxy polls the configuration document on port `45002` and sends the requests to the relay on port `45001`. Both ports have to be open from the proxy to that machine, and the address of the proxy has to be in `allowedCidrs`: both listeners answer the trust list and nobody else. The address of the proxy is not on that list by default — see [The trust list](#the-trust-list). |

**Can** — every one of these is optional, and the gateway works without them

| What | What it gives you |
| --- | --- |
| `gatewarden setup` | writes the configuration file for you, from the values it reads from your proxy, and asks for the ones it cannot read. A shortcut, not a requirement. |
| A shared secret (`"secret"`) in the configuration file | the proxy has to present it to the registry and to the relay |
| The shared middlewares of your proxy (`compress`, `default-security-headers`) | the dev routers get them too, when you name the provider that owns them |
| `gatewarden install-service` | the daemon starts again after a reboot |
| More addresses in `allowedCidrs` | the gateway accepts them: the relay takes the dispatch header from them, the registry serves the configuration document to them |
| More addresses in `registryAllowedCidrs` | the registry serves the configuration document to them as well, on top of `allowedCidrs` — never instead of it |

### Step 1 — install the package

On the machine that runs the dev servers:

```bash
npm install -g @malarstrom/gatewarden
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
docker restart traefik
```

The name in the command is the name of your container.

This is the one change on the proxy side, and it is yours to make: the
gateway runs on another machine and cannot write the proxy's configuration.
`gatewarden setup` prints the same snippet with your values filled in and
writes it to `<state>/wiring/traefik.yml`, so that you can copy it.

What else the proxy side needs: [`docs/traefik.md`](docs/traefik.md).

### Step 3 — write the configuration file

The file is `~/.config/gatewarden/config.json` on Linux
(`~/Library/Preferences/gatewarden/config.json` on macOS,
`%APPDATA%\gatewarden\Config\config.json` on Windows). `gatewarden config`
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
  "registryAllowedCidrs": [],
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
| `allowedCidrs` | the addresses allowed to talk to the gateway: the relay takes the dispatch header from them, the registry serves the configuration document to them | the address of your proxy, and the loopback |
| `registryAllowedCidrs` | the addresses allowed to read the configuration document, on top of `allowedCidrs`; it widens the list of the registry and never narrows it | empty = the same addresses as the relay |
| `secret` | a shared secret between the gateway and the proxy | empty = none |
| `stateDir` | the directory with the routes and the pid file | empty = the XDG state directory |
| `documentFormat` | `yaml` or `json` for the configuration document | `yaml` |
| `logMaxBytes` | the log is rotated above this size | `5242880` |
| `logKeep` | how many rotated log files to keep | `3` |
| `autostart` | kept for compatibility: the install starts no daemon any more, and the daemon starts itself when a command needs it | `true` |

The empty values are not placeholders you forgot to fill in. `advertisedIp`
and `advertisedHost` are detected on every run, and a file that pins the
address of the moment it was written keeps advertising an address the machine
does not have any more. An empty value means "derived".

`gatewarden config --write` writes the file with your current values: the
same file, in the same format, when you want a starting point.

### Step 4 — start the daemon

```bash
gatewarden start
```

It prints `started the daemon (pid 12345)`. The daemon serves the
configuration document and the relay, and it outlives the command.

The daemon also starts by itself the first time a route is registered, so
this step is not strictly necessary — doing it by hand tells you at once that
the daemon works.

### Step 5 — check that it works

| Command | What a working installation answers |
| --- | --- |
| `gatewarden doctor` | `nothing is broken` (and the exit code is 0) |
| `gatewarden status` | `daemon: running (pid …)` and `zone: example.com` |
| `curl -sS http://127.0.0.1:45002/healthz` | `ok` |
| `curl -sS http://127.0.0.1:45002/traefik` | the configuration document, in YAML — the same thing the proxy polls |
| `gatewarden register --project probe --branch main --port 3999` | `url: https://main.probe.example.com` |
| open that address in a browser | your dev server |

`gatewarden doctor` is the one to start with: it names every check it made
and every check that failed. What each check means is in
[`docs/setup.md`](docs/setup.md).

After registering, wait one poll interval (the proxy polls every 2 s) before
you open the address. Register a port where something actually listens — a
dev server — or the address answers `502`: the route works, the server does
not.

### When it does not work

| Symptom | Cause | Fix |
| --- | --- | --- |
| `gatewarden register` says `no DNS zone is configured` | the configuration file has no `zone` | write the zone into the configuration file (`"zone": "example.com"`) and register again |
| the address answers `502` | the dev server is not listening on the port you registered | check it with `gatewarden list` — the state column says `up` or `down` |
| the address answers `404` at the proxy | the proxy has not picked the route up yet, or the wiring is not in place | wait one poll interval; then check that the `http` provider is in the proxy's static configuration, and that the proxy was restarted after it was added |
| the relay answers `403` | the address of the proxy is not in `allowedCidrs` | add the address of the proxy to `allowedCidrs` in the configuration file, and restart the daemon |
| the registry answers `403` | the address that asks for the configuration document is not in the trust list | add the address to `allowedCidrs` (or to `registryAllowedCidrs`) in the configuration file, and restart the daemon — the answer says which address was refused. [The trust list](#the-trust-list) says which key covers what. |
| the certificate of the address is not trusted | the resolver was not asked for a wildcard of the project, or the zone is another one | look at the resolver in the log of the proxy; `"tlsMode": "fqdn"` asks for one certificate per address instead of one per project |
| the host name does not resolve | the DNS zone has no wildcard record for the subdomains | add a `*` record for the zone to your DNS |
| `gatewarden doctor` says `not running` | the daemon is not up | `gatewarden start`, and read the log file the command names |
| the proxy serves its dashboard instead of your dev server | the route is not in the document the proxy polls | `curl -sS http://127.0.0.1:45002/traefik` — the route has to be in it |

More cases, with the reason they happen: the skill's
[troubleshooting reference](skills/gatewarden/references/troubleshooting.md).

## Quick start

**1. Install the package** on the machine that runs the dev servers:

```bash
npm install -g @malarstrom/gatewarden
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
gatewarden start
```

Every field of the configuration file, and every command with its flags, is
in [What you need](#what-you-need) above.
`gatewarden setup` does this step for you when your proxy answers on its
API: it derives the values, writes the configuration file and starts the
daemon. It is optional — the wizard is not a requirement for anything.

**3. Publish a dev server.** From the agent, with the MCP tool:

```json
{ "port": 5173 }
```

or with the CLI:

```bash
gatewarden register --project my-app --branch main --port 5173
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
    "gatewarden": {
      "command": "gatewarden-mcp",
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
pi install npm:@malarstrom/gatewarden
```

The extension gives pi users what MCP alone does not: the three tools as
native tools with an `outputSchema`, a `/routes` command that renders the
route table, and a status line with the number of live routes.

### The skill

The package ships an [Agent Skill](skills/gatewarden/SKILL.md). pi, Claude
Code, Codex and OpenCode read it; the description is what makes the agent load
it when a dev server is started.

```json
{
  "skills": ["<the directory of the package>/skills"]
}
```

### The agent instructions

[`docs/AGENTS.md`](docs/AGENTS.md) is a short, portable block for a harness
that reads context files: publish the server, give the user the returned URL,
remove the route when the server is gone.

## The CLI

| Command | What it does |
| --- | --- |
| `gatewarden register --project p --branch b --port N [--label text]` | register (or update the port of) a dev server |
| `gatewarden unregister --project p --branch b` | remove the registration |
| `gatewarden list` | list the registrations (`--json` for scripts) |
| `gatewarden status` | daemon state, ports, configuration summary |
| `gatewarden config [--write]` | show the configuration and every key (`--write` writes the file) |
| `gatewarden setup` | optional: walk a new installation through the six steps and write the configuration file ([`docs/setup.md`](docs/setup.md)) |
| `gatewarden start` | start the daemon and wait for it |
| `gatewarden stop` | stop the daemon |
| `gatewarden doctor` | report what is broken, if anything (`--strict` turns the warnings into errors as well) |
| `gatewarden install-service` | install the daemon as a service, so it survives a reboot |
| `gatewarden migrate [--dry-run]` | move the old layouts (`~/.traefik-dev/` and `~/.config/dev-gateway/`) to the new one, and report what moved |
| `gatewarden version` | print the version of the package |

Global options: `--config <path>`, `--state-dir <path>`, `--json`,
`--version`, `--help`. They are global: they work before the command and
after it.

The commands of the old CLI keep their names and their behaviour:
`register`, `unregister`, `list`, `status`, `config` and `migrate` are the
same commands they were. The commands the package adds (`setup`, `start`,
`stop`, `doctor`, `install-service`) live next to them.

Every command that reports something can report it as JSON: `--json` writes one
object to the standard output and nothing else. `gatewarden list --json` writes
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

The configuration file (`~/.config/gatewarden/config.json` on Linux).
Every key, what it means and what to write in it: [What you need](#what-you-need).
`gatewarden config` prints the same list for the installation you are in,
and `gatewarden config --write` writes the file.

The defaults are the built-in ones, not your values: you write them, and
`gatewarden setup` derives them from the proxy and writes them for you when
you would rather it did.

Not one value of one installation is in the defaults. The zone, the
certificate resolver, the provider of the shared middlewares and the host name
the proxy reaches this machine under are empty until you fill them in, and the
trust list holds the loopback addresses of this machine and the IPv6 prefixes
of its own networks — not the address of your proxy. A route needs a zone:
`gatewarden register` says so when there is none.

The values that are derived at runtime are not written to the file either: the
address of this machine, the host name that is the address, and the IPv6
prefixes of the machine's own networks. They are derived again on every run,
and a file that pins the address of the moment it was written keeps
advertising an address the machine does not have any more. An empty value in
the file means "derived".

## The trust list

Both listeners are bound on every address of the machine, so both of them
answer only the addresses in the trust list. An address that is not on the
list gets `403` and a body that says which address was refused and where the
list is written:

```text
forbidden: the source address 192.0.2.7 is not in the trust list (allowedCidrs)
```

Two keys in the configuration file decide who is on the list:

| Key | What it covers |
| --- | --- |
| `allowedCidrs` | the relay: it takes the `X-Dev-Target` dispatch header from these addresses. It covers the registry as well. |
| `registryAllowedCidrs` | the registry alone: the addresses that may read the configuration document, **on top of** `allowedCidrs`. |

`registryAllowedCidrs` only ever widens the list of the registry; it never
takes an address away from it. An empty `registryAllowedCidrs` — the default
— means that the registry trusts exactly the same addresses as the relay, and
the two listeners cannot drift apart.

The rules, in short:

* the relay answers the addresses in `allowedCidrs`;
* the registry answers the addresses in `allowedCidrs` **and** the addresses
  in `registryAllowedCidrs`;
* the health probe `/healthz` is answered to the trust list and always to the
  machine itself: the loopback is the machine, not the network, and the
  daemon has to be able to check its own liveness;
* when `secret` is set, the caller has to present it as well — in
  `X-Registry-Secret` at the registry and in `X-Relay-Secret` at the relay.
  The proxy presents it; the two listeners check it separately.

Where to write it: in the configuration file, under the keys `allowedCidrs`
and `registryAllowedCidrs`, and restart the daemon afterwards
(`gatewarden stop`, `gatewarden start`). The file is read when the daemon
starts, not on every request.

The default of `allowedCidrs` is the loopback of the machine (`127.0.0.1/32`,
`::1/128`) plus the IPv6 prefixes of its own networks. **The address of your
proxy is not on it.** A proxy on another machine has to be added, or every
request it makes is refused with `403` and no route ever reaches the proxy.
The example in [What you need](#what-you-need) writes it as `192.0.2.0/24`.

Keep `127.0.0.1/32` on the list: the examples of this README read the
configuration document over the loopback, and the loopback is the address the
default list holds.

## The files

The files follow the XDG Base Directory specification:

| Purpose | Linux | macOS | Windows |
| --- | --- | --- | --- |
| configuration | `~/.config/gatewarden/config.json` | `~/Library/Preferences/gatewarden/` | `%APPDATA%\gatewarden\Config\` |
| state (routes, pid) | `~/.local/state/gatewarden/` | `~/Library/Application Support/gatewarden/` | `%LOCALAPPDATA%\gatewarden\State\` |
| log | `~/.local/state/gatewarden/daemon.log` | `~/Library/Logs/gatewarden/` | `%LOCALAPPDATA%\gatewarden\Log\` |
| cache | `~/.cache/gatewarden/` | `~/Library/Caches/gatewarden/` | `%LOCALAPPDATA%\gatewarden\Cache\` |

The state directory holds `routes.json` (the routes, the single source of
truth, written atomically and guarded by a lock file), `daemon.pid` and
`daemon.log`.

Three environment variables move the files:

| Variable | Effect |
| --- | --- |
| `GATEWARDEN_HOME` | everything in one directory: the configuration, the state, the log and the cache |
| `GATEWARDEN_CONFIG` | the configuration file only |
| `GATEWARDEN_STATE_DIR` | the state directory only |

The names these variables had before the rename (`DEV_GATEWAY_HOME`,
`DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`) still work. They are
deprecated: the CLI reads them, and it says once that they are on their way
out. The current name wins when both are set.

Two old layouts are picked up on the first run: `~/.traefik-dev/`, which came
before the package, and `~/.config/dev-gateway/`, which is the layout of the
name the directories had before the rename. When the new configuration file
does not exist and an old one does, the old values become the new
configuration and the old route store is imported. The old directories are
left in place. `gatewarden migrate` does the same import explicitly and
reports what it moved; `gatewarden migrate --dry-run` only reports. In a
home that holds both, the newer one wins: the layout of the old name comes
after the pre-package layout, and both paths — the command and the first run
— move the same files.

The service unit of the old name (`dev-gateway.service`, the old launchd
label) is looked for as well: it names a launcher that does not exist any
more, so `gatewarden doctor` reports it, and `gatewarden install-service`
writes the unit of the current name.

## The daemon lifecycle

Two layers start the daemon, and each one is enough on its own:

| Layer | What it does | When |
| --- | --- | --- |
| the lazy start | every command that needs the daemon starts it and waits for it | always |
| `install-service` | the daemon is a service of the user | survives a reboot |

The install starts nothing. `npm install` writes the configuration file and
leaves the machine the way it found it: no daemon, no open port, no process
in the background. The first command that needs the daemon starts it, and
`gatewarden start` starts it without waiting for such a command.

The install script never fails the install: it exits 0 whatever it does, and
it does nothing as root, in CI, or when `GATEWARDEN_AUTOSTART=0` is set. npm
11 blocks the install scripts of a dependency until you have looked at them —
see [The warning of npm 11](#the-warning-of-npm-11).

`install-service` writes the unit of the platform and enables it:

| Platform | Unit |
| --- | --- |
| Linux | `~/.config/systemd/user/gatewarden.service` |
| macOS | `~/Library/LaunchAgents/com.malarstrom.gatewarden.plist` |
| Windows | a scheduled task running `gatewarden-daemon.js` |

The unit runs the daemon directly, not the CLI. `--no-enable` writes the unit
without enabling it, which is what a machine without `systemctl --user` needs.

## The uninstall

`npm uninstall @malarstrom/gatewarden` takes the daemon with it, and the
files of the installation with the daemon. The daemon watches its own
installation and stops itself when the package is gone: npm 7 and later do
not run the uninstall scripts of a package — npm's own documentation says so
— and a daemon that is left behind would keep listening on two ports for a
package that is not there any more.

The configuration file, the route store, the log and the cache go with it.
`GATEWARDEN_HOME` decides where they were, and the names the environment
variables had before the rename still work.

The package ships the scripts that do the same work for the package managers
that run them: `preuninstall` stops the daemon, `postuninstall` removes the
files.

## The warning of npm 11

npm 11 names every dependency that ships install scripts in a warning, and it
blocks those scripts until you have looked at them:

```text
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   @malarstrom/gatewarden@0.1.0 (postinstall: node scripts/postinstall.mjs; prepare: npm run build)
```

The warning is about the *scripts*, not about what they do — it names every
package that has them, however harmless they are. This package has two:

* the install script (`postinstall`) writes the configuration file with the
  default values. It starts **no daemon**, opens no port and leaves no
  process behind — the install leaves the machine the way it found it;
* `prepare` builds the package when it is installed from a git repository,
  because the compiled output is not in the repository.

Look at them, and let them run, with:

```bash
npm install-scripts ls
npm install-scripts approve @malarstrom/gatewarden
```

Nothing breaks if you do not: the setup wizard writes the same configuration
file, and the commands work without one.

The daemon is started by the commands that need it — every command starts it
when it is down — and by `gatewarden install-service`, which is the way to
have it back after a reboot:

```bash
gatewarden install-service
```

## When something does not work

`gatewarden doctor` reads the installation and reports every check it made:
the configuration file, the state directory, the daemon, the two ports, the
routes, the proxy and the service unit. It exits 1 when a check fails, so a
script can ask it. What each check means: [`docs/setup.md`](docs/setup.md).

The skill's [troubleshooting reference](skills/gatewarden/references/troubleshooting.md)
lists the failures that actually happen.

## Development

```bash
npm ci
npm run build      # tsc -p tsconfig.build.json
npm test           # node --test --test-concurrency=1 test/*.test.ts
npm run typecheck  # tsc --noEmit
npm run publish:dry-run   # what the publish would upload, without uploading it
```

`npm ci` installs exactly what the lock file says. Use it and not
`npm install`: `npm install` may write to the lock file, and a lock file that
changes on its own is a lock file nobody reviews.

The development tools need **Node 22.18 or later**: the test files are
TypeScript and Node runs them itself, and the type stripping that makes that
possible is on by default from Node 22.18. The package itself runs on Node
20.11 and later — it ships compiled JavaScript and nothing is built at install
time.

The build writes `dist/`: the compiled JavaScript, the type declarations and
the source maps. The source keeps its `.ts` import specifiers — Node does not
resolve `./config.js` to `./config.ts` — and `tsc` rewrites them to `.js` in
the output (`rewriteRelativeImportExtensions`).

The launchers in `bin/` are thin. In a checkout they run the TypeScript source,
so the working tree is always what runs. In an installed package — under
`node_modules`, where Node cannot strip types — they run the compiled `dist/`.

## Support

This is a one-person project. There is no support team, no on-call and no
guaranteed response time: an issue is answered when the maintainer has time,
usually within a few days. If you need a guaranteed answer, this package is
not for you.

Ask in the issue tracker of the repository:
[gitea.home.malarstrom.com/malarstrom/traefik-api/issues](https://gitea.home.malarstrom.com/malarstrom/traefik-api/issues).

What to write there: what you ran, what you expected, what happened instead,
and the output of `gatewarden doctor`. The last one names every check the
command made and every check that failed, and it is often the whole answer.
Before you open an issue, read
[`docs/setup.md`](docs/setup.md) — it says what every check of the doctor
means.

## Security

A hole in the package — a way to make a listener answer an address it should
not, a way to read the route store of another installation, a secret that
leaks — is reported privately, never as a public issue.

The security policy is [`SECURITY.md`](SECURITY.md): how to report it, to
whom, within what time, what to send with it, what the package already
protects and what it does not.

Do not open a public issue for a security flaw. The policy names the private
channels, and they are the ones that do not tell the world about the hole
before it is closed.

## Contributing

How to build, test, typecheck and pack the package, which commits are taken,
and what every change has to follow: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Changelog

What changed in each release: [`CHANGELOG.md`](CHANGELOG.md).

## License

MIT — the full text is [`LICENSE`](LICENSE).
