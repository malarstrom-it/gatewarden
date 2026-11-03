/**
 * The service unit the gateway can be installed as.
 *
 * Two layers start the daemon:
 *
 * 1. the lazy start, which every entry point uses;
 * 2. `install-service`, the only layer that survives a reboot.
 *
 * This module is the second one. It writes the unit of the platform and
 * enables it:
 *
 * | Platform | Unit |
 * | --- | --- |
 * | Linux | `~/.config/systemd/user/gatewarden.service` |
 * | macOS | `~/Library/LaunchAgents/com.malarstrom.gatewarden.plist` |
 * | Windows | a scheduled task running `gatewarden-daemon.js` |
 *
 * The unit runs the daemon directly, not the CLI: the CLI is a client, and
 * a client that starts a client is a supervisor of supervisors.
 *
 * Everything here is a pure function of its options, except the writing and
 * the enabling. Both are injectable, so the tests can check what would be
 * written and which command would run, without touching the machine the
 * tests run on.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** The platforms the gateway can be installed on. */
export type ServicePlatform = 'linux' | 'darwin' | 'win32';

/** The name of the systemd unit. */
export const SYSTEMD_UNIT_NAME = 'gatewarden.service';

/** The label of the launchd agent. */
export const LAUNCHD_LABEL = 'com.malarstrom.gatewarden';

/** The name of the Windows scheduled task. */
export const WINDOWS_TASK_NAME = 'gatewarden';

/**
 * The names the service had before the rename.
 *
 * A unit that was installed under the old name is still on the machine:
 * it names a launcher that does not exist any more, and the daemon it
 * would start is never started. The doctor has to say so, and the unit
 * has to be replaced by `install-service`.
 */
export const LEGACY_SYSTEMD_UNIT_NAME = 'dev-gateway.service';

/** The label the launchd agent had before the rename. */
export const LEGACY_LAUNCHD_LABEL = 'dev.mal.arstrom.dev-gateway';

/** The name the Windows scheduled task had before the rename. */
export const LEGACY_WINDOWS_TASK_NAME = 'dev-gateway';

export interface ServiceUnitOptions {
  /** The platform to write the unit for. Defaults to the running platform. */
  platform?: NodeJS.Platform;
  /** The user's home directory. Defaults to `os.homedir()`. */
  home?: string;
  /** The launcher that runs the daemon (`bin/gatewarden-daemon.js`). */
  daemonPath: string;
  /** The configuration file the daemon reads. */
  configPath: string;
  /** The state directory the daemon writes to. */
  stateDir: string;
  /** The node executable that runs the daemon. Defaults to `process.execPath`. */
  nodePath?: string;
}

/** One command of the platform. */
export interface ServiceCommand {
  command: string;
  args: string[];
}

/** The unit of the platform, and the commands that enable it. */
export interface ServiceUnit {
  /** The platform the unit belongs to. */
  platform: ServicePlatform;
  /** The name of the unit. */
  name: string;
  /**
   * Where the unit is written.
   *
   * `null` on Windows: there is no unit file there, a scheduled task is
   * created instead.
   */
  path: string | null;
  /** The content of the unit file. */
  content: string;
  /** The commands that enable the unit, in order. */
  enable: ServiceCommand[];
  /** The command that shows the state of the unit. */
  status: ServiceCommand;
}

/** Quote a path for a systemd unit. */
function systemdQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Quote a path for a launchd property list. */
function plistQuote(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The systemd user unit.
 *
 * The unit starts the daemon again when it died of something else, and
 * not when it stopped on purpose: a daemon that stops because it
 * cannot serve ends with the code zero, and `Restart=on-failure` leaves
 * it alone. A unit that started such a daemon again every five seconds
 * would fill the journal with the same failure for ever.
 */
function systemdUnit(opts: Required<Pick<ServiceUnitOptions, 'daemonPath' | 'configPath' | 'stateDir'>> & {
  nodePath: string;
  home: string;
}): ServiceUnit {
  const unitPath = path.join(opts.home, '.config', 'systemd', 'user', SYSTEMD_UNIT_NAME);
  const content = [
    '[Unit]',
    'Description=gatewarden - the gateway of the dev servers (registry and relay)',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${systemdQuote(opts.nodePath)} ${systemdQuote(opts.daemonPath)} --config ${systemdQuote(opts.configPath)}`,
    `Environment=GATEWARDEN_CONFIG=${opts.configPath}`,
    `Environment=GATEWARDEN_STATE_DIR=${opts.stateDir}`,
    'Restart=on-failure',
    'RestartSec=5',
    '# A daemon that stops on purpose ends with the code zero: this unit',
    '# starts it again only when it died of something else.',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');

  return {
    platform: 'linux',
    name: SYSTEMD_UNIT_NAME,
    path: unitPath,
    content,
    enable: [
      { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      { command: 'systemctl', args: ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME] },
    ],
    status: { command: 'systemctl', args: ['--user', 'status', SYSTEMD_UNIT_NAME] },
  };
}

/**
 * The launchd agent.
 *
 * The agent starts the daemon again when it ended with a code that is
 * not zero, and not when it stopped on purpose: a daemon that stops
 * because it cannot serve ends with the code zero, and
 * `SuccessfulExit=false` leaves it alone. `KeepAlive=true` would start
 * it again after every exit, and the journal would fill with the same
 * failure for ever.
 */
function launchdUnit(opts: Required<Pick<ServiceUnitOptions, 'daemonPath' | 'configPath' | 'stateDir'>> & {
  nodePath: string;
  home: string;
}): ServiceUnit {
  const unitPath = path.join(opts.home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const content = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${plistQuote(LAUNCHD_LABEL)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${plistQuote(opts.nodePath)}</string>`,
    `    <string>${plistQuote(opts.daemonPath)}</string>`,
    '    <string>--config</string>',
    `    <string>${plistQuote(opts.configPath)}</string>`,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    `    <key>GATEWARDEN_CONFIG</key>`,
    `    <string>${plistQuote(opts.configPath)}</string>`,
    `    <key>GATEWARDEN_STATE_DIR</key>`,
    `    <string>${plistQuote(opts.stateDir)}</string>`,
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

  return {
    platform: 'darwin',
    name: LAUNCHD_LABEL,
    path: unitPath,
    content,
    enable: [{ command: 'launchctl', args: ['load', '-w', unitPath] }],
    status: { command: 'launchctl', args: ['list', LAUNCHD_LABEL] },
  };
}

/** The Windows scheduled task. */
function windowsTask(opts: Required<Pick<ServiceUnitOptions, 'daemonPath' | 'configPath' | 'stateDir'>> & {
  nodePath: string;
  home: string;
}): ServiceUnit {
  const task = `${systemdQuote(opts.nodePath)} ${systemdQuote(opts.daemonPath)} --config ${systemdQuote(opts.configPath)}`;
  return {
    platform: 'win32',
    name: WINDOWS_TASK_NAME,
    path: null,
    // The command line of the task. There is no unit file on Windows.
    content: task,
    enable: [
      {
        command: 'schtasks',
        args: [
          '/create',
          '/tn',
          WINDOWS_TASK_NAME,
          '/tr',
          task,
          '/sc',
          'onlogon',
          '/rl',
          'limited',
          '/f',
        ],
      },
    ],
    status: { command: 'schtasks', args: ['/query', '/tn', WINDOWS_TASK_NAME] },
  };
}

/**
 * The unit of the old name, for the platform.
 *
 * The unit of the old name is a file on Linux and macOS, and a scheduled
 * task on Windows. The file is what can be looked for; the task lives in
 * the task scheduler, and its path is `null` here.
 */
export function legacyServiceUnitFor(opts: {
  platform?: NodeJS.Platform;
  home?: string;
} = {}): { name: string; path: string | null } {
  const platform = (opts.platform ?? process.platform) as ServicePlatform;
  const home = opts.home ?? os.homedir();
  if (platform === 'darwin') {
    return {
      name: LEGACY_LAUNCHD_LABEL,
      path: path.join(home, 'Library', 'LaunchAgents', `${LEGACY_LAUNCHD_LABEL}.plist`),
    };
  }
  if (platform === 'win32') {
    return { name: LEGACY_WINDOWS_TASK_NAME, path: null };
  }
  return {
    name: LEGACY_SYSTEMD_UNIT_NAME,
    path: path.join(home, '.config', 'systemd', 'user', LEGACY_SYSTEMD_UNIT_NAME),
  };
}

/**
 * The unit of the platform.
 *
 * The path of the unit is under the home directory of the user, so the
 * unit belongs to that user and not to the machine: it needs no root, and
 * it starts when the user logs in.
 */
export function serviceUnitFor(opts: ServiceUnitOptions): ServiceUnit {
  const platform = (opts.platform ?? process.platform) as ServicePlatform;
  const home = opts.home ?? os.homedir();
  const nodePath = opts.nodePath ?? process.execPath;
  const common = {
    daemonPath: opts.daemonPath,
    configPath: opts.configPath,
    stateDir: opts.stateDir,
    nodePath,
    home,
  };
  if (platform === 'darwin') return launchdUnit(common);
  if (platform === 'win32') return windowsTask(common);
  return systemdUnit(common);
}

/** The result of running a command. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command and collect its output. */
export function runCommand(command: string, args: string[]): CommandResult {
  // The command is bounded: a platform tool that hangs must not hang the
  // command that asked it to do something.
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1;
    return { code, stdout: '', stderr: result.error.message };
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export interface InstallServiceOptions extends ServiceUnitOptions {
  /** Enable the unit after writing it. Defaults to true. */
  enable?: boolean;
  /** Write the unit file. Injectable for the tests. */
  write?: (file: string, content: string) => void;
  /** Run a command. Injectable for the tests. */
  run?: (command: string, args: string[]) => CommandResult;
}

export interface InstallServiceResult {
  /** The unit that was written. */
  unit: ServiceUnit;
  /** Whether the unit file was written. */
  written: boolean;
  /** Whether the unit was enabled. */
  enabled: boolean;
  /** The commands that ran, and how they ended. */
  commands: Array<ServiceCommand & { code: number }>;
  /** Why the install did not finish, when it did not. */
  error?: string;
}

/**
 * Write the unit of the platform and enable it.
 *
 * The writing never fails the command: a unit that cannot be written is
 * reported, and the commands that would have enabled it are printed, so
 * the user can run them by hand.
 */
export function installService(opts: InstallServiceOptions): InstallServiceResult {
  const unit = serviceUnitFor(opts);
  const write = opts.write ?? ((file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  });
  const run = opts.run ?? runCommand;
  const commands: Array<ServiceCommand & { code: number }> = [];

  let written = false;
  if (unit.path) {
    try {
      write(unit.path, unit.content);
      written = true;
    } catch (error) {
      return {
        unit,
        written: false,
        enabled: false,
        commands,
        error: `could not write ${unit.path}: ${(error as Error).message}`,
      };
    }
  } else {
    // Windows has no unit file: the scheduled task is the unit.
    written = true;
  }

  if (opts.enable === false) {
    return { unit, written, enabled: false, commands };
  }

  for (const command of unit.enable) {
    const result = run(command.command, command.args);
    commands.push({ ...command, code: result.code });
    if (result.code !== 0) {
      return {
        unit,
        written,
        enabled: false,
        commands,
        error:
          `${command.command} ${command.args.join(' ')} failed with code ${result.code}` +
          (result.stderr.trim() ? `: ${result.stderr.trim()}` : ''),
      };
    }
  }

  return { unit, written, enabled: true, commands };
}

/** The command a user can run by hand to enable the unit. */
export function manualEnableCommand(unit: ServiceUnit): string {
  return unit.enable.map((command) => `${command.command} ${command.args.join(' ')}`).join(' && ');
}
