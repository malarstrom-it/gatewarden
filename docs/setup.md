# The setup wizard

```bash
dev-gateway setup
```

Six steps, five of them automatic. The wizard never pretends: when it cannot
verify something, it says so. A setup that half worked and says so is worth
more than a setup that claims everything is fine.

## The flags

| Flag | What it does |
| --- | --- |
| `--json` | writes the report as one JSON object and nothing else |
| `--non-interactive` | never asks; keeps the values the configuration has |
| `--yes` | the same as `--non-interactive` |
| `--no-verify` | skips the end-to-end verification |
| `--proxy <id>` | the proxy to set up (default: the configured one) |
| `--api-base-url <url>` | where the proxy's API answers |
| `--poll-interval <ms>` | how long the proxy gets to pick the route up (default: 3000) |
| `--prompt-timeout <s>` | how long a question waits for an answer (default: 30) |

Without a terminal (no TTY on the standard input) the wizard never asks: it
keeps the values the configuration file holds and reports them as
unconfirmed.

## The six steps

### 1. Read the environment

Whether this is a container, the platform, the addresses a proxy could reach,
the working directory, the state directory, the configuration file and whether
a daemon is already running.

### 2. Discover the proxy

The proxy adapter is asked what the proxy is: for Traefik it reads
`/api/version` and `/api/http/routers`. From the routers it derives the zone
(the common host-name suffix), the entry points, the certificate resolver and
the middleware provider.

What cannot be derived is asked for — **the value in the configuration file is
the default in the question, not an answer**. When there is nobody to ask (a
non-interactive run, a machine without a terminal), the value is kept and
reported as unconfirmed, together with where every value came from: the proxy,
the user, the configuration file or the built-in default.

### 3. Is the proxy already wired?

Whether the proxy already has a provider pointing at this machine: a router
whose provider is the HTTP provider and whose service points at this host and
port.

The machine is known by more than one name — the advertised host name and the
advertised IP. The proxy may reach it by either, and a name that resolves to an
address is the same machine as that address.

When the proxy is already wired, the wizard skips to step five and verifies.

### 4. Emit the wiring

The wizard prints the exact static configuration to add, with the values
filled in for this machine, and writes it to `<state>/wiring/<proxy>.yml` so
that it can be copied.

**The wizard cannot apply it.** The proxy's configuration lives on another
machine, and the gateway process runs without the privileges to write it. The
wizard says so plainly instead of pretending.

### 5. Verify end to end

1. Start a throwaway server on a free port (`throwaway server`).
2. Register it (`route registered`).
3. Wait for one poll interval.
4. Fetch the public URL and require a successful response (`public URL`).
5. Remove the route and stop the throwaway server (`cleaned up` — the route is
   removed and the server stopped whatever the outcome was).

Each step is reported as it goes, and what could not be verified is reported
too. Without a proxy that answers there is no public URL to fetch, and the
verification is **skipped** with that reason — not failed.

The verification needs a gateway that serves the dynamic document: the proxy
polls the document, and the document has to carry the throwaway route. The
configuration is therefore written and the daemon started *before* the
verification — a verification against a gateway that is not up yet verifies
nothing. Step six reports what the verification needed; it does not introduce
it.

### 6. Write the configuration and start

The derived values are written to the configuration file, the daemon is
started, and the wizard recommends `dev-gateway install-service` for
surviving a reboot.

Both happen before the verification of step five, because the verification
needs them.

## The report

`dev-gateway setup --json` writes one object with:

| Field | What it holds |
| --- | --- |
| `environment` | what step one found |
| `proxy` | what step two found, and what it derived |
| `wired` | the answer of step three |
| `wiring` | the path and the content of the snippet of step four |
| `verification` | `verified`, `failed` or `skipped`, with the reason and the steps |
| `config` | the path, the values, where every value came from (`sources`) and the values nobody confirmed (`unconfirmed`) |
| `daemon` | whether the daemon runs after the wizard |
| `nextSteps` | what the user should do next |

With `--json` the exit code is 1 when the verification failed, and 0 otherwise —
including when it was skipped. In the text output the exit code is always 0;
the verdict is in the report.

## The values the wizard writes

| Key | Meaning |
| --- | --- |
| `zone` | the DNS zone the host names are built from |
| `entryPoints` | the proxy entry points the routers attach to |
| `certResolver` | the certificate resolver the routers ask for; empty means no TLS block |
| `middlewareProvider` | the proxy provider that owns the shared middlewares |
| `advertisedHost` | the host name the proxy reaches this machine under |

The wizard does not touch the ports, the trust list or the secret: they are
the installation's own, not the proxy's.
