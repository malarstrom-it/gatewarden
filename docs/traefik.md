# Wiring the proxy: Traefik

This guide is for the **Traefik adapter** of the dev gateway. The core of the
package is proxy-agnostic (D3); everything below is what the Traefik adapter
needs from the machine the proxy runs on.

The gateway runs on the machine that hosts the development servers. The proxy
usually runs somewhere else. **One change has to be made on the proxy side:**
the `http` provider, so that the proxy polls the gateway's dynamic
configuration document. Nothing in this document is applied automatically —
the proxy's configuration belongs to the user, and the gateway process does
not have the rights to write it.

## 1. What the wizard does, and what it cannot do

```bash
dev-gateway setup
```

The wizard (six steps, `docs/setup.md`) reads the environment, discovers the
proxy, says whether the proxy already points at this machine, **prints the
wiring you have to add**, writes the configuration and starts the daemon.

It cannot apply the wiring. It writes the snippet to
`<state>/wiring/traefik.yml` so that it can be copied, and it says plainly
that the change is the user's.

## 2. The static configuration (the user's step)

Add the `http` provider to the `providers:` block of the Traefik static
configuration. The wizard prints the snippet with this machine's values filled
in; it looks like this:

```yaml
providers:
  http:
    endpoint: "http://<host>:45002/traefik"
    pollInterval: 2s
```

`<host>` is the name the proxy reaches this machine under: the `advertisedHost`
of the configuration, or its `advertisedIp` when no host name is set. The
endpoint is the registry — the port from `registryPort` — and the path is the
document the adapter serves under (`/traefik`).

Then **restart the proxy**: the static configuration is only read at start-up.

```bash
docker restart <traefik-container>
```

Everything else in the proxy's configuration stays as it is.

### The name is verified, not assumed

The proxy may reach this machine under a host name, under an IP, or under both.
A name that resolves to an address is the same machine as that address, so
either works — as long as the `endpoint` and the `advertisedHost` in the
configuration agree.

In a container, the compose service name is the durable one: the
Docker-generated hostname changes when the container is re-created, the service
name does not.

### The service URLs in the served document

The document the registry serves points at the relay:

```yaml
  services:
    dev-<project>-<branch>-<hash>:
      loadBalancer:
        servers:
          - url: "http://<host>:45001"     # the relay
```

To use the IP address instead, set `"advertisedHost": "<ip>"` in the
configuration file (`~/.config/dev-gateway/config.json` on Linux) — the
`endpoint` in the provider must then match.

### Reachability

* the registry port (`45002` by default) must be reachable from the proxy: the
  provider polls it;
* the relay port (`45001` by default) must be reachable from the proxy: it
  carries the requests;
* the listeners are bound on all interfaces, and the relay only accepts the
  dispatch header (`X-Dev-Target`) from the addresses in `allowedCidrs`.

## 3. What the wizard derives from the proxy

The Traefik adapter reads `/api/version` and `/api/http/routers` on the
Traefik API (`http://127.0.0.1:8080` by default) and derives four values from
the routers it finds:

| Value | Derived from | Written to |
| --- | --- | --- |
| the zone (`zone`) | the common host-name suffix of the routers | `zone` |
| the entry points (`entryPoints`) | the entry points the routers use | `entryPoints` |
| the certificate resolver (`certResolver`) | the resolver the routers' `tls` blocks use | `certResolver` |
| the middleware provider (`middlewareProvider`) | the provider of the middlewares the routers use | `middlewareProvider` |

A value that cannot be derived is asked for — the value in the configuration
file is the default in the question, not an answer. A non-interactive run keeps
the value and reports it as unconfirmed, together with where it came from: the
proxy, the user, the configuration file or the built-in default.

## 4. Certificates

The gateway asks for **one wildcard certificate per project**
(`tls: {certResolver: <resolver>, domains: [{main: "*.<project>.<zone>"}]}`),
which covers every branch of that project. Set `"tlsMode": "fqdn"` in the
configuration to ask for one certificate per address instead.

The resolver the wizard found is the one the generated routers use. The
resolver's credentials live in the proxy's own environment — the gateway never
reads them:

```yaml
environment:
  CF_DNS_API_TOKEN: "<the token, DNS:Edit on the zone>"   # or CF_API_EMAIL + CF_API_KEY
```

## 5. The shared secret (optional)

If a secret is configured in the gateway (`"secret": "…"` in the configuration
file), the configuration document is only served to a request that carries the
header `X-Registry-Secret`, and the relay only accepts requests that carry
`X-Relay-Secret`. The relay header is added by the per-router middleware the
gateway generates, so nothing has to be configured in the proxy for it. The
registry header has to be added to the provider configuration:

```yaml
providers:
  http:
    endpoint: "http://<host>:45002/traefik"
    pollInterval: 2s
    headers:
      X-Registry-Secret: "<the secret>"
```

## 6. The end-to-end check

```bash
# 1. a throwaway server on this machine
node -e 'require("http").createServer((q,s)=>s.end("probe-ok")).listen(3999,"127.0.0.1")' &

# 2. register it
dev-gateway register --project probe --branch main --port 3999

# 3. wait one poll interval, then open the URL
curl -sS https://main.probe.<zone>/     # → probe-ok

# 4. check that the objects are live
curl -sS https://<proxy dashboard>/api/http/routers | grep dev-probe
curl -sS https://<proxy dashboard>/api/http/services | grep dev-probe

# 5. clean up
dev-gateway unregister --project probe --branch main
```

The registry answers two paths and nothing else: the dynamic configuration
document (`/traefik`, which the provider polls) and the health probe
(`/healthz`). There is no write endpoint and no page: the routes are written to
the state file by the CLI and by the agents, and the route list is read with
`dev-gateway list`.

`dev-gateway setup` runs this check itself, with a throwaway server, and
reports every step it could not verify.

## 7. Rollback

Remove the `http:` block from `providers:` in the proxy's static configuration
and restart the proxy. The gateway keeps running; it only stops being polled.

The routes themselves are removed with `dev-gateway unregister`, one by one, or
by emptying the route store.

## 8. An example configuration

What follows is an **example**: the shape of the static configuration of a
Traefik, and what follows from it. Not one value in it belongs to anybody.

* the domain is `example.com`, from RFC 2606 — the domains that are reserved
  for examples;
* the addresses are from the ranges RFC 5737 reserves for documentation
  (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and from
  `2001:db8::/32`, the IPv6 documentation range;
* the names of your own services and the addresses of your own machines are
  yours, and they are the ones you put in your own files.

Read the shape, take the values from your own proxy. The setup wizard does the
same: it reads the running proxy, asks for what it cannot derive, and writes
the values into your own configuration file.

The proxy's static configuration:

```yaml
api:
  dashboard: true
log:
  level: "INFO"
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
  ssh:
    address: ":2222"
providers:
  docker:
    network: gateway-net
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
  file:
    filename: /etc/traefik/config/config.yml
    watch: true
certificatesResolvers:
  example:
    acme:
      email: "admin@example.com"
      storage: /etc/traefik/acme/acme.json
      dnsChallenge:
        provider: <your dns provider>
        resolvers: ["1.1.1.1:53", "1.0.0.1:53"]
ping: {}
metrics:
  prometheus: {}
```

The `email` is the address the certificate authority writes to — the account
of your own proxy, in your own proxy's configuration. The resolver is named
`example` here; yours has the name your routers use.

What follows from it:

* the certificate resolver is named **`example`** (the gateway does not
  carry the name: the setup wizard derives it from the proxy, or asks for
  it);
* the routers are attached to **`websecure` only** — `web` already redirects to
  `websecure`, so the client always ends up on HTTPS;
* the `docker` provider runs on the Docker network **`gateway-net`**, which is
  the network the gateway container is attached to (`192.0.2.13/24`, gateway
  `192.0.2.1`);
* the dashboard is published at `https://traefik.example.com` through the
  user's own router (`service: api@internal`). The gateway's own routes
  live under `<branch>.<project>.example.com`, so the two do not
  collide;
* the user's own objects (`storage`, `media`, `traefik`,
  `default-security-headers`, `compress`) keep their plain names. **Every
  object the gateway serves is prefixed** (`dev-…`, `devhdr-…`) so it can never
  collide with them.

The names of the gateway container, resolved with Docker's embedded DNS
(resolver `127.0.0.11`, network `gateway-net`):

| Name | Resolves to |
| --- | --- |
| `gateway` | `192.0.2.13` (and `2001:db8::d`) |
| `gateway.gateway-net` | `192.0.2.13` |
| `9f8e7d6c5b4a` (the Docker-generated hostname) | `192.0.2.13` |
| `proxy` | `192.0.2.6` (fqdn `proxy.gateway-net`) |

`gateway` is the compose service name, so it survives a container re-creation
(a new IP) — the Docker-generated hostname does not. Both the IPv4 and the IPv6
address of `gateway` are reachable from the proxy container.

The gateway's own ports are not published on the host, so they are not
reachable from the LAN; only the proxy reaches them.

The listeners are dual stack (`::` when the container has IPv6), and the relay
accepts the dispatch header from the CIDRs of the installation's own trust
list — `192.0.2.0/24`, the loopback and the container's own IPv6 prefix
(`2001:db8::/64`, derived at runtime) — so a connection over either stack
is accepted. The built-in default of the trust list is the loopback alone: the
rest belongs to the installation, and the setup wizard asks for it.

## 9. What goes into your own files

| Your file | What goes in it |
| --- | --- |
| the proxy's static configuration | the `http` provider: the endpoint the proxy polls (the registry's port, under the address the proxy reaches you under) |
| `~/.config/dev-gateway/config.json` | `zone`, `entryPoints`, `certResolver`, `middlewareProvider`, `advertisedHost` and `allowedCidrs` — the values of *your* installation |
| the proxy's own environment | the credentials of the certificate resolver (the gateway never reads them) |

Every one of those values comes from your proxy or from you: the zone from
the host names of your routers, the entry points from the routers themselves,
the resolver and the provider of the shared middlewares from the `tls` and
`middleware` blocks, the address from the name your proxy knows you by, and
the trust list from the networks your proxy reaches you from.

`dev-gateway setup` reads them, asks for the ones it cannot derive, and
writes them into your own configuration file. A package for anybody cannot
start with somebody else's zone: the built-in defaults are empty, and the
wizard fills them in.
