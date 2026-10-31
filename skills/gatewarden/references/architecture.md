# How the gateway fits together

## The chain

```text
dev server            relay                 proxy (Traefik)              the user's LAN
127.0.0.1:5173   ──▶  gateway:45001   ──▶  the proxy polls the   ──▶  HTTPS :443
                        (dispatches on      configuration document
                         X-Dev-Target)           │
                                                └── TLS terminated with the
                                                    per-project certificate
                                                    *.<project>.<zone>
```

* The **registry** (port `45002` by default) serves the dynamic-configuration
  document to the proxy's HTTP provider (`http://<host>:45002/traefik`, polled
  every few seconds — the wizard writes `pollInterval: 2s`) and answers a
  health probe (`/healthz`). Those are the only two paths it answers: there is
  no page and no write endpoint (D8, D9) — the routes are written to the state
  file by the CLI and by the agents, and the route list is read with
  `gatewarden list`.
* The **relay** (port `45001` by default) receives the request and forwards it
  to the dev server on `127.0.0.1:<port>`, WebSocket upgrades included (Vite
  HMR, Next.js). The router the proxy builds carries the dispatch header
  (`X-Dev-Target`) that says which registration the request belongs to.
* The **daemon** supervises the two listeners. It is started by the first
  command that needs it, and it outlives the process that started it.
* The **CLI** (`gatewarden`) writes the registration and starts the daemon if
  it is not running.

## The namespace rule

```text
<branch>.<project>.<zone>
```

The zone is a property of the installation: the wizard derives it from the
proxy and writes it to the configuration file. One registration is one exact
`Host` router plus one service, added to and removed from the proxy
atomically. Wildcard-per-project routers are not used: one router serves one
service, so they cannot dispatch concurrent branches to different backends.

## Where the state lives

The files follow the XDG Base Directory specification (D6):

| Purpose | Linux | macOS | Windows |
| --- | --- | --- | --- |
| configuration | `~/.config/gatewarden/config.json` | `~/Library/Preferences/gatewarden/` | `%APPDATA%\gatewarden\Config\` |
| state (routes, pid) | `~/.local/state/gatewarden/` | `~/Library/Application Support/gatewarden/` | `%LOCALAPPDATA%\gatewarden\State\` |
| log | `~/.local/state/gatewarden/daemon.log` | `~/Library/Logs/gatewarden/` | `%LOCALAPPDATA%\gatewarden\Log\` |
| cache | `~/.cache/gatewarden/` | `~/Library/Caches/gatewarden/` | `%LOCALAPPDATA%\gatewarden\Cache\` |

Inside the state directory:

| File | Content |
| --- | --- |
| `routes.json` | the routes (the single source of truth, written atomically) |
| `daemon.pid` | pid of the running daemon |
| `daemon.log` | the daemon log (rotated at 5 MB, 3 files kept) |

`GATEWARDEN_HOME` puts all four in one directory, which is what the tests
and a throwaway installation use.

## What the agent may and may not touch

* **May**: call the MCP tools, or run the CLI (`register`, `unregister`,
  `list`, `status`). That is the whole interface.
* **Must not**: edit the proxy's static configuration, the certificate
  account or the DNS zone. The proxy only has the HTTP provider added;
  everything else in it belongs to the user.
* **Must not**: edit the certificate provider's token. It lives in the proxy's
  own environment and is never read by this package.
* Changing the gateway's own code is a development task, not part of exposing a
  dev server: it requires restarting the daemon.

## The documentation of the package

* `specs/tech-architecture/gatewarden.md` — the design and the
  decisions behind it.
* `docs/traefik.md` — the wiring of the Traefik adapter.
* `docs/setup.md` — the setup wizard, step by step.
* `docs/AGENTS.md` — the short block every harness can read.
