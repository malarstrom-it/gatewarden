# Changelog

All notable changes to this project are documented in this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The names under "Added", "Changed", "Fixed" and "Removed" are the ones
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

The version before this one, `0.1.0`, was withdrawn from the registry on the
day it was published: nobody could install it, so nobody has it. This is the
first release of the package that is on the registry, and the first one a
reader can install and use.

### Added

- **The install starts no daemon.** `npm install` writes the configuration
  file with the default values and creates the three directories the gateway
  uses. It opens no port, starts no process and leaves nothing behind. The
  daemon starts itself the first time a command needs it, and
  `gatewarden install-service` brings it back after a reboot.
- **Both listeners answer only the addresses in the trust list.** The
  registry and the relay answer an address that is not in the list with
  `403`, and the answer says which address was refused and in which key the
  list is written. `registryAllowedCidrs` widens the list of the registry on
  top of `allowedCidrs`.
- **The health check reports instead of failing.** `gatewarden doctor` names
  every check it made, with the reason and the way out, and changes nothing.
  A thing that is missing but not broken is a warning, not a failure, and
  `--strict` turns the warnings into failures for the one who wants that.
- **The manifest of the package is complete.** The files the package ships
  are named one by one in the manifest, the entry points name their type
  declarations before their JavaScript, the three binaries are named, the
  version of node is declared, and the package is ESM-only.
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
  the changelog and the contributing guide no longer name the host of the
  installation the package was written for. The package is installed from
  npmjs.org, and a package that everybody can install does not point a
  reader at a private host. The public name of the package is unchanged:
  the name in the npm scope, the names of the three binaries, the names of
  the MCP tools, the commands and the ports stay what they were.

### Fixed

- **The relay closes its upgraded WebSocket sockets.** An upgraded socket is
  not closed by `server.close()`, and the relay never closed it either: the
  listener could therefore never finish its shutdown while a WebSocket was
  open, and the socket's handle kept the process alive. The relay now owns
  the upgraded sockets and closes them with the listener.
- **A peer that resets a refused WebSocket no longer takes the gateway down.**
  Node hands an upgraded socket to the application without an error handler of
  its own, and the relay attached its handler only after the refusals: a peer
  that reset a refused upgrade gave an unhandled `ECONNRESET` that stopped the
  worker.

### Documentation

- `docs/install-scripts.md` — the two install scripts of the package, the
  warning npm prints for them, and the commands that review and approve them.

## 0.1.0 - 2026-10-31

The first publication. Everything below arrived in this version; there is no
earlier version to compare it with.

### Added

- **A proxy-agnostic core.** The registry, the relay, the route state, the
  configuration and the daemon lifecycle live in one core that knows
  nothing about Traefik. The proxy is an adapter behind the `ProxyAdapter`
  contract, and the adapter is picked by the `proxy` key of the
  configuration.
- **A Traefik adapter.** The adapter renders the dynamic configuration
  document that Traefik polls, and it knows the entry points, the middlewares
  and the certificate resolver.
- **A registry.** One HTTP listener that serves the dynamic configuration
  document (`GET /<proxy>`) and a health probe (`GET /healthz`). It has no
  write path: the web interface is gone, and the other surfaces write the
  state file directly.
- **A relay.** One HTTP listener that dispatches a request to the dev server
  that the proxy named in the `X-Dev-Target` header. It only ever connects
  to `127.0.0.1`, and it tunnels WebSocket upgrades byte for byte.
- **A daemon.** The two listeners are supervised by a background process that
  outlives the command that started it, with a pid file, a lock and a
  restart. It is started by the lazy start — every command starts it when it
  is down — and by `gatewarden start`, never by the install.
- **A CLI** — `gatewarden` with `register`, `unregister`, `list`, `status`,
  `config`, `setup`, `start`, `stop`, `doctor`, `install-service` and
  `migrate`.
- **An MCP server** — `gatewarden-mcp`, with the tools `publish_dev_server`,
  `remove_dev_server` and `list_dev_servers`.
- **A pi extension**, a **Agent Skill** and a `docs/AGENTS.md` block, so an
  agent can publish a dev server without being told the host name twice.
- **A setup wizard** (`gatewarden setup`): it reads the proxy, derives what
  it can, asks for the rest and writes the configuration file.
- **A healthcheck** (`gatewarden doctor`) that reports every check it made,
  with the reason, and changes nothing.
- **A migration** (`gatewarden migrate`) from the old layout to the current
  one. It is never run on its own during an install.
- **A service unit** for Linux (systemd), macOS (launchd) and Windows (a
  scheduled task), installed by `gatewarden install-service`.
- **The package itself**: the compiled JavaScript, the type declarations, the
  three binaries and the documentation. The install writes the configuration
  file once and never fails the install; it starts no daemon, opens no port
  and leaves no process behind.

### Security

- The relay checks the source address against `allowedCidrs` and the
  `X-Relay-Secret` header against the shared secret before it looks at a
  request. The registry checks `X-Registry-Secret` before it serves the
  configuration document.
- The `postinstall` script exits 0 whatever happens, writes nothing to the
  terminal, does nothing in a CI environment, as root, in a checkout, and
  when `GATEWARDEN_AUTOSTART=0` is set, and writes only the configuration
  file and the two directories the package needs. It starts no daemon and
  leaves no process behind.
- The route state is written under a lock, so two registrations at the same
  time cannot lose one of them.
- The security policy says where a vulnerability report goes, and what is
  already protected.

### Documentation

- `README.md` — what the package is, what it needs, how to install it and
  what it does.
- `docs/setup.md` — the setup, by hand and through the wizard.
- `docs/traefik.md` — the proxy side of the wiring.
- `docs/healthcheck.md` — what every line of `gatewarden doctor` means.
- `docs/AGENTS.md` — the block an agent reads.
- `CHANGELOG.md` and `CONTRIBUTING.md`, and the security policy of the
  project.
