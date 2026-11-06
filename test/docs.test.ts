/**
 * The skill, the agent instructions and the documentation (S7, §8).
 *
 * Three acceptance criteria live here:
 *
 *   - the skill's front matter validates against the Agent Skills
 *     specification (the rules the reference implementation of the
 *     specification — `skills-ref` — enforces);
 *   - every document the package ships documents only commands the CLI
 *     has: the README, the documents of `docs/`, and the skill with its
 *     reference files. The rules of the check are in
 *     `helpers/commands.ts`, and the list of the commands the CLI has
 *     comes from the source of the CLI;
 *   - the README's quick start works from a clean install: the package is
 *     packed, unpacked into a directory that looks like an installed
 *     package, and the commands of the quick start are run from it.
 *
 * The last one is the one that catches a documentation that describes an
 * installation nobody can get. The install is hermetic: a temporary
 * directory, free ports the OS hands out, and the dependency copied from
 * the checkout. Nothing touches the installation of the user.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import { copyDependencyClosure } from './helpers/install.ts';
import {
  cliCommands,
  documentedCommands,
  documentName,
  shippedDocuments,
  unknownCommandMessage,
  unknownCommands,
  unknownCommandsInFile,
} from './helpers/commands.ts';
import { promisify } from 'node:util';
import { listenHost } from '../src/core/config.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(REPO_ROOT, 'skills', 'gatewarden');
const SKILL_FILE = path.join(SKILL_DIR, 'SKILL.md');
const README = path.join(REPO_ROOT, 'README.md');
const AGENTS = path.join(REPO_ROOT, 'docs', 'AGENTS.md');

/**
 * The front matter fields the Agent Skills specification allows.
 *
 * The list is the one the reference implementation enforces: a field
 * outside it makes the skill invalid, even when the harness that reads it
 * would not care.
 */
const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
]);

/**
 * Every command the CLI has.
 *
 * The list comes from the source of the CLI, not from a list in this
 * test: a list in a test is wrong the moment the CLI gets a command.
 */
const CLI_COMMANDS = cliCommands();

/**
 * The commands the README has to document.
 *
 * `help` is the usage text of the CLI, not a command a reader runs, and
 * `migrate` is documented in docs/setup.md, next to the other commands
 * of the lifecycle. Every other command of the CLI belongs in the
 * README.
 */
const README_COMMANDS = CLI_COMMANDS.filter((command) => !['help', 'migrate'].includes(command));

/** Every command the CLI has: the names a document of the package may use. */
const KNOWN_COMMANDS = new Set(CLI_COMMANDS);

/**
 * The commands a markdown text documents that the CLI does not have,
 * and the message the check gives about them.
 */
function unknownWithMessage(markdown: string): { unknown: string[]; message: string } {
  const unknown = unknownCommands(markdown, KNOWN_COMMANDS);
  return { unknown, message: unknownCommandMessage('the README', unknown) };
}

/**
 * Read the YAML front matter of a skill.
 *
 * The parser is deliberately small: it reads the fields this package's
 * skill uses — a key, a value, and the continuation lines of a plain
 * scalar. It is not a YAML implementation, and it does not pretend to be
 * one: a front matter that uses something else fails here, loudly.
 */
function parseFrontMatter(content: string): { fields: Record<string, string>; body: string } {
  assert.ok(content.startsWith('---\n'), 'the file does not start with a front matter');
  const end = content.indexOf('\n---', 3);
  assert.ok(end !== -1, 'the front matter is never closed');

  const fields: Record<string, string> = {};
  let key: string | undefined;

  for (const line of content.slice(4, end).split('\n')) {
    if (line.trim().length === 0) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match && !/^\s/.test(line)) {
      key = match[1] as string;
      fields[key] = (match[2] as string).trim();
      continue;
    }
    assert.ok(key !== undefined, `the front matter holds a continuation line before any key: ${line}`);
    fields[key] = `${fields[key]} ${line.trim()}`.trim();
  }

  for (const [name, value] of Object.entries(fields)) {
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) fields[name] = quoted[2] as string;
  }

  return { fields, body: content.slice(end + 4).replace(/^\n/, '') };
}

/**
 * Ask the OS for a free TCP port.
 *
 * The port is asked for on the address the daemon binds: the daemon
 * listens on every address of the machine, and a port that is free on
 * the loopback address alone is not free for it.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, listenHost(), () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

test('the skill front matter validates against the Agent Skills specification', () => {
  const content = fs.readFileSync(SKILL_FILE, 'utf8');
  const { fields, body } = parseFrontMatter(content);

  // Only the fields the specification allows.
  for (const field of Object.keys(fields)) {
    assert.ok(ALLOWED_FIELDS.has(field), `the front matter holds an unknown field: ${field}`);
  }

  // The name.
  const name = fields['name'];
  assert.ok(name !== undefined && name.length > 0, 'the front matter has no name');
  assert.ok(name.length <= 64, `the name is longer than 64 characters: ${name.length}`);
  assert.equal(name, name.toLowerCase(), 'the name is not lower case');
  assert.ok(!name.startsWith('-') && !name.endsWith('-'), 'the name starts or ends with a hyphen');
  assert.ok(!name.includes('--'), 'the name holds two hyphens in a row');
  assert.match(name, /^[a-z0-9-]+$/, 'the name holds something else than letters, digits and hyphens');

  // The directory name is the portable choice: another implementation of
  // the specification may require the two to be the same.
  assert.equal(path.basename(SKILL_DIR), name, 'the directory name is not the name of the skill');

  // The description.
  const description = fields['description'];
  assert.ok(description !== undefined && description.trim().length > 0, 'the front matter has no description');
  assert.ok(description.length <= 1024, `the description is longer than 1024 characters: ${description.length}`);

  // The body.
  assert.ok(body.trim().length > 0, 'the skill has no instructions');
});

test('the skill names the MCP tool first and the CLI as the fallback', () => {
  const body = fs.readFileSync(SKILL_FILE, 'utf8');

  const tool = body.indexOf('publish_dev_server');
  const cli = body.indexOf('gatewarden register');
  assert.ok(tool !== -1, 'the skill does not mention the MCP tool');
  assert.ok(cli !== -1, 'the skill does not mention the CLI');
  assert.ok(tool < cli, 'the CLI comes before the MCP tool — the fallback is the first path');

  // The files the skill points at have to be there.
  for (const reference of ['references/troubleshooting.md', 'references/architecture.md']) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, reference)), `${reference} is missing`);
  }
});

test('the agent instructions are a short, portable block', () => {
  const text = fs.readFileSync(AGENTS, 'utf8');

  assert.match(text, /publish_dev_server/, 'the block does not name the MCP tool');
  assert.match(text, /gatewarden register/, 'the block does not name the CLI');
  assert.match(text, /Give the user the returned URL verbatim/, 'the block does not say to hand over the URL');
  assert.match(text, /Do not compose the host name yourself/, 'the block does not forbid composing the host name');
  assert.match(text, /remove_dev_server/, 'the block does not say to remove the route');

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  assert.ok(lines.length <= 40, `the block is ${lines.length} lines long — it is a block, not a document`);
});

test('the README documents every command the CLI has', () => {
  const readme = fs.readFileSync(README, 'utf8');

  for (const command of README_COMMANDS) {
    assert.match(readme, new RegExp(`gatewarden ${command}\\b`), `the README does not document "gatewarden ${command}"`);
  }

  // Every command the README documents has to be a command the CLI has.
  const unknown = unknownCommands(readme, KNOWN_COMMANDS);
  assert.deepEqual(unknown, [], unknownCommandMessage('the README', unknown));

  // The check has to see the commands the README documents. Without this
  // it would pass on an empty list.
  const documented = documentedCommands(readme);
  for (const command of README_COMMANDS) {
    assert.ok(
      documented.includes(command),
      `the README does not document "gatewarden ${command}" as a command of its own`,
    );
  }
});

test('every document the package ships documents only commands the CLI has', () => {
  const documents = shippedDocuments();

  // The check has to read the documents the package ships. Without this
  // it would pass on a list that holds nothing.
  for (const expected of ['README.md', 'docs/setup.md', 'skills/gatewarden/SKILL.md']) {
    assert.ok(
      documents.some((file) => documentName(file) === expected),
      `the check does not read ${expected}`,
    );
  }

  const seen = new Set<string>();
  for (const file of documents) {
    const unknown = unknownCommandsInFile(file, KNOWN_COMMANDS);
    assert.deepEqual(unknown, [], unknownCommandMessage(documentName(file), unknown));

    for (const command of documentedCommands(fs.readFileSync(file, 'utf8'))) seen.add(command);
  }

  // The check has to see the commands the documents document. Without
  // this it would pass on documents it does not read.
  assert.ok(seen.has('register'), 'the check does not see a single command of the documents');
});

test('the command check falls on a document outside the README', () => {
  // A document that is not the README can document a command the CLI
  // does not have, and the check has to fall on it. The document lives
  // outside the package, so the check of the package is not changed by
  // the test.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-command-check-'));
  const file = path.join(directory, 'healthcheck.md');

  try {
    fs.writeFileSync(
      file,
      ['# The healthcheck', '', '- `gatewarden frobnicate` - reports what is broken.', ''].join('\n'),
    );

    const unknown = unknownCommandsInFile(file, KNOWN_COMMANDS);
    assert.deepEqual(
      unknown,
      ['frobnicate'],
      'the command check does not fall on a document outside the README',
    );
    assert.equal(
      unknownCommandMessage(documentName(file), unknown),
      `${documentName(file)} documents a command the CLI does not have: "gatewarden frobnicate"`,
      'the message of the check does not name the document and the command',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the command check reads the commands, not the sentences that mention them', () => {
  const markdown = [
    '## The CLI',
    '',
    '| Command | What it does |',
    '| --- | --- |',
    '| `gatewarden status` | Show the daemon state. |',
    '',
    'A sentence that mentions a command is prose, not documentation:',
    '',
    'Run `gatewarden doctor` to check the installation.',
    '',
    'Run `gatewarden frobnicate` to see the error.',
  ].join('\n');

  // The command of the table, and nothing else: the two sentences are
  // not documentation.
  assert.deepEqual(documentedCommands(markdown), ['status']);
  assert.deepEqual(unknownCommands(markdown, KNOWN_COMMANDS), []);
});

test('the command check reads a sentence in a list item as prose', () => {
  const markdown = [
    '## The CLI',
    '',
    '- Run `gatewarden doctor` to check the installation.',
    '- Run `gatewarden frobnicate` to see the error.',
  ].join('\n');

  assert.deepEqual(
    unknownCommands(markdown, KNOWN_COMMANDS),
    [],
    'the command check reads a sentence in a list item as a command',
  );
});

test('the command check catches a documented command the CLI does not have', () => {
  const markdown = [
    '## The CLI',
    '',
    '| Command | What it does |',
    '| --- | --- |',
    '| `gatewarden register` | Register a dev server. |',
    '| `gatewarden frobnicate` | Do something the CLI cannot do. |',
  ].join('\n');

  assert.deepEqual(unknownCommands(markdown, KNOWN_COMMANDS), ['frobnicate']);
});

test('the command check reads a list item as a command', () => {
  const markdown = [
    '## The CLI',
    '',
    '- `gatewarden register` - register a dev server.',
    '- `gatewarden frobnicate` - do something the CLI cannot do.',
  ].join('\n');

  assert.deepEqual(
    unknownCommands(markdown, KNOWN_COMMANDS),
    ['frobnicate'],
    'the command check does not read a list item as a command',
  );
});

test('the command check reads a list item in plain text as a command', () => {
  const markdown = [
    '## The CLI',
    '',
    '- gatewarden register - register a dev server.',
    '- gatewarden frobnicate - do something the CLI cannot do.',
  ].join('\n');

  assert.deepEqual(
    unknownCommands(markdown, KNOWN_COMMANDS),
    ['frobnicate'],
    'the command check does not read a list item in plain text as a command',
  );
});

test('the command check reads a quotation as the words of somebody else', () => {
  const markdown = ['## The CLI', '', '> gatewarden frobnicate'].join('\n');

  assert.deepEqual(
    documentedCommands(markdown),
    [],
    'the command check reads a quotation as a command of the CLI',
  );
});

test('the command check reads a call in a code block as a command', () => {
  const markdown = [
    '## The CLI',
    '',
    '```bash',
    'gatewarden register --project my-app',
    'gatewarden frobnicate',
    '```',
  ].join('\n');

  assert.deepEqual(
    unknownCommands(markdown, KNOWN_COMMANDS),
    ['frobnicate'],
    'the command check does not read a call in a code block as a command',
  );
});

test('the command check reads the output of the CLI as a command it does not have', () => {
  // The CLI writes this line for a command it does not have
  // (src/cli/index.ts), so the line names a command the CLI lacks.
  const markdown = [
    '## The CLI',
    '',
    '```text',
    '$ gatewarden frobnicate',
    'error: unknown command "frobnicate"',
    '```',
  ].join('\n');

  const { unknown, message } = unknownWithMessage(markdown);
  assert.deepEqual(
    unknown,
    ['frobnicate'],
    'the command check does not read the output of the CLI as a command the CLI does not have',
  );
  assert.equal(
    message,
    'the README documents a command the CLI does not have: "gatewarden frobnicate"',
    'the message of the check does not name the command the CLI does not have',
  );
});

test('the command check reads an indented code block as a command', () => {
  const markdown = [
    '## The CLI',
    '',
    'A command in an indented block is a command:',
    '',
    '    gatewarden frobnicate',
    '',
  ].join('\n');

  const { unknown, message } = unknownWithMessage(markdown);
  assert.deepEqual(
    unknown,
    ['frobnicate'],
    'the command check does not read an indented code block as a command',
  );
  assert.equal(
    message,
    'the README documents a command the CLI does not have: "gatewarden frobnicate"',
    'the message of the check does not name the command the CLI does not have',
  );
});

test('the command check reads a code block in a list item as a command', () => {
  const markdown = [
    '## The CLI',
    '',
    '- Register a dev server:',
    '',
    '  ```bash',
    '  gatewarden frobnicate',
    '  ```',
    '',
  ].join('\n');

  const { unknown, message } = unknownWithMessage(markdown);
  assert.deepEqual(
    unknown,
    ['frobnicate'],
    'the command check does not read a code block in a list item as a command',
  );
  assert.equal(
    message,
    'the README documents a command the CLI does not have: "gatewarden frobnicate"',
    'the message of the check does not name the command the CLI does not have',
  );
});

test('the command check reads a list item with a description that starts with a point as a command', () => {
  const markdown = [
    '## The CLI',
    '',
    '- gatewarden register. Register a dev server.',
    '- gatewarden frobnicate. Do something the CLI cannot do.',
  ].join('\n');

  const { unknown, message } = unknownWithMessage(markdown);
  assert.deepEqual(
    unknown,
    ['frobnicate'],
    'the command check does not read a list item with a description that starts with a point as a command',
  );
  assert.equal(
    message,
    'the README documents a command the CLI does not have: "gatewarden frobnicate"',
    'the message of the check does not name the command the CLI does not have',
  );
});

test('the command check names the command the CLI does not have', () => {
  const markdown = ['- `gatewarden frobnicate` - do something the CLI cannot do.'].join('\n');
  const unknown = unknownCommands(markdown, KNOWN_COMMANDS);

  assert.equal(
    unknownCommandMessage('the README', unknown),
    'the README documents a command the CLI does not have: "gatewarden frobnicate"',
    'the message of the check does not name the command the CLI does not have',
  );
});

/** The quick start of the README: the commands between its two headings. */
function quickStart(): string {
  const readme = fs.readFileSync(README, 'utf8');
  const start = readme.indexOf('## Quick start');
  assert.ok(start !== -1, 'the README has no quick start');
  const end = readme.indexOf('\n## ', start + 3);
  return readme.slice(start, end === -1 ? readme.length : end);
}

test('the quick start names the commands it needs', () => {
  const section = quickStart();

  assert.match(section, /npm install -g @malarstrom\/gatewarden/, 'the quick start does not install the package');
  assert.match(section, /gatewarden setup/, 'the quick start does not set the gateway up');
  assert.match(section, /gatewarden register/, 'the quick start does not publish a dev server');
});

/**
 * The environment of a nested npm.
 *
 * The configuration of the npm that runs the test would otherwise leak
 * into the npm the test runs: `npm publish --dry-run` sets
 * `npm_config_dry_run`, and a nested npm that inherits it packs nothing.
 */
function npmEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_config_')) continue;
    if (key.startsWith('npm_lifecycle_') || key === 'npm_command' || key === 'npm_execpath') continue;
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** The register command of the quick start, as it is written there. */
function quickStartRegister(): string {
  const match = /^gatewarden register .*$/m.exec(quickStart());
  assert.ok(match, 'the quick start has no register command');
  return match[0].trim();
}

describe('the quick start from a clean install', () => {
  let workdir = '';
  let install = '';
  let home = '';
  let tarball = '';
  let manifest: { name: string; version: string } = { name: '', version: '' };

  before(async () => {
    manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };

    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatewarden-docs-'));

    // 1. Pack the package. `prepare` builds it, so the tarball carries the
    //    compiled output the package ships.
    const packed = await execFileAsync('npm', ['pack', '--pack-destination', workdir], {
      cwd: REPO_ROOT,
      timeout: 300_000,
      env: npmEnv(),
    });
    const name = packed.stdout.trim().split('\n').pop() as string;
    tarball = path.join(workdir, name);

    // 2. Unpack it into a directory that looks like an installed package:
    //    the package under node_modules, its dependency next to it, and the
    //    binary on the path.
    install = path.join(workdir, 'install');
    const modules = path.join(install, 'node_modules');
    const packageDir = path.join(modules, manifest.name);
    fs.mkdirSync(packageDir, { recursive: true });

    await execFileAsync('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'], {
      timeout: 120_000,
    });

    // The runtime dependencies, copied from the checkout: the install
    // stays offline and hermetic. The whole closure is copied, not only
    // the direct dependencies — `proper-lockfile` brings its own.
    copyDependencyClosure('env-paths', modules, REPO_ROOT);
    copyDependencyClosure('proper-lockfile', modules, REPO_ROOT);

    fs.mkdirSync(path.join(install, 'bin'), { recursive: true });
    fs.symlinkSync(
      path.join(packageDir, 'bin', 'gatewarden.js'),
      path.join(install, 'bin', 'gatewarden'),
    );

    // 3. A throwaway installation: free ports, its own state.
    home = path.join(workdir, 'home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify(
        {
          registryPort: await freePort(),
          relayPort: await freePort(),
          advertisedIp: '127.0.0.1',
          advertisedHost: '127.0.0.1',
          zone: 'gwtest.local',
          entryPoints: ['websecure'],
          certResolver: 'testca',
          stateDir: home,
          documentFormat: 'yaml',
        },
        null,
        2,
      ),
    );
  });

  after(async () => {
    if (workdir === '') return;
    // The daemon the quick start started has to go before the directory does.
    try {
      await execFileAsync(path.join(install, 'bin', 'gatewarden'), ['stop'], {
        env: { ...process.env, GATEWARDEN_HOME: home, XDG_CACHE_HOME: path.join(home, '.cache') },
        timeout: 30_000,
      });
    } catch {
      // The daemon was never started; nothing to stop.
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  test('the tarball carries the published contents', () => {
    const listing = fs.readdirSync(path.join(install, 'node_modules', manifest.name));

    for (const entry of ['dist', 'bin', 'scripts', 'skills', 'docs', 'README.md', 'LICENSE']) {
      assert.ok(listing.includes(entry), `the tarball does not carry ${entry}`);
    }
  });

  test('the installed binary runs', async () => {
    const { stdout } = await execFileAsync(path.join(install, 'bin', 'gatewarden'), ['--version'], {
      env: { ...process.env, GATEWARDEN_HOME: home, XDG_CACHE_HOME: path.join(home, '.cache') },
      timeout: 60_000,
    });

    assert.equal(stdout.trim(), manifest.version);
  });

  test('the quick start publishes a dev server', async () => {
    const command = quickStartRegister();

    const { stdout } = await execFileAsync(path.join(install, 'bin', 'gatewarden'), command.split(' ').slice(1), {
      env: { ...process.env, GATEWARDEN_HOME: home, XDG_CACHE_HOME: path.join(home, '.cache') },
      cwd: workdir,
      timeout: 120_000,
    });

    assert.match(stdout, /^registered /m, 'the register command did not report a registration');
    assert.match(stdout, /^url: https:\/\/main\.my-app\.gwtest\.local$/m, 'the register command printed no address');

    const listed = await execFileAsync(path.join(install, 'bin', 'gatewarden'), ['list', '--json'], {
      env: { ...process.env, GATEWARDEN_HOME: home, XDG_CACHE_HOME: path.join(home, '.cache') },
      timeout: 60_000,
    });
    const routes = (JSON.parse(listed.stdout) as { routes: Array<{ project: string; branch: string; url: string }> })
      .routes;

    assert.equal(routes.length, 1, 'the route of the quick start is not in the list');
    assert.equal(routes[0]?.project, 'my-app');
    assert.equal(routes[0]?.branch, 'main');
    assert.equal(routes[0]?.url, 'https://main.my-app.gwtest.local');
  });

  test('the quick start command is a command the CLI has', () => {
    const command = quickStartRegister();

    assert.ok(CLI_COMMANDS.includes(command.split(' ')[1] as string), `"${command}" is not a command of the CLI`);
  });
});
