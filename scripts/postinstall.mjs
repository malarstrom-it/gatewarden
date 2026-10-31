#!/usr/bin/env node
/**
 * The second layer of the daemon lifecycle (§5.2).
 *
 * The install starts the daemon once, so that a fresh installation is
 * alive before the first command runs. The three layers are:
 *
 * 1. the lazy start: every entry point starts the daemon when it is down;
 * 2. this script: the install starts it once, in the background;
 * 3. `gatewarden install-service`: the daemon survives a reboot.
 *
 * The rules the specification sets, one by one:
 *
 * - the script never fails the install: it always exits 0;
 * - it is silent: the one line it writes goes to the log;
 * - it does nothing when `npm_config_ignore_scripts` is set, when the
 *   environment is a CI, or when the install runs as root (a global
 *   install as root must not start a daemon for one user);
 * - it does nothing when the daemon is already running: the check is the
 *   health endpoint and the pidfile;
 * - `GATEWARDEN_AUTOSTART=0` and `"autostart": false` turn it off. The
 *   name the variable had before the rename (`DEV_GATEWAY_AUTOSTART`) still
 *   works, and it is deprecated.
 *
 * One guard is added: a checkout is not an installation. When the script
 * runs in the package's own directory — `npm install` in a clone — it does
 * nothing, so that a developer never gets a daemon they did not ask for.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The install must never fail because of this script. */
function stop() {
  process.exit(0);
}

if (process.env.npm_config_ignore_scripts === 'true') stop();
if (process.env.CI) stop();
if ((process.env.GATEWARDEN_AUTOSTART ?? process.env.DEV_GATEWAY_AUTOSTART) === '0') stop();
if (process.getuid?.() === 0) stop();

// A checkout is not an installation: `npm install` in the package's own
// directory must not start a daemon on the developer's machine, and must
// not write anything into the developer's home. The published package is
// not private — npm refuses to publish a private package — so this guard
// is the difference between the two. A checkout is recognised by what it
// holds: the sources and the build configuration. An installation holds
// the compiled output and nothing else.
if (isCheckout()) stop();

// The install does not import the old layout (`~/.traefik-dev/`). The
// migration is the job of `gatewarden migrate`, and a silent import
// during an install would write into the user's home without being
// asked. The configuration the install writes is the default one.
const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : null;
if (initCwd && initCwd === PACKAGE_ROOT) stop();

/** Is this the repository, and not an installed package? */
function isCheckout() {
  return (
    fs.existsSync(path.join(PACKAGE_ROOT, 'src')) &&
    fs.existsSync(path.join(PACKAGE_ROOT, 'tsconfig.build.json'))
  );
}

/** Import a module of the package.
 *
 * The published package ships the compiled modules (D2); a checkout has
 * the sources, which Node can run on its own. The compiled ones are
 * preferred: they are what the package ships.
 */
async function importCore(relative) {
  const compiled = path.join(PACKAGE_ROOT, 'dist', relative);
  if (fs.existsSync(compiled)) return import(pathToFileURL(compiled).href);
  const source = path.join(PACKAGE_ROOT, 'src', relative.replace(/\.js$/, '.ts'));
  if (fs.existsSync(source)) return import(pathToFileURL(source).href);
  throw new Error(`${relative} is not in the package`);
}

try {
  const { loadConfig, writeConfigFile } = await importCore('core/config.js');
  const { ensureLogDirectory } = await importCore('core/daemonControl.js');
  const { resolvePaths } = await importCore('core/paths.js');

  const paths = resolvePaths();
  const config = loadConfig({ migrate: false });

  // The directories the gateway writes to have to exist before anything
  // else happens.
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.mkdirSync(paths.cacheDir, { recursive: true });
  ensureLogDirectory(paths.logFile);

  // The configuration file is written once, and never overwritten.
  if (!fs.existsSync(paths.configFile)) {
    writeConfigFile(paths.configFile, config);
  }

  if (config.autostart) {
    const { ensureDaemon } = await importCore('core/daemonControl.js');
    const started = await ensureDaemon(config, { configPath: paths.configFile });
    const line = started.error
      ? `postinstall: the daemon did not start (${started.error})`
      : started.started
        ? `postinstall: the daemon was started (pid ${started.pid})`
        : 'postinstall: the daemon was already running';
    try {
      fs.appendFileSync(paths.logFile, `${line}\n`);
    } catch {
      // The log is a convenience, not a requirement.
    }
  }
} catch {
  // Never fail the install.
}

process.exit(0);
