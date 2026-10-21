/**
 * `traefik-dev` — the CLI an agent uses.
 *
 *   traefik-dev register --project <p> --branch <b> --port <port> [--label <text>]
 *   traefik-dev unregister --project <p> --branch <b>
 *   traefik-dev list
 *   traefik-dev status
 *   traefik-dev config [--write]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveConfigPath, writeConfigFile, CONFIG_KEYS } from './config.ts';
import { RegistrationStore } from './state.ts';
import { ensureDaemon, daemonStatus, logFilePath, pidFilePath } from './daemonControl.ts';
import { isPortListening } from './util/net.ts';
import { slugify } from './util/slug.ts';
import type { Config } from './types.ts';

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
  const rest = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      index += 1;
    }
  }
  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  if (typeof value === 'string') return value;
  return undefined;
}

function usage(): string {
  return `traefik-dev — expose a dev server running in this container through Traefik

Usage:
  traefik-dev register   --project <p> --branch <b> --port <port> [--label <text>]
  traefik-dev unregister --project <p> --branch <b>
  traefik-dev list
  traefik-dev status
  traefik-dev config [--write]

Global options:
  --config <path>      configuration file (default: <state-dir>/config.json)
  --state-dir <path>   state directory (default: ~/.traefik-dev)
  --json               machine readable output (list, status)
`;
}

function resolveConfig(flags: Record<string, string | boolean>): { config: Config; configPath: string } {
  const configPath = resolveConfigPath({
    configPath: flagString(flags, 'config'),
    stateDir: flagString(flags, 'state-dir'),
  });
  const config = loadConfig({
    configPath,
    stateDir: flagString(flags, 'state-dir'),
  });
  return { config, configPath };
}

async function commandRegister(flags: Record<string, string | boolean>): Promise<number> {
  const project = flagString(flags, 'project');
  const branch = flagString(flags, 'branch');
  const portRaw = flagString(flags, 'port');
  const label = flagString(flags, 'label');

  if (!project || !branch || !portRaw) {
    process.stderr.write('error: register needs --project, --branch and --port\n');
    return 2;
  }
  const devPort = Number(portRaw);
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
    process.stderr.write(`error: invalid --port "${portRaw}"\n`);
    return 2;
  }
  if (!slugify(project) || !slugify(branch)) {
    process.stderr.write('error: --project and --branch must contain at least one letter or digit\n');
    return 2;
  }

  const { config, configPath } = resolveConfig(flags);
  fs.mkdirSync(config.stateDir, { recursive: true });

  const started = await ensureDaemon(config, { configPath });
  if (started.error) {
    process.stderr.write(`error: ${started.error}\n`);
    return 1;
  }

  const store = new RegistrationStore(config.stateDir);
  const registration = store.upsert({ project, branch, devPort, label, zone: config.zone });
  const up = await isPortListening(devPort);

  process.stdout.write(
    `registered ${registration.fqdn} -> 127.0.0.1:${devPort}` +
      ` (${up ? 'dev server is up' : 'dev server is not listening yet'})\n`,
  );
  process.stdout.write(`url: https://${registration.fqdn}\n`);
  return 0;
}

async function commandUnregister(flags: Record<string, string | boolean>): Promise<number> {
  const project = flagString(flags, 'project');
  const branch = flagString(flags, 'branch');
  if (!project || !branch) {
    process.stderr.write('error: unregister needs --project and --branch\n');
    return 2;
  }

  const { config, configPath } = resolveConfig(flags);
  await ensureDaemon(config, { configPath });
  const store = new RegistrationStore(config.stateDir);
  const removed = store.remove(project, branch);
  if (!removed) {
    process.stderr.write(`not registered: ${slugify(branch)}.${slugify(project)}.\n`);
    return 1;
  }
  process.stdout.write(`unregistered ${slugify(branch)}.${slugify(project)}\n`);
  return 0;
}

async function commandList(flags: Record<string, string | boolean>): Promise<number> {
  const { config } = resolveConfig(flags);
  const store = new RegistrationStore(config.stateDir);
  const registrations = store.list();

  if (flags['json']) {
    process.stdout.write(JSON.stringify({ registrations }, null, 2) + '\n');
    return 0;
  }

  if (registrations.length === 0) {
    process.stdout.write('no registrations\n');
    return 0;
  }

  const rows: string[] = [];
  for (const registration of registrations) {
    const up = await isPortListening(registration.devPort);
    rows.push(
      [
        registration.projectSlug,
        registration.branchSlug,
        registration.fqdn,
        String(registration.devPort),
        up ? 'up' : 'down',
        registration.updatedAt,
      ].join('\t'),
    );
  }
  process.stdout.write(['PROJECT\tBRANCH\tFQDN\tPORT\tSTATE\tUPDATED', ...rows].join('\n') + '\n');
  return 0;
}

async function commandStatus(flags: Record<string, string | boolean>): Promise<number> {
  const { config, configPath } = resolveConfig(flags);
  const status = await daemonStatus(config);
  const store = new RegistrationStore(config.stateDir);
  const registrations = store.list();

  if (flags['json']) {
    process.stdout.write(
      JSON.stringify(
        {
          daemon: status,
          configPath,
          registryPort: config.registryPort,
          relayPort: config.relayPort,
          advertisedIp: config.advertisedIp,
          zone: config.zone,
          indexHost: config.indexHost,
          entryPoints: config.entryPoints,
          certResolver: config.certResolver,
          secretConfigured: Boolean(config.secret),
          registrations: registrations.length,
        },
        null,
        2,
      ) + '\n',
    );
    return status.healthy ? 0 : 1;
  }

  process.stdout.write(
    [
      `daemon:       ${status.healthy ? 'running' : 'not running'} (pid ${status.pid ?? '-'})`,
      `pidfile:      ${status.pidFile}`,
      `logfile:      ${logFilePath(config)}`,
      `config file:  ${configPath}${fs.existsSync(configPath) ? '' : ' (missing, defaults are used)'}`,
      `registry:     0.0.0.0:${config.registryPort}`,
      `relay:        0.0.0.0:${config.relayPort}`,
      `advertised:   ${config.advertisedIp}`,
      `zone:         ${config.zone}`,
      `index host:   ${config.indexHost}`,
      `entryPoints:  ${config.entryPoints.join(', ')}`,
      `certResolver: ${config.certResolver || '(none)'}`,
      `secret:       ${config.secret ? 'configured' : 'not configured'}`,
      `registrations: ${registrations.length}`,
    ].join('\n') + '\n',
  );
  return status.healthy ? 0 : 1;
}

function commandConfig(flags: Record<string, string | boolean>): number {
  const { config, configPath } = resolveConfig(flags);
  if (flags['write']) {
    writeConfigFile(configPath, config);
    process.stdout.write(`wrote ${configPath}\n`);
    return 0;
  }
  process.stdout.write(`config file: ${configPath}\n`);
  for (const [key, description] of Object.entries(CONFIG_KEYS)) {
    const value = (config as unknown as Record<string, unknown>)[key];
    process.stdout.write(`  ${key} = ${JSON.stringify(value)}  # ${description}\n`);
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'register':
      return commandRegister(flags);
    case 'unregister':
      return commandUnregister(flags);
    case 'list':
      return commandList(flags);
    case 'status':
      return commandStatus(flags);
    case 'config':
      return commandConfig(flags);
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(usage());
      return 0;
    default:
      process.stderr.write(`error: unknown command "${command}"\n\n${usage()}`);
      return 2;
  }
}

/** Entry point used by bin/traefik-dev.js. */
export async function run(): Promise<void> {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}

// Allow `node src/cli.ts` as well as `import ... from './cli.ts'`.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void run();
}
