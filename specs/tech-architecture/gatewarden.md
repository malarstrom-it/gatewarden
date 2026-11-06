# Gatewarden — package specification

Status: **draft for review**. Nothing in this document is implemented yet.

Scope: this repository becomes the source of the npm package
`@malarstrom/gatewarden`, published under the `malarstrom` organisation.

This document is the contract the implementation is held to. When the code and
this document disagree, one of them is a bug. Every slice in §12 cites the
sections it must satisfy.

Written in English to match `PRODUCT.md`, `README.md` and the rest of
`specs/tech-architecture/`.

---

## 0. Decisions

Each decision records what was chosen, why, and what was rejected.

### D1 — The package is `@malarstrom/gatewarden`

The binary is `gatewarden`. The scope is the `malarstrom` organisation on npm.

The name is free: `https://registry.npmjs.org/gatewarden` answers 404, and the
npm search for `gatewarden` finds nothing. The version `0.1.0` was published
on 2026-11-01 and withdrawn the same day: a version that has been published
is taken for good, so the next one is `0.1.1`.

*Rejected*: the name the package had before this decision — it is taken on
npm (version 0.3.0), and that package installs a binary of the same name, so
`npx` fetches the wrong thing; `traefik-dev-gateway` (free, but names one
proxy in a package that is not about one proxy); the unscoped variant of the
old name (free, but an unscoped name is a permanent squatting risk — a scope
is owned).

The repository stays `traefik-api` for now. The repository name and the
package name are independent; renaming the repository is a separate decision.

### D2 — The package ships compiled JavaScript

Node cannot execute TypeScript that lives under `node_modules`:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is
currently unsupported for files under node_modules
```

The repository today runs its TypeScript directly (`node bin/gatewarden.js`
imports `../src/cli.ts`), which works in the repository and breaks the moment
the package is installed. The package therefore builds to `dist/` with `tsc`
and publishes `dist/`.

This is also the npm convention: published packages contain JavaScript.

*Rejected*: shipping TypeScript and relying on the consumer's runtime to
strip types (does not work), shipping TypeScript and relying on a loader
(jiti) (works only for pi, not for the MCP server or the CLI).

### D3 — The core is proxy-agnostic; Traefik is one adapter

The core knows about routes, ports, host names and reachability. It does not
know what a router, a service or a middleware is. Traefik's document format
lives in one adapter behind the `ProxyAdapter` interface (§4.2).

*Rejected*: keeping Traefik inside the core (the reason the package would
only ever serve Traefik users), a plugin system (unnecessary until a second
adapter exists).

### D4 — MCP is the primary agent surface

The MCP server is the interface every serious agent harness speaks. The pi
extension, the CLI and the skill are adapters over the same core.

*Rejected*: the pi extension as the primary surface (works only in pi), the
CLI as the primary surface (every harness that can run a command can run it,
but the agent gets no typed tool contract and must parse text).

### D5 — The MCP server speaks the stdio JSON-RPC protocol directly

`@modelcontextprotocol/sdk` is kept as a **dev** dependency, used as a
conformance oracle in the test suite, and is not a runtime dependency.

*Why*: the project value "zero runtime dependencies" is real and is worth
protecting. The SDK pulls in `zod`, `ajv`, `express`, `hono` and `jose` —
roughly 15 MB and a large dependency tree for three tools. The MCP stdio
transport is newline-delimited JSON-RPC, which is small.

*Risk*: protocol drift. *Mitigation*: §11.4 — a conformance test drives our
server with the official SDK's client. If the conformance test turns out to
be expensive to maintain, the fallback is to make the SDK a runtime
dependency; that is a one-line change in `package.json` plus deleting the
hand-written transport.

### D6 — Files follow the XDG Base Directory specification

Resolved with `env-paths`, which is the npm ecosystem's convention.

| Purpose | Linux | macOS | Windows |
| --- | --- | --- | --- |
| configuration | `~/.config/gatewarden/config.json` | `~/Library/Preferences/gatewarden/` | `%APPDATA%\gatewarden\Config\` |
| state (routes, pid) | `~/.local/state/gatewarden/` | `~/Library/Application Support/gatewarden/` | `%LOCALAPPDATA%\gatewarden\State\` |
| log | `~/.local/state/gatewarden/daemon.log` | `~/Library/Application Support/gatewarden/daemon.log` | `%LOCALAPPDATA%\gatewarden\State\daemon.log` |

`env-paths` supplies configuration, data and cache directly. The state
directory is one extra resolution, because XDG's `state` has no macOS or
Windows equivalent in `env-paths`. The log file follows the state
directory, on every platform: the state directory is the one place where
the CLI and the daemon agree, and the daemon must write its log where the
CLI opens it.

*Rejected*: a hidden directory in the home directory (the older convention,
which is not XDG), one directory for everything (config and mutable runtime
state have different lifecycles).

### D7 — The daemon starts lazily; the install starts nothing

Two layers, in the order a user meets them:

1. **Lazy start** (always on, default). Every entry point ensures the daemon
   is running. Zero install-time side effects.
2. **`gatewarden install-service`** writes a systemd user unit (Linux), a
   launchd agent (macOS) or a scheduled task (Windows). This is the supported
   way to survive a reboot.

The install script (`postinstall`) writes the configuration file and nothing
else: no daemon, no port, no process in the background. An install that
starts a daemon makes the machine do something the consumer did not ask for.
The lazy start does the job anyway, and `gatewarden start` starts the daemon
without waiting for a command that needs it.

**The warning of npm is about the install scripts, not about what they
do.** npm 11 names every dependency that ships install scripts in a warning
and lets the scripts run. npm 12 names the same dependencies and *blocks*
those scripts until the consumer has approved them (`npm install-scripts ls`,
`npm install-scripts approve <pkg>`). The warning does not change when the
scripts stop doing anything:
it is the presence of the scripts that it reports, and this package ships
`prepare` because a git installation has to build itself (§2.2). What the
install script does is a separate question, and the answer is now: it writes
a default configuration file and starts nothing.

*Rejected*: `postinstall` that starts the daemon (the install starts three
processes and holds two ports on every network interface of the machine), and
a `postinstall` without guards (it breaks `npm ci` in CI, and it starts a root
daemon from `sudo npm i -g`).

### D8 — The web interface is removed

The route list becomes a CLI, MCP and TUI view. The registry keeps two
endpoints: the dynamic configuration document and the health probe.

*Why*: the index page is roughly 1250 lines of code plus a Tailwind
toolchain, and it is a browser UI for a person who is not in the container.
The information it carried is available to the agent, to the user's shell
and to the user's terminal.

*Rejected*: keeping it (the request was explicit), replacing it with a
served single-page app (the same cost, and it is still a browser UI).

### D9 — The registry serves exactly two endpoints

`GET /<dynamic-config-path>` and `GET /healthz`. The route create and delete
endpoints existed only for the web page and go away with it (§10).

*Consequence*: the extension and the CLI write the state file directly. That
removes the version-skew risk between an installed package and a running
daemon, and removes the CSRF guard from the write path entirely.

The two endpoints are answered to the trust list and to nobody else (D15).

### D10 — The route state is written atomically and guarded by a lock file

The store writes to a temporary file and renames it (this already works).
A lock file around read-modify-write prevents a lost update when two agent
sessions register at the same time.

*Rejected*: locking only (a crashed process leaves a stale lock), only
atomic writes (atomic writes prevent corruption but not lost updates).

### D11 — The test environment is fully isolated from the user's live system

The test environment has its own ports, its own domain, its own Traefik, its
own state directory and its own certificates. The user's live gateway and the
user's live Traefik are never involved in a test run (§11).

### D12 — The daemon is never hosted inside an agent session

The proxy polls the configuration endpoint whether or not an agent is running.
A daemon that lives inside an agent process dies with that process, and every
published route then returns 502.

*Consequence*: the daemon is always a separate, detached process. The
agent-facing integrations are clients of it, never hosts of it.

### D13 — The installation is written out; the wizard is the optional extra step

The installation is described as something the user does: install the
package, add the `http` provider to the proxy's static configuration and
restart the proxy, write the configuration file, start the daemon (§9.1).
The setup wizard stays, and it writes the same values — but it is the extra
step, not the way an installation is made (D13, §9.2).

*Reason*: the wizard can only derive what the proxy's API answers. On a
machine where the proxy is not reachable from the gateway, where the API is
switched off, or where the user does not want to answer questions, the
wizard produces an installation that is half filled in and reported as
unconfirmed. A user who has to read a report to find out what to write is
worse off than one who is told, in order, what to write.

*Rejected*: removing the wizard (it is a real convenience where it works);
making the wizard the only way in (the installation would depend on the
proxy's API being reachable and on a terminal being attached).

*Consequence*: every value the wizard writes is documented — the zone, the
entry points, the certificate resolver, the middleware provider, the
advertised host name and the trust list — in this specification, in
`README.md` and in `docs/setup.md`, and the wizard is described as the
optional extra step in all three.

### D14 — The healthcheck reports where the installation stands; it fails only on a broken thing

The healthcheck of the package is `gatewarden doctor`. It has to run
everywhere: in a container that has no proxy, no zone, no daemon and no
public URL, and on a machine with an installation that is broken. The rule
it follows:

* A thing that is **not there** is not an error. No configuration file, no
  daemon, no zone, no proxy, no installed service: these are reported
  with their reason — `skipped` when the installation is not on the
  machine at all, `warn` when it is but is not complete — and the exit
  code stays 0.
* An installation that has **declared itself** is checked as one. A
  configuration file that declares a zone — the field the host names are
  built from, and the one field the installation cannot do without
  (§9.1) — has said what it is: its zone has to be usable and its daemon
  has to run. A configuration file that says nothing about the zone
  belongs to an installation that is not set up here: everything about it
  is a warning.
* A thing that is **there and broken** is an error (`fail`): a
  configuration file that cannot be read, a state directory that cannot be
  written to, a daemon that runs but does not answer, a proxy that answers
  but is not the one the configuration names.

The exit code of the doctor is 0 unless a check failed. `--strict` makes
the warnings errors as well, for the one who wants the whole installation
to be complete. `gatewarden status` never fails: it is a report, not a
check.

The verification of the setup wizard (§9.7) follows the same rule: a
verification that **could not run** is `skipped` with a reason (no proxy,
no zone, a public URL that cannot be fetched, a proxy that does not serve
the route yet), and only a chain that **answered with an error** is
`failed`.

*Reason*: the package is about to be published, and a healthcheck that
fails in a CI runner — because there is no proxy, no zone and no daemon
there — is a healthcheck nobody trusts. The report has to say where it
stands and why; the error has to mean that something is broken.

*Rejected*: keeping the old doctor (a missing daemon, a missing zone and
a closed port were three failures in a clean container); failing on every
warning (the doctor would fail in every clean environment there is).

*Consequence*: the doctor exits 0 in an empty environment, and the checks
it reports are the ones of §9.9.

### D15 — The registry answers the trust list, not the network

The registry is bound on every address of the machine, and the document it
serves names the projects, the branches, the zone, the address of the
machine and the port of the relay. It therefore answers the addresses in the
trust list (`allowedCidrs`) and nobody else — the same rule the relay
follows — and a refused caller gets an answer that says **why**: "the source
address 192.0.2.7 is not in the trust list (allowedCidrs)".

The registry has a list of its own (`registryAllowedCidrs`) on top of the
list of the relay. It is empty by default, and an empty list means "the same
addresses as the relay": the two listeners are trusted by the same addresses
unless the installation says otherwise. The list of the registry only
*widens* the trust — it can never take an address away from the relay.

The secret stays what it was: when the installation has one, the registry
asks for it in `X-Registry-Secret` before it hands out the document, and the
relay asks for it in `X-Relay-Secret` before it dispatches.

The health probe is the liveness of the daemon, and the daemon asks it from
the machine itself. It is answered to the trust list **and** to the
loopback — the loopback is the machine and not the network, only a process
here can use it — and it asks for no secret: it holds nothing worth one. A
trust list that leaves the loopback out must not make the daemon report
itself as broken, and the doctor and `gatewarden start` must not fail on an
installation that runs.

*Reason*: the registry was the one listener that answered anybody. The
secret was empty in the standard installation, and the document told the
network which projects run, under which names, in which zone, on which
address and on which port. The mechanism was already there — the trust list
of the relay — and not using it was an inconsistency, not a decision.

*Rejected*: leaving the registry open and relying on the secret alone (the
secret is empty in the standard installation); a list of the registry that
*replaces* the list of the relay (a hand-written file could then take the
loopback away and break the daemon's own health probe); one list for
everything and nothing else (an address that may only read the document
does not have to be allowed to dispatch).

*Consequence*: the trust list of the relay is also the trust list of the
registry; the address of the proxy has to be in it, because the proxy polls
the document and sends the dispatch header; and a `403` from the registry
names the address that was refused and the key of the list.

**The two refusals are told apart.** The registry refuses the poll of the
proxy when the proxy's address is not in its list. The proxy then has no
configuration at all, the route never reaches it, and the public URL
answers `404` — a wizard that stopped there would blame the wiring, and the
cause is the trust list. The registry writes every refusal down, with the
address it refused, and the wizard reads the log of the daemon when the
public URL does not answer: the refusal of the registry and the refusal of
the relay are two different reasons (§9.7).

---

## 1. Problem statement

### 1.1 Who has this problem

A developer runs an AI coding agent. The agent runs in a container, a
virtual machine, or a remote workspace. The agent starts a development
server. The developer wants to open it in a browser on their own machine.

The container's ports are not reachable from the developer's machine. So the
developer puts a reverse proxy in front — Traefik, Caddy, nginx, a tunnel —
usually in a sibling container on a shared Docker network, usually terminating
TLS with a certificate from a DNS challenge.

The developer then has to teach the proxy about each development server, by
hand, every time. That is the problem this package solves.

### 1.2 What the package does

It publishes a development server that runs on the agent's machine to a
host name the developer can open, and it tells the agent the address.

### 1.3 What the package does not do

- It does not terminate TLS. The proxy does.
- It does not run a development server.
- It does not replace the proxy. It configures it, and it verifies that the
  configuration works.
- It does not assume any particular agent harness. See §4.3.

---

## 2. Distribution

### 2.1 The npm package

```bash
npm install -g @malarstrom/gatewarden
```

Published contents:

| Path | Purpose |
| --- | --- |
| `dist/` | compiled JavaScript (D2) |
| `bin/gatewarden.js` | the CLI |
| `bin/gatewarden-mcp.js` | the MCP server (stdio) |
| `bin/gatewarden-daemon.js` | the daemon entry point |
| `scripts/postinstall.mjs` | the install script that writes the configuration file (§5.2) |
| `scripts/preuninstall.mjs`, `scripts/postuninstall.mjs` | the uninstall scripts: stop the daemon, remove the files of the installation (§5.4) |
| `skills/gatewarden/` | the Agent Skill (§8.1) |
| `docs/` | `AGENTS.md`, the Traefik wiring guide, the setup reference |
| `README.md`, `LICENSE` | |

`package.json` shape:

```json
{
  "name": "@malarstrom/gatewarden",
  "version": "0.1.1",
  "license": "MIT",
  "type": "module",
  "bin": {
    "gatewarden": "bin/gatewarden.js",
    "gatewarden-mcp": "bin/gatewarden-mcp.js"
  },
  "exports": {
    ".": "./dist/core/index.js"
  },
  "files": ["dist", "bin", "scripts", "skills", "docs", "README.md", "LICENSE"],
  "engines": { "node": ">=20.11" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "node --test test/*.test.ts",
    "prepublishOnly": "npm run build && npm test"
  },
  "dependencies": {
    "env-paths": "^3.0.0",
    "proper-lockfile": "^4.1.2"
  },
  "devDependencies": {
    "@modelcontextprotocol/sdk": "^1.32.2",
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0"
  },
  "pi": {
    "extensions": ["dist/integrations/pi/extension.js"],
    "skills": ["./skills"]
  },
  "keywords": ["pi-package", "mcp", "traefik", "dev-server", "agent"]
}
```

Notes:

- `engines.node` is `>=20.11`, wider than today's `>=22.6`, because the
  compiled output no longer depends on Node's type stripping.
- `dependencies` holds `env-paths` and `proper-lockfile` only. The MCP SDK is
  a dev dependency (D5).
- `files` is an allow-list, not an `.npmignore`.
- The `pi` manifest points at compiled output, so pi does not need a
  TypeScript loader for the package.
- The manifest names no repository: `repository`, `homepage`, `bugs` and
  `funding` are not in it. The package is installed from npmjs.org, and it
  does not point a reader at the host of the installation it was written
  for (S31). The name of the package, the name of the scope it lives in and
  the names of the binaries stay: they are the public name of the package.

### 2.2 The pi package

pi installs npm, git and local-path packages through `pi install`. The same
package therefore serves both audiences:

```bash
pi install npm:@malarstrom/gatewarden
pi install git:<host>/<owner>/<repository>@v1
pi install ./                                   # from a checkout
```

The git form is a capability of pi, not a promise of a public repository:
the published package names no repository of its own (S31).

### 2.3 Repository layout

```text
traefik-api/                          # the repository (name unchanged, D1)
├── package.json
├── tsconfig.json                     # type-check only, noEmit
├── tsconfig.build.json               # emit to dist/
├── bin/                              # thin launchers, no logic
│   ├── gatewarden.js
│   ├── gatewarden-mcp.js
│   └── gatewarden-daemon.js
├── src/
│   ├── core/                         # proxy-agnostic (D3)
│   │   ├── paths.ts                  # XDG resolution + overrides (D6)
│   │   ├── config.ts
│   │   ├── types.ts
│   │   ├── state.ts                  # route store (D10)
│   │   ├── probe.ts                  # reachability probing
│   │   ├── relay.ts
│   │   ├── registry.ts               # serves the dynamic configuration
│   │   ├── daemon.ts                 # supervisor
│   │   ├── worker.ts
│   │   ├── daemonControl.ts          # health probe, pidfile, lazy start
│   │   ├── log.ts
│   │   └── util/{net,slug,yaml}.ts
│   ├── adapters/                     # one per proxy (D3)
│   │   ├── types.ts                  # ProxyAdapter interface
│   │   └── traefik.ts                # Traefik document rendering
│   ├── integrations/                 # one per harness (D4)
│   │   ├── mcp/server.ts             # MCP server, stdio JSON-RPC (D5)
│   │   └── pi/extension.ts           # pi extension
│   └── cli/
│       ├── index.ts
│       ├── setup.ts                  # the setup wizard (§9.2)
│       └── service.ts                # systemd / launchd / schtasks (D7)
├── skills/gatewarden/SKILL.md
├── docs/
│   ├── AGENTS.md
│   ├── traefik.md
│   └── setup.md
├── tools/
│   └── testenv/                      # the isolated test environment (§11)
└── test/
```

### 2.4 Naming inside the package

The published package is `@malarstrom/gatewarden`; the *directories*
inside the home directory are named `gatewarden` as well, because the scope is
an npm publishing detail and the directory is a user detail.
`env-paths('gatewarden', { suffix: '' })`.

---

## 3. Paths, state and configuration

### 3.1 Resolution

`src/core/paths.ts` resolves four directories:

```ts
export interface GatewayPaths {
  configFile: string;   // <config>/config.json
  stateDir: string;     // routes.json, daemon.pid
  logFile: string;      // daemon.log
  cacheDir: string;
}
```

Resolution order:

1. `GATEWARDEN_HOME` — everything in one directory. The escape hatch for
   tests, for people who want one folder, and for CI.
2. `GATEWARDEN_CONFIG` — the configuration file only.
3. `GATEWARDEN_STATE_DIR` — the state directory only.
4. `env-paths('gatewarden', { suffix: '' })` — the XDG defaults (D6).

The names the variables had before the rename (`DEV_GATEWAY_HOME`,
`DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`) are still read, below the
current ones. They are deprecated: the CLI and the MCP server say so once,
where the user can see it, and the current name wins when both are set.
The state directory of an installation that names one in its configuration
file is the one of the file. `GATEWARDEN_STATE_DIR` and `XDG_STATE_HOME`
are decisions of the moment and win over the file; `GATEWARDEN_HOME`
decides the state directory only when the configuration names none. The
CLI and the daemon are two processes with two environments, and they have
to agree on the state directory — the log file lives there.

The daemon reads the name of the home installation only when it was given
no configuration file of its own. A daemon that was given one — by the
CLI, by the service unit, or by a user in a shell — runs with it, and the
name in its environment belongs to whoever started it: the name is not
read, and the state directory and the log file are the ones the
configuration and the starter named. The CLI looks up an installation of
its own, and there the name wins.

### 3.2 Configuration

The configuration file keeps today's keys, minus the ones the web interface
needed, plus the ones the package needs:

| Key | Default | Meaning |
| --- | --- | --- |
| `proxy` | `"traefik"` | which proxy adapter to use (D3) |
| `registryPort` | `45002` | port the configuration endpoint binds |
| `relayPort` | `45001` | port the relay binds |
| `advertisedHost` | detected | host name the proxy reaches this machine under |
| `advertisedIp` | detected | fallback for `advertisedHost` |
| `zone` | `""` (to be set) | DNS zone host names are built from |
| `entryPoints` | `["websecure"]` (to be set) | proxy entry points the routers attach to |
| `certResolver` | `""` (to be set) | proxy ACME resolver name; empty means no TLS block |
| `tlsMode` | `"wildcard"` | `wildcard` = one certificate per project, `fqdn` = per route |
| `middlewareProvider` | `""` (to be set) | proxy provider that owns the shared middlewares |
| `securityHeaders` | `false` | apply the shared security-headers middleware |
| `compressMiddleware` | `false` | apply the shared compress middleware |
| `allowedCidrs` | `["127.0.0.1/32", "::1/128"]` (to be set) | sources allowed to talk to the gateway: the relay takes the dispatch header from them, the registry serves the document to them (D15) |
| `registryAllowedCidrs` | `[]` | sources allowed to read the configuration document, on top of `allowedCidrs` (D15) |
| `secret` | `""` | optional shared secret |
| `stateDir` | resolved | runtime state directory |
| `documentFormat` | `"yaml"` | `yaml` or `json` for the configuration document |
| `logMaxBytes` / `logKeep` | `5242880` / `3` | log rotation |
| `autostart` | `true` | kept for compatibility; the install starts no daemon (D7) |

`indexHost` is removed (D8). The defaults are not the user's values: the
user writes them (§9.1), or the setup wizard derives them and writes them
(§9.2).

**To be set** means *not set yet*: the value is empty in the built-in
defaults, and the user writes it in the configuration file (§9.1). The
wizard may ask for it instead (§9.4), but it is not the only way to get it
there (D13).

**The defaults are neutral.** Not one value of one installation is in the
package. The values that name somebody's setup — the zone, the certificate
resolver, the provider of the shared middlewares, the host name the proxy
reaches this machine under — are empty, and the trust list holds the loopback
addresses of every machine. "Empty" means *not set yet*: a route has no host
name without a zone, so `register` refuses one and says that the zone has to
be written in the configuration file.

The user fills them in (§9.1): every one of them is a line in the
configuration file, and the README holds the whole file with a line about
every field. The wizard can fill them in instead (§9.4). It **derives** the
zone, the entry points, the certificate resolver, the middleware provider
and the addresses of the proxy from the proxy itself, and it **asks** for
everything it cannot derive: the zone, the entry points, the certificate
resolver, the middleware provider, the trust list and the host name the proxy
reaches this machine under. A value nobody confirmed is reported as
unconfirmed, and a value that is the built-in default is not written to the
file: the file holds what belongs to this installation.

The values that are **derived at runtime** are not written to the file
either: the address of this machine, the host name that is the address and
the IPv6 prefixes of the machine's own networks. They are derived again on
every run, and a file that pins the address of the moment it was written
keeps advertising an address the machine does not have any more. An empty
value in the file means "derived".

### 3.3 The route store

The routes live in `routes.json` in the state directory (§3.1), and they are
the single source of truth: the CLI writes them, the daemon reads them.

A route keeps the **zone it was registered with**. The certificate of a route
is built from that zone, not from the zone of the configuration the daemon
happens to run with: the certificate has to cover the name the route was
given, and a route that was registered before the zone changed keeps its
name. A route that was written before the store kept the zone has none in
the file; the zone is then the tail of its host name, which is where it was
put.

### 3.4 Migration from the previous layouts

Two installations came before this one, and both are still read:

1. the pre-package layout, which keeps everything in `~/.traefik-dev/`:
   `config.json`, `registrations.json`, `daemon.pid`, `daemon.log`;
2. the layout of the name the directories had before the rename, which keeps
   the configuration in `~/.config/dev-gateway/config.json` and the route
   store in `~/.local/state/dev-gateway/routes.json`. The file names inside
   are the ones of the new layout: only the directory carries the old name.

On first run, if the new configuration file does not exist and an old one
does, the old file is read and the old route file is imported. The layout of
the old name is the newer of the two, and it wins when both hold something.
The old directories are left in place and are never deleted automatically.

`gatewarden migrate` performs the same import explicitly and reports what it
moved. `gatewarden doctor` reports a layout that is still there: it is still
there until the migration has run.

The two layouts are migrated in one order: the layout of the old name first,
because it is the newer of the two, and the pre-package layout after it. The
first run (`loadConfigWithReport`) and the command (`gatewarden migrate`)
use the same order, so they move the same files to the same place.

---

## 4. Architecture

### 4.1 The core

```text
                    ┌──────────────────────────────────────────┐
                    │              gatewarden core             │
                    │                                          │
   CLI ───────────►│  state.ts ◄──── relay.ts ◄──── worker.ts │◄── daemon.ts
   MCP server ────►│     ▲                                  │      (supervisor)
   pi extension ──►│     │                                  │
                    │  registry.ts ──► dynamic configuration │
                    └──────────────────────────────────────────┘
                                   ▲
                                   │ HTTP poll
                            ┌──────┴──────┐
                            │    proxy    │
                            └─────────────┘
```

- **registry** serves the dynamic configuration document. Two endpoints (D9).
  It answers the trust list and nobody else (D15).
- **relay** resolves the dispatch header to `127.0.0.1:<port>` and proxies,
  tunnelling WebSocket upgrades. The relay owns the upgraded sockets: it
  closes them when the listener closes, and a peer that resets the
  connection is an error the relay handles, not a crash of the worker.
- **worker** is one supervised child process per listener, so a crash in one
  does not take the other down.
- **daemon** supervises the workers, writes the pidfile, rotates the log.

### 4.2 The proxy adapter

```ts
export interface ProxyAdapter {
  id: string;
  /** Identify the proxy: find its API, read its version. */
  discover(options: DiscoverOptions): Promise<ProxyInfo | undefined>;
  /** Render the dynamic configuration for the current routes. */
  render(routes: Route[], config: Config): string;
  /** The static configuration the user must add to the proxy. */
  wiringSnippet(config: Config): string;
  /** Does the proxy currently know about this route? */
  verify?(route: Route, config: Config): Promise<boolean>;
}

export interface ProxyInfo {
  id: string;
  version?: string;
  /** Values derived from the proxy's own current configuration. */
  derived: {
    zone?: string;
    entryPoints?: string[];
    certResolver?: string;
    middlewareProvider?: string;
  };
}
```

`discover()` is what makes the setup wizard automatic (§9.4): for Traefik it
reads `/api/version` and `/api/http/routers`, and the router list yields the
zone, the entry points, the certificate resolver and the middleware provider
without the user typing them.

### 4.3 The integration adapters

| Adapter | Surface | Mechanism |
| --- | --- | --- |
| MCP server | every harness that speaks MCP | `bin/gatewarden-mcp.js`, stdio |
| pi extension | pi | `pi.registerTool`, `pi.registerCommand`, `pi.ui` |
| CLI | humans, scripts, any harness that can run a command | `gatewarden` |
| Agent Skill | every harness that reads `SKILL.md` | `skills/gatewarden/SKILL.md` |
| `AGENTS.md` | every harness that reads context files | `docs/AGENTS.md` |

All five are clients of the same core. None of them hosts the daemon (D12).

---

## 5. Daemon lifecycle

### 5.1 Layer one — lazy start

Every entry point calls `ensureDaemon()`. It probes `/healthz`, and if the
daemon is not answering it starts one detached and waits for it. The daemon
outlives the process that started it, because it is spawned detached and
unreferenced.

This is the default and requires no configuration.

### 5.2 The install — `postinstall`

The install script writes the configuration file and starts nothing:

```js
// scripts/postinstall.mjs
if (process.env.npm_config_ignore_scripts === 'true') process.exit(0);
if (process.env.CI) process.exit(0);
if (process.getuid?.() === 0) {
  // A global install run as root: do not write into the home of one user.
  process.exit(0);
}
try {
  ensureDirectories();
  writeDefaultConfigIfMissing();
} catch {
  // Never fail the install.
}
process.exit(0);
```

Properties: exits 0 unconditionally; idempotent (the configuration file is
written once and never overwritten); silent (nothing on stdout, nothing on
stderr); disabled by `GATEWARDEN_AUTOSTART=0`. It starts no daemon, opens no
port and leaves no process behind — the daemon is started by the lazy start
(§5.1) and by `gatewarden start` (§5.3).

npm 12 blocks the install scripts of a dependency until the consumer has
approved them (`npm install-scripts ls`, `npm install-scripts approve
@malarstrom/gatewarden`), so the script runs only for a consumer who says so.
npm 11 warns about the same scripts and lets them run. The gateway does not
need it: the setup wizard writes the same file, and the commands work without
one.

The `autostart` key of the configuration file is kept for compatibility and
has no effect: the install starts nothing either way.

### 5.3 Layer two — `install-service`

`gatewarden install-service` writes and enables:

| Platform | Unit |
| --- | --- |
| Linux | `~/.config/systemd/user/gatewarden.service` |
| macOS | `~/Library/LaunchAgents/com.malarstrom.gatewarden.plist` |
| Windows | a scheduled task running `gatewarden-daemon.js` |

The unit runs the daemon directly, not the CLI. It is the only layer that
survives a reboot, and the setup wizard recommends it.

The daemon of the unit writes to the log file of the installation and to
the journal of the platform. The journal is not a file a reader can open,
so the file the CLI points at shall hold the log whichever way the daemon
was started; the journal keeps what it had.

The log of a run stands in one file. The daemon rotates the log file at
its start, and the standard output of a daemon that the CLI started is
the log file: the rotation leaves the standard output on the copy. The
daemon writes to the log file alone then, and the copy holds the lines of
the run before it.

The unit of the name the package had before the rename (`dev-gateway.service`,
the old launchd label, the old scheduled task) is looked for as well. It is
still on the machine of an installation that was made before the rename, and
it names a launcher that does not exist any more, so the daemon it would
start is never started. `gatewarden doctor` reports it as `old service`, and
`gatewarden install-service` writes the unit of the current name.

### 5.4 The uninstall

An installation that is removed takes its daemon with it. The daemon is
spawned detached and outlives the command that started it, so a daemon that
is left behind keeps listening on two ports for a package that is not there
any more.

npm 7 and later do not run the uninstall scripts of a package — npm's own
documentation says so — so the daemon watches its own installation: the
directory that holds the `package.json` of the package it runs from. When that
directory is gone, the daemon stops itself: the workers are stopped, the pid
file is removed, and the process exits.

The files of the installation go with it: the configuration file, the route
store, the log and the cache. The daemon is the only one that can remove
them under npm, so it is the one that removes them. Two cases are left alone:

- a checkout is not an installation (a clone that is deleted must not take
  the files of the user with it);
- a tree that is being rebuilt: `npm ci` removes the whole `node_modules`
  and fills it again, and the installation comes back with it.

The package ships the scripts for the package managers that do run the
uninstall scripts:

| Script | What it does |
| --- | --- |
| `scripts/preuninstall.mjs` | stops the daemon of the installation (`SIGTERM`, then `SIGKILL` after ten seconds); a process that is not the daemon of *this* installation is never stopped — the command line of the process has to name the installation, because two installations that share a state directory share their pid file |
| `scripts/postuninstall.mjs` | removes the configuration file, the files of the gateway in the state directory (the route store, the pid file, the log) and the cache |

Both resolve the directories the way the rest of the package does (§3.1):
`GATEWARDEN_HOME` puts everything in one directory, `GATEWARDEN_CONFIG` and
`GATEWARDEN_STATE_DIR` name one each, and the names the variables had before
the rename still work. Neither script ever fails the uninstall.

Under npm 7 and later the scripts are not run at all: the daemon does the
same work when it sees that its installation is gone. The result is the same
under every package manager — no process, no configuration file, no route
store, no cache.

---

## 6. The MCP server — the primary agent surface

### 6.1 Transport and configuration

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

The `mcpServers` format is the one pi documents as matching other MCP
clients, so the same entry works in Claude Code, Cursor, VS Code, Windsurf,
Zed, Continue, Goose and OpenCode.

The server never starts the daemon at startup; it starts it on the first tool
call (§5.1). Running `npx @malarstrom/gatewarden` is therefore safe.

### 6.2 Tool contracts

| Tool | Input | Output |
| --- | --- | --- |
| `publish_dev_server` | `{ port: number, project?: string, branch?: string, label?: string }` | `{ url, fqdn, project, branch, port, state }` |
| `remove_dev_server` | `{ project: string, branch: string }` | `{ removed: boolean, fqdn?: string }` |
| `list_dev_servers` | `{}` | `{ routes: [{ project, branch, port, fqdn, url, state }] }` |
| `dev_gateway_status` | `{}` | `{ daemon, proxy, config, reachable }` |

`state` is `up` or `down`, from a reachability probe of the local port.
`publish_dev_server` updates an existing route in place, because an agent
that restarts a development server on another port expects the same address
to follow it.

### 6.3 Project and branch inference

`project` and `branch` are optional. When they are absent:

- **project** is the basename of the server's working directory, slugified.
- **branch** is `git rev-parse --abbrev-ref HEAD` in that directory, slugified,
  falling back to `main` when the directory is not a repository.

The agent does not have to reason about names. It may still pass them
explicitly when it wants to.

---

## 7. The pi extension

The pi extension is one adapter over the core. It gives pi users things MCP
alone does not: a native tool contract with `outputSchema`, a route table
rendered in the terminal, and a status line.

| Capability | Detail |
| --- | --- |
| `publish_dev_server` | native tool, `outputSchema` declared, `structuredContent` returned |
| `remove_dev_server` | native tool |
| `list_dev_servers` | native tool |
| `/routes` | command; renders the route table with local and public state |
| status line | `ctx.ui.setStatus("gatewarden", "3 routes live")` |
| `session_start` | ensures the daemon is running (§5.1) |

The extension is published compiled (`dist/integrations/pi/extension.js`), so
pi loads it without a TypeScript loader.

---

## 8. The skill and the agent instructions

### 8.1 The Agent Skill

`skills/gatewarden/SKILL.md` follows the Agent Skills specification. It is
read by pi, Claude Code, Codex and OpenCode.

```markdown
---
name: gatewarden
description: Publish a development server running on this machine so the user
  can open it in a browser on their network. Use when a dev server is started
  (Vite, Next, Nuxt, python -m http.server, any local port) and the user needs
  a URL to open it.
---
```

The body names the MCP tool first and the CLI as the fallback, so it is
useful in a harness without MCP support.

### 8.2 `docs/AGENTS.md`

A short, portable block:

> When you start a development server, publish it: call the
> `publish_dev_server` tool, or run `gatewarden register --port <port>`.
> Give the user the returned URL verbatim. Do not compose the host name
> yourself.

---

## 9. The installation and the setup wizard

### 9.1 The installation, by hand

This is the primary way to install the gateway (D13). Four steps, in this
order, and every one of them is a thing the user does.

1. **Install the package.** `npm install -g @malarstrom/gatewarden`,
   on the machine that runs the development servers. Node 20.11 or later.
2. **Wire the proxy.** On the machine the proxy runs on, add the `http`
   provider to the `providers:` block of the static configuration:

   ```yaml
   providers:
     http:
       endpoint: "http://<host>:45002/traefik"
       pollInterval: 2s
   ```

   `<host>` is the name the proxy reaches this machine under — the
   `advertisedHost` of the configuration file. Then restart the proxy: the
   static configuration is only read at start-up. The gateway cannot make
   this change: the proxy's configuration lives on another machine.
3. **Write the configuration file.** `~/.config/gatewarden/config.json` on
   Linux (`~/Library/Preferences/gatewarden/config.json` on macOS,
   `%APPDATA%\gatewarden\Config\config.json` on Windows). The file holds
   the values of §3.2; the README holds the whole file with a line about
   every field. The one that is required is the `zone`: without it a route
   has no host name, and `register` refuses one. The `advertisedHost` (the
   name the wiring points at) and the `certResolver` (the name of the
   resolver of the proxy) are the values of the proxy — without them the
   gateway still works, but the address is not the one the user can open.
   The rest have working defaults.
4. **Start the daemon.** `gatewarden start`. The daemon also starts by
   itself the first time a route is registered, so this step is not
   strictly necessary — it is there so that the user learns at once that the
   daemon works.

The installation is then **verified**: `gatewarden doctor` checks the
configuration file, the state directory, the daemon, the zone, the shared
middlewares, the two ports, the routes, the proxy, the trust list, the
address of the proxy, the service unit and the old layout, and names every
check it made with the reason for it (§9.9, D14); `curl
http://<host>:45002/healthz` answers `ok`; a registered route opens in a
browser.

The doctor never fails because of the machine it runs on: a missing
daemon, a missing zone, a proxy that does not answer and a service that
is not installed are warnings. Only a broken thing is a failure.

The three documents that carry this are the README (the section
"What you need"), `docs/setup.md` (the same, with the commands and their
flags, and what every check of `gatewarden doctor` means) and
`docs/traefik.md` (what the proxy side must have: the `http` provider, the
file provider of the shared middlewares, the routers the gateway adds and
the reachability).

### 9.2 The setup wizard — the optional extra step

`gatewarden setup`. Six steps, five of them automatic. The wizard writes
the same values as §9.1 writes by hand, and derives them from the proxy
where it can. It is optional: it is the extra step, not a requirement for a
working installation (D13).

### 9.3 Step one — read the environment

Container or not, platform, reachable addresses, the working directory, the
state directory, whether a daemon is already running.

### 9.4 Step two — discover the proxy

`ProxyAdapter.discover()` (§4.2). For Traefik: `GET /api/version` and
`GET /api/http/routers`. From the router list the wizard derives the zone
(the common host-name suffix), the entry points, the certificate resolver
and the middleware provider.

When no proxy API answers, the wizard asks the user for these values. Nothing
is hard-coded.

Two more values are the machine's own, and the proxy's API does not say them:
the host name the proxy reaches this machine under, and the trust list of the
gateway. The wizard asks for the host name, because the wiring is written
with it. For the trust list it derives what it can: the proxy is the one
that polls the document and sends the dispatch header, and the addresses of
the host the API answered on are therefore the sources both listeners have to
accept (D15). The rest is asked for.

An answer to the trust list **adds** to the list that was offered. The
wizard never removes an address from it: a list of one's own that took the
loopback away would leave the relay refusing the proxy's dispatch, and every
route would break with a 403 that looks like a certificate problem. A refusal
of the relay is reported as what it is: the address of the proxy is not in the
trust list, or the secret is wrong.

The wizard asks for every value it could not derive, whether the
configuration file already holds one or not: the value in the file is the
default in the question, not an answer. When there is nobody to ask — a
non-interactive run, a machine without a terminal — the value is kept and
the wizard reports it as unconfirmed, together with where every value came
from: the proxy, the user, the configuration file or the built-in default.

### 9.5 Step three — is it already wired?

Whether the proxy already has a provider pointing at this machine. For
Traefik: is there a router whose provider is the HTTP provider and whose
service points at this host and port.

The machine is known by more than one name: the advertised host name and
the advertised IP. The proxy may reach it by either of them, and a name
that resolves to an address is the same machine as that address.

If it is already wired, the wizard skips to step five and verifies.

### 9.6 Step four — emit the wiring

The wizard prints the exact static configuration to add, with the values
filled in for this machine, and writes it to
`<state>/wiring/<proxy>.yml` so it can be copied.

The wizard cannot apply it itself. The proxy's configuration lives on another
machine, and the gateway process runs without the privileges to write it.
The wizard says so plainly rather than pretending.

### 9.7 Step five — verify end to end

1. Start a throwaway server on a free port.
2. Register it.
3. Wait for one poll interval.
4. Fetch the public URL and require a successful response.
5. Remove the route and stop the throwaway server.

The wizard reports each step as it goes, and reports what it could not
verify.

The verification tells two things apart (D14):

* **It could not run.** There is no proxy to fetch the public URL from,
  there is no zone to build it from, the name does not resolve, nothing
  listens on the port, or the proxy does not serve the route yet. The
  status is `skipped`, the reason says which, and the exit code of
  `gatewarden setup` is 0.
* **It ran, and the chain answered with an error.** The relay refused
  the request (the trust list), the registry refused the document (the
  trust list), the proxy refused it (its own middleware), the
  certificate of the public URL is not trusted, or the proxy knows the
  route and does not serve it. The status is `failed`, the reason says
  which, and the exit code is 1.

The wizard writes the next steps in clear text, in every mode.

The verification needs a gateway that serves the dynamic document: the
proxy polls the document, and the document has to carry the throwaway
route. The configuration is therefore written and the daemon started
*before* the verification — a verification that runs against a gateway
that is not up yet verifies nothing. Step six reports what the
verification needed.

### 9.8 Step six — write the configuration and start

The derived values are written to the configuration file, the daemon is
started, and the wizard recommends `gatewarden install-service` for
surviving a reboot.

Both happen before the verification of §9.7, because the verification
needs them; the step reports them, it does not introduce them.

### 9.9 The healthcheck — `gatewarden doctor`

`gatewarden doctor` is the healthcheck of the package (D14). It reads
the installation and reports every check it made, with the reason for it.
It changes nothing: it does not migrate the old layout and it does not
start a daemon.

Every check has a name, a status and a reason:

| Status | What it means |
| --- | --- |
| `ok` | the thing is there and it works |
| `warn` | the thing is not there, or it is not complete — the reason says what to do about it |
| `fail` | the thing is there and it is broken |
| `skipped` | there is nothing to check here: the installation is not on this machine |

The checks are the configuration file, the state directory, the daemon,
the DNS zone, the shared middlewares, the two ports the gateway serves on
(the registry and the relay), the routes, the routes and the zone
together, the proxy, the trust list, the trust list of the registry, the
address of the proxy, the service unit, and the old layout.

Three of them are worth naming:

* **The daemon is lazy.** The daemon starts by itself with the first route
  (D7), so a daemon that does not run is the normal state of an
  installation that is not set up: a warning, not an error. A daemon that
  runs and does not answer `/healthz` is broken, and so is a gateway that
  answers on the port when it is not this installation's daemon.
* **The zone says whether the installation is set up.** A configuration
  file that declares a zone and leaves it empty is a file that is wrong:
  the host names of the routes cannot be built from it, and that is a
  failure. A configuration file that says nothing about the zone belongs
  to an installation that is not set up here: the zone is one of the
  things to do, with the reason and the way to get one, and the doctor
  exits 0.
* **The trust list and the address of the proxy.** The trust list
  (`allowedCidrs`) holds the addresses that may talk to the gateway, and
  the doctor prints the list it uses. The address of the proxy has to be
  in it: the proxy polls the document and sends the dispatch header, and
  an address that is not in the list is answered with a 403 (D15). The
  doctor resolves the host of the proxy's API and compares the addresses
  it finds with the list. An installation that refuses its own proxy is
  not broken: it is a warning with the way out, never a failure.

The address of the proxy's API is read from the environment variable
`GATEWARDEN_PROXY_API_URL`; the wizard is told the same address with its
`--api-base-url` flag. Without the variable the doctor uses the default
of the adapter (`http://127.0.0.1:8080` for Traefik), and that default is
the address of a proxy on this machine. The doctor resolves the host of
that address and compares the addresses it finds with the trust list — the
proxy itself is not asked. It needs the address most when the proxy runs
on another machine.

The exit code is 0 unless a check failed. `--strict` makes the warnings
errors as well — for the one who wants the whole installation to be
complete, not only unbroken. `--json` writes the same report as one JSON
object, with a top-level `ok` that is `false` when a check failed.

`gatewarden status` is a report and not a check: it runs everywhere, on
a machine with an installation and on one without, and its exit code is 0
in both cases. A script that wants to know whether the gateway serves
reads `daemon.healthy` of the JSON form.

---

## 10. The web interface is removed

### 10.1 What goes

| Removed | Where |
| --- | --- |
| the index page renderer | `src/index-page.ts` |
| the page's assets, including the fonts | `src/assets/` |
| the Tailwind toolchain | `package.json`, `npm run build:css`, `test/build-css.test.ts` |
| the index host name | `config.indexHost` |
| the index router in the generated document | `src/document.ts` |
| the page's HTTP endpoints | `src/registry.ts` |
| the create and delete endpoints | `src/registry.ts` |

### 10.2 What replaces it

| The page showed | Now |
| --- | --- |
| the route list with up/down state | `gatewarden list`, `list_dev_servers`, `/routes` |
| the host name to open | the `url` field of `publish_dev_server` |
| the remove button | `gatewarden unregister`, `remove_dev_server` |
| the create form | `gatewarden register`, `publish_dev_server` |

### 10.3 Consequences for the confirmed constraints in `PRODUCT.md`

`PRODUCT.md` lists confirmed constraints that this work changes. They are
superseded here, deliberately and explicitly:

| `PRODUCT.md` constraint | New status |
| --- | --- |
| "Zero runtime dependencies" | **narrowed**: `env-paths` and `proper-lockfile` become runtime dependencies; the MCP SDK does not (D5) |
| "The Traefik dynamic configuration document served at `/traefik` must not change" | **changed**: the index router is removed (§10.1). Every other object keeps its name and shape |
| "The Remove flow, the `X-Gateway-UI: 1` guard, the `data-registration-id` attribute … stay as they are" | **changed**: the guard and the attribute belonged to the page and go with it |
| "Creating a route by hand goes through `POST /api/registrations` … a project and branch that already has a route is a conflict (409), never a silent update" | **changed**: the endpoint is gone; the agent-facing path updates in place (§6.2), while the CLI keeps its own semantics |
| "No secret is configured for the registry … Do not raise this again." | **kept**: the secret stays off by default. The registry has no write endpoint, so the guard has nothing to guard — and the trust list guards the document instead (D15) |
| "The index page must keep: …" | **removed**: the page is gone (D8) |
| "The tests stay green, and other projects' live routes must keep working" | **kept** |

`PRODUCT.md` must be updated to match, in the same slice that removes the
web interface (S3).

---

## 11. The test environment

### 11.1 Isolation requirements

The user's live gateway runs on ports 45001 and 45002 and serves
`example.com`. The user's live Traefik terminates TLS for a wildcard
certificate. **No test may touch either.**

| | live | test |
| --- | --- | --- |
| registry port | 45002 | 46002 |
| relay port | 45001 | 46001 |
| domain | `example.com` | `gwtest.local` |
| state directory | `~/.local/state/gatewarden/` | `/tmp/gatewarden-test/` |
| proxy | the user's Traefik | a Traefik started by the test |
| certificates | the user's ACME certificates | a generated self-signed CA |

The isolation is enforced by `GATEWARDEN_HOME` and by the test's own proxy
configuration, not by convention.

### 11.2 The test proxy

The container has no Docker and no Docker socket, so the test proxy cannot be
a container. GitHub releases are reachable, so the test downloads the Traefik
binary — the same version as the user's (3.7.16) — into `tools/testenv/`
and runs it with a generated static configuration:

```yaml
entryPoints:
  testweb:
    address: ":8443"
providers:
  http:
    endpoint: "http://127.0.0.1:46002/traefik"
    pollInterval: 2s
certificatesResolvers:
  testca:
    acme:
      tlsChallenge: true
      storage: /tmp/gatewarden-test/acme.json
```

The test domain resolves to `127.0.0.1` via `/etc/hosts` when the test runs
as root, and otherwise through a Traefik entry point addressed by
`127.0.0.1` with the host name sent as `Host`.

### 11.3 The test layers

| Layer | Scope | Needs the network |
| --- | --- | --- |
| L1 unit | slug rules, path resolution, configuration merging, document rendering | no |
| L2 integration | registry and relay over HTTP, in process | no |
| L3 packaging | `npm pack`, install into a temporary directory, run the binary | no |
| L4 conformance | the official MCP SDK client against our hand-written MCP server | no |
| L5 end to end | the real Traefik, the real registry, the real relay, a throwaway server, the public URL | loopback only |

L5 is the one that proves the product works. L1 to L4 are fast and run on
every change.

### 11.4 The MCP conformance test

`test/mcp-conformance.test.ts` starts our MCP server as a child process and
drives it with the official SDK's client: initialize, list tools, call a
tool, read the result. The SDK is a dev dependency, so this proves
conformance without shipping it.

---

## 12. The slices

Each slice leaves the repository green and can be reviewed on its own. Every
slice names the sections it must satisfy.

### S0 — The build step

Adds `tsconfig.build.json`, the `dist/` output, the `build` and
`prepublishOnly` scripts, and moves the `bin/` launchers onto `dist/`.

*Satisfies*: D2.
*Acceptance*: `npm run build && npm test` is green; `npm pack` produces a
tarball whose `bin/gatewarden.js` runs and prints its version; the existing
103 tests still pass unchanged.

### S1 — Paths and configuration

`src/core/paths.ts`, the new configuration file layout, the environment
overrides, and the migration from `~/.traefik-dev/`.

*Satisfies*: D6, §3.
*Acceptance*: path resolution is unit-tested for Linux, macOS and Windows;
`GATEWARDEN_HOME` puts everything in one directory; an existing
`~/.traefik-dev/config.json` is picked up; `gatewarden migrate` reports what
it moved.

### S2 — The core split and the Traefik adapter

Moves the core into `src/core/`, moves the Traefik document rendering into
`src/adapters/traefik.ts`, and introduces the `ProxyAdapter` interface.

*Satisfies*: D3, §4.
*Acceptance*: the rendered document is byte-identical to today's for the
same routes (golden test); the existing tests are ported, not rewritten; the
core has no import of any adapter.

### S3 — The web interface goes

Deletes the index page, its assets and the Tailwind toolchain; removes the
index host name, the index router and the write endpoints; updates
`PRODUCT.md` with the supersessions from §10.3.

*Satisfies*: D8, D9, §10.
*Acceptance*: the registry answers only the configuration path and
`/healthz`; the rendered document is identical to today's minus the index
router; `PRODUCT.md` no longer claims the index page exists; the Tailwind
dependencies are gone from `package.json`.

### S4 — The CLI

The new binary names, the new commands (`setup`, `start`, `stop`, `doctor`,
`install-service`, `migrate`) and the JSON output.

*Satisfies*: §5, §9.2.
*Acceptance*: `gatewarden list --json` is machine-readable; every command
has a test; the old command names still work as aliases.

### S5 — The MCP server

`src/integrations/mcp/server.ts` and `bin/gatewarden-mcp.js`, speaking
stdio JSON-RPC directly, plus the conformance test.

*Satisfies*: D4, D5, §6.
*Acceptance*: the conformance test passes against the official SDK client;
the four tools are listed and callable; the server starts no daemon until a
tool is called; the runtime dependency list is still free of the MCP SDK.

### S6 — The pi extension

`src/integrations/pi/extension.ts`, the native tools, the `/routes` command
and the status line.

*Satisfies*: §7.
*Acceptance*: `pi -e ./dist/integrations/pi/extension.js` loads the
extension; the three tools appear; `/routes` renders the table; the status
line shows the live route count.

### S7 — The skill, the agent instructions and the documentation

`skills/gatewarden/SKILL.md`, `docs/AGENTS.md`, the package `README.md` and
the proxy wiring guide.

*Satisfies*: §8.
*Acceptance*: the skill front matter validates against the Agent Skills
specification; the README's quick start works from a clean install.

### S8 — The setup wizard

`src/cli/setup.ts`: the six steps of §9.3–§9.8.

*Satisfies*: §9.2.
*Acceptance*: against the test proxy the wizard detects the zone, the entry
points and the resolver without being told them; it emits a wiring snippet
that the test proxy accepts; the end-to-end verification passes.

### S9 — The test environment

`tools/testenv/`: the Traefik download, the generated configuration, the
certs, the start and teardown, and the end-to-end test.

*Satisfies*: D11, §11.
*Acceptance*: one command brings up the whole isolated environment, runs the
end-to-end test and tears it down; the user's live gateway and proxy are
untouched, proven by asserting that their ports are not bound by the test.

### S10 — Packaging and release

The published `package.json`, the `pi` manifest, the licence, the
`npm pack` verification and the publish dry run.

*Satisfies*: §2.
*Acceptance*: `npm pack` contents are exactly the allow-list; installing the
tarball into a temporary directory gives a working `gatewarden` binary, a
working MCP server and a pi extension pi can load.

### S16 — The installation, written out for the user

`README.md`, `docs/setup.md` and `docs/traefik.md`: the prerequisites, the
steps in the order the user does them, a configuration file with every field
explained, a verification checklist and a symptom → cause → fix table.

*Satisfies*: D13, §9.1.
*Acceptance*: the README holds a "what you need" section before the quick
start, and it names the prerequisites (must and can), the steps in order, a
complete configuration file with a line about every field, a verification
checklist (the command, and what the answer is) and a troubleshooting table
(symptom, cause, fix); the setup guide holds the same in detail, with the
commands, their flags, and what every check of `gatewarden doctor` means;
the Traefik guide holds the wiring snippet and what the proxy side must have
(the `http` provider, the file provider of the shared middlewares, the
routers the gateway adds); the quick start is short — install, wire,
publish; and the specification describes the hand-written installation as
the primary way (D13, §9.1) with the wizard as the optional extra step
(§9.2).

### S17 — The healthcheck reports and does not fail on the environment

`src/cli/healthcheck.ts`: the doctor as the healthcheck of the package.
The statuses `ok`, `warn`, `fail` and `skipped`, a reason for every check,
the exit code 0 unless a check failed, `--strict`, the JSON form with a
top-level `ok`; `src/cli/setup.ts`: the verification tells "could not run"
from "answered with an error"; `src/cli/index.ts`: `status` runs
everywhere.

*Satisfies*: D14, §9.7, §9.9.
*Acceptance*: the doctor exits 0 in an empty environment — no
configuration file, no daemon, no zone, no proxy — and every check it
reports carries a reason; the JSON form holds one post per check and a
top-level `ok`; `--strict` exits 1 when a check really fails; a
configuration file that cannot be read is a failure and not a crash; a
configuration file that declares no zone is an installation that is not
set up, and everything about it is a warning; a configuration file that
declares a zone and leaves it empty is a file that is wrong, and that is
a failure; the verification of the setup is `skipped` when the public URL
cannot be fetched and `failed` only when the chain answered with an
error — and the reason then is the answer that came.

---

## 13. Release

The release is `0.1.1` on the `malarstrom` npm organisation, published
from `feat/npm-package` after the slices are merged. The version `0.1.0`
was published on 2026-11-01 and withdrawn the same day, so it can never be
used again, and the release after it is `0.1.1`.

The live system is not touched by this work. The running gateway is a
separate copy under `/opt/`, and the user's proxy already has the HTTP
provider wired. Migrating the live system to the package is a separate,
deliberate step: install the package, run `gatewarden setup`, verify, and
only then remove the old copy.

---

## 14. Risks and open questions

| # | Question | Status |
| --- | --- | --- |
| R1 | Is the hand-written MCP transport worth it, or should the SDK be a runtime dependency? | Open. S5 decides by measurement, and the fallback is one line in `package.json` |
| R2 | Does `rewriteRelativeImportExtensions` emit correct relative specifiers for every import shape in the tree? | Open. S0 proves it with a pack-and-run check |
| R3 | What is the second proxy adapter, and does the `ProxyAdapter` interface actually generalise? | Open. Caddy is the candidate; the interface is not proven until a second implementation exists |
| R4 | Should `gatewarden` be able to publish to a tunnel (Cloudflare, Tailscale) instead of a proxy? | Open. Out of scope for now (§15) |
| R5 | The npm organisation `malarstrom` must exist before the first publish | Open. Confirm the npm account and the 2FA setup |

---

## 15. Out of scope

- The web interface (D8).
- Proxy implementations other than Traefik. The interface exists; the second
  implementation does not.
- Terminating TLS. The proxy does.
- Running development servers.
- Tunnel providers (Cloudflare Tunnel, Tailscale Funnel, ngrok).
- Windows as a first-class platform. The paths and the service installer are
  written for it, but the testing happens on Linux.
- A hosted dashboard of the routes. The route list is a CLI, an MCP tool and
  a terminal view.
