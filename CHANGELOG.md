# Changelog

All notable changes to this project are documented in this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The names under "Added", "Changed", "Deprecated", "Removed", "Fixed" and
"Security" are the ones
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/#types-of-changes)
names. Every release gets a section, newest first.

## Unreleased

### Changed

- **The first release of the package goes out with a token.** The package
  was not on the registry yet, and npm accepts a trusted publisher only
  for a package that is already there, so the publish of `0.1.1` uses the
  token of the organisation secret on GitHub. The releases after that one
  go out with the trusted publishing again.

- **The log file lives in the state directory on every platform.** macOS and
  Windows had a log directory of their own, and the log file lived there;
  it lives in the state directory now, the way it does on Linux. The state
  directory is the one place where the CLI and the daemon agree, and the
  daemon has to write its log where the CLI opens it. The platform and the
  environment of the process do not decide the log file any more, so
  `logFileFor(stateDir, options)` answers the same file whatever the
  options say.

- **A configuration file that names a state directory keeps it.** The
  environment of the process used to win over the file, and
  `GATEWARDEN_HOME` was such an environment: the CLI ended up with a state
  directory of its own, and the daemon with the one of the installation.
  `GATEWARDEN_STATE_DIR` and `XDG_STATE_HOME` are decisions of the moment
  and still win over the file; `GATEWARDEN_HOME` decides the state
  directory when the configuration names none.

- **The design documents name no address of the installation.** The zone,
  the host name and the addresses of the installation are out of the
  documents of the design as well, and those documents name example values
  instead.

- **The documentation shows the project installation as a choice.** The
  installation was presented as the global installation only. The README and
  the setup guide show both now, say when each one of them is right, and say
  that the commands of a project installation live in the `node_modules/.bin`
  of the project and not on the PATH of the shell.

- **The commands that review the scripts say that they need a project.**
  They read and write the `allowScripts` field of a `package.json`, so they
  stop with `EGLOBAL` when they are given `-g`. The page of the install
  scripts says it above the list of the commands, and the setup guide says
  it too.

- **The migration text describes both homes.** A home that holds one old
  layout gets its configuration file and its route store, and a home that
  holds both gets the ones of the layout of the old name. The older layout
  is reported as not migrated, with the files that stayed where they were
  and with the routes that have to be added to the route store by hand.

- **The gate of the release checks the code that is shipped.** The package
  is packed, unpacked into a clean directory, and every module of the
  shipped build is imported, so a version whose shipped code does not load
  never reaches the registry.

- **The launchers name one module each.** The three launchers named two
  modules each: the TypeScript source for a checkout and the compiled output
  for an installed package. The source is derived from the compiled path
  now, so a launcher names one module and the published package names no
  path of the source. The behaviour is the same: a checkout runs the source
  when it is there and the compiled output otherwise, an installed package
  runs the compiled output.

- **The examples of the repository show example values.** The zone, the host
  name, the paths and the private addresses of the installation are replaced
  by example values in the tests, the tools and the examples of the
  repository, and the addresses of the tests come from the ranges that RFC
  5737 reserves for documentation. The screenshots of the running
  installation are out of the repository: they showed the zone, the host
  name and the live projects in their pixels.

- **The service stays stopped after `gatewarden stop`.** The setup guide
  says now, on macOS and on Linux, that the daemon ends with the exit code 0
  and that the unit of the platform leaves it alone: `SuccessfulExit=false`
  in the launchd agent on macOS, `Restart=on-failure` in the systemd unit on
  Linux.

- **The documents of the repository are in English.** The repository is
  public from now on, and every text in it is read by people who do not read
  Swedish. The memory of the project, the index of the memory and one
  quoted fragment of the specification said the other language; they say
  English now. The file names, the paths and the names of the things they
  point at are the same as they were.

### Fixed

- **The daemon of a service writes to the log file.** The unit of the
  platform starts the daemon with its standard output on the journal, and
  the journal is not a file a reader can open: the log file the CLI points
  at stayed empty for an installation with a service, and the reader found
  an empty file where the log should be. The daemon writes to the log file
  as well as to the standard output, and the workers write to it too. The
  journal of the platform keeps what it had.

- **The daemon runs with the configuration it was given.** The daemon
  resolved its own home from its environment, and the name of the home
  installation wins over every other name. A daemon that was started by
  hand — by the service unit, or by a user in a shell — with that name in
  its environment kept its state and its log in the directory of that
  installation, while the configuration file it was given said something
  else. The name is not read by a daemon that was given a configuration
  file: the file wins over it, and the workers the daemon starts read the
  same file. The line the daemon writes when it starts says which
  configuration file it runs with.

- **The CLI and the daemon open the same log file.** The log file was
  resolved with the environment of the process that asked for it, so a
  `GATEWARDEN_HOME` in the environment of the CLI sent it to a log file the
  daemon never wrote, while the daemon wrote its log in a directory the CLI
  did not look in. The environment of the process does not decide the log
  file any more: the log file lives in the state directory of the
  configuration, and both the CLI and the daemon find it there.

- **The workers of the daemon do not run in another installation.** The
  workers inherited the environment of the daemon, and `GATEWARDEN_HOME`
  was in it: the name wins over every other name, so a worker read the
  configuration of that installation and wrote its state there. The name,
  and the name it had before the rename, are taken away from the
  environment the workers get; they run with the configuration file and the
  state directory the daemon was given.

- **The README says what the service does.** The command table said that
  `gatewarden stop` stops the daemon, and that `gatewarden install-service`
  starts it again after a reboot, and it left out the two things a reader
  needs: the service does not bring the daemon back after `gatewarden stop`,
  on macOS and on Linux, and `--no-enable` writes the unit of the platform
  without enabling it. The README says both now, the way the setup guide
  says them, and it says what `--no-enable` means on each platform: on Linux
  the daemon does not start at a reboot when the unit is not enabled, on
  macOS the agent is written to `~/Library/LaunchAgents`, which launchd
  loads at every login, so the daemon starts at the next login.

- **The test script of the manifest runs in an installation.** The published
  package ships no test files, so `npm test` in it stopped with an error
  about the test files it could not find. The script finds the test files of
  a checkout itself now, and it says that there are none when there are
  none.

- **The end-to-end commands of the manifest run in an installation.** The
  published package ships no tools of the end-to-end environment, so
  `npm run test:e2e` and `npm run test:e2e:stop` in it looked for a file
  that the reader does not have and died with "Could not find". The commands
  find the tools themselves now, the way the test command does: they run the
  tools of a checkout, and they say that there is nothing to run when there
  is nothing to run.

- **The doctor does not say that the files of an old layout came over when
  they did not.** It counted a file of an old layout as migrated when the
  target file was there. It compares the content now: the routes of a route
  store one by one, with the identity the migration uses, and the settings
  of a configuration file one by one. What did not come over is named, the
  old directory is not to be removed, and the advice says what to do by
  hand.

- **The doctor transcript of the setup guide is the output of the CLI.** The
  transcript had drifted from what `gatewarden doctor` prints: the name
  column started one space too early, the row for the shared middlewares
  was missing, and the trust list held no IPv6 prefix. It is the output of
  a real run in a clean installation now, copied word for word, with one
  line that says which installation it comes from.

- **The page of the install scripts describes what npm does.** It described
  a denial of the scripts that cannot happen: a global installation has no
  `allowScripts` field to write to, and the list of `--allow-scripts` and of
  `.npmrc` can only carry approvals. The page says what holds under npm 11
  and under npm 12, the examples of the warnings are what npm writes word
  for word, and every reference to the field names the field.

- **The migration says what happens with both old layouts.** A home with
  both old layouts migrated the newer one first and skipped the older one,
  and the report called the older one "nothing to migrate": the routes of
  the older layout never came over, and the report did not say where they
  were. The report says now what was moved, what was not moved and why, and
  where the files that were not moved are. The layout of the old name is
  migrated first, and the migration deletes nothing.

- **The warning about an old layout can be cleared.** The check asked only
  whether the old directory was still there. A migration copies the files
  and leaves the directory where it is, so the warning could never be
  cleared, and the reader was told to run `gatewarden migrate` again, for
  ever. The check asks now what matters: is there anything in the old
  layout that still has to be migrated? When everything the old layout held
  came over, the doctor says so and says that the old directory can be left
  in place or removed by the reader.

## 0.1.1 - 2026-11-01

The version before this one, `0.1.0`, was published on the registry and
withdrawn on the same day. It was installable during the hours it was
there, it is not in the registry now, and the version number `0.1.0` is not
used again. This release is therefore the first one of the package that
stays on the registry, and the one to install.

### Added

- **A proxy-agnostic core.** The registry, the relay, the route state, the
  configuration and the daemon lifecycle live in one core that knows
  nothing about Traefik. The proxy is an adapter behind the `ProxyAdapter`
  contract, and the adapter is picked by the `proxy` key of the
  configuration.
- **A Traefik adapter.** The adapter renders the dynamic configuration
  document that Traefik polls, and it knows the entry points, the
  middlewares and the certificate resolver.
- **A registry.** One HTTP listener that serves the dynamic configuration
  document (`GET /<proxy>`) and a health probe (`GET /healthz`). It has no
  write path: the web interface is gone, and the other surfaces write the
  state file directly.
- **A relay.** One HTTP listener that dispatches a request to the dev server
  that the proxy named in the `X-Dev-Target` header. It only ever connects
  to `127.0.0.1`, and it tunnels WebSocket upgrades byte for byte.
- **A daemon.** The two listeners are supervised by a background process
  that outlives the command that started it, with a pid file, a lock and a
  restart. It starts itself the first time a command needs it, and
  `gatewarden start` starts it by hand.
- **A CLI** — `gatewarden` with `register`, `unregister`, `list`, `status`,
  `config`, `setup`, `start`, `stop`, `doctor`, `install-service` and
  `migrate`.
- **An MCP server** — `gatewarden-mcp`, with the tools `publish_dev_server`,
  `remove_dev_server`, `list_dev_servers` and `dev_gateway_status`.
- **A pi extension, an Agent Skill and a block for the agents**
  (`docs/AGENTS.md`), so that an agent can publish a dev server without
  being told the host name twice.
- **A setup wizard** (`gatewarden setup`): it reads the proxy, derives what
  it can, asks for the rest and writes the configuration file.
- **A health check that reports instead of failing.** `gatewarden doctor`
  names every check it made, with the reason and the way out, and changes
  nothing. A thing that is missing but not broken is a warning, not a
  failure, and `--strict` turns the warnings into failures for the one who
  wants that.
- **A migration** (`gatewarden migrate`) from the old layout to the current
  one. It is never run on its own during an install.
- **A service unit** for Linux (systemd), macOS (launchd) and Windows (a
  scheduled task), installed by `gatewarden install-service`.
- **The package itself**: the compiled JavaScript, the type declarations,
  the three binaries and the documentation. The documentation is
  `README.md` — what the package is and how to use it — and `docs/setup.md`
  (the setup, by hand and through the wizard), `docs/traefik.md` (the proxy
  side of the wiring), `docs/healthcheck.md` (what every line of
  `gatewarden doctor` means), `docs/AGENTS.md` (the block an agent reads)
  and `docs/install-scripts.md` (the install scripts of the package, the
  warning npm prints for them, and the commands that review and approve
  them). The install writes the configuration file with the default values
  and creates the three directories the gateway uses. It opens no port,
  starts no process and leaves nothing behind.
- **The manifest of the package is complete.** The files the package ships
  are named one by one in the manifest, the entry points name their type
  declarations before their JavaScript, the binaries are named, the version
  of node is declared, and the package is ESM-only.
- **A release is gated.** A version that does not typecheck, does not build
  or does not pass the tests never reaches the registry: the build and the
  tests are the gate of the release.
- **The doctor warns about a proxy that is not in the trust list.** The
  proxy polls the configuration document and sends the dispatch header, and
  an address that is not in `allowedCidrs` is answered with a `403` — the
  most common reason for one. The doctor resolves the host of the proxy's
  API and compares the addresses it finds with the trust list: a proxy
  that the list does not cover is a warning with the way out, never a
  failure. The doctor prints the trust list it uses as well, so a reader
  can see which addresses may talk to the gateway. The address of the
  proxy's API is read from `GATEWARDEN_PROXY_API_URL`.

### Changed

- **The README is written for a reader who has never seen the tool.** It
  says what the tool does, what it needs, how to install it, how to
  configure it and what to do when something does not work. It does not
  describe the installation it was written for any more.
- **The published package names no repository.** The manifest fields
  `repository`, `homepage`, `bugs` and `funding` are gone, and the README,
  the changelog and the contributing guide no longer name a private host.
  The package is installed from the public npm registry, and a package that
  everybody can install does not point a reader at a private host. The
  public name of the package is unchanged: the name in the npm scope, the
  names of the binaries, the names of the MCP tools, the commands and the
  ports stay what they were.
- **The package says where its source lives.** The manifest names the
  repository of the project in `repository`, `homepage` and `bugs`, and
  the README has a section that names it too. A reader on npmjs.org
  reaches the source from the page of the package now, and the page of
  the package no longer asks a question it could not answer.

- **The package names one address everywhere.** The security policy named
  another address than the readme, and the package names one address now:
  the support address, which the readme named already. A report that goes
  to the address of the package reaches the maintainer of the package, and
  the guard reads the documents of the repository too.

- **The message about a missing build names one command.** A launcher
  without a build told the reader to reinstall the package the way it
  was installed, and named the command of a project install and the
  command of a global install, so the reader had to choose one of the
  two. The launcher knows which installation it is in — a dependency of
  a project lives in the `node_modules` of that project, and a global
  installation lives in the global root of npm — and the message names
  the command of that installation now: `npm install @malarstrom/gatewarden`
  for a project, `npm install -g @malarstrom/gatewarden` for a global one.

### Deprecated

- **The names of the environment variables before the rename are deprecated.**
  `DEV_GATEWAY_HOME`, `DEV_GATEWAY_CONFIG` and `DEV_GATEWAY_STATE_DIR`
  still work, but the CLI reads them and says once that they are on their
  way out. `GATEWARDEN_HOME`, `GATEWARDEN_CONFIG` and
  `GATEWARDEN_STATE_DIR` are the names to use.

### Fixed

- **The relay closes its upgraded WebSocket sockets.** An upgraded socket is
  not closed by `server.close()`, and the relay never closed it either: the
  listener could therefore never finish its shutdown while a WebSocket was
  open, and the socket's handle kept the process alive. The relay now owns
  the upgraded sockets and closes them with the listener.
- **A peer that resets a refused WebSocket no longer takes the gateway
  down.** Node hands an upgraded socket to the application without an error
  handler of its own, and the relay attached its handler only after the
  refusals: a peer that reset a refused upgrade gave an unhandled
  `ECONNRESET` that stopped the worker.
- **The published documentation points at no file the package does not
  ship.** The architecture reference of the skill and the setup guide named
  documents that are not in the package: a reader of the installed package
  followed the pointer and found nothing. The documentation names the files
  that are really there now, and the test suite keeps it that way.
- **The error the worker shows no longer names a file the package does not
  ship.** Started without a role, the worker used to tell the reader to run
  it from the sources of the repository, which the published package does
  not carry. It says now that the role must be `registry` or `relay`, that
  the daemon starts the worker and that `gatewarden start` starts the
  daemon. The test suite keeps every message of the package free of paths
  into the sources.
- **The launchers of an installed package speak about the installation.** A
  launcher in a package that was installed without its compiled output said
  "no build found — run "npm run build"", and that command belongs to a
  checkout: a reader of an installed package has no checkout and nothing to
  build. The message says that the installation is incomplete and names the
  command that reinstalls the package the way it was installed.
- **The manifest names no file that the package does not ship.** The
  command that empties the build output of a checkout pointed at a
  script that the package does not carry: a reader who ran it in an
  installed package got an error about a file that was not there. The
  command removes the build output itself now, and it does nothing in an
  installed package — there is no build output there to empty.
- **An unknown proxy id is an error, and not a loop.** A `proxy` key that
  names an id the package does not know killed the worker at once, and the
  daemon started it again and again: the log filled with "respawning", and
  `gatewarden start` failed on a timeout that said nothing about the
  mistake. The daemon stops with the reason now, the command says which id
  is unknown and which ids exist — `unknown proxy "caddy" (known:
  traefik)` — and `gatewarden doctor` reports the id as an error.

### Security

- **Only the addresses on the trust list are answered, and only with the
  secret.** The relay checks the source address against `allowedCidrs` and
  the `X-Relay-Secret` header against the shared secret; the registry
  checks `X-Registry-Secret` before it serves the configuration document.
  An address that is not on the list is answered with `403`, and the answer
  says which address was refused and in which key the list is written.
  `registryAllowedCidrs` widens the list of the registry on top of
  `allowedCidrs`.
- **The install script never fails an install.** `postinstall` exits 0
  whatever happens, writes nothing to the terminal, and does nothing in a
  CI environment, as root, in a checkout, and when
  `GATEWARDEN_AUTOSTART=0` is set.
- **The route state is written under a lock**, so two registrations at the
  same time cannot lose one of them.
- **A report of a hole has a place to go.** The README has a security
  section that names the address a report goes to and asks for the details
  a reader of the report needs.
