# Wiring the user's Traefik to the dev gateway

The container side is built and running. **One change is needed on the Traefik side**: the `http`
provider must be added to the static configuration, because the running Traefik does not have it
yet. Adding a provider to the static configuration requires a Traefik restart.

Nothing in this document is applied automatically. Every value below is either read from the running
Traefik or a default that the user can change.

## 1. What the running Traefik has today (read from the SMB share)

`traefik.yml` (static configuration):

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
  gitea-ssh:
    address: ":2222"
  herdr-ssh:
    address: ":2223"
providers:
  docker:
    network: private
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
  file:
    filename: /etc/traefik/config/config.yml
    watch: true
certificatesResolvers:
  cloudflare:
    acme:
      email: "mikael@malarstrom.se"
      storage: /etc/traefik/acme/acme.json
      dnsChallenge:
        provider: cloudflare
        resolvers: ["1.1.1.1:53", "1.0.0.1:53"]
ping: {}
metrics:
  prometheus: {}
```

Consequences used by the implementation:

* the certificate resolver is named **`cloudflare`** (the default in the gateway configuration);
* the routers are attached to **`websecure` only** — `web` already redirects to `websecure`, so the
  client always ends up on HTTPS;
* the `docker` provider runs on the Docker network **`private`**, which is the network this container
  is attached to (`172.16.2.13/24`, gateway `172.16.2.1`);
* the dashboard is already published at `https://traefik.home.malarstrom.com` through the user's own
  router (`service: api@internal`). The gateway's index uses `index.home.malarstrom.com`, so the
  two do not collide;
* the user's own objects (`truenas`, `traefik`, `homebridge`, `default-security-headers`, `compress`)
  keep their plain names. **Every object the gateway serves is prefixed** (`dev-…`, `devhdr-…`) so it
  can never collide with them.

## 2. The static configuration patch (the user's step)

Add the `http` provider to the `providers:` block of `traefik.yml`. Everything else stays as it is:

```yaml
providers:
  docker:
    network: private
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
  file:
    filename: /etc/traefik/config/config.yml
    watch: true
  http:                                                   # <-- added
    endpoint: "http://devbox:45002/traefik"
    pollInterval: 5s
    pollTimeout: 5s
    # headers:                                          # <-- only when a secret is configured
    #   X-Registry-Secret: "<the secret>"
```

Then **restart Traefik** (the static configuration is only read at start-up):

```bash
docker restart <traefik-container>
```

### The name `devbox` is verified, not assumed

Resolved from inside this container with Docker's embedded DNS (resolver `127.0.0.11`, network
`private`):

| Name | Resolves to |
| --- | --- |
| `devbox` | `172.16.2.13` (and `fdd0:0:0:2::d`) |
| `devbox.private` | `172.16.2.13` |
| `e1e518cfcc56` (the Docker-generated hostname) | `172.16.2.13` |
| `traefik` | `172.16.2.6` (fqdn `ix-traefik-traefik-1.private`) |

`devbox` is the compose service name, so it survives a container re-creation (a new IP) — the
Docker-generated hostname does not. Both the IPv4 and the IPv6 address of `devbox` are reachable from
the Traefik container (verified with a TCP connect to the Traefik container over both stacks).

### The service URLs in the served document

Because `advertisedHost` defaults to `devbox`, the document the registry serves points at:

```yaml
  services:
    dev-<project>-<branch>-<hash>:
      loadBalancer:
        servers:
          - url: "http://devbox:45001"     # the relay
    dev-index:
      loadBalancer:
        servers:
          - url: "http://devbox:45002"     # the registry index
```

To use the container IP instead, set `"advertisedHost": "172.16.2.13"` in
`~/.traefik-dev/config.json` — the `endpoint` in the provider must then match.

### Reachability

* the registry port `45002` must be reachable from the Traefik container (same Docker network
  `private`) — it is bound on all interfaces;
* the relay port `45001` must be reachable from the Traefik container — it is bound on all
  interfaces;
* neither port is published on the host, so they are not reachable from the LAN.

The listeners are dual stack (`::` when the container has IPv6), and the relay accepts the dispatch
header from `172.16.2.0/24`, the loopback and the container's own IPv6 prefix
(`fdd0:0:0:2::/64`, derived at runtime) — so a Traefik connection over either stack is accepted.

### Shared secret (optional)

If a secret is configured in the gateway (`"secret": "…"` in `~/.traefik-dev/config.json`), the
registry document is only served to a request that carries the header `X-Registry-Secret`, and the
relay only accepts requests that carry `X-Relay-Secret`. The relay header is added by the per-router
middleware the gateway generates, so nothing has to be configured in Traefik for it. The registry
header has to be added to the provider configuration as shown above.

## 3. Certificates

The `cloudflare` resolver already exists and uses the **dns-01** challenge, which is the only
possibility here (the zone's A record points at a private address, so http-01 cannot work). The
resolver needs a Cloudflare API token in the **Traefik container's environment**:

```yaml
environment:
  CF_DNS_API_TOKEN: "<the token, DNS:Edit on malarstrom.com>"   # or CF_API_EMAIL + CF_API_KEY
```

The token is the user's secret: it is never read, logged or written by this repository.

The gateway asks for **one wildcard certificate per project**
(`tls: {certResolver: cloudflare, domains: [{main: "*.alpha.home.malarstrom.com"}]}`), which covers
every branch of that project. Set `"tlsMode": "fqdn"` in the gateway configuration to ask for one
certificate per FQDN instead.

The index router (`index.home.malarstrom.com`) uses `tls: {certResolver: cloudflare}` without
domains, so the resolver derives the name from the `Host()` matcher — that is one extra certificate
for the index host.

## 4. What happens after the restart

1. Traefik polls `http://172.16.2.13:45002/traefik` every 5 s.
2. Every registration in the document appears as its own router, service and middleware
   (`dev-…` / `devhdr-…`), next to the user's existing objects.
3. The user opens `https://<branch>.<project>.home.malarstrom.com`.

## 5. End-to-end check (the user's command, or the agent's)

```bash
# 1. a throwaway server in this container
node -e 'require("http").createServer((q,s)=>s.end("probe-ok")).listen(3999,"127.0.0.1")' &

# 2. register it
node ~/projects/traefik-api/bin/traefik-dev.js register --project probe --branch main --port 3999

# 3. wait one poll interval (5 s), then open the URL
curl -sS https://main.probe.home.malarstrom.com/     # → probe-ok

# 4. check that the objects are live
curl -sS https://traefik.home.malarstrom.com/api/http/routers | grep dev-probe
curl -sS https://traefik.home.malarstrom.com/api/http/services | grep dev-probe

# 5. clean up
node ~/projects/traefik-api/bin/traefik-dev.js unregister --project probe --branch main
```

## 6. Rollback

Remove the `http:` block from `providers:` in `traefik.yml` and restart Traefik. The gateway keeps
running; it only stops being polled.
