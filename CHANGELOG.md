# Changelog

All notable changes to this project are documented in this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The names under "Added", "Changed", "Deprecated", "Removed", "Fixed" and
"Security" are the ones
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/#types-of-changes)
names. Every release gets a section, newest first.

## Unreleased

### Fixed

- **The published documentation points at no file the package does not
  ship.** The architecture reference of the skill and the setup guide named
  documents that are not in the package: a reader of the installed package
  followed the pointer and found nothing. The documentation names the files
  that are really there now, and the test suite keeps it that way.

## 0.1.1 - 2026-11-01

The version before this one, `0.1.0`, was published on the registry and
withdrawn on the same day. It was installable during the hours it was
there, it is not in the registry now, and the version number `0.1.0` is not
used again. This release is therefore the first one of the package that
stays on the registry, and the one to install.

### Added

- **A proxy-agnostic core.** The registry, the relay, the route state, the
  configuration and the daemon lifecycle live in one core that knows
  nothing about Traefik. The proxy is an adapter behind the `ProxyAdapter`
  contract, and the adapter is picked by the `proxy` key of the
  configuration.
- **A Traefik adapter.** The adapter renders the dynamic configuration
  document that Traefik polls, and it knows the entry points, the
  middlewares and the certificate resolver.
- **A registry.** One HTTP listener that serves the dynamic configuration
  document (`GET /<proxy>`) and a health probe (`GET /healthz`). It has no
  write path: the web interface is gone, and the other surfaces write the
  state file directly.
- **A relay.** One HTTP listener that dispatches a request to the dev server
  that the proxy named in the `X-Dev-Target` header. It only ever connects
  to `127.0.0.1`, and it tunnels WebSocket upgrades byte for byte.
- **A daemon.** The two listeners are supervised by a background process
  that outlives the command that started it, with a pid file, a lock and a
  restart. It starts itself the first time a command needs it, and
  `gatewarden start` starts it by hand.
- **A CLI** — `gatewarden` with `register`, `unregister`, `list`, `status`,
  `config`, `setup`, `start`, `stop`, `doctor`, `install-service` and
  `migrate`.
- **An MCP server** — `gatewarden-mcp`, with the tools `publish_dev_server`,
  `remove_dev_server`, `list_dev_servers` and `dev_gateway_status`.
- **A pi extension, an Agent Skill and a block for the agents**
  (`docs/AGENTS.md`), so that an agent can publish a dev server without
  being told the host name twice.
- **A setup wizard** (`gatewarden setup`): it reads the proxy, derives what
  it can, asks for the rest and writes the configuration file.
- **A health check that reports instead of failing.** `gatewarden doctor`
  names every check it made, with the reason and the way out, and changes
  nothing. A thing that is missing but not broken is a warning, not a
  failure, and `--strict` turns the warnings into failures for the one who
  wants that.
- **A migration** (`gatewarden migrate`) from the old layout to the current
  one. It is never run on its own during an install.
- **A service unit** for Linux (systemd), macOS (launchd) and Windows (a
  scheduled task), installed by `gatewarden install-service`.
- **The package itself**: the compiled JavaScript, the type declarations,
  the three binaries and the documentation. The documentation is
  `README.md` — what the package is and how to use it — and `docs/setup.md`
  (the setup, by hand and through the wizard), `docs/traefik.md` (the proxy
  side of the wiring), `docs/healthcheck.md` (what every line of
  `gatewarden doctor` means), `docs/AGENTS.md` (the block an agent reads)
  and `docs/install-scripts.md` (the install scripts of the package, the
  warning npm prints for them, and the commands that review and approve
  them). The install writes the configuration file with the default values
  and creates the three directories the gateway uses. It opens no port,
  starts no process and leaves nothing behind.
- **The manifest of the package is complete.** The files the package ships
  are named one by one in the manifest, the entry points name their type
  declarations before their JavaScript, the binaries are named, the version
  of node is declared, and the package is ESM-only.
- **A release is gated.** A version that does not typecheck, does not build
  or does not pass the tests never reaches the registry: the build and the
  tests are the gate of the release.

### Changed

- **The README is written for a reader who has never seen the tool.** It
  says what the tool does, what it needs, how to install it, how to
  configure it and what to do when something does not work. It does not
  describe the installation it was written for any more.
- **The published package names no repository.** The manifest fields
  `repository`, `homepage`, `bugs` and `funding` are gone, and the README,
  the changelog and the contributing guide no longer name a private host.
  The package is installed from the public npm registry, and a package that
  everybody can install does not point a reader at a private host. The
  public name of the package is unchanged: the name in the npm scope, the
  names of the binaries, the names of the MCP tools, the commands and the
  ports stay what they were.

### Deprecated

- **The names of the environment variables before the rename are deprecated.**
  `DEV_GATEWAY_HOME`, `DEV_GATEWAY_CONFIG` and `DEV_GATEWAY_STATE_DIR`
  still work, but the CLI reads them and says once that they are on their
  way out. `GATEWARDEN_HOME`, `GATEWARDEN_CONFIG` and
  `GATEWARDEN_STATE_DIR` are the names to use.

### Fixed

- **The relay closes its upgraded WebSocket sockets.** An upgraded socket is
  not closed by `server.close()`, and the relay never closed it either: the
  listener could therefore never finish its shutdown while a WebSocket was
  open, and the socket's handle kept the process alive. The relay now owns
  the upgraded sockets and closes them with the listener.
- **A peer that resets a refused WebSocket no longer takes the gateway
  down.** Node hands an upgraded socket to the application without an error
  handler of its own, and the relay attached its handler only after the
  refusals: a peer that reset a refused upgrade gave an unhandled
  `ECONNRESET` that stopped the worker.

### Security

- **Only the addresses on the trust list are answered, and only with the
  secret.** The relay checks the source address against `allowedCidrs` and
  the `X-Relay-Secret` header against the shared secret; the registry
  checks `X-Registry-Secret` before it serves the configuration document.
  An address that is not on the list is answered with `403`, and the answer
  says which address was refused and in which key the list is written.
  `registryAllowedCidrs` widens the list of the registry on top of
  `allowedCidrs`.
- **The install script never fails an install.** `postinstall` exits 0
  whatever happens, writes nothing to the terminal, and does nothing in a
  CI environment, as root, in a checkout, and when
  `GATEWARDEN_AUTOSTART=0` is set.
- **The route state is written under a lock**, so two registrations at the
  same time cannot lose one of them.
- **A report of a hole has a place to go.** The README has a security
  section that names the address a report goes to and asks for the details
  a reader of the report needs.
