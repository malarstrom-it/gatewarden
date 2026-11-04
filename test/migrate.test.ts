/**
 * The migration from the old layouts (§3.4).
 *
 * Two installations came before this one: the pre-package layout, which
 * kept everything in `~/.traefik-dev/`, and the layout of the name the
 * directories had before the rename, which kept the configuration in
 * `~/.config/dev-gateway/` and the route store in
 * `~/.local/state/dev-gateway/`.
 *
 * The migration moves the configuration and the route store to the layout of
 * §3.1, and it never deletes anything.
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
const CLI = path.join(REPO_ROOT, 'bin', 'gatewarden.js');

interface Legacy {
  home: string;
  dir: string;
  configFile: string;
  routesFile: string;
}

function makeLegacy(): Legacy {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-home-'));
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
    const configFile = path.join(legacy.home, '.config', 'gatewarden', 'config.json');
    assert.ok(fs.existsSync(configFile), 'the configuration was not written to the new place');
    const written = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.equal(written.zone, 'legacy.example');
    assert.equal(written.proxy, 'traefik');
    assert.equal(written.autostart, true);

    // The route store was imported into the new state directory.
    const routes = path.join(legacy.home, '.local', 'state', 'gatewarden', 'routes.json');
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
    const configFile = path.join(legacy.home, '.config', 'gatewarden', 'config.json');
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

    assert.equal(config.stateDir, path.join(legacy.home, '.local', 'state', 'gatewarden'));
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('a state directory outside the old layout is kept', () => {
  const legacy = makeLegacy();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-state-'));
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

test('GATEWARDEN_HOME keeps the migration inside one directory', () => {
  const legacy = makeLegacy();
  const home = path.join(legacy.home, 'one-directory');
  fs.mkdirSync(home, { recursive: true });
  try {
    const config = loadConfig({ home: legacy.home, env: { GATEWARDEN_HOME: home } });

    assert.equal(config.stateDir, home);
    assert.ok(fs.existsSync(path.join(home, 'config.json')));
    assert.ok(fs.existsSync(path.join(home, 'routes.json')));
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('gatewarden migrate reports what it moved', async () => {
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
    const configFile = path.join(legacy.home, '.config', 'gatewarden', 'config.json');
    const routes = path.join(legacy.home, '.local', 'state', 'gatewarden', 'routes.json');
    assert.ok(fs.existsSync(configFile));
    assert.ok(fs.existsSync(routes));
    assert.ok(fs.existsSync(legacy.configFile), 'the old directory must stay');
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('gatewarden migrate --dry-run moves nothing', async () => {
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
    assert.ok(!fs.existsSync(path.join(legacy.home, '.config', 'gatewarden', 'config.json')));
    assert.ok(!fs.existsSync(path.join(legacy.home, '.local', 'state', 'gatewarden', 'routes.json')));
  } finally {
    fs.rmSync(legacy.home, { recursive: true, force: true });
  }
});

test('gatewarden migrate says when there is nothing to migrate', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-home-'));
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

interface OldName {
  home: string;
  configFile: string;
  routesFile: string;
}

/**
 * An installation that was made under the name the directories had before
 * the rename.
 */
function makeOldName(): OldName {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-old-name-'));
  const configDir = path.join(home, '.config', 'dev-gateway');
  const stateDir = path.join(home, '.local', 'state', 'dev-gateway');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const configFile = path.join(configDir, 'config.json');
  const routesFile = path.join(stateDir, 'routes.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        registryPort: 45002,
        relayPort: 45001,
        advertisedIp: '10.1.2.4',
        advertisedHost: 'devbox',
        zone: 'oldname.example',
        entryPoints: ['websecure'],
        certResolver: 'cloudflare',
        stateDir,
        documentFormat: 'yaml',
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
            fqdn: 'main.probe.oldname.example',
            devPort: 3998,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
      null,
      2,
    ),
  );
  return { home, configFile, routesFile };
}

test('the configuration of the old name is picked up on the first run', () => {
  // An installation that was made before the rename must not lose its
  // configuration: the loader reads it, and the migration moves it.
  const old = makeOldName();
  try {
    const config = loadConfig({ home: old.home, env: {} });

    assert.equal(config.zone, 'oldname.example');
    assert.equal(config.advertisedIp, '10.1.2.4');

    const configFile = path.join(old.home, '.config', 'gatewarden', 'config.json');
    assert.ok(fs.existsSync(configFile), 'the configuration was not written to the new place');

    const routes = path.join(old.home, '.local', 'state', 'gatewarden', 'routes.json');
    assert.ok(fs.existsSync(routes), 'the route store was not imported');
    const store = JSON.parse(fs.readFileSync(routes, 'utf8'));
    assert.equal(store.registrations.length, 1);
    assert.equal(store.registrations[0].fqdn, 'main.probe.oldname.example');

    // The old directories are left in place: nothing is ever deleted.
    assert.ok(fs.existsSync(old.configFile));
    assert.ok(fs.existsSync(old.routesFile));
  } finally {
    fs.rmSync(old.home, { recursive: true, force: true });
  }
});

test('the state directory of the old name is not kept: the routes move to the new one', () => {
  const old = makeOldName();
  try {
    const config = loadConfig({ home: old.home, env: {} });

    assert.equal(config.stateDir, path.join(old.home, '.local', 'state', 'gatewarden'));
  } finally {
    fs.rmSync(old.home, { recursive: true, force: true });
  }
});

test('gatewarden migrate moves the layout of the old name', async () => {
  const old = makeOldName();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: old.home,
        XDG_CONFIG_HOME: path.join(old.home, '.config'),
        XDG_STATE_HOME: path.join(old.home, '.local', 'state'),
        XDG_CACHE_HOME: path.join(old.home, '.cache'),
      },
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /old name layout/);
    assert.match(stdout, /the old name layout was migrated/);

    const configFile = path.join(old.home, '.config', 'gatewarden', 'config.json');
    const routes = path.join(old.home, '.local', 'state', 'gatewarden', 'routes.json');
    assert.ok(fs.existsSync(configFile), 'the configuration was not moved');
    assert.ok(fs.existsSync(routes), 'the route store was not moved');
    assert.ok(fs.existsSync(old.configFile), 'the old directory must stay');
  } finally {
    fs.rmSync(old.home, { recursive: true, force: true });
  }
});

test('gatewarden migrate --dry-run leaves the layout of the old name alone', async () => {
  const old = makeOldName();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate', '--dry-run'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: old.home,
        XDG_CONFIG_HOME: path.join(old.home, '.config'),
        XDG_STATE_HOME: path.join(old.home, '.local', 'state'),
        XDG_CACHE_HOME: path.join(old.home, '.cache'),
      },
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /old name layout/);
    assert.match(stdout, /dry run: nothing was moved/);
    assert.ok(!fs.existsSync(path.join(old.home, '.config', 'gatewarden', 'config.json')));
    assert.ok(!fs.existsSync(path.join(old.home, '.local', 'state', 'gatewarden', 'routes.json')));
  } finally {
    fs.rmSync(old.home, { recursive: true, force: true });
  }
});

/** One registration, for a route store. */
function registration(project: string, port: number): Record<string, unknown> {
  return {
    id: `${project}/main`,
    project,
    branch: 'main',
    projectSlug: project,
    branchSlug: 'main',
    fqdn: `main.${project}.example`,
    devPort: port,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

/**
 * A home that holds both old layouts.
 *
 * The pre-package layout (`~/.traefik-dev/`) is the older one; the layout
 * of the name the directories had before the rename
 * (`~/.config/dev-gateway/`) is the newer one. The newer one has to win:
 * it is the one the first run reads, and the command has to agree.
 */
function makeBothLayouts(): { home: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-both-'));

  const legacy = path.join(home, '.traefik-dev');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(
    path.join(legacy, 'config.json'),
    JSON.stringify({ zone: 'older.example', stateDir: legacy, registryPort: 45002, relayPort: 45001 }, null, 2),
  );
  fs.writeFileSync(
    path.join(legacy, 'registrations.json'),
    JSON.stringify({ version: 1, registrations: [registration('older-project', 3997)] }, null, 2),
  );

  const configDir = path.join(home, '.config', 'dev-gateway');
  const stateDir = path.join(home, '.local', 'state', 'dev-gateway');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ zone: 'newer.example', stateDir, registryPort: 45002, relayPort: 45001 }, null, 2),
  );
  fs.writeFileSync(
    path.join(stateDir, 'routes.json'),
    JSON.stringify({ version: 1, registrations: [registration('newer-project', 3998)] }, null, 2),
  );

  return { home };
}

/** The environment the CLI runs in, with the home of the test. */
function cliEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  };
}

test('the newer of the two old layouts wins in the migrate command', async () => {
  // The command and the first run have to move the same files to the
  // same place. The layout of the old name is the newer one, so its
  // routes are the ones that belong in the active store.
  const { home } = makeBothLayouts();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
      env: cliEnv(home),
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /old name layout/);
    assert.match(stdout, /the old name layout was migrated/);

    const routes = path.join(home, '.local', 'state', 'gatewarden', 'routes.json');
    assert.ok(fs.existsSync(routes), 'the route store was not written');
    const store = JSON.parse(fs.readFileSync(routes, 'utf8')) as {
      registrations: Array<{ project: string }>;
    };
    assert.equal(store.registrations.length, 1);
    assert.equal(
      store.registrations[0]?.project,
      'newer-project',
      'the older layout won the store: the two paths disagree',
    );

    const configFile = path.join(home, '.config', 'gatewarden', 'config.json');
    const written = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { zone: string };
    assert.equal(written.zone, 'newer.example');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the newer of the two old layouts wins in the first run', async () => {
  const { home } = makeBothLayouts();
  try {
    const config = loadConfig({ home, env: {} });

    assert.equal(config.zone, 'newer.example');

    const routes = path.join(home, '.local', 'state', 'gatewarden', 'routes.json');
    assert.ok(fs.existsSync(routes), 'the route store was not written');
    const store = JSON.parse(fs.readFileSync(routes, 'utf8')) as {
      registrations: Array<{ project: string }>;
    };
    assert.equal(store.registrations.length, 1);
    assert.equal(store.registrations[0]?.project, 'newer-project');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the dry run of a home with both old layouts says the same thing twice', async () => {
  // The dry run reports what would move. Both layouts point at the same
  // target file, so only the newer one is moved — the report has to say
  // that, not two migrations into one file.
  const { home } = makeBothLayouts();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate', '--dry-run'], {
      env: cliEnv(home),
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /old name layout/);
    assert.match(stdout, /legacy layout/);
    assert.match(stdout, /dry run: nothing was moved/);
    assert.ok(!fs.existsSync(path.join(home, '.local', 'state', 'gatewarden', 'routes.json')));

    // Only the newer layout claims the route store: the older one finds
    // the target spoken for, in a dry run as well.
    const claims = stdout.split('\n').filter((line) => line.startsWith('routes:'));
    assert.equal(claims.length, 1, `the dry run claims the route store twice:\n${claims.join('\n')}`);
    assert.match(claims[0] ?? '', /dev-gateway/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/** A path as a pattern: the dots of a file name are not wildcards. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('a home with both old layouts says what happened to the older one', async () => {
  // The older layout is left behind when the newer one has already taken
  // the files of the new layout. The report has to say that, and where the
  // routes of the older layout are: "nothing to migrate" would hide it.
  const { home } = makeBothLayouts();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
      env: cliEnv(home),
      cwd: REPO_ROOT,
    });

    // The newer layout was migrated, the older one was not.
    assert.match(stdout, /the old name layout was migrated/);
    assert.match(stdout, /the old layout was not migrated/);
    assert.doesNotMatch(
      stdout,
      /nothing to migrate in the legacy layout/,
      `the report calls the skipped layout empty:\n${stdout}`,
    );

    // The files of the older layout are named, with the routes they hold.
    const oldRoutes = path.join(home, '.traefik-dev', 'registrations.json');
    assert.match(stdout, new RegExp(escapeRegExp(oldRoutes)));
    assert.match(stdout, /not migrated:.*route store/);
    assert.match(stdout, /1 routes/);

    // The way forward is a line of its own, and it names the file that
    // holds the routes that did not come over.
    const next = stdout.trim().split('\n').filter((line) => line.startsWith('next:'));
    assert.equal(next.length, 1, `the report has no way forward:\n${stdout}`);
    assert.match(next[0] ?? '', /registrations\.json/);

    // Nothing was deleted: the old files are still where they were.
    assert.ok(fs.existsSync(oldRoutes), 'the old route store was deleted');
    assert.ok(fs.existsSync(path.join(home, '.traefik-dev', 'config.json')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the report says what happened to every layout, in every home', async () => {
  // Three homes: only the pre-package layout, only the layout of the old
  // name, and both of them. Every layout of every home has a line of its
  // own that says what happened to it.
  const legacy = makeLegacy();
  const oldName = makeOldName();
  const both = makeBothLayouts();
  const homes = [
    { home: legacy.home, legacy: 'migrated', oldName: 'empty' },
    { home: oldName.home, legacy: 'empty', oldName: 'migrated' },
    { home: both.home, legacy: 'not migrated', oldName: 'migrated' },
  ];
  try {
    for (const { home, legacy: what, oldName } of homes) {
      const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
        env: cliEnv(home),
        cwd: REPO_ROOT,
      });

      // Both layouts are in the report.
      assert.match(stdout, /old name layout:/);
      assert.match(stdout, /legacy layout:/);

      // The layout of the old name.
      if (oldName === 'migrated') {
        assert.match(stdout, /the old name layout was migrated/);
      } else {
        assert.match(stdout, /nothing to migrate in the old name layout/);
      }

      // The pre-package layout.
      if (what === 'migrated') {
        assert.match(stdout, /the old layout was migrated/);
      } else if (what === 'empty') {
        assert.match(stdout, /nothing to migrate in the legacy layout/);
      } else {
        assert.match(stdout, /the old layout was (not migrated|partly migrated)/);
      }
    }
  } finally {
    for (const home of [legacy.home, oldName.home, both.home]) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
});

test('migrate --json says what happened to the older layout too', async () => {
  const { home } = makeBothLayouts();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate', '--json'], {
      env: cliEnv(home),
      cwd: REPO_ROOT,
    });
    const parsed = JSON.parse(stdout) as {
      migrated: boolean;
      skipped: Array<{ what: string; from: string; count?: number }>;
      next?: string;
      oldName: { migrated: boolean; skipped: unknown[] };
    };

    assert.equal(parsed.oldName.migrated, true, 'the newer layout was not migrated');
    assert.equal(parsed.migrated, false, 'the older layout was migrated');
    assert.ok(parsed.skipped.length > 0, 'the report does not say what was skipped');
    assert.equal(parsed.skipped[0]?.what, 'configuration file');
    assert.match(parsed.skipped[1]?.from ?? '', /registrations\.json/);
    assert.equal(parsed.skipped[1]?.count, 1);
    assert.match(parsed.next ?? '', /registrations\.json/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/**
 * A home that holds both old layouts, where both hold a route with the
 * same id.
 *
 * The id is the key of the route store, so both routes want the same place
 * in it. They are two different routes: the host names and the ports are
 * not the same. Only one of them can be in the store.
 */
function makeBothLayoutsWithTheSameRoute(): { home: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-same-route-'));
  const shared = (fqdn: string, port: number): Record<string, unknown> => ({
    id: 'shared/main',
    project: 'shared',
    branch: 'main',
    projectSlug: 'shared',
    branchSlug: 'main',
    fqdn,
    devPort: port,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });

  const legacy = path.join(home, '.traefik-dev');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(
    path.join(legacy, 'config.json'),
    JSON.stringify({ zone: 'older.example', stateDir: legacy, registryPort: 45002, relayPort: 45001 }, null, 2),
  );
  fs.writeFileSync(
    path.join(legacy, 'registrations.json'),
    JSON.stringify({ version: 1, registrations: [shared('main.shared.legacy.example', 3997)] }, null, 2),
  );

  const configDir = path.join(home, '.config', 'dev-gateway');
  const stateDir = path.join(home, '.local', 'state', 'dev-gateway');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ zone: 'newer.example', stateDir, registryPort: 45002, relayPort: 45001 }, null, 2),
  );
  fs.writeFileSync(
    path.join(stateDir, 'routes.json'),
    JSON.stringify({ version: 1, registrations: [shared('main.shared.oldname.example', 3998)] }, null, 2),
  );

  return { home };
}

test('the advice does not call a route with the same id the same route', async () => {
  // Both old layouts hold a route with the id "shared/main", but they are
  // two different routes: the host names and the ports are not the same.
  // Only the newer one came over, so the advice has to say that the older
  // route is not in the store: it must not invite the user to remove the
  // file that holds it.
  const { home } = makeBothLayoutsWithTheSameRoute();
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
      env: cliEnv(home),
      cwd: REPO_ROOT,
    });

    const next = stdout.trim().split('\n').filter((line) => line.startsWith('next:'));
    assert.equal(next.length, 1, `the report has no way forward:\n${stdout}`);
    assert.doesNotMatch(
      next[0] ?? '',
      /already in the route store/,
      'the advice calls a route that did not come over the same route',
    );
    assert.doesNotMatch(
      next[0] ?? '',
      /removed by you/,
      'the advice invites the user to remove a file that holds a route that did not come over',
    );
    assert.match(next[0] ?? '', /main\.shared\.legacy\.example:3997/);
    assert.match(next[0] ?? '', /add it to the route store/);

    // The store holds the route of the newer layout, and only that one.
    const routes = path.join(home, '.local', 'state', 'gatewarden', 'routes.json');
    const store = JSON.parse(fs.readFileSync(routes, 'utf8')) as {
      registrations: Array<{ fqdn: string }>;
    };
    assert.equal(store.registrations.length, 1);
    assert.equal(store.registrations[0]?.fqdn, 'main.shared.oldname.example');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the summary says which file the new layout had and which the newer layout took', async () => {
  // The new layout has a configuration file of its own already, and the
  // newer layout takes the route store during the run. The summary has to
  // say which is which: the new layout did not hold the route store
  // before the run.
  const { home } = makeBothLayouts();
  try {
    const configDir = path.join(home, '.config', 'gatewarden');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ zone: 'current.example' }, null, 2),
    );

    const { stdout } = await execFileAsync(process.execPath, [CLI, 'migrate'], {
      env: cliEnv(home),
      cwd: REPO_ROOT,
    });

    assert.match(stdout, /the new layout already had its own configuration file/);
    assert.match(stdout, /the newer layout took the route store/);
    assert.doesNotMatch(
      stdout,
      /the new layout already had its own configuration file and route store/,
      `the summary says the new layout held the route store before the run:\n${stdout}`,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the first run says that the older layout was left behind', async () => {
  // The first run migrates the newer layout and leaves the older one where
  // it is. The user has to hear about it, even if they never run
  // "gatewarden migrate".
  const { home } = makeBothLayouts();
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, 'list', '--json'], {
      env: cliEnv(home),
      cwd: REPO_ROOT,
    });

    assert.match(stderr, /the old layout was not migrated/);
    assert.match(stderr, /registrations\.json/);

    // The output of a command that writes JSON is JSON, and nothing else.
    const parsed = JSON.parse(stdout) as { registrations: unknown[] };
    assert.ok(Array.isArray(parsed.registrations));

    // The routes of the older layout did not come over.
    const routes = path.join(home, '.local', 'state', 'gatewarden', 'routes.json');
    const store = JSON.parse(fs.readFileSync(routes, 'utf8')) as {
      registrations: Array<{ project: string }>;
    };
    assert.equal(store.registrations.length, 1);
    assert.equal(store.registrations[0]?.project, 'newer-project');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
