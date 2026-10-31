# Changelog

All notable changes to this project are documented in this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The names under "Added", "Changed", "Fixed" and "Removed" are the ones
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/#types-of-changes)
names. Every release gets a section, newest first.

## [Unreleased]

Nothing yet. The section stays here, empty, until the next change lands.

## [0.1.0] - 2026-10-31

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
- **A pi extension**, a **Agent Skill** and an `AGENTS.md` block, so an
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
- `SECURITY.md` says where a vulnerability report goes, and what is already
  protected.

### Documentation

- `README.md` — what the package is, what it needs, how to install it and
  what it does.
- `docs/setup.md` — the setup, by hand and through the wizard.
- `docs/traefik.md` — the proxy side of the wiring.
- `docs/healthcheck.md` — what every line of `gatewarden doctor` means.
- `docs/AGENTS.md` — the block an agent reads.
- `CHANGELOG.md`, `CONTRIBUTING.md` and `SECURITY.md`.

[Unreleased]: https://gitea.home.malarstrom.com/malarstrom/traefik-api/compare/v0.1.0...HEAD
[0.1.0]: https://gitea.home.malarstrom.com/malarstrom/traefik-api/releases/tag/v0.1.0
