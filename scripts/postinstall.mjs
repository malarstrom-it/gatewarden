#!/usr/bin/env node
/**
 * The install script of the package.
 *
 * The script writes the configuration file and nothing else. It starts
 * no daemon, opens no port and leaves no process behind: an install
 * that starts a daemon makes the machine do something nobody asked for,
 * and the consumer finds three processes and two open ports waiting for
 * it.
 *
 * The daemon is started by the lazy start — every entry point starts it
 * when it is down — and by the explicit command `gatewarden start`.
 * Nothing else has to start it.
 *
 * The rules the script keeps:
 *
 * - it never fails the install: it always exits 0;
 * - it is silent: it writes nothing to stdout or stderr;
 * - it does nothing when `npm_config_ignore_scripts` is set, when the
 *   environment is a CI, when the install runs as root (a global install
 *   as root must not write into the home of one user), or when the
 *   package is the repository itself (a checkout is not an installation);
 * - it writes the configuration file once, and never overwrites it;
 * - `GATEWARDEN_AUTOSTART=0` turns the whole script off. The name the
 *   variable had before the rename (`DEV_GATEWAY_AUTOSTART`) still
 *   works, and it is deprecated.
 *
 * The install does not import the old layout (`~/.traefik-dev/`). The
 * migration is the job of `gatewarden migrate`, and a silent import
 * during an install would write into the user's home without being
 * asked.
 *
 * npm 11 blocks the install scripts of a dependency until the consumer
 * has reviewed them (`npm install-scripts ls`), so the script runs only
 * for a consumer who approves it. The gateway does not need it: the
 * setup wizard writes the same file, and the commands work without one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gatewayPaths, isCheckout, PACKAGE_ROOT } from './paths.mjs';

/** The install must never fail because of this script. */
function stop() {
  process.exit(0);
}

if (process.env.npm_config_ignore_scripts === 'true') stop();
if (process.env.CI) stop();
if ((process.env.GATEWARDEN_AUTOSTART ?? process.env.DEV_GATEWAY_AUTOSTART) === '0') stop();
if (process.getuid?.() === 0) stop();

// A checkout is not an installation: `npm install` in the package's own
// directory must not write into the home of the developer. The published
// package is not private — npm refuses to publish a private package — so
// this guard is the difference between the two. A checkout is recognised
// by what it holds: the sources and the build configuration. An
// installation holds the compiled output and nothing else.
if (isCheckout()) stop();

const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : null;
if (initCwd && initCwd === PACKAGE_ROOT) stop();

/**
 * Import a module of the package.
 *
 * The published package ships the compiled modules; a checkout has
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
  const paths = await gatewayPaths();
  const { loadConfig, writeConfigFile } = await importCore('core/config.js');
  const config = loadConfig({ migrate: false });

  // The directories the gateway writes to have to exist before anything
  // else happens.
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  fs.mkdirSync(paths.cacheDir, { recursive: true });

  // The configuration file is written once, and never overwritten. The
  // file the script writes holds the default values: the consumer fills
  // them in, or the setup wizard does.
  if (!fs.existsSync(paths.configFile)) {
    writeConfigFile(paths.configFile, config);
  }
} catch {
  // Never fail the install.
}

process.exit(0);
