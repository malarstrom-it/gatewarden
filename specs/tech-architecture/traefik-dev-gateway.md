# Traefik Dev Gateway — architecture plan (under review)

Status: **plan only**. Nothing here is implemented. Every technical claim that carries a decision is
backed by an official source; the citation table and verdicts live in
[`grill-findings.md`](./grill-findings.md).

Traefik documentation is cited at `https://doc.traefik.io/traefik/reference/...` (the current docs
set, describing **Traefik v3.7**). Note that the older `docs.traefik.io` alias is only partly
usable: `docs.traefik.io/traefik/<path>` redirects to `doc.traefik.io/traefik/traefik/<path>`, which
404s for some pages — so citations use the canonical `doc.traefik.io` paths that were fetched.

---

## 0. Decisions already taken

| # | Decision | Status |
| --- | --- | --- |
| D1 | Namespace zone and FQDN template: **`<branch>.<project>.home.malarstrom.com`** | **Confirmed by the user** |
| D2 | One exact-`Host` router + one service **per registration**, added and removed atomically | **Confirmed by the user** |
| D3 | TLS design | **Closed with citations** (§7): HTTP-01 impossible, DNS-01 per project, or plain HTTP / internal CA |
| D4 | Where Traefik runs | **Open** (§11.1) |
| D5 | How dynamic configuration reaches Traefik | **Open** (§11.2) — recommended: HTTP provider + registry |
| D6 | How dev servers become reachable | **Open** (§11.3) — recommended: rebind `0.0.0.0` |
| D7 | Dashboard / API exposure | **Open** (§11.4) |

---

## 1. Problem statement

This container runs AI coding agents. Each project an agent creates runs its dev server on
`127.0.0.1:PORT` **inside this container**. The user sits on the same network as the host machine
that runs this container and cannot reach those ports: from the user's laptop the dev servers are
invisible.

The gateway must

1. let the user **click a URL** and reach the dev server an agent is running,
2. let a project **register and withdraw** its dev server **at runtime, independently** of other
   projects (atomic registrations — D2),
3. give the user an **overview of everything the agents currently run**.

### 1.1 Confirmed namespace (D1)

```
<branch>.<project>.home.malarstrom.com
```

* `<branch>` — leftmost label, the branch of the dev lifecycle, DNS-safe slug.
* `<project>` — the project's own primary prefix label, directly left of `home`. The user counts it
  from the right: `com`(1) `malarstrom`(2) `home`(3) **`project`(4)**. So a project's namespace is
  `<project>.home.malarstrom.com` and the branch label sits in front of it.
* `home.malarstrom.com` — the fixed suffix; the user's wildcard record is
  `*.home.malarstrom.com`.

The FQDN template stays configurable (`fqdn_template = "{branch}.{project}.{zone}"` with
`zone = home.malarstrom.com`), so the project-label position is a parameter, not a hard-coded
constant — but the **confirmed** shape is the one above.

### 1.2 Live DNS evidence (checked fact)

Queried through Cloudflare's DNS-over-HTTPS resolver
(`https://cloudflare-dns.com/dns-query`, i.e. genuinely public DNS, not the container resolver) and
re-verified while writing this plan:

| Query | Answer |
| --- | --- |
| `malarstrom.com NS` | `dan.ns.cloudflare.com.`, `isla.ns.cloudflare.com.` — the zone is hosted on Cloudflare |
| `home.malarstrom.com A` | `10.10.1.50` (TTL 300) — a **private, RFC 1918** address |
| `x.home.malarstrom.com A` | CNAME `home.malarstrom.com.` → `10.10.1.50` |
| `a.b.home.malarstrom.com A` | CNAME `home.malarstrom.com.` → `10.10.1.50` |
| `*.home.malarstrom.com CNAME` | `home.malarstrom.com.` |

Two consequences the plan must preserve:

1. **The wildcard is a CNAME and resolves at arbitrary depth.** `a.b.home.malarstrom.com` already
   resolves, so `<branch>.<project>.home.malarstrom.com` resolves through the user's **single**
   record. This is the RFC 4592 §2.2.1 behaviour — "the wildcard does" apply when no closer name
   exists — and RFC 1034 §4.3.3: "the \"*\" label always matches at least one whole label and
   sometimes more, but always whole labels". **The user needs no new DNS records per project or
   per branch.**
2. **Public DNS names, private payload.** The names are publicly enumerable (anyone can query
   `anything.home.malarstrom.com` and learn it resolves to `10.10.1.50`), but `10.10.1.50` is not
   internet-routable — the traffic is only reachable from networks that route that address (the
   user's LAN/VPN). The plan must therefore keep the Traefik entryPoints and the dashboard/API
   bound to the LAN/VPN address only, and must **not** expose `api.insecure` or the registry
   endpoint to the internet.

Caveat carried over from RFC 1034 §4.3.3: a concrete name existing between the wildcard and the
query name disables the wildcard ("Wildcard RRs do not apply: … When the query name or a name
between the wildcard domain and the query name is known to exist" — delegation cancels the
wildcard defaults). The gateway must not create concrete names under `home.malarstrom.com`.

---

## 2. Environment facts (read-only inspection)

Gathered with `ip`, `ss`, `cat`, `ls`, `which`, `curl`. Nothing was changed.

| Fact | Value | How observed |
| --- | --- | --- |
| Interfaces | `lo` 127.0.0.1/8, `eth0` 172.16.2.13/24 | `ip -o addr` |
| Default route | `default via 172.16.2.1 dev eth0` | `ip route` |
| Docker resolver | `/etc/resolv.conf` → `nameserver 127.0.0.11`, `# Generated by Docker Engine.` | `cat /etc/resolv.conf` |
| Network type | **custom / user-defined Docker network** — Docker: "Containers that attach to a custom network use Docker's embedded DNS server. The embedded DNS server address is 127.0.0.11." | Docker docs + `/etc/resolv.conf` |
| Subnet / gateway | container `172.16.2.13`, gateway `172.16.2.1`, subnet `172.16.2.0/24` | `ip addr` / `ip route` |
| Listening TCP | `0.0.0.0:2222` (sshd), `127.0.0.11:46501` (Docker DNS), `0.0.0.0:7683` (node, pid 140) | `ss -ltnp` |
| Dev servers | none running now; agents bind `127.0.0.1:PORT` | task statement |
| Docker socket | **absent** (`/var/run/docker.sock` → No such file or directory) | `ls -la` |
| Binaries | `docker`: not found · `traefik`: not found · `curl`, `wget`, `python3` present | `which` |
| Outbound HTTPS | works (`docs.traefik.io` → 301 → `doc.traefik.io`; `docs.docker.com` → 200) | `curl -I` |
| User's LAN target | `home.malarstrom.com` → `10.10.1.50` (the host machine as seen by the LAN/VPN) | public DNS (§1.2) |

**Consequences:**

* This container **cannot be re-created from inside** (no socket, no Docker CLI) → anything needing
  new published ports on *this* container is a **host-side task**.
* It **is** on a user-defined Docker network → a second container on that network can reach it by
  name/IP, and the registry inside it is reachable from the host and from the Docker network.
* A dev server bound to `127.0.0.1` inside this container is **not** reachable from another
  container — loopback is per-container.

---

## 3. Candidate architectures

### Candidate A — Traefik runs inside this container

*Needs new published ports on this container.* Publishing is a create-time property: "Published
container ports are mapped to host IP addresses."; "Use the `--publish` or `-p` flag to make a port
available outside the host, and to containers in other bridge networks."; publishing to loopback is
LAN-invisible ("If you include the localhost IP address (127.0.0.1, or ::1) with the publish flag,
only the Docker host can access the published container port.").

**Verdict: host-side task, cannot be done from inside.** The user must re-create the container on
the host with `-p 80:80 -p 443:443` bound to the LAN address. Also note: no `traefik` binary exists
here, and nothing may be installed by this task.

### Candidate B — Traefik as a separate container on the same user-defined network ← **recommended**

The host creates one more container (`traefik:v3.7`) on the same network and publishes `80`/`443`
on the LAN address.

* Traefik reaches this container by name or IP: "Once connected to a user-defined network,
  containers can communicate with each other using container IP addresses or container names."
* The user reaches Traefik through the host's published ports — publishing works, and this container
  never has to be re-created.
* **Loopback caveat (decisive):** a dev server bound to `127.0.0.1` here is invisible to Traefik in
  another container ⇒ §11.3.
* Traefik's own ports: the documented quick start publishes `"80:80"` and `"8080:8080"` with image
  `traefik:v3.7`; the Helm chart defaults are "the entryPoints web (port 80), websecure (port 443),
  traefik (port 8080) and metrics (port 9100)".

### Candidate C — Traefik on the host with the Docker provider

**Verdict: ruled out for the dev-server routing job.** The provider only sees containers: "Traefik
retrieves the private IP and port of containers from the Docker API."; "Traefik requires access to
the docker socket to get its dynamic configuration." The dev servers are plain processes inside one
container — no labels, never in the Docker API. It would only work if every dev server became its
own labelled container.

Its defaults are also a security lesson: `providers.docker.exposedByDefault` defaults to **true**
("Expose containers by default through Traefik").

---

## 4. How dynamic configuration reaches Traefik

| Option | Mechanism | Fits this topology? |
| --- | --- | --- |
| **File provider** | `providers.file.directory` — "Defines the path to the directory that contains the configuration files. The filename and directory options are mutually exclusive. It is recommended to use `directory`." `providers.file.watch` defaults to `true` | Needs a **shared path** between this container and the Traefik container ⇒ host-side bind/volume. Documented caveat: "With the file provider, Traefik listens for file system notifications to update the dynamic configuration. If you use a mounted/bound file system in your orchestrator (like docker or kubernetes), the way the files are linked may be a source of issue." |
| **HTTP provider** | `providers.http.endpoint` — "Defines the HTTP(S) endpoint to poll." (required); `pollInterval` `5s`; `pollTimeout` `5s`; `headers` `{}`; `tls.ca`; `tls.insecureSkipVerify` `false` | **Fits.** This container is already reachable by the Traefik container on the shared network. No shared mount needed. Costs: poll latency (tunable), one aggregator owning the document. Bonus: `headers` carries a shared secret. |
| **Docker labels** | `traefik.http.routers.*.rule` | Ruled out — Candidate C. |
| **Traefik API (`api@traefik.io`)** | `api`, `api.dashboard`, `api.insecure` | **Not a configuration channel.** "All the following endpoints must be accessed with a GET HTTP request." The documented channels are file, labels, annotations, KV and tags. The API is for *observing* configuration. |

**Recommendation: HTTP provider** (registry inside this container). It is immune to the documented
fsnotify/mounted-filesystem caveat, needs no shared volume (the host only creates one container),
and gives one place to authorize registrations via `providers.http.headers`.

**The file provider is the most literal reading of "each service added and removed separately"** —
one file per registration, delete the file to remove the route, no aggregation layer. Its cost is
the documented mount caveat above. If the user accepts that caveat, the file variant buys the
strongest atomicity story; the HTTP variant buys a single authority and an auth header.

### 4.1 The registry endpoint's exposure

The registry lives **inside this container** (`172.16.2.13`) and is reachable from the Docker
network and from the host. It is the **write side** of the gateway: whoever reaches it can publish
routes. Therefore it must be protected:

* network-restricted (Docker network + host only) — it must never be published to the LAN or the
  internet (§1.2);
* authenticated with a shared secret carried in `providers.http.headers` — "Defines custom headers
  to be sent to the endpoint." — so only the Traefik container can fetch the configuration;
* served over plain HTTP **inside** the Docker network is acceptable (it never leaves the host);
  `providers.http.tls.insecureSkipVerify` stays `false` and `providers.http.tls.ca` is only needed
  if the endpoint is ever exposed beyond the host.

---

## 5. The registration model (D2)

```yaml
registration = { project: alpha, branch: feature/login, devPort: 5173, fqdn: feature-login.alpha.home.malarstrom.com }
```

Derivation (all inputs are the record's own fields):

1. `project_slug` — the project's claimed prefix label (unique per project).
2. `branch_slug` — sanitised branch name (§5.2).
3. `fqdn` = `fqdn_template.format(branch=branch_slug, project=project_slug, zone=home.malarstrom.com)`.
4. `rule` = `Host(`<fqdn>`)` — **exact**.
5. `service` — one service whose backend is this container's address and `devPort`
   (`loadBalancer.servers[0].url = "http://172.16.2.13:5173"`, or the relay port of D6).
6. **Removal** = delete that registration; nothing else changes.

**One registration = one router = one service**, added and removed atomically:

* "If the rule is verified, the router becomes active, calls middlewares, and then forwards the
  request to the service." (router docs)
* "service — The name of the service that will handle the matched requests. … Yes (required)"

What "removal" means per channel:

| Channel | Add | Remove |
| --- | --- | --- |
| HTTP provider (registry) | POST/PUT the registration to the registry; the registry's rendered document gains one router + one service | the registry stops serving that router/service; the next poll drops it (≤ `pollInterval`, default `5s`) |
| File provider (`directory`) | write one file containing that router + service | delete that file; `providers.file.watch` picks it up |

In both cases a registration is removable **without touching any other registration**.

### 5.1 Routing strategies considered

* **(A) One exact-`Host` router per registration** — `Host(`feature-login.alpha.home.malarstrom.com`)`
  → one service → one port. **Chosen (D2).** Atomic; every route is individually visible in
  `/api/http/routers` and in the dashboard; one router per branch.
* **(B) One wildcard router per project** — `Host(`*.alpha.home.malarstrom.com`)` covers every
  branch of that project, but a router has **exactly one service**, so all branches would share one
  backend. It therefore needs a **branch-aware dispatcher** in front (a proxy inside this container
  that reads the `Host` header and forwards to the right local port; it must handle WebSockets and
  `X-Forwarded-*`). One router per project, but a custom proxy becomes a component you must trust
  and maintain. **Rejected** for now.
* **(C) `HostRegexp`** — only if nothing else fits; the docs say the `Host` matcher "should be
  preferred over the `HostRegexp` matcher as it allows attaching a TLS option and is more
  efficient."

**Traefik's wildcard is one label deep**, which is why (B) must be spelled `*.<project>.<zone>` and
not `*.<zone>`: "A wildcard matches exactly one subdomain label: `*.example.com` matches
`foo.example.com` but not `foo.bar.example.com` or `example.com` itself." So
`Host(`*.home.malarstrom.com`)` would **not** match `main.alpha.home.malarstrom.com`, while
`Host(`*.alpha.home.malarstrom.com`)` **does**.

### 5.2 Branch-label sanitisation

GitLab's `CI_COMMIT_REF_SLUG` is the standard rule and is used here: "CI_COMMIT_REF_NAME in
lowercase, shortened to 63 bytes, and with everything except 0-9 and a-z replaced with `-`. No
leading / trailing `-`. Use in URLs, host names and domain names." The same rule is applied to the
project label. (GitLab review apps use the same slug idea; that page returned HTTP 403 to a plain
fetch and is therefore not cited.)

### 5.3 Industry standard for the shape

Vercel: "The URL generated from a Git branch will always show you the most recent changes for the
branch and won't change if you push new commits to the branch." with URL structure
`<project-name>-git-<branch-name>-<scope-slug>.vercel.app`. The convention is **project-scoped and
branch-qualified** — the same two dimensions the user asked for; the ordering differs (Vercel puts
the project first, the user's confirmed shape puts the branch first).

For local-only names, RFC 2606 reserves `.test`, `.example`, `.invalid` and `.localhost` — the
confirmed zone is a real public zone, so those do not apply here.

---

## 6. How a project registers (end to end)

**Recommended mechanism: a registry inside this container + the HTTP provider.**

```
agent in this container
  └─ register { project, branch, devPort }        (CLI / POST to the registry)
        └─ registry stores the registration, derives fqdn, renders Traefik dynamic configuration
              (one router + one service per registration)
                  └─ Traefik polls the registry (providers.http.endpoint, pollInterval 5s)
                        └─ request to <branch>.<project>.home.malarstrom.com
                              → DNS: CNAME *.home.malarstrom.com → home.malarstrom.com → 10.10.1.50
                              → Traefik router (exact Host) → service → 127.0.0.1:<devPort> (via
                                rebind or relay, see D6)
reverse path:
  └─ unregister { project, branch }
        └─ registry drops that router + service → next poll removes the route → the URL 404s
```

**Alternative (file-provider variant).** The agent writes one YAML file per registration into the
shared watched directory; deletion removes the route. This is the most literal reading of "each
service added and removed separately" — one file ↔ one router ↔ one service — but it needs a shared
mount and inherits the documented fsnotify caveat on mounted filesystems.

**Why the registry wins:** one authority that can validate the registration (project owns its
prefix, branch slug is unique per project, port is plausible), one place to rate-limit and
authorize, one place to serve the overview index, and a shared secret in `providers.http.headers`
so only the Traefik container can pull the configuration. What it costs: an aggregation layer and
the poll latency (5 s default).

---

## 7. TLS (D3 — closed with citations)

### 7.1 http-01 is impossible here

> "With HTTP validation, the client in an ACME transaction proves its control over a domain name by
> proving that it can provision HTTP resources on a server accessible under that domain name."

URL: https://www.rfc-editor.org/rfc/rfc8555#section-8.3

The zone's A record is `10.10.1.50` — a private address the ACME server cannot reach. Therefore
**any public-CA certificate for this zone must be issued via dns-01**:

> "When the identifier being validated is a domain name, the client can prove control over that
> domain by provisioning a TXT resource record containing a designated value for a specific
> validation domain name." … "The client constructs the validation domain name by prepending the
> label \"_acme-challenge\" to the domain name being validated"

URL: https://www.rfc-editor.org/rfc/rfc8555#section-8.4

Traefik agrees: "The DNS-01 challenge to generate and renew ACME certificates by provisioning a DNS
record. Traefik relies internally on Lego for ACME." and "ACME v2 supports wildcard certificates.
As described in Let's Encrypt's post wildcard certificates can only be generated through a DNS-01
challenge. **It is not possible to request a double wildcard certificate for a domain (for example
`*.*.local.com`).**"

URL: https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/

### 7.2 A wildcard certificate covers exactly one label

> "If the wildcard character is the only character of the left-most label in the presented
> identifier, the client SHOULD NOT compare against anything but the left-most label of the
> reference identifier (e.g., `*.example.com` would match `foo.example.com` but not
> `bar.foo.example.com` or `example.com`)."

URL: https://www.rfc-editor.org/rfc/rfc6125#section-6.4.3

So a certificate for `*.home.malarstrom.com` does **not** cover
`<branch>.<project>.home.malarstrom.com`. And a double wildcard (`*.*.home.malarstrom.com`) cannot
be issued at all.

**The namespace design lines up with TLS:** a certificate for
`*.<project>.home.malarstrom.com` (one label below the project label) covers **every branch of
that project** — exactly the user's "project owns a label" model. **The TLS unit of issuance is
the project, not the branch: one certificate per project suffices.**

### 7.3 Concrete Traefik configuration

Routers declare the requested domain and the resolver; the resolver derives the domains from the
routers:

> "A certificate resolver requests certificates for a set of domain names inferred from routers …
> You can set SANs (alternative domains) for each main domain. Every domain must have A/AAAA
> records pointing to Traefik. Each domain & SAN will lead to a certificate request."

Router keys (router docs): `tls` ("TLS configuration for the router. When specified, the router will
only handle HTTPS requests."), `tls.certResolver` ("The name of the certificate resolver to use for
automatic certificate generation."), and `tls.domains` with `main` / `sans` (the router example
shows `tls: certResolver: "letsencrypt"`, `domains: - main: "example.com"`, `sans: - "www.example.com"`).

Resolver keys (ACME docs): `certificatesResolvers.<name>.acme.email`, `…acme.storage`,
`…acme.dnsChallenge.provider` ("DNS provider to use. — \"\" — No"),
`…acme.dnsChallenge.resolvers` ("DNS servers to resolve the FQDN authority. — []"),
`…acme.dnsChallenge.propagation.delayBeforeChecks` / `disableChecks` / `requireAllRNS`.

Shape of the configuration (per project):

```yaml
# static (install) configuration of the Traefik container
certificatesResolvers:
  myresolver:
    acme:
      email: <email>
      storage: /data/acme.json
      dnsChallenge:
        provider: cloudflare        # lego provider; credentials from the environment
```

```yaml
# dynamic configuration, one router per registration (rendered by the registry)
http:
  routers:
    alpha-feature-login:
      rule: "Host(`feature-login.alpha.home.malarstrom.com`)"
      service: alpha-feature-login
      tls:
        certResolver: myresolver
        domains:
          - main: "*.alpha.home.malarstrom.com"
          # sans: [ "alpha.home.malarstrom.com" ]   # optional
  services:
    alpha-feature-login:
      loadBalancer:
        servers:
          - url: "http://172.16.2.13:5173"
```

The wildcard `main` is what makes **one certificate per project** valid for all of that project's
branches (§7.2).

### 7.4 The Cloudflare credential (lego provider)

Traefik's ACME page points at Lego for the provider list: "You can find the list of all the
supported DNS providers in their documentation with instructions about which environment variables
need to be setup." The Cloudflare provider's variables:

> "CF_API_EMAIL — Account email · CF_API_KEY — API key · **CF_DNS_API_TOKEN — API token with
> DNS:Edit permission (since v3.1.0)** · CF_ZONE_API_TOKEN — API token with Zone:Read permission
> (since v3.1.0)" (plus the `CLOUDFLARE_*` aliases; values may be suffixed with `_FILE` to point at
> a file instead of a value).

URL: https://go-acme.github.io/lego/dns/cloudflare/

⇒ Whatever runs Traefik must hold a Cloudflare API token with **DNS:Edit** on the
`malarstrom.com` zone. That is a **secret-handling decision for the user** (§11.4).

### 7.5 The three honest TLS options

| Option | What it means | Cost / risk |
| --- | --- | --- |
| **(a) Plain HTTP on the LAN** | Traefik serves `http://` on `10.10.1.50:80`; the browser shows the URL without TLS | No certificate, no Cloudflare credential; the dev payload travels in clear on the LAN/VPN — acceptable for a LAN/VPN-only, throwaway dev traffic, and it is the fastest cut. Traefik's `websecure` entryPoint is simply not used. |
| **(b) One wildcard certificate per project** — `*.<project>.home.malarstrom.com`, via dns-01 at Cloudflare | Each project's routers carry `tls.certResolver` + `domains.main = *.<project>.home.malarstrom.com`; **one certificate per project covers all its branches** | Needs a Cloudflare API token with DNS:Edit inside the Traefik container (secret handling), ACME account storage, DNS-01 propagation waits, and the client's clock/trust store. Public-CA rate limits also apply to the domain. |
| **(c) Internal / private CA** | The user installs a private root in their devices; Traefik serves certificates from it | No public-CA dependency, no Cloudflare credential, works for arbitrary labels; but every client device must trust the CA (manual step, and it breaks on devices you do not control). |

**Recommendation: (a) first** (the whole point is visibility of local dev servers on a private
network), then (b) if browser TLS warnings become annoying, keeping the per-project wildcard as
the issuance unit that the namespace already anticipates.

---

## 8. How the user sees everything the agents run

1. **Traefik dashboard** — `api: true` enables it ("Enable api/dashboard. When set to true, its sub
   option api.dashboard is also set to true."; default `false`); `api.dashboard` default `true`;
   served at `/dashboard/` ("The dashboard is available by default on the path `/dashboard/`. Note:
   The trailing slash `/` in `/dashboard/` is mandatory."). `api.insecure: true` exposes it on the
   entryPoint named `traefik` — the docs' quick start uses it and warns: "Do not enable this flag
   in production."
2. **A gateway index page** — the registry knows every registration, so it can render the live list
   (project, branch, port, FQDN, link) itself. The Traefik API is the cross-check:
   `/api/http/routers` ("Lists all the HTTP routers information."), `/api/http/services`,
   `/api/overview`.

---

## 9. Security posture

* **Public names, private payload.** The names are public (§1.2); the addresses behind them are not.
  Every entryPoint must therefore be bound to the LAN/VPN address only — never to a public
  interface, and never with `api.insecure` on a LAN-reachable port.
* **Never expose the API/dashboard blindly.** "Enabling the API and the dashboard in production is
  not recommended, because it will expose all configuration elements, including sensitive data, for
  which access should be reserved to administrators." and "It's recommended to NOT publicly exposing
  the API's port, keeping it restricted to internal networks."
* **The registry endpoint is the write side** — network-restricted and authenticated (§4.1).
* **The Cloudflare token** is a secret that lives wherever Traefik runs (§7.4).
* If the Docker provider is ever added: `providers.docker.exposedByDefault: false` ("If set to
  false, containers that do not have a `traefik.enable=true` label are ignored") and remember
  "Accessing the Docker API without any restriction is a security concern".

---

## 10. Assumption list (the grill target)

| # | Assumption | Settled by |
| --- | --- | --- |
| A1 | v3 file provider can read a **directory** of files | `providers.file.directory` |
| A2 | File provider picks up changes **without a restart** | `providers.file.watch` (default `true`) |
| A3 | File provider is reliable on a **bind-mounted** directory | file-provider "Limitations" (fsnotify) |
| A4 | Dynamic config can be delivered over **HTTP** by polling | `providers.http.endpoint`, `pollInterval`, `pollTimeout` |
| A5 | The HTTP provider can be **authenticated** | `providers.http.headers`, `providers.http.tls.*` |
| A6 | The Docker provider can route to a container port that is **not published** | Docker provider "Port Detection" |
| A7 | The Docker provider needs the **docker socket** | `providers.docker.endpoint`, "Docker API Access" |
| A8 | The Docker provider would expose **everything** by default | `providers.docker.exposedByDefault` (default `true`) |
| A9 | The Docker provider can be pointed at a **specific network** | `providers.docker.network` |
| A10 | The **Traefik API can push configuration** | api docs: "All the following endpoints must be accessed with a GET HTTP request." |
| A11 | The dashboard/API can be enabled and where it is served | `api`, `api.dashboard`, `api.insecure` |
| A12 | The dashboard lists routers and services | `/api/http/routers`, `/api/http/services`, `/api/overview` |
| A13 | Exposing the dashboard/API is **dangerous by default** | API & Dashboard "Security" |
| A14 | EntryPoints bind an address/port and routers attach to them | entryPoints `address`, router `entryPoints` |
| A15 | A **router serves exactly one service** | router `service` (required) |
| A16 | A service can point at a **host:port that is not a container** | service `url`, file-provider example `url: "http://localhost:8080"` |
| A17 | Traefik's image tag and **published ports** | getting-started Docker: `traefik:v3.7`, `"80:80"`, `"8080:8080"` |
| A18 | `Host(...)` wildcard matches **exactly one label** | rules-and-priority "Wildcard subdomain matching" |
| A19 | `Host` is preferred over `HostRegexp` | rules-and-priority (TLS option + efficiency) |
| A20 | A **DNS wildcard** covers a multi-label prefix | RFC 1034 §4.3.3, RFC 4592 §2.2.1, live DoH (§1.2) |
| A21 | A **DNS wildcard** is disabled by a closer existing name | RFC 1034 §4.3.3 ("Wildcard RRs do not apply …") |
| A22 | There is an **industry standard** for branch-scoped hostnames | Vercel generated URLs; GitLab `CI_COMMIT_REF_SLUG`; RFC 2606 |
| A23 | A container's published ports are the **only** LAN-reachable ports | Docker "Published ports"; port-publishing page |
| A24 | Publishing to **loopback** is not LAN-reachable | port-publishing page ("only the Docker host can access") |
| A25 | Containers on a **user-defined network** resolve each other by name/IP | Docker network page ("User-defined networks", "DNS services") |
| A26 | A process bound to **127.0.0.1** in this container is unreachable from another container | Docker "Container networks" (`--network container:<name>` shares the namespace) |
| A27 | This container can be **re-created from inside** | environment fact: no `/var/run/docker.sock`, no `docker` binary |
| A28 | The confirmed zone resolves `<branch>.<project>.home.malarstrom.com` | live public DNS (§1.2) + RFC 1034 §4.3.3 / RFC 4592 §2.2.1 |
| A29 | A **public-CA certificate** for this zone is possible at all | RFC 8555 §8.3 (http-01 needs a reachable server) + RFC 8555 §8.4 (dns-01) + Traefik ACME docs |
| A30 | One wildcard certificate can cover **all branches of a project** | RFC 6125 §6.4.3 rule 2 + Traefik ACME docs (double wildcard impossible) |
| A31 | A router can request a **wildcard domain** for its certificate | router `tls.domains` (`main`/`sans`), `tls.certResolver`; ACME "Domain Definition" |
| A32 | DNS-01 at Cloudflare is **available** for this zone | `malarstrom.com NS` → Cloudflare nameservers (§1.2); lego Cloudflare provider variables (`CF_DNS_API_TOKEN`) |

---

## 11. Open decisions for the user

### 11.1 Where Traefik runs (D4)

* **(a) Separate container on the same user-defined Docker network** — *recommended*.
  User must do on the host: create the container (`traefik:v3.7`), attach it to the same network,
  publish `80:80` (and `443:443` if TLS is chosen) on the LAN address `10.10.1.50`.
  Breaks if: the host's Docker network layout changes, or the published port is later taken.
* **(b) Inside this container** — the host must **re-create** this container with published ports
  (`-p 80:80 -p 443:443`, bound to `10.10.1.50`, not to `127.0.0.1`) and Traefik must be run inside
  it (no `traefik` binary is present here). Breaks if: the container is re-created without the
  ports, or the host's LAN address changes (the port must be re-bound).
* **(c) On the host with the Docker provider** — *ruled out* for dev-server routing (§3).

### 11.2 How dynamic configuration is delivered (D5)

* **(a) HTTP provider + registry inside this container** — *recommended*.
  User must do on the host: nothing beyond (a)/(b) of D4 (the registry is reachable over the Docker
  network). Breaks if: the registry is down (Traefik keeps the last configuration; poll timeout is
  `5s`), or the poll latency (`5s` default) bothers.
* **(b) File provider `directory` over a shared Docker volume** — one file per registration.
  User must do on the host: create the volume and mount it into both containers. Breaks if:
  fsnotify does not deliver events for that mount (documented caveat).

### 11.3 How dev servers become reachable (D6)

* **(i) Rebind the dev servers to `0.0.0.0`** — *recommended*.
  User must do: make the agent/framework start the dev server with a host flag (`--host 0.0.0.0`,
  `HOST=0.0.0.0`, `vite --host 0.0.0.0`, …) or configure the framework's default.
  Breaks if: a framework hard-codes `127.0.0.1` — then the dev server is still reachable only
  locally, and the fallback (ii) applies.
* **(ii) Relay inside this container** — a forwarder here listens on `0.0.0.0:<relayport>` and
  forwards to `127.0.0.1:<devport>`; Traefik targets the relay port.
  User must do: nothing on the host; the relay must run in this container.
  Breaks if: the relay dies or is overloaded; WebSocket support must be implemented correctly.
* **(iii) Traefik sharing this container's network namespace** (`--network container:<this>`).
  User must do: re-create this container with published ports — impossible from inside, and the
  published port must be on the LAN address anyway, so it collapses into option (b) of D4 with extra
  coupling. Breaks if: the container is re-created (Traefik must be reattached).

### 11.4 Security and secrets

* Where the dashboard lives: internal-only entryPoint + middleware protection — *recommended* —
  versus `api.insecure` on a LAN port (docs: "Do not enable this flag in production").
* Whether the registry endpoint requires a shared secret (`providers.http.headers`) — *recommended
  yes* — or is open on the Docker network.
* Whether to hand a Cloudflare API token (DNS:Edit) to the Traefik container for dns-01 (§7.4), and
  how that secret is stored.
* Which TLS option (§7.5): (a) plain HTTP, (b) per-project wildcard certificate, (c) internal CA.

### 11.5 Registration scope

* **(a) Per-project namespaced prefixes** — *confirmed by the user's namespace* (D1): every project
  owns one label under `home.malarstrom.com`.
* The remaining question: whether a project may register **more than one branch simultaneously**
  (the design supports it: one router per branch) and what happens on branch deletion (the route is
  withdrawn, the FQDN stops resolving to a dev server).

---

## 12. Out of scope

Implementation (no Traefik install, no containers, no compose files, no service scripts) waits for
the user to confirm the open decisions in §11.
