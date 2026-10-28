/**
 * The migration from the pre-package layout (§3.4).
 *
 * The old installation kept everything in `~/.traefik-dev/`:
 * `config.json`, `registrations.json`, `daemon.pid` and `daemon.log`.
 *
 * The migration moves the configuration and the route store to the layout of
 * §3.1. It never deletes anything: the old directory is left in place, so a
 * user can go back to the old installation with the files still there.
 *
 * The migration runs in two ways:
 *
 * - on the first run, when the new configuration file does not exist and the
 *   old one does (that is what `loadConfig` does);
 * - explicitly, through `dev-gateway migrate`, which reports what it moved.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { GatewayPaths } from './paths.ts';
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

/** A file the migration moved. */
export interface MovedFile {
  /** Where the file was. */
  from: string;
  /** Where it is now. */
  to: string;
  /** How many routes the file holds, when it is the route store. */
  count?: number;
}

export interface MigrationOptions {
  /** Where the files go. */
  paths: GatewayPaths;
  /** The directory of the old layout. */
  legacyDir: string;
  /** Report what would move, without moving anything. */
  dryRun?: boolean;
  /** The content of the new configuration file. */
  config?: Record<string, unknown>;
}

export interface MigrationReport {
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
  /** What the migration did, in words. */
  notes: string[];
}

function exists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
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

/**
 * Move the old layout to the new one.
 *
 * The configuration file is written with the content the caller provides
 * (the old values, filtered to the keys the new layout knows). The route
 * store is copied as it is.
 *
 * The old directory is never deleted: the pidfile and the log of a running
 * daemon stay with the process that owns them, and the rest is there for the
 * user to look at.
 */
export function migrateLegacyLayout(opts: MigrationOptions): MigrationReport {
  const legacy = legacyLayout(opts.legacyDir);
  const report: MigrationReport = {
    legacyDir: legacy.dir,
    dryRun: opts.dryRun === true,
    migrated: false,
    leftInPlace: [],
    notes: [],
  };

  const hasConfig = exists(legacy.configFile);
  const hasRoutes = exists(legacy.routesFile);

  if (!hasConfig && !hasRoutes) {
    report.notes.push(`nothing to migrate: ${legacy.dir} holds no configuration and no routes`);
    return report;
  }

  if (hasConfig) {
    if (exists(opts.paths.configFile)) {
      report.notes.push(`the configuration file exists already: ${opts.paths.configFile}`);
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
    if (exists(routesTarget)) {
      report.notes.push(`the route store exists already: ${routesTarget}`);
    } else {
      report.routes = { from: legacy.routesFile, to: routesTarget, count: countRoutes(legacy.routesFile) };
      report.migrated = true;
      if (!opts.dryRun) {
        fs.mkdirSync(opts.paths.stateDir, { recursive: true });
        fs.copyFileSync(legacy.routesFile, routesTarget);
      }
    }
  }

  for (const file of [legacy.pidFile, legacy.logFile]) {
    if (exists(file)) report.leftInPlace.push(file);
  }
  report.notes.push(`${legacy.dir} was left in place; nothing was deleted`);

  return report;
}
