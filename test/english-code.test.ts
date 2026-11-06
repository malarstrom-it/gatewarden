/**
 * The text of the code is English (S116).
 *
 * The repository is public, and every text in it is read by people who
 * do not read Swedish: the comments of the source, the doc comments,
 * the error messages, the log messages, the names of the tests and the
 * comments of the workflows. A text in another language is not wrong —
 * it is a text that the reader of the repository cannot use.
 *
 * This file is the guard against that. It reads the code of the
 * repository — the source, the tests, the scripts, the launchers, the
 * tools and the workflows — and it says what it found:
 *
 *   - a Swedish letter in any of the files: the letters that Swedish
 *     has and English has not;
 *   - a common Swedish word in any of the files.
 *
 * The words are read as whole words. A word inside another word is
 * English, and the guard has to say so: a guard that reads a part of a
 * word finds Swedish in every English text.
 *
 * The documents of the repository are not a part of this guard. The
 * rule of the task covers the code, and the documents are written by
 * another task.
 *
 * The guard reads itself as well, and that is why the words and the
 * letters of this file are written in a form that holds neither: the
 * letters as escapes, and the words with a dot between their letters.
 * A guard that found its own list would call itself a Swedish text.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The directories that hold the code of the repository.
 *
 * The list is written down here, and not read out of the repository,
 * because the code is what the rule of the task is about: the source,
 * the tests, the scripts, the launchers, the tools and the workflows.
 * A directory that is added to the repository later is added to this
 * list with it.
 */
const CODE_DIRECTORIES = ['src', 'test', 'scripts', 'bin', 'tools', '.github/workflows'];

/**
 * The letters that Swedish has and English has not.
 *
 * The letters are written as escapes, so that this file holds none of
 * them and the letter check can read this file as well.
 */
const SWEDISH_LETTERS = ['\u00e5', '\u00e4', '\u00f6', '\u00c5', '\u00c4', '\u00d6'];

/**
 * The words of a Swedish text.
 *
 * The list holds the words a Swedish text cannot do without. The
 * letters of every word stand with a dot between them, and the dots
 * are removed before the words are looked for: the file that holds the
 * list holds no Swedish word of its own.
 */
const SWEDISH_WORDS = [
  'o.c.h',
  'a.t.t',
  'd.e.t',
  's.o.m',
  'm.e.d',
  't.i.l.l',
  'i.n.t.e',
  'e.l.l.e.r',
  's.\u00e5',
  'h.\u00e4r',
  'm.\u00e5ste',
  's.k.a',
  'f.\u00f6rst',
  'e.f.t.e.r',
  'u.p.g.i.f.t',
  'r.a.p.p.o.r.t',
];

/**
 * A finding of the guard: a place in the code that holds Swedish.
 */
interface Finding {
  /** The file the finding is in, relative to the root of the repository. */
  file: string;
  /** The line the finding stands on, counted from one. */
  line: number;
  /** What was found: a letter or a word. */
  what: string;
}

/**
 * Every file of the code of the repository.
 *
 * The files are read out of the directories of the code, and not out
 * of a list of files: a file that is added to the code later is
 * checked as well.
 *
 * @returns the paths of the files, relative to the root of the repository
 */
function codeFiles(): string[] {
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
    }
  };

  for (const directory of CODE_DIRECTORIES) {
    const full = path.join(REPO_ROOT, directory);
    if (!fs.existsSync(full)) continue;
    walk(full);
  }

  return found.sort();
}

/**
 * The text of a file of the code, when the file holds text.
 *
 * A file that holds bytes that no text holds — an image, an archive —
 * is not a text, and the guard does not read it as one.
 *
 * @param file the path of the file, relative to the root of the repository
 * @returns the text of the file, or `undefined` when the file holds no text
 */
function textOf(file: string): string | undefined {
  const raw = fs.readFileSync(path.join(REPO_ROOT, file));
  if (raw.includes(0)) return undefined;
  return raw.toString('utf8');
}

/**
 * The Swedish letters a text holds.
 *
 * @param file the path of the file, relative to the root of the repository
 * @param text the text of the file
 * @returns the findings of the file
 */
function findLetters(file: string, text: string): Finding[] {
  const findings: Finding[] = [];

  text.split('\n').forEach((line, index) => {
    for (const letter of SWEDISH_LETTERS) {
      if (!line.includes(letter)) continue;
      findings.push({ file, line: index + 1, what: letter });
    }
  });

  return findings;
}

/**
 * The Swedish words a text holds.
 *
 * A word is a word of its own: the letters around it may not be
 * letters or digits, so that a word inside another word is not a
 * finding.
 *
 * @param file the path of the file, relative to the root of the repository
 * @param text the text of the file
 * @returns the findings of the file
 */
function findWords(file: string, text: string): Finding[] {
  const findings: Finding[] = [];

  const words = SWEDISH_WORDS.map((word) => word.replace(/\./g, '')).join('|');
  const matcher = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words})(?![\\p{L}\\p{N}_])`, 'giu');

  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(matcher)) {
      findings.push({ file, line: index + 1, what: match[0] });
    }
  });

  return findings;
}

/**
 * The findings of the guard, in a form a reader can act on.
 *
 * @param findings the findings of the guard
 * @returns one line per finding
 */
function report(findings: Finding[]): string {
  return findings.map((finding) => `${finding.file}:${finding.line}: "${finding.what}"`).join('\n');
}

describe('the text of the code', () => {
  test('the guard reads the code of the repository', () => {
    // A guard that reads nothing guards nothing. The directories of the
    // code have to be there, and the files of them have to be found.
    for (const directory of CODE_DIRECTORIES) {
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, directory)),
        `the directory ${directory} of the code is not in the repository`,
      );
    }

    const files = codeFiles();
    assert.ok(files.length > 0, 'the guard found no file of the code of the repository');
  });

  test('the code of the repository holds no Swedish letter', () => {
    const findings: Finding[] = [];

    for (const file of codeFiles()) {
      const text = textOf(file);
      if (text === undefined) continue;
      findings.push(...findLetters(file, text));
    }

    assert.deepEqual(findings, [], `the code holds Swedish letters:\n${report(findings)}`);
  });

  test('the code of the repository holds no Swedish word', () => {
    const findings: Finding[] = [];

    for (const file of codeFiles()) {
      const text = textOf(file);
      if (text === undefined) continue;
      findings.push(...findWords(file, text));
    }

    assert.deepEqual(findings, [], `the code holds Swedish words:\n${report(findings)}`);
  });
});
