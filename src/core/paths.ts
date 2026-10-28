/**
 * Where the gateway keeps its files (D6, §3.1).
 *
 * The layout follows the XDG Base Directory specification, resolved with
 * `env-paths`, the convention of the npm ecosystem:
 *
 * | Purpose   | Linux                             | macOS                                     | Windows                            |
 * | --------- | --------------------------------- | ----------------------------------------- | ---------------------------------- |
 * | config    | `~/.config/dev-gateway/config.json` | `~/Library/Preferences/dev-gateway/`     | `%APPDATA%\dev-gateway\Config\`     |
 * | state     | `~/.local/state/dev-gateway/`       | `~/Library/Application Support/dev-gateway/` | `%LOCALAPPDATA%\dev-gateway\State\` |
 * | log       | `~/.local/state/dev-gateway/daemon.log` | `~/Library/Logs/dev-gateway/`         | `%LOCALAPPDATA%\dev-gateway\Log\`   |
 *
 * `env-paths` supplies the configuration, cache and log directories. The
 * state directory is one extra resolution, because XDG's `state` has no
 * macOS or Windows equivalent in `env-paths`: on Linux the state directory
 * *is* the log directory (`~/.local/state`), on macOS it is the "Application
 * Support" directory, and on Windows it is a `State` directory next to the
 * ones `env-paths` knows.
 *
 * The resolution order (§3.1):
 *
 * 1. `DEV_GATEWAY_HOME` — everything in one directory.
 * 2. `DEV_GATEWAY_CONFIG` — the configuration file only.
 * 3. `DEV_GATEWAY_STATE_DIR` — the state directory only.
 * 4. `env-paths('dev-gateway', { suffix: '' })` — the XDG defaults.
 *
 * The names of the pre-package installation (`TRAEFIK_DEV_CONFIG`,
 * `TRAEFIK_DEV_STATE_DIR`) are still honoured, but below the new ones: a
 * script that sets them keeps working, and the new names win when both are
 * set.
 *
 * The platform is a parameter, so the resolution can be unit tested for
 * Linux, macOS and Windows on any host. When the resolution runs for the
 * platform the process actually runs on, and nobody injected an environment
 * or a home directory, the directories come from `env-paths` itself; the
 * other platforms use the same layout, written out here, so that the three
 * platforms can be tested. `test/paths.test.ts` holds the two sides against
 * each other, so the copy cannot drift away from `env-paths`.
 */

import os from 'node:os';
import path from 'node:path';
import envPaths from 'env-paths';

/** The name of the directories the package owns inside the user's home. */
export const APP_NAME = 'dev-gateway';

/** The directory of the pre-package layout. The migration reads it. */
export const LEGACY_DIR_NAME = '.traefik-dev';

/** The four directories the gateway works with. */
export interface GatewayPaths {
  /** The configuration file. */
  configFile: string;
  /** The state directory: the route store and the pidfile. */
  stateDir: string;
  /** The daemon log file. */
  logFile: string;
  /** The cache directory. */
  cacheDir: string;
}

/** The base directories of one platform. */
export interface PlatformDirs {
  config: string;
  state: string;
  log: string;
  cache: string;
}

/** The environment the resolution reads. */
export type PathEnv = Record<string, string | undefined>;

export interface PathOptions {
  /** The platform to resolve for. Defaults to the running platform. */
  platform?: NodeJS.Platform;
  /** The environment to read. Defaults to `process.env`. */
  env?: PathEnv;
  /** The user's home directory. Defaults to `os.homedir()`. */
  home?: string;
}

/** Read an environment variable, treating an empty value as unset. */
function readEnv(env: PathEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The base directories of a platform, written out.
 *
 * This is the layout `env-paths` implements, so the resolution can be
 * tested for platforms the host does not run.
 */
export function platformDirs(platform: NodeJS.Platform, env: PathEnv, home: string): PlatformDirs {
  if (platform === 'darwin') {
    const library = path.join(home, 'Library');
    return {
      config: path.join(library, 'Preferences', APP_NAME),
      state: path.join(library, 'Application Support', APP_NAME),
      log: path.join(library, 'Logs', APP_NAME),
      cache: path.join(library, 'Caches', APP_NAME),
    };
  }

  if (platform === 'win32') {
    const appData = readEnv(env, 'APPDATA') ?? path.join(home, 'AppData', 'Roaming');
    const localAppData = readEnv(env, 'LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local');
    return {
      config: path.join(appData, APP_NAME, 'Config'),
      state: path.join(localAppData, APP_NAME, 'State'),
      log: path.join(localAppData, APP_NAME, 'Log'),
      cache: path.join(localAppData, APP_NAME, 'Cache'),
    };
  }

  // Linux and everything that follows the XDG specification.
  const stateHome = readEnv(env, 'XDG_STATE_HOME') ?? path.join(home, '.local', 'state');
  return {
    config: path.join(readEnv(env, 'XDG_CONFIG_HOME') ?? path.join(home, '.config'), APP_NAME),
    state: path.join(stateHome, APP_NAME),
    // On Linux the log lives next to the state, as XDG keeps both there.
    log: path.join(stateHome, APP_NAME),
    cache: path.join(readEnv(env, 'XDG_CACHE_HOME') ?? path.join(home, '.cache'), APP_NAME),
  };
}

/**
 * The base directories of the platform the process runs on, from `env-paths`.
 *
 * This is the production path: `env-paths` is the source of the layout
 * (D6), and the state directory is the one directory it does not have.
 */
export function envPathsDirs(): PlatformDirs {
  const paths = envPaths(APP_NAME, { suffix: '' });
  const state =
    process.platform === 'darwin'
      ? paths.data
      : process.platform === 'win32'
        ? path.join(path.dirname(paths.data), 'State')
        : paths.log;
  return { config: paths.config, state, log: paths.log, cache: paths.cache };
}

/**
 * The base directories to resolve from.
 *
 * `env-paths` is used when the resolution is for the running platform and
 * nobody injected an environment or a home directory; otherwise the layout
 * is written out, so that every platform can be resolved on any host.
 */
function baseDirs(platform: NodeJS.Platform, env: PathEnv, home: string): PlatformDirs {
  const running =
    platform === process.platform && env === process.env && home === os.homedir();
  return running ? envPathsDirs() : platformDirs(platform, env, home);
}

/** The value of `DEV_GATEWAY_HOME`: everything in one directory. */
export function homeOverride(env: PathEnv = process.env): string | undefined {
  return readEnv(env, 'DEV_GATEWAY_HOME');
}

/** The value of `DEV_GATEWAY_CONFIG`: the configuration file only. */
export function configFileOverride(env: PathEnv = process.env): string | undefined {
  return readEnv(env, 'DEV_GATEWAY_CONFIG') ?? readEnv(env, 'TRAEFIK_DEV_CONFIG');
}

/** The value of `DEV_GATEWAY_STATE_DIR`: the state directory only. */
export function stateDirOverride(env: PathEnv = process.env): string | undefined {
  return readEnv(env, 'DEV_GATEWAY_STATE_DIR') ?? readEnv(env, 'TRAEFIK_DEV_STATE_DIR');
}

/**
 * The log file of a state directory.
 *
 * `DEV_GATEWAY_HOME` puts the log in that one directory, like everything
 * else. Otherwise the log lives next to the state on Linux, because XDG
 * keeps both under `~/.local/state`; on macOS and Windows the platform has
 * a log directory of its own, and the log goes there.
 *
 * This and {@link resolvePaths} must always answer the same: the daemon
 * writes its log where the CLI opens it.
 */
export function logFileFor(stateDir: string, opts: PathOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const homeDir = homeOverride(env);
  if (homeDir) return path.join(path.resolve(homeDir), 'daemon.log');
  const dirs = baseDirs(platform, env, home);
  const logDir = platform === 'linux' ? stateDir : dirs.log;
  return path.join(logDir, 'daemon.log');
}

/**
 * Resolve the four directories the gateway works with.
 *
 * `DEV_GATEWAY_HOME` wins over everything: it puts the configuration, the
 * state, the log and the cache in one directory. The other two overrides
 * touch one directory each.
 */
export function resolvePaths(opts: PathOptions = {}): GatewayPaths {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const dirs = baseDirs(platform, env, home);

  const homeDir = homeOverride(env);
  if (homeDir) {
    const base = path.resolve(homeDir);
    return {
      configFile: path.join(base, 'config.json'),
      stateDir: base,
      logFile: path.join(base, 'daemon.log'),
      cacheDir: path.join(base, 'cache'),
    };
  }

  const configOverride = configFileOverride(env);
  const stateOverride = stateDirOverride(env);
  const stateDir = stateOverride ? path.resolve(stateOverride) : dirs.state;

  return {
    configFile: configOverride ? path.resolve(configOverride) : path.join(dirs.config, 'config.json'),
    stateDir,
    logFile: logFileFor(stateDir, { platform, env, home }),
    cacheDir: dirs.cache,
  };
}

/**
 * The directory of the pre-package layout, `~/.traefik-dev`.
 *
 * The migration reads it; nothing ever writes to it again.
 */
export function legacyDir(opts: PathOptions = {}): string {
  const home = opts.home ?? os.homedir();
  return path.join(home, LEGACY_DIR_NAME);
}
