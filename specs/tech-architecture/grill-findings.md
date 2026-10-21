# Grill findings — "Traefik dev gateway" plan vs. official docs

Every row was checked against an official source that was actually fetched while writing this
file. Traefik citations use the current docs set (`https://doc.traefik.io/traefik/reference/...`,
describing **v3.7**). Docker citations use `docs.docker.com`. DNS citations use the RFCs at
`rfc-editor.org`. Vendor citations use the vendors' own docs.

Verdict vocabulary: **AGREE** (docs support the plan), **CONTRADICT** (docs/refute the plan as
written — the plan was corrected), **RULED OUT** (the option cannot work at all), **UNDOCUMENTED**
(no official source states it — not guessed).

---

## Summary table

| # | Assumption | Verdict | Change made to the plan |
| --- | --- | --- | --- |
| A1 | File provider can read a **directory** | AGREE | none (adopted) |
| A2 | File provider reloads **without restart** | AGREE | none (adopted) |
| A3 | File provider is safe on a **bind-mounted** dir | CONTRADICT (caveat) | file provider demoted to alternative; HTTP provider recommended |
| A4 | Config can be delivered over **HTTP** by polling | AGREE | HTTP provider adopted as primary |
| A5 | The HTTP endpoint can be **authenticated** | AGREE | registry gets a shared-secret header (§4, §8) |
| A6 | Docker provider can route to an **unpublished** port | AGREE | noted; does not help us (dev servers are not containers) |
| A7 | Docker provider needs the **docker socket** | AGREE | candidate C ruled out for our case; `exposedByDefault` risk recorded |
| A8 | Docker provider exposes **everything** by default | AGREE | `exposedByDefault: false` prescribed in §8 |
| A9 | Docker provider can target a **specific network** | AGREE | recorded (only relevant if C is revived) |
| A10 | The **Traefik API can push configuration** | CONTRADICT | API demoted to observation-only; removed as a config channel |
| A11 | Dashboard/API can be enabled, and where | AGREE | dashboard at `/dashboard/` (trailing slash), `api.insecure` dev-only |
| A12 | Dashboard/API lists routers and services | AGREE | API used as cross-check for the index page |
| A13 | Exposing the dashboard/API is dangerous | AGREE | security posture §8 |
| A14 | EntryPoints bind an address; routers attach | AGREE | none |
| A15 | A **router serves exactly one service** | AGREE | exact-Host router per registration; wildcard-per-project marked limited |
| A16 | A service can point at a **non-container host:port** | AGREE | backend URL = this container's IP + port (or relay port) |
| A17 | Image tag and published ports | AGREE | `traefik:v3.7`, publish `80`/`443`; `8080` internal |
| A18 | `Host(...)` wildcard matches **one label** | AGREE | exact `Host` rules; `Host(`*.<zone>`)` explicitly ruled out for a 2-label prefix |
| A19 | `Host` preferred over `HostRegexp` | AGREE | `HostRegexp` only as a last resort |
| A20 | A DNS wildcard covers a **multi-label** prefix | AGREE | user's single `*.<zone>` record is sufficient; no per-project DNS record needed |
| A21 | A closer existing name **kills** the DNS wildcard | AGREE | caveat stated in §6 |
| A22 | Industry standard for branch-scoped names | AGREE (Vercel, GitLab slug, RFC 2606) | branch-first template kept; slug rule adopted |
| A23 | Only **published** ports are LAN-reachable | AGREE | candidate A requires host-side re-create |
| A24 | Publishing to **loopback** is not LAN-reachable | AGREE | publish on `0.0.0.0`, never `127.0.0.1` |
| A25 | User-defined network ⇒ name/IP reachability | AGREE | candidate B works; our container is on such a network |
| A26 | `127.0.0.1`-bound process is unreachable from another container | AGREE (namespace isolation) | rebind-or-relay decision (D4) |
| A27 | This container can be re-created from inside | CONTRADICT (fact) | candidate A is a host-side task |

---

## Detailed findings

### A1 — v3 file provider can read a directory of files — **AGREE**

> "providers.file.directory — Defines the path to the directory that contains the configuration
> files. The filename and directory options are mutually exclusive. It is recommended to use
> `directory`."
> "providers.file.filename — Defines the path to the configuration file. — `""` — Yes"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/

Plan change: none — the file provider is evaluated with its `directory` mode.

### A2 — File provider picks up changes without a restart — **AGREE**

> "providers.file.watch — Set the watch option to true to allow Traefik to automatically watch for
> file changes. It works with both the filename and the directory options. — `true`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/

Plan change: none. Note the doc's own example enables the provider with
`providers: file: directory: "/path/to/dynamic/conf"`.

### A3 — File provider is reliable on a bind-mounted directory — **CONTRADICT (caveat)**

> "With the file provider, Traefik listens for file system notifications to update the dynamic
> configuration. If you use a mounted/bound file system in your orchestrator (like docker or
> kubernetes), the way the files are linked may be a source of issue."
> "As it is very difficult to listen to all file system notifications, Traefik uses fsnotify. If
> using a directory with a mounted directory does not fix your issue, please check your file system
> compatibility with fsnotify."

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/

Plan change: the recommended delivery mechanism changed from "file provider over a shared mount"
to the **HTTP provider** (§4). The file provider is kept as an alternative with the caveat written
into the option text.

### A4 — Dynamic configuration can be delivered over HTTP by polling — **AGREE**

> "providers.http.endpoint — Defines the HTTP(S) endpoint to poll. — `""` — Yes"
> "providers.http.pollInterval — Defines the polling interval. — `5s`"
> "providers.http.pollTimeout — Defines the polling timeout when connecting to the endpoint. — `5s`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/

Plan change: none — HTTP provider adopted as the primary mechanism, with the 5 s default poll
interval named as the registration-propagation latency.

### A5 — The HTTP endpoint can be authenticated / secured — **AGREE**

> "providers.http.headers — Defines custom headers to be sent to the endpoint. — `{}`"
> "providers.http.tls.ca — Defines the certificate authority used for the secure connection to the
> endpoint, it defaults to the system bundle."
> "providers.http.tls.insecureSkipVerify — Instructs the provider to accept any certificate
> presented by endpoint when establishing a TLS connection, regardless of the hostnames the
> certificate covers. — `false`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/

Plan change: added to §4 and §8 — the registry endpoint requires a shared secret carried in
`providers.http.headers`; TLS verification stays on (`insecureSkipVerify: false`).

### A6 — Docker provider can route to a container port that is not published — **AGREE**

> "Port Detection — Traefik retrieves the private IP and port of containers from the Docker API."
> "If a container does not expose any port, or the selection from multiple ports does not fit, then
> you must manually specify which port Traefik should use for communication by using the label
> `traefik.http.services.<service_name>.loadbalancer.server.port`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

Plan change: the fact is recorded, but it does not help this project — the dev servers are plain
processes, not containers, so the Docker provider never sees them (see A7 and Candidate C).

### A7 — Docker provider needs the docker socket — **AGREE**

> "Docker API Access — Traefik requires access to the docker socket to get its dynamic
> configuration. You can specify which Docker API Endpoint to use with the directive `endpoint`."
> "providers.docker.endpoint — Specifies the Docker API endpoint. — `unix:///var/run/docker.sock`"
> "Security Note — Accessing the Docker API without any restriction is a security concern: If
> Traefik is attacked, then the attacker might get access to the underlying host."

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

Plan change: **Candidate C ruled out** for the dev-server routing job, and the fact that this
container has no `/var/run/docker.sock` is recorded in §2.

### A8 — Docker provider exposes everything by default — **AGREE**

> "providers.docker.exposedByDefault — Expose containers by default through Traefik. If set to
> false, containers that do not have a `traefik.enable=true` label are ignored from the resulting
> routing configuration. — `true`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

Plan change: §8 now prescribes `exposedByDefault: false` for any future Docker-provider use.

### A9 — Docker provider can target a specific network — **AGREE**

> "providers.docker.network — Defines a default docker network to use for connections to all
> containers. This option can be overridden on a per-container basis with the
> `traefik.docker.network` label. — `""`"

URL: https://doc.traefik.io/traefik/reference/install-configuration/providers/docker/

Plan change: recorded in Candidate C; not used.

### A10 — The Traefik API can be used to push configuration — **CONTRADICT**

> "Endpoints — All the following endpoints must be accessed with a GET HTTP request."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

And the documented configuration methods are file / labels / annotations / KV / tags — the API is
not among them:

> "Depending on your environment and preferences, there are several ways to supply this routing
> configuration: File or Structured Provider: Use TOML or YAML files. Docker and ECS Providers: Use
> container labels. Kubernetes Providers: Use annotations. KV Providers: Use key-value pairs. Other
> Providers (Consul, Nomad, etc.): Use tags."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/

Plan change: `api@traefik.io` was removed from the list of configuration channels. It is now
**observation-only** (§7, §4 table).

### A11 — The dashboard/API can be enabled, and where it is served — **AGREE**

> "api — Enable api/dashboard. When set to true, its sub option api.dashboard is also set to true.
> — `false`"
> "api.dashboard — Enable dashboard. — `true`"
> "api.insecure — Enable the API and the dashboard on the entryPoint named traefik. Please note that
> this mode is incompatible with the custom API base path option. — `false`"
> "The dashboard is available by default on the path `/dashboard/`. Note: The trailing slash `/` in
> `/dashboard/` is mandatory."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

Plan change: §7 now states the enabling keys and the mandatory trailing slash; `api.insecure` is
marked dev-only (see A13 and the quick-start warning below).

### A12 — The dashboard/API lists routers and services — **AGREE**

> "/api/http/routers — Lists all the HTTP routers information."
> "/api/http/services — Lists all the HTTP services information."
> "/api/overview — Returns statistic information about HTTP, TCP and about enabled features and
> providers."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

Plan change: §7 uses these endpoints as the cross-check for the gateway index page. It also fixes
the "overview of everything the agents run" requirement: the registry itself knows every
registration, and the API confirms what Traefik actually loaded.

### A13 — Exposing the dashboard/API is dangerous by default — **AGREE**

> "Security — Enabling the API and the dashboard in production is not recommended, because it will
> expose all configuration elements, including sensitive data, for which access should be reserved
> to administrators. In production, it should be at least secured by authentication and
> authorizations."
> "It's recommended to NOT publicly exposing the API's port, keeping it restricted to internal
> networks (as in the principle of least privilege, applied to networks)."

URL: https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/

And from the Docker quick start:

> "Port 8080 serves the dashboard because we enabled `--api.insecure=true` (development use only)"
> "Because we explicitly enabled insecure mode, the dashboard is reachable on port 8080 without
> authentication. Do not enable this flag in production."

URL: https://doc.traefik.io/traefik/getting-started/docker/

Plan change: §8 forbids `api.insecure` on a LAN-reachable port and requires middleware protection
plus network restriction.

### A14 — EntryPoints bind an address/port and routers attach to them — **AGREE**

> "address — Define the port, and optionally the hostname, on which to listen for incoming
> connections and packets. It also defines the protocol to use (TCP or UDP). If no protocol is
> specified, the default is TCP. The format is: `[host]:port[/tcp|/udp]` — Yes"
> "In the Helm Chart, the entryPoints web (port 80), websecure (port 443), traefik (port 8080) and
> metrics (port 9100) are created by default."

URL: https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/

> "entryPoints — The list of entry points to which the router is attached. If not specified, HTTP
> routers are attached to all entry points."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/

Plan change: none; §7/Candidate B use `web`/`websecure` and keep the dashboard entryPoint
separate.

### A15 — A router serves exactly one service — **AGREE**

> "service — The name of the service that will handle the matched requests. Services can be load
> balancer services, weighted round robin, mirroring, or failover services. — Yes (required)"
> "If the rule is verified, the router becomes active, calls middlewares, and then forwards the
> request to the service."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/

Plan change: §5.1 now states the limitation explicitly: the wildcard-per-project router
(`Host(`*.<project>.<zone>`)`) covers all branches of a project but can only ever serve **one**
backend, so it is valid only when concurrent branches of a project share a port. The recommended
design is one exact-`Host` router per registration.

### A16 — A service can point at a host:port that is not a container — **AGREE**

> "url — Points to a specific instance. — Yes for File provider, No for Docker provider"

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/service/

and the file-provider example:

> "http: routers: my-router: rule: \"Host(`example.com`)\" service: my-service services:
> my-service: loadBalancer: servers: - url: \"http://localhost:8080\""

URL: https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/

Plan change: §5 registration record now specifies the backend as a plain URL to this container's
address and the registered port (or the relay port of decision D4). The plan explicitly does **not**
rely on Docker labels or on container discovery for this hop.

### A17 — Image tag and published ports — **AGREE**

> "# docker-compose.yml services: traefik: image: traefik:v3.7 command: - \"--api.insecure=true\"
> - \"--providers.docker=true\" - \"--entrypoints.web.address=:80\" ports: - \"80:80\" - \"8080:8080\"
> volumes: - /var/run/docker.sock:/var/run/docker.sock"

URL: https://doc.traefik.io/traefik/getting-started/docker/

Plan change: Candidate B specifies the Traefik container image `traefik:v3.7` publishing `80:80`
(and `443:443` when TLS is chosen); `8080` stays off the LAN.

### A18 — `Host(...)` wildcard matches exactly one label — **AGREE**

> "The `Host` matcher supports a single-level wildcard prefix (`*.example.com`) to match any direct
> subdomain of `example.com`. It should be preferred over the `HostRegexp` matcher as it allows
> attaching a TLS option and is more efficient."
> "A wildcard matches exactly one subdomain label: `*.example.com` matches `foo.example.com` but not
> `foo.bar.example.com` or `example.com` itself."
> "This is only available with the v3 rule syntax (the default)."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/

Plan change: §5.1 and §6 now carry the central asymmetry — Traefik's `Host` wildcard is
single-label, so `Host(`*.<zone>`)` does **not** match `branch.project.<zone>`, while
`Host(`*.<project>.<zone>`)` does. The recommended design therefore never relies on a Traefik
wildcard: every registration gets an exact `Host(...)` rule.

### A19 — `Host` is preferred over `HostRegexp` — **AGREE**

> "It should be preferred over the `HostRegexp` matcher as it allows attaching a TLS option and is
> more efficient."

URL: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/

Plan change: `HostRegexp` is demoted to "only if a genuinely dynamic branch label must be matched",
and the TLS decision (D7) notes the TLS-option advantage of exact `Host` rules.

### A20 — A DNS wildcard covers a multi-label prefix — **AGREE**

> "The owner name of the wildcard RRs is of the form \"*.<anydomain>\", where <anydomain> is any
> domain name. <anydomain> should not contain other * labels, and should be in the authoritative
> data of the zone. The wildcards potentially apply to descendants of <anydomain>, but not to
> <anydomain> itself."
> "Another way to look at this is that the \"*\" label always matches at least one whole label and
> sometimes more, but always whole labels."

URL: https://www.rfc-editor.org/rfc/rfc1034#section-4.3.3

> "QNAME=foo.bar.example. QTYPE=TXT, QCLASS=IN — the answer will be \"foo.bar.example. IN TXT ...\"
> because bar.example. does not exist, but the wildcard does."

URL: https://www.rfc-editor.org/rfc/rfc4592#section-2.2.1

Plan change: §6 now states that the user's **single** `*.<zone>` wildcard record is sufficient for
`branch.project.<zone>` — no per-project DNS record is required — and contrasts this with
Traefik's single-label `Host` wildcard.

### A21 — A closer existing name kills the DNS wildcard — **AGREE**

> "Wildcard RRs do not apply: - When the query is in another zone. That is, delegation cancels the
> wildcard defaults. - When the query name or a name between the wildcard domain and the query name
> is know[n] to exist. For example, if a wildcard RR has an owner name of \"*.X\", and the zone also
> contains RRs attached to B.X, the wildcards would apply to queries for name Z.X (presuming there
> is no explicit information for Z.X), but not to B.X, A.B.X, or X."

URL: https://www.rfc-editor.org/rfc/rfc1034#section-4.3.3

Plan change: §6 carries this as the explicit caveat on the wildcard record.

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
> or new DNS related code. \".example\" is recommended for use in documentation or as examples. ...
> The \".localhost\" TLD has traditionally been statically defined in host DNS implementations as
> having an A record pointing to the loop back IP address and is reserved for such use."

URL: https://www.rfc-editor.org/rfc/rfc2606

Plan change: §5.2 adopts the GitLab slug rule for branch and project labels; §5.3 records that the
industry shape is project-scoped + branch-qualified but that the **ordering differs** (Vercel:
project first; the user wants branch first), which is decision D3.

Not cited: the GitLab review-apps page returned HTTP 403 to a plain fetch, so no claim is made
from it.

### A23 — Only published ports are LAN-reachable — **AGREE**

> "Published ports — When you create or run a container using `docker create` or `docker run`, all
> ports of containers on bridge networks are accessible from the Docker host and other containers
> connected to the same network. Ports are not accessible from outside the host or, with the
> default configuration, from containers in other networks. Use the `--publish` or `-p` flag to make
> a port available outside the host, and to containers in other bridge networks."

URL: https://docs.docker.com/engine/network/

> "Published container ports are mapped to host IP addresses."

URL: https://docs.docker.com/engine/network/port-publishing/

Plan change: **Candidate A ruled out from inside this container** — publishing is decided when the
container is created, and this container cannot be re-created from within (§2). Candidate B is
preferred because the host creates the Traefik container and therefore controls its published
ports.

### A24 — Publishing to loopback is not LAN-reachable — **AGREE**

> "If you include the localhost IP address (127.0.0.1, or ::1) with the publish flag, only the
> Docker host can access the published container port."
> "In nat mode network, publishing a port to an address on the loopback interface means remote
> hosts cannot access it."
> "In nat and nat-unprotected modes, containers in other bridge networks can only access published
> ports via the host addresses they are published to."

URL: https://docs.docker.com/engine/network/port-publishing/

Plan change: §2/Candidate A and §8 now require publishing on `0.0.0.0`/the host's LAN address,
never on loopback.

### A25 — User-defined network gives name/IP reachability — **AGREE**

> "Once connected to a user-defined network, containers can communicate with each other using
> container IP addresses or container names."
> "With the default configuration, containers attached to the default bridge network have
> unrestricted network access to each other using container IP addresses. They cannot refer to each
> other by name."
> "DNS services — Containers that attach to a custom network use Docker's embedded DNS server. ...
> The embedded DNS server address is 127.0.0.11."

URL: https://docs.docker.com/engine/network/

Plan change: §2 records that this container is on a **custom** network (its `/etc/resolv.conf`
points at `127.0.0.11`), which is what makes Candidate B viable and lets the registry endpoint be
addressed by container name.

### A26 — A `127.0.0.1`-bound process is unreachable from another container — **AGREE**

> "Container networks — In addition to user-defined networks, you can attach a container to another
> container's networking stack directly, using the `--network container:<name|id>` flag format. ...
> The following example runs a Redis container, with Redis binding to 127.0.0.1, then running the
> `redis-cli` command and connecting to the Redis server over 127.0.0.1."

URL: https://docs.docker.com/engine/network/

Plan change: Candidate B cannot route to a loopback-bound dev server directly; decision D4 offers
(a) rebinding dev servers to `0.0.0.0` or (b) a relay inside this container (the namespace-sharing
trick above is the documented way to reach a loopback-bound service from another container's stack).

### A27 — This container can be re-created from inside — **CONTRADICT (environment fact)**

Observed in this container: `ls -la /var/run/docker.sock` → `No such file or directory`;
`docker info` → `docker: command not found`; `which traefik` → not found.

Plan change: Candidate A is explicitly marked as a **host-side task** for the user, and everything
in the recommended path (Candidate B) is designed to require only host-side work that the user
performs anyway (creating one more container on the same network).

---

## Facts that no official doc settles (recorded as "undocumented", not guessed)

1. Whether Traefik's TLS handling supports a **wildcard certificate** for the zone: the TLS
   reference pages fetched (`/reference/routing-configuration/http/tls/overview/` and
   `.../tls-certificates/`) contain no occurrence of "wildcard". Left as decision D7(b), to be
   verified before it is relied upon.
2. A **`rest` provider** appears in the v3.7 default provider-precedence list
   (https://doc.traefik.io/traefik/reference/install-configuration/providers/overview/), but no
   provider documentation page for it exists under `/reference/install-configuration/providers/others/rest/`
   (HTTP 404). It is therefore **not** considered as a configuration channel.
3. The exact content of the user's wildcard DNS record, and the label position of the project
   prefix inside it, are still unconfirmed — the plan keeps that position a parameter.
