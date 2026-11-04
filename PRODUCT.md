# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain TypeScript on Node (>= 22.6), no framework, no bundler, no runtime
build and no runtime CDN request. The package ships compiled JavaScript
(`dist/`), because Node cannot strip types under `node_modules`. The
dynamic configuration document the proxy polls is rendered by the core and
served over HTTP; the route list is a CLI, an MCP tool and a terminal view,
never a browser page. There is no stylesheet, no font and no frontend
toolchain any more: the web interface and its Tailwind toolchain are gone
(D8, §10.1).

**Delegated.** The client asked for shadcn components and Tailwind styles
when the product still had a page. The stack decision was delegated to the
design thread, which took Tailwind with an ahead-of-time compile and did
**not** take the React/shadcn runtime. The page is gone (D8), so the
decision it carried is settled history and the toolchain went with it.

## Users

The client: a developer working on their own LAN with AI agents that run
inside a container the client controls. (confirmed) The agents are the ones
that publish and clear routes; the client reads the result in their own
shell or in the agent's answer. (confirmed)

## Product Purpose

The gatewarden: a registry and a relay inside the container that let agents
publish dev servers, which the client's own Traefik then serves on the LAN as
`https://<branch>.<project>.<zone>`, each project covered by one
wildcard certificate. (confirmed)

The route list is the client's overview of that: what the agents are running
right now, the host name of each route, the port inside the container, and
whether it answers. The overview is `gatewarden list`, `list_dev_servers`
and `/routes` — a view for the agent and for the client's own terminal, not
a page the client opens in a browser. (confirmed)

Success means the client can see what is running and act on it — open a dev
server, copy an address, or clear a stale route — without asking an agent.
(inferred from the brief: the route list's job is to be scanned at a glance
and acted on; the Remove flow and the "what is running" view exist for
exactly that.)

## Positioning

The gateway's own mechanism is that agents publish, the proxy serves, and
the route list reports the truth about both: it probes every registered
port and says whether anything answers, so a route that is registered but
dead cannot pass as working. (confirmed)

## Operating Context

- Agents run inside one container; their dev servers bind `127.0.0.1` inside
  it, so a relay forwards them to the container's address and the client's
  Traefik routes to it. (confirmed)
- The client reaches the gateway only over their LAN or VPN. The host names
  are public DNS names; the payload is not internet routable. (confirmed)
- The client's own proxy polls the registry's configuration path; the
  registry answers that path and its health probe, and nothing else
  (D9). (confirmed)
- The route list is read where the work happens: in the agent's answer and
  in the client's terminal. (confirmed)

## Capabilities and Constraints

Confirmed constraints that any future work must preserve, with the status
each one has after the web interface was removed (S3, §10.3):

| Constraint | Status |
| --- | --- |
| Runtime dependencies: only `env-paths` and `proper-lockfile`. No framework, no bundler, no runtime build, no runtime CDN request. (was: zero runtime dependencies) | **narrowed** — the two packages are runtime dependencies; the MCP SDK is not (D5) |
| The Traefik dynamic configuration document served at `/traefik` keeps every object it has today: the same names, the same shapes, the same rules. (was: the document must not change) | **changed** — the index router is removed (§10.1); every other object keeps its name and shape |
| The `X-Dev-Target` contract and the relay's trust boundaries stay as they are. | **kept** |
| The Remove flow, the `X-Gateway-UI: 1` guard and the `data-registration-id` attribute. | **removed** — the guard and the attribute belonged to the page and went with it |
| Creating a route by hand: the CLI's own semantics, with its own conflict rules. (was: `POST /api/registrations` with the `X-Gateway-UI: 1` guard, the same slug rule as the CLI and the same state file; a project and branch that already has a route is a conflict, never a silent update) | **changed** — the endpoint is gone; the agent-facing path updates in place (§6.2), while the CLI keeps its own semantics |
| No secret is configured for the registry, by the client's decision. Do not raise this again. | **kept** — the registry has no write endpoint, so the guard has nothing to guard |
| The index page must keep: live polling without a reload, grouping by project with the project's wildcard certificate, the host name that opens, the port, the age, the state, Copy address, Remove with confirmation, the empty state with the register command, the error state, phone-width responsiveness, keyboard focus, reduced motion, and no third-party request. | **removed** — the page is gone (D8) |
| The tests stay green, and other projects' live routes must keep working. | **kept** |

## Brand Commitments

- The product is called "Gatewarden", and the client's own zone and the
  wildcard naming `<branch>.<project>.<zone>` are facts of the
  product. (confirmed)
- The visual world of the index page — the Daylight world, the Up/Down
  badge, the typefaces — ended with the page (D8). Nothing of it is a
  commitment any more, and nothing of it is replaced by another visual
  world: the surfaces that are left are plain text. (confirmed)

## Evidence on Hand

- The live registry: real registrations with real host names and ports, and
  a real up/down answer per route. (confirmed)
- The gateway's own route list. (confirmed)
- No testimonials, no customers and no benchmarks exist, and none may be
  invented. (confirmed by absence)

## Product Principles

1. Show the truth, not the intention: a route that does not answer says so.
2. The route list is scanned, not read: the host name and the state must be
   legible at a glance.
3. The client's machine is the only client: no third-party request, ever.
4. Nothing the gateway does may break another project's live route.

## Accessibility & Inclusion

The page's own requirements — a visible focus ring, 4.5:1 body contrast,
`prefers-reduced-motion` — went with the page (D8). The surfaces that are
left are plain text in a terminal and in the agent's answer, where the
requirement does not apply. (confirmed)
