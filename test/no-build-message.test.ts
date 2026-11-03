/**
 * The message a launcher writes when the package has no build (S95).
 *
 * The message names one command: the command that reinstalls the
 * package the way it was installed. The launcher knows which
 * installation it is in — a dependency of a project lives in the
 * `node_modules` of that project, and a global installation lives in
 * the global root of npm — so the message can name the command of
 * that installation instead of leaving the reader with two commands to
 * choose from.
 *
 * The test is about the text, and it fails when the text does not name
 * the command of the installation the launcher is in.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import { noBuildText, reinstallCommand } from '../bin/entry.mjs';

/** The command of a project install, as the message writes it. */
const PROJECT_COMMAND = '"npm install @malarstrom/gatewarden"';
/** The command of a global install, as the message writes it. */
const GLOBAL_COMMAND = '"npm install -g @malarstrom/gatewarden"';

/**
 * The URL of a launcher in an installation.
 *
 * The file itself does not have to exist: the launcher reads its own
 * path and the manifest next to it, and nothing else.
 *
 * @param root the directory the installation lives in
 * @returns the URL of the launcher
 */
function launcherIn(root: string): string {
  return pathToFileURL(path.join(root, 'node_modules', '@malarstrom', 'gatewarden', 'bin', 'gatewarden.js')).href;
}

/**
 * The URL of a launcher in the virtual store of pnpm.
 *
 * pnpm links the packages of a project into a store inside the
 * `node_modules` of the project, and the launcher of an installation
 * through pnpm lies in the store.
 *
 * @param project the directory of the project
 * @param reference the reference of the package in the store
 * @returns the URL of the launcher
 */
function launcherInStore(project: string, reference: string): string {
  return pathToFileURL(
    path.join(
      project,
      'node_modules',
      '.pnpm',
      reference,
      'node_modules',
      '@malarstrom',
      'gatewarden',
      'bin',
      'gatewarden.js',
    ),
  ).href;
}

/**
 * A project with a manifest of its own.
 *
 * @param t the test context, which removes the directory afterwards
 * @returns the directory of the project
 */
function projectDirectory(t: TestContext): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'package.json'), '{ "name": "reader" }\n');
  return project;
}

describe('the message about a missing build', () => {
  test('a launcher in a project names the command of a project install', (t) => {
    // A project keeps the manifest of the project next to the
    // `node_modules` its dependencies live in.
    const project = projectDirectory(t);
    const launcher = launcherIn(project);
    const text = noBuildText(launcher);

    assert.equal(reinstallCommand(launcher), 'npm install @malarstrom/gatewarden');
    assert.ok(text.includes(PROJECT_COMMAND), 'the message does not name the command of a project install');
    assert.ok(!text.includes(GLOBAL_COMMAND), 'the message names the command of a global install as well');
    assert.match(text, /the installed package has no build/, 'the message does not say that the installation is incomplete');
  });

  test('a launcher in the virtual store of pnpm names the command of a project install', (t) => {
    // pnpm links the packages of a project into a store inside the
    // `node_modules` of the project. The launcher of the installation
    // lies in the store, and the store lies in the `node_modules` of
    // the project — a project install, and not a global one.
    const project = projectDirectory(t);
    const launcher = launcherInStore(project, '@malarstrom+gatewarden@0.1.1');
    const text = noBuildText(launcher);

    assert.equal(reinstallCommand(launcher), 'npm install @malarstrom/gatewarden');
    assert.ok(text.includes(PROJECT_COMMAND), 'the message does not name the command of a project install');
    assert.ok(!text.includes(GLOBAL_COMMAND), 'the message names the command of a global install as well');
  });

  test('a launcher in a node_modules is a dependency of a project', () => {
    // The plain rule of the task: a launcher that lies in a
    // `node_modules` is a dependency of a project. The global root of
    // npm is the one exception, and it is told apart by the name of
    // the directory above it.
    const launcher = launcherIn(path.join(os.tmpdir(), 'gatewarden-nowhere'));
    const text = noBuildText(launcher);

    assert.equal(reinstallCommand(launcher), 'npm install @malarstrom/gatewarden');
    assert.ok(text.includes(PROJECT_COMMAND), 'the message does not name the command of a project install');
    assert.ok(!text.includes(GLOBAL_COMMAND), 'the message names the command of a global install as well');
  });

  test('a launcher in the global root of npm names the command of a global install', () => {
    // npm keeps the packages of everybody in `<prefix>/lib/node_modules`
    // on POSIX and in `<prefix>\node_modules` on Windows, where the
    // prefix is the directory named `npm`. No manifest lies next to
    // them.
    const prefix = path.join(os.tmpdir(), 'gatewarden-prefix', 'lib');
    const launcher = launcherIn(prefix);
    const text = noBuildText(launcher);

    assert.equal(reinstallCommand(launcher), 'npm install -g @malarstrom/gatewarden');
    assert.ok(text.includes(GLOBAL_COMMAND), 'the message does not name the command of a global install');
    assert.ok(!text.includes(PROJECT_COMMAND), 'the message names the command of a project install as well');
    assert.match(text, /the installed package has no build/, 'the message does not say that the installation is incomplete');
  });

  test('a launcher outside every node_modules names the command of a global install', () => {
    // A launcher that lives outside a `node_modules` was not installed
    // as a dependency of a project, so it is a global installation.
    const standalone = path.join(os.tmpdir(), 'gatewarden-standalone', 'bin');
    const launcher = pathToFileURL(path.join(standalone, 'gatewarden.js')).href;
    const text = noBuildText(launcher);

    assert.equal(reinstallCommand(launcher), 'npm install -g @malarstrom/gatewarden');
    assert.ok(text.includes(GLOBAL_COMMAND), 'the message does not name the command of a global install');
    assert.ok(!text.includes(PROJECT_COMMAND), 'the message names the command of a project install as well');
  });

  test('the message names one command and not two', (t) => {
    // A reader has to be able to run the command that is written
    // down, so the message carries the command of the installation and
    // nothing else.
    const project = projectDirectory(t);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-other-'));
    t.after(() => fs.rmSync(other, { recursive: true, force: true }));

    for (const root of [project, other]) {
      const text = noBuildText(launcherIn(root));
      const commands = [PROJECT_COMMAND, GLOBAL_COMMAND].filter((command) => text.includes(command));

      assert.equal(commands.length, 1, `the message names ${commands.length} commands`);
    }
  });
});
