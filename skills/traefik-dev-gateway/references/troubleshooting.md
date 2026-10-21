# Troubleshooting the Traefik dev gateway

The failures that actually happen, with symptom → cause → fix.

## Traefik log: `cannot decode configuration data: middlewares cannot be a standalone element (type map[string]*dynamic.Middleware)`

Traefik decodes the document with **paerser** and rejects an empty map. A section with no entries
must be **omitted**, never rendered as `{}`. If this message appears, the document the gateway
serves is broken — look at `src/document.ts` in the gateway repository
(`~/projects/traefik-api`). It happened once and cost a Traefik restart.

## The route does not appear on the dashboard

The **http provider polls every 5 s**. Give it one poll interval before concluding that something is
wrong.

```bash
curl -sS https://traefik.home.malarstrom.com/api/http/routers | grep dev-
```

The dashboard API is reachable and unauthenticated from this container.

## 502 from the URL

The dev server is not listening yet, or it listens on a different port than the registered one.
Check with `node ~/projects/traefik-api/bin/traefik-dev.js list` — it prints `up`/`down` per
registration.

## TLS error on the first request

The wildcard certificate for that project is still being issued (ACME dns-01 through the user's
Cloudflare account). Wait a few seconds and retry. The certificate covers
`*.<project>.home.malarstrom.com`, so it covers every branch of the project.

## The gateway daemon is not running

```bash
node ~/projects/traefik-api/bin/traefik-dev.js status
```

It prints the pid file, the log file and the state directory. The log is
`~/.traefik-dev/daemon.log`; the state lives in `~/.traefik-dev/` (a mounted volume, so it
survives container restarts). **Any change to the gateway code needs a restart of that pid** — the
daemon does not reload its own source.

`register` starts the daemon itself when it is not running, so a plain "the daemon is down" case
should never need manual handling.

## `devbox` resolves to IPv6 as well as IPv4

The listeners bind dual stack (`::`) and the relay's trust list covers the container's IPv6 prefix
(`fdd0:0:0:2::/64`, derived at runtime). Do **not** "fix" this by hard-coding an IPv4 address.

## The relay answers 403

By design: the relay only accepts the dispatch header (`X-Dev-Target`) from the Docker network
(`172.16.2.0/24` plus the container's own IPv6 prefix). A request from anywhere else is refused.

## The URL works but the app does not load

The relay forwards the request to `127.0.0.1:<port>`. If the dev server binds only `127.0.0.1`,
that is fine. If it binds a specific other address, or it died right after registering, the route
will fail — check the port with `list`.
