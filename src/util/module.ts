/**
 * Where the running module lives.
 *
 * The package runs in two worlds:
 *
 *   - in a checkout, as TypeScript (`src/….ts`), stripped by Node;
 *   - installed, as compiled JavaScript (`dist/….js`), because Node cannot
 *     strip types under `node_modules` (D2).
 *
 * A few places need the path of a *sibling* module at runtime, for example
 * the daemon, which forks the worker next to it. Those paths are plain
 * strings, so the compiler never rewrites them; they have to be resolved
 * against the module that asks for them, with the extension that matches the
 * world the code is running in.
 */

import path from 'node:path';
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

/** The file path of the directory that holds the calling module. */
export function moduleDirectory(moduleUrl: string): string {
  return path.dirname(fileURLToPath(moduleUrl));
}
