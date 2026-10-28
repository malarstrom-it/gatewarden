---
name: traefik-dev-gateway
description: Expose a dev server running in this container to the user's own machine over the LAN through the Traefik gateway. Use whenever a dev server is started (Vite, Next, Nuxt, python -m http.server, any local port) and needs to be reachable from outside the container, or when the user asks for a URL, a preview, or a way to open a locally running app. Registers the port and returns https://<branch>.<project>.home.malarstrom.com. Does not apply to servers that are already published by Docker labels.
---

# Traefik dev gateway

Give a dev server that runs **inside this container** a public URL on the user's LAN:

    https://<branch>.<project>.home.malarstrom.com

The user's Traefik terminates TLS with a valid per-project wildcard certificate. The user sees every
registration with `traefik-dev list`.

## Register a dev server

```bash
node ~/projects/traefik-api/bin/traefik-dev.js register --project <project> --branch <branch> --port <port>
```

It prints the URL:

```
registered feature-login.alpha.home.malarstrom.com -> 127.0.0.1:5173 (dev server is up)
url: https://feature-login.alpha.home.malarstrom.com
```

The gateway daemon starts itself on the first `register` — there is no other step. Give the user the
URL the command prints; do not compose it by hand.

## Unregister when the dev server is gone

```bash
node ~/projects/traefik-api/bin/traefik-dev.js unregister --project <project> --branch <branch>
```

Do this when the dev server is stopped, so the route list does not keep dead links.

**You must still unregister yourself.** The user can also remove a stale route by hand with the
same command, which is a fallback for the case where an agent forgot. Do not rely on it:
unregister when you stop the dev server, and use the CLI.

## Inspect

```bash
node ~/projects/traefik-api/bin/traefik-dev.js list      # every registration, its port and up/down state
node ~/projects/traefik-api/bin/traefik-dev.js status    # daemon pid, ports, configuration
```

The overview for the user: `traefik-dev list`.

## Notes

* The dev server may keep listening on `127.0.0.1` — a relay in this container forwards to it.
  Register the port the dev server **actually** listens on.
* `--project` and `--branch` are slugified (lower-case, anything outside `[a-z0-9-]` becomes `-`).
  The URL uses the slugs, so print the returned URL rather than building it yourself.
* The certificate is issued per project (`*.<project>.home.malarstrom.com`) and is usually valid
  about ten seconds after the router appears. The first request may fail briefly while it is being
  issued; retry.
* This skill is for servers started inside this container. A server that already gets a URL from
  Docker labels does not need it.

## When something does not work

Read `references/troubleshooting.md` for the failures that actually occur, and
`references/architecture.md` for how the pieces fit together.
