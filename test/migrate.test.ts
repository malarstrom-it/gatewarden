/**
 * The migration from the old layout (§3.4).
 *
 * The old installation kept everything in `~/.traefik-dev/`. The migration
 * moves the configuration and the route store to the layout of §3.1, and it
 * never deletes anything.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig } from '../src/core/config.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'dev-gateway.js');

interface Legacy {
  home: string;
  dir: string;
  configFile: string;
  routesFile: string;
}

function makeLegacy(): Legacy {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-home-'));
  const dir = path.join(home, '.traefik-dev');
  fs.mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, 'config.json');
  const routesFile = path.join(dir, 'registrations.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        registryPort: 45002,
        relayPort: 45001,
        advertisedIp: '10.1.2.3',
        advertisedHost: 'devbox',
        zone: 'legacy.example',
        entryPoints: ['websecure'],
        certResolver: 'cloudflare',
        tlsMode: 'wildcard',
        securityHeaders: false,
        compressMiddleware: false,
        middlewareProvider: 'file',
        allowedCidrs: ['127.0.0.1/32'],
        secret: '',
        stateDir: dir,
        documentFormat: 'yaml',
        logMaxBytes: 5242880,
        logKeep: 3,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    routesFile,
    JSON.stringify(
      {
        version: 1,
        registrations: [
          {
            id: 'probe/main',
            project: 'probe',
            branch: 'main',
            projectSlug: 'probe',
            branchSlug: 'main',
            fqdn: 'main.probe.legacy.example',
            devPort: 3999,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, 'daemon.pid'), '4242\n');
  fs.writeFileSync(path.join(dir, 'daemon.log'), 'the old log\n');
  return { home, dir, configFile, routesFile };
}

test('an existing ~/.traefik-dev/config.json is picked up on the first run', () => {
  const legacy = makeLegacy();
  try {
    const config = loadConfig({ home: legacy.home, env: {} });

    assert.equal(config.zone, 'legacy.example');
    assert.equal(config.advertisedIp, '10.1.2.3');

    // The configuration now lives in the XDG configuration directory.
    const configFile = path.join(legacy.home, '.config', 'dev-gateway', 'config.json');
    assert.ok(fs.existsSync(configFile), 'the configuration was not written to the new place');
    const written = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.equal(written.zone, 'legacy.example');
    assert.equal(written.proxy, 'traefik');
    assert.equal(written.autostart, true);

    // The route store was imported into the new state directory.
    const routes = path.join(legacy.home, '.local', 'state', 'dev-gateway', 'routes.json');
    assert.ok(fs.existsSync(routes), 'the route store was not imported');
    const store = JSON.parse(fs.readFileSync(routes, 'utf8'));
    assert.equal(store.registrations.length, 1);
    assert.equal(store.registrations[0].fqdn, 'main.probe.legacy.example');
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('the old directory is left in place', () => {
  const legacy = makeLegacy();
  try {
    loadConfig({ home: legacy.home, env: {} });

    assert.ok(fs.existsSync(legacy.configFile), 'the old configuration was deleted');
    assert.ok(fs.existsSync(legacy.routesFile), 'the old route store was deleted');
    assert.ok(fs.existsSync(path.join(legacy.dir, 'daemon.pid')));
    assert.ok(fs.existsSync(path.join(legacy.dir, 'daemon.log')));
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('the migration runs once: a new configuration file is left alone', () => {
  const legacy = makeLegacy();
  try {
    loadConfig({ home: legacy.home, env: {} });
    const configFile = path.join(legacy.home, '.config', 'dev-gateway', 'config.json');
    const written = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    fs.writeFileSync(configFile, JSON.stringify({ ...written, zone: 'changed.example' }, null, 2));

    const config = loadConfig({ home: legacy.home, env: {} });

    assert.equal(config.zone, 'changed.example');
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('the state directory of the old layout is not kept: the routes move to the XDG state', () => {
  const legacy = makeLegacy();
  try {
    const config = loadConfig({ home: legacy.home, env: {} });

    assert.equal(config.stateDir, path.join(legacy.home, '.local', 'state', 'dev-gateway'));
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('a state directory outside the old layout is kept', () => {
  const legacy = makeLegacy();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-state-'));
  try {
    const raw = JSON.parse(fs.readFileSync(legacy.configFile, 'utf8'));
    raw.stateDir = elsewhere;
    fs.writeFileSync(legacy.configFile, JSON.stringify(raw, null, 2));

    const config = loadConfig({ home: legacy.home, env: {} });

    assert.equal(config.stateDir, elsewhere);
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('DEV_GATEWAY_HOME keeps the migration inside one directory', () => {
  const legacy = makeLegacy();
  const home = path.join(legacy.home, 'one-directory');
  fs.mkdirSync(home, { recursive: true });
  try {
    const config = loadConfig({ home: legacy.home, env: { DEV_GATEWAY_HOME: home } });

    assert.equal(config.stateDir, home);
    assert.ok(fs.existsSync(path.join(home, 'config.json')));
    assert.ok(fs.existsSync(path.join(home, 'routes.json')));
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('dev-gateway migrate reports what it moved', async () => {
  const legacy = makeLegacy();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: legacy.home,
        XDG_CONFIG_HOME: path.join(legacy.home, '.config'),
        XDG_STATE_HOME: path.join(legacy.home, '.local', 'state'),
        XDG_CACHE_HOME: path.join(legacy.home, '.cache'),
      },
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /configuration:/);
    assert.match(stdout, /routes:/);
    assert.match(stdout, /1 routes/);
    assert.match(stdout, /the old layout was migrated/);

    // What it reported, it did.
    const configFile = path.join(legacy.home, '.config', 'dev-gateway', 'config.json');
    const routes = path.join(legacy.home, '.local', 'state', 'dev-gateway', 'routes.json');
    assert.ok(fs.existsSync(configFile));
    assert.ok(fs.existsSync(routes));
    assert.ok(fs.existsSync(legacy.configFile), 'the old directory must stay');
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('dev-gateway migrate --dry-run moves nothing', async () => {
  const legacy = makeLegacy();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate', '--dry-run'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: legacy.home,
        XDG_CONFIG_HOME: path.join(legacy.home, '.config'),
        XDG_STATE_HOME: path.join(legacy.home, '.local', 'state'),
        XDG_CACHE_HOME: path.join(legacy.home, '.cache'),
      },
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /dry run: nothing was moved/);
    assert.ok(!fs.existsSync(path.join(legacy.home, '.config', 'dev-gateway', 'config.json')));
    assert.ok(!fs.existsSync(path.join(legacy.home, '.local', 'state', 'dev-gateway', 'routes.json')));
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('dev-gateway migrate says when there is nothing to migrate', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-home-'));
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(home, '.local', 'state'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
      },
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /nothing to migrate/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
