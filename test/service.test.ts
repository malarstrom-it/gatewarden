/**
 * The service unit of the platform (§5.3).
 *
 * The unit is a pure function of its options, so it can be checked for
 * every platform without touching the machine the tests run on.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  LAUNCHD_LABEL,
  LEGACY_LAUNCHD_LABEL,
  LEGACY_SYSTEMD_UNIT_NAME,
  LEGACY_WINDOWS_TASK_NAME,
  SYSTEMD_UNIT_NAME,
  WINDOWS_TASK_NAME,
  installService,
  legacyServiceUnitFor,
  manualEnableCommand,
  serviceUnitFor,
} from '../src/cli/service.ts';

const OPTIONS = {
  daemonPath: '/pkg/bin/gatewarden-daemon.js',
  configPath: '/home/user/.config/gatewarden/config.json',
  stateDir: '/home/user/.local/state/gatewarden',
  nodePath: '/usr/bin/node',
  home: '/home/user',
};

test('the linux unit is a systemd user unit', () => {
  const unit = serviceUnitFor({ ...OPTIONS, platform: 'linux' });

  assert.equal(unit.platform, 'linux');
  assert.equal(unit.name, SYSTEMD_UNIT_NAME);
  assert.equal(unit.path, path.join('/home/user', '.config', 'systemd', 'user', SYSTEMD_UNIT_NAME));
  assert.match(unit.content, /^\[Unit\]$/m);
  assert.match(unit.content, /^\[Service\]$/m);
  assert.match(unit.content, /^\[Install\]$/m);
  assert.match(unit.content, /ExecStart="\/usr\/bin\/node" "\/pkg\/bin\/gatewarden-daemon\.js"/);
  assert.match(unit.content, /--config "\/home\/user\/\.config\/gatewarden\/config\.json"/);
  assert.match(unit.content, /GATEWARDEN_STATE_DIR=\/home\/user\/\.local\/state\/gatewarden/);
  assert.match(unit.content, /WantedBy=default\.target/);
  assert.deepEqual(unit.enable, [
    { command: 'systemctl', args: ['--user', 'daemon-reload'] },
    { command: 'systemctl', args: ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME] },
  ]);
});

test('the macos unit is a launchd agent', () => {
  const unit = serviceUnitFor({ ...OPTIONS, platform: 'darwin' });

  assert.equal(unit.platform, 'darwin');
  assert.equal(unit.name, LAUNCHD_LABEL);
  assert.equal(
    unit.path,
    path.join('/home/user', 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
  );
  assert.match(unit.content, /<key>Label<\/key>/);
  assert.match(unit.content, /<string>com\.malarstrom\.gatewarden<\/string>/);
  assert.match(unit.content, /<string>\/pkg\/bin\/gatewarden-daemon\.js<\/string>/);
  assert.match(unit.content, /<key>RunAtLoad<\/key>/);
  assert.deepEqual(unit.enable, [
    { command: 'launchctl', args: ['load', '-w', unit.path as string] },
  ]);
});

test('the windows unit is a scheduled task', () => {
  const unit = serviceUnitFor({ ...OPTIONS, platform: 'win32' });

  assert.equal(unit.platform, 'win32');
  assert.equal(unit.name, WINDOWS_TASK_NAME);
  assert.equal(unit.path, null, 'windows has no unit file');
  assert.equal(unit.enable.length, 1);
  assert.equal(unit.enable[0].command, 'schtasks');
  assert.ok(unit.enable[0].args.includes('/create'));
  assert.ok(unit.enable[0].args.includes(WINDOWS_TASK_NAME));
  assert.match(String(unit.enable[0].args[unit.enable[0].args.indexOf('/tr') + 1]), /gatewarden-daemon\.js/);
});

test('installing writes the unit and enables it', () => {
  const written: Array<{ file: string; content: string }> = [];
  const commands: Array<{ command: string; args: string[] }> = [];

  const result = installService({
    ...OPTIONS,
    platform: 'linux',
    write: (file, content) => written.push({ file, content }),
    run: (command, args) => {
      commands.push({ command, args });
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.written, true);
  assert.equal(result.enabled, true);
  assert.equal(result.error, undefined);
  assert.equal(written.length, 1);
  assert.match(written[0].content, /ExecStart=/);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].command, 'systemctl');
});

test('a unit that cannot be enabled says which command to run by hand', () => {
  const result = installService({
    ...OPTIONS,
    platform: 'linux',
    write: () => {},
    run: () => ({ code: 127, stdout: '', stderr: 'systemctl: not found' }),
  });

  assert.equal(result.written, true);
  assert.equal(result.enabled, false);
  assert.match(result.error ?? '', /systemctl/);
  assert.match(manualEnableCommand(result.unit), /systemctl --user enable --now gatewarden\.service/);
});

test('a unit that cannot be written is reported, not thrown', () => {
  const result = installService({
    ...OPTIONS,
    platform: 'linux',
    write: () => {
      throw new Error('read-only file system');
    },
    run: () => ({ code: 0, stdout: '', stderr: '' }),
  });

  assert.equal(result.written, false);
  assert.equal(result.enabled, false);
  assert.match(result.error ?? '', /read-only file system/);
});

test('the unit of the old name is looked for on every platform', () => {
  // A unit that was installed before the rename is still on the machine.
  // The doctor has to be able to find it.
  const linux = legacyServiceUnitFor({ platform: 'linux', home: '/home/user' });
  assert.equal(linux.name, LEGACY_SYSTEMD_UNIT_NAME);
  assert.equal(
    linux.path,
    path.join('/home/user', '.config', 'systemd', 'user', 'dev-gateway.service'),
  );

  const macos = legacyServiceUnitFor({ platform: 'darwin', home: '/home/user' });
  assert.equal(macos.name, LEGACY_LAUNCHD_LABEL);
  assert.equal(
    macos.path,
    path.join('/home/user', 'Library', 'LaunchAgents', 'dev.mal.arstrom.dev-gateway.plist'),
  );

  const windows = legacyServiceUnitFor({ platform: 'win32', home: '/home/user' });
  assert.equal(windows.name, LEGACY_WINDOWS_TASK_NAME);
  assert.equal(windows.path, null, 'the scheduled task is not a file on the disk');
});

test('the unit of the old name and the unit of the current name are two apart', () => {
  const current = serviceUnitFor({ ...OPTIONS, platform: 'linux' });
  const legacy = legacyServiceUnitFor({ platform: 'linux', home: '/home/user' });

  assert.notEqual(current.path, legacy.path);
  assert.notEqual(current.name, legacy.name);
});
