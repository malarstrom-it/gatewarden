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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The name of the package on the registry. */
const PACKAGE_NAME = '@malarstrom/gatewarden';

/**
 * The `node_modules` directories in the path of a launcher.
 *
 * Every one of them is listed, from the outermost one to the innermost
 * one: pnpm keeps the packages of a project in a virtual store inside
 * the `node_modules` of the project, so the launcher of such an
 * installation lies in two of them.
 *
 * @param {string} launcherUrl the URL of the launcher (`import.meta.url`)
 * @returns {string[]} the directories
 */
function nodeModulesOf(launcherUrl) {
  const parts = fileURLToPath(launcherUrl).split(/[\\/]/);
  const directories = [];

  parts.forEach((part, index) => {
    if (part === 'node_modules') directories.push(parts.slice(0, index + 1).join(path.sep));
  });

  return directories;
}

/**
 * @param launcherUrl the URL of the launcher (`import.meta.url`)
 * @param source the source module, relative to the launcher
 * @param compiled the compiled module, relative to the launcher
 * @returns the URL of the module to run, or `null` when neither exists
 */
export function resolveEntry(launcherUrl, source, compiled) {
  const installed = nodeModulesOf(launcherUrl).length > 0;
  const candidates = installed ? [compiled] : [source, compiled];

  for (const candidate of candidates) {
    const url = new URL(candidate, launcherUrl);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

/**
 * Is the launcher part of a global installation?
 *
 * A launcher that lies in a `node_modules` is a dependency of a
 * project: npm hoists the packages into the `node_modules` of the
 * project, and pnpm links them into a virtual store inside it. A
 * project keeps the manifest of the project next to the `node_modules`
 * its dependencies live in, and that is how the launcher of a project
 * installation is told apart from the launcher of a global one — the
 * virtual store of pnpm lies inside the `node_modules` of the project,
 * and the manifest of the project lies above the store.
 *
 * The global root of npm holds the packages of everybody, and no
 * manifest lies next to it: npm keeps the global packages in
 * `<prefix>/lib/node_modules` on POSIX and in `<prefix>\node_modules`
 * on Windows, where the prefix is the directory named `npm`.
 *
 * A launcher outside every `node_modules` was not installed as a
 * dependency at all, and it is a global installation as well.
 *
 * @param {string} launcherUrl the URL of the launcher (`import.meta.url`)
 * @returns {boolean} whether the installation is a global one
 */
function isGlobalInstall(launcherUrl) {
  const modules = nodeModulesOf(launcherUrl);
  if (modules.length === 0) return true;

  // A project keeps the manifest of the project next to the
  // `node_modules` its dependencies live in.
  for (const directory of modules) {
    if (existsSync(path.join(path.dirname(directory), 'package.json'))) return false;
  }

  // The global root of npm.
  const parent = path.basename(path.dirname(modules[modules.length - 1]));
  return parent === 'lib' || parent === 'npm';
}

/**
 * The command that reinstalls the package the way it was installed.
 *
 * The reader of the message has to be able to run the command as it
 * stands, so the message names one command and not two: the command of
 * the installation the launcher lives in.
 *
 * @param {string} launcherUrl the URL of the launcher (`import.meta.url`)
 * @returns {string} the command
 */
export function reinstallCommand(launcherUrl) {
  return isGlobalInstall(launcherUrl)
    ? `npm install -g ${PACKAGE_NAME}`
    : `npm install ${PACKAGE_NAME}`;
}

/**
 * The text of the message a launcher writes when the package has no
 * build.
 *
 * The reader of an installed package has no checkout and nothing to
 * build, so the message speaks about the installation and not about a
 * working tree.
 *
 * The installation is incomplete: the package was installed, but the
 * build it runs was not shipped with it. The command in the message is
 * the one that reinstalls the package the way it was installed, and it
 * is the only command in the message — a reader has to be able to run
 * the command that is written down.
 *
 * @param {string} launcherUrl the URL of the launcher (`import.meta.url`)
 * @returns {string} the text
 */
export function noBuildText(launcherUrl) {
  return `the installed package has no build — reinstall the package the way you installed it: "${reinstallCommand(launcherUrl)}"`;
}

/**
 * The message a launcher writes when the package has no build.
 *
 * The name of the launcher is the beginning of the message, so a reader
 * who ran `gatewarden-mcp` knows which of the three launchers it was.
 *
 * @param {string} name the name of the launcher
 * @param {string} launcherUrl the URL of the launcher (`import.meta.url`)
 * @returns {string} the message, with its line ending
 */
export function noBuildMessage(name, launcherUrl) {
  return `${name}: ${noBuildText(launcherUrl)}\n`;
}
