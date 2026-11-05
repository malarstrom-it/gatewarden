/**
 * The environment of a throwaway installation.
 *
 * A daemon that starts in the environment of the machine inherits the
 * installation of that machine: the home directory says where the
 * installation is, and the variables of the family say which one. A
 * test that starts a daemon therefore hands it an environment of its
 * own, in which the home directory, the XDG directories and the
 * variables of the family all point at the throwaway directory.
 *
 * The variables of the machine are not inherited. A `GATEWARDEN_HOME`
 * that names the installation of the machine must not decide where the
 * daemon of a test writes its state, nor which configuration file it
 * reads: the daemon of a test belongs to the throwaway installation and
 * to nothing else.
 *
 * The old names are in the list of the variables too. They are removed,
 * not set: a machine that still uses them would otherwise decide where
 * the daemon of a test writes, and it would say so in the log of every
 * command the test runs.
 */

import path from 'node:path';

/**
 * The variables that say where an installation keeps its files.
 *
 * The list is the one the resolution of the paths reads: `HOME`, the
 * three XDG directories, and the variables of the family — the current
 * names and the ones they had before the rename.
 */
const PATHS_OF_THE_INSTALLATION = [
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'GATEWARDEN_HOME',
  'GATEWARDEN_CONFIG',
  'GATEWARDEN_STATE_DIR',
  'DEV_GATEWAY_HOME',
  'DEV_GATEWAY_CONFIG',
  'DEV_GATEWAY_STATE_DIR',
  'TRAEFIK_DEV_CONFIG',
  'TRAEFIK_DEV_STATE_DIR',
] as const;

export interface IsolationOptions {
  /** The home directory of the installation. Defaults to the throwaway directory. */
  home?: string;
  /** The configuration file. Defaults to `<dir>/config.json`. */
  configPath?: string;
  /** The state directory. Defaults to the throwaway directory. */
  stateDir?: string;
  /** The cache directory. Defaults to `<dir>/.cache`. */
  cacheHome?: string;
  /** The configuration directory. Defaults to `<dir>/.config`. */
  configHome?: string;
  /** The state home. Defaults to `<dir>/.local/state`. */
  stateHome?: string;
  /**
   * Values that win over the ones above.
   *
   * A value of `undefined` removes the variable: `GATEWARDEN_HOME`
   * says that everything lives in one directory, and an installation
   * whose directories are apart does not want that.
   */
  env?: Record<string, string | undefined>;
}

export interface Isolation {
  /** The environment a process of the throwaway installation runs in. */
  env: NodeJS.ProcessEnv;
  /**
   * Run something with that environment in the process.
   *
   * The environment of the process is changed for the time of the
   * action and put back afterwards: a daemon that is started inside the
   * action inherits it, and the rest of the test does not live in it.
   */
  run: <T>(action: () => T | Promise<T>) => Promise<T>;
}

/**
 * The environment of a throwaway installation.
 *
 * The directory is the one the test made: the configuration file, the
 * state and the log of the installation live in it, and the daemon that
 * the test starts keeps its files there.
 */
export function isolate(dir: string, options: IsolationOptions = {}): Isolation {
  const configPath = options.configPath ?? path.join(dir, 'config.json');
  const stateDir = options.stateDir ?? dir;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: options.home ?? dir,
    XDG_CONFIG_HOME: options.configHome ?? path.join(dir, '.config'),
    XDG_STATE_HOME: options.stateHome ?? path.join(dir, '.local', 'state'),
    XDG_CACHE_HOME: options.cacheHome ?? path.join(dir, '.cache'),
    // Everything lives in one directory: the configuration file, the
    // state, the log and the cache of the throwaway installation.
    GATEWARDEN_HOME: dir,
    GATEWARDEN_CONFIG: configPath,
    GATEWARDEN_STATE_DIR: stateDir,
    // The names the variables had before the rename still travel with
    // the daemon: it reads them when the new ones are not there.
    TRAEFIK_DEV_CONFIG: configPath,
    TRAEFIK_DEV_STATE_DIR: stateDir,
    ...(options.env ?? {}),
  };
  // A variable that is removed is not in the environment at all.
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete env[name];
  }
  return { env, run: (action) => withEnv(env, action) };
}

/**
 * Run something with an environment in the process.
 *
 * The variables of the installation are put back the way they were,
 * whether the action succeeded or not: a test that leaves the
 * environment of the machine changed would decide the fate of the tests
 * that come after it.
 */
async function withEnv<T>(env: NodeJS.ProcessEnv, action: () => T | Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const name of PATHS_OF_THE_INSTALLATION) saved.set(name, process.env[name]);
  try {
    for (const name of PATHS_OF_THE_INSTALLATION) {
      const value = env[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await action();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
