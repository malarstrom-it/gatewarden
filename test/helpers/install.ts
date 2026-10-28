/**
 * An installation of a package, without the network.
 *
 * The packaging layer needs no network (§11.3, L3): the tarball is
 * unpacked into a directory that looks like an installation, the runtime
 * dependencies are copied out of the checkout, the commands are linked
 * the way npm links them, and the install script of the package is run.
 *
 * What npm does is what happens here — the registry is the only part
 * that is left out, and the registry is not part of the package.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Copy a runtime dependency, and everything it depends on, out of the
 * checkout and into a throwaway installation.
 *
 * The install has to work without the network, so the dependencies come
 * from the checkout's `node_modules`.
 */
export function copyDependencyClosure(name: string, modules: string, from: string): void {
  const source = path.join(from, 'node_modules', name);
  if (!fs.existsSync(source)) return;

  const target = path.join(modules, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.cpSync(source, target, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    copyDependencyClosure(dependency, modules, from);
  }
}

/** Unpack a tarball into a directory, the way npm unpacks it. */
export async function unpackTarball(tarball: string, target: string): Promise<void> {
  fs.mkdirSync(target, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'], { timeout: 120_000 });
}

/**
 * Link the commands of a package, the way npm links them.
 *
 * npm puts a link to the launcher in `node_modules/.bin`, so that the
 * command is on the path of everything that runs in the installation.
 */
export function linkBinaries(packageDir: string, modules: string, names: string[]): void {
  const bin = path.join(modules, '.bin');
  fs.mkdirSync(bin, { recursive: true });

  for (const name of names) {
    const launcher = path.join(packageDir, 'bin', `${name}.js`);
    if (!fs.existsSync(launcher)) continue;
    const link = path.join(bin, name);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(launcher, link);
  }
}
