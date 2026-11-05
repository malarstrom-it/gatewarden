# Setting the gateway up

There are two ways to a working installation:

1. **By hand.** Four steps: install the package, wire the proxy, write the
   configuration file, start the daemon. This is the way that works
   everywhere, and it is the way this guide describes first.
2. **With the wizard.** `gatewarden setup` reads your proxy, derives the
   values it can derive, asks for the ones it cannot, writes the
   configuration file and starts the daemon.

**The wizard is optional.** It is a shortcut, not a requirement. Every value
it writes can be written by hand, and the manual path is the one that works
on a machine where the proxy does not answer on its API, where the wizard
cannot ask a question, or where you simply want to see what the file holds.
Nothing in this guide needs the wizard to have succeeded.

The short version is in the README: [What you need](../README.md#what-you-need).

---

## 1. What you need

**Must**

| What | Why |
| --- | --- |
| Node 20.11 or later on the machine that runs the dev servers | the package is plain JavaScript; nothing is built at install time |
| a Traefik proxy (v2 or v3) on another machine | the proxy terminates TLS and forwards the request |
| a DNS zone the proxy already serves (`example.com`) | the host name of a route is `<branch>.<project>.<zone>` |
| TLS for that zone: a certificate resolver in the proxy | the address the user opens is `https://` |
| a machine the proxy can reach, and an address the proxy knows it by | the proxy polls the configuration document on `45002` and sends the requests to the relay on `45001` |

**Can**

| What | What it gives |
| --- | --- |
| `gatewarden setup` | writes the configuration file for you |
| a shared secret (`"secret"`) | the proxy has to present it to the registry and to the relay |
| the shared middlewares of your proxy | the dev routers get them too, when you name the provider that owns them |
| `gatewarden install-service` | the daemon starts again after a reboot; `--no-enable` writes the unit of the platform without enabling it, so on Linux the daemon does not start at a reboot, and on macOS the agent is written to `~/Library/LaunchAgents`, which launchd loads at every login, so the daemon starts at the next login |
| `gatewarden stop` | stops the daemon; the service does not start it again, on macOS and on Linux |

---

## 2. Step one — install the package

On the machine that runs the dev servers, globally:

```bash
npm install -g @malarstrom/gatewarden
```

Or in the project the dev servers belong to:

```bash
npm install @malarstrom/gatewarden
```

The project install is the right one when a team wants the commands in the
PATH of its own project rather than on the PATH of every machine, and when
the installation should follow a project and go when the project goes.
The global install is the right one when the commands should be there for
every project on the machine.

A project install puts the commands in the `node_modules/.bin` of the
project. The commands of the steps below are written as they are run on the
PATH of the machine; in a project install `npx` goes in front of them, or
they run through a script in the `package.json` of the project.

Check that it arrived:

```bash
gatewarden --version
```

and, in a project install:

```bash
npx gatewarden --version
```

It prints the version of the package. The install starts nothing: it writes
the configuration file (if there is none) and leaves the machine the way it
found it — no daemon, no open port, no process in the background. The daemon
starts by itself the first time a command needs it (step four).

`GATEWARDEN_AUTOSTART=0` turns the whole install script off: no configuration
file is written, none of the directories the gateway uses is created and no
daemon is started. An installation made with the variable set has no
configuration file of its own; the wizard writes one, or you write it yourself
in step three.

npm 12 blocks the install scripts of a dependency until the dependency is
approved, and it names the package in a warning while it does. npm 11 warns
and lets the scripts run. The commands that review the scripts arrived in
npm 11.18: npm 11.16 and npm 11.17 do not have them. From npm 11.18 on
they are the same in npm 11 and in npm 12:

```bash
npm install-scripts ls
npm install-scripts approve @malarstrom/gatewarden
```

These two commands work on a project: they read and write the `allowScripts`
field in the `package.json` of the project. They approve the project install
above. A global install has no `package.json` of its own, so these two
commands cannot approve it — with `-g` they stop with `EGLOBAL`. A global
install is approved in one of two other ways:

```bash
npm install -g --allow-scripts=@malarstrom/gatewarden
npm config set allow-scripts='@malarstrom/gatewarden' --location=user
```

The first one approves the scripts for that one install, the second one for
every global install from now on.

Nothing breaks if you do not approve the scripts: the wizard writes the same
configuration file, and the commands work without one.

The block above shows two of the three commands of the set: `ls` and
`approve`. The third one, `deny`, is in
[`docs/install-scripts.md`](install-scripts.md), together with what the scripts
do and what npm 11.16 and npm 11.17 call the same commands.

The same package is a pi package, and pi installs it like any other:

```bash
pi install npm:@malarstrom/gatewarden
```

---

## 3. Step two — wire the proxy

This step happens **on the machine the proxy runs on**, once.

Add the `http` provider to the `providers:` block of the static configuration
of Traefik:

```yaml
providers:
  http:
    endpoint: "http://<the address the proxy reaches the machine on>:45002/traefik"
    pollInterval: 2s
```

* `<the address the proxy reaches the machine on>` is the host name or the IP
  that the proxy resolves to the machine the dev servers run on. It has to be
  the same value as `advertisedHost` in the configuration file (step three).
* `45002` is `registryPort` — the port the configuration document is served
  on. The path `/traefik` is the path the adapter serves the document under.
* `pollInterval: 2s` is how often the proxy asks for the document. A route
  that was registered is therefore live on the proxy up to two seconds later.

Then **restart the proxy**: Traefik v2 and v3 both read that block from the
static configuration, and both use the new provider after the restart.

```bash
docker restart <the traefik container>
```

The gateway process cannot make this change for you: the proxy's
configuration lives on another machine, and the gateway runs without the
privileges to write it. `gatewarden setup` prints the same snippet with your
values filled in and writes it to `<state>/wiring/traefik.yml`, so that you
can copy it. `gatewarden status` prints the state directory it uses.

**Reachability.** From the proxy's machine, the two ports of the gateway have
to be reachable:

| Port | What goes through it |
| --- | --- |
| `45002` | the proxy polls the configuration document on it |
| `45001` | the requests of the user go to the relay on it |

Both listeners bind on every interface of the machine. Both of them answer
the addresses in the trust list (`allowedCidrs`) and nobody else: the relay
takes the dispatch header (`X-Dev-Target`) only from them, and the registry
serves the configuration document only to them. The address of the proxy has
to be in that list (step three) — it polls the document and sends the
requests.

Check that the proxy reaches the gateway — from the proxy's machine:

```bash
curl -sS http://<the address the proxy reaches the machine on>:45002/healthz
```

It answers `ok`. The registry answers two paths and nothing else: the
configuration document (`/traefik`) and the health probe (`/healthz`). The
document is answered to the addresses in the trust list and to nobody else:
a request from an address that is not in `allowedCidrs` gets a `403` that
says so — *"the source address 192.0.2.7 is not in the trust list
(allowedCidrs)"*. The probe is the liveness of the daemon, and the daemon
asks it from the machine itself: it is answered to the trust list and to
the loopback, and it asks for no secret.

More about the proxy side: [`docs/traefik.md`](traefik.md).

---

## 4. Step three — write the configuration file

The file is:

| Platform | Path |
| --- | --- |
| Linux | `~/.config/gatewarden/config.json` |
| macOS | `~/Library/Preferences/gatewarden/config.json` |
| Windows | `%APPDATA%\gatewarden\Config\config.json` |

Three environment variables move it: `GATEWARDEN_HOME` (everything in one
directory), `GATEWARDEN_CONFIG` (the configuration file only) and
`GATEWARDEN_STATE_DIR` (the state directory only).
`GATEWARDEN_HOME` decides the state directory when the configuration file
names none. A file that names one is the decision of the installation: the
CLI and the daemon are two processes with two environments, and they have
to agree on the state directory.

The names these variables had before the rename (`DEV_GATEWAY_HOME`,
`DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`) still work. They are
deprecated: the CLI reads them, and it says once that they are on their way
out. The current name wins when both are set.

The daemon and the workers it starts do not carry `GATEWARDEN_HOME` with
them: they run with the configuration file and the state directory they were
given, so the installation that applies is the one those name.

The commands below use the file the installation actually has:

```bash
gatewarden config          # the path, and every key with its value and a line about it
gatewarden config --write  # writes the file with the values of this moment
```

`--write` is a starting point, not the answer: it writes the built-in
defaults, and the defaults are neutral (no zone, no resolver, no provider).
What you write on top of it is step four's example.

### The example

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

### Every field

| Field | Default | What it means | Where the value comes from |
| --- | --- | --- | --- |
| `proxy` | `"traefik"` | which proxy adapter writes the configuration document | the core is proxy-agnostic and this key names the adapter; the package ships with the Traefik adapter |
| `registryPort` | `45002` | the port the configuration document is served on; the proxy polls it | free on the machine; it has to be open to the proxy |
| `relayPort` | `45001` | the port the requests of the user arrive on | free on the machine; it has to be open to the proxy |
| `advertisedIp` | detected | the IP the proxy reaches this machine on | empty = detected from the network interfaces on every run |
| `advertisedHost` | detected | the host name the proxy reaches this machine on | the name the proxy can resolve — **must** agree with the `endpoint` of the provider in step two |
| `zone` | `""` | the DNS zone the host names are built from: `<branch>.<project>.<zone>` | **must** — the zone your proxy already serves; without it there is no host name and `gatewarden register` refuses |
| `entryPoints` | `["websecure"]` | the entry points of the proxy the dev routers attach to | the entry points your own routers use |
| `certResolver` | `""` | the name of the certificate resolver of your proxy | the name in the `tls` blocks of your own routers; empty = no TLS block, and the address is plain HTTP |
| `tlsMode` | `"wildcard"` | `wildcard` = one certificate per project (`*.<project>.<zone>`), `fqdn` = one per address | `wildcard` covers every branch of a project with one certificate |
| `securityHeaders` | `false` | also apply the shared `default-security-headers` middleware | `false` — the frame-deny of that middleware can break a preview |
| `compressMiddleware` | `false` | also apply the shared `compress` middleware | `false` |
| `middlewareProvider` | `""` | the provider that owns the shared middlewares | the name of your file provider (`file`), when you want the two middlewares above; empty = they are not used |
| `allowedCidrs` | `["127.0.0.1/32", "::1/128"]` | the addresses allowed to talk to the gateway: the relay takes the dispatch header from them, the registry serves the configuration document to them | the address of your proxy, and the loopback; both listeners answer `403` to everything else |
| `registryAllowedCidrs` | `[]` | the addresses allowed to read the configuration document, on top of `allowedCidrs` | empty = the same addresses as the relay; add the address of a machine that may only read the document |
| `secret` | `""` | a shared secret between the gateway and the proxy | your own; when it is set, the provider has to send it as a header |
| `stateDir` | the XDG state directory | the directory with the routes and the pid file | empty = the state directory of the platform |
| `documentFormat` | `"yaml"` | `yaml` or `json` for the configuration document | `yaml` |
| `logMaxBytes` | `5242880` | the log is rotated above this size | 5 MB |
| `logKeep` | `3` | how many rotated log files to keep | 3 |
| `autostart` | `true` | kept for compatibility: the install starts no daemon any more, and the daemon starts itself when a command needs it | `true` |

**A second adapter is a change in the package, not a setting in this file.**
The package ships with the Traefik adapter and loads no adapter at run time.
How an adapter for another proxy is written: [The proxy
adapter](../README.md#the-proxy-adapter).

**An empty value means "derived", not "forgotten".** The address of the
machine, the host name that is the address and the IPv6 prefixes of the
machine's own networks are derived on every run. A file that pins the address
of the moment it was written keeps advertising an address the machine does
not have any more.

---

## 5. Step four — start the daemon

```bash
gatewarden start
```

It prints `started the daemon (pid 12345)` and returns. The daemon is
detached: it outlives the command, and it serves the configuration document
and the relay.

The daemon starts by itself the first time a route is registered, so this
step is not strictly necessary — doing it by hand tells you at once that the
daemon works, before a route depends on it.

The other commands of the lifecycle:

| Command | What it does |
| --- | --- |
| `gatewarden start` | starts the daemon and waits for it to answer |
| `gatewarden stop` | stops the daemon; it removes its own pid file |
| `gatewarden status` | the daemon, the ports, the files and the values of the configuration |
| `gatewarden install-service` | writes the unit of the platform and enables it, so the daemon survives a reboot (`--no-enable` writes the unit without enabling it) |
| `gatewarden migrate` | writes the configuration and the route store of an old layout into the new one — the layout of the old name first; in a home that holds both old layouts only that one comes over, and the older one is reported as not migrated; the old files stay where they are (`--dry-run` only reports) |

The service stays stopped after `gatewarden stop`, on macOS and on Linux.
The daemon ends with the exit code 0 when it is stopped, and the unit of
the platform leaves it alone: `SuccessfulExit=false` in the launchd agent
on macOS, `Restart=on-failure` in the systemd unit on Linux.

Nothing is deleted by the migration: the old files stay where they were, and
the new layout holds the configuration and the route store in its own files.
A home that holds one old layout gets the configuration and the route store
of that layout in the new one. A home that holds both old layouts gets them
from the layout of the old name, which is migrated first: it takes the
configuration file and the route store, and the older layout, the old
directory `~/.traefik-dev/`, is not migrated. The report says so in plain
words: a `not migrated:` line for each file of the older layout that did not
come over, with the place it stayed in, and a `next:` line that says what to
do with the routes of the older layout. The routes that the route store of
the new layout does not hold stay in the file of the older layout, until
they are added to it by hand.

The log of the daemon is `daemon.log` in the state directory; the routes live
in `routes.json` next to it. `gatewarden status` prints both paths. The
daemon of the service writes to that file as well: the journal of the
platform keeps the log of the service, and the file holds the log whichever
way the daemon was started.

Removing the package takes the daemon with it, and the files of the
installation with the daemon: the daemon watches its own installation and
stops itself when the package is gone. npm 7 and later do not run the
uninstall scripts of a package — npm's own documentation says so — and the
package ships them for the package managers that do run them:
`preuninstall` stops the daemon, `postuninstall` removes the configuration
file, the route store, the log and the cache. The result is the same under
every package manager: no process, no configuration file, no routes, no
cache.

### The options every command takes

| Option | What it does |
| --- | --- |
| `--config <path>` | the configuration file to use, instead of the one of the platform |
| `--state-dir <path>` | the state directory to use, instead of the one of the platform |
| `--json` | machine-readable output: one JSON object on the standard output and nothing else |

They are global: they work before the command and after it.
`gatewarden --json doctor` and `gatewarden doctor --json` are the same
command.

---

## 6. Verifying the installation

Run these in the order below. The first one is the one to start with.

| # | Command | A working installation answers |
| --- | --- | --- |
| 1 | `gatewarden doctor` | `nothing is broken`, and the exit code is 0 |
| 2 | `gatewarden status` | `daemon: running (pid …)`, `zone: example.com` |
| 3 | `curl -sS http://127.0.0.1:45002/healthz` | `ok` |
| 4 | `curl -sS http://127.0.0.1:45002/traefik` | the configuration document, in YAML — the same thing the proxy polls |
| 5 | from the proxy's machine: `curl -sS http://<the machine>:45002/healthz` | `ok` — the proxy reaches the machine, and its address is in the trust list |
| 6 | `gatewarden register --project probe --branch main --port 3999` | `url: https://main.probe.example.com` |
| 7 | open that address | the dev server that listens on `3999` |

For step 6, run a server first — otherwise the route is registered and the
address answers `502`, which is the route working and the dev server missing:

```bash
node -e 'require("http").createServer((q,s)=>s.end("probe-ok")).listen(3999,"127.0.0.1")' &
```

Wait one poll interval (two seconds by default) after registering, so that
the proxy has picked the route up.

Remove the probe again:

```bash
gatewarden unregister --project probe --branch main
```

---

## 7. What `gatewarden doctor` checks

The doctor reads the installation and writes one line per check:

```text
ok        config file         /home/user/.config/gatewarden/config.json
ok        state directory     /home/user/.local/state/gatewarden
warn      daemon              not running (pidfile /home/user/.local/state/gatewarden/daemon.pid): it starts with the first route, or run "gatewarden start"
warn      dns zone            not configured: the host names of the routes are built from it (run "gatewarden setup", or write it in the configuration file)
warn      shared middlewares  the shared middlewares are on, but no provider owns them (run "gatewarden setup")
warn      registry port       :::55002 (nothing listens there: the daemon has not started it)
warn      relay port          :::55001 (nothing listens there: the daemon has not started it)
ok        routes              0 registered
skipped   routes and zone     no routes: there is no host name to build
warn      proxy               no traefik API answered at http://127.0.0.1:8080: the proxy runs on another machine
ok        trust list          the trust list (allowedCidrs): 127.0.0.1/32, ::1/128, 2001:db8:0:0::/64
ok        registry list       the trust list of the registry (registryAllowedCidrs) is empty: the registry serves the configuration document to the same addresses as the relay
warn      proxy address       the trust list (allowedCidrs) of the configuration file holds the loopback and nothing else: a proxy that runs on another machine is not in it, and the gateway answers it a 403 (add the address of your proxy to allowedCidrs)
warn      service             not installed: run "gatewarden install-service" so the daemon survives a reboot
skipped   old service         there is no unit of the old name
skipped   legacy layout       there is no old layout to migrate
skipped   old name layout     there is no old name layout to migrate
nothing is broken (8 checks are not in place here: daemon, dns zone, shared middlewares, registry port, relay port, proxy, proxy address, service)
```

This transcript is the output of `gatewarden doctor` in a clean installation
— a configuration file with nothing in it but the shared middlewares on and
ports of its own, a state directory of its own, no daemon — on a machine
whose IPv6 network is in the documentation range of RFC 3849; the ports and
the addresses are the ones of that installation, and the paths are the ones
of your own home.

The columns are the status, the name of the check and what it saw. A check
that does not apply to the installation is `skipped`.

| Check | What it looks at | `ok` | `warn` | `fail` |
| --- | --- | --- | --- | --- |
| `config file` | the configuration file of this installation | the file exists | the file does not exist yet — the built-in defaults are used | — |
| `state directory` | the state directory | it exists and is writable | it does not exist yet — it is created when the first route is written | it exists and is not writable — the routes cannot be written |
| `daemon` | the daemon of this installation, by its pid file and the health probe | it answers | — | it does not answer: `gatewarden start` |
| `dns zone` | the `zone` of the configuration | a zone is configured | — | no zone: the host names are built from it, so no route can be named |
| `shared middlewares` | the `middlewareProvider` — only when `securityHeaders` or `compressMiddleware` is on | a provider is named | — | the middlewares are on, but no provider owns them: the routers would point at middlewares that do not exist |
| `registry port` | something listening on the registry port | something listens | — | nothing listens: the proxy cannot poll the document |
| `relay port` | something listening on the relay port | something listens | — | nothing listens: the requests of the user have nowhere to go |
| `routes` | the route store | always `ok`; the detail says how many routes there are | — | — |
| `routes and zone` | the routes and the zone together — only when there is at least one route | the zone is there | — | there are routes but no zone: a new route cannot be named |
| `proxy` | the API of the proxy (`/api/version` and `/api/http/routers`) | the API answered | no API answered — the gateway works without it, but the proxy is not reachable from here | the adapter failed: the detail says why |
| `trust list` | the trust list (`allowedCidrs`) — the addresses that may talk to the gateway | the list holds an address; the detail prints the whole list | the list is empty: no address may talk to the gateway — or the configuration file holds nothing, and the only addresses that may talk to the gateway are the ones this machine adds | — |
| `registry list` | the trust list of the registry (`registryAllowedCidrs`) — the addresses that may read the configuration document | the detail prints the whole list; an empty list is not a warning: the registry then serves the document to the same addresses as the relay | — | — |
| `proxy address` | the addresses the host of the proxy's API resolves to — the addresses the proxy connects from are usually the same; when the doctor does not know where the proxy is, the check is skipped | the doctor resolved the host of the proxy's API, and the trust list covers the addresses it found | the trust list does not cover the addresses of the host of the proxy's API: the gateway answers them a `403` — or the list is empty, or holds the loopback and nothing else | — |
| `legacy layout` | the old directory `~/.traefik-dev/` | everything it held came over: the directory can be left in place or removed by you | something did not come over: the detail names it, and the directory must not be removed: it holds what did not come over | — |
| `old name layout` | the directories of the name the package had before the rename (`~/.config/dev-gateway/` and the state directory of the same name) | everything they held came over: the directories can be left in place or removed by you | something did not come over: the detail names it, and the directories must not be removed: they hold what did not come over | — |
| `old service` | the unit of the name the package had before the rename (`dev-gateway.service`, the old launchd label) | — | it is still there: it runs a launcher that does not exist any more — `gatewarden install-service` writes the new one | — |
| `service` | the unit of the platform | it is installed | it is not installed: `gatewarden install-service` makes the daemon survive a reboot | — |

The exit code is 1 when a check failed, and 0 otherwise. A `warn` does not
fail the doctor: the installation can work with a warning (no service unit,
no proxy API in reach).

`gatewarden doctor --json` writes the same report as one JSON object:

```json
{
  "ok": true,
  "checks": [{ "name": "daemon", "status": "ok", "detail": "running (pid 4711)" }],
  "paths": { "configPath": "…", "stateDir": "…", "logFile": "…" }
}
```

### The address of the proxy's API

The doctor has to know where the proxy is: the addresses the proxy
connects from are the addresses the trust list has to hold. It takes
them from the address of the proxy's API — it resolves the host of that
address and uses the addresses it finds. The proxy itself is not asked.

The address is a URL to the API of the proxy — the base URL, the one the
adapter appends its own paths to. The doctor reads it from the
environment:

```bash
export GATEWARDEN_PROXY_API_URL="http://proxy.example.com:8080"
```

Without the variable the doctor uses the default of the adapter, and that
default is the address of a proxy on this machine (`http://127.0.0.1:8080` for
Traefik). The variable is needed when the proxy lives somewhere else: on
another machine, in a container, or behind a name that is not the one it is
reached by. The doctor reads the variable alone — nothing else in the package
reads it.

The addresses the doctor compares are the ones the host of the API resolves
to, and they are not always the address the proxy connects from: a proxy
behind NAT connects from the address of the NAT, and the trust list has to
hold that one.

---

## 8. When it does not work

The README has a table of symptom → cause → fix for the common failures:
[When something does not work](../README.md#when-something-does-not-work). The skill's
[troubleshooting reference](../skills/gatewarden/references/troubleshooting.md)
has the rest, with the reason each failure happens.

---

## 9. The setup wizard (optional)

```bash
gatewarden setup
```

Six steps, five of them automatic. The wizard never pretends: when it cannot
verify something, it says so. A setup that half worked and says so is worth
more than a setup that claims everything is fine.

### The flags

| Flag | What it does |
| --- | --- |
| `--json` | writes the report as one JSON object and nothing else |
| `--non-interactive` | never asks; keeps the values the configuration has |
| `--yes` | the same as `--non-interactive` |
| `--no-verify` | skips the end-to-end verification |
| `--proxy <id>` | the proxy to set up (default: the configured one) |
| `--api-base-url <url>` | where the proxy's API answers — a URL to the API of the proxy, the one the adapter appends its own paths to |
| `--poll-interval <ms>` | how long the proxy gets to pick the route up (default: 3000) |
| `--prompt-timeout <s>` | how long a question waits for an answer (default: 30) |

Without a terminal (no TTY on the standard input) the wizard never asks: it
keeps the values the configuration file holds and reports them as
unconfirmed.

The doctor needs the same address and has no flag of its own: it reads it
from the environment variable `GATEWARDEN_PROXY_API_URL`, the same URL that
`--api-base-url` names. See [The address of the proxy's
API](#the-address-of-the-proxys-api).

### The six steps

#### 1. Read the environment

Whether this is a container, the platform, the addresses a proxy could reach,
the working directory, the state directory, the configuration file and whether
a daemon is already running.

#### 2. Discover the proxy

The proxy adapter is asked what the proxy is: for Traefik it reads
`/api/version` and `/api/http/routers`. From the routers it derives the zone
(the common host-name suffix), the entry points, the certificate resolver and
the middleware provider. The routers of Traefik itself — the API, the
dashboard, the ACME challenge — are left out: they say nothing about the
routes of the user. The dispatch middleware of the gateway is left out as
well: it lives in the HTTP provider, and the provider of it is not the
provider of the middlewares the user shares.

The port of every entry point is read as well (`/api/entrypoints`): a proxy
that serves the routes on another port (8443, say) needs the port in the
public URL, and nobody can guess it.

What cannot be derived is asked for — **the value in the configuration file is
the default in the question, not an answer**. The host name the proxy reaches
this machine under is asked for as well: the proxy's API does not say it, and
the wiring is written with it. The trust list is asked for too: the proxy is
the one that polls the document and sends the dispatch header to the relay,
and the wizard offers the addresses of the proxy it talked to as the default
in the question. **An answer adds to the list that was offered** — the wizard
never removes an address from the trust list, so a list of your own cannot
take the loopback away and break every route with a refusal from the relay.
Remove an address by editing the configuration file. When there is nobody to
ask (a
non-interactive run, a machine without a terminal, a question that times out),
the value is kept and reported as unconfirmed, together with where every value
came from: the proxy, the user, the configuration file or the built-in
default. A value that is kept and is the built-in default is not written to
the configuration file at all: a new installation does not get the zone of
another project.

The built-in defaults are neutral: the zone, the certificate resolver, the
provider of the shared middlewares and the host name are empty, and the trust
list holds the loopback addresses of every machine. Nothing of one
installation is in the package.

#### 3. Is the proxy already wired?

Whether the proxy already has a provider pointing at this machine: a router
whose provider is the HTTP provider and whose service points at this host and
port.

The machine is known by more than one name — the advertised host name and the
advertised IP. The proxy may reach it by either, and a name that resolves to
an address is the same machine as that address.

When the proxy is already wired, the wizard skips to step five and verifies.

#### 4. Emit the wiring

The wizard prints the exact static configuration to add, with the values
filled in for this machine, and writes it to `<state>/wiring/<proxy>.yml` so
that it can be copied.

**The wizard cannot apply it.** The proxy's configuration lives on another
machine, and the gateway process runs without the privileges to write it. The
wizard says so plainly instead of pretending. This is step two of the manual
path, with the values filled in.

#### 5. Verify end to end

1. Start a throwaway server on a free port (`throwaway server`).
2. Register it (`route registered`).
3. Wait for one poll interval.
4. Fetch the public URL and require a successful response (`public URL`). The
   URL is fetched over HTTPS first; a proxy that serves the zone over plain
   HTTP answers the second try. The port of the entry point the routes
   attach to is tried as well. The answer has to be the answer of the
   throwaway server: something else may answer a request for a route with a
   successful response (the dashboard of the proxy does), and that is not the
   route.

   **The certificate of the public URL has to be trusted by the machine that
   runs the wizard.** The check is never switched off. A test environment
   trusts its own certificate authority with `NODE_EXTRA_CA_CERTS`; a
   machine that does not trust it gets a failed verification that says the
   certificate is the reason. A plain HTTP answer does not make it pass: the
   public URL is served over HTTPS, and a URL whose certificate is not
   trusted is not usable. Every attempt is reported, so a URL that did not
   answer stays visible.
5. Remove the route and stop the throwaway server (`cleaned up` — the route is
   removed and the server stopped whatever the outcome was). A route of the
   user that has the same name is put back.

When the proxy knows the URL but does not serve the route, the verification
is **skipped**: the wiring has to be added to the proxy first, and the
wizard cannot apply it — that is the proxy's own configuration, which you
write by hand. That is not a failed setup, and the exit code says so.

When the relay **refuses** the request (403), the verification **fails** and
the reason names the trust list: the relay only serves the addresses in
`allowedCidrs`, and a refusal is neither a certificate problem nor a proxy
that does not know the route. The same is true when the **registry** refuses
the document: the proxy never got a document, so it has none of your routes,
and the public URL answers `404` — the wizard reads the log of the daemon
and says that the trust list is the cause, not the wiring. A proxy that
refuses the request **itself** — an `ipAllowList`, a `forwardAuth`, a
middleware of its own — is a different thing, and the wizard says so
instead of sending the user to the trust list.

Each step is reported as it goes, and what could not be verified is reported
too. Without a proxy that answers there is no public URL to fetch, and the
verification is **skipped** with that reason — not failed.

The verification needs a gateway that serves the dynamic document: the proxy
polls the document, and the document has to carry the throwaway route. The
configuration is therefore written and the daemon started *before* the
verification — a verification against a gateway that is not up yet verifies
nothing. Step six reports what the verification needed; it does not introduce
it.

#### 6. Write the configuration and start

The derived values are written to the configuration file, the daemon is
started, and the wizard recommends `gatewarden install-service` for
surviving a reboot.

Both happen before the verification of step five, because the verification
needs them.

A daemon that is already running serves the configuration it was started
with, so the wizard restarts it: otherwise the document the proxy polls is
the old one, and the verification would check the old configuration. The
routes live in the route store and not in the daemon, so a restart does not
lose them. A route keeps the host name it was registered with — and the
certificate of the route is built from the zone of the route, so the
certificate covers the name the route was given. A new zone applies to the
routes that come after it.

The values nobody confirmed are not written when they are the built-in
default: a new installation would otherwise get the zone of another project
in its configuration file. They are listed in `config.omitted`.

### The report

`gatewarden setup --json` writes one object with:

| Field | What it holds |
| --- | --- |
| `environment` | what step one found |
| `proxy` | what step two found, and what it derived |
| `wired` | the answer of step three |
| `wiring` | the path and the content of the snippet of step four |
| `verification` | `verified`, `failed` or `skipped`, with the reason and the steps |
| `config` | the path, the values, where every value came from (`sources`), the values nobody confirmed (`unconfirmed`) and the values that were not written (`omitted`) |
| `daemon` | whether the daemon runs after the wizard, and whether it was restarted |
| `nextSteps` | what the user should do next |

The exit code is 1 when the verification failed, in every mode — a script
sees it. It is 0 when the verification was skipped: there was no proxy to
verify against.

With `--json` the report is written as one object and nothing else. In the
text output the steps are written as they happen, and the verdict is in the
report and in the exit code.

### The values the wizard writes

| Key | Meaning |
| --- | --- |
| `zone` | the DNS zone the host names are built from |
| `entryPoints` | the proxy entry points the routers attach to |
| `certResolver` | the certificate resolver the routers ask for; empty means no TLS block |
| `middlewareProvider` | the proxy provider that owns the shared middlewares |
| `advertisedHost` | the host name the proxy reaches this machine under |
| `allowedCidrs` | the sources that may talk to the gateway: the proxy that polls the document and sends the dispatch header |

The wizard does not touch the ports or the secret: they are the
installation's own, not the proxy's.

Without a zone there is no host name: the verification is skipped with that
reason, and the wizard says that the zone has to be set. `gatewarden
register` refuses a route without a zone and says how to get one.
