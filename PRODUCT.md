# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain TypeScript on Node (>= 22.6), no framework, no bundler, no runtime
dependency. The index page is server-rendered HTML served by the registry
itself: one HTML document, one stylesheet, one script, and self-hosted font
files, all from this repository. The stylesheet is **Tailwind**, compiled
ahead of time with the pinned toolchain (`tailwindcss` and `@tailwindcss/cli`,
4.3.3, in devDependencies) and committed as `src/assets/index.css`;
`npm run build:css` regenerates it and `test/build-css.test.ts` fails when
the committed artifact is stale. Nothing is compiled at runtime and the page
asks no third party for anything.

**Delegated.** The client asked for shadcn components and Tailwind styles.
The stack decision was delegated to the design thread, which took Tailwind
with an ahead-of-time compile and did **not** take the React/shadcn runtime:
shadcn's components are React, and a React runtime would have broken the
no-runtime-dependency and no-CDN constraints the client had set. The shadcn
components (button, badge, card, table) are therefore written out as plain
classes over the shadcn token names.

## Users

The client: a developer working on their own LAN with AI agents that run
inside a container the client controls. (confirmed) The index page is the
client's window onto what the agents are running: it is scanned at a glance
and acted on. (confirmed)

## Product Purpose

The dev gateway: a registry and a relay inside the container that let agents
publish dev servers, which the client's own Traefik then serves on the LAN as
`https://<branch>.<project>.home.malarstrom.com`, each project covered by one
wildcard certificate. (confirmed)

The index page is the client's overview of that: what the agents are running
right now, the host name of each route, the port inside the container, whether
it answers, and a way to open or clear a route. The overview lives at
`https://index.home.malarstrom.com/`. (confirmed)

The client can also **create a route by hand** from that page — project,
branch and port — so a dev server that was started outside the agents' flow
can be published without an agent. (confirmed)

Success means the client can see what is running and act on it — open a dev
server, copy an address, or clear a stale route — without asking an agent.
(inferred from the brief: the page's job is to be scanned at a glance and acted
on; the Remove flow and the "what is running" view exist for exactly that.)

## Positioning

The gateway's own mechanism is that agents publish, the proxy serves, and the
page reports the truth about both: it probes every registered port and says
whether anything answers, so a route that is registered but dead cannot pass
as working. (confirmed)

## Operating Context

- Agents run inside one container; their dev servers bind `127.0.0.1` inside
  it, so a relay forwards them to the container's address and the client's
  Traefik routes to it. (confirmed)
- The client reaches the gateway only over their LAN or VPN. The host names
  are public DNS names; the payload is not internet routable. (confirmed)
- The client works at a glance: the page is a standing screen during agent
  work, not a place they linger. (inferred)
- The page polls the gateway every 4 seconds and patches the rows that
  changed, so a live view without a reload and without stealing focus.
  (confirmed)

## Capabilities and Constraints

Confirmed constraints that any future work must preserve:

- Zero runtime dependencies, no framework, no bundler, no runtime build and no
  runtime CDN request. Fonts are self-hosted from the repo, OFL, with their
  licences kept next to them. The stylesheet is compiled ahead of time and
  committed. (confirmed)
- The Traefik dynamic configuration document served at `/traefik` must not
  change. (confirmed)
- The Remove flow, the `X-Gateway-UI: 1` guard, the `data-registration-id`
  attribute, the `X-Dev-Target` contract and the relay's trust boundaries stay
  as they are. (confirmed)
- **Creating a route by hand** goes through `POST /api/registrations` with the
  same `X-Gateway-UI: 1` guard, the same slug rule as the CLI and the same
  state file; a project and branch that already has a route is a conflict
  (409), never a silent update. (confirmed)
- No secret is configured for the registry, by the client's decision; the
  `X-Gateway-UI` header is the only guard. Do not raise this again.
  (confirmed)
- The tests stay green, and other projects' live routes must keep working.
  (confirmed)
- The index page must keep: live polling without a reload, grouping by
  project with the project's wildcard certificate, the host name that opens,
  the port, the age, the state, Copy address, Remove with confirmation, the
  empty state with the register command, the error state, phone-width
  responsiveness, keyboard focus, reduced motion, and no third-party request.
  (confirmed from the brief and the current implementation)

## Brand Commitments

- The product is called "Dev gateway" on the page. (confirmed)
- The client's own zone and the wildcard naming
  `<branch>.<project>.home.malarstrom.com` are facts of the product, shown on
  the page. (confirmed)
- **The Daylight world** is the visual world of the index page: a cool
  off-white ground, white cards, hairline rules, no shadows anywhere, one
  family (Hanken Grotesk) at four sizes, one indigo accent, and the gateway
  facts (zone, relay, registry port) in the masthead instead of a footer.
  (confirmed — the client picked this world and asked for the facts to move
  into the header.)
- **The state of a route is an Up/Down badge**, a filled one against an
  outlined one, with a solid edge against a broken edge: shape and colour
  both, and never a ball. (confirmed — the client rejected the earlier round
  status mark by name.)
- The client rejected the previous visual world by name: the small round
  status mark, the bordered pill buttons, the putty/chalk ground colour and
  the Familjen Grotesk + Azeret Mono typefaces. A replacement world must be
  new in all four, not a refinement of the old look. (confirmed)

## Evidence on Hand

- The live registry: real registrations with real host names and ports, and a
  real up/down answer per route (the `orkr` project is registered and
  answering today). (confirmed)
- The gateway's own route list and the index page. (confirmed)
- No testimonials, no customers and no benchmarks exist, and none may be
  invented. (confirmed by absence)

## Product Principles

1. Show the truth, not the intention: a route that does not answer says so.
2. The page is scanned, not read: the host name and the state must be legible
   at a glance.
3. The client's machine is the only client: no third-party request, ever.
4. Nothing the gateway does may break another project's live route.
5. A new visual world replaces the old one; it does not decorate it.

## Accessibility & Inclusion

Keyboard focus on every control and a visible focus ring, contrast at 4.5:1
for body text, and honouring `prefers-reduced-motion`. (confirmed as a
constraint of the build)
