/**
 * The path resolution (D6, §3.1).
 *
 * The resolution is unit tested for Linux, macOS and Windows, so the layout
 * of all three is pinned on any host. The paths are built with `path.join`,
 * so the separator is the one of the host that runs the test; the layout,
 * the directory names and the environment variables are what is checked.
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/core/config.ts';
import { logFilePath } from '../src/core/daemonControl.ts';
import type { Config } from '../src/core/types.ts';
import {
  APP_NAME,
  configFileOverride,
  deprecatedEnvNotices,
  envPathsDirs,
  homeOverride,
  legacyAppPaths,
  legacyDir,
  logFileFor,
  platformDirs,
  resolvePaths,
  stateDirOverride,
} from '../src/core/paths.ts';

const HOME = path.join(path.sep, 'home', 'user');

test('Linux keeps the configuration, the state and the cache under the XDG directories', () => {
  const paths = resolvePaths({ platform: 'linux', env: {}, home: HOME });

  assert.equal(paths.configFile, path.join(HOME, '.config', APP_NAME, 'config.json'));
  assert.equal(paths.stateDir, path.join(HOME, '.local', 'state', APP_NAME));
  assert.equal(paths.logFile, path.join(HOME, '.local', 'state', APP_NAME, 'daemon.log'));
  assert.equal(paths.cacheDir, path.join(HOME, '.cache', APP_NAME));
});

test('Linux follows XDG_CONFIG_HOME, XDG_STATE_HOME and XDG_CACHE_HOME', () => {
  const paths = resolvePaths({
    platform: 'linux',
    env: {
      XDG_CONFIG_HOME: path.join(path.sep, 'xdg', 'config'),
      XDG_STATE_HOME: path.join(path.sep, 'xdg', 'state'),
      XDG_CACHE_HOME: path.join(path.sep, 'xdg', 'cache'),
    },
    home: HOME,
  });

  assert.equal(paths.configFile, path.join(path.sep, 'xdg', 'config', APP_NAME, 'config.json'));
  assert.equal(paths.stateDir, path.join(path.sep, 'xdg', 'state', APP_NAME));
  assert.equal(paths.logFile, path.join(path.sep, 'xdg', 'state', APP_NAME, 'daemon.log'));
  assert.equal(paths.cacheDir, path.join(path.sep, 'xdg', 'cache', APP_NAME));
});

test('macOS keeps the configuration in Preferences and the state in Application Support', () => {
  const paths = resolvePaths({ platform: 'darwin', env: {}, home: HOME });
  const library = path.join(HOME, 'Library');

  assert.equal(paths.configFile, path.join(library, 'Preferences', APP_NAME, 'config.json'));
  assert.equal(paths.stateDir, path.join(library, 'Application Support', APP_NAME));
  assert.equal(paths.logFile, path.join(library, 'Application Support', APP_NAME, 'daemon.log'));
  assert.equal(paths.cacheDir, path.join(library, 'Caches', APP_NAME));
});

test('Windows keeps the configuration in APPDATA and the state in LOCALAPPDATA', () => {
  const appData = path.join(path.sep, 'users', 'u', 'AppData', 'Roaming');
  const localAppData = path.join(path.sep, 'users', 'u', 'AppData', 'Local');
  const paths = resolvePaths({
    platform: 'win32',
    env: { APPDATA: appData, LOCALAPPDATA: localAppData },
    home: path.join(path.sep, 'users', 'u'),
  });

  assert.equal(paths.configFile, path.join(appData, APP_NAME, 'Config', 'config.json'));
  assert.equal(paths.stateDir, path.join(localAppData, APP_NAME, 'State'));
  assert.equal(paths.logFile, path.join(localAppData, APP_NAME, 'State', 'daemon.log'));
  assert.equal(paths.cacheDir, path.join(localAppData, APP_NAME, 'Cache'));
});

test('Windows falls back to the home directory when APPDATA is unset', () => {
  const home = path.join(path.sep, 'users', 'u');
  const paths = resolvePaths({ platform: 'win32', env: {}, home });

  assert.equal(paths.configFile, path.join(home, 'AppData', 'Roaming', APP_NAME, 'Config', 'config.json'));
  assert.equal(paths.stateDir, path.join(home, 'AppData', 'Local', APP_NAME, 'State'));
});

test('GATEWARDEN_HOME puts everything in one directory', () => {
  const base = path.join(path.sep, 'tmp', 'gateway-home');
  const paths = resolvePaths({ platform: 'linux', env: { GATEWARDEN_HOME: base }, home: HOME });

  assert.equal(paths.configFile, path.join(base, 'config.json'));
  assert.equal(paths.stateDir, base);
  assert.equal(paths.logFile, path.join(base, 'daemon.log'));
  assert.equal(paths.cacheDir, path.join(base, 'cache'));
});

test('GATEWARDEN_HOME wins over the other overrides', () => {
  const base = path.join(path.sep, 'tmp', 'gateway-home');
  const paths = resolvePaths({
    platform: 'linux',
    env: {
      GATEWARDEN_HOME: base,
      GATEWARDEN_CONFIG: path.join(path.sep, 'tmp', 'other', 'config.json'),
      GATEWARDEN_STATE_DIR: path.join(path.sep, 'tmp', 'other', 'state'),
    },
    home: HOME,
  });

  assert.equal(paths.configFile, path.join(base, 'config.json'));
  assert.equal(paths.stateDir, base);
});

test('GATEWARDEN_CONFIG moves the configuration file only', () => {
  const configFile = path.join(path.sep, 'tmp', 'other', 'config.json');
  const paths = resolvePaths({ platform: 'linux', env: { GATEWARDEN_CONFIG: configFile }, home: HOME });

  assert.equal(paths.configFile, configFile);
  assert.equal(paths.stateDir, path.join(HOME, '.local', 'state', APP_NAME));
});

test('GATEWARDEN_STATE_DIR moves the state directory only', () => {
  const stateDir = path.join(path.sep, 'tmp', 'other', 'state');
  const paths = resolvePaths({ platform: 'linux', env: { GATEWARDEN_STATE_DIR: stateDir }, home: HOME });

  assert.equal(paths.stateDir, stateDir);
  assert.equal(paths.configFile, path.join(HOME, '.config', APP_NAME, 'config.json'));
  // On Linux the log lives next to the state.
  assert.equal(paths.logFile, path.join(stateDir, 'daemon.log'));
});

test('the old environment names are still read, but the new ones win', () => {
  const old = resolvePaths({
    platform: 'linux',
    env: { TRAEFIK_DEV_CONFIG: path.join(path.sep, 'tmp', 'old', 'config.json') },
    home: HOME,
  });
  assert.equal(old.configFile, path.join(path.sep, 'tmp', 'old', 'config.json'));

  const both = resolvePaths({
    platform: 'linux',
    env: {
      TRAEFIK_DEV_CONFIG: path.join(path.sep, 'tmp', 'old', 'config.json'),
      GATEWARDEN_CONFIG: path.join(path.sep, 'tmp', 'new', 'config.json'),
    },
    home: HOME,
  });
  assert.equal(both.configFile, path.join(path.sep, 'tmp', 'new', 'config.json'));
});

test('the overrides are read from the environment', () => {
  const env = {
    GATEWARDEN_HOME: path.join(path.sep, 'tmp', 'home'),
    GATEWARDEN_CONFIG: path.join(path.sep, 'tmp', 'config.json'),
    GATEWARDEN_STATE_DIR: path.join(path.sep, 'tmp', 'state'),
  };

  assert.equal(homeOverride(env), env.GATEWARDEN_HOME);
  assert.equal(configFileOverride(env), env.GATEWARDEN_CONFIG);
  assert.equal(stateDirOverride(env), env.GATEWARDEN_STATE_DIR);
  assert.equal(homeOverride({}), undefined);
});

test('the log of a state directory lives in the state directory', () => {
  const stateDir = path.join(path.sep, 'tmp', 'state');

  assert.equal(logFileFor(stateDir), path.join(stateDir, 'daemon.log'));
});

test('the CLI and the daemon open the same log file, also when GATEWARDEN_HOME names another directory', () => {
  // The CLI and the daemon are two processes with two environments. The
  // environment of the CLI names a home directory; the environment of the
  // daemon does not. The log file is the same file in both, or the CLI
  // reads a log the daemon never writes.
  const stateDir = path.join(path.sep, 'tmp', 'state');
  const home = path.join(path.sep, 'tmp', 'home');
  const config = { ...DEFAULT_CONFIG, stateDir } as Config;

  const before = process.env['GATEWARDEN_HOME'];
  try {
    process.env['GATEWARDEN_HOME'] = home;
    const cliLog = logFilePath(config);
    delete process.env['GATEWARDEN_HOME'];
    const daemonLog = logFileFor(config.stateDir);

    assert.equal(cliLog, daemonLog, 'the CLI and the daemon do not open the same log file');
    assert.equal(cliLog, path.join(stateDir, 'daemon.log'));
  } finally {
    if (before === undefined) delete process.env['GATEWARDEN_HOME'];
    else process.env['GATEWARDEN_HOME'] = before;
  }
});

test('the legacy directory is the old layout in the home directory', () => {
  assert.equal(legacyDir({ home: HOME }), path.join(HOME, '.traefik-dev'));
});

test('the layout of the running platform is the one env-paths gives', () => {
  // The copy in `platformDirs` is what the other platforms are resolved
  // with; this holds the two against each other, so the copy cannot drift
  // away from `env-paths` (D6).
  assert.deepEqual(platformDirs(process.platform, process.env, os.homedir()), envPathsDirs());
});

test('the log file of a state directory and the one of the resolution are the same', () => {
  // The daemon opens the log where the CLI says it is. If the two
  // disagree, the daemon writes its log somewhere nobody looks.
  for (const platform of ['linux', 'darwin', 'win32'] as NodeJS.Platform[]) {
    const env = platform === 'win32' ? { APPDATA: path.join(path.sep, 'a'), LOCALAPPDATA: path.join(path.sep, 'b') } : {};
    const paths = resolvePaths({ platform, env, home: HOME });
    const logFile = logFileFor(paths.stateDir);
    assert.equal(logFile, paths.logFile, `${platform}: the log file of the resolution differs`);
  }
});

test('the log file is in the one directory when GATEWARDEN_HOME is set', () => {
  for (const platform of ['linux', 'darwin', 'win32'] as NodeJS.Platform[]) {
    const env = { GATEWARDEN_HOME: path.join(path.sep, 'tmp', 'one-directory') };
    const paths = resolvePaths({ platform, env, home: HOME });
    assert.equal(paths.logFile, path.join(path.sep, 'tmp', 'one-directory', 'daemon.log'), `${platform}`);
    assert.equal(
      logFileFor(paths.stateDir),
      paths.logFile,
      `${platform}: the log file of the resolution differs`,
    );
  }
});

test('the environment names of the rename still work, and the current ones win', () => {
  // The names the variables had before the rename are deprecated, not
  // dead: a script that still sets them keeps working.
  const legacy = resolvePaths({
    platform: 'linux',
    env: {
      DEV_GATEWAY_HOME: path.join(path.sep, 'tmp', 'old-home'),
      DEV_GATEWAY_CONFIG: path.join(path.sep, 'tmp', 'old', 'config.json'),
      DEV_GATEWAY_STATE_DIR: path.join(path.sep, 'tmp', 'old', 'state'),
    },
    home: HOME,
  });

  assert.equal(legacy.configFile, path.join(path.sep, 'tmp', 'old-home', 'config.json'));
  assert.equal(legacy.stateDir, path.join(path.sep, 'tmp', 'old-home'));
  assert.equal(legacy.logFile, path.join(path.sep, 'tmp', 'old-home', 'daemon.log'));

  const both = resolvePaths({
    platform: 'linux',
    env: {
      DEV_GATEWAY_HOME: path.join(path.sep, 'tmp', 'old-home'),
      DEV_GATEWAY_CONFIG: path.join(path.sep, 'tmp', 'old', 'config.json'),
      GATEWARDEN_HOME: path.join(path.sep, 'tmp', 'new-home'),
      GATEWARDEN_CONFIG: path.join(path.sep, 'tmp', 'new', 'config.json'),
    },
    home: HOME,
  });

  assert.equal(both.configFile, path.join(path.sep, 'tmp', 'new-home', 'config.json'));
  assert.equal(both.stateDir, path.join(path.sep, 'tmp', 'new-home'));
});

test('the deprecated environment names are reported, and only when they are used', () => {
  assert.deepEqual(deprecatedEnvNotices({}), []);

  assert.deepEqual(
    deprecatedEnvNotices({ DEV_GATEWAY_HOME: path.join(path.sep, 'tmp', 'old') }),
    ['DEV_GATEWAY_HOME is deprecated: use GATEWARDEN_HOME instead'],
  );

  // A variable that is set under both names gets no notice: the current
  // name wins, and the old one is ignored.
  assert.deepEqual(
    deprecatedEnvNotices({
      DEV_GATEWAY_HOME: path.join(path.sep, 'tmp', 'old'),
      GATEWARDEN_HOME: path.join(path.sep, 'tmp', 'new'),
    }),
    [],
  );
});

test('the directories of the old name are found', () => {
  // The installation that was made before the rename keeps its files in
  // the directories of the old name. The migration moves them, and the
  // doctor reports them.
  const dirs = legacyAppPaths({ platform: 'linux', env: {}, home: HOME });

  assert.equal(dirs.configDir, path.join(HOME, '.config', 'dev-gateway'));
  assert.equal(dirs.stateDir, path.join(HOME, '.local', 'state', 'dev-gateway'));
});

test('the current directories and the old ones are two apart', () => {
  const current = resolvePaths({ platform: 'linux', env: {}, home: HOME });
  const legacy = legacyAppPaths({ platform: 'linux', env: {}, home: HOME });

  assert.notEqual(current.configFile, path.join(legacy.configDir, 'config.json'));
  assert.notEqual(current.stateDir, legacy.stateDir);
});
