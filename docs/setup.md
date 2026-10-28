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
the middleware provider. The routers of Traefik itself — the API, the
dashboard, the ACME challenge — are left out: they say nothing about the
routes of the user. The dispatch middleware of the gateway is left out as
well: it lives in the HTTP provider, and the provider of it is not the
provider of the middlewares the user shares.

The port of every entry point is read as well (`/api/entrypoints`): a proxy
that serves the routes on another port (8443, say) needs the port in the
public URL, and nobody can guess it.

What cannot be derived is asked for — **the value in the configuration file is
the default in the question, not an answer**. The host name the proxy reaches
this machine under is asked for as well: the proxy's API does not say it, and
the wiring is written with it. The trust list is asked for too: the proxy is
the one that sends the dispatch header to the relay, and the wizard offers the
addresses of the proxy it talked to as the default in the question. **An
answer adds to the list that was offered** — the wizard never removes an
address from the trust list, so a list of your own cannot take the loopback
away and break every route with a refusal from the relay. Remove an address
by editing the configuration file. When there is nobody to ask (a
non-interactive run, a machine without a terminal, a question that times out),
the value is kept and reported as unconfirmed, together with where every value
came from: the proxy, the user, the configuration file or the built-in
default. A value that is kept and is the built-in default is not written to
the configuration file at all: a new installation does not get the zone of
another project.

The built-in defaults are neutral: the zone, the certificate resolver, the
provider of the shared middlewares and the host name are empty, and the trust
list holds the loopback addresses of every machine. Nothing of one
installation is in the package.

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
4. Fetch the public URL and require a successful response (`public URL`). The
   URL is fetched over HTTPS first; a proxy that serves the zone over plain
   HTTP answers the second try. The port of the entry point the routes
   attach to is tried as well. The answer has to be the answer of the
   throwaway server: something else may answer a request for a route with a
   successful response (the dashboard of the proxy does), and that is not the
   route.

   **The certificate of the public URL has to be trusted by the machine that
   runs the wizard.** The check is never switched off. A test environment
   trusts its own certificate authority with `NODE_EXTRA_CA_CERTS`; a
   machine that does not trust it gets a failed verification that says the
   certificate is the reason. A plain HTTP answer does not make it pass: the
   public URL is served over HTTPS, and a URL whose certificate is not
   trusted is not usable. Every attempt is reported, so a URL that did not
   answer stays visible.
5. Remove the route and stop the throwaway server (`cleaned up` — the route is
   removed and the server stopped whatever the outcome was). A route of the
   user that has the same name is put back.

When the proxy knows the URL but does not serve the route, the verification
is **skipped**: the wiring has to be added to the proxy first, and the
wizard cannot apply it (§9.4). That is not a failed setup, and the exit
code says so.

When the relay **refuses** the request (403), the verification **fails** and
the reason names the trust list: the relay only serves the addresses in
`allowedCidrs`, and a refusal is neither a certificate problem nor a proxy
that does not know the route. A proxy that refuses the request **itself** — an
`ipAllowList`, a `forwardAuth`, a middleware of its own — is a different
thing, and the wizard says so instead of sending the user to the trust list.

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

A daemon that is already running serves the configuration it was started
with, so the wizard restarts it: otherwise the document the proxy polls is
the old one, and the verification would check the old configuration. The
routes live in the route store and not in the daemon, so a restart does not
lose them. A route keeps the host name it was registered with — and the
certificate of the route is built from the zone of the route, so the
certificate covers the name the route was given. A new zone applies to the
routes that come after it.

The values nobody confirmed are not written when they are the built-in
default: a new installation would otherwise get the zone of another project
in its configuration file. They are listed in `config.omitted`.

## The report

`dev-gateway setup --json` writes one object with:

| Field | What it holds |
| --- | --- |
| `environment` | what step one found |
| `proxy` | what step two found, and what it derived |
| `wired` | the answer of step three |
| `wiring` | the path and the content of the snippet of step four |
| `verification` | `verified`, `failed` or `skipped`, with the reason and the steps |
| `config` | the path, the values, where every value came from (`sources`), the values nobody confirmed (`unconfirmed`) and the values that were not written (`omitted`) |
| `daemon` | whether the daemon runs after the wizard, and whether it was restarted |
| `nextSteps` | what the user should do next |

The exit code is 1 when the verification failed, in every mode — a script
sees it. It is 0 when the verification was skipped: there was no proxy to
verify against.

With `--json` the report is written as one object and nothing else. In the
text output the steps are written as they happen, and the verdict is in the
report and in the exit code.

## The values the wizard writes

| Key | Meaning |
| --- | --- |
| `zone` | the DNS zone the host names are built from |
| `entryPoints` | the proxy entry points the routers attach to |
| `certResolver` | the certificate resolver the routers ask for; empty means no TLS block |
| `middlewareProvider` | the proxy provider that owns the shared middlewares |
| `advertisedHost` | the host name the proxy reaches this machine under |
| `allowedCidrs` | the sources that may send the dispatch header to the relay |

The wizard does not touch the ports or the secret: they are the
installation's own, not the proxy's.

Without a zone there is no host name: the verification is skipped with that
reason, and the wizard says that the zone has to be set. `dev-gateway
register` refuses a route without a zone and says how to get one.
