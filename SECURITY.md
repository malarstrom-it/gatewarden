# Security Policy

The gatewarden (`@malarstrom/gatewarden`) gives a development server on your
own machine an https address on your own domain. It runs two listeners — a
**registry** that serves the proxy's configuration document, and a **relay**
that forwards a request to your dev server — and it never talks to anything
except the proxy and the dev server you named.

This document says where a security report goes, how fast it is answered, and
what the package already protects on its own.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

A version that is not in the table gets no fix. The list is short while the
package is young: it grows with every minor version.

## Reporting a vulnerability

**Report it privately. Do not open a public issue for a vulnerability.** A
public issue tells every reader of the repository that the flaw exists, and
a public issue cannot be unsaid afterwards. Public issues are for bugs that
are already harmless to know about.

Two private ways to report, and both are fine:

1. **The security advisory form of the repository.** Open the repository on
   Gitea, go to the "Security" tab, and use "Report a vulnerability". The
   report stays in the repository's private advisory area until it is
   published.
2. **Email to the maintainer**: `mikael@malarstrom.se`, with the subject
   `security: @malarstrom/gatewarden`. Plain text is fine; an encrypted
   message is not needed. Use the email when the advisory form is
   unavailable, or when you want to talk about the flaw before you have
   written it up.

### What to report

A vulnerability in this package is anything that lets someone do something on
a machine that runs the package, without the owner's intent. In practice
that means:

- **Code execution on the consumer's machine.** The package runs a
  `postinstall` script on the machine it is installed on. It writes the
  configuration file and starts nothing, but a flaw that makes the
  install run something the owner did not ask for belongs here.
- **Reaching a service that should be unreachable.** The registry and the
  relay listen on the network. A flaw that lets a request that did not come
  from the proxy read the configuration document, or dispatch a request to a
  dev server, belongs here.
- **Reading or writing files outside the package's own directories.** The
  package writes a configuration file, a state file, a pid file and a log
  file. A flaw that makes it read or write anywhere else belongs here.
- **A host name that escapes its zone.** A registration builds its host name
  from the project and branch label. A flaw that lets a label put a host
  name outside the configured zone belongs here.

### What to send

- the version: `gatewarden --version` (or the `version` field of
  `package.json`);
- what an attacker does, in one paragraph;
- the smallest reproduction that shows it — the command, the request, or the
  configuration file;
- what the owner can do to be safe in the meantime, if you know it;
- how you want to be credited: a name, or "do not credit me".

Do not send a proof of concept that damages data, takes data out of the
machine, or reaches a third party's system. A minimal proof against your own
machine is enough.

### What happens after the report

| When | What |
| --- | --- |
| within 72 hours | the report is acknowledged |
| within 7 days | the report is assessed: a flaw, a limitation of the design, or not a flaw |
| within 14 days | a fix or a mitigation is published |

If a fix cannot ship within 14 days, the report is told that, with a date.
Until the fix is out, no dates, no keys and no user data go into a public
issue.

The disclosure is a security advisory on the repository, an `npm deprecate`
note on the version when the flaw makes the version unusable, and a new
version on npm. The reporter is credited in the advisory unless the reporter
asks not to be.

**The response times are a promise about a volunteer.** The 72 hours is an
acknowledgement, not an analysis. A report that is not acknowledged within 72
hours is a fault in this process: send it again to the email address.

## What the package already protects

This is the list of the protections that exist today. It is here so that a
reporter does not have to rediscover them, and so that a reader can see
where the weak spots are.

### The registry has no write path

The registry serves exactly two endpoints: the dynamic configuration document
(`GET /<proxy>`) and the health probe (`GET /healthz`). Every other path is
a 404, and every method other than `GET` and `HEAD` is a 405. The web
interface that used to exist is gone: there is no page, no route list and no
create or delete endpoint. The CLI, the MCP server and the pi extension
write the state file directly, so the registry has no write path left to
guard.

### The relay only answers the proxy

Every request to the relay — and every WebSocket upgrade — is checked
against the trust boundary before anything else happens:

- the source address must be inside one of the CIDRs in `allowedCidrs`
  (the default is `127.0.0.1/32` and `::1/128`);
- when `secret` is set, the `X-Relay-Secret` header must match it.

A request that fails either check gets a 403 and is logged, and nothing else
happens. The relay only ever connects to `127.0.0.1`, on a port that a
registration already names: a request cannot choose the address it reaches.

### The configuration document is behind the same secret

When `secret` is set, the document is only served to a caller that presents
`X-Registry-Secret`; without it the answer is a 403. The document names the
host names and the ports of the dev servers, so it is worth protecting. The
health probe is not behind the secret: it answers `ok` and nothing else.

### The install script cannot fail the install, and does nothing it was not asked to do

The `postinstall` script:

- always exits 0 — a broken install is worse than a missing configuration
  file;
- writes nothing to stdout or stderr;
- does nothing in a CI environment, when `npm_config_ignore_scripts` is set,
  when the install runs as root, and when `GATEWARDEN_AUTOSTART=0` is set;
- does nothing in a checkout: `npm install` in a clone never writes into the
  developer's home;
- writes the configuration file once, and never overwrites it, and creates
  the two directories the package needs (the state directory and the cache
  directory) — nothing else;
- **starts no daemon, opens no port and leaves no process behind.** The
  daemon is started by the lazy start — every command starts it when it is
  down — and by `gatewarden start`. The install is not one of them.

### The state file is locked while it is written

The route state is written under a lock (`proper-lockfile`), so two
processes that register at the same time cannot lose a registration.

### Host names are built from slugified labels

The project and branch labels are slugified before they become a host name,
so a label cannot put a name outside the configured zone.

## Known limits

These are not fixed today. They are written down so that a reader knows what
the protections above do not cover.

- **The configuration file holds the shared secret in plain text.** It is
  written with the default permissions of the process (0644, subject to the
  umask). On a machine with several users, tighten it with `chmod 600`.
- **The listeners bind to every interface.** The registry and the relay
  listen on the IPv6 wildcard `::` when the machine has an IPv6 prefix (a
  dual stack socket, which takes IPv4 traffic too), and on `0.0.0.0` when it
  has not. The proxy on another machine has to reach them, so they are not
  bound to the loopback. The `allowedCidrs` list and the secret are what
  keep the wrong callers out; a machine that should not be reachable at all
  needs a firewall.
- **The secret is compared, not signed.** It travels as a header on a plain
  HTTP connection. Use it on a network you trust, or tunnel it.
- **The daemon is not the install's business.** The daemon is a background
  process that the package starts when a command needs it (the lazy start)
  or when `gatewarden start` says so. It runs until it is stopped, and
  `gatewarden stop` stops it. The install itself starts nothing, so a
  freshly installed package is a machine with a configuration file and no
  process on it.
- **One factor, not two.** The shared secret is the only thing that stands
  between an unknown caller and the relay. It is a secret, not a second
  factor.
