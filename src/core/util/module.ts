/**
 * Where the running module lives.
 *
 * The package runs in two worlds:
 *
 *   - in a checkout, as TypeScript, stripped by Node;
 *   - installed, as compiled JavaScript, because Node cannot strip types
 *     under `node_modules`.
 *
 * A few places need the path of a *sibling* module at runtime, for example
 * the daemon, which forks the worker next to it. Those paths are plain
 * strings, so the compiler never rewrites them; they have to be resolved
 * against the module that asks for them, with the extension that matches the
 * world the code is running in.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * The extension of the module that calls this function.
 *
 * `.ts` in a checkout, `.js` in the compiled package.
 */
export function runningExtension(moduleUrl: string): '.ts' | '.js' {
  return moduleUrl.endsWith('.ts') ? '.ts' : '.js';
}

/**
 * The URL of a module that sits next to `moduleUrl`.
 *
 * @param moduleUrl the URL of the calling module (`import.meta.url`)
 * @param name the file name of the sibling, without an extension
 */
export function siblingModuleUrl(moduleUrl: string, name: string): string {
  return new URL(`./${name}${runningExtension(moduleUrl)}`, moduleUrl).href;
}

/** The file path of a module that sits next to `moduleUrl`. */
export function siblingModulePath(moduleUrl: string, name: string): string {
  return fileURLToPath(siblingModuleUrl(moduleUrl, name));
}

/**
 * The file path of a module that sits at `relativeName`, relative to the
 * directory of `moduleUrl`.
 *
 * `relativeName` is written without an extension: the extension that
 * matches the world the code is running in is added (`.ts` in a checkout,
 * `.js` in the compiled package).
 */
export function relativeModulePath(moduleUrl: string, relativeName: string): string {
  const relative = relativeName.startsWith('.') ? relativeName : `./${relativeName}`;
  return fileURLToPath(new URL(`${relative}${runningExtension(moduleUrl)}`, moduleUrl).href);
}

/** The file path of the directory that holds the calling module. */
export function moduleDirectory(moduleUrl: string): string {
  return path.dirname(fileURLToPath(moduleUrl));
}

/**
 * The version of the package.
 *
 * The manifest sits three levels above this module in both worlds, so
 * the same relative path finds it in a checkout and in the compiled
 * package.
 */
export function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require('../../../package.json') as { version?: string };
    return manifest.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
