#!/usr/bin/env node
/**
 * Where the gateway keeps its files, for the scripts of the package.
 *
 * The rules are the ones of `src/core/paths.ts` (§3.1):
 *
 * 1. `GATEWARDEN_HOME` — everything in one directory;
 * 2. `GATEWARDEN_CONFIG` — the configuration file only;
 * 3. `GATEWARDEN_STATE_DIR` — the state directory only;
 * 4. the XDG defaults of the platform.
 *
 * The names the variables had before the rename (`DEV_GATEWAY_HOME`,
 * `DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`) and the ones of the
 * pre-package layout (`TRAEFIK_DEV_CONFIG`, `TRAEFIK_DEV_STATE_DIR`) are
 * honoured as well, below the current ones.
 *
 * The script prefers the compiled core of the package: one implementation
 * of the rules, the one the rest of the package uses. The copy below is
 * the fallback for an installation whose compiled output is gone — an
 * uninstall must work even when the package is half removed — and
 * `test/uninstall.test.ts` holds the two against each other, so that the
 * copy cannot drift away from the core.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read an environment variable, treating an empty value as unset. */
function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The first variable of a list that is set. */
function firstEnv(env, names) {
  for (const name of names) {
    const value = readEnv(env, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The base directories of a platform.
 *
 * The layout is the one `env-paths` implements, written out so that the
 * script does not need the dependency to be installed.
 *
 * @param {NodeJS.Platform} platform
 * @param {Record<string, string|undefined>} env
 * @param {string} home
 * @returns {{config: string, state: string, log: string, cache: string}}
 */
export function platformDirs(platform, env, home) {
  if (platform === 'darwin') {
    const library = path.join(home, 'Library');
    return {
      config: path.join(library, 'Preferences', 'gatewarden'),
      state: path.join(library, 'Application Support', 'gatewarden'),
      log: path.join(library, 'Logs', 'gatewarden'),
      cache: path.join(library, 'Caches', 'gatewarden'),
    };
  }

  if (platform === 'win32') {
    const appData = readEnv(env, 'APPDATA') ?? path.join(home, 'AppData', 'Roaming');
    const localAppData = readEnv(env, 'LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local');
    return {
      config: path.join(appData, 'gatewarden', 'Config'),
      state: path.join(localAppData, 'gatewarden', 'State'),
      log: path.join(localAppData, 'gatewarden', 'Log'),
      cache: path.join(localAppData, 'gatewarden', 'Cache'),
    };
  }

  const stateHome = readEnv(env, 'XDG_STATE_HOME') ?? path.join(home, '.local', 'state');
  return {
    config: path.join(readEnv(env, 'XDG_CONFIG_HOME') ?? path.join(home, '.config'), 'gatewarden'),
    state: path.join(stateHome, 'gatewarden'),
    log: path.join(stateHome, 'gatewarden'),
    cache: path.join(readEnv(env, 'XDG_CACHE_HOME') ?? path.join(home, '.cache'), 'gatewarden'),
  };
}

/**
 * Resolve the four directories the gateway works with.
 *
 * This is the fallback: the compiled core of the package is preferred,
 * and this copy is what a package without its compiled output falls back
 * to.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [home]
 * @returns {{configFile: string, stateDir: string, logFile: string, cacheDir: string}}
 */
export function resolveGatewayPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  const homeDir = firstEnv(env, ['GATEWARDEN_HOME', 'DEV_GATEWAY_HOME']);
  if (homeDir) {
    const base = path.resolve(homeDir);
    return {
      configFile: path.join(base, 'config.json'),
      stateDir: base,
      logFile: path.join(base, 'daemon.log'),
      cacheDir: path.join(base, 'cache'),
    };
  }

  const dirs = platformDirs(platform, env, home);
  const configOverride = firstEnv(env, [
    'GATEWARDEN_CONFIG',
    'DEV_GATEWAY_CONFIG',
    'TRAEFIK_DEV_CONFIG',
  ]);
  const stateOverride = firstEnv(env, [
    'GATEWARDEN_STATE_DIR',
    'DEV_GATEWAY_STATE_DIR',
    'TRAEFIK_DEV_STATE_DIR',
  ]);
  const stateDir = stateOverride ? path.resolve(stateOverride) : dirs.state;

  return {
    configFile: configOverride ? path.resolve(configOverride) : path.join(dirs.config, 'config.json'),
    stateDir,
    logFile: path.join(platform === 'linux' ? stateDir : dirs.log, 'daemon.log'),
    cacheDir: dirs.cache,
  };
}

/**
 * The directories of the gateway, from the core of the package when it
 * has one, and from the copy above when it has not.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {Promise<{configFile: string, stateDir: string, logFile: string, cacheDir: string}>}
 */
export async function gatewayPaths(env = process.env) {
  try {
    const core = await import(pathToFileURL(path.join(PACKAGE_ROOT, 'dist', 'core', 'paths.js')).href);
    if (typeof core.resolvePaths === 'function') return core.resolvePaths({ env });
  } catch {
    // No compiled core: the copy above is the answer.
  }
  return resolveGatewayPaths(env);
}

/**
 * Is this the repository, and not an installed package?
 *
 * A checkout is not an installation: `npm install` in a clone must not
 * write into the home of the developer, and `npm uninstall` in a clone
 * must not remove anything either.
 */
export function isCheckout() {
  return (
    fs.existsSync(path.join(PACKAGE_ROOT, 'src')) &&
    fs.existsSync(path.join(PACKAGE_ROOT, 'tsconfig.build.json'))
  );
}

export { PACKAGE_ROOT };
