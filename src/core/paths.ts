/**
 * Where the gateway keeps its files (D6, §3.1).
 *
 * The layout follows the XDG Base Directory specification, resolved with
 * `env-paths`, the convention of the npm ecosystem:
 *
 * | Purpose   | Linux                             | macOS                                     | Windows                            |
 * | --------- | --------------------------------- | ----------------------------------------- | ---------------------------------- |
 * | config    | `~/.config/gatewarden/config.json` | `~/Library/Preferences/gatewarden/`     | `%APPDATA%\gatewarden\Config\`     |
 * | state     | `~/.local/state/gatewarden/`       | `~/Library/Application Support/gatewarden/` | `%LOCALAPPDATA%\gatewarden\State\` |
 * | log       | `~/.local/state/gatewarden/daemon.log` | `~/Library/Logs/gatewarden/`         | `%LOCALAPPDATA%\gatewarden\Log\`   |
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
 * 1. `GATEWARDEN_HOME` — everything in one directory.
 * 2. `GATEWARDEN_CONFIG` — the configuration file only.
 * 3. `GATEWARDEN_STATE_DIR` — the state directory only.
 * 4. `env-paths('gatewarden', { suffix: '' })` — the XDG defaults.
 *
 * The names of the pre-package installation (`TRAEFIK_DEV_CONFIG`,
 * `TRAEFIK_DEV_STATE_DIR`) are still honoured, but below the new ones: a
 * script that sets them keeps working, and the new names win when both are
 * set.
 *
 * The names the directories had before the rename
 * (`DEV_GATEWAY_HOME`, `DEV_GATEWAY_CONFIG`, `DEV_GATEWAY_STATE_DIR`) are
 * honoured the same way, below the current ones. They are deprecated:
 * {@link deprecatedEnvNotices} says so, once, where it can be seen.
 *
 * The directories the old name owned (`~/.config/dev-gateway/` and the
 * state directory next to it) are found by {@link legacyAppPaths}, so that
 * the migration can move them and the doctor can report that they are
 * still there.
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
export const APP_NAME = 'gatewarden';

/**
 * The name the directories had before the rename.
 *
 * The name is kept here for one reason: an installation that was made
 * under the old name keeps its configuration and its route store in the
 * directories of that name. The migration moves them, and the doctor says
 * that they are still there.
 */
export const LEGACY_APP_NAME = 'dev-gateway';

/** The directory of the pre-package layout. The migration reads it. */
export const LEGACY_DIR_NAME = '.traefik-dev';

/**
 * The environment variables of the family, with the names they had before
 * the rename.
 *
 * The old names are deprecated: they work, and they say so.
 */
const ENV_FAMILY: Array<{ current: string; legacy: string }> = [
  { current: 'GATEWARDEN_HOME', legacy: 'DEV_GATEWAY_HOME' },
  { current: 'GATEWARDEN_CONFIG', legacy: 'DEV_GATEWAY_CONFIG' },
  { current: 'GATEWARDEN_STATE_DIR', legacy: 'DEV_GATEWAY_STATE_DIR' },
  { current: 'GATEWARDEN_LOG_LEVEL', legacy: 'DEV_GATEWAY_LOG_LEVEL' },
  { current: 'GATEWARDEN_AUTOSTART', legacy: 'DEV_GATEWAY_AUTOSTART' },
];

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
export function platformDirs(
  platform: NodeJS.Platform,
  env: PathEnv,
  home: string,
  appName: string = APP_NAME,
): PlatformDirs {
  if (platform === 'darwin') {
    const library = path.join(home, 'Library');
    return {
      config: path.join(library, 'Preferences', appName),
      state: path.join(library, 'Application Support', appName),
      log: path.join(library, 'Logs', appName),
      cache: path.join(library, 'Caches', appName),
    };
  }

  if (platform === 'win32') {
    const appData = readEnv(env, 'APPDATA') ?? path.join(home, 'AppData', 'Roaming');
    const localAppData = readEnv(env, 'LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local');
    return {
      config: path.join(appData, appName, 'Config'),
      state: path.join(localAppData, appName, 'State'),
      log: path.join(localAppData, appName, 'Log'),
      cache: path.join(localAppData, appName, 'Cache'),
    };
  }

  // Linux and everything that follows the XDG specification.
  const stateHome = readEnv(env, 'XDG_STATE_HOME') ?? path.join(home, '.local', 'state');
  return {
    config: path.join(readEnv(env, 'XDG_CONFIG_HOME') ?? path.join(home, '.config'), appName),
    state: path.join(stateHome, appName),
    // On Linux the log lives next to the state, as XDG keeps both there.
    log: path.join(stateHome, appName),
    cache: path.join(readEnv(env, 'XDG_CACHE_HOME') ?? path.join(home, '.cache'), appName),
  };
}

/**
 * The base directories of the platform the process runs on, from `env-paths`.
 *
 * This is the production path: `env-paths` is the source of the layout
 * (D6), and the state directory is the one directory it does not have.
 */
export function envPathsDirs(): PlatformDirs {
  return envPathsDirsFor(APP_NAME);
}

/**
 * The base directories `env-paths` gives for a name.
 *
 * The name is a parameter, so that the directories of the name the
 * installation had before the rename are found in the same way.
 */
function envPathsDirsFor(appName: string): PlatformDirs {
  const paths = envPaths(appName, { suffix: '' });
  const state =
    process.platform === 'darwin'
      ? paths.data
      : process.platform === 'win32'
        ? path.join(path.dirname(paths.data), 'State')
        : paths.log;
  return { config: paths.config, state, log: paths.log, cache: paths.cache };
}

/**
 * The directories the old name owned.
 *
 * An installation that was made before the rename keeps its configuration
 * in `~/.config/dev-gateway/` and its route store in the state directory
 * of the same name. The migration moves them, and the doctor reports them.
 */
export interface LegacyAppPaths {
  /** The configuration directory of the old name. */
  configDir: string;
  /** The state directory of the old name. */
  stateDir: string;
  /** The log directory of the old name. */
  logDir: string;
}

export function legacyAppPaths(opts: PathOptions = {}): LegacyAppPaths {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const running =
    platform === process.platform && env === process.env && home === os.homedir();
  const dirs = running
    ? envPathsDirsFor(LEGACY_APP_NAME)
    : platformDirs(platform, env, home, LEGACY_APP_NAME);
  return { configDir: dirs.config, stateDir: dirs.state, logDir: dirs.log };
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

/** The value of `GATEWARDEN_HOME`: everything in one directory. */
export function homeOverride(env: PathEnv = process.env): string | undefined {
  return readEnv(env, 'GATEWARDEN_HOME') ?? readEnv(env, 'DEV_GATEWAY_HOME');
}

/** The value of `GATEWARDEN_CONFIG`: the configuration file only. */
export function configFileOverride(env: PathEnv = process.env): string | undefined {
  return (
    readEnv(env, 'GATEWARDEN_CONFIG') ??
    readEnv(env, 'DEV_GATEWAY_CONFIG') ??
    readEnv(env, 'TRAEFIK_DEV_CONFIG')
  );
}

/** The value of `GATEWARDEN_STATE_DIR`: the state directory only. */
export function stateDirOverride(env: PathEnv = process.env): string | undefined {
  return (
    readEnv(env, 'GATEWARDEN_STATE_DIR') ??
    readEnv(env, 'DEV_GATEWAY_STATE_DIR') ??
    readEnv(env, 'TRAEFIK_DEV_STATE_DIR')
  );
}

/**
 * The notices about the environment variables that were renamed.
 *
 * The old names work, but they are deprecated: a script that still sets
 * one says so once, where the user can see it. A variable that is set
 * under both names gets no notice: the new name wins, and the old one is
 * then ignored.
 */
export function deprecatedEnvNotices(env: PathEnv = process.env): string[] {
  const notices: string[] = [];
  for (const { current, legacy } of ENV_FAMILY) {
    if (readEnv(env, legacy) === undefined) continue;
    if (readEnv(env, current) !== undefined) continue;
    notices.push(`${legacy} is deprecated: use ${current} instead`);
  }
  return notices;
}

/**
 * The log file of a state directory.
 *
 * `GATEWARDEN_HOME` puts the log in that one directory, like everything
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
 * `GATEWARDEN_HOME` wins over everything: it puts the configuration, the
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
