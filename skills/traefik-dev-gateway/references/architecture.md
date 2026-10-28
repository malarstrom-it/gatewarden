# Architecture of the Traefik dev gateway

## The chain

```
dev server            relay                 Traefik (separate container)          the user's LAN
127.0.0.1:5173   ──▶  devbox:45001   ──▶  private network, HTTP   ──▶  HTTPS :443
                        (dispatches on     Host(<branch>.<project>
                         X-Dev-Target)      .home.malarstrom.com)
                                                │
                                                └── TLS terminated with the
                                                    per-project wildcard certificate
                                                    *.<project>.home.malarstrom.com
```

* The **registry** (`devbox:45002`) serves the Traefik dynamic-configuration document to the
  `http` provider (`http://devbox:45002/traefik`, polled every 5 s) and answers a health probe
  (`/healthz`). Those are the only two paths it answers: there is no page and no write endpoint
  (D8, D9) — the routes are written to the state file by the CLI and by the agents, and the route
  list is read with `traefik-dev list`.
* The **relay** (`devbox:45001`) receives the request and forwards it to the dev server on
  `127.0.0.1:<port>`, WebSocket upgrades included (Vite HMR, Next.js). The Traefik router carries
  the dispatch header (`X-Dev-Target`) that says which registration the request belongs to.
* The **CLI** (`bin/traefik-dev.js`) writes the registration and starts the daemon if needed.

## The namespace rule

    <branch>.<project>.home.malarstrom.com

The user owns a wildcard DNS record `*.home.malarstrom.com` in Cloudflare, and it resolves at
arbitrary depth, so no per-project or per-branch DNS record is needed. The host address
(`home.malarstrom.com` → `10.10.1.50`) is private: the names are public, the payload is not.

One registration is one exact-`Host` router plus one service, added to and removed from Traefik
atomically. Wildcard-per-project routers are not used: one router serves one service, so they
cannot dispatch concurrent branches to different backends.

## Where the state lives

`~/.traefik-dev/` (a mounted volume, so it survives container restarts):

| File | Content |
| --- | --- |
| `registrations.json` | the registrations (single source of truth, written atomically) |
| `config.json` | the configuration (ports, zone, cert resolver, trust list, …) |
| `daemon.pid` | pid of the running daemon |
| `daemon.log` | daemon log (rotated at 5 MB, 3 files kept) |

## What the agent may and may not touch

* **May**: run the CLI (`register`, `unregister`, `list`, `status`). That is the whole interface.
* **Must not**: edit the user's Traefik static configuration, the Cloudflare account or the DNS
  zone. The user's Traefik only has the `http` provider added; everything else in it belongs to the
  user.
* **Must not**: edit the Cloudflare API token (it lives in the Traefik container's environment and
  is never read by this repository).
* Changing the gateway's own code is a development task, not part of exposing a dev server: it
  requires restarting the daemon pid.

## The full plan

In the gateway repository (`~/projects/traefik-api`):

* `specs/tech-architecture/traefik-dev-gateway.md` — the design and the decisions behind it.
* `specs/tech-architecture/grill-findings.md` — the open questions and how each one was settled.
* `docs/traefik-wiring.md` — the wiring to the user's Traefik (the one change the user made).
