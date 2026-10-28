# traefik-api — confirmed facts and decisions

## User's namespace (confirmed 2026-10-21)

- Wildcard: `*.home.malarstrom.com`, in **public DNS on Cloudflare** (NS `dan/isla.ns.cloudflare.com`).
- `home.malarstrom.com` A → `10.10.1.50` (private RFC 1918 address, TTL 300).
- The wildcard is a **CNAME** to `home.malarstrom.com` and resolves at **arbitrary depth**
  (`a.b.home.malarstrom.com` resolves) — RFC 1034 §4.3.3, RFC 4592 §2.2.1.
  ⇒ no per-project or per-branch DNS records are needed.
- **Public DNS names, private payload**: names are publicly enumerable; the IP is not
  internet-routable. Keep entrypoints/dashboard/API on the LAN/VPN address only.

## FQDN template (user's decision)

    <branch>.<project>.home.malarstrom.com

- branch = leftmost label, DNS-safe slug (GitLab `CI_COMMIT_REF_SLUG` style).
- project = the label directly left of `home` (the user's "label 4" counting from the right).

## Routing model (user's decision)

One registration = one FQDN = **one exact-`Host` router + one service**, added to and removed from
Traefik **separately** (atomic). Wildcard-per-project routers were rejected: one router serves one
service, so they cannot dispatch concurrent branches to different backends.

## Decisions (user, 2026-10-21)

- **D1** Traefik **already runs** in a separate container on the same ("private") Docker network.
- **D2** Dynamic config via the **HTTP provider**: a registry inside this container serves the
  Traefik dynamic config; Traefik polls it (~5 s default `pollInterval`).
- **D3** A **relay** inside this container forwards `0.0.0.0:<relay-port>` → `127.0.0.1:<dev-port>`.
- **D4** Open question from the user: what the dashboard/API posture is for. Answer: the registry's
  own index can be the "what is running" view, so the Traefik dashboard is optional.
- **D5** Client sees HTTPS; **Traefik terminates TLS**; the hop into this container is plain HTTP.
  Certs come from the existing Cloudflare (dns-01) integration — http-01 is impossible (private A
  record). Granularity open: per-FQDN vs per-project wildcard `*.<project>.home.malarstrom.com`.

## Container facts

- This container: `172.16.2.13/24` on a Docker **user-defined** network (resolver `127.0.0.11`),
  gateway `172.16.2.1`. No `/var/run/docker.sock`, no `docker`/`traefik` binaries ⇒ it cannot be
  re-created or publish ports from inside; anything about published ports is a host-side task.
- Dev servers bind `127.0.0.1:PORT` inside the container ⇒ unreachable from any other container.

## TLS (settled by docs)

- http-01 is impossible: the A record is private, so Let's Encrypt cannot reach the host.
  ⇒ dns-01 mandatory for any public-CA cert.
- A cert for `*.home.malarstrom.com` does NOT cover `<branch>.<project>.home.malarstrom.com`
  (RFC 6125 §6.4.3 rule 2 — a wildcard matches exactly one label).
- Traefik docs: wildcards only via DNS-01; double wildcards (`*.*.x`) impossible.
- ⇒ the natural unit is **one wildcard cert per project**: `*.<project>.home.malarstrom.com`,
  which covers every branch of that project. Needs a Cloudflare API token where Traefik runs.

## The user's running Traefik (read from the SMB share `\\10.10.1.50\traefik-config`, user `elin`)

Static `traefik.yml`:
- `api.dashboard: true`; `api.insecure` **not** set (dashboard only via the `traefik` router →
  `api@internal` at `traefik.home.malarstrom.com`).
- entryPoints: `web` `:80` (**redirects** to `websecure`, scheme https), `websecure` `:443`,
  `gitea-ssh` `:2222`, `herdr-ssh` `:2223`.
- providers: `docker` (network **`private`**, `unix:///var/run/docker.sock`, `exposedByDefault: false`)
  and `file` (`/etc/traefik/config/config.yml`, `watch: true`). **No `http` provider yet.**
- `certificatesResolvers.cloudflare`: acme, email mikael@malarstrom.se, storage
  `/etc/traefik/acme/acme.json`, `dnsChallenge.provider: cloudflare`, resolvers 1.1.1.1/1.0.0.1.
- `ping: {}`, `metrics.prometheus: {}`, log level INFO.

Dynamic `config.yml` (file provider): middlewares `default-security-headers`, `compress`; routers
`truenas` → `http://10.10.1.50:8080`, `traefik` → `api@internal`, `homebridge` → `http://10.10.1.49:8581`;
all on `websecure` with `tls: {certResolver: cloudflare}` and `middlewares: [default-security-headers,
compress]`; services use `passHostHeader: true`.

Implications: our routers attach to `websecure` only (web already redirects); cert resolver name is
`cloudflare`; our generated objects must be prefixed (`dev-`) to avoid colliding with the file/docker
provider objects; reuse `compress` but **not** `default-security-headers` (frameDeny/stsPreload break
dev tooling). The docker network is named `private` (172.16.2.0/24; this container = 172.16.2.13,
hostname `e1e518cfcc56` — a stable container name is wanted for the registry URL).

## Live status (2026-10-22)

The `http` provider is **live** in the user's Traefik (`endpoint: http://devbox:45002/traefik`,
static config patched and Traefik restarted). Verified end to end:

- `dev-index@http` router is live (the index page at `https://index.home.malarstrom.com/`).
- A probe registration produced `dev-probe-main-e9031a@http` and `https://main.probe.home.malarstrom.com/`
  answered **200** with a **valid** certificate `CN=*.probe.home.malarstrom.com` (ACME dns-01 through
  the user's existing `cloudflare` resolver).
- The user's 18 existing routers (`truenas@file`, `homebridge@file`, `traefik@file`, 12 `@docker`,
  `ping@internal`, `prometheus@internal`, `web-to-websecure@internal`) are untouched ⇒ **the http
  provider's objects coexist with the file and docker providers' objects** (empirical answer to the
  merge question the docs do not answer).

## Traefik gotcha that cost us a restart

Traefik decodes the document with paerser, and **an empty map is rejected**:
`middlewares cannot be a standalone element (type map[string]*dynamic.Middleware)`
(`parser/nodes_metadata.go`: a struct/map field with zero children is refused). The renderer must
**omit** empty sections, never emit `{}`.

## Commands

```bash
cd ~/projects/traefik-api
node bin/traefik-dev.js register --project <p> --branch <b> --port <port>   # starts the daemon if needed
node bin/traefik-dev.js list | status | unregister --project <p> --branch <b>
```

State: `/home/node/.traefik-dev/` (`registrations.json`, `config.json`, `daemon.pid`, `daemon.log`).
Daemon: `node bin/traefik-devd.js`; a code change needs a restart of that pid.

## The pi skill (installed 2026-10-22)

- Source of truth: `~/projects/traefik-api/skills/traefik-dev-gateway/` (`SKILL.md` 63 lines +
  `references/troubleshooting.md` + `references/architecture.md`), committed on `master` (`2148fea`).
- Installed for **every** pi in this container by one line in the user settings
  `/home/node/.pi/agent/settings.json`: `"skills": ["~/projects/traefik-api/skills"]`
  (backup: `settings.json.bak-20261022-002342`). Nothing is copied or symlinked per project.
- Proven with a real nested pi session in `/tmp/skill-probe`: the fresh agent advertised the skill
  verbatim, loaded it on the prompt "start a tiny web server on port 4321 and give me a URL I can
  open from my machine", registered the port, and returned
  `https://feature-probe.skill-probe.home.malarstrom.com` → HTTP 200, valid Let's Encrypt cert
  `CN=*.skill-probe.home.malarstrom.com`.
- Already working in the wild: the **test1** project published `bistro.test1.home.malarstrom.com`
  → HTTP 200, `CN=*.test1.home.malarstrom.com`.

## Manual removal from the index page (2026-10-22)

`DELETE /api/registrations/<project-slug>/<branch-slug>` on the registry (`b08fe77`): `204` on
success, `404` unknown, `403` without the header `X-Gateway-UI: 1` (the CSRF guard — a custom header
forces a CORS preflight and the registry sends no CORS headers), `X-Registry-Secret` additionally
required when a `secret` is configured (none today). The index page has one **Remove** button per
row (`data-registration-id="<project>/<branch>"`), `confirm()`, then the fetch and a reload. Removals
are logged to `~/.traefik-dev/daemon.log` with project, branch and source address. The route is gone
from Traefik within one poll interval (≈5 s).

## Index page redesign (2026-10-23, commit `31f37a9`)

The index is now an instrument panel, redesigned with Anthropic's `frontend-design` skill
(https://github.com/anthropics/skills/tree/main/skills/frontend-design): a cool putty/chalk ground
(`#e8eae5` / `#f5f6f2`), ink `#16232a`, signal green `#0e7a5a` (answering) and amber `#8a5b12` (not
answering) — the two states differ by **shape** (filled lens vs hollow ring), not only colour. Type:
Familjen Grotesk + Azeret Mono, **self-hosted from `src/assets/fonts/`** (OFL, licences included) —
no CDN. Routes are grouped per project, and the group header names the project's wildcard
certificate `*.<project>.home.malarstrom.com`. Live polling of `/api/registrations` every 4 s patches
rows in place; `/api/routes` serves the rendered list fragment. `31f37a9` on `master`; 82 tests pass.

Screenshots of the review rounds: `artifacts/screenshots/` (desktop, tablet, phone, focus,
reduced-motion, confirm, removed, empty). Playwright review tools: `tools/screenshot.py`,
`tools/interaction-check.py` (review only — the daemon never loads them).

Gotchas recorded by the thread:
- The registry cached assets in memory and served a **stale stylesheet** — assets are now cached by
  mtime. If a CSS change does not show up, check this first.
- CSS grid auto-placement is sparse: an item later in DOM order but earlier in column order lands in
  the next row. Give every column an explicit `grid-column`.
- The git guard also refuses a commit message written through a heredoc; use plain
  `git commit -m "feat(scope): subject" -m "body"`.

## Secret: deliberately not used (user's decision, 2026-10-22)

The user decided **not** to set a `secret` in `~/.traefik-dev/config.json`. The registry endpoint and
the manual removal endpoint are reachable by anything that can route the private address; the
`X-Gateway-UI` header (CSRF preflight guard) is the only protection. Do not raise this again
unless the user brings it up.

## Index polish pass (2026-10-23, commits `2ecb056` + `df8bdda`)

Impeccable `polish` (mode **Operate**) over the index page; the instrument-panel world was preserved.
Thirteen defects triaged; twelve fixed, two deliberately kept (contrast was already ≥4.5:1, elevation
stays border-only). Highlights: host names break at their dots (`<wbr>`), the failed-removal message
moved into the row it belongs to (`role="alert"`), "N answering" is green only when something
answers, the lamp's zero-offset halo became a real shadow (`0 1px 2px`), one bloom instead of two
decoration effects, radii decided (panels 12px, controls 8px), one spacing scale, four type steps
(22/17/15/13px, measure 66ch), one easing curve, and the **browser surfaces** themed from the palette
(selection, caret, scrollbars, underline offset, `tabular-nums` so the live figures stop jittering).

Verification tooling now lives in `tools/`: `preview-server.ts` (review harness with a throwaway
state dir), `review-states.py`, `craft-floor-check.py` (reads the craft floor off a real render),
`interaction-check.py`. Screenshots: `artifacts/screenshots/{before,after,live,empty}/`.

Gotchas recorded: the registry serves the HTML from the loaded module but CSS/JS from disk (mtime
cache) — a change in `src/core/index-page.ts` needs a daemon restart, a change in `src/assets/*` does not.
`traefik-dev status` does not start the daemon; only `register` does.

## The final visual world: Daylight (2026-10-23)

The client rejected the instrument-panel world and chose **Daylight** (candidate B) with **Tailwind
v4** and **shadcn-style components**, told the thread directly in its pane. Status is an **Up/Down
badge** (filled vs outlined) plus a solid or broken 2px edge rule — never a ball, never the word
"answering". One family: **Hanken Grotesk** (self-hosted, OFL, Latin + Latin-Ext). The gateway facts
(zone, relay, registry port) live in the **masthead**, not a footer. `DESIGN.md` and
`.impeccable/design.json` describe the world; `PRODUCT.md` records the product truth.

**Tailwind means a dev-time compile step** — this replaced the project's "no build step" rule. The
truth now stated everywhere: *no runtime build, no framework, no runtime dependency, no
third-party request; the stylesheet is Tailwind, compiled ahead of time and committed; `npm run
build:css` regenerates it*. The toolchain is **pinned exactly** (`tailwindcss` and
`@tailwindcss/cli` 4.3.3, local binary, lockfile) and `test/build-css.test.ts` fails when the
committed `src/assets/index.css` is stale — the silent-unstyled trap is now caught by CI.

Gotcha: the registry serves the HTML from the loaded module but CSS/JS from disk (mtime cache) — a
change in `src/core/index-page.ts` needs a daemon restart, a change in `src/assets/*` does not.

## Critique findings fixed (2026-10-23, commit `24c5c62`)

An Impeccable critique of the shipped page scored it 31/40 (Good), audit 18/20, detector clean on
both the markup and the rendered page. Eight findings, all fixed: a poll no longer destroys a
pending confirmation (**defer**: the server's list is held while a band is open, so the DOM is not
touched at all — the policy lives in `createRefreshPlan()` in `src/assets/index.js` and the test
loads that same file, not a copy); every route-scoped message now lives in **that route's own band**
(`role="status"`, scrolled into view, so it is on screen on a 390×844 phone); Escape closes the
confirmation and returns focus to Remove; a polite live region announces state changes once
("… is now down"); the age is shown on phones; the accessible names are short ("Copy address",
"Remove"); the "not answering" edge is full slate (4.6:1); the route column is capped at 20rem.

91 tests green. The clipboard path is graceful: `navigator.clipboard` → `execCommand` fallback →
"Could not copy …. Copy it from the page instead." (verified in a browser both with and without
clipboard permission).

## The candidate visual worlds are gone (2026-10-23)

The three candidate worlds (Nightwatch, Daylight, Sheet) were rendered on the branch
`feat/visual-world-candidates` with their `worlds/` folder and their screenshots; the client chose
Daylight, and **the client asked for the candidates to be deleted** — branch deleted twice (the
thread restored it once from the object store; the client had already decided), the candidate
renders removed from the thread library. What remains of that round is the record:
`library/t-0007/candidates.md` and `library/t-0007/daylight-world.md`, plus the shipped world's
screenshots in `library/t-0007/screenshots/daylight/`.

**Do not check out `feat/visual-world-candidates`** — the commit `312cf09` is still in the object
store, so a checkout would silently re-create the branch (git's DWIM on a unique reflog entry).
Read the commit by hash instead.

## Creating a route by hand from the index page (2026-10-23, commit `e53f720`)

`POST /api/registrations` with `X-Gateway-UI: 1` (the same CSRF guard as the delete): `201` with the
registration, `400` with `{error, field}`, `403` without the header, `409` when that project+branch
already has a route. The registry writes the **same** state file as the CLI
(`~/.traefik-dev/registrations.json`, through the store's own upsert), so a route made in the page is
one `traefik-dev list` shows and `traefik-dev unregister` removes.

Deliberate difference from the CLI: `traefik-dev register` **updates** an existing project+branch in
place (an agent restarting a dev server on another port wants that), while the page's create
**never** changes a route the client can see — it returns `409` and names the route that exists.
Keep the two different unless the client says otherwise.

Validation: project/branch slugged by the CLI's own `slugify()` (no second rule), port 1–65535, the
gateway's own ports refused, JSON body at most 8 KB. Only routes for dev servers **inside this
container** (the relay forwards to `127.0.0.1:<port>`) — no host field yet.

## The client's three decisions (2026-10-23)

1. **The page's create keeps refusing to update a route** (`409`, naming the route that exists).
   Settled: the CLI updates in place (a machine command with an explicit intent), the page does not
   (a person looking at a list they can see). Do not "fix" this difference.
2. **No host field.** The gateway stays scoped to dev servers **inside this container**; the relay
   forwards to `127.0.0.1:<port>` only. A host field would let anyone who can reach the index page
   point a route at an arbitrary host on the network — a trust decision, not a form field. Services
   on other machines are served by the client's own Traefik configuration.
3. **One sentence in the create panel about the certificate**: a new project's wildcard is issued
   when its first route appears, so the first request can take about ten seconds. The badge reports
   the **port**, not the certificate — no second state for "certificate pending".

## The daemon does not reload its own source

After a code change, kill the pid in `~/.traefik-dev/daemon.pid`; the next `register` starts it again.

## Git guard in this container

bigpowers `omp-hooks` **refuses `git commit` on `master`** ("Direct commits to 'master' are
forbidden. Use a feature branch."). Workaround used: commit on a feature branch, then
`git merge --ff-only` into `master` and delete the branch.

## Threads

- `t-0001` — grill-with-docs of the plan; wrote `specs/tech-architecture/traefik-dev-gateway.md`
  and `specs/tech-architecture/grill-findings.md` on master. Closed.
- `t-0002` — implements the container side (registry, relay, `traefik-dev` CLI, tests, docs).
- `t-0003` — writes and installs the pi skill `skills/traefik-dev-gateway/` so an agent can expose
  a dev server.
- `t-0004` — adds the Remove control to the index page and the matching delete endpoint in the
  registry (`b08fe77 feat: allow removing a registration from the index page`).
- `t-0005` — redesigns the index page: a zero-dependency, server-rendered page with a token
  system and real behaviours.
- `t-0006` — polishes that page (Impeccable `polish`), keeping the incumbent world.
- `t-0007` — the "Daylight" world and the certificate hint in the create panel
  (`db3821a feat(index): say once why a new project may not answer yet`,
  `d547686 docs(index): capture the certificate line in the create panel`).

The briefs and reports of these threads are in the repo under `.herdr-project/traefik-api-<id>/`.

## Where this text lives now (2026-10-26)

This file came from the 0.2 project and now lives in the repo. The overlapping parts have a newer
text in the repo:

- `specs/tech-architecture/traefik-dev-gateway.md` — the architecture plan (namespace, TLS, relay,
  flows, the decisions D1–D8).
- `docs/traefik.md` — the host side: Traefik's static configuration, the Cloudflare dns-01
  resolver, the index router.
- `README.md` — the current behaviour, the CLI and the configuration table.

This log keeps the history and the decisions the plan does not repeat. The rest of the 0.2
material, and where the backlog lives: `memory/boarden.md`.
