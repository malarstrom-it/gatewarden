# Naming — every public name in the package

**Status:** inventory and recommendations. **This slice renames nothing.**
S13 gathers the names and weighs the alternatives; a later slice renames, with
the decisions of §8 taken first.

Written 2026-10-28, for the publication of the package on npmjs.org.

The scope of this document is every name a stranger can see: the package on
npm, the binaries on a PATH, the words on a command line, the tool names an
agent calls, the variables in a shell, the keys in a JSON file, the
directories in a home, the units in a service manager, the headers on the
wire, the files in a repository and the title of the repository itself.

---

## 1. Method, and the two facts that frame every cost

**Method.** Every name was found by grepping the repository for what a user
can type, read or see (`git grep` over `src/`, `test/`, `bin/`, `docs/`,
`skills/`, `scripts/`, `package.json`, the workflows and the specifications),
not by reading the code top to bottom. Each candidate was then checked
against the npm registry (`npm view <name> version`, or a request to
`https://registry.npmjs.org/<name>`); the results are in §7.

**Fact one — the package has never been published.** `npm view
@malarstrom/agent-dev-gateway version` answers 404. Nobody has the new names
yet, so every name in this package can still be changed for free. The
expensive part of a rename — the users who already have it — has not started.

**Fact two — an older installation does exist.** The live gateway keeps
`~/.traefik-dev/`, its scripts may set `TRAEFIK_DEV_CONFIG` and
`TRAEFIK_DEV_STATE_DIR`, and the daemon reads `TRAEFIK_DEV_LOG_LEVEL`. Those
names are in use *now*, by the running system, and a rename must not break
them. This is the difference between the two groups of legacy names in §4.3.

---

## 2. The rules the names are measured against

| # | Rule | Where it comes from |
| --- | --- | --- |
| R1 | The name says what it is to someone who has never heard of this project. | the brief |
| R2 | One word, one language, one separator: lower case, kebab-case, English. | the brief |
| R3 | The name carries no name of one installation, of the author's organisation, or of one proxy adapter — unless the convention of the place asks for it (an npm scope, a launchd label). | the brief |
| R4 | The name is available where the world will meet it (the npm registry, the global bin directory). | the brief |
| R5 | One concept, one name, everywhere it appears: package, binary, command, tool, directory, unit and documentation say the same thing. | derived from R2 |
| R6 | A name that already works for somebody else keeps working: the old directory, the old variables, the old binaries. | derived from fact two in §1 |

R5 is the rule that does most of the work in this document. The package today
has one product with four spellings (`dev-gateway`, `agent-dev-gateway`,
`traefik-dev`, `malarstrom`) and two vocabularies for the same act
(`register`/`unregister` on the command line, `publish_dev_server`/
`remove_dev_server` in the agent protocol).

---

## 3. The inventory

Every row is a name the world can see. "Verdict" points to the section that
weighs it.

### 3.1 The npm package

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `@malarstrom/agent-dev-gateway` | `package.json` `name`, the README title, the install line, `npm view`, the pi installer | the package | §4.5 |
| scope `malarstrom` | the same | the publisher's npm organisation | §4.5 |
| `description` | `package.json`, the npm search page | "Publish a development server running on this machine to an address the user can open in a browser: an MCP server, a pi extension, a CLI and an Agent Skill over one proxy-agnostic core" | §5 (keep) |
| `keywords` | `package.json`, npm search | `pi-package`, `mcp`, `traefik`, `dev-server`, `agent` | §5 (keep) |
| `license: MIT` | `package.json`, `LICENSE` | the licence | §5 (keep) |
| `exports["."]` → `dist/core/index.js` | `package.json` | the library entry point | §5 (keep) |
| `exports["./adapters"]` | `package.json` | the proxy adapters | §5 (keep) |
| `pi.extensions`, `pi.skills` | `package.json` | how pi finds the extension and the skill | §5 (keep) |
| `files` | `package.json` | the allow-list of the tarball | §5 (keep) |

### 3.2 The binaries

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `dev-gateway` | `package.json` `bin`, `bin/dev-gateway.js`, the PATH, every command in the docs, the `Description=` line of the systemd unit | the CLI | §4.1 |
| `dev-gateway-mcp` | `package.json` `bin`, `bin/dev-gateway-mcp.js`, the `mcpServers` snippet in the README (which the user pastes into the client's configuration), the configuration of every MCP client that uses the package | the MCP server | §4.1 |
| `dev-gateway-daemon` | `package.json` `bin`, `bin/dev-gateway-daemon.js`, the `ExecStart=` line of the systemd unit, the launchd plist, the Windows scheduled task | the daemon | §4.1 |
| `traefik-dev` | `bin/traefik-dev.js` (in the repository only; **not** in the `bin` map and **not** in `files`, so it was never published) | the pre-package name of the CLI | §4.3 |
| `traefik-devd` | `bin/traefik-devd.js` (same: repository only) | the pre-package name of the daemon | §4.3 |

### 3.3 The CLI

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `register` | the CLI, the skill, `AGENTS.md`, the README | publish a dev server to the proxy | §4.2 |
| `unregister` | the same | remove the publication | §4.2 |
| `list` | the same | list the published servers | §5 (keep) |
| `status` | the same | the state of the daemon, the proxy and the configuration | §5 (keep) |
| `config` | the same | show and write the configuration | §5 (keep) |
| `setup` | the same | the wizard of §9 of the specification | §5 (keep) |
| `start` / `stop` | the same | the daemon lifecycle | §5 (keep) |
| `doctor` | the same | report what is broken | §5 (keep) |
| `install-service` | the same | install the daemon as a service | §5 (keep) |
| `migrate` | the same | import the old layout | §5 (keep) |
| `version` | the same | the version of the package | §5 (keep) |
| `--config`, `--state-dir` | the CLI, the daemon, the worker, the MCP server, the service unit | the configuration file and the state directory | §5 (keep) |
| `--json` | every command that reports | machine-readable output | §5 (keep) |
| `--write`, `--dry-run`, `--no-enable`, `--no-verify`, `--yes`, `--non-interactive` | the CLI, the wizard | the modifiers of the commands above | §5 (keep) |
| `--proxy`, `--api-base-url`, `--poll-interval`, `--prompt-timeout` | the wizard (`docs/setup.md`) | the knobs of the discovery | §5 (keep) |
| `--project`, `--branch`, `--port`, `--label` | `register`, `unregister` | what is published | §5 (keep) |
| the table columns `PROJECT BRANCH FQDN PORT STATE UPDATED` | `src/cli/index.ts:295` (the `list` command) | the columns of the CLI's route table | §4.9 |
| the JSON keys `routes` and `registrations` | `src/cli/index.ts:271` (`list --json`) | the machine-readable shape of the same list | §4.9 |

### 3.4 The MCP surface

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `dev-gateway` (server name) | `serverInfo.name`, `test/packaging.test.ts`, the `mcpServers` snippet | the MCP server's identity | §5 (keep) |
| `publish_dev_server` | the MCP tool list, the pi tools, the skill, `AGENTS.md`, the README | publish a dev server | §5 (keep) |
| `remove_dev_server` | the same | remove it | §5 (keep) |
| `list_dev_servers` | the same | list what is published | §5 (keep) |
| `dev_gateway_status` | the same | the state of the gateway | §5 (keep) |
| the field names `port`, `project`, `branch`, `label` (input) and `url`, `fqdn`, `project`, `branch`, `port`, `state` (output) | `src/integrations/mcp/tools.ts`, `src/core/status.ts:20-27` (`RouteJson`) | the data of one route | §4.9 |
| the field names `removed` (remove), `routes` (list), `daemon`, `proxy`, `config`, `reachable` (status) | `src/integrations/mcp/tools.ts`, `src/core/status.ts:42-82` (`ProxyStatus`, `DaemonStatusJson`, `ConfigStatusJson`, `GatewayStatus`) | the shape of the other three tools | §4.9 |

### 3.5 The pi extension and the skill

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `publish_dev_server`, `remove_dev_server`, `list_dev_servers` | `src/integrations/pi/tools.ts` | the native pi tools | §5 (keep) |
| `/routes` | `src/integrations/pi/extension.ts` | the command that renders the route table | §5 (keep) |
| `dev-gateway` (status line key) | `src/integrations/pi/extension.ts` | the label of the status line | §5 (keep) |
| `dev-gateway` (skill name) | `skills/dev-gateway/SKILL.md` front matter, the skill directory | the Agent Skill | §5 (keep) |
| the table columns `PROJECT BRANCH PORT LOCAL PUBLIC` | `src/integrations/pi/table.ts:15` (the `/routes` command) | the columns of the pi route table | §4.9 |

### 3.6 The environment variables

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `DEV_GATEWAY_HOME` | `src/core/paths.ts`, the README, the tests | everything in one directory | §5 (keep) |
| `DEV_GATEWAY_CONFIG` | the same, the systemd unit | the configuration file | §5 (keep) |
| `DEV_GATEWAY_STATE_DIR` | the same | the state directory | §5 (keep) |
| `DEV_GATEWAY_AUTOSTART` | `scripts/postinstall.mjs` | may `postinstall` start the daemon | §5 (keep) |
| `DEV_GATEWAY_LOG_LEVEL` | **does not exist** — only `TRAEFIK_DEV_LOG_LEVEL` does | the log level of the daemon and the worker | §4.8 |
| `TRAEFIK_DEV_CONFIG` | `src/core/paths.ts`, `src/core/config.ts` (legacy) | the old configuration file | §4.3 |
| `TRAEFIK_DEV_STATE_DIR` | the same | the old state directory | §4.3 |
| `TRAEFIK_DEV_LOG_LEVEL` | `src/core/daemon.ts`, `src/core/worker.ts` | the old log level | §4.8 |

### 3.7 The configuration keys (`src/core/config.ts`)

| Key | What it means today | Verdict |
| --- | --- | --- |
| `proxy` | which adapter writes the document (`traefik`) | §5 (keep) |
| `registryPort`, `relayPort` | the two ports the gateway binds | §5 (keep) |
| `advertisedIp`, `advertisedHost` | how the proxy reaches this machine | §5 (keep) |
| `zone` | the DNS zone the host names are built from | §5 (keep) |
| `entryPoints` | the proxy entry points the routers attach to | §5 (keep) |
| `certResolver` | the proxy's ACME resolver | §5 (keep) |
| `tlsMode` | `wildcard` or `fqdn` | §5 (keep) |
| `securityHeaders`, `compressMiddleware` | apply the shared middlewares | §5 (keep) |
| `middlewareProvider` | the provider that owns the shared middlewares | §5 (keep) |
| `allowedCidrs` | who may send the dispatch header | §5 (keep) |
| `secret` | the optional shared secret | §5 (keep) |
| `stateDir` | the state directory | §5 (keep) |
| `documentFormat` | `yaml` or `json` | §5 (keep) |
| `logMaxBytes`, `logKeep` | the log rotation | §5 (keep) |
| `autostart` | may `postinstall` start the daemon | §5 (keep) |

This table judges the *names* of the keys, not their values. The values that
ship as defaults — the zone, the advertised host name, the certificate
resolver — carry the names of one installation, and R3 has something to say
about them; that is API-15's slice, which owns `src/core/config.ts` and
changes those defaults at the same time. Nothing here touches the file.

### 3.8 The paths, the files and the app name

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `APP_NAME = 'dev-gateway'` | `src/core/paths.ts` | the name of the directories the package owns | §5 (keep) |
| `~/.config/dev-gateway/` | Linux configuration | the configuration directory | §5 (keep) |
| `~/.local/state/dev-gateway/` | Linux state | the route store, the pidfile, the log | §5 (keep) |
| `~/.cache/dev-gateway/` | Linux cache | the cache directory | §5 (keep) |
| `~/Library/{Preferences,Application Support,Logs,Caches}/dev-gateway/` | macOS | the same four, per platform | §5 (keep) |
| `%APPDATA%\dev-gateway\Config\`, `%LOCALAPPDATA%\dev-gateway\{State,Log,Cache}\` | Windows | the same four, per platform | §5 (keep) |
| `~/.traefik-dev/` | `src/core/paths.ts` (`LEGACY_DIR_NAME`), `src/core/migrate.ts` | the old layout | §4.3 |
| `config.json`, `routes.json`, `daemon.pid`, `daemon.log`, `wiring/` | the state and configuration directories | the files of the installation | §5 (keep) |
| `registrations.json` | the old layout only | the old route store | §4.3 |

### 3.9 The installed services

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `dev-gateway.service` | `src/cli/service.ts` (`SYSTEMD_UNIT_NAME`), `~/.config/systemd/user/` | the systemd user unit | §5 (keep) |
| `dev.mal.arstrom.dev-gateway` | `src/cli/service.ts` (`LAUNCHD_LABEL`), `~/Library/LaunchAgents/` | the launchd agent | §4.4 |
| `dev-gateway` (Windows task) | `src/cli/service.ts` (`WINDOWS_TASK_NAME`) | the scheduled task | §5 (keep) |

### 3.10 The protocol

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `GET /healthz` | `src/core/registry.ts`, `src/core/daemonControl.ts` | the health probe | §5 (keep) |
| `GET /<adapter id>` (`/traefik`) | `src/core/registry.ts`, the wiring snippet | the dynamic configuration document | §5 (keep) |
| `X-Dev-Target` | `src/core/protocol.ts`, the relay, the Traefik adapter, the golden files | the header that carries the dispatch target | §5 (keep) |
| `X-Relay-Secret`, `X-Registry-Secret` | `src/core/protocol.ts` | the optional shared secret | §5 (keep) |
| `<project-slug>/<branch-slug>` | `src/core/state.ts` (the route id) | the identity of a route | §5 (keep) |
| `<branch>.<project>.<zone>` | `src/core/util/slug.ts` (`buildFqdn`) | the address of a route | §5 (keep) |
| `dev-` (router and service prefix) | `src/adapters/traefik.ts` (`NAME_PREFIX`) | the gateway's objects in the proxy | §4.7 |
| `devhdr-` (middleware prefix) | `src/adapters/traefik.ts` (`MIDDLEWARE_PREFIX`) | the dispatch middleware in the proxy | §4.7 |

### 3.11 The documentation and the repository

| Name | Where it appears | What it means today | Verdict |
| --- | --- | --- | --- |
| `README.md` | the repository, the tarball, the npm page | the readme | §5 (keep) |
| `docs/AGENTS.md` | the tarball | the portable block for a harness | §5 (keep) |
| `docs/setup.md` | the tarball | the wizard reference | §5 (keep) |
| `docs/traefik.md` | the tarball | the wiring guide for the Traefik adapter | §5 (keep) |
| `skills/dev-gateway/SKILL.md` + `references/` | the tarball | the Agent Skill | §5 (keep) |
| `specs/tech-architecture/agent-dev-gateway.md` | the repository | the specification | §5 (keep) |
| `specs/tech-architecture/traefik-dev-gateway.md` | the repository | the specification of the previous architecture | §5 (keep as history) |
| `traefik-api` | the gitea repository, the remote, `MEMORY.md`, `memory/`, the specification | the repository and the project's working name | §4.6 |

---

## 4. The names worth a change

### 4.1 The binaries — the one real collision

**The problem.** `dev-gateway` is taken on npm by an unrelated package
("Local development cluster with now path aliases syntax support", version
0.3.0), and *that package installs a binary called `dev-gateway`*. Two
packages that install the same binary name fight over one symlink in
`node_modules/.bin`, and `npx dev-gateway` fetches the other one — which is
exactly what happened in this project. The names `dev-gateway-mcp` and
`dev-gateway-daemon` are free on npm today, but they are the same shape in
the same namespace, and only `dev-gateway` is in the way by accident.

**Alternatives.**

| Option | The names | What it costs | What it buys |
| --- | --- | --- | --- |
| A | `agent-dev-gateway`, `agent-dev-gateway-mcp`, `agent-dev-gateway-daemon` | the same work as B, plus three longer names to type | one family, no collision with the other package's binary |
| B | `agent-dev-gateway`, `dev-gateway-mcp`, `dev-gateway-daemon` | rename one binary, keep two | fixes the collision, breaks the family |
| C | `devgateway`, `devgateway-mcp`, `devgateway-daemon` | the same work as A | one word, no separator; a coined name that says nothing on its own (fails R1) |
| D | keep `dev-gateway` | nothing | the collision stays, and `npx dev-gateway` stays wrong |

**Recommendation: A.** The reason is the collision and the family, not the
equality with the package name: a binary name does **not** have to be the
package name — `@modelcontextprotocol/server-filesystem` installs
`mcp-server-filesystem`, and that difference is the normal case. What the
collision demands is that the binary be *distinct from the other package's
binary*, and what the family demands is that the three binaries of this
package share one prefix. `agent-dev-gateway` satisfies both; it costs six
extra characters over `dev-gateway` (17 against 11). The MCP and the daemon
binaries are almost never typed by a human: the MCP one is named in the
`mcpServers` snippet in the README, which the user copies into the client's
configuration by hand, and the daemon one is named by its absolute path in
the service unit, which the package writes.

**What a rename touches** (measured with `git grep -c 'dev-gateway'` at
commit `6b6d9a0`: **54 files and 335 lines**, of which 53 files and 330
lines are outside `package-lock.json` — the lock file holds the five hits of
the `bin` map and is regenerated anyway):

* `package.json` — the `bin` map, the `files` allow-list (7 hits);
  `package-lock.json` is regenerated.
* `bin/` — the three launchers are renamed, and their error messages change
  (`bin/dev-gateway.js:9` and the two siblings).
* `src/` — `cli/index.ts` (the usage text, 30 hits), `cli/service.ts` (the
  `ExecStart` line and the description, 8), `cli/setup.ts` (5),
  `core/paths.ts` (5), `core/index.ts` (2), `core/migrate.ts`,
  `core/daemonControl.ts`, `integrations/mcp/server.ts` (the usage text, 5),
  `integrations/pi/extension.ts` (the status line, 4), `daemon.ts`.
* `scripts/postinstall.mjs` (2).
* The documentation — `README.md` (36), `docs/traefik.md` (7),
  `skills/dev-gateway/SKILL.md` (6) and its two references (12),
  `docs/setup.md` (3), `docs/AGENTS.md` (3).
* The tests — `packaging.test.ts` (19; it asserts the three bin names and
  the file names in the tarball), `docs.test.ts` (17; it greps the README for
  `dev-gateway <command>`), `cli-setup.test.ts` (15), `migrate.test.ts` (15),
  `service.test.ts` (10), and the helper files `test/helpers/{cli,cert,
  golden,proxy}.ts`.
* The workflow — `.gitea/workflows/ci.yml` (3).
* The specifications — `agent-dev-gateway.md` (59) and
  `coordination-brief.md`.
* **Outside the repository** — the `mcpServers` entry in the configuration of
  every MCP client that uses the package (the user pastes it by hand), the
  systemd unit and the launchd plist already installed on a user's machine
  (they name the daemon by its absolute path), the `node_modules/.bin`
  symlink of every installed copy, and the `pi` package entry.

**What must keep working.** Nothing, for the new names: the package has
never been published. For the *old* names, the aliases `traefik-dev` and
`traefik-devd` are the compatibility layer (§4.3), and they exist only in
the repository — so the honest answer is that the compatibility cost of the
binary rename is zero, and the only thing to decide is whether the alias
stays.

### 4.2 The CLI command names — `register`/`unregister` against `publish`/`remove`

**The problem.** The package speaks two languages for the same act. The MCP
tool is `publish_dev_server`; the command is `register`. The skill, the
`AGENTS.md` block and the README all say "publish" in prose and "register" in
the command line. `unregister` has no counterpart at all in the agent
vocabulary — the tool is `remove_dev_server`. R5 says one concept, one name.

**Alternatives.**

| Option | The commands | What it costs | What it buys |
| --- | --- | --- | --- |
| A | `publish`, `remove`, `list`, `status`, … — `register` and `unregister` become aliases that print a deprecation line | `src/cli/index.ts` (the switch and the two command functions), `test/cli.test.ts` (21 hits), `test/docs.test.ts` (11), `test/packaging.test.ts` (2), `test/cli-setup.test.ts` (2), the README (4), `docs/AGENTS.md` (2), `docs/traefik.md` (4), the skill (2) and its references (5), `DESIGN.md`, `PRODUCT.md` | one vocabulary across the command line and the agent protocol |
| B | `publish`, `remove` only — the old names go | the same, without the alias | the same, but a breaking change for the scripts of the people who already use the old CLI |
| C | keep `register`/`unregister` | nothing | two vocabularies for one act |

**Recommendation: A** — rename to `publish` and `remove`, and keep
`register`/`unregister` as silent aliases for one release. The alias costs
four lines in the switch; the vocabulary gain is the point of the whole
slice. This is also the decision the human left open (the handoff, §7), so it
belongs in §8.

Note that `list` and `status` do not have this problem: the tools are
`list_dev_servers` and `dev_gateway_status`, which are the same words in a
different shape, not a different word.

### 4.3 The legacy names — what may go and what may not

There are two legacy groups, and they must not be treated alike.

| Legacy name | Who uses it | Verdict |
| --- | --- | --- |
| `~/.traefik-dev/` (with `config.json`, `registrations.json`, `daemon.pid`, `daemon.log`) | the live installation, right now | **must keep working** — `src/core/migrate.ts` and the first-run import in `src/core/config.ts` read it; `dev-gateway migrate` imports it explicitly |
| `TRAEFIK_DEV_CONFIG`, `TRAEFIK_DEV_STATE_DIR` | the scripts and units of the live installation | **must keep working** — `src/core/paths.ts` honours them below the new names, and `src/core/daemon.ts` and `src/core/daemonControl.ts` still *set* them for the child processes |
| `TRAEFIK_DEV_LOG_LEVEL` | the daemon and the worker | keep as an alias, and add the new name (§4.8) |
| the binaries `traefik-dev`, `traefik-devd` | the live installation's `bin/` directory; the repository's own tests and tools | **may go** — they were never in the `bin` map and never in `files`, so they were never published. They only exist in the repository, and the live installation runs its own copy in `/opt/devbox-traefik-api`, which this task does not touch |

**Recommendation:** delete `bin/traefik-dev.js` and `bin/traefik-devd.js` from
the repository, and with them the two stale entries in `package-lock.json`
(the lock file still lists `traefik-dev` and `traefik-devd` in the root
package's `bin` map, although `package.json` has not listed them since the
package was renamed — `npm ci` does not complain, but `npm install` rewrites
the lock). The compatibility that matters is the directory and the variables,
and they stay.

**What it costs:** the two launchers, the two stale entries in
`package-lock.json`, **four tests in three files that must be repointed or
dropped**, and two tools of the repository that must be repointed. The full
list, measured by copying the repository at commit `6b6d9a0` to a temporary
directory, deleting only `bin/traefik-dev.js` and `bin/traefik-devd.js`, and
running the affected files (`node --test test/daemon-config.test.ts
test/cli-lifecycle.test.ts test/cli.test.ts` → **4 failed, 26 passed**):

| What | Where | What happens when the launchers go |
| --- | --- | --- |
| `LEGACY_DAEMON` | `test/helpers/cli.ts:31` | the constant points at a file that is not there |
| `LEGACY_CLI` | `test/helpers/cli.ts:28` | the same |
| the daemon the fixture starts | `test/daemon-config.test.ts:22` (`DAEMON`) | **two tests fail**: "a daemon that is started by hand gives its workers the configuration file" and "a daemon that is started with a configuration file on the command line reads it" — `Cannot find module .../bin/traefik-devd.js` |
| the daemon of the old launcher | `test/cli-lifecycle.test.ts:16`, `:83-84` | **one test fails**: "stop stops a daemon that was started through the old launcher" — the same error |
| the old CLI name | `test/cli.test.ts:15`, `:285` | **one test fails**: "the old binary name still works, and so do the old command names" — the test exists to prove the old name still works, so it is dropped or repointed at the new launcher |
| the tool of the previous era | `tools/interaction-check.py:16` | the script runs `node bin/traefik-dev.js`; it stops working |
| the preview tool | `tools/preview-server.ts:11` | the command in the comment no longer exists |
| the comment | `src/core/daemonControl.ts:167` | it names `traefik-devd.js` as one of the names `isGatewayDaemon` recognises |
| the recognition itself | `src/core/daemonControl.ts:187` (`/daemon\|devd/`) | **must stay**: an old installation's daemon is still called `traefik-devd.js`, and `stop` has to recognise it |
| the lock file | `package-lock.json` | the root `bin` map still lists the two names; it is regenerated |

The two tests in `test/daemon-config.test.ts` and the one in
`test/cli-lifecycle.test.ts` do not need the old *name* to test what they
test: they can start `bin/dev-gateway-daemon.js` and keep their meaning.
The test in `test/cli.test.ts` is about the old name itself, so it goes with
the launcher — which is the point of the deletion.

**The price, in one line:** the deletion is free for the users of the
package (the launchers were never published) and costs four tests, two tools
and one comment in the repository.

### 4.4 The launchd label

**The problem.** `dev.mal.arstrom.dev-gateway` is a malformed reverse-DNS
label: `mal.arstrom` splits the organisation's name in the middle. A launchd
label is supposed to be a domain name reversed, and the domain it should
reverse is the publisher's.

| Option | The label | What it costs | What it buys |
| --- | --- | --- | --- |
| A | `com.malarstrom.dev-gateway` | one constant in `src/cli/service.ts`, the launchd test, the plist of a reinstalled agent | the conventional reverse-DNS of the publisher's domain; recognisable to `launchctl` |
| B | `dev.malarstrom.dev-gateway` | the same | the reverse of `dev-gateway.malarstrom.dev` — only correct if that domain exists |
| C | keep `dev.mal.arstrom.dev-gateway` | nothing | a label that no domain reverses to |

**Recommendation: A**, `com.malarstrom.dev-gateway`. The rule R3 has an
exception here: a launchd label is *by convention* the vendor's identity, so
the publisher's domain in it is correct, not a leak. The current label is
wrong in form, and a wrong label is what an agent gets when it looks for
`launchctl list | grep dev-gateway`.

**What it costs:** `src/cli/service.ts` (`LAUNCHD_LABEL`), `test/service.test.ts`
(10 hits), and — for an installation that has already run
`install-service` — the old plist in `~/Library/LaunchAgents/` has to be
replaced (`launchctl unload` the old label, then install again).

### 4.5 The npm scope and the package name

**The problem.** The package is `@malarstrom/agent-dev-gateway`. The scope
names the publisher, which is normal for npm and the only way to own a name
permanently. The name inside the scope says what the package is, in one
word, in English, and names no proxy.

| Option | The name | What it costs | What it buys |
| --- | --- | --- | --- |
| A | `@malarstrom/agent-dev-gateway` | nothing | an owned scope (the npm organisation `malarstrom` exists and has no public package yet); the name says what it is |
| B | `agent-dev-gateway` (unscoped) | a name that can be taken by anybody, tomorrow | a shorter install line |
| C | `@malarstrom/dev-gateway` | a rename of the package and of everything that names it | a shorter name inside the scope; loses the "agent" that says who it is for |
| D | a coined name (`@malarstrom/devgw`) | the same, plus a name nobody understands without a landing page | nothing |

**Recommendation: A.** The scope is the publisher's business and is the
standard way to publish on npm; the name inside the scope is descriptive and
proxy-agnostic, which is exactly what the product is. `agent-dev-gateway` is
free as an unscoped name today, and that is exactly why it is not worth
having: an unscoped name is a squatting risk, and the specification already
rejected it (D1). **D1 settled this** ("The package is
`@malarstrom/agent-dev-gateway` … The scope is the `malarstrom` organisation
on npm"); this section only weighs it again, and finds nothing to change.

### 4.6 The repository name — `traefik-api`

**The problem.** The repository is named after the proxy, and the product is
proxy-agnostic (D3). The package inside it is called `agent-dev-gateway`.
The name also survives in the README's install line
`npm install git+github.com/malarstrom/agent-dev-gateway`, which points at a
GitHub repository that does not exist — the repository is on gitea.

| Option | The repository | What it costs | What it buys |
| --- | --- | --- | --- |
| A | rename to `agent-dev-gateway` on gitea | the gitea URL changes; the remote in every clone; the README's git install line; `MEMORY.md`, `memory/`, the specification (§2.3) | the repository says what it is; the proxy is one adapter, not the product |
| B | keep `traefik-api` | nothing | the history and the URL stay; the name stays wrong for a proxy-agnostic product |
| C | rename to `dev-gateway` | the same as A | shorter; ambiguous against the npm package of another author |

**Recommendation: A**, and fix the README's git install line to the gitea URL
either way. This is a human decision: it touches the remote the human's own
checkout uses, and the gitea repository is the human's.

### 4.7 The object names in the proxy — `dev-` and `devhdr-`

**The problem.** The adapter names its objects in the user's proxy:
`dev-<project>-<branch>-<hash>` for the routers and the services,
`devhdr-<project>-<branch>-<hash>` for the dispatch middleware. `dev-` is
generic enough to collide with objects the user made themselves, and
`devhdr-` says nothing to a reader of the proxy's dashboard.

| Option | The names | What it costs | What it buys |
| --- | --- | --- | --- |
| A | `devgw-` and `devgw-hdr-` | `src/adapters/traefik.ts` (two constants and the check at line 290 that recognises the gateway's own middleware in `discover()`), the four golden files, `test/adapters.test.ts`, `test/cli-setup.test.ts`, `docs/traefik.md` | a namespace of the gateway's own, visible in the proxy |
| B | `dev-gateway-` and `dev-gateway-hdr-` | the same | clearer, longer |
| C | keep `dev-` and `devhdr-` | nothing | the names are already short and the collision is theoretical |

**Recommendation: A**, in the same slice as the binary rename, so that the
gateway owns one prefix everywhere it appears. The cost is low because the
document is regenerated on every poll: the objects are named inside the
dynamic document, and the user's static configuration never names them. The
one thing to keep in step is `discover()`'s check that skips the gateway's
own middleware when it reads the proxy's routers.

### 4.8 The log level variable — a name that is missing

**The problem.** The daemon and the worker read `TRAEFIK_DEV_LOG_LEVEL`, and
there is no `DEV_GATEWAY_LOG_LEVEL`. The other three variables of the family
are `DEV_GATEWAY_*`; this one kept the name of the pre-package installation.
A user who reads the README sees `DEV_GATEWAY_HOME`, `DEV_GATEWAY_CONFIG`
and `DEV_GATEWAY_STATE_DIR` and reasonably expects the fourth to be
`DEV_GATEWAY_LOG_LEVEL`.

**Recommendation (decided here):** add `DEV_GATEWAY_LOG_LEVEL` and keep
`TRAEFIK_DEV_LOG_LEVEL` as the alias below it, exactly as
`DEV_GATEWAY_CONFIG` keeps `TRAEFIK_DEV_CONFIG` below it
(`src/core/paths.ts:165-171` is the pattern). The new name wins when both
are set. **Cost:** `src/core/daemon.ts:116`, `src/core/worker.ts:33`, the
README's variable table, and the tests that cover the log level.

### 4.9 The two route tables — two vocabularies for one table

**The problem.** The route list is shown in three places, and the three do
not use the same words:

| Where | The columns | The values |
| --- | --- | --- |
| the CLI, `dev-gateway list` (`src/cli/index.ts:295`) | `PROJECT BRANCH FQDN PORT STATE UPDATED` | the slugs, the host name, the port, `up`/`down`, the time of the last change |
| the pi table, `/routes` (`src/integrations/pi/table.ts:15`) | `PROJECT BRANCH PORT LOCAL PUBLIC` | the raw names, the port, `up`/`down`, the URL |
| the tool contract (§6.2, `src/core/status.ts:20-27`) | `project`, `branch`, `port`, `fqdn`, `url`, `state` | the raw names, the port, the host name, the URL, `up`/`down` |

Three vocabularies for the same table. `STATE` is `LOCAL` in one table and
`state` in the contract; `FQDN` is `PUBLIC` in one table and `fqdn` in the
contract; `UPDATED` exists in no contract at all. The CLI also shows the
*slugs* where the contract shows the raw names — for a project called
`My App`, the CLI prints `my-app` and the tool returns `My App`.

R5 (one concept, one name) says this is a fault. The tool contract is the
one that matters: it is what an agent parses, and it is the shape the CLI's
own `--json` output reuses.

**Alternatives.**

| Option | What it does | What it costs | What it buys |
| --- | --- | --- | --- |
| A | one vocabulary, taken from the tool contract: the pi table's `LOCAL` becomes `STATE` and its `PUBLIC` becomes `URL`; the CLI keeps `FQDN`, `STATE` and `UPDATED`, and `UPDATED` is documented as the one column the contract does not carry | `src/integrations/pi/table.ts:15` (the headers and `rowOf`), `test/pi-extension.test.ts:344` and `:359` (they assert `PROJECT BRANCH PORT LOCAL PUBLIC`) | the words of the tables are the words of the contract |
| B | one table for both: the pi table shows the same columns as the CLI | the same, plus the pi table grows a column | one table |
| C | keep the three vocabularies and write down what each is for | nothing | the CLI answers "what is registered and when did it change", the pi table answers "what can I open right now" — but the reader has to learn two words for one thing |

**Recommendation: A.** The pi table's `LOCAL` and `PUBLIC` say something the
contract already says better: the contract calls the field `state`, and it
calls the address `url`. Change those two headers, and the pi table reads
the same vocabulary as the tool and as the CLI. The CLI's `UPDATED` stays:
the contract has no field for it, the column is the CLI's own information,
and a table that shows when a route last changed is worth a word the
contract does not use.

One thing to fix along with it: the CLI's table prints the *slugs*
(`projectSlug`, `branchSlug`) while the contract and the pi table print the
raw names. The slug is what the address is built from, and the address is
already a column (`FQDN`); the name column should carry the name.

**What it costs:** `src/integrations/pi/table.ts` (the headers and the row),
`src/cli/index.ts:283-295` (the row values), `test/pi-extension.test.ts:344`
and `:359` (the assertions on the headers). Nothing outside the repository
changes: no tool field is renamed, and no JSON key changes.

---

## 5. The names that stay, and why

These are decided in this document; they need no human decision.

| Name | Why it stays |
| --- | --- |
| `publish_dev_server`, `remove_dev_server`, `list_dev_servers` | they say what they do, in the snake case the MCP convention uses, and they name the thing they act on (a dev server) |
| `dev_gateway_status` | it is the one tool that is about the gateway and not about a server, so it carries the product's name; the alternative (`status_dev_server`) would say something false. The inconsistency with the other three is grammatical, not semantic |
| the MCP server name `dev-gateway` | it is the name the client configuration shows; it matches the skill, the status line and the directory |
| the skill name `dev-gateway` | the Agent Skill convention wants the directory name and the front-matter `name` to be the same (`test/docs.test.ts:122` checks it), and the skill is about the same product as the directory |
| the field names of the tools (`port`, `project`, `branch`, `label`, `url`, `fqdn`, `state`, `removed`, `routes`, `daemon`, `proxy`, `config`, `reachable`) | they are the contract of §6.2 of the specification: they are decided, they are implemented, and an agent parses them. They are lower camel case in one JSON object, and they are the words of the routes themselves. Only the *table headers* around them are in question (§4.9) |
| `/routes` (the pi command) | short, and it says what it shows |
| `--config`, `--state-dir`, `--json` | standard, short, and understood |
| the configuration keys | lower camel case in a JSON file, one word each, and the wizard writes them. `zone`, `certResolver`, `entryPoints` and `middlewareProvider` are the proxy's vocabulary, but they are the *values of the adapter*, and moving them under a `proxy` section is a design change, not a naming change — it belongs to a later slice together with API-15, which owns `src/core/config.ts` |
| `DEV_GATEWAY_HOME`, `DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`, `DEV_GATEWAY_AUTOSTART` | one family, one prefix, one separator; the prefix names the product and not one installation |
| `APP_NAME = 'dev-gateway'` and the four XDG directories | §2.4 of the specification: the scope is an npm publishing detail, and the directory is a detail of the user's disk. The name is short, and the user types it |
| `config.json`, `routes.json`, `daemon.pid`, `daemon.log`, `wiring/` | they say what they are; `routes.json` already replaced `registrations.json` in the new layout |
| `GET /healthz` | the health probe is a convention the whole industry already reads |
| `GET /<adapter id>` | the path is derived from the adapter, so it is `/traefik` for Traefik and `/caddy` for the next one; nothing in the core names a proxy |
| `X-Dev-Target` | it says what it carries, and it names no proxy |
| `X-Relay-Secret`, `X-Registry-Secret` | they say where they are accepted |
| `<project-slug>/<branch-slug>` (the route id) | it is the identity of a route, readable in a log line and in a header value |
| `<branch>.<project>.<zone>` (the FQDN) | it is what the browser shows; the order is the one the user expects |
| the package `description` | it says what the package does, in one sentence, and names no proxy |
| the five `keywords` | `pi-package` (pi finds it), `mcp` (the MCP users find it), `dev-server` and `agent` (what it is), `traefik` (the proxy most people will use first — npm's search is the discovery channel, and the package is proxy-agnostic in what it *does*, not in what people *look for*). When a second adapter lands, `traefik` becomes `reverse-proxy` |
| `MIT` | the licence |
| `README.md`, `docs/AGENTS.md`, `docs/setup.md`, `docs/traefik.md` | the names of the files are the names of their subjects. `docs/traefik.md` is the guide for the Traefik *adapter*; a second adapter gets `docs/caddy.md`, and a directory only when there are enough of them |
| `specs/tech-architecture/traefik-dev-gateway.md` | it is the history of the previous architecture, and the history is worth keeping; the specification that governs is `agent-dev-gateway.md` |

---

## 6. What a rename costs, in one place

The three renames that move the most, and everything each of them moves.
The three that are cheaper — the launchd label (§4.4), the object prefixes
in the proxy (§4.7) and the table headers (§4.9) — are costed where they
are described: two constants and one test, two constants and the four
golden files, and one constant and two assertions.

| | the binaries (§4.1) | the CLI commands (§4.2) | the legacy binaries (§4.3) |
| --- | --- | --- | --- |
| source | `bin/*.js`, `src/cli/index.ts`, `src/cli/service.ts`, `src/cli/setup.ts`, `src/core/{paths,index,migrate,daemonControl}.ts`, `src/integrations/{mcp/server,pi/extension}.ts`, `src/daemon.ts`, `scripts/postinstall.mjs` | `src/cli/index.ts` (the switch, the two commands, the usage text) | `bin/traefik-dev.js`, `bin/traefik-devd.js` |
| manifest | `package.json` (`bin`, `files`), `package-lock.json` | — | `package-lock.json` (the root `bin` map still lists the two names) |
| tests | `packaging`, `docs`, `cli-setup`, `migrate`, `service`, `build`, `cli-lifecycle`, `config`, `daemon-config`, `postinstall`, `mcp-server`, `mcp-conformance`, `pi-extension`, `lock`, `net`, `state`, `adapters`, the four helpers | `cli` (21 hits), `docs` (11), `packaging` (2), `cli-setup` (2), `document`, `lock`, `helpers/lock-writer` | **four tests in three files**: `daemon-config` (2, the `DAEMON` constant at line 22), `cli-lifecycle` (1, `LEGACY_DAEMON` at `helpers/cli.ts:31`), `cli` (1, `LEGACY_CLI` at `helpers/cli.ts:28`, used at `cli.test.ts:285`) — the three daemon tests can be repointed at the new launcher, the fourth is about the old name and goes with it |
| tools | — | — | `tools/interaction-check.py:16`, `tools/preview-server.ts:11` |
| documentation | `README.md` (36), `docs/traefik.md` (7), the skill (6) and its references (12), `docs/setup.md`, `docs/AGENTS.md` | `README.md` (4), `docs/AGENTS.md` (2), `docs/traefik.md` (4), the skill (2) and its references (5), `DESIGN.md`, `PRODUCT.md` | `README.md` (2), `scripts/postinstall.mjs` (the comment), `src/core/daemonControl.ts:167` (the comment) |
| configuration | — | — | — |
| environment variables | — | — | — |
| directories | — | — | — |
| installed services | the systemd unit and the launchd plist of every installation (`ExecStart` names the daemon by its absolute path) | — | — |
| specifications | `agent-dev-gateway.md` (59 hits), `coordination-brief.md` | `agent-dev-gateway.md` (4) | `agent-dev-gateway.md` (5) |
| CI | `.gitea/workflows/ci.yml` (3) | — | — |

**What has to keep working, in every case:**

* the old directory `~/.traefik-dev/` — read by `src/core/migrate.ts` and by
  the first-run import; never written to again;
* the old variables `TRAEFIK_DEV_CONFIG`, `TRAEFIK_DEV_STATE_DIR` — honoured
  below the new ones in `src/core/paths.ts`;
* the old binary names in `isGatewayDaemon`
  (`src/core/daemonControl.ts:187`, which matches the script name against
  `/daemon|devd/`) — an old installation's daemon must still be recognised
  as one, or `stop` does nothing and `start` starts a second daemon;
* the routes of the other projects on the live proxy — a rename of the
  binaries or the commands changes no route;
* the configuration file of an installed user — a rename of a *key* would
  need a migration in `src/core/config.ts` (which is why no key is renamed
  here);
* the environment of the live gateway in `/opt/devbox-traefik-api` — this
  task touches nothing there.

---

## 7. The npm registry, checked on 2026-10-28

Checked with `npm view <name> version` and with a request to
`https://registry.npmjs.org/<name>`. 404 means the name is free; 200 means it
is taken.

| Name | Registry | Note |
| --- | --- | --- |
| `dev-gateway` | **taken**, 0.3.0 | an unrelated package: "Local development cluster with now path aliases syntax support". It installs a binary called `dev-gateway`, which is why `npx dev-gateway` fetched the wrong thing in this project |
| `@malarstrom/agent-dev-gateway` | free | the current name. The scope exists: `https://registry.npmjs.org/-/org/malarstrom/package` answers 200 with an empty list, while a scope that does not exist answers 404 `Scope not found`. The organisation has no public package yet |
| `@malarstrom/dev-gateway` | free | the shorter variant |
| `agent-dev-gateway` | free | the unscoped variant — free today, which is why it is a squatting risk |
| `dev-gateway-mcp` | free | |
| `dev-gateway-daemon` | free | |
| `dev-gateway-cli` | free | |
| `devgateway` | free | the coined variant |
| `agentdevgateway` | free | |
| `dev-gw`, `dev-gate`, `adg`, `devgw` | free | |

**What this does not cover.** The registry is the only place where a name is
*reserved*. A binary name lives in the global bin directory of a machine, and
npm does not index that: no registry check can prove that `agent-dev-gateway`
is free as a binary. It is free as a package, no popular package installs a
binary of that name, and the name is specific enough that a collision is
unlikely — but "unlikely" is the strongest claim that can be made.

---

## 8. The decisions the human has to take

Five decisions. Everything else in this document is decided here.

Decision 1 **reopens a decision the governing specification has already
made**: §0 D1 of `specs/tech-architecture/agent-dev-gateway.md` reads "### D1
— The package is `@malarstrom/agent-dev-gateway` / The binary is
`dev-gateway`. The scope is the `malarstrom` organisation on npm." D1
rejected `dev-gateway` as the *package* name because it is taken on npm
(version 0.3.0) — the same package this document found — but it kept
`dev-gateway` as the *binary* name, and nobody looked at the fact that the
taken package installs a binary of the same name. Reopening D1 is therefore
not a fresh question: it is the question D1 answered for the package and
left open for the binary. The other four decisions are new.

| # | Decision | Alternatives | Recommendation |
| --- | --- | --- | --- |
| 1 | **The name of the binaries** — *reopens D1, which fixed the binary as `dev-gateway`* | A `agent-dev-gateway`, `agent-dev-gateway-mcp`, `agent-dev-gateway-daemon` — B `agent-dev-gateway` only — C `devgateway…` — D keep `dev-gateway` | **A.** `dev-gateway` collides with a real package on npm that installs the same binary; the package was never published, so the rename is free now and expensive later |
| 2 | **The name of the CLI commands** | A `publish`/`remove` with `register`/`unregister` as aliases — B `publish`/`remove` only — C keep `register`/`unregister` | **A.** The MCP tools already say publish/remove; one concept, one name |
| 3 | **The name of the repository** | A `agent-dev-gateway` — B keep `traefik-api` — C `dev-gateway` | **A**, and fix the README's git install line to the gitea URL either way. It touches the human's own remote. D1 says the same: "The repository stays `traefik-api` for now … renaming the repository is a separate decision" |
| 4 | **The launchd label** | A `com.malarstrom.dev-gateway` — B `dev.malarstrom.dev-gateway` — C keep `dev.mal.arstrom.dev-gateway` | **A.** A launchd label is the vendor's identity by convention; the current one is malformed |
| 5 | **The Traefik object prefixes** | A `devgw-` / `devgw-hdr-` — B `dev-gateway-` / `dev-gateway-hdr-` — C keep `dev-` / `devhdr-` | **A**, in the same slice as decision 1. The names are in the user's proxy; `devhdr-` says nothing |

**Recommended order:** decision 1 and decision 5 in one slice (both are the
gateway's own names), decision 2 in the next (it touches the tests and the
documentation the most), decisions 3 and 4 whenever the human is at the
machine.

**Decided here, and not on the list above:** the table headers of the two
route tables (§4.9 — the pi table's `LOCAL` and `PUBLIC` become `STATE` and
`URL`), the addition of `DEV_GATEWAY_LOG_LEVEL` (§4.8), the deletion of the
repository's legacy launchers (§4.3), and the npm scope and the package name
(§4.5, which D1 already settled).

---

## 9. What this task changed

Nothing outside this document. No code, no name, no configuration, no
`src/core/config.ts` — that file belongs to API-15, which changes the default
values at the same time. The live gateway in `/opt/devbox-traefik-api` was
not touched, and nothing was written to `~/.traefik-dev/`.

The names this document keeps working: `~/.traefik-dev/`,
`TRAEFIK_DEV_CONFIG`, `TRAEFIK_DEV_STATE_DIR`, `TRAEFIK_DEV_LOG_LEVEL`, the
old binaries in an old installation.
