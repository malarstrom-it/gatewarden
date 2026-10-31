# Troubleshooting the gateway

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
registered one. Check with `gatewarden list` — it prints `up`/`down` per
registration.

## TLS error on the first request

The certificate for that project is still being issued (ACME dns-01 through the
certificate provider's account). Wait a few seconds and retry. The certificate
covers `*.<project>.<zone>`, so it covers every branch of the project.

## The daemon is not running

```bash
gatewarden status
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
gatewarden unregister --project <project> --branch <branch>
```

The route is gone on the proxy's next poll (≈5 s). It is a manual fallback — an
agent must still unregister with the CLI when it stops a dev server.

There is no HTTP endpoint for the removal: the registry serves the
configuration document and the health probe, and nothing else (D9).

## The relay answers 403

By design: the relay only accepts the dispatch header (`X-Dev-Target`) from the
addresses in `allowedCidrs`. A request from anywhere else is refused. The
answer says why: `forbidden: the source address 192.0.2.7 is not in the trust
list (allowedCidrs)`.

## The registry answers 403

By design, and for the same reason: the registry serves the configuration
document only to the addresses in the trust list — the list of the relay
(`allowedCidrs`) and, on top of it, the list of the registry
(`registryAllowedCidrs`, empty by default). The document names the projects,
the branches, the zone, the address of the machine and the port of the relay,
so it is not served to anybody else.

The answer says which address was refused and where the list is written:

```text
forbidden: the source address 192.0.2.7 is not in the trust list (allowedCidrs)
```

Two things cause it:

* the address of the proxy is not in `allowedCidrs` — the proxy cannot poll
  the document, so no route reaches it. Add the address of the proxy to
  `allowedCidrs` and restart the daemon;
* the installation has a `secret` and the caller did not present it in the
  `X-Registry-Secret` header.

A refusal of the registry does not stop the relay: the two have their own
lists, and `registryAllowedCidrs` widens the list of the registry without
touching the one of the relay.

The health probe (`/healthz`) is the exception: it is the liveness of the
daemon, and the daemon asks it from the machine itself. It is answered to
the trust list and to the loopback, and it asks for no secret — a trust list
that leaves the loopback out does not make `gatewarden doctor` or
`gatewarden start` fail on an installation that runs.

When the registry refuses the poll of the proxy, the proxy has no document
and no routes: the public URL answers `404`. `gatewarden setup` reads the
log of the daemon and says that the trust list is the cause — the wiring is
not.

## The URL works but the app does not load

The relay forwards the request to `127.0.0.1:<port>`. If the dev server binds
only `127.0.0.1`, that is fine. If it binds a specific other address, or it
died right after registering, the route will fail — check the port with
`gatewarden list`.

## Nothing works after an install

```bash
gatewarden doctor
```

It checks the configuration file, the state directory, the daemon, the DNS zone,
the shared middlewares, the two ports, the routes, the proxy and the service
unit, and it names every check it made with the reason for it. It exits 1 when
a check fails. A thing that is not there — no daemon, no zone, no proxy — is a
warning, not a failure.
