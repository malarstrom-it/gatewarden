# Traefik Dev Gateway — architecture plan

Status: **implemented (container side)**. The registry, the relay and the `traefik-dev` CLI are in
`src/`; see [`README.md`](../README.md) for usage and
[`docs/traefik-wiring.md`](../docs/traefik-wiring.md) for the Traefik-side patch. The Traefik side
itself is **not** part of this repository.

Implementation notes and the deviations from the plan are listed in
[§12 Implementation notes](#12-implementation-notes).

Every technical claim that carries a decision is
backed by an official source; the citation table and verdicts live in
[`grill-findings.md`](./grill-findings.md).

Traefik documentation is cited at `https://doc.traefik.io/traefik/...` (the current docs set,
describing **Traefik v3.7**; reference pages live under `/traefik/reference/...`). The older
`docs.traefik.io` alias is only partly usable (`docs.traefik.io/traefik/<path>` redirects to
`doc.traefik.io/traefik/traefik/<path>`, which 404s for some pages), so citations use the canonical
paths that were fetched.

---

## 0. Decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | **Where Traefik runs**: a separate container on the same Docker network ("private") | **Already the reality** — Traefik is running there |
| D2 | **Dynamic configuration channel**: HTTP provider; a registry inside this container serves the document | **Decided** |
| D3 | **Dev-server reachability**: a relay inside this container (`0.0.0.0:<relay-port>` → `127.0.0.1:<dev-port>`) | **Decided** |
| D4 | **Security posture**: the registry index is the primary "what is running" view; the Traefik dashboard is optional | **Decided** |
| D5 | **TLS**: the client sees HTTPS, Traefik terminates TLS, the hop into this container is plain HTTP | **Decided** |
| D6 | **Certificate granularity** | **Recommendation**: one wildcard certificate per project (`*.<project>.home.malarstrom.com`) — §7 |
| D7 | **Relay topology** | **Recommendation**: one relay process for all registrations, dispatching on a header set by a per-router Traefik middleware — §5.2 |
| D8 | **Remaining unknowns** | The checklist in §2 — **must be confirmed against the running Traefik** |

---

## 1. Problem statement

This container runs AI coding agents. Each project an agent creates runs its dev server on
`127.0.0.1:PORT` **inside this container**. The user sits on the same network as the host machine
that runs this container and cannot reach those ports: from the user's laptop the dev servers are
invisible.

The gateway must

1. let the user **click a URL** and reach the dev server an agent is running,
2. let a project **register and withdraw** its dev server **at runtime, independently** of other
   projects (atomic registrations),
3. give the user an **overview of everything the agents currently run**.

### 1.1 Namespace (confirmed)

```
<branch>.<project>.home.malarstrom.com
```

* `<branch>` — leftmost label, the branch of the dev lifecycle, DNS-safe slug.
* `<project>` — the project's own primary prefix label, directly left of `home` (the user's
  "label 4" counting from the right: `com`(1) `malarstrom`(2) `home`(3) `project`(4)). A project's
  namespace is `<project>.home.malarstrom.com`; the branch label sits in front of it.
* `home.malarstrom.com` — fixed suffix; the user's wildcard record is `*.home.malarstrom.com`.

The FQDN template stays configurable (`{branch}.{project}.{zone}`, `zone = home.malarstrom.com`), so
the project-label position is a parameter rather than a hard-coded constant.

### 1.2 Live DNS evidence (checked fact)

Queried through Cloudflare's DNS-over-HTTPS resolver
(`https://cloudflare-dns.com/dns-query` — genuinely public DNS, not the container resolver) and
re-verified while writing this plan:

| Query | Answer |
| --- | --- |
| `malarstrom.com NS` | `dan.ns.cloudflare.com.`, `isla.ns.cloudflare.com.` — the zone is hosted on Cloudflare |
| `home.malarstrom.com A` | `10.10.1.50` (TTL 300) — a **private, RFC 1918** address |
| `x.home.malarstrom.com A` | CNAME `home.malarstrom.com.` → `10.10.1.50` |
| `a.b.home.malarstrom.com A` | CNAME `home.malarstrom.com.` → `10.10.1.50` |
| `*.home.malarstrom.com CNAME` | `home.malarstrom.com.` |

Two consequences:

1. **The wildcard is a CNAME and resolves at arbitrary depth.** `a.b.home.malarstrom.com` already
   resolves, so `<branch>.<project>.home.malarstrom.com` resolves through the user's **single**
   record — RFC 1034 §4.3.3: "the \"*\" label always matches at least one whole label and sometimes
   more, but always whole labels"; RFC 4592 §2.2.1 (the wildcard applies "because
   `bar.example.` does not exist, but the wildcard does"). **No new DNS records are needed per
   project or per branch.**
2. **Public DNS names, private payload.** The names are publicly enumerable (anyone can query
   `anything.home.malarstrom.com` and learn it resolves to `10.10.1.50`), but `10.10.1.50` is not
   internet-routable — the traffic is only reachable from networks that route it (LAN/VPN). So the
   Traefik entryPoints and any dashboard/API bind the LAN/VPN address only, and the registry
   endpoint and the relay stay off the LAN.

Caveat (RFC 1034 §4.3.3): a concrete name between the wildcard and the query name disables the
wildcard — "Wildcard RRs do not apply: … When the query name or a name between the wildcard domain
and the query name is known to exist." The gateway must not create concrete names under
`home.malarstrom.com`.

---

## 2. Environment facts, and what must be confirmed against the running Traefik

### 2.1 This container (read-only inspection)

| Fact | Value |
| --- | --- |
| Interfaces | `lo` 127.0.0.1/8, `eth0` 172.16.2.13/24; default route `via 172.16.2.1` |
| Docker resolver | `/etc/resolv.conf` → `nameserver 127.0.0.11` ⇒ **custom / user-defined Docker network** (Docker: "Containers that attach to a custom network use Docker's embedded DNS server. The embedded DNS server address is 127.0.0.11.") |
| Listening TCP | `0.0.0.0:2222` (sshd), `127.0.0.11:46501` (Docker DNS), `0.0.0.0:7683` (node, pid 140); no dev server running now |
| Docker socket | **absent**; `docker` binary **not found**; `traefik` binary **not found** |
| Outbound HTTPS | works (`docs.traefik.io` → 301 → `doc.traefik.io`; `docs.docker.com` → 200) |

Consequences: this container cannot be re-created from inside; it is on a user-defined network, so
the running Traefik container can reach it by name/IP; and a `127.0.0.1`-bound process here is not
reachable from another container (loopback is per-container).

### 2.2 Checklist — must be confirmed against the running Traefik (D8)

These can only be answered by reading the user's Traefik deployment. **No values are invented
here**; the plan cannot be finalised until they are known.

- [ ] Which **dynamic-configuration providers** the running Traefik has enabled — `file`? `docker`?
      `http`? `kv`? none? (the HTTP provider must be added for our registry)
- [ ] Does it have a **static (install) configuration file**, and does it already define a
      **dynamic configuration directory/file** (`providers.file.filename` / `providers.file.directory`)?
- [ ] The **entryPoint names and addresses** it listens on (e.g. `web`, `websecure`, and the
      address each is bound to — the LAN address `10.10.1.50`, or `0.0.0.0`?)
- [ ] Whether the **dashboard/API** is enabled (`api`, `api.dashboard`, `api.insecure`), and if so on
      which entryPoint
- [ ] The name of its existing **ACME certificateResolver** (if any), and **how it is fed Cloudflare
      credentials** (env vars such as `CF_DNS_API_TOKEN` / `CF_API_EMAIL` / `CF_API_KEY`, or a
      mounted file) — and whether a dns-01 Cloudflare provider is already configured
- [ ] The **container name** of the running Traefik, and the **network name** ("private")
- [ ] Under which **name/IP this container is reachable** on that network (the container's Docker
      hostname, its alias, and whether `172.16.2.13` is stable)
- [ ] Which **ports of this container are already published** on the host (so the relay port does
      not collide), and whether the host firewall allows the Docker network to reach this container
- [ ] Whether **HTTP/2 / WebSocket** traffic to the dev servers must pass through unchanged
      (HMR) and whether any dev server needs its **own Host header** preserved

---

## 3. Topology as it actually is

```
  user laptop (LAN/VPN)
        │  https://<branch>.<project>.home.malarstrom.com
        │  DNS: *.home.malarstrom.com → CNAME home.malarstrom.com → 10.10.1.50 (private IP)
        ▼
  host machine 10.10.1.50
        │  published 80/443 → the running Traefik container  ("private" Docker network)
        ▼
  Traefik container
        │  TLS terminates here (D5)
        │  HTTP provider polls → GET http://<this-container>:9000/dynamic  (D2)
        │  exact-Host router → service → http://172.16.2.13:<relay-port>   (D3)
        ▼
  this container (172.16.2.13)
        ├── registry :9000  — serves the dynamic configuration document + the index page (D4)
        └── relay   :<relay-port> — forwards to 127.0.0.1:<dev-port>  (D3)
                    └── dev server (agent's process)
```

Because this container's ports are **not published**, they are not reachable from the LAN:
"Ports are not accessible from outside the host or, with the default configuration, from
containers in other networks." (Docker, network page). The relay and the registry therefore live
only on the host/Docker network.

---

## 4. Dynamic configuration: the HTTP provider (D2)

### 4.1 Static (install) configuration to add to the running Traefik

```yaml
providers:
  http:
    endpoint: "http://<this-container-hostname>:9000/dynamic"
    pollInterval: 5s
    pollTimeout: 5s
    headers:
      X-Registry-Token: "<shared secret>"
```

* "providers.http.endpoint — Defines the HTTP(S) endpoint to poll. — `\"\"` — Yes"
* "providers.http.pollInterval — Defines the polling interval. — `5s`"
* "providers.http.pollTimeout — Defines the polling timeout when connecting to the endpoint. — `5s`"
* "providers.http.headers — Defines custom headers to be sent to the endpoint. — `{}`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/

(The shared secret is optional but recommended; `providers.http.tls.insecureSkipVerify` stays
`false` and `providers.http.tls.ca` is unnecessary because the endpoint stays on the Docker
network.)

### 4.2 What the endpoint must return

* Format: **YAML or JSON** — "The HTTP provider uses the same configuration as the File Provider in
  YAML or JSON format." (same URL). The plan uses YAML.
* Content: the **dynamic (routing) configuration document** — the same shape as the file provider's
  file: `http.routers`, `http.services`, `http.middlewares`, `tcp.*`/`udp.*` if ever needed, and
  `tls` options.

```yaml
http:
  routers:
    alpha-feature-login:
      rule: "Host(`feature-login.alpha.home.malarstrom.com`)"
      service: alpha-feature-login
      middlewares:
        - alpha-feature-login-target@http
      tls:
        certResolver: myresolver
        domains:
          - main: "*.alpha.home.malarstrom.com"
  services:
    alpha-feature-login:
      loadBalancer:
        servers:
          - url: "http://172.16.2.13:9100"
  middlewares:
    alpha-feature-login-target:
      headers:
        customRequestHeaders:
          X-Dev-Target: "alpha/feature-login"
```

### 4.3 Does our document clobber the other providers' configuration?

The docs never use the word "merge"; what they state is:

* "Provider Namespace — When you declare certain objects in the Traefik dynamic configuration, such
  as middleware, services, TLS options or server transports, they reside in their provider's
  namespace. … If you use multiple providers and wish to reference such an object declared in
  another provider (e.g. referencing a cross-provider object like middleware), then the object name
  should be suffixed by the `@` separator, and the provider name. — `<resource-name>@<provider-name>`"
  URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/overview/
* "When two routers from different providers define the same rule with equal numeric priority, the
  precedence option determines which provider's route takes precedence. … Note precedence only acts
  as a tiebreaker: it is applied only when two routes from different providers share the same
  numeric priority value." (same URL)

**Verdict:** routers from different providers **coexist** in one routing table (otherwise there
would be no cross-provider conflict to break), and each provider's objects live in its own
namespace, so our `http` provider's routers/services/middlewares do not collide with objects served
by a `file`/`docker` provider. The docs do **not** state a merge algorithm explicitly — that is
recorded as a residual unknown, to be confirmed against the running Traefik (checklist §2.2) and
verified empirically with one test registration before going live.

Practical rule we adopt regardless: **the registry serves only our own objects**, all prefixed with
a distinctive name (`alpha-feature-login`), so nothing it serves can shadow an existing route. The
provider namespace suffix `@http` is used when our objects reference each other.

### 4.4 Latency

`pollInterval` defaults to `5s`, so a registration becomes visible within about one poll interval
(≈5 s) and a withdrawal likewise disappears within about one poll interval. The relay's own
routing table changes immediately; only Traefik's view lags by ≤ 5 s. `pollTimeout` (5 s) bounds
how long a hung registry can stall a poll.

---

## 5. The relay (D3) and the registration model

### 5.1 Data model

```yaml
registration = { project: alpha, branch: feature/login, devPort: 5173 }
  → fqdn  = feature-login.alpha.home.malarstrom.com
  → relay target = 127.0.0.1:5173
  → one router (exact Host) + one service + one middleware  (per registration)
```

1. `project_slug` — the project's claimed prefix label (unique per project).
2. `branch_slug` — sanitised branch name (§5.4).
3. `fqdn` = `{branch}.{project}.home.malarstrom.com`.
4. `rule` = `Host(`<fqdn>`)` — **exact**.
5. `service` — one service whose backend is the relay (`http://172.16.2.13:<relay-port>`).
6. `middleware` — one headers middleware per registration that stamps the dispatch header.
7. **Removal** = drop this registration from the registry and from the relay's table; nothing else
   changes.

**One registration = one router + one service**, added and removed atomically:

* "If the rule is verified, the router becomes active, calls middlewares, and then forwards the
  request to the service." and "service — The name of the service that will handle the matched
  requests. … Yes (required)"
  URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/

Removal semantics per channel (D2 = HTTP): the registry stops serving that router/service; the
next poll drops it (≤ `pollInterval`); the relay drops the mapping immediately.

### 5.2 Relay topology — one process for all registrations (D7)

Two designs were considered:

* **(a) one relay process per registration**, each on its own port; the service URL is unique per
  registration. Simplest and no trust boundary in the header — but it means a process per
  registration, a port allocator, and lifecycle management for each.
* **(b) one relay process for all registrations**, listening on a single
  `0.0.0.0:<relay-port>`, dispatching on a per-registration header that Traefik stamps with a
  per-router headers middleware.

**Recommendation: (b).** Reasons: one long-lived component (easy to supervise, one port, no
allocator); adding/removing a registration is a table update instead of a process lifecycle;
every registration still keeps **its own router, service and middleware**, so the atomicity and
the per-registration visibility in `/api/http/routers` and `/api/http/services` are preserved.

The dispatch signal is set by Traefik, not by the client:

> "The Headers middleware manages the headers of requests and responses. By default, the following
> headers are automatically added when proxying requests: Property / HTTP Header — Client's IP:
> `X-Forwarded-For`, `X-Real-Ip`; Host: `X-Forwarded-Host`; Port: `X-Forwarded-Port`; Protocol:
> `X-Forwarded-Proto`; Proxy Server's Hostname: `X-Forwarded-Server`"
> "Adding and Removing Headers — In the following example, requests are proxied with an extra
> `X-Script-Name` header while their `X-Custom-Request-Header` header is removed."
> (example) `http: middlewares: testHeader: headers: customRequestHeaders: X-Script-Name: "test"`

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/headers/

Trust boundary for the relay: it accepts the dispatch header **only** from the Traefik container's
source address on the Docker network, and (defence in depth) only when a shared secret is present.
The relay's port is not published on the host, so it is not reachable from the LAN ("Ports are not
accessible from outside the host or, with the default configuration, from containers in other
networks.").

### 5.3 What must survive the relay hop

* **WebSockets** (Vite HMR, Next.js, etc.) — Traefik handles them itself: "Traefik Proxy supports
  WebSocket (WS) and WebSocket Secure (WSS) connections out of the box. No special configuration is
  required beyond standard HTTP routing." (URL:
  https://doc.traefik.io/traefik/expose/overview/). But Traefik's WebSocket support ends at the
  relay: the **relay must implement the HTTP `Upgrade` handshake** and stream frames both ways,
  otherwise HMR breaks. This is the single most likely thing to go wrong in the design.
* **`X-Forwarded-*`** — Traefik adds them by default (quote above). The relay must forward them
  untouched to the dev server, and must not add its own `X-Forwarded-For` entries that would
  misreport the client IP; the dev server should see the original client address.

### 5.4 Branch-label sanitisation

GitLab's `CI_COMMIT_REF_SLUG` is the standard rule: "CI_COMMIT_REF_NAME in lowercase, shortened to
63 bytes, and with everything except 0-9 and a-z replaced with `-`. No leading / trailing `-`. Use
in URLs, host names and domain names."
URL: https://docs.gitlab.com/ci/variables/predefined_variables/

The same rule is applied to the project label. (The GitLab review-apps page returned HTTP 403 to a
plain fetch and is therefore not cited.)

### 5.5 Industry standard for the shape

Vercel: "The URL generated from a Git branch will always show you the most recent changes for the
branch and won't change if you push new commits to the branch." with URL structure
`<project-name>-git-<branch-name>-<scope-slug>.vercel.app`
(URL: https://vercel.com/docs/deployments/generated-urls). The convention is **project-scoped and
branch-qualified** — the same two dimensions the user asked for; the ordering differs (Vercel puts
the project first, the user's confirmed shape puts the branch first).

---

## 6. Flows

### 6.1 Register

```
agent (this container)
  └─ register { project: alpha, branch: feature/login, devPort: 5173 }
        ├─ relay: add mapping  X-Dev-Target: "alpha/feature-login"  →  127.0.0.1:5173
        └─ registry: store the registration, derive fqdn, render the dynamic document
              └─ Traefik polls (≤5 s) → router live
                    └─ user opens https://feature-login.alpha.home.malarstrom.com
                          → DNS: CNAME → home.malarstrom.com → 10.10.1.50
                          → Traefik terminates TLS, matches the exact Host rule
                          → headers middleware stamps X-Dev-Target
                          → service → relay → 127.0.0.1:5173 (dev server)
```

### 6.2 Unregister

```
agent → unregister { project: alpha, branch: feature/login }
  ├─ registry: drop the router + service + middleware from the rendered document
  ├─ relay: drop the mapping, close the listener for that target
  └─ within ≤ 1 poll interval Traefik's next poll removes the route → the FQDN no longer routes
```

### 6.3 Observable guarantees

* A registration is **atomic**: adding or removing one touches only its own router, service and
  middleware — never another registration's.
* A registration becomes **visible within ≈1 poll interval** (default 5 s) and a removal becomes
  **invisible within ≈1 poll interval**.
* The **index** (§7) lists everything currently registered, with project, branch, FQDN, port and
  up/down state.
* The relay is the only component that can fail per-registration: a dead dev server produces a
  failed upstream, not a broken route for other registrations.

---

## 7. TLS (D5) and certificate granularity (D6)

### 7.1 How the client-facing side works (D5)

The client speaks **HTTPS to Traefik**; Traefik terminates TLS and speaks **plain HTTP** to the
relay inside this container. Concretely: the router carries `tls: { certResolver: … }` and Traefik's
`websecure` entryPoint serves TLS; the service URL stays `http://172.16.2.13:<relay-port>`.

### 7.2 The certificate must come from dns-01

The zone's only A record is `10.10.1.50`, so http-01 validation cannot succeed:

> "With HTTP validation, the client in an ACME transaction proves its control over a domain name by
> proving that it can provision HTTP resources on a server accessible under that domain name."
> (URL: https://www.rfc-editor.org/rfc/rfc8555#section-8.3)

> "When the identifier being validated is a domain name, the client can prove control over that
> domain by provisioning a TXT resource record containing a designated value for a specific
> validation domain name. … The client constructs the validation domain name by prepending the
> label \"_acme-challenge\" to the domain name being validated"
> (URL: https://www.rfc-editor.org/rfc/rfc8555#section-8.4)

Traefik agrees, and states the wildcard limits:

> "The DNS-01 challenge to generate and renew ACME certificates by provisioning a DNS record.
> Traefik relies internally on Lego for ACME."
> "ACME v2 supports wildcard certificates. As described in Let's Encrypt's post wildcard certificates
> can only be generated through a DNS-01 challenge. It is not possible to request a double wildcard
> certificate for a domain (for example `*.*.local.com`)."
> (URL: https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/)

⇒ The user's existing **Cloudflare integration is the dns-01 provider** (the zone is on Cloudflare:
`malarstrom.com NS` → `dan/isla.ns.cloudflare.com`). Lego reads the Cloudflare credentials from the
environment: "CF_API_EMAIL — Account email · CF_API_KEY — API key · CF_DNS_API_TOKEN — API token with
DNS:Edit permission (since v3.1.0) · CF_ZONE_API_TOKEN — API token with Zone:Read permission
(since v3.1.0)" (URL: https://go-acme.github.io/lego/dns/cloudflare/).

### 7.3 Two granularities

Traefik derives the requested domain from the router:

> "A certificate resolver requests certificates for a set of domain names inferred from routers …
> If the IngressRoute has a `tls.domains` option set, then the certificate resolver derives this
> router domain name from the `main` option of `tls.domains`. Otherwise, the certificate resolver
> derives the domain name from any `Host()` or `HostSNI()` matchers in the IngressRoute's rule. You
> can set SANs (alternative domains) for each main domain. Every domain must have A/AAAA records
> pointing to Traefik. Each domain & SAN will lead to a certificate request."
> (URL: https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/)

| Granularity | How it is requested | Certificates | Verdict |
| --- | --- | --- | --- |
| **(i) one certificate per FQDN** | router `Host(`<branch>.<project>.home.malarstrom.com`)` with no `tls.domains` → the resolver derives the name from the rule | one dns-01 order **per branch** | **Rejected** — burns the registered-domain budget with every branch |
| **(ii) one wildcard certificate per project** | router `tls.domains: [{ main: "*.<project>.home.malarstrom.com" }]` + `tls.certResolver` | **one certificate per project**, covering every branch of that project | **Recommended** |

Why (ii) is right, with citations:

* A wildcard covers exactly one label, so `*.<project>.home.malarstrom.com` covers
  `<branch>.<project>.home.malarstrom.com` for **every** branch of that project, and nothing two
  labels deeper: "If the wildcard character is the only character of the left-most label in the
  presented identifier, the client SHOULD NOT compare against anything but the left-most label of
  the reference identifier (e.g., `*.example.com` would match `foo.example.com` but not
  `bar.foo.example.com` or `example.com`)."
  (URL: https://www.rfc-editor.org/rfc/rfc6125#section-6.4.3)
* A **double wildcard is impossible** (Traefik ACME docs, quoted above), so no single certificate can
  cover an arbitrary-depth name — the project-level wildcard is the deepest useful unit.
* Rate limits favour (ii) decisively. Let's Encrypt:
  * "Up to **50 certificates can be issued per registered domain** (or IPv4 address, or IPv6 /64
    range) **every 7 days**. This is a global limit, and all new order requests, regardless of which
    account submits them, count towards this limit. The ability to issue new certificates for the
    same registered domain refills at a rate of 1 certificate every 202 minutes."
  * "Up to **5 certificates can be issued per exact same set of identifiers every 7 days**."
  * "A single certificate can include up to **100 identifiers** (DNS names or IP addresses) …"
  * "Up to **300 new orders can be created by a single account every 3 hours**."
  (URL: https://letsencrypt.org/docs/rate-limits/)
  The registered domain here is `malarstrom.com`. Option (i) would consume one of the 50 weekly
  certificates **per branch per issuance**; option (ii) consumes one per project, and re-requests of
  the *same* identifier set are capped at 5 per 7 days (which Traefik's certificate storage
  normally avoids by reusing the stored certificate).

**Concrete router configuration (option ii):**

```yaml
http:
  routers:
    alpha-feature-login:
      rule: "Host(`feature-login.alpha.home.malarstrom.com`)"
      service: alpha-feature-login
      middlewares: [alpha-feature-login-target@http]
      tls:
        certResolver: myresolver                 # ← the resolver name from the checklist
        domains:
          - main: "*.alpha.home.malarstrom.com" # ← one certificate per project
```

Router keys: `tls` ("TLS configuration for the router. When specified, the router will only handle
HTTPS requests."), `tls.certResolver` ("The name of the certificate resolver to use for automatic
certificate generation."), `tls.domains` with `main` / `sans`
(URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/).

**Residual risk:** every branch of a project asks for the *same* identifier set, so a misbehaving
resolver that discards its stored certificate could hit the "5 per exact set of identifiers every
7 days" limit. Traefik stores certificates (`acme.storage`) and reuses them, so this should not
occur; it is recorded as a risk to monitor.

---

## 8. What the user sees: the index is primary, the dashboard is optional (D4)

The feature the user actually asked for is "see what the agents are running". The **registry knows
every registration**, so it renders that view itself:

| Field | Source |
| --- | --- |
| project | the registration |
| branch | the registration |
| FQDN | derived (`<branch>.<project>.home.malarstrom.com`) |
| dev port | the registration |
| relay port / target | the registration |
| up / down | the registry probes the dev server (or the relay reports it) |

The **Traefik dashboard is optional** and not required by anything above. Its facts, with citations
(URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/):

* "api — Enable api/dashboard. When set to true, its sub option api.dashboard is also set to true.
  — `false`"
* "api.dashboard — Enable dashboard. — `true`"
* "api.insecure — Enable the API and the dashboard on the entryPoint named traefik. Please note that
  this mode is incompatible with the custom API base path option. — `false`"
* "Security — Enabling the API and the dashboard in production is not recommended, because it will
  expose all configuration elements, including sensitive data, for which access should be reserved
  to administrators. In production, it should be at least secured by authentication and
  authorizations."
* "It's recommended to NOT publicly exposing the API's port, keeping it restricted to internal
  networks (as in the principle of least privilege, applied to networks)."
* "The dashboard is available by default on the path `/dashboard/`. Note: The trailing slash `/` in
  `/dashboard/` is mandatory."

And the endpoints an index could cross-check against: "/api/http/routers — Lists all the HTTP
routers information.", "/api/http/services — Lists all the HTTP services information.",
"/api/overview — Returns statistic information about HTTP, TCP and about enabled features and
providers."

**Recommendation:** keep the dashboard **disabled** (or enabled only on an internal entryPoint with
middleware protection); the registry index is the user-facing view and is reachable only from the
Docker network — with the shared secret in `providers.http.headers` ("Defines custom headers to be
sent to the endpoint.") if the HTTP provider is used to carry it.

The Traefik API is **not** a configuration channel: "All the following endpoints must be accessed
with a GET HTTP request."

---

## 9. Assumption list (the grill target)

| # | Assumption | Settled by |
| --- | --- | --- |
| A1 | File provider can read a **directory** | `providers.file.directory` |
| A2 | File provider reloads **without restart** | `providers.file.watch` |
| A3 | File provider is safe on a **bind-mounted** dir | file-provider "Limitations" (fsnotify) |
| A4 | Config can be delivered over **HTTP** by polling | `providers.http.endpoint`, `pollInterval`, `pollTimeout` |
| A5 | The HTTP provider can be **authenticated** | `providers.http.headers`, `providers.http.tls.*` |
| A6 | Docker provider can route to an **unpublished** port | Docker provider "Port Detection" |
| A7 | Docker provider needs the **docker socket** | `providers.docker.endpoint`, "Docker API Access" |
| A8 | Docker provider exposes **everything** by default | `providers.docker.exposedByDefault` |
| A9 | Docker provider can target a **specific network** | `providers.docker.network` |
| A10 | The **Traefik API can push configuration** | api docs: GET only |
| A11 | The dashboard/API can be enabled, and where | `api`, `api.dashboard`, `api.insecure` |
| A12 | The dashboard lists routers and services | `/api/http/routers`, `/api/http/services` |
| A13 | Exposing the dashboard/API is **dangerous by default** | API & Dashboard "Security" |
| A14 | EntryPoints bind an address; routers attach | entryPoints `address`, router `entryPoints` |
| A15 | A **router serves exactly one service** | router `service` (required) |
| A16 | A service can point at a **non-container** host:port | service `url`, file-provider example |
| A17 | Image tag and **published ports** | getting-started Docker: `traefik:v3.7`, `"80:80"` |
| A18 | `Host(...)` wildcard matches **exactly one label** | rules-and-priority "Wildcard subdomain matching" |
| A19 | `Host` is preferred over `HostRegexp` | rules-and-priority |
| A20 | A **DNS wildcard** covers a multi-label prefix | RFC 1034 §4.3.3, RFC 4592 §2.2.1, live DNS |
| A21 | A closer existing name **kills** the DNS wildcard | RFC 1034 §4.3.3 |
| A22 | Industry standard for branch-scoped names | Vercel; GitLab `CI_COMMIT_REF_SLUG`; RFC 2606 |
| A23 | Only **published** ports are LAN-reachable | Docker "Published ports" |
| A24 | Publishing to **loopback** is not LAN-reachable | Docker port publishing |
| A25 | User-defined network ⇒ name/IP reachability | Docker network page |
| A26 | A `127.0.0.1`-bound process is unreachable from another container | Docker "Container networks" |
| A27 | This container can be re-created from inside | environment fact |
| A28 | The confirmed zone resolves `<branch>.<project>.home.malarstrom.com` | live public DNS |
| A29 | A **public-CA certificate** is possible at all | RFC 8555 §8.3/§8.4 + Traefik ACME docs |
| A30 | One wildcard cert covers **all branches of a project** | RFC 6125 §6.4.3 + Traefik ACME docs |
| A31 | A router can request a **wildcard domain** | router `tls.domains`, `tls.certResolver`; ACME "Domain Definition" |
| A32 | DNS-01 at Cloudflare is **available** | live NS + lego Cloudflare variables |
| A33 | The HTTP provider accepts **YAML or JSON** | http provider: "in YAML or JSON format" |
| A34 | The HTTP provider serves the **dynamic** configuration shape | http provider → "same configuration as the File Provider"; file-provider example |
| A35 | Our document does **not clobber** other providers' objects | provider namespace + precedence docs (merge itself undocumented) |
| A36 | Registration/removal visibility is bounded by `pollInterval` | `providers.http.pollInterval` = `5s` |
| A37 | **WebSockets** must survive the relay hop | Traefik "Exposing WebSocket Services" |
| A38 | **`X-Forwarded-*`** must survive the relay hop | headers middleware table |
| A39 | A per-router **header** can carry the relay dispatch signal | headers middleware `customRequestHeaders` |
| A40 | **Certificate granularity** is rate-limited | Let's Encrypt rate limits |
| A41 | The relay/registry ports are **not LAN-reachable** | Docker "Published ports" |

---

## 10. Open items

1. **The checklist in §2.2** — nine facts only the user can read from the running Traefik.
2. **Multi-provider behaviour** — the docs do not state a merge algorithm explicitly (A35); verify
   empirically with one test registration against the running Traefik before rollout.
3. **Relay implementation details** — WebSocket upgrade handling and `X-Forwarded-*` passthrough are
   the two things most likely to need iteration (§5.3); no standard exists for "a relay", so this is
   engineering, not configuration.
4. **Whether the relay should also terminate the "up/down" health signal** for the index (a registry
   probe vs. a relay-reported state) — a design choice, not a doc question.

---

## 11. Out of scope

Implementation (no Traefik install, no containers, no compose files, no service scripts) waits until
the §2.2 checklist is answered.

---

## 12. Implementation notes

Container side implemented in this repository (`src/`, `bin/`, `test/`), zero runtime dependencies,
Node 24 native TypeScript execution. Decisions of §0 are implemented as planned; the deviations are
listed below.

| Plan said | Implementation | Why |
| --- | --- | --- |
| registry endpoint `/dynamic` on port `9000`, relay on `9100` (§3, §4.1) | `/traefik` on `45002`, relay on `45001` | port and path were fixed by the task brief; both are configuration |
| middleware named `<name>-target` (§4.2) | `devhdr-<project>-<branch>-<hash>`, routers/services `dev-<project>-<branch>-<hash>`, index `dev-index` | the user's live Traefik has plain object names (`truenas`, `compress`); one prefix per object kind keeps the gateway objects collision-free. The prefix lives in one place (`src/document.ts`) |
| one process with two listeners (§5.2 D7) | one supervisor (`traefik-devd`) with two supervised workers (registry, relay) | the brief requires that a crash of one listener must not take the other down and that a crashed worker is respawned; a supervisor does that, and the relay still serves **all** registrations from one port (D7 unchanged) |
| relay trusts "the Traefik container's source address" (§5.2) | `allowedCidrs` (default `172.16.2.0/24`, the `private` Docker network) plus the loopback, and an optional shared secret header | the exact source address is not known in advance |
| TLS granularity (ii) recommended (§7.3) | implemented as the default (`tlsMode: "wildcard"`), `tlsMode: "fqdn"` selects (i) | both are needed; the wildcard keeps the Let's Encrypt budget small |
| per-FQDN router `tls: {certResolver}` (§7.3) | the same, plus `tls.domains` in wildcard mode | the user's live resolver is named `cloudflare` and uses dns-01, so wildcards are possible |
| the user's shared middlewares are not mentioned | `securityHeaders` and `compressMiddleware` (both `false` by default) add `default-security-headers@file` / `compress@file` to the dev routers | the user's live file provider owns those middlewares; `frameDeny`/`stsPreload` can break dev previews, so they are opt-in |

Traefik decodes the dynamic configuration with **paerser**, and an empty map is rejected as a
standalone element ("middlewares cannot be a standalone element (type map[string]*dynamic.Middleware)"
— `paerser/parser/nodes_metadata.go`). A section without entries must therefore be **omitted**, not
rendered as `{}`; the renderer prunes every empty map (at any depth) before serialising.

The relay's trust boundary accepts IPv4 and IPv6 CIDRs; the listeners are dual stack, and the
container's own IPv6 prefix (`fdd0:0:0:2::/64`) is derived at runtime and added to `allowedCidrs`,
because the Docker name `devbox` resolves to both an A and an AAAA record and the Traefik container
may connect over either stack.

`advertisedHost` defaults to `devbox`, the compose service name of this container on the Docker
network `private` (verified with Docker's embedded DNS: `devbox` and `devbox.private` resolve to
`172.16.2.13`, `traefik` resolves to `172.16.2.6`); it is used in the served document's service
URLs, so the container keeps its identity when it is re-created with a new IP.

Verified against the running Traefik (dashboard API, no authentication): 18 routers / 19 services /
3 middlewares before the `http` provider exists, and no name in the live configuration starts with
`dev-` or `devhdr-`.
