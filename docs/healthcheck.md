# The healthcheck of the package

`gatewarden doctor` is the healthcheck of the package. It reads the
installation and reports every check it made, with the reason for it.

It has to work everywhere: in a container that has no proxy, no zone, no
daemon and no public URL, and on a machine with an installation that is
broken. The rule it follows is short:

> **A thing that is not there is not an error. A thing that is there and
> broken is.**

The doctor changes nothing. It does not migrate the old layout and it
does not start a daemon.

## The statuses

| Status | What it means | The exit code |
| --- | --- | --- |
| `ok` | the thing is there and it works | 0 |
| `warn` | the thing is not there, or it is not complete — the reason says what to do about it | 0 |
| `fail` | the thing is there and it is broken | 1 |
| `skipped` | there is nothing to check here: the installation is not on this machine | 0 |

`--strict` turns the warnings into errors as well: the exit code is then 1
when a check is `warn` or `fail`. That is for the one who wants the whole
installation to be complete, not only unbroken.

The JSON form (`gatewarden doctor --json`) holds the same report as one
object, with a top-level `ok` that is `false` when a check failed:

```json
{
  "ok": true,
  "strict": false,
  "checks": [
    {
      "name": "config file",
      "status": "ok",
      "detail": "/home/user/.config/gatewarden/config.json"
    },
    {
      "name": "daemon",
      "status": "warn",
      "detail": "not running (pidfile /home/user/.local/state/gatewarden/daemon.pid): it starts with the first route, or run \"gatewarden start\""
    }
  ],
  "paths": {
    "configPath": "/home/user/.config/gatewarden/config.json",
    "stateDir": "/home/user/.local/state/gatewarden",
    "logFile": "/home/user/.local/state/gatewarden/daemon.log"
  }
}
```

## The checks

| Check | `ok` | `warn` / `skipped` | `fail` |
| --- | --- | --- | --- |
| `config file` | the file is there and it is read | the file is not written yet: there is no installation here | the file is there and cannot be read |
| `state directory` | the directory is there and it can be written to | it does not exist yet: the daemon creates it | it is there and cannot be written to |
| `daemon` | it runs and answers `/healthz` | it has not started: it starts with the first route, or another gateway answers on the port | it runs and does not answer, or the installation has declared itself and its daemon does not run |
| `dns zone` | the zone is set | the file says nothing about the zone: the wizard writes it, or the user writes it by hand | the file declares a zone and it is empty |
| `shared middlewares` | a provider owns them | they are not in use, or no provider owns them yet | — |
| `registry port` | something listens there | nothing listens there: the daemon has not started it | — |
| `relay port` | something listens there | nothing listens there: the daemon has not started it | — |
| `routes` | the routes are counted | — | — |
| `routes and zone` | the routes have a zone | there are no routes, or the configuration has no zone yet: a new route cannot be named | — |
| `proxy` | the proxy answers | no proxy answers: it runs on another machine | the proxy answers and is not the one of the configuration, or the adapter does not exist |
| `service` | the unit is installed | it is not installed: run `gatewarden install-service` | — |
| `legacy layout` | — | there is nothing to migrate | — (it is still there: a warning) |
| `old name layout` | — | there is nothing to migrate | — (it is still there: a warning) |
| `old service` | — | there is no unit of the old name | — (it is still there: a warning) |

Two of them are worth reading twice:

* **The daemon is lazy.** It starts by itself with the first route, so a
  daemon that does not run is the normal state of a fresh installation.
  It is a warning with a reason, not an error.
* **The zone says whether the installation is set up.** A configuration
  file that says nothing about the zone belongs to an installation that
  is not set up here: the zone is one of the things to do, with the
  reason and the way to get one, and the doctor exits 0. A configuration
  file that *declares* a zone and leaves it empty is a file that is
  wrong — the host names of the routes cannot be built from it — and
  that is a failure. A file that declares a zone has declared an
  installation, and its daemon has to run.

## `gatewarden status`

The status is a report, not a check. It runs everywhere — on a machine
with an installation and on one without — and its exit code is 0 in both
cases. A configuration file that cannot be read is reported in the output
(and in the `error` key of the JSON form), not thrown.

A script that wants to know whether the gateway serves reads
`daemon.healthy` of `gatewarden status --json`.

## The verification of `gatewarden setup`

The wizard tells two things apart:

* **The verification could not run** — there is no proxy to fetch the
  public URL from, there is no zone to build it from, the name does not
  resolve, nothing listens on the port, or the proxy does not serve the
  route yet. The status is `skipped`, the reason says which, and the exit
  code of `gatewarden setup` is 0.
* **The verification ran, and the chain answered with an error** — the
  relay refused the request (the trust list), the proxy refused it (its
  own middleware), the public URL answered with an error (a 500, say), the
  certificate of the public URL is not trusted, or the proxy knows the
  route and does not serve it. The status is `failed`, the reason says
  which, and the exit code is 1. The reason is the answer that came: a
  port that speaks plain HTTP and not TLS says so, and that is not a
  certificate the machine does not trust.

The wizard writes the next steps in clear text, in every mode.

## What the other documents say

`README.md` and `docs/setup.md` describe the doctor as it was before
this change: they name the checks and say that the exit code is 1 when a
check fails. Both are written for the installation on a machine that has
one; this file is the description of the healthcheck itself.
