# Grill findings — "Traefik dev gateway" plan vs. official docs

Every row was checked against an official source that was actually fetched while writing this file
(Traefik docs, Docker docs, the RFCs, the vendors' own docs, and public DNS via Cloudflare
DoH). Traefik citations use the current docs set (`https://doc.traefik.io/traefik/reference/...`,
describing **v3.7**).

Verdict vocabulary: **AGREE** (docs support the plan), **CONTRADICT** (docs/refute the plan as
written — the plan was corrected), **RULED OUT** (the option cannot work at all), **UNDOCUMENTED**
(no official source states it — not guessed).

---

## Summary table

| # | Assumption | Verdict | Change made to the plan |
| --- | --- | --- | --- |
| A1 | File provider can read a **directory** | AGREE | adopted |
| A2 | File provider reloads **without restart** | AGREE | adopted |
| A3 | File provider is safe on a **bind-mounted** dir | CONTRADICT (caveat) | file provider demoted to alternative; HTTP provider recommended |
| A4 | Config can be delivered over **HTTP** by polling | AGREE | HTTP provider adopted as primary |
| A5 | The HTTP endpoint can be **authenticated** | AGREE | registry gets a shared-secret header (§4.1, §9) |
| A6 | Docker provider can route to an **unpublished** port | AGREE | noted; does not help (dev servers are not containers) |
| A7 | Docker provider needs the **docker socket** | AGREE | candidate C ruled out for our case |
| A8 | Docker provider exposes **everything** by default | AGREE | `exposedByDefault: false` prescribed |
| A9 | Docker provider can target a **specific network** | AGREE | recorded only |
| A10 | The **Traefik API can push configuration** | CONTRADICT | API demoted to observation-only |
| A11 | Dashboard/API can be enabled, and where | AGREE | dashboard at `/dashboard/`, `api.insecure` LAN-forbidden |
| A12 | Dashboard/API lists routers and services | AGREE | API used as cross-check for the index page |
| A13 | Exposing the dashboard/API is dangerous | AGREE | security posture §9 |
| A14 | EntryPoints bind an address; routers attach | AGREE | none |
| A15 | A **router serves exactly one service** | AGREE | **one exact-`Host` router per registration** (user-confirmed, D2) |
| A16 | A service can point at a **non-container** host:port | AGREE | backend = this container's IP + port (or relay port) |
| A17 | Image tag and published ports | AGREE | `traefik:v3.7`, publish 80/443 |
| A18 | `Host(...)` wildcard matches **one label** | AGREE | wildcard-per-project marked "one backend only" (option B) |
| A19 | `Host` preferred over `HostRegexp` | AGREE | `HostRegexp` last resort |
| A20 | A DNS wildcard covers a **multi-label** prefix | AGREE | confirmed by live DNS: `a.b.home.malarstrom.com` resolves |
| A21 | A closer existing name **kills** the DNS wildcard | AGREE | caveat stated; gateway must not create concrete names |
| A22 | Industry standard for branch-scoped names | AGREE | slug rule adopted; branch-first ordering kept (D1) |
| A23 | Only **published** ports are LAN-reachable | AGREE | candidate A requires host-side re-create |
| A24 | Publishing to **loopback** is not LAN-reachable | AGREE | publish on the LAN address |
| A25 | User-defined network ⇒ name/IP reachability | AGREE | candidate B viable; registry reachable from host |
| A26 | `127.0.0.1`-bound process is unreachable from another container | AGREE | rebind-or-relay decision (D6) |
| A27 | This container can be re-created from inside | CONTRADICT (fact) | candidate A is a host-side task |
| A28 | The confirmed zone resolves `<branch>.<project>.home.malarstrom.com` | AGREE | namespace fixed to `home.malarstrom.com` (D1) |
| A29 | A **public-CA certificate** for this zone is possible at all | AGREE (only via dns-01) | http-01 ruled out (private A record) |
| A30 | One wildcard cert covers **all branches of a project** | AGREE | TLS issuance unit = the project, not the branch |
| A31 | A router can request a **wildcard domain** | AGREE | `tls.domains.main = *.<project>.home.malarstrom.com` shown concretely |
| A32 | DNS-01 at Cloudflare is **available** | AGREE | Cloudflare token required → secret-handling decision |
| A33 | The HTTP provider accepts **YAML or JSON** | AGREE | registry serves YAML |
| A34 | The HTTP provider serves the **dynamic** configuration shape | AGREE | document shape fixed (`http.routers/services/middlewares`) |
| A35 | Our document does **not clobber** other providers' objects | AGREE (namespacing) / **UNDOCUMENTED** (merge algorithm) | registry serves only our own prefixed objects; empirical check still required |
| A36 | Registration/removal visibility is bounded by `pollInterval` | AGREE | ≤5 s propagation stated as an observable guarantee |
| A37 | **WebSockets** must survive the relay hop | AGREE | relay must implement the `Upgrade` handshake — flagged as the main risk |
| A38 | **`X-Forwarded-*`** must survive the relay hop | AGREE | relay must forward them untouched |
| A39 | A per-router **header** can carry the relay dispatch signal | AGREE | one headers middleware per registration (`customRequestHeaders`) |
| A40 | **Certificate granularity** is rate-limited | AGREE | one certificate per **project** recommended (option ii) |
| A41 | The relay/registry ports are **not LAN-reachable** | AGREE | relay binds the container address; nothing published |

---

## New findings from the fifth pass (D2–D5 made concrete)

### A33 — The HTTP provider accepts YAML or JSON — **AGREE**

> "Routing Configuration — The HTTP provider uses the same configuration as the File Provider in
> YAML or JSON format."

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/

Plan change: the registry serves **YAML** (the plan's rendering choice); JSON is equally acceptable.

### A34 — The endpoint must return the dynamic (routing) configuration document — **AGREE**

The quote above points at the file provider's structure; the file provider's own example fixes the
shape:

> "http: routers: my-router: rule: \"Host(`example.com`)\" service: my-service services:
> my-service: loadBalancer: servers: - url: \"http://localhost:8080\""

URL: https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/

and the provider categories:

> "Provider Categories — While each provider is different, you can think of each as belonging to one
> of four categories: Label-based … Key-Value-based … Annotation-based … **File-based: uses files to
> define configuration**"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/overview/

Plan change: the plan now shows the exact document the registry serves (`http.routers`,
`http.services`, `http.middlewares`, `tls.domains`/`certResolver` per router), plus the static
snippet to add to the running Traefik (`providers.http.endpoint`, `pollInterval`, `pollTimeout`,
`headers`).

### A35 — Does our document clobber other providers' configuration? — **AGREE (namespacing) / UNDOCUMENTED (merge)**

> "Provider Namespace — When you declare certain objects in the Traefik dynamic configuration, such
> as middleware, services, TLS options or server transports, they reside in their provider's
> namespace. For example, if you declare a middleware using a Docker label, it resides in the
> Docker provider namespace. If you use multiple providers and wish to reference such an object
> declared in another provider (e.g. referencing a cross-provider object like middleware), then the
> object name should be suffixed by the `@` separator, and the provider name. …
> `<resource-name>@<provider-name>`"

> "When two routers from different providers define the same rule with equal numeric priority, the
> precedence option determines which provider's route takes precedence. … Note precedence only acts
> as a tiebreaker: it is applied only when two routes from different providers share the same
> numeric priority value."

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/overview/

The docs never state a merge algorithm (the words "merge", "combine", "aggregate" do not appear in
the provider pages). What they do state implies **coexistence**: routers from different providers
are compared for priority (so they are in one routing table), and every provider's objects live in
its own namespace.

Plan change: the registry serves **only our own objects**, with distinctive names
(`alpha-feature-login`), so it cannot shadow an existing route; cross-references inside our
document use the `@http` suffix. An empirical check against the running Traefik is added to the
open items (the docs do not settle it).

### A36 — Registration/removal visibility is bounded by the poll interval — **AGREE**

> "providers.http.pollInterval — Defines the polling interval. — `5s`"
> "providers.http.pollTimeout — Defines the polling timeout when connecting to the endpoint. — `5s`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/

Plan change: stated as an observable guarantee — a registration becomes visible within ≈1 poll
interval (≈5 s), a removal likewise; the relay's own table changes immediately.

### A37 — WebSockets must survive the relay hop — **AGREE**

> "Exposing WebSocket Services — Traefik Proxy supports WebSocket (WS) and WebSocket Secure (WSS)
> connections out of the box. No special configuration is required beyond standard HTTP routing. …
> Traefik automatically detects and handles the WebSocket upgrade"

URL: https://doc.traefik.io/traefik/expose/overview/

Plan change: Traefik's side is free, but the **relay must implement the `Upgrade` handshake and
stream frames both ways**; this is named in the plan as the most likely thing to break (Vite HMR,
Next.js). It is the main engineering risk of the relay design.

### A38 — `X-Forwarded-*` must survive the relay hop — **AGREE**

> "The Headers middleware manages the headers of requests and responses. By default, the following
> headers are automatically added when proxying requests: Property / HTTP Header — Client's IP:
> `X-Forwarded-For`, `X-Real-Ip`; Host: `X-Forwarded-Host`; Port: `X-Forwarded-Port`; Protocol:
> `X-Forwarded-Proto`; Proxy Server's Hostname: `X-Forwarded-Server`"

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/headers/

Plan change: the relay must forward these headers untouched to the dev server and must not append
its own client-IP entries, so the dev server sees the original client address.

### A39 — A per-router header can carry the relay dispatch signal — **AGREE**

> "Adding and Removing Headers — In the following example, requests are proxied with an extra
> `X-Script-Name` header while their `X-Custom-Request-Header` header is removed."
> (example) `http: middlewares: testHeader: headers: customRequestHeaders: X-Script-Name: "test"`

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/headers/

Plan change: the recommended relay design (one process for all registrations) dispatches on a
per-registration header stamped by a per-router headers middleware; the relay trusts it only from
the Traefik container's source address on the Docker network (plus a shared secret).

### A40 — Certificate granularity is rate-limited — **AGREE**

> "New Certificates per Registered Domain … Limit: Up to **50 certificates can be issued per
> registered domain** (or IPv4 address, or IPv6 /64 range) **every 7 days**. This is a global
> limit, and all new order requests, regardless of which account submits them, count towards this
> limit. The ability to issue new certificates for the same registered domain refills at a rate of
> 1 certificate every 202 minutes."
> "New Certificates per Exact Set of Identifiers … Limit: Up to **5 certificates can be issued per
> exact same set of identifiers every 7 days**."
> "A single certificate can include up to **100 identifiers** (DNS names or IP addresses) depending
> on the certificate profile selected."
> "New Orders per Account … Up to **300 new orders can be created by a single account every 3
> hours**."

URL: https://letsencrypt.org/docs/rate-limits/

Plan change: the registered domain here is `malarstrom.com`, so **one certificate per FQDN**
(option i) would spend one of 50 weekly certificates per branch per issuance. The plan now
recommends **one wildcard certificate per project** (option ii): `tls.domains.main =
"*.<project>.home.malarstrom.com"` with `tls.certResolver` — one certificate covers every branch of
that project (RFC 6125 §6.4.3) and the per-project count stays far below the limit. Residual risk
recorded: repeated requests for the *same* identifier set are capped at 5 per 7 days.

### A41 — The relay and registry ports are not LAN-reachable — **AGREE**

> "Published ports — When you create or run a container using `docker create` or `docker run`, all
> ports of containers on bridge networks are accessible from the Docker host and other containers
> connected to the same network. Ports are not accessible from outside the host or, with the default
> configuration, from containers in other networks."

URL: https://docs.docker.com/engine/network/

Plan change: the relay and the registry bind this container's Docker-network address and are **not
published** on the host, so they are reachable only from the host and the Docker network — the LAN
cannot reach them. The relay's dispatch header is additionally accepted only from the Traefik
container's source address.

---

## Detailed findings

### A1 — v3 file provider can read a directory of files — **AGREE**

> "providers.file.directory — Defines the path to the directory that contains the configuration
> files. The filename and directory options are mutually exclusive. It is recommended to use
> `directory`."
> "providers.file.filename — Defines the path to the configuration file. — `""` — Yes"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/

### A2 — File provider picks up changes without a restart — **AGREE**

> "providers.file.watch — Set the watch option to true to allow Traefik to automatically watch for
> file changes. It works with both the filename and the directory options. — `true`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/

### A3 — File provider is reliable on a bind-mounted directory — **CONTRADICT (caveat)**

> "With the file provider, Traefik listens for file system notifications to update the dynamic
> configuration. If you use a mounted/bound file system in your orchestrator (like docker or
> kubernetes), the way the files are linked may be a source of issue."
> "As it is very difficult to listen to all file system notifications, Traefik uses fsnotify. If
> using a directory with a mounted directory does not fix your issue, please check your file system
> compatibility with fsnotify."

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/

Plan change: the recommended channel became the **HTTP provider**; the file provider is kept as the
"most literal atomicity" alternative with this caveat written into the option text.

### A4 — Dynamic configuration can be delivered over HTTP by polling — **AGREE**

> "providers.http.endpoint — Defines the HTTP(S) endpoint to poll. — `""` — Yes"
> "providers.http.pollInterval — Defines the polling interval. — `5s`"
> "providers.http.pollTimeout — Defines the polling timeout when connecting to the endpoint. — `5s`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/

### A5 — The HTTP endpoint can be authenticated / secured — **AGREE**

> "providers.http.headers — Defines custom headers to be sent to the endpoint. — `{}`"
> "providers.http.tls.ca — Defines the certificate authority used for the secure connection to the
> endpoint, it defaults to the system bundle."
> "providers.http.tls.insecureSkipVerify — Instructs the provider to accept any certificate
> presented by endpoint when establishing a TLS connection, regardless of the hostnames the
> certificate covers. — `false`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/

Plan change: the registry endpoint requires a shared secret carried in `providers.http.headers` and
stays on the Docker network (§4.1).

### A6 — Docker provider can route to a container port that is not published — **AGREE**

> "Port Detection — Traefik retrieves the private IP and port of containers from the Docker API."
> "If a container does not expose any port, or the selection from multiple ports does not fit, then
> you must manually specify which port Traefik should use for communication by using the label
> `traefik.http.services.<service_name>.loadbalancer.server.port`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

Plan change: recorded, but it does not help this project — the dev servers are plain processes, so
the Docker provider never sees them.

### A7 — Docker provider needs the docker socket — **AGREE**

> "Docker API Access — Traefik requires access to the docker socket to get its dynamic
> configuration. You can specify which Docker API Endpoint to use with the directive `endpoint`."
> "providers.docker.endpoint — Specifies the Docker API endpoint. — `unix:///var/run/docker.sock`"
> "Security Note — Accessing the Docker API without any restriction is a security concern: If
> Traefik is attacked, then the attacker might get access to the underlying host."

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

Plan change: **Candidate C ruled out**; this container has no `/var/run/docker.sock` (§2 of the
plan).

### A8 — Docker provider exposes everything by default — **AGREE**

> "providers.docker.exposedByDefault — Expose containers by default through Traefik. If set to
> false, containers that do not have a `traefik.enable=true` label are ignored from the resulting
> routing configuration. — `true`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

### A9 — Docker provider can target a specific network — **AGREE**

> "providers.docker.network — Defines a default docker network to use for connections to all
> containers. This option can be overridden on a per-container basis with the
> `traefik.docker.network` label. — `""`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

### A10 — The Traefik API can be used to push configuration — **CONTRADICT**

> "Endpoints — All the following endpoints must be accessed with a GET HTTP request."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

> "Depending on your environment and preferences, there are several ways to supply this routing
> configuration: File or Structured Provider: Use TOML or YAML files. Docker and ECS Providers: Use
> container labels. Kubernetes Providers: Use annotations. KV Providers: Use key-value pairs. Other
> Providers (Consul, Nomad, etc.): Use tags."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/

Plan change: `api@traefik.io` removed from the configuration channels; it is now observation-only.

### A11 — The dashboard/API can be enabled, and where it is served — **AGREE**

> "api — Enable api/dashboard. When set to true, its sub option api.dashboard is also set to true.
> — `false`"
> "api.dashboard — Enable dashboard. — `true`"
> "api.insecure — Enable the API and the dashboard on the entryPoint named traefik. Please note that
> this mode is incompatible with the custom API base path option. — `false`"
> "The dashboard is available by default on the path `/dashboard/`. Note: The trailing slash `/` in
> `/dashboard/` is mandatory."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

### A12 — The dashboard/API lists routers and services — **AGREE**

> "/api/http/routers — Lists all the HTTP routers information."
> "/api/http/services — Lists all the HTTP services information."
> "/api/overview — Returns statistic information about HTTP, TCP and about enabled features and
> providers."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

Plan change: used as the cross-check for the overview/index page (§8 of the plan).

### A13 — Exposing the dashboard/API is dangerous by default — **AGREE**

> "Security — Enabling the API and the dashboard in production is not recommended, because it will
> expose all configuration elements, including sensitive data, for which access should be reserved
> to administrators. In production, it should be at least secured by authentication and
> authorizations."
> "It's recommended to NOT publicly exposing the API's port, keeping it restricted to internal
> networks (as in the principle of least privilege, applied to networks)."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

> "Port 8080 serves the dashboard because we enabled `--api.insecure=true` (development use only)"
> "Because we explicitly enabled insecure mode, the dashboard is reachable on port 8080 without
> authentication. Do not enable this flag in production."

URL: https://doc.traefik.io/traefik/getting-started/docker/

### A14 — EntryPoints bind an address/port and routers attach to them — **AGREE**

> "address — Define the port, and optionally the hostname, on which to listen for incoming
> connections and packets. … The format is: `[host]:port[/tcp|/udp]` — Yes"
> "In the Helm Chart, the entryPoints web (port 80), websecure (port 443), traefik (port 8080) and
> metrics (port 9100) are created by default."

URL: https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/

> "entryPoints — The list of entry points to which the router is attached. If not specified, HTTP
> routers are attached to all entry points."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/

### A15 — A router serves exactly one service — **AGREE**

> "service — The name of the service that will handle the matched requests. Services can be load
> balancer services, weighted round robin, mirroring, or failover services. — Yes (required)"
> "If the rule is verified, the router becomes active, calls middlewares, and then forwards the
> request to the service."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/

Plan change: the plan now presents the three strategies explicitly (A exact-Host router per
registration / B wildcard router per project with a branch-aware dispatcher / C `HostRegexp`) and
records the user's confirmation of **A** (D2): one router + one service per registration, added
and removed atomically, without touching any other registration.

### A16 — A service can point at a host:port that is not a container — **AGREE**

> "url — Points to a specific instance. — Yes for File provider, No for Docker provider"

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/service/

> "http: routers: my-router: rule: \"Host(`example.com`)\" service: my-service services:
> my-service: loadBalancer: servers: - url: \"http://localhost:8080\""

URL: https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/

Plan change: the backend is a plain URL to this container's address and the registered port (or the
relay port of D6).

### A17 — Image tag and published ports — **AGREE**

> "# docker-compose.yml services: traefik: image: traefik:v3.7 command: - \"--api.insecure=true\"
> - \"--providers.docker=true\" - \"--entrypoints.web.address=:80\" ports: - \"80:80\" - \"8080:8080\"
> volumes: - /var/run/docker.sock:/var/run/docker.sock"

URL: https://doc.traefik.io/traefik/getting-started/docker/

### A18 — `Host(...)` wildcard matches exactly one label — **AGREE**

> "The `Host` matcher supports a single-level wildcard prefix (`*.example.com`) to match any direct
> subdomain of `example.com`. It should be preferred over the `HostRegexp` matcher as it allows
> attaching a TLS option and is more efficient."
> "A wildcard matches exactly one subdomain label: `*.example.com` matches `foo.example.com` but not
> `foo.bar.example.com` or `example.com` itself."
> "This is only available with the v3 rule syntax (the default)."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/

Plan change: `Host(`*.home.malarstrom.com`)` is explicitly ruled out for the two-label shape;
`Host(`*.<project>.home.malarstrom.com`)` (option B) is the only Traefik wildcard that could work,
and it needs a branch-aware dispatcher because one router = one service.

### A19 — `Host` is preferred over `HostRegexp` — **AGREE**

> "It should be preferred over the `HostRegexp` matcher as it allows attaching a TLS option and is
> more efficient."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/

### A20 — A DNS wildcard covers a multi-label prefix — **AGREE** (confirmed by live DNS)

> "The owner name of the wildcard RRs is of the form \"*.<anydomain>\", where `<anydomain>` is any
> domain name. … The wildcards potentially apply to descendants of `<anydomain>`, but not to
> `<anydomain>` itself."
> "Another way to look at this is that the \"*\" label always matches at least one whole label and
> sometimes more, but always whole labels."

URL: https://www.rfc-editor.org/rfc/rfc1034#section-4.3.3

> "QNAME=foo.bar.example. QTYPE=TXT, QCLASS=IN — the answer will be \"foo.bar.example. IN TXT ...\"
> because bar.example. does not exist, but the wildcard does."

URL: https://www.rfc-editor.org/rfc/rfc4592#section-2.2.1

Live check (Cloudflare DoH, public resolvers), re-verified while writing this file:

| Query | Answer |
| --- | --- |
| `malarstrom.com NS` | `dan.ns.cloudflare.com.`, `isla.ns.cloudflare.com.` |
| `home.malarstrom.com A` | `10.10.1.50` (TTL 300) — private RFC 1918 address |
| `x.home.malarstrom.com A` | CNAME `home.malarstrom.com.` → `10.10.1.50` |
| `a.b.home.malarstrom.com A` | CNAME `home.malarstrom.com.` → `10.10.1.50` |
| `*.home.malarstrom.com CNAME` | `home.malarstrom.com.` |

Plan change: the user's **single** CNAME wildcard covers the whole namespace at arbitrary depth —
no per-project or per-branch DNS record is needed (§1.2 of the plan).

### A21 — A closer existing name kills the DNS wildcard — **AGREE**

> "Wildcard RRs do not apply: - When the query is in another zone. That is, delegation cancels the
> wildcard defaults. - When the query name or a name between the wildcard domain and the query name
> is know[n] to exist. For example, if a wildcard RR has an owner name of \"*.X\", and the zone also
> contains RRs attached to B.X, the wildcards would apply to queries for name Z.X (presuming there
> is no explicit information for Z.X), but not to B.X, A.B.X, or X."

URL: https://www.rfc-editor.org/rfc/rfc1034#section-4.3.3

Plan change: stated as a caveat; the gateway must not create concrete names under
`home.malarstrom.com`.

### A22 — Industry standard for branch-scoped hostnames — **AGREE**

> "The URL generated from a Git branch will always show you the most recent changes for the branch
> and won't change if you push new commits to the branch."
> URL structure: `<project-name>-git-<branch-name>-<scope-slug>.vercel.app`
> (commit URL structure: `<project-name>-<unique-hash>-<scope-slug>.vercel.app`)

URL: https://vercel.com/docs/deployments/generated-urls

> "CI_COMMIT_REF_SLUG — CI_COMMIT_REF_NAME in lowercase, shortened to 63 bytes, and with everything
> except 0-9 and a-z replaced with `-`. No leading / trailing `-`. Use in URLs, host names and
> domain names."

URL: https://docs.gitlab.com/ci/variables/predefined_variables/

> "To safely satisfy these needs, four domain names are reserved as listed and described below.
> `.test` `.example` `.invalid` `.localhost` — \".test\" is recommended for use in testing of current
> or new DNS related code. \".example\" is recommended for use in documentation or as examples. …
> The \".localhost\" TLD has traditionally been statically defined in host DNS implementations as
> having an A record pointing to the loop back IP address and is reserved for such use."

URL: https://www.rfc-editor.org/rfc/rfc2606

Plan change: the slug rule is adopted for the branch and project labels; the confirmed branch-first
ordering (D1) differs from Vercel's project-first ordering and is recorded as a deliberate
difference. RFC 2606's reserved names do not apply (the confirmed zone is a real public zone).

Not cited: the GitLab review-apps page returned HTTP 403 to a plain fetch.

### A23 — Only published ports are LAN-reachable — **AGREE**

> "Published ports — When you create or run a container using `docker create` or `docker run`, all
> ports of containers on bridge networks are accessible from the Docker host and other containers
> connected to the same network. Ports are not accessible from outside the host or, with the
> default configuration, from containers in other networks. Use the `--publish` or `-p` flag to make
> a port available outside the host, and to containers in other bridge networks."

URL: https://docs.docker.com/engine/network/

> "Published container ports are mapped to host IP addresses."

URL: https://docs.docker.com/engine/network/port-publishing/

### A24 — Publishing to loopback is not LAN-reachable — **AGREE**

> "If you include the localhost IP address (127.0.0.1, or ::1) with the publish flag, only the
> Docker host can access the published container port."
> "In nat mode network, publishing a port to an address on the loopback interface means remote
> hosts cannot access it."
> "In nat and nat-unprotected modes, containers in other bridge networks can only access published
> ports via the host addresses they are published to."

URL: https://docs.docker.com/engine/network/port-publishing/

### A25 — User-defined network gives name/IP reachability — **AGREE**

> "Once connected to a user-defined network, containers can communicate with each other using
> container IP addresses or container names."
> "With the default configuration, containers attached to the default bridge network have
> unrestricted network access to each other using container IP addresses. They cannot refer to each
> other by name."
> "DNS services — Containers that attach to a custom network use Docker's embedded DNS server. …
> The embedded DNS server address is 127.0.0.11."

URL: https://docs.docker.com/engine/network/

Plan change: candidate B is viable, and the registry inside this container is reachable by the
Traefik container and from the host.

### A26 — A `127.0.0.1`-bound process is unreachable from another container — **AGREE**

> "Container networks — In addition to user-defined networks, you can attach a container to another
> container's networking stack directly, using the `--network container:<name|id>` flag format. …
> The following example runs a Redis container, with Redis binding to 127.0.0.1, then running the
> `redis-cli` command and connecting to the Redis server over 127.0.0.1."

URL: https://docs.docker.com/engine/network/

Plan change: decision D6 offers rebind (i), relay (ii) and namespace sharing (iii), each with the
host-side work it requires and what it breaks.

### A27 — This container can be re-created from inside — **CONTRADICT (environment fact)**

Observed: `ls -la /var/run/docker.sock` → "No such file or directory"; `docker info` → "docker:
command not found"; `which traefik` → not found.

### A28 — The confirmed zone resolves `<branch>.<project>.home.malarstrom.com` — **AGREE**

Live DNS (§A20 table): `*.home.malarstrom.com` is a **CNAME** to `home.malarstrom.com`, and
`a.b.home.malarstrom.com` already resolves to `10.10.1.50`. Combined with RFC 1034 §4.3.3 ("the
\"*\" label always matches at least one whole label and sometimes more, but always whole labels")
and RFC 4592 §2.2.1, the two-label prefix `<branch>.<project>` is covered by the user's single
record.

Plan change: the namespace is fixed to `<branch>.<project>.home.malarstrom.com` (D1); the two
placeholder layouts (`example.test`, `apps.example.test`) were removed.

### A29 — A public-CA certificate for this zone is possible at all — **AGREE, but only via dns-01**

> "With HTTP validation, the client in an ACME transaction proves its control over a domain name by
> proving that it can provision HTTP resources on a server accessible under that domain name. …
> the server will connect to at least one of the hosts found in the DNS A and AAAA records"

URL: https://www.rfc-editor.org/rfc/rfc8555#section-8.3

The zone's only A record is `10.10.1.50` — not reachable from the internet — so **http-01 can
never succeed** for this zone.

> "When the identifier being validated is a domain name, the client can prove control over that
> domain by provisioning a TXT resource record containing a designated value for a specific
> validation domain name. … The client constructs the validation domain name by prepending the
> label \"_acme-challenge\" to the domain name being validated"

URL: https://www.rfc-editor.org/rfc/rfc8555#section-8.4

Traefik agrees:

> "The DNS-01 challenge to generate and renew ACME certificates by provisioning a DNS record.
> Traefik relies internally on Lego for ACME."
> "ACME v2 supports wildcard certificates. As described in Let's Encrypt's post wildcard certificates
> can only be generated through a DNS-01 challenge. **It is not possible to request a double
> wildcard certificate for a domain (for example `*.*.local.com`).**"

URL: https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/

Plan change: TLS option (b) is defined as dns-01 only; option (a) plain HTTP stays first.

### A30 — One wildcard certificate covers all branches of a project — **AGREE**

> "If the wildcard character is the only character of the left-most label in the presented
> identifier, the client SHOULD NOT compare against anything but the left-most label of the
> reference identifier (e.g., `*.example.com` would match `foo.example.com` but not
> `bar.foo.example.com` or `example.com`)."

URL: https://www.rfc-editor.org/rfc/rfc6125#section-6.4.3

So `*.home.malarstrom.com` does **not** cover `<branch>.<project>.home.malarstrom.com`, but
`*.<project>.home.malarstrom.com` covers **every** branch of that project.

Plan change: **the TLS unit of issuance is the project, not the branch** — exactly the user's
"project owns a label" model. One certificate per project suffices (§7.2 of the plan).

### A31 — A router can request a wildcard domain for its certificate — **AGREE**

Router keys (router docs): `tls` ("TLS configuration for the router. When specified, the router will
only handle HTTPS requests."), `tls.certResolver` ("The name of the certificate resolver to use for
automatic certificate generation."), and the router example

> "tls: certResolver: \"letsencrypt\" options: \"modern\" domains: - main: \"example.com\" sans: -
> \"www.example.com\""

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/

Resolver behaviour (ACME docs):

> "A certificate resolver requests certificates for a set of domain names inferred from routers …
> You can set SANs (alternative domains) for each main domain. Every domain must have A/AAAA records
> pointing to Traefik. Each domain & SAN will lead to a certificate request."

> "acme.dnsChallenge — Enable DNS-01 challenge. … acme.dnsChallenge.provider — DNS provider to use.
> — \"\" — No … acme.dnsChallenge.resolvers — DNS servers to resolve the FQDN authority. — []"

URL: https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/

Plan change: the plan now shows the concrete configuration — router `tls.domains.main =
*.<project>.home.malarstrom.com` plus `tls.certResolver`, and the resolver with
`acme.dnsChallenge.provider: cloudflare`.

### A32 — DNS-01 at Cloudflare is available for this zone — **AGREE**

Live DNS: `malarstrom.com NS` → `dan.ns.cloudflare.com.`, `isla.ns.cloudflare.com.` — the zone is
served by Cloudflare, whose DNS API is what a DNS-01 challenge needs.

Traefik's ACME page points at the Lego provider list: "You can find the list of all the supported
DNS providers in their documentation with instructions about which environment variables need to be
setup." The Cloudflare provider's variables:

> "CF_API_EMAIL — Account email · CF_API_KEY — API key · **CF_DNS_API_TOKEN — API token with
> DNS:Edit permission (since v3.1.0)** · CF_ZONE_API_TOKEN — API token with Zone:Read permission
> (since v3.1.0)" (plus `CLOUDFLARE_*` aliases; "The environment variable names can be suffixed by
> `_FILE` to reference a file instead of a value.")

URL: https://go-acme.github.io/lego/dns/cloudflare/

Plan change: the Cloudflare API token (DNS:Edit) becomes an explicit secret-handling decision for
the user (§11.4).

---

## Facts that no official doc settles (recorded as "undocumented", not guessed)

1. A **`rest` provider** appears in the v3.7 default provider-precedence list
   (https://doc.traefik.io/traefik/reference/install-configuration/providers/overview/), but no
   documentation page for it exists under
   `/reference/install-configuration/providers/others/rest/` (HTTP 404). It is therefore **not**
   considered as a configuration channel.
2. The GitLab **review-apps** page returned HTTP 403 to a plain fetch — not cited; the GitLab
   *predefined variables* page was fetched and is cited for the slug rule only.
3. Whether the ACME server would accept a **certificate for a private-IP-only name**: RFC 8555
   §8.3 requires an internet-reachable server for http-01, and dns-01 does not, so a dns-01-issued
   certificate is technically obtainable — but the CA's own policy on the name is outside the
   documentation read here. Marked as a residual risk of the dns-01 option.
4. **How Traefik combines the configuration of several providers**: the docs state per-provider
   namespacing and cross-provider precedence, but never describe a merge algorithm. Recorded as
   A35 / plan open item — verify empirically with one test registration.
5. Whether the running Traefik already serves a **dynamic configuration file** that would interact
   with ours — only the user can answer (plan checklist §2.2).

*Previously flagged as undocumented and now closed:* wildcard-certificate support in Traefik — it
**is** documented ("ACME v2 supports wildcard certificates…", `tls.domains.main`,
`tls.certResolver`), see A30/A31.
