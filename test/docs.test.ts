/**
 * The skill, the agent instructions and the documentation (S7, §8).
 *
 * Two acceptance criteria live here:
 *
 *   - the skill's front matter validates against the Agent Skills
 *     specification (the rules the reference implementation of the
 *     specification — `skills-ref` — enforces);
 *   - the README's quick start works from a clean install: the package is
 *     packed, unpacked into a directory that looks like an installed
 *     package, and the commands of the quick start are run from it.
 *
 * The second one is the one that catches a documentation that describes an
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

/** The commands the CLI has and the README documents. */
const CLI_COMMANDS = [
  'register',
  'unregister',
  'list',
  'status',
  'config',
  'setup',
  'start',
  'stop',
  'doctor',
  'install-service',
];

/**
 * Every command the CLI has.
 *
 * `migrate` is a command of the CLI and is documented in docs/setup.md,
 * not in the README.
 */
const KNOWN_COMMANDS = new Set([...CLI_COMMANDS, 'version', 'help', 'migrate']);

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

/**
 * The kinds of line a markdown text holds.
 *
 * - `prose` is running text, or a row of a table;
 * - `list` is an item of a list;
 * - `quote` is a quotation: the words of somebody else;
 * - `code` is a line of a code block.
 */
type LineKind = 'prose' | 'list' | 'quote' | 'code';

interface MarkdownLine {
  kind: LineKind;
  text: string;
}

/**
 * The lines of a markdown text, with the kind of each one.
 *
 * The lines of a fenced block and of an indented block are code, and
 * they are kept: a block can hold a command. Every other line is
 * prose, a list item or a quotation.
 */
function markdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let fence = '';
  let indented = false;
  let blank = true;

  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = (fenceMatch[1] as string)[0] as string;
      if (fence === '') fence = marker;
      else if (fence === marker) fence = '';
      indented = false;
      blank = true;
      continue;
    }

    if (fence !== '') {
      // Inside a fenced block.
      indented = false;
      blank = true;
      lines.push({ kind: 'code', text: line });
      continue;
    }

    if (indented) {
      if (line.trim() === '' || /^ {4}/.test(line)) {
        // Inside an indented block.
        blank = true;
        lines.push({ kind: 'code', text: line });
        continue;
      }
      indented = false;
    }

    if (/^ {4,}\S/.test(line) && blank) {
      // The first line of an indented block.
      indented = true;
      blank = true;
      lines.push({ kind: 'code', text: line });
      continue;
    }

    blank = line.trim() === '';

    if (/^\s{0,3}>/.test(line)) {
      // A quotation is the words of somebody else.
      lines.push({ kind: 'quote', text: line });
      continue;
    }

    if (/^\s{0,3}(?:[-*+]|\d+[.)])\s+/.test(line)) {
      lines.push({ kind: 'list', text: line });
      continue;
    }

    lines.push({ kind: 'prose', text: line });
  }

  return lines;
}

/**
 * The text of a container without the markers that are not part of it:
 * the marker of a list item, the marker of a heading.
 */
function stripMarkers(text: string): string {
  return text.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)+/, '').trim();
}

/**
 * The command a text names, if it names one.
 *
 * The text has to start with the name of the CLI and a command word
 * after it. What follows the command word is the rest of the command:
 * its arguments, or nothing.
 */
function matchCommand(text: string): { word: string; rest: string } | undefined {
  const match = /^gatewarden\s+([a-z][a-z0-9-]*)(.*)$/.exec(text);
  if (match === null) return undefined;

  const rest = match[2] as string;
  // `gatewarden something.js` is a file name, not a command.
  if (rest.startsWith('.')) return undefined;

  return { word: match[1] as string, rest };
}

/**
 * Whether what follows a command describes it.
 *
 * A description is separated from the command by a dash or a colon. The
 * arguments of a command are flags, and they start with a dash too.
 */
function isDescription(rest: string): boolean {
  return /^[-–—:](\s|$)/.test(rest) || /^--/.test(rest);
}

/**
 * The command a line of prose documents, if it documents one.
 *
 * A line of prose documents a command when it holds nothing but the
 * command: an inline code span, or the plain text of the command. A
 * sentence that mentions a command ("run `gatewarden doctor` to check
 * the installation") is prose, and prose does not document a command.
 */
function commandInProse(line: string): string | undefined {
  const text = stripMarkers(line);
  if (text === '') return undefined;

  const span = /^`([^`]+)`$/.exec(text);
  if (span !== null) return matchCommand(span[1] as string)?.word;

  const command = matchCommand(text);
  if (command === undefined) return undefined;
  // Without code formatting the line has to hold the command alone.
  if (command.rest.trim() !== '') return undefined;
  return command.word;
}

/**
 * The command a list item or a table cell documents, if it documents
 * one.
 *
 * Such a container names a thing, and the thing comes first: the
 * leading code span of the container holds the command, or the plain
 * text of the container starts with the command and what follows it
 * describes it ("- `gatewarden register` - register a dev server.").
 */
function commandInItem(item: string): string | undefined {
  const text = stripMarkers(item);
  if (text === '') return undefined;

  // The leading code span: the command the container is about.
  const span = /^`([^`]+)`/.exec(text);
  if (span !== null) return matchCommand(span[1] as string)?.word;

  // The plain text of the command, with a description after it.
  const command = matchCommand(text);
  if (command === undefined) return undefined;
  const rest = command.rest.trim();
  if (rest !== '' && !isDescription(rest)) return undefined;
  return command.word;
}

/**
 * The command a line of a code block calls, if it calls one.
 *
 * A call starts in the first column with the name of the CLI and a
 * command word after it. The other lines of a block are not calls:
 *
 *   - a line with a prompt ("$ gatewarden register") shows a session;
 *   - an indented line continues the line above it;
 *   - a line that names the CLI and then a colon ("gatewarden: unknown
 *     command") is the output of a command.
 */
function commandInCodeLine(line: string): string | undefined {
  // A call starts in the first column: an indented line continues the
  // line above it.
  if (/^\s/.test(line)) return undefined;
  // A prompt shows a session, not a command the text documents.
  if (line.startsWith('$')) return undefined;
  // The name of the CLI and a command word after it. A line that names
  // the CLI and then a colon ("gatewarden: unknown command") is the
  // output of a command: the colon is where the command word would be.
  return matchCommand(line)?.word;
}

/**
 * The cells of a table row, or nothing when the line is not a row.
 */
function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return undefined;
  return trimmed.slice(1, -1).split('|');
}

/**
 * The commands a markdown text documents.
 *
 * The commands come from the places where the text presents a command as
 * one: a table cell, a list item, a line of prose that holds nothing but
 * the command, and the calls of a code block. A mention in a sentence and
 * a quotation are left out.
 *
 * The words come back in the order they appear, with the repetitions
 * removed.
 */
function documentedCommands(markdown: string): string[] {
  const words: string[] = [];

  const add = (word: string | undefined): void => {
    if (word !== undefined && !words.includes(word)) words.push(word);
  };

  for (const line of markdownLines(markdown)) {
    // A quotation is the words of somebody else, not a command of the
    // CLI.
    if (line.kind === 'quote') continue;

    if (line.kind === 'code') {
      add(commandInCodeLine(line.text));
      continue;
    }

    if (line.kind === 'list') {
      add(commandInItem(line.text));
      continue;
    }

    const cells = tableCells(line.text);
    if (cells === undefined) {
      add(commandInProse(line.text));
      continue;
    }

    for (const cell of cells) add(commandInItem(cell));
  }

  return words;
}

/** The commands a markdown text documents that the CLI does not have. */
function unknownCommands(markdown: string, known: Set<string>): string[] {
  return documentedCommands(markdown).filter((command) => !known.has(command));
}

/**
 * The message the check gives when a text documents a command the CLI
 * does not have.
 */
function unknownCommandMessage(file: string, commands: string[]): string {
  const names = commands.map((command) => `"gatewarden ${command}"`).join(', ');
  return `${file} documents a command the CLI does not have: ${names}`;
}

test('the README documents every command the CLI has', () => {
  const readme = fs.readFileSync(README, 'utf8');

  for (const command of CLI_COMMANDS) {
    assert.match(readme, new RegExp(`gatewarden ${command}\\b`), `the README does not document "gatewarden ${command}"`);
  }

  // Every command the README documents has to be a command the CLI has.
  const unknown = unknownCommands(readme, KNOWN_COMMANDS);
  assert.deepEqual(unknown, [], unknownCommandMessage('the README', unknown));

  // The check has to see the commands the README documents. Without this
  // it would pass on an empty list.
  const documented = documentedCommands(readme);
  for (const command of CLI_COMMANDS) {
    assert.ok(
      documented.includes(command),
      `the README does not document "gatewarden ${command}" as a command of its own`,
    );
  }
});

test('the command check reads the commands, not the quoted output', () => {
  const markdown = [
    '## The CLI',
    '',
    '| Command | What it does |',
    '| --- | --- |',
    '| `gatewarden status` | Show the daemon state. |',
    '',
    'The output of a command that does not exist looks like this:',
    '',
    '```text',
    '$ gatewarden frobnicate',
    'gatewarden: unknown command "frobnicate"',
    '```',
    '',
    'A sentence that mentions a command is prose, not documentation:',
    '',
    'Run `gatewarden doctor` to check the installation.',
    '',
    'Run `gatewarden frobnicate` to see the error.',
  ].join('\n');

  // The command of the table, and nothing else: the code block and the
  // two sentences are not documentation.
  assert.deepEqual(documentedCommands(markdown), ['status']);
  assert.deepEqual(unknownCommands(markdown, KNOWN_COMMANDS), []);
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

test('the command check reads a transcript in a code block as output', () => {
  const markdown = [
    '## The CLI',
    '',
    '```text',
    '$ gatewarden frobnicate',
    'gatewarden: unknown command "frobnicate"',
    '```',
  ].join('\n');

  assert.deepEqual(
    documentedCommands(markdown),
    [],
    'the command check reads the output of a command as a command',
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
    const known = ['register', 'unregister', 'list', 'status', 'config', 'setup', 'start', 'stop', 'doctor', 'install-service', 'migrate'];

    assert.ok(known.includes(command.split(' ')[1] as string), `"${command}" is not a command of the CLI`);
  });
});
