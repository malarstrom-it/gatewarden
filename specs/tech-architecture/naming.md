# Naming — the name is `gatewarden`

**Status:** decided. This slice performs the rename; the decisions below are
taken.

Written 2026-10-28 (the inventory), decided and carried out 2026-10-30 (the
rename).

The scope of this document is every name a stranger can see: the package on
npm, the binaries on a PATH, the words on a command line, the tool names an
agent calls, the variables in a shell, the keys in a JSON file, the
directories in a home, the units in a service manager, the headers on the
wire, the files in a repository and the title of the repository itself.

---

## 1. The decision

The product is called **`gatewarden`**. One word, lower case, one separator,
and it says what it is to someone who has never heard of this project: the
gateway that gives a local dev server an address on the internet.

| Where | The name |
| --- | --- |
| the package on npm | `@malarstrom/gatewarden` |
| the CLI | `gatewarden` |
| the MCP server | `gatewarden-mcp` |
| the daemon | `gatewarden-daemon` |
| the MCP server's own name | `gatewarden` |
| the Agent Skill | `gatewarden` (`skills/gatewarden/`) |
| the directories in the home | `gatewarden` (`~/.config/gatewarden/`, `~/.local/state/gatewarden/`, …) |
| the systemd unit | `gatewarden.service` |
| the launchd agent | `com.malarstrom.gatewarden` |
| the Windows scheduled task | `gatewarden` |
| the environment variables | `GATEWARDEN_HOME`, `GATEWARDEN_CONFIG`, `GATEWARDEN_STATE_DIR`, `GATEWARDEN_LOG_LEVEL`, `GATEWARDEN_AUTOSTART` |

The scope stays `malarstrom`: it is the publisher's npm organisation, and a
scope is the only way to own a name permanently.

**The name before this decision** was `dev-gateway` as a product, and the
same word with an `agent-` prefix as the package. It was replaced for two
reasons:

1. the product name `dev-gateway` is **taken on npm** (version 0.3.0), and
   that package installs a binary of the same name — `npx dev-gateway`
   fetches somebody else's program, which is exactly what happened in this
   project;
2. the name said what the tool was *for* (a dev server) and not what it
   *did* (it gave a dev server an address on the user's own domain), and it
   named the agent as the user of the tool rather than the tool itself.

The name is free: `https://registry.npmjs.org/gatewarden` answers 404, and the
npm search for `gatewarden` finds no package of that name. The version
`0.1.0` was published on 2026-11-01 and withdrawn the same day: a version
that has been published is taken for good, so the next one is `0.1.1`.

---

## 2. The rules the names are measured against

| # | Rule | Where it comes from |
| --- | --- | --- |
| R1 | The name says what it is to someone who has never heard of this project. | the brief |
| R2 | One word, one language, one separator: lower case, kebab-case, English. | the brief |
| R3 | The name carries no name of one installation, of the author's organisation, or of one proxy adapter — unless the convention of the place asks for it (an npm scope, a launchd label). | the brief |
| R4 | The name is available where the world will meet it (the npm registry, the global bin directory). | the brief |
| R5 | One concept, one name, everywhere it appears: package, binary, command, tool, directory, unit and documentation say the same thing. | derived from R2 |
| R6 | A name that already works for somebody else keeps working: the old directory, the old variables, the old binaries. | derived from §6 |

---

## 3. How the name meets the rules

| # | Rule | How `gatewarden` meets it |
| --- | --- | --- |
| R1 | says what it is | it is a gateway: the thing that stands between a dev server on `127.0.0.1` and an `https://` address on the user's own domain. The README leads with that sentence, and the npm description says the same: *"Give a local development server an https address on your own domain"*. |
| R2 | one word, one language, one separator | `gatewarden` is one word, lower case, without a separator. The three binaries are the word plus a suffix (`-mcp`, `-daemon`), the way npm packages name their binaries. |
| R3 | names no installation, no organisation, no proxy | the word itself names nothing but the product. The scope (`malarstrom`) and the launchd label (`com.malarstrom.gatewarden`) are the two places where the convention of the place asks for the publisher's identity, and R3 has an exception for exactly those. No name of the Traefik adapter is in the product name — the adapter is one implementation behind the `ProxyAdapter` contract. |
| R4 | is available where the world meets it | `registry.npmjs.org/gatewarden` answers 404 and the npm search finds no package of that name (checked 2026-10-30). The search finds one unrelated package that uses the word in its description; it installs a binary of another name, so nothing fights over the global bin directory. The package is `@malarstrom/gatewarden`, so the unscoped name is not even published. |
| R5 | one concept, one name | the package, the three binaries, the MCP server's name, the skill, the four directories, the three service names and the environment variables all carry the same word. The name of the CLI on the command line, in the documentation and in the error messages is the same word. |
| R6 | what already works keeps working | §6: the old directories are migrated and reported, the old environment variables are read and deprecated, the old binaries still run, and the pre-package layout still works. |

---

## 4. The names that stay, and why

These are decided here; they need no human decision, and this slice does not
touch them.

| Name | Why it stays |
| --- | --- |
| `publish_dev_server`, `remove_dev_server`, `list_dev_servers` | they say what they do, in the snake case the MCP convention uses, and they name the thing they act on (a dev server) |
| `dev_gateway_status` | it is the one tool that is about the gateway and not about a server, so it carries the product's name; the alternative (`status_dev_server`) would say something false. The inconsistency with the other three is grammatical, not semantic |
| the CLI commands `register`, `unregister`, `list`, `status`, `config`, `setup`, `start`, `stop`, `doctor`, `install-service`, `migrate`, and their flags | they are the interface the specification names, and the human has not renamed them |
| the proxy adapter `traefik`, the document the proxy polls, the router names | they belong to the proxy, not to the product: the adapter is one implementation behind the `ProxyAdapter` contract, and the objects live in the user's proxy |
| the configuration keys | they are the contract of §3.2 of the specification: `zone`, `certResolver`, `entryPoints`, `middlewareProvider` and the rest are decided, implemented, and parsed by the users' scripts |
| `X-Dev-Target`, `X-Relay-Secret`, `X-Registry-Secret`, `GET /healthz`, `GET /<adapter id>` | they say what they carry, and they name no proxy and no product |
| `<project-slug>/<branch-slug>`, `<branch>.<project>.<zone>` | the identity of a route and the address it is published under |
| `config.json`, `routes.json`, `daemon.pid`, `daemon.log`, `wiring/` | they say what they are; the file names inside the directories do not carry the name of the product |
| `MIT`, `README.md`, `docs/AGENTS.md`, `docs/setup.md`, `docs/traefik.md`, `docs/healthcheck.md` | the names of the files are the names of their subjects |
| `specs/tech-architecture/traefik-dev-gateway.md` | it is the history of the previous architecture — the Traefik-specific plan the package grew out of — and the history is worth keeping under its own name. The specification that governs is `gatewarden.md` |

---

## 5. The names that changed, and what each one cost

The rename is mechanical, and it was made in one sweep. The measurement
below is the inventory of the names that moved.

| Where | Before | After |
| --- | --- | --- |
| `package.json` | the old package name | `@malarstrom/gatewarden` |
| `package.json` `bin` and `files` | `dev-gateway`, `dev-gateway-mcp`, `dev-gateway-daemon` | `gatewarden`, `gatewarden-mcp`, `gatewarden-daemon` |
| `bin/` | `dev-gateway.js`, `dev-gateway-mcp.js`, `dev-gateway-daemon.js` | `gatewarden.js`, `gatewarden-mcp.js`, `gatewarden-daemon.js` |
| `src/core/paths.ts` | `APP_NAME = 'dev-gateway'`, `env-paths('dev-gateway')` | `APP_NAME = 'gatewarden'`, `env-paths('gatewarden')` |
| the environment | `DEV_GATEWAY_HOME`, `DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`, `DEV_GATEWAY_AUTOSTART`, `DEV_GATEWAY_LOG_LEVEL` | `GATEWARDEN_HOME`, `GATEWARDEN_CONFIG`, `GATEWARDEN_STATE_DIR`, `GATEWARDEN_AUTOSTART`, `GATEWARDEN_LOG_LEVEL` |
| the test environment | `DEV_GATEWAY_TESTENV_*` | `GATEWARDEN_TESTENV_*` |
| `src/cli/service.ts` | `dev-gateway.service`, `dev.mal.arstrom.dev-gateway`, `dev-gateway` | `gatewarden.service`, `com.malarstrom.gatewarden`, `gatewarden` |
| `src/integrations/mcp/server.ts` | the server's own name `dev-gateway` | `gatewarden` |
| `skills/` | `skills/dev-gateway/`, front matter `name: dev-gateway` | `skills/gatewarden/`, front matter `name: gatewarden` |
| `specs/tech-architecture/` | the specification file of the old name | `gatewarden.md` (the file is named after the product, like the package) |
| the documentation | the README, `docs/AGENTS.md`, `docs/traefik.md`, `docs/setup.md`, `docs/healthcheck.md`, the skill and its two references | the same files, the new name |
| the CI | the job names, the comments and the names the package is installed under | the same |
| the call sites | `devGatewayStatus`, `devGatewayExtension`, the status-line key | `gatewardenStatus`, `gatewardenExtension`, `gatewarden` |

The launchd label changed shape as well as name: `dev.mal.arstrom.dev-gateway`
was a malformed reverse-DNS label (`mal.arstrom` splits the organisation's name
in the middle). A launchd label is *by convention* the vendor's identity, so
the publisher's domain belongs in it — `com.malarstrom.gatewarden`.

---

## 6. The compatibility layer (R6)

Everything that worked before the rename keeps working. Nothing is deleted:
the old directories stay where they are, with the files in them.

| What | Where it was | What happens now |
| --- | --- | --- |
| the pre-package layout | `~/.traefik-dev/` | read on the first run, imported by `gatewarden migrate`, and reported by `gatewarden doctor` — unchanged by this slice |
| the layout of the old name | `~/.config/dev-gateway/` and `~/.local/state/dev-gateway/` | read on the first run (the configuration is not lost), moved by `gatewarden migrate`, and reported by `gatewarden doctor` as *"the old layout is still there: run `gatewarden migrate`"* |
| the environment variables of the old name | `DEV_GATEWAY_HOME`, `DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`, `DEV_GATEWAY_AUTOSTART`, `DEV_GATEWAY_LOG_LEVEL` | read, below the current names, and deprecated: the CLI and the MCP server print one notice per variable that says which name to use instead. The current name wins when both are set |
| the environment variables of the pre-package installation | `TRAEFIK_DEV_CONFIG`, `TRAEFIK_DEV_STATE_DIR`, `TRAEFIK_DEV_LOG_LEVEL` | read, below the current names and below the deprecated ones — unchanged by this slice |
| the old binaries | `bin/traefik-dev.js`, `bin/traefik-devd.js` | still there, still working: they are the same launchers under the names the repository had before the package. They were never published, so nothing outside the repository depends on them — but they are the names a live installation knows |
| the service unit of the old name | `dev-gateway.service`, `dev.mal.arstrom.dev-gateway`, the scheduled task `dev-gateway` | looked for and reported: `gatewarden doctor` has a check, `old service`, that says the unit is still there. It names a launcher that does not exist any more, so the daemon it would start never starts; `gatewarden install-service` writes the unit of the current name |
| the MCP tool names and the CLI commands | `publish_dev_server`, `remove_dev_server`, `list_dev_servers`, `dev_gateway_status`, `register`, … | unchanged — they are the interface, not the name of the product |

The migration of the old name is part of `src/core/migrate.ts`:
`migrateLegacyAppLayout()` moves the configuration file and the route store
of the old directories into the new ones, exactly as `migrateLegacyLayout()`
does for the pre-package layout. Neither deletes anything.

---

## 7. The decisions the human has to take

These are open, and this slice does not take them.

| # | Decision | The alternatives | Why it is not decided here |
| --- | --- | --- | --- |
| 1 | **The name of the repository** | A `gatewarden` — B keep `traefik-api` | it touches the remote of the human's own checkout, and the gitea repository is the human's |
| 2 | **The name of the CLI commands** | A `publish`/`remove` with `register`/`unregister` as aliases — B `publish`/`remove` only — C keep `register`/`unregister` | the human has not decided; the specification keeps the current names |
| 3 | **The Traefik object prefixes** | A `devgw-` / `devgw-hdr-` — B `dev-gateway-` / `dev-gateway-hdr-` — C keep `dev-` / `devhdr-` | the names are in the user's proxy, and the rename of them changes the live system |
| 4 | **The headers of the two route tables** | one vocabulary, taken from the tool contract | the CLI's table is read by people and the pi table by agents; the change is a separate slice |

---

## 8. What this slice changed

The name, everywhere it appears, and nothing else:

- the manifest (`name`, `bin`, `files`, `description`, `keywords`);
- the three launchers in `bin/` and the skill directory, both with `git mv`,
  so the history follows the name;
- the directories the package owns in the home, the service names, the MCP
  server's own name, the status line of the pi extension, the environment
  variables, the call sites in `src/`, the documentation, the CI, the
  specification and the memory of the repository;
- the compatibility layer of §6, which is new: the old directories are
  migrated and reported, and the old environment variables are deprecated
  with a notice instead of silently working.

The live gateway in `/opt/devbox-traefik-api` was not touched, and nothing
was written to `~/.traefik-dev/` or to the directories of the old name.
