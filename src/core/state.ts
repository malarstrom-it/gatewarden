/** Persistent registration state. */

import fs from 'node:fs';
import path from 'node:path';
import { buildFqdn, slugify } from './util/slug.ts';
import type { Registration } from './types.ts';

/** The name of the route store in the state directory (§3.1). */
export const ROUTES_FILE = 'routes.json';

/** The name the route store had before it was renamed. */
export const LEGACY_ROUTES_FILE = 'registrations.json';

interface StateFile {
  version: number;
  registrations: Registration[];
}

export interface UpsertInput {
  project: string;
  branch: string;
  devPort: number;
  label?: string;
  zone: string;
}

/**
 * Registration store backed by a JSON file in the state directory.
 *
 * Writes are atomic (write to a temporary file, then rename), so a reader
 * never sees a half-written document. The file is the single source of truth:
 * the CLI writes it, the daemon reads it.
 */
export class RegistrationStore {
  /** The file the routes are written to. */
  readonly file: string;
  private cached: Registration[] | null = null;
  private cachedMtimeMs = -1;

  readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.file = path.join(stateDir, ROUTES_FILE);
  }

  /**
   * The file the routes are read from.
   *
   * The route store was renamed to `routes.json` (§3.1). A state directory
   * that still holds the old name is read from it, so that the routes of an
   * installation that ran before the rename are not lost. The first write
   * creates the new file, and from then on the new file is the one that is
   * read.
   */
  private sourceFile(): string {
    if (fs.existsSync(this.file)) return this.file;
    const legacy = path.join(this.stateDir, LEGACY_ROUTES_FILE);
    if (fs.existsSync(legacy)) return legacy;
    return this.file;
  }

  /** All registrations, in insertion order. */
  list(): Registration[] {
    const source = this.sourceFile();
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(source);
    } catch {
      stat = null;
    }
    if (!stat) {
      this.cached = [];
      this.cachedMtimeMs = -1;
      return this.cached;
    }
    if (this.cached && stat.mtimeMs === this.cachedMtimeMs) return this.cached;
    try {
      const raw = JSON.parse(fs.readFileSync(source, 'utf8')) as StateFile;
      const registrations = Array.isArray(raw.registrations) ? raw.registrations : [];
      this.cached = registrations;
      this.cachedMtimeMs = stat.mtimeMs;
    } catch {
      this.cached = [];
      this.cachedMtimeMs = stat.mtimeMs;
    }
    return this.cached ?? [];
  }

  /** Find a registration by its dispatch id. */
  find(id: string): Registration | undefined {
    return this.list().find((r) => r.id === id);
  }

  /** Find a registration by project and branch (raw or slugged). */
  findByProjectBranch(project: string, branch: string): Registration | undefined {
    const projectSlug = slugify(project);
    const branchSlug = slugify(branch);
    return this.list().find((r) => r.projectSlug === projectSlug && r.branchSlug === branchSlug);
  }

  /**
   * Insert or update a registration.
   *
   * Registering the same project+branch again updates the port in place; no
   * duplicate route is created.
   */
  upsert(input: UpsertInput): Registration {
    const registrations = [...this.list()];
    const projectSlug = slugify(input.project);
    const branchSlug = slugify(input.branch);
    const id = `${projectSlug}/${branchSlug}`;
    const now = new Date().toISOString();
    const existing = registrations.find((r) => r.projectSlug === projectSlug && r.branchSlug === branchSlug);

    const record: Registration = {
      id,
      project: input.project,
      branch: input.branch,
      projectSlug,
      branchSlug,
      fqdn: buildFqdn(input.project, input.branch, input.zone),
      devPort: input.devPort,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (input.label !== undefined) record.label = input.label;
    else if (existing?.label !== undefined) record.label = existing.label;

    const index = registrations.findIndex((r) => r.id === id);
    if (index >= 0) registrations[index] = record;
    else registrations.push(record);

    this.write(registrations);
    return record;
  }

  /**
   * Remove a registration by its dispatch id (`<project-slug>/<branch-slug>`).
   *
   * The id is the key the store uses everywhere else (the `X-Dev-Target`
   * header value, the object-name hash input), so the HTTP endpoint and the
   * CLI address exactly the same registration.
   *
   * Returns true when something was removed.
   */
  removeById(id: string): boolean {
    const registrations = this.list();
    const next = registrations.filter((r) => r.id !== id);
    if (next.length === registrations.length) return false;
    this.write(next);
    return true;
  }

  /** Remove a registration. Returns true when something was removed. */
  remove(project: string, branch: string): boolean {
    const registrations = this.list();
    const projectSlug = slugify(project);
    const branchSlug = slugify(branch);
    const next = registrations.filter((r) => !(r.projectSlug === projectSlug && r.branchSlug === branchSlug));
    if (next.length === registrations.length) return false;
    this.write(next);
    return true;
  }

  /** Write the state file atomically. */
  write(registrations: Registration[]): void {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const payload: StateFile = { version: 1, registrations };
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
    fs.renameSync(tmp, this.file);
    this.cached = registrations;
    this.cachedMtimeMs = -1;
  }
}
