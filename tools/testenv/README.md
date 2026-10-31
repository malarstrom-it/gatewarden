# The test environment

The isolated environment the end-to-end test runs in (D11, §11 of
`specs/tech-architecture/gatewarden.md`).

```bash
npm run test:e2e
```

That one command brings the whole environment up, runs the end-to-end
test against it, and tears it down again — whatever the outcome.

```bash
npm run test:e2e:stop
```

That one stops what an interrupted run left behind: the proxy and the
daemon of a run that was killed before it could clean up. The next
`npm run test:e2e` stops them as well, so the command always comes up
again.

## What is in it

| | the live system | the test environment |
| --- | --- | --- |
| the registry | port 45002 | port 46002 |
| the relay | port 45001 | port 46001 |
| the domain | `home.malarstrom.com` | `gwtest.local` |
| the state directory | `~/.local/state/gatewarden/` | `/tmp/gatewarden-test/` |
| the proxy | the Traefik of the user | a Traefik the test downloads and starts |
| the certificates | the ACME certificates of the user | a CA and a certificate the test makes |

The test proves the isolation instead of promising it: it takes a
snapshot of the listeners of the ports of the live system before the
environment comes up and another one when the test is done, and the two
have to be the same. It also says which processes hold the ports of the
test environment, so that a port of the live system that the test had
bound would show up.

## What the teardown removes

The directory of the environment may be one the user pointed at
(`GATEWARDEN_TESTENV_ROOT`), and it may hold files that are none of
the environment's business. The teardown therefore removes **only what
the environment wrote**: the entries that were not there before the run,
and the entries that carry one of the names of the environment
(`config.json`, `daemon.pid`, `daemon.log`, `routes.json`,
`routes.json.lock`, `proxy/`, `certs/`). Everything else stays where it
is, and the directory itself stays when something is left in it.

An interrupted run is torn down as well: the command stops the proxy and
the daemon when it gets `SIGINT` or `SIGTERM`. A run that is killed with
`SIGKILL` cannot do that — `npm run test:e2e:stop` stops what it left
behind, and the next run stops it too. Only the processes that are
provably ours are stopped: the Traefik binary the test downloaded and
the daemon that runs with the configuration file of the test. A process
that holds one of our ports and is not one of those is reported and left
alone.

## What the pieces do

| File | What it is |
| --- | --- |
| `settings.ts` | the ports, the domain, the paths and the overrides of the environment |
| `ports.ts` | who listens on which port, read out of `/proc` |
| `certs.ts` | the CA and the certificate of the test domain, made with OpenSSL |
| `traefik.ts` | the download of the Traefik binary and its start and stop |
| `proxy-config.ts` | the static configuration of the test proxy |
| `environment.ts` | the bring-up and the tear-down of the environment |
| `leftovers.ts` | the processes of an interrupted run, and how they are stopped |
| `stop.ts` | the command that stops the leftovers |
| `e2e.ts` | the end-to-end test itself |
| `run.ts` | the one command |

The proxy is a real Traefik — the same version as the user's (3.7.16),
downloaded from its GitHub release and checked against the checksum file
of the release. The download is not used when the checksum file cannot be
read: a binary that cannot be checked is not run. The container has no
Docker and no Docker socket, so the test proxy cannot be a container
(§11.2).

The binary is kept in `tools/testenv/.cache/` between the runs. The
directory is not in the repository.

## The certificates

The test cannot have an ACME certificate: that needs a public domain and
a public authority. It therefore makes its own authority and a
certificate for the test domain, and the test client trusts that
authority and nothing else.

Traefik takes the certificate out of the file provider, which reads the
`tls.certificates` section of a dynamic configuration
(`proxy-config.ts`). The resolver `testca` is declared in the static
configuration because the routers the gateway generates ask for it by
name; it points at an authority that does not answer, so it fails
quietly instead of reaching out to the internet.

## The name of the domain

The name of a route has to resolve for a client that asks for it by
name — the setup wizard does (§9.5). The environment adds
`127.0.0.1 gwtest.local` to the hosts file when it may write it, and
removes the entry when it goes down. A process that cannot write the
hosts file (the usual case: the test does not run as root) says so, and
the end-to-end test asks for the public URL by address with the name of
the route as the host and as the name of the TLS handshake.

The authority of the test is handed to the daemon and to every child of
it through `NODE_EXTRA_CA_CERTS`, so that a client of the environment
trusts the certificate of the test and nothing else.

## The overrides

| Variable | What it changes |
| --- | --- |
| `GATEWARDEN_TESTENV_ROOT` | the directory the environment writes in |
| `GATEWARDEN_TESTENV_CACHE` | where the Traefik binary is kept |
| `GATEWARDEN_TESTENV_DOMAIN` | the domain the routes are served under |
| `GATEWARDEN_TESTENV_REGISTRY_PORT` | the port of the registry |
| `GATEWARDEN_TESTENV_RELAY_PORT` | the port of the relay |
| `GATEWARDEN_TESTENV_PROXY_PORT` | the port of the test proxy |
| `GATEWARDEN_TESTENV_API_PORT` | the port of the API of the test proxy |
| `GATEWARDEN_TESTENV_TRAEFIK_VERSION` | the version of Traefik |
| `GATEWARDEN_TESTENV_KEEP` | keep the files of the environment when it goes down |

The names these variables had before the rename (`DEV_GATEWAY_TESTENV_*`) are
still read, below the current ones. They are deprecated: the current name
wins when both are set.

The ports of the live system are not overridable: they are the ports the
test has to leave alone.

## What the test needs

Node (the version the package asks for), OpenSSL and a network that
reaches the GitHub releases — once, to download the proxy.
