/**
 * Shared helpers for the CLI tests.
 *
 * Every CLI test runs against a throwaway installation: a temporary
 * directory holds the configuration, the state and the home directory, and
 * the ports are free ones the OS hands out. Nothing ever touches the
 * gateway that runs on the user's machine.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig } from '../../src/core/config.ts';
import { isHealthy } from '../../src/core/daemonControl.ts';

const execFileAsync = promisify(execFile);

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The CLI of the package. */
export const CLI = path.join(REPO_ROOT, 'bin', 'dev-gateway.js');

/** The CLI under its old name. */
export const LEGACY_CLI = path.join(REPO_ROOT, 'bin', 'traefik-dev.js');

/** The daemon under its old name. */
export const LEGACY_DAEMON = path.join(REPO_ROOT, 'bin', 'traefik-devd.js');

/** Ask the OS for a free TCP port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export interface CliFixture {
  /** The throwaway directory: the configuration, the state and the home. */
  dir: string;
  /** The configuration file. */
  configPath: string;
  /** Run the CLI and return what it wrote to the standard output. */
  run: (args: string[]) => Promise<string>;
  /** Run the CLI and parse its JSON output. */
  runJson: <T>(args: string[]) => Promise<T>;
  /** Run the CLI and collect everything, also when it fails. */
  runFail: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** Stop the daemon the fixture started. */
  stopDaemon: () => Promise<void>;
  /** Remove the throwaway directory. */
  cleanup: () => void;
}

export interface FixtureOptions {
  /** Values that go into the configuration file. */
  config?: Record<string, unknown>;
  /** The CLI to run. Defaults to the current one. */
  cli?: string;
}

/**
 * A throwaway installation the CLI can be run against.
 */
export async function makeCliFixture(options: FixtureOptions = {}): Promise<CliFixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-cli-'));
  const registryPort = await freePort();
  const relayPort = await freePort();
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        proxy: 'traefik',
        registryPort,
        relayPort,
        advertisedIp: '127.0.0.1',
        advertisedHost: '127.0.0.1',
        zone: 'gwtest.local',
        entryPoints: ['websecure'],
        certResolver: 'testca',
        tlsMode: 'wildcard',
        securityHeaders: false,
        compressMiddleware: false,
        middlewareProvider: 'file',
        allowedCidrs: ['127.0.0.1/32', '::1/128'],
        secret: '',
        stateDir: dir,
        documentFormat: 'yaml',
        ...(options.config ?? {}),
      },
      null,
      2,
    ),
  );

  // The home directory is the throwaway one too: the old layout
  // (`~/.traefik-dev/`) is looked for there, and not in the home of the
  // user the tests run as.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: dir,
    XDG_CONFIG_HOME: path.join(dir, '.config'),
    XDG_STATE_HOME: path.join(dir, '.local', 'state'),
    XDG_CACHE_HOME: path.join(dir, '.cache'),
  };

  const cli = options.cli ?? CLI;
  const exec = (args: string[]) =>
    execFileAsync(process.execPath, [cli, ...args, '--config', configPath, '--state-dir', dir], { env });

  const runFail = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      const { stdout, stderr } = await exec(args);
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
  };

  const run = async (args: string[]): Promise<string> => (await runFail(args)).stdout;

  const runJson = async <T>(args: string[]): Promise<T> => {
    const result = await runFail(args);
    try {
      return JSON.parse(result.stdout) as T;
    } catch (error) {
      throw new Error(
        `the CLI did not write JSON (exit ${result.code}): ${result.stdout}${result.stderr}\n${(error as Error).message}`,
      );
    }
  };

  const stopDaemon = async (): Promise<void> => {
    const config = loadConfig({ configPath, stateDir: dir });
    try {
      const pid = Number.parseInt(fs.readFileSync(path.join(dir, 'daemon.pid'), 'utf8').trim(), 10);
      if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
    } catch {
      // not running
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (await isHealthy(config))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  return {
    dir,
    configPath,
    run,
    runJson,
    runFail,
    stopDaemon,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
