/**
 * What the launchers of the package share.
 *
 * Two things: which build of the package a launcher should run, and what
 * a launcher says when the package has no build at all.
 *
 * Node cannot strip TypeScript types under `node_modules`, so an
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

/**
 * The text of the message a launcher writes when the package has no
 * build.
 *
 * The reader of an installed package has no checkout and nothing to
 * build, so the message speaks about the installation and not about a
 * working tree.
 *
 * The package can be installed in a project or globally, and the advice
 * has to hold for both of them: the reader has to reinstall the package
 * the way it was installed, and the message cannot assume which of the
 * two it was. So it names both commands.
 */
export const NO_BUILD_TEXT =
  'the installed package has no build — reinstall the package the way you installed it: "npm install @malarstrom/gatewarden" in the project, or "npm install -g @malarstrom/gatewarden" for a global install';

/**
 * The message a launcher writes when the package has no build.
 *
 * The name of the launcher is the beginning of the message, so a reader
 * who ran `gatewarden-mcp` knows which of the three commands it was.
 *
 * @param {string} name the name of the launcher
 * @returns {string} the message, with its line ending
 */
export function noBuildMessage(name) {
  return `${name}: ${NO_BUILD_TEXT}\n`;
}
