# The install scripts of the package

The package ships four scripts: two install scripts (`postinstall` and
`prepare`) and two uninstall scripts (`preuninstall` and `postuninstall`).
Under npm 11 every dependency that ships install scripts gets a warning.
Under npm 12 those scripts are blocked until the dependency is approved. This
page says what the warning means, how to review the scripts, and how to
approve them.

## What the scripts do

The two install scripts:

- `postinstall` writes the configuration file with the default values. A
  configuration file that is already there stays as it is. The script creates
  the three directories the gateway uses: the configuration directory, the
  state directory and the cache. It starts no daemon, opens no port and leaves
  no process behind.
- `prepare` builds the package from the TypeScript it holds. The build empties
  `dist/` on the way: it runs `npm run clean` first, which removes the directory,
  and the compiler writes it again. The published package ships the compiled
  output, so the build does not run for it.

The two uninstall scripts:

- `preuninstall` stops the daemon of the installation before the package goes.
  It reads the pid file of the installation, checks that the process in it is
  the daemon of that installation, and stops it: `SIGTERM` first, and `SIGKILL`
  when the daemon is still there after ten seconds. It never fails the
  uninstall: it always exits 0.
- `postuninstall` removes what the installation left behind: the configuration
  file, the files of the gateway in the state directory (the route store, the
  registrations, the pid file and the log) and the cache. It never fails the
  uninstall: it always exits 0.

What npm does with the two install scripts depends on where the package comes
from:

| Source of the package | `prepare` | `postinstall` |
| --- | --- | --- |
| a tarball | named in the warning, not run | runs |
| the registry | not an install script | runs |
| a package with sources | runs, it builds the package | runs |

npm names the install scripts of the package in its warning: `postinstall`
always, and `prepare` for the sources where npm counts it as one — a tarball
or a package with sources, not the registry. The two uninstall scripts are
never named in it: npm 7 and later do not run the uninstall scripts of a
package, so under npm the files of an installation that is removed stay where
they are until the consumer removes them. The daemon stops itself when the
package is gone; the two uninstall scripts are what the package managers that
do run them use.

## The warning of npm 11 and npm 12

From npm 11.16 on, every dependency that ships install scripts gets a warning.
The warning names the scripts of the package. What npm does with those scripts
changed in npm 12.

- npm 11 warns and lets the scripts run. The warning says that the scripts are
  "not yet covered" by `allowScripts`. For a dependency that the `allowScripts`
  field of the `package.json` does not mention, the field is advisory: the
  scripts run anyway. An entry that denies the dependency is not advisory: it
  skips the script in npm 11 too, and an entry that approves the dependency
  silences the warning.
- npm 12 blocks the scripts until the dependency is approved. The warning says
  that the scripts were "blocked", and the install script of the dependency
  does not run until the dependency is approved.

A global install from the registry says, with npm 11.19.0:

```text
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   @malarstrom/gatewarden@0.1.1 (postinstall: node scripts/postinstall.mjs)
npm warn install-scripts
npm warn install-scripts Run `npm install -g --allow-scripts=@malarstrom/gatewarden` to allow these scripts once, or `npm config set allow-scripts=@malarstrom/gatewarden --location=user` to allow them for all global installs.
```

and with npm 12.2.1:

```text
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   @malarstrom/gatewarden@0.1.1 (postinstall: node scripts/postinstall.mjs)
npm warn install-scripts
npm warn install-scripts Run `npm install -g --allow-scripts=@malarstrom/gatewarden` to allow these scripts once, or `npm config set allow-scripts=@malarstrom/gatewarden --location=user` to allow them for all global installs.
```

A global install from a tarball names the same package and names `prepare`
with it, because npm counts `prepare` as an install script for a tarball and
not for the registry. With npm 11.19.0:

```text
npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn install-scripts   @malarstrom/gatewarden@0.1.1 (postinstall: node scripts/postinstall.mjs; prepare: npm run build)
npm warn install-scripts
npm warn install-scripts Run `npm install -g --allow-scripts=@malarstrom/gatewarden` to allow these scripts once, or `npm config set allow-scripts=@malarstrom/gatewarden --location=user` to allow them for all global installs.
```

With npm 12.2.1 the same install says "blocked" instead of "not yet covered",
and it names the same scripts:

```text
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   @malarstrom/gatewarden@0.1.1 (postinstall: node scripts/postinstall.mjs; prepare: npm run build)
npm warn install-scripts
npm warn install-scripts Run `npm install -g --allow-scripts=@malarstrom/gatewarden` to allow these scripts once, or `npm config set allow-scripts=@malarstrom/gatewarden --location=user` to allow them for all global installs.
```

An install in a project writes the same lines, and its last line names the
commands that review the scripts:

```text
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

## How to review the scripts

These commands work in a project. They read and write the `allowScripts` field
in the `package.json` of the project.

```bash
npm install-scripts ls                                  # list, read-only
npm install-scripts approve @malarstrom/gatewarden      # write the approval
npm install-scripts deny @malarstrom/gatewarden         # write the denial
```

- `npm install-scripts ls` prints the same list as the warning, and changes
  nothing.
- `npm install-scripts approve @malarstrom/gatewarden` writes the approval
  into the `package.json`. The next install of the package prints no warning,
  and under npm 12 it runs the install script.
- `npm install-scripts deny @malarstrom/gatewarden` writes the denial into the
  `package.json`. The install script does not run: under npm 11 it is skipped,
  under npm 12 it is blocked. Neither prints a warning.

The key in the `allowScripts` field follows where the dependency comes from. A
dependency from the registry gets a pinned `@malarstrom/gatewarden@0.1.1`. A
dependency from a tarball gets the path of the tarball.

These commands need a project. With `-g` they stop with `EGLOBAL`.

The command arrived in npm 11.18. npm 11.16 and 11.17 have the same commands
under their own names: `npm approve-scripts --allow-scripts-pending` reads the
list, `npm approve-scripts <pkg>` writes the approval, and `npm deny-scripts
<pkg>` writes the denial.

## A global install

A global install has no project of its own, so npm does not read the `allowScripts`
field of a `package.json` for it: that field belongs to a project, and a global
install has none. npm skips it even when the global install runs in the directory
of a project. npm reads two other places instead, the `--allow-scripts` flag and
the `allow-scripts` setting of an `.npmrc`. Every entry in either of them
approves a package, and neither of them can carry a denial. Both of them work
in npm 11.19.0 and npm 12.2.1:

```bash
npm install -g --allow-scripts=@malarstrom/gatewarden
npm config set allow-scripts='@malarstrom/gatewarden' --location=user
```

Under npm 11 the scripts run with the approval and without it; the approval
silences the warning, and nothing more. Under npm 12 the scripts stay blocked
until the approval names the package; then they run, and the warning is gone.

| Source of the package | What the approval has to name |
| --- | --- |
| the registry | `@malarstrom/gatewarden`, or the pinned `@malarstrom/gatewarden@0.1.1` |
| a tarball | the path of the tarball |

A tarball is matched by its path, not by its name, so the name alone does not
unblock a tarball install.

In a project, `--allow-scripts` is refused. npm answers `--allow-scripts is not
allowed in project-scoped installs` and asks for the `allowScripts` field in
the `package.json` or in `.npmrc` instead.

## No install script at all

Ask npm not to run the scripts:

```bash
npm install -g --ignore-scripts
npm ci --ignore-scripts
```

With `--ignore-scripts` npm sets `npm_config_ignore_scripts=true` and does not
run the script. Nothing is written.

One setting turns the warning into a failed install:
`strict-allow-scripts=true` makes npm stop with `ESTRICTALLOWSCRIPTS` and
install nothing.

## Nothing breaks without the scripts

The package works without the install script. The setup wizard writes the same
configuration file, and the commands work without one. The daemon is started by
the commands that need it, and by `gatewarden install-service`.
