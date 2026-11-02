# @malarstrom/gatewarden

This package gives a development server on your own machine an https address on
your own domain.

A team that owns a domain runs a proxy that terminates TLS for it. A dev server
on a laptop has no address that the proxy can hand out, because it listens on
`127.0.0.1`. The gateway registers the route in the proxy and forwards the
request to the port. A colleague opens `https://main.my-app.example.com` in a
browser and sees the app you work on. Use it for the people who test your work
from another room: a colleague on the same network, a phone on the same wifi.

The dev server keeps running the way it does: Vite, Next, Nuxt,
`python -m http.server`, any local port. The gateway adds the route, the proxy
terminates TLS, and a relay forwards the request to `127.0.0.1:<port>`.

```text
user laptop ──https://main.my-app.example.com──▶ the proxy
   the machine the dev server runs on
     ├─ registry :45002  ── /traefik (the configuration document), /healthz
     └─ relay    :45001  ── dispatches on X-Dev-Target to 127.0.0.1:<port>
```

## What this is not

The name says gateway, and the expectation it raises is wrong in most cases.

- Not a tunnel. No third party is in the path. The request goes to the proxy you already
  run, and from there to `127.0.0.1:<port>`.
- Not hosting, and not a process manager for dev servers. The gateway does not run, stop or
  watch your dev server. It registers a route, and the route is gone as soon as you remove it.
- Not TLS termination. The proxy terminates TLS, with the certificate of your own
  resolver. The gateway never holds a certificate and never sees a private key.
- Not Traefik-specific. The core does not know what a router, a service or a middleware
  is: it hands the routes to a proxy adapter and serves what the adapter renders. The
  adapter contract is small, and the section below says how another adapter is written.

## Install

```bash
npm install -g @malarstrom/gatewarden
```

Node 20.11 or later. The package ships compiled JavaScript. Its runtime
dependencies are `env-paths` and `proper-lockfile`. It is ESM-only, so a
CommonJS consumer cannot `require()` it. Node 22.12 and later can.

The install starts nothing: no daemon, no open port, no process in the
background. The install script writes the configuration file with the default
values, and creates the three directories the gateway uses. A configuration
file that is already there stays as it is.

The install script does nothing in these cases: npm runs with
`npm_config_ignore_scripts=true`, the install runs as root, `CI` is set, or
`GATEWARDEN_AUTOSTART=0` is set. Under npm 12 the script is blocked until the
dependency is approved. The commands that approve it are in
[docs/install-scripts.md](docs/install-scripts.md). The daemon starts itself the
first time a command needs it, and this command brings it back after a reboot:
`gatewarden install-service`

## What you need

**Must**

| What | Why it is needed |
| --- | --- |
| Node 20.11 or later on the machine that runs the dev servers | The package is plain JavaScript. `node --version` tells you which one you have. |
| A Traefik proxy (v2 or v3) on another machine | The proxy terminates TLS and forwards the request. The gateway never terminates TLS itself. |
| A DNS zone the proxy already serves, for example `example.com`, with a certificate resolver for it | Every route gets the host name `<branch>.<project>.<zone>`. Without a zone there is no host name. The resolver gives the proxy the certificate, and the credentials stay in the proxy. |
| An address the proxy reaches the gateway machine on | The proxy polls the configuration document on port `45002` and sends the requests to the relay on port `45001`. Both ports have to be open. The address of your proxy has to be in `allowedCidrs`. |

**Can**, all of them optional: `gatewarden setup` writes the configuration file for you.
A shared secret (`"secret"`) makes the proxy present it to the registry and to the
relay. The shared middlewares of your proxy (`compress`, `default-security-headers`)
reach the dev routers as soon as you name the provider that owns them. More addresses
in `allowedCidrs` and in `registryAllowedCidrs` widen the trust list.

### The one change on the proxy side

Add the `http` provider to the `providers:` block of the static configuration of
Traefik, and restart the proxy. Traefik v2 and v3 both read that block from the
static configuration, and both use the new provider after the restart.

```yaml
providers:
  http:
    endpoint: "http://<the address the proxy reaches the machine on>:45002/traefik"
    pollInterval: 2s
```

`<the address the proxy reaches the machine on>` is the host name or the IP
that the proxy resolves to the machine the dev servers run on. It has to be the
same value as `advertisedHost` in the configuration file.

The gateway cannot make this change for you: the proxy runs on another machine.
`gatewarden setup` prints the same snippet with your values filled in. The proxy
side in full: [docs/traefik.md](docs/traefik.md). The rest of the setup, with a
complete example file: [docs/setup.md](docs/setup.md).

## Quick start

**1. Install the package** on the machine that runs the dev servers:

```bash
npm install -g @malarstrom/gatewarden
```

**2. Set the gateway up.** The wizard reads your proxy, derives what it can, asks for
the rest, writes the configuration file and starts the daemon:

```bash
gatewarden setup
```

The wizard is optional: every value it writes can be written by hand. The file it
writes is `~/.config/gatewarden/config.json` on Linux,
`~/Library/Preferences/gatewarden/config.json` on macOS and
`%APPDATA%\gatewarden\Config\config.json` on Windows. `gatewarden config` shows
the file the installation reads.

**3. Publish a dev server.** With the CLI:

```bash
gatewarden register --project my-app --branch main --port 5173
```

The command answers `registered main.my-app.example.com -> 127.0.0.1:5173 (dev
server is up)` and `url: https://main.my-app.example.com`. With the MCP tool of
an MCP client, the same route is published with `{ "port": 5173 }`.

**4. Hand over the address**, verbatim. The address is built from the zone, the
project and the branch. Never compose it by hand.

**5. Check that it works.** `gatewarden doctor` answers `nothing is broken`, and
`gatewarden status` answers `daemon: running (pid …)`.

## The CLI

| Command | What it does |
| --- | --- |
| `gatewarden register --project p --branch b --port N [--label text]` | Register a dev server, or update the port of a registered one. |
| `gatewarden unregister --project p --branch b` | Remove the registration. |
| `gatewarden list` | List the registrations. `--json` writes them as JSON. |
| `gatewarden status` | Show the daemon state, the ports and the configuration. |
| `gatewarden config [--write]` | Show the configuration and every key. `--write` writes the file. |
| `gatewarden setup` | Walk a new installation through the steps and write the configuration file. |
| `gatewarden start` | Start the daemon and wait for it. |
| `gatewarden stop` | Stop the daemon. |
| `gatewarden doctor [--strict]` | Report what is broken. `--strict` turns the warnings into errors. |
| `gatewarden install-service [--no-enable]` | Install the daemon as a service, so it starts again after a reboot. |
| `gatewarden version` | Print the version of the package. |

Global options: `--config <path>`, `--state-dir <path>`, `--json`, `--version`,
`--help`. They work before the command and after it.

Every command that reports something can report it as JSON. `--json` writes one
object to the standard output and nothing else. `gatewarden list --json` writes
the routes in the shape the MCP tool `list_dev_servers` uses. `state` is `up` or
`down`, from the gateway's own probe of the port.

The commands that need the daemon start it: `register`, `unregister`, `setup` and `start`.
The commands that only read the installation do not: `list`, `status`, `config` and
`doctor`.

## The configuration

The file is `~/.config/gatewarden/config.json` on Linux, `~/Library/Preferences/gatewarden/config.json`
on macOS, and `%APPDATA%\gatewarden\Config\config.json` on Windows. Three environment variables
move the files: `GATEWARDEN_HOME` puts everything in one directory, `GATEWARDEN_CONFIG` moves
the configuration file, `GATEWARDEN_STATE_DIR` the state directory.

| Field | What it means | What to write |
| --- | --- | --- |
| `proxy` | Which proxy adapter writes the configuration document | `"traefik"` |
| `registryPort` | The port the configuration document is served on. The proxy polls it. | `45002` |
| `relayPort` | The port the requests arrive on. The relay forwards them to your dev server. | `45001` |
| `advertisedIp` | The IP the proxy reaches this machine on | empty = detected from the network interfaces |
| `advertisedHost` | The host name the proxy reaches this machine on | the name the proxy can resolve. It must agree with the `endpoint` of the provider |
| `zone` | The DNS zone the host names are built from: `<branch>.<project>.<zone>` | **must**. Without it there is no host name |
| `entryPoints` | The entry points of the proxy the dev routers attach to | `["websecure"]` |
| `certResolver` | The name of the certificate resolver of your proxy | the name your own routers use. Empty = no TLS block, and the address is then plain HTTP |
| `tlsMode` | `wildcard` = one certificate per project, `fqdn` = one per address | `wildcard` |
| `securityHeaders` | Also apply the shared `default-security-headers` middleware | `false`. The frame-deny of that middleware can break a preview |
| `compressMiddleware` | Also apply the shared `compress` middleware | `false` |
| `middlewareProvider` | The provider that owns the shared middlewares | empty = the shared middlewares are not used |
| `allowedCidrs` | The addresses allowed to talk to the gateway | the address of your proxy, and the loopback |
| `registryAllowedCidrs` | The addresses allowed to read the configuration document, on top of `allowedCidrs` | empty = the same addresses as the relay |
| `secret` | A shared secret between the gateway and the proxy | empty = none |
| `stateDir` | The directory with the routes and the pid file | empty = the XDG state directory |

An empty value means "derived". `advertisedIp` and `advertisedHost` are detected on
every run. A file that pins the address of the moment it was written keeps advertising an
address the machine does not have any more. `gatewarden config` prints the same list for
the installation you are in, and `gatewarden config --write` writes the file.

### The trust list

Both listeners bind on every address of the machine, and both answer only the addresses
in the trust list. An address outside the list gets `403`.

`allowedCidrs` covers the relay, which takes the `X-Dev-Target` dispatch header from
those addresses, and the registry as well. `registryAllowedCidrs` covers the registry
alone, on top of `allowedCidrs`. It widens the list and never narrows it.

The default of `allowedCidrs` is the loopback of the machine and the IPv6 prefixes of its
own networks. The address of your proxy is not on it: add it, or every request from the
proxy is refused with `403`. The daemon reads the file at start-up, so restart it after
a change.

## The proxy adapter

The core is proxy-agnostic. Everything that has to do with a route — the name it gets,
the registry that publishes the document, the CLI and the MCP server — knows nothing
about which proxy is in front of the machine. The trust list is about addresses, not
about the proxy: it says who may talk to the gateway. The core knows routes, ports,
host names and reachability, and asks an adapter for everything else.

The package ships with one adapter: the Traefik adapter. It reads the routes and the
configuration and renders the document Traefik polls, under the path `/traefik`. When
it is asked, it reads the API of the proxy to find out which proxy it is talking to.

The interface an adapter implements is small: an id, an optional address of the proxy's
API, three methods and one that is optional:

| What the adapter has | What it does |
| --- | --- |
| `id` | The name of the proxy. It is also the path the document is served under. |
| `defaultApiBaseUrl` | Where the API of the proxy usually answers. Optional. |
| `discover(options)` | Find the proxy, read its version and what it derives from its own configuration. |
| `render(routes, config)` | Render the document the proxy polls: the relay the requests go to, and the id of the route that the proxy stamps on the request. The port of the dev server is not in the document — the relay looks it up when the request arrives. |
| `wiringSnippet(config)` | The static configuration the user has to add to the proxy. |
| `verify(route, config)` | Whether the proxy already knows the route. Optional. |

An adapter for another proxy — Caddy, say — is a file of a few hundred lines against
the contract the package exports (`ProxyAdapter`, from `@malarstrom/gatewarden`): the
Traefik adapter that ships with the package is one such file, about five hundred lines.
The package does not load an adapter at run time. The `proxy` key of the configuration
file names one, and the daemon picks it from the adapters it is built with. An id it
does not know is an error the worker dies of: it exits with `unknown proxy`, the daemon
starts it again, and the gateway never answers — `gatewarden start` fails on the health
check. A second adapter is therefore a change in the package, not a setting in the
configuration file.

No second adapter ships with the package. Writing the one you want is your own work.

## If you use socat

socat copies bytes from one port to another. The two ports are in the
command line, so each app needs its own process and port. The gateway does
the same forwarding, and it takes on the work around it:

- One relay port serves every dev server. The proxy stamps `X-Dev-Target` on
  the request, and the relay reads the dev server port from it.
- The gateway serves the configuration document that the `http` provider of
  the proxy polls. A registered route is in it, and a removed one is not.
  With socat you write a router and a service by hand, for each app.
- The address follows the project and the branch: `<branch>.<project>.<zone>`.
  The wizard reads the zone, the entry points and the certificate resolver
  from the proxy. Without an answer from the proxy, it asks you for them.
- Both listeners check the caller's address against the trust list, and the
  shared secret that the installation has. A socat listener has neither.
- The daemon starts the listeners on demand, and it stops them with the
  package. A socat process is one that you start and stop yourself.

TLS is not one of the differences: the proxy terminates it in both cases.

When you run one dev server and write the route of the proxy by hand, socat
is enough. As long as you need no address that follows the project and the
branch, no trust list, and no daemon, socat stays enough.

## The agent surfaces

### The MCP server

The server speaks the Model Context Protocol over the standard input and the standard output.

```json
{
  "mcpServers": { "gatewarden": { "command": "gatewarden-mcp", "args": [], "cwd": "${workspaceFolder}" } }
}
```

The `mcpServers` format is the one that Claude Desktop, Claude Code and Cursor use as
it is. VS Code, Codex and OpenCode convert their own format into it.

| Tool | Input | Output |
| --- | --- | --- |
| `publish_dev_server` | `{ port, project?, branch?, label? }` | `{ url, fqdn, project, branch, port, state }` |
| `remove_dev_server` | `{ project, branch }` | `{ removed, fqdn? }` |
| `list_dev_servers` | `{}` | `{ routes: [{ project, branch, port, fqdn, url, state }] }` |
| `dev_gateway_status` | `{}` | `{ daemon, proxy, config, reachable }` |

You can leave out the project and the branch. The project is then the name of the working
directory, and the branch is the branch of it. The server starts no daemon of its own.

### The other surfaces

The pi extension gives pi users what MCP alone does not. The three tools come as native
tools with an `outputSchema`. A `/routes` command shows the route table, and a status
line counts the live routes.

The package ships an [Agent Skill](skills/gatewarden/SKILL.md) in the `skills` directory.
pi, Claude Code, Codex and OpenCode read it. Its description makes an agent load it as
soon as a dev server is started.

The file [docs/AGENTS.md](docs/AGENTS.md) is a short, portable block for a harness that
reads context files. It says three things: publish the server, give the user the
returned URL, and remove the route after the server is gone.

## When something does not work

| Symptom | Cause | Fix |
| --- | --- | --- |
| `gatewarden register` says `no DNS zone is configured` | The configuration file has no `zone` | Write the zone into the configuration file (`"zone": "example.com"`) and register again |
| The address answers `502` | The dev server does not listen on the port you registered | Look at it with `gatewarden list`. The state column says `up` or `down` |
| The address answers `404` at the proxy | The proxy has not picked the route up yet, or the wiring is not in place | Wait one poll interval. Then check that the `http` provider is in the static configuration of the proxy, and that the proxy was restarted after it was added |
| The relay answers `403` | The address of the proxy is not in `allowedCidrs` | Add the address of the proxy to `allowedCidrs` in the configuration file, and restart the daemon |
| The registry answers `403` | The address that asks for the configuration document is not in the trust list | Add the address to `allowedCidrs` or to `registryAllowedCidrs`, and restart the daemon. The answer says which address was refused |
| The registry answers `403`, the relay answers `200` | The two listeners are reached from different addresses, and the address that polls the registry is not in the trust list | The trust list is one list for both listeners: `allowedCidrs` covers the relay and the registry. Add the address that polls the registry to `allowedCidrs` in the configuration file, and restart the daemon |
| The certificate of the address is not trusted | The resolver was not asked for a wildcard of the project, or the zone is another one | Look at the resolver in the log of the proxy. `"tlsMode": "fqdn"` asks for one certificate per address instead of one per project |
| The host name does not resolve | The DNS zone has no wildcard record for the subdomains | Add a `*` record for the zone to your DNS |
| `gatewarden doctor` says `not running` | The daemon is not up | Run `gatewarden start`, and read the log file the command names |
| The proxy serves its dashboard instead of your dev server | The route is not in the document the proxy polls | Run `curl -sS http://127.0.0.1:45002/traefik`. The route has to be in it |

`gatewarden doctor` reports every check it made: the configuration file, the state
directory, the daemon, the two ports, the routes, the proxy and the service unit.
It exits 1 on a failed check. What each check means is in
[docs/healthcheck.md](docs/healthcheck.md). The skill's
[troubleshooting reference](skills/gatewarden/references/troubleshooting.md) lists
more failures.

## The uninstall

```bash
npm uninstall @malarstrom/gatewarden
```

The uninstall takes the daemon with it, and the files of the installation go with the
daemon. The daemon watches its own installation and stops itself once the package is
gone, so no listener is left behind on the two ports. The files go with it too.

## Support

This is a one-person project. There is no support team, no on-call and no guaranteed
response time. An issue is answered as soon as the maintainer has time, usually
within a few days. If you need a guaranteed answer, this package is not for you.

Write to npm@malarstrom.se.

What to write there: what you ran, what you expected, what happened instead, and the
output of `gatewarden doctor`. It names every check the command made and every check that
failed, and it is often the whole answer.

## Security

A hole in the package, such as a way to make a listener answer an address it must
not, is reported privately. Send the report to npm@malarstrom.se with the subject
"security report", and describe the hole, the version you used and how to reproduce
it. Do not open a public issue for it, and keep the details out of every public
channel.

## License

MIT. The full text is [LICENSE](LICENSE).
