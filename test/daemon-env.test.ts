/**
 * The environment the daemon is started with.
 *
 * The daemon must run with the configuration it was given. The name
 * `GATEWARDEN_HOME` says that everything of an installation lives in
 * one directory, and it wins over every other name — so a child that
 * keeps it reads the configuration of that installation instead of the
 * one it was started with.
 *
 * The tests look at the environment the child is given. No daemon is
 * started: the gateway that runs on the user's machine is never
 * touched.
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { daemonEnv } from '../src/core/daemonControl.ts';
import { loadConfig, resolveConfigPath, resolveStateDir } from '../src/core/config.ts';
import type { Config } from '../src/core/types.ts';

/** A configuration of a throwaway installation. */
function makeConfig(stateDir: string): Config {
  return loadConfig({ configPath: path.join(stateDir, 'config.json'), stateDir });
}

test('the daemon does not inherit GATEWARDEN_HOME', () => {
  const dir = path.join(os.tmpdir(), 'gatewarden-home-of-another-installation');
  const config = makeConfig(path.join(os.tmpdir(), 'gatewarden-this-installation'));
  const configPath = path.join(config.stateDir, 'config.json');

  const env = daemonEnv(config, configPath, {
    PATH: '/usr/bin',
    GATEWARDEN_HOME: dir,
  });

  assert.equal(env['GATEWARDEN_HOME'], undefined);
});

test('the daemon does not inherit the name GATEWARDEN_HOME had before the rename', () => {
  const config = makeConfig(path.join(os.tmpdir(), 'gatewarden-this-installation'));
  const configPath = path.join(config.stateDir, 'config.json');

  const env = daemonEnv(config, configPath, {
    PATH: '/usr/bin',
    DEV_GATEWAY_HOME: path.join(os.tmpdir(), 'gatewarden-old-home'),
  });

  assert.equal(env['DEV_GATEWAY_HOME'], undefined);
});

test('the daemon reads the configuration it was given', () => {
  const config = makeConfig(path.join(os.tmpdir(), 'gatewarden-this-installation'));
  const configPath = path.join(config.stateDir, 'config.json');

  const env = daemonEnv(config, configPath, {
    PATH: '/usr/bin',
    GATEWARDEN_HOME: path.join(os.tmpdir(), 'gatewarden-home-of-another-installation'),
  });

  // The child resolves the paths with its own environment: the
  // configuration file and the state directory are the ones it was
  // given, and not the ones of the installation the name pointed at.
  assert.equal(resolveConfigPath({ env }), configPath);
  assert.equal(resolveStateDir({ env }), config.stateDir);
});

test('the other names of the environment are left as they are', () => {
  const config = makeConfig(path.join(os.tmpdir(), 'gatewarden-this-installation'));
  const configPath = path.join(config.stateDir, 'config.json');

  const env = daemonEnv(config, configPath, {
    PATH: '/usr/bin',
    HOME: '/home/someone',
    GATEWARDEN_LOG_LEVEL: 'debug',
    GATEWARDEN_CONFIG: '/somewhere/else/config.json',
  });

  assert.equal(env['PATH'], '/usr/bin');
  assert.equal(env['HOME'], '/home/someone');
  assert.equal(env['GATEWARDEN_LOG_LEVEL'], 'debug');
  // The configuration and the state directory of the daemon are the ones
  // it was started with, under both their current and their old names.
  assert.equal(env['GATEWARDEN_CONFIG'], configPath);
  assert.equal(env['GATEWARDEN_STATE_DIR'], config.stateDir);
  assert.equal(env['TRAEFIK_DEV_CONFIG'], configPath);
  assert.equal(env['TRAEFIK_DEV_STATE_DIR'], config.stateDir);
});

test('the environment of the caller is not changed', () => {
  const config = makeConfig(path.join(os.tmpdir(), 'gatewarden-this-installation'));
  const configPath = path.join(config.stateDir, 'config.json');
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    GATEWARDEN_HOME: path.join(os.tmpdir(), 'gatewarden-home-of-another-installation'),
  };

  daemonEnv(config, configPath, baseEnv);

  assert.equal(baseEnv['GATEWARDEN_HOME'], path.join(os.tmpdir(), 'gatewarden-home-of-another-installation'));
});
