---
name: dev-gateway
description: Publish a development server running on this machine so the user
  can open it in a browser on their network. Use when a dev server is started
  (Vite, Next, Nuxt, python -m http.server, any local port) and the user needs
  a URL to open it.
---

# Publish a development server

Give a development server that runs on this machine an address the user can open
in a browser, on their own network.

## Publish it — the MCP tool first

Call `publish_dev_server` with the port the server listens on:

```json
{ "port": 5173 }
```

`project` and `branch` are optional. Without them the project is the name of the
working directory and the branch is the branch of the working directory, both
slugified. The answer carries the address:

```json
{
  "url": "https://main.my-app.example.com",
  "fqdn": "main.my-app.example.com",
  "project": "my-app",
  "branch": "main",
  "port": 5173,
  "state": "up"
}
```

Give the user the `url` verbatim. Never compose the host name yourself: the
zone, the certificate and the routing belong to the gateway.

Publishing the same project and branch again updates the route in place, so a
restarted development server keeps its address.

## Without MCP — the CLI

```bash
dev-gateway register --project my-app --branch main --port 5173
```

```text
registered main.my-app.example.com -> 127.0.0.1:5173 (dev server is up)
url: https://main.my-app.example.com
```

`--json` prints one object instead of those two lines, for scripts.

## Remove it when the server is gone

```bash
remove_dev_server { "project": "my-app", "branch": "main" }
dev-gateway unregister --project my-app --branch main
```

Do this when you stop the development server, so the route list does not keep
dead links. The user can also remove a stale route by hand with the same
command; that is a fallback for the case where an agent forgot, not a
replacement for unregistering yourself.

## What is published

```bash
list_dev_servers      # the address of every route, and whether its port answers
dev-gateway list      # the same list as a table
dev_gateway_status    # the daemon, the proxy, the configuration
dev-gateway status
```

## When the gateway is not set up yet

`dev-gateway setup` walks the installation through: it finds the proxy, writes
the wiring the proxy needs, writes the configuration and starts the daemon. Run
it once, on the machine that runs the gateway.

## Notes

* The development server may listen on `127.0.0.1` only; the gateway's relay
  forwards to it. Register the port the server actually listens on.
* The project and the branch are slugified (lower case, anything outside
  `[a-z0-9-]` becomes `-`) and the address is built from the slugs. Print the
  returned address rather than building it yourself.
* The certificate is issued for the project (`*.<project>.<zone>`) and can take
  a few seconds to appear. The first request may fail briefly; retry.
* This skill is for servers started on this machine. A server that already gets
  an address from somewhere else (a container label, a tunnel) does not need it.

## When something does not work

Read `references/troubleshooting.md` for the failures that actually occur, and
`references/architecture.md` for how the pieces fit together.
