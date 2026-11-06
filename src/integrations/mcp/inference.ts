/**
 * The project and the branch, when the agent does not say.
 *
 * The agent does not have to reason about names: it publishes a port, and
 * the gateway works out which project and which branch it belongs to. The
 * names may still be passed explicitly, and then they are used as they are.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { slugify } from '../../core/util/slug.ts';

/** The name of the working directory, slugified. */
export function inferProject(cwd: string): string {
  const base = path.basename(path.resolve(cwd));
  return slugify(base) || 'project';
}

/**
 * The branch of the working directory, slugified.
 *
 * A directory that is not a repository — and a repository without a commit
 * — falls back to `main`.
 */
export function inferBranch(cwd: string): string {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    // A detached HEAD answers "HEAD", and that is not a branch name.
    if (out && out !== 'HEAD') {
      const slug = slugify(out);
      if (slug) return slug;
    }
  } catch {
    // No git, or no repository: the fallback below is used.
  }
  return 'main';
}
