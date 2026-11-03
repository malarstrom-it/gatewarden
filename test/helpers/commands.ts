/**
 * The command check of the documents the package ships (S72).
 *
 * The check answers one question: does a document that the package ships
 * document a command the CLI does not have? The rules are the same for
 * every document — the README, the documents of `docs/`, the skill and
 * its reference files — so they live here, in one place, and every
 * document is read with them.
 *
 * The list of the commands the CLI has comes from the source of the CLI
 * (`src/cli/index.ts`), not from a list written in a test: a list in a
 * test can be wrong the moment the CLI gets a command.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_SOURCE = path.join(REPO_ROOT, 'src', 'cli', 'index.ts');

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
export function documentedCommands(markdown: string): string[] {
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
export function unknownCommands(markdown: string, known: Set<string>): string[] {
  return documentedCommands(markdown).filter((command) => !known.has(command));
}

/**
 * The message the check gives when a text documents a command the CLI
 * does not have.
 */
export function unknownCommandMessage(file: string, commands: string[]): string {
  const names = commands.map((command) => `"gatewarden ${command}"`).join(', ');
  return `${file} documents a command the CLI does not have: ${names}`;
}

/**
 * The index after the string that starts at `start`.
 *
 * A backslash escapes the next character, so an escaped quote does not
 * end the string.
 */
function endOfString(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

/**
 * The source of the CLI, with the block that starts at `start`.
 *
 * The block ends at the brace that closes it. A brace in a string or in
 * a comment is text, and it does not count.
 */
function blockAt(source: string, start: number): string {
  const open = source.indexOf('{', start);
  assert.ok(open !== -1, 'the block does not open');

  let depth = 0;
  let index = open;

  while (index < source.length) {
    const character = source[index] as string;
    const next = source[index + 1];

    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end + 1;
      continue;
    }

    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      index = endOfString(source, index, character);
      continue;
    }

    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }

    index += 1;
  }

  assert.fail('the block is never closed');
  return '';
}

/**
 * The commands the CLI has, read from the source of the CLI.
 *
 * Every command the CLI answers is a case of the switch in `main()`, or
 * a comparison before it (`version`). Reading them out of the source
 * keeps the list of the test from going stale: a command the CLI gets
 * tomorrow is known tomorrow, without a test that has to be changed
 * first.
 */
export function cliCommands(): string[] {
  const source = fs.readFileSync(CLI_SOURCE, 'utf8');
  const commands = new Set<string>();

  const switchStart = source.indexOf('switch (command)');
  assert.ok(switchStart !== -1, 'the CLI has no switch on the command');
  for (const match of blockAt(source, switchStart).matchAll(/case '([a-z][a-z0-9-]*)':/g)) {
    commands.add(match[1] as string);
  }

  // A command that is answered before the switch reaches it.
  for (const match of source.matchAll(/command === '([a-z][a-z0-9-]*)'/g)) {
    commands.add(match[1] as string);
  }

  assert.ok(commands.size > 0, 'the source of the CLI holds no command');
  return [...commands];
}

/**
 * The commands a document of the package documents that the CLI does not
 * have.
 *
 * The document is read with the rules of the check, the same rules that
 * every other document is read with.
 */
export function unknownCommandsInFile(file: string, known: Set<string>): string[] {
  return unknownCommands(fs.readFileSync(file, 'utf8'), known);
}

/**
 * The name of a document of the package, as a reader names it: the path
 * from the root of the checkout.
 */
export function documentName(file: string): string {
  const relative = path.relative(REPO_ROOT, file);
  return relative.startsWith('..') ? file : relative;
}

/**
 * The markdown files of a directory, and of the directories under it.
 */
function markdownFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }

  return files.sort();
}

/**
 * The documents the package ships that can name a command.
 *
 * The README, the documents of `docs/` and the skill with its reference
 * files. They are the documents the tarball carries, so a command they
 * document has to be a command the CLI has.
 */
export function shippedDocuments(): string[] {
  return [
    path.join(REPO_ROOT, 'README.md'),
    ...markdownFiles(path.join(REPO_ROOT, 'docs')),
    ...markdownFiles(path.join(REPO_ROOT, 'skills')),
  ];
}
