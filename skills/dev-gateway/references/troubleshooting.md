# Troubleshooting the dev gateway

The failures that actually happen, with symptom → cause → fix.

## The proxy log: `cannot decode configuration data: middlewares cannot be a standalone element (type map[string]*dynamic.Middleware)`

The proxy decodes the document and rejects an empty map. A section with no
entries must be **omitted**, never rendered as `{}`. If this message appears,
the document the gateway serves is broken — look at the adapter
(`src/adapters/traefik.ts`). It happened once and cost a proxy restart.

## The route does not appear on the dashboard

The **HTTP provider polls every 5 s**. Give it one poll interval before
concluding that something is wrong.

```bash
curl -sS https://<proxy dashboard>/api/http/routers | grep dev-
```

The dashboard API is often reachable and unauthenticated from the machine the
gateway runs on.

## 502 from the URL

The dev server is not listening yet, or it listens on a different port than the
registered one. Check with `dev-gateway list` — it prints `up`/`down` per
registration.

## TLS error on the first request

The certificate for that project is still being issued (ACME dns-01 through the
certificate provider's account). Wait a few seconds and retry. The certificate
covers `*.<project>.<zone>`, so it covers every branch of the project.

## The daemon is not running

```bash
dev-gateway status
```

It prints the pid file, the log file and the state directory. The log is
`daemon.log` in the state directory; the routes live in `routes.json` next to
it. **Any change to the gateway code needs a restart of that pid** — the daemon
does not reload its own source.

`register` starts the daemon itself when it is not running, so a plain "the
daemon is down" case should never need manual handling.

## The host name resolves to IPv6 as well as IPv4

The listeners bind dual stack (`::`) and the relay's trust list covers the
IPv6 prefix of the machine, derived at runtime. Do **not** "fix" this by
hard-coding an IPv4 address.

## A stale route the agent forgot to unregister

The user can remove a registration by hand from the shell:

```bash
dev-gateway unregister --project <project> --branch <branch>
```

The route is gone on the proxy's next poll (≈5 s). It is a manual fallback — an
agent must still unregister with the CLI when it stops a dev server.

There is no HTTP endpoint for the removal: the registry serves the
configuration document and the health probe, and nothing else (D9).

## The relay answers 403

By design: the relay only accepts the dispatch header (`X-Dev-Target`) from the
addresses in `allowedCidrs`. A request from anywhere else is refused.

## The URL works but the app does not load

The relay forwards the request to `127.0.0.1:<port>`. If the dev server binds
only `127.0.0.1`, that is fine. If it binds a specific other address, or it
died right after registering, the route will fail — check the port with
`dev-gateway list`.

## Nothing works after an install

```bash
dev-gateway doctor
```

It checks the configuration file, the state directory, the daemon, the DNS zone,
the shared middlewares, the two ports, the routes, the proxy and the service
unit, and it names every check it made with the reason for it. It exits 1 when
a check fails. A thing that is not there — no daemon, no zone, no proxy — is a
warning, not a failure.
