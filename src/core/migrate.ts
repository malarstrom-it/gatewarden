/**
 * The migration from the old layouts.
 *
 * Two installations came before this one, and both are still read:
 *
 * 1. the pre-package layout, which kept everything in `~/.traefik-dev/`:
 *    `config.json`, `registrations.json`, `daemon.pid` and `daemon.log`;
 * 2. the layout of the name the directories had before the rename, which
 *    kept the configuration in `~/.config/dev-gateway/config.json` and the
 *    route store in `~/.local/state/dev-gateway/routes.json`.
 *
 * The migration moves the configuration and the route store to the layout of
 * the current installation. It never deletes anything: the old directories
 * are left in place, so a user can go back to the old installation with the
 * files still there.
 *
 * The report says what happened to every layout: what was moved, what was
 * not moved and why, and where the files that were not moved are. A layout
 * that was left behind because another layout of the same run had already
 * claimed the target is not "nothing to migrate": it is a layout that was
 * not migrated, and the report says where its routes are and what to do
 * with them.
 *
 * The migration runs in two ways:
 *
 * - on the first run, when the new configuration file does not exist and an
 *   old one does (that is what `loadConfig` does);
 * - explicitly, through `gatewarden migrate`, which reports what it moved.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { GatewayPaths, LegacyAppPaths } from './paths.ts';
import { LEGACY_ROUTES_FILE, ROUTES_FILE } from './state.ts';

/** The configuration file of the old layout. */
export const LEGACY_CONFIG_FILE = 'config.json';

export { LEGACY_ROUTES_FILE, ROUTES_FILE };

/** The files the old layout held. */
export interface LegacyLayout {
  /** The directory itself. */
  dir: string;
  /** The configuration file. */
  configFile: string;
  /** The route store. */
  routesFile: string;
  /** The pidfile of the running daemon. */
  pidFile: string;
  /** The log file of the running daemon. */
  logFile: string;
}

/** The files of the old layout, in a directory. */
export function legacyLayout(dir: string): LegacyLayout {
  return {
    dir,
    configFile: path.join(dir, LEGACY_CONFIG_FILE),
    routesFile: path.join(dir, LEGACY_ROUTES_FILE),
    pidFile: path.join(dir, 'daemon.pid'),
    logFile: path.join(dir, 'daemon.log'),
  };
}

/** A file a migration moved. */
export interface MovedFile {
  /** Where the file was. */
  from: string;
  /** Where it is now. */
  to: string;
  /** How many routes the file holds, when it is the route store. */
  count?: number;
}

/**
 * A file of an old layout that was not migrated.
 *
 * The file is still where it was. The reason says why it was not moved,
 * and where it stays.
 */
export interface SkippedFile {
  /** What the file is: the configuration file or the route store. */
  what: 'configuration file' | 'route store';
  /** Where the file is. It stayed there. */
  from: string;
  /** The file it would have gone to. */
  to: string;
  /** Whether the newer layout of the same run claimed the target. */
  byNewerLayout: boolean;
  /** Why the file was not migrated, in a sentence. */
  reason: string;
  /** How many routes the file holds, when it is the route store. */
  count?: number;
}

/** What the migration of one old layout reports. */
export interface LayoutMigrationReport {
  /** The directory of the old layout. */
  legacyDir: string;
  /** Whether the report describes a dry run. */
  dryRun: boolean;
  /** Whether anything was moved. */
  migrated: boolean;
  /** The configuration file, when it was moved. */
  config?: MovedFile;
  /** The route store, when it was moved. */
  routes?: MovedFile;
  /** The files of the old layout that were left where they were. */
  leftInPlace: string[];
  /** The files of the old layout that were not migrated, and why. */
  skipped: SkippedFile[];
  /** What the migration did, in words. */
  notes: string[];
  /** The way forward, when a route store was left behind. */
  next?: string;
}

/** The report of the migration of the pre-package layout. */
export type MigrationReport = LayoutMigrationReport;

export interface MigrationOptions {
  /** Where the files go. */
  paths: GatewayPaths;
  /** The directory of the old layout. */
  legacyDir: string;
  /** Report what would move, without moving anything. */
  dryRun?: boolean;
  /** The content of the new configuration file. */
  config?: Record<string, unknown>;
  /**
   * The files another layout of the same run has claimed.
   *
   * A dry run moves nothing, so the file a newer layout would have
   * written is not there yet — and the older layout would claim it as
   * well. The claim of the newer layout is passed on, so that the two
   * migrations do not report the same target.
   */
  claimed?: string[];
}

function exists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why a target file is not moved into.
 *
 * It is not moved into when another layout of the same run has claimed it,
 * and when it is there already: a dry run moves nothing, so the claim is
 * the only thing that says that the file is spoken for. The reason says
 * which of the two it is, and the claim is remembered: the report has to
 * be able to say that the newer layout of the run is the one that won.
 */
function targetTaken(
  file: string,
  claimed: string[] | undefined,
  what: string,
): { byNewerLayout: boolean; reason: string } | undefined {
  if ((claimed ?? []).includes(file)) {
    return { byNewerLayout: true, reason: `the ${what} is taken by the newer layout: ${file}` };
  }
  if (exists(file)) return { byNewerLayout: false, reason: `the ${what} exists already: ${file}` };
  return undefined;
}

/** How many routes a route store holds. */
export function countRoutes(file: string): number {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { registrations?: unknown };
    return Array.isArray(raw.registrations) ? raw.registrations.length : 0;
  } catch {
    return 0;
  }
}

/** The ids of the routes a route store holds. */
function routeIds(file: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { registrations?: unknown };
    if (!Array.isArray(raw.registrations)) return [];
    const ids: string[] = [];
    for (const registration of raw.registrations) {
      const id = (registration as { id?: unknown })?.id;
      if (typeof id === 'string' && id.length > 0) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * The sentence that says why a file was not migrated.
 *
 * The sentence says two things: why the file was not moved, and where it
 * stayed. The number of routes is in it, so that the report says how much
 * is left behind.
 */
function skipReason(reason: string, from: string, count?: number): string {
  const routes = count === undefined ? '' : ` (${count} routes)`;
  return `${reason}; the old file stays at ${from}${routes}`;
}

/**
 * The way forward for a route store that was left behind.
 *
 * The route store of the new layout holds the routes of the layout that was
 * migrated. When the routes of the old layout are not in it, the advice
 * says which file holds them and what to do with it.
 */
function routeAdvice(from: string, to: string, label: string): string {
  const oldIds = routeIds(from);
  if (oldIds.length === 0) {
    return `the route store ${from} holds no routes: there is nothing to add to the route store ${to}`;
  }
  const newIds = new Set(routeIds(to));
  const missing = oldIds.filter((id) => !newIds.has(id));
  if (missing.length === 0) {
    return (
      `the routes of ${from} are already in the route store ${to}: ` +
      'the old file can be left in place or removed by you'
    );
  }
  return (
    `to use the routes of the ${label}: ` +
    `add the entries of the registrations array of ${from} to the route store ${to}`
  );
}

/**
 * Move the old layout to the new one.
 *
 * The configuration file is written with the content the caller provides
 * (the old values, filtered to the keys the new layout knows). The route
 * store is copied as it is.
 *
 * The old directory is never deleted: the pidfile and the log of a running
 * daemon stay with the process that owns them, and the rest is there for the
 * user to look at. A file that was not migrated is reported as such, with
 * the reason and with the place it stayed in.
 */
export function migrateLegacyLayout(opts: MigrationOptions): MigrationReport {
  const legacy = legacyLayout(opts.legacyDir);
  const report: MigrationReport = {
    legacyDir: legacy.dir,
    dryRun: opts.dryRun === true,
    migrated: false,
    leftInPlace: [],
    skipped: [],
    notes: [],
  };

  const hasConfig = exists(legacy.configFile);
  const hasRoutes = exists(legacy.routesFile);

  if (!hasConfig && !hasRoutes) {
    report.notes.push(`nothing to migrate: ${legacy.dir} holds no configuration and no routes`);
    return report;
  }

  if (hasConfig) {
    const taken = targetTaken(opts.paths.configFile, opts.claimed, 'configuration file');
    if (taken !== undefined) {
      report.skipped.push({
        what: 'configuration file',
        from: legacy.configFile,
        to: opts.paths.configFile,
        byNewerLayout: taken.byNewerLayout,
        reason: skipReason(taken.reason, legacy.configFile),
      });
    } else {
      report.config = { from: legacy.configFile, to: opts.paths.configFile };
      report.migrated = true;
      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(opts.paths.configFile), { recursive: true });
        const content = opts.config ?? JSON.parse(fs.readFileSync(legacy.configFile, 'utf8'));
        fs.writeFileSync(opts.paths.configFile, JSON.stringify(content, null, 2) + '\n');
      }
    }
  }

  const routesTarget = path.join(opts.paths.stateDir, ROUTES_FILE);
  if (hasRoutes) {
    const taken = targetTaken(routesTarget, opts.claimed, 'route store');
    if (taken !== undefined) {
      const count = countRoutes(legacy.routesFile);
      report.skipped.push({
        what: 'route store',
        from: legacy.routesFile,
        to: routesTarget,
        byNewerLayout: taken.byNewerLayout,
        reason: skipReason(taken.reason, legacy.routesFile, count),
        count,
      });
      report.next = routeAdvice(legacy.routesFile, routesTarget, 'old layout');
    } else {
      report.routes = { from: legacy.routesFile, to: routesTarget, count: countRoutes(legacy.routesFile) };
      report.migrated = true;
      if (!opts.dryRun) {
        fs.mkdirSync(opts.paths.stateDir, { recursive: true });
        fs.copyFileSync(legacy.routesFile, routesTarget);
      }
    }
  }

  for (const file of [legacy.configFile, legacy.routesFile, legacy.pidFile, legacy.logFile]) {
    if (exists(file)) report.leftInPlace.push(file);
  }
  report.notes.push(`${legacy.dir} was left in place; nothing was deleted`);

  return report;
}

/**
 * The layout of the name the directories had before the rename.
 *
 * An installation that was made under that name keeps its configuration in
 * `~/.config/dev-gateway/config.json` and its route store in
 * `~/.local/state/dev-gateway/routes.json`. The file names inside are the
 * ones of the new layout: only the directory carries the old name.
 */
export interface LegacyAppLayout {
  /** The configuration directory of the old name. */
  configDir: string;
  /** The state directory of the old name. */
  stateDir: string;
  /** The configuration file of the old name. */
  configFile: string;
  /** The route store of the old name. */
  routesFile: string;
}

/** The files of the old name, in the directories of that name. */
export function legacyAppLayout(dirs: LegacyAppPaths): LegacyAppLayout {
  return {
    configDir: dirs.configDir,
    stateDir: dirs.stateDir,
    configFile: path.join(dirs.configDir, LEGACY_CONFIG_FILE),
    routesFile: path.join(dirs.stateDir, ROUTES_FILE),
  };
}

export interface LegacyAppMigrationOptions {
  /** Where the files go. */
  paths: GatewayPaths;
  /** The directories of the old name. */
  legacy: LegacyAppLayout;
  /** Report what would move, without moving anything. */
  dryRun?: boolean;
  /** The content of the new configuration file. */
  config?: Record<string, unknown>;
  /** The files another layout of the same run has claimed. */
  claimed?: string[];
}

export interface LegacyAppMigrationReport extends LayoutMigrationReport {
  /** The state directory of the old name. */
  legacyStateDir: string;
}

/**
 * Move the layout of the old name to the new one.
 *
 * The configuration file is written with the content the caller provides
 * (the old values, filtered to the keys the new layout knows). The route
 * store is copied as it is.
 *
 * Nothing is ever deleted: the old directories stay where they are, with
 * the files in them. A file that was not migrated is reported as such, with
 * the reason and with the place it stayed in.
 */
export function migrateLegacyAppLayout(opts: LegacyAppMigrationOptions): LegacyAppMigrationReport {
  const legacy = opts.legacy;
  const report: LegacyAppMigrationReport = {
    legacyDir: legacy.configDir,
    legacyStateDir: legacy.stateDir,
    dryRun: opts.dryRun === true,
    migrated: false,
    leftInPlace: [],
    skipped: [],
    notes: [],
  };

  const hasConfig = exists(legacy.configFile);
  const hasRoutes = exists(legacy.routesFile);

  if (!hasConfig && !hasRoutes) {
    report.notes.push(`nothing to migrate: ${legacy.configDir} holds no configuration and no routes`);
    return report;
  }

  if (hasConfig) {
    const taken = targetTaken(opts.paths.configFile, opts.claimed, 'configuration file');
    if (taken !== undefined) {
      report.skipped.push({
        what: 'configuration file',
        from: legacy.configFile,
        to: opts.paths.configFile,
        byNewerLayout: taken.byNewerLayout,
        reason: skipReason(taken.reason, legacy.configFile),
      });
    } else {
      report.config = { from: legacy.configFile, to: opts.paths.configFile };
      report.migrated = true;
      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(opts.paths.configFile), { recursive: true });
        const content = opts.config ?? JSON.parse(fs.readFileSync(legacy.configFile, 'utf8'));
        fs.writeFileSync(opts.paths.configFile, JSON.stringify(content, null, 2) + '\n');
      }
    }
  }

  const routesTarget = path.join(opts.paths.stateDir, ROUTES_FILE);
  if (hasRoutes) {
    const taken = targetTaken(routesTarget, opts.claimed, 'route store');
    if (taken !== undefined) {
      const count = countRoutes(legacy.routesFile);
      report.skipped.push({
        what: 'route store',
        from: legacy.routesFile,
        to: routesTarget,
        byNewerLayout: taken.byNewerLayout,
        reason: skipReason(taken.reason, legacy.routesFile, count),
        count,
      });
      report.next = routeAdvice(legacy.routesFile, routesTarget, 'old name layout');
    } else {
      report.routes = { from: legacy.routesFile, to: routesTarget, count: countRoutes(legacy.routesFile) };
      report.migrated = true;
      if (!opts.dryRun) {
        fs.mkdirSync(opts.paths.stateDir, { recursive: true });
        fs.copyFileSync(legacy.routesFile, routesTarget);
      }
    }
  }

  for (const file of [legacy.configFile, legacy.routesFile]) {
    if (exists(file)) report.leftInPlace.push(file);
  }
  report.notes.push(`${legacy.configDir} was left in place; nothing was deleted`);

  return report;
}
