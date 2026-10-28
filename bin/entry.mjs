/**
 * Which build of the package a launcher should run.
 *
 * Node cannot strip TypeScript types under `node_modules` (D2), so an
 * installed package always runs the compiled `dist/`. In a checkout the
 * TypeScript source is used, so a launcher always runs the code that is in
 * the working tree; the compiled build is the fallback for a checkout
 * without the sources.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @param launcherUrl the URL of the launcher (`import.meta.url`)
 * @param source the source module, relative to the launcher
 * @param compiled the compiled module, relative to the launcher
 * @returns the URL of the module to run, or `null` when neither exists
 */
export function resolveEntry(launcherUrl, source, compiled) {
  const installed = fileURLToPath(launcherUrl).split(/[\\/]/).includes('node_modules');
  const candidates = installed ? [compiled] : [source, compiled];

  for (const candidate of candidates) {
    const url = new URL(candidate, launcherUrl);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}
