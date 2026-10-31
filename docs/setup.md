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

The short version is in the README: [Vad som krävs](../README.md#vad-som-krävs-what-you-need).

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
| `gatewarden install-service` | the daemon starts again after a reboot |

---

## 2. Step one — install the package

On the machine that runs the dev servers:

```bash
npm install -g @malarstrom/gatewarden
```

Check that it arrived:

```bash
gatewarden --version
```

It prints the version of the package. The same package is a pi
package, and pi installs it like any other:

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

Then **restart the proxy**: the static configuration is only read at start-up.

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

Both listeners bind on every interface of the machine. The relay accepts the
dispatch header (`X-Dev-Target`) only from the addresses in `allowedCidrs`,
so the address of the proxy has to be in that list (step three).

Check that the proxy reaches the gateway — from the proxy's machine:

```bash
curl -sS http://<the address the proxy reaches the machine on>:45002/healthz
```

It answers `ok`. The registry answers two paths and nothing else: the
configuration document (`/traefik`) and the health probe (`/healthz`).

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

The names these variables had before the rename (`DEV_GATEWAY_HOME`,
`DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`) still work. They are
deprecated: the CLI reads them, and it says once that they are on their way
out. The current name wins when both are set.

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
| `proxy` | `"traefik"` | which proxy adapter writes the configuration document | the only adapter is Traefik |
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
| `allowedCidrs` | `["127.0.0.1/32", "::1/128"]` | the addresses allowed to send the dispatch header to the relay | the address of your proxy, and the loopback; the relay answers `403` to everything else |
| `secret` | `""` | a shared secret between the gateway and the proxy | your own; when it is set, the provider has to send it as a header |
| `stateDir` | the XDG state directory | the directory with the routes and the pid file | empty = the state directory of the platform |
| `documentFormat` | `"yaml"` | `yaml` or `json` for the configuration document | `yaml` |
| `logMaxBytes` | `5242880` | the log is rotated above this size | 5 MB |
| `logKeep` | `3` | how many rotated log files to keep | 3 |
| `autostart` | `true` | whether the install may start the daemon | `true` |

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
| `gatewarden migrate` | moves the old layouts (`~/.traefik-dev/` and `~/.config/dev-gateway/`) to the new one (`--dry-run` only reports) |

The log of the daemon is `daemon.log` in the state directory; the routes live
in `routes.json` next to it. `gatewarden status` prints both paths.

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
| 3 | `curl -sS http://<the machine>:45002/healthz` | `ok` |
| 4 | `curl -sS http://<the machine>:45002/traefik` | the configuration document, in YAML — the same thing the proxy polls |
| 5 | from the proxy's machine: `curl -sS http://<the machine>:45002/healthz` | `ok` — the proxy reaches the machine |
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
ok    config file      /home/user/.config/gatewarden/config.json
ok    state directory  /home/user/.local/state/gatewarden
ok    daemon           running (pid 4711)
ok    dns zone         example.com
ok    registry port    :::45002
ok    relay port       :::45001
ok    routes           1 registered
ok    routes and zone  1 registered, the zone is example.com
warn  proxy            no traefik API answered
warn  service          not installed: run "gatewarden install-service" to survive a reboot
nothing is broken
```

The columns are the status, the name of the check and what it saw.

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
| `legacy layout` | the old directory `~/.traefik-dev/` | — | it is still there: `gatewarden migrate` moves it | — |
| `old name layout` | the directories of the name the package had before the rename (`~/.config/dev-gateway/`) | — | it is still there: `gatewarden migrate` moves it | — |
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

---

## 8. When it does not work

The README has a table of symptom → cause → fix for the common failures:
[Vad som krävs](../README.md#vad-som-krävs-what-you-need). The skill's
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
| `--api-base-url <url>` | where the proxy's API answers |
| `--poll-interval <ms>` | how long the proxy gets to pick the route up (default: 3000) |
| `--prompt-timeout <s>` | how long a question waits for an answer (default: 30) |

Without a terminal (no TTY on the standard input) the wizard never asks: it
keeps the values the configuration file holds and reports them as
unconfirmed.

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
the one that sends the dispatch header to the relay, and the wizard offers the
addresses of the proxy it talked to as the default in the question. **An
answer adds to the list that was offered** — the wizard never removes an
address from the trust list, so a list of your own cannot take the loopback
away and break every route with a refusal from the relay. Remove an address
by editing the configuration file. When there is nobody to ask (a
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
wizard cannot apply it (§9.6). That is not a failed setup, and the exit
code says so.

When the relay **refuses** the request (403), the verification **fails** and
the reason names the trust list: the relay only serves the addresses in
`allowedCidrs`, and a refusal is neither a certificate problem nor a proxy
that does not know the route. A proxy that refuses the request **itself** — an
`ipAllowList`, a `forwardAuth`, a middleware of its own — is a different
thing, and the wizard says so instead of sending the user to the trust list.

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
| `allowedCidrs` | the sources that may send the dispatch header to the relay |

The wizard does not touch the ports or the secret: they are the
installation's own, not the proxy's.

Without a zone there is no host name: the verification is skipped with that
reason, and the wizard says that the zone has to be set. `gatewarden
register` refuses a route without a zone and says how to get one.
