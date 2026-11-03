/**
 * The documentation of the install scripts (S59).
 *
 * Three claims of the documentation are guarded here:
 *
 *   - the number of the install scripts the page counts with is the
 *     number the manifest of the package names;
 *   - the pages that speak about npm 11 and npm 12 say the same thing
 *     about them;
 *   - the scripts the manifest names point at files the package ships.
 *
 * The pages are the ones a reader of the package meets: the README, the
 * setup guide and `docs/install-scripts.md`. A page that counts the
 * scripts wrong sends the reader looking for a script that is not
 * there. A page that says npm 11 blocks where another page says npm 11
 * only warns sends the reader to the wrong npm. A manifest that names
 * a file the package does not ship breaks the install of every
 * consumer that installs the package.
 *
 * The numbers are read out of the documentation and not out of a list
 * this file carries: a guard that knows the answer itself cannot catch
 * the documentation drifting away from the manifest. The same holds for
 * the paths of the scripts and for the names of the scripts: they are
 * read out of `package.json` and out of the text of the page.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The manifest of the package. */
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** The page that counts the scripts of the installation. */
const SCRIPT_PAGE = 'docs/install-scripts.md';

/** The pages that speak about npm 11 and npm 12. */
const PAGES = ['README.md', 'docs/setup.md', 'docs/install-scripts.md'];

/** The npm versions the pages speak about. */
const VERSIONS = ['npm 11', 'npm 12'] as const;

/** An npm version a page speaks about. */
type Version = (typeof VERSIONS)[number];

/**
 * The lifecycle scripts npm runs when a package is installed.
 *
 * The names are npm's own, and not the project's: a manifest can name
 * them, and the documentation has to count the ones the manifest names.
 * `prepare` is one of them. It runs when a package comes from a git
 * repository and when it is packed, and the page counts it with the
 * install scripts.
 */
const INSTALL_LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'];

/**
 * The lifecycle scripts npm runs when a package is removed.
 *
 * The names are npm's own, like the ones above.
 */
const UNINSTALL_LIFECYCLE = ['preuninstall', 'uninstall', 'postuninstall'];

/** The numbers the English writes as words. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** The count of the scripts the page counts with. */
const TOTAL_COUNT = /(\w+)\s+scripts\b/g;

/** The count of the install scripts the page counts with. */
const INSTALL_COUNT = /(\w+)\s+install\s+scripts\b/g;

/** The count of the uninstall scripts the page counts with. */
const UNINSTALL_COUNT = /(\w+)\s+uninstall\s+scripts\b/g;

/**
 * A count the documentation writes, and where it stands.
 */
interface Count {
  /** The number the page writes. */
  count: number;
  /** The line the count stands on. */
  line: number;
  /** The text of the line. */
  text: string;
}

/**
 * A claim a page makes about what an npm version does with the scripts
 * of a dependency.
 */
interface Claim {
  /** The page that makes the claim. */
  page: string;
  /** The npm version the claim is about. */
  version: Version;
  /** What the page says npm does: it blocks the scripts, or it only warns. */
  stance: 'blocks' | 'warns';
  /** The line the claim stands on. */
  line: number;
  /** The text of the line. */
  text: string;
}

/**
 * A number the documentation writes.
 *
 * The documentation counts in words ("the two install scripts") and a
 * manifest counts in numbers. Both are read here, so that a page that
 * writes a digit instead of a word is read the same way.
 *
 * @param word the word or the digits
 * @returns the number, or nothing when the word is not a number
 */
function countIn(word: string): number | undefined {
  const text = word.trim().toLowerCase();

  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);

  return NUMBER_WORDS[text];
}

/**
 * The counts a page writes about the scripts.
 *
 * The counts are read out of the page, and not out of a list this file
 * carries: a guard that knows the answer itself cannot catch the page
 * drifting away from the manifest.
 *
 * @param text the text of the page
 * @param pattern the pattern that finds the counts
 * @returns the counts, in the order the page writes them
 */
function countsIn(text: string, pattern: RegExp): Count[] {
  const counts: Count[] = [];

  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      const count = countIn(match[1] ?? '');
      if (count === undefined) continue;
      counts.push({ count, line: index + 1, text: line.trim() });
    }
  });

  return counts;
}

/**
 * The names a text writes in backticks.
 *
 * @param text the text
 * @returns the names, in the order the text writes them
 */
function namesIn(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
}

/**
 * The names of the scripts the page gives in its first paragraph.
 *
 * The first paragraph is the one that tells the reader what the package
 * ships, so it is the one that has to count right.
 *
 * @param text the text of the page
 * @returns the names of the install scripts and of the uninstall scripts
 */
function namedScripts(text: string): { install: string[]; uninstall: string[] } {
  const paragraph =
    text
      .split(/\n\s*\n/)
      .find((part) => part.trim().length > 0 && !part.trim().startsWith('#')) ?? '';
  const install = /(?<!un)install scripts \(([^)]*)\)/.exec(paragraph);
  const uninstall = /uninstall scripts \(([^)]*)\)/.exec(paragraph);

  return {
    install: install ? namesIn(install[1] ?? '') : [],
    uninstall: uninstall ? namesIn(uninstall[1] ?? '') : [],
  };
}

/**
 * The scripts of the manifest that npm runs at a given moment.
 *
 * @param lifecycle the names of the lifecycle scripts of the moment
 * @returns the names of the scripts the manifest has, in alphabetical order
 */
function scriptsOf(lifecycle: string[]): string[] {
  return Object.keys(MANIFEST.scripts)
    .filter((name) => lifecycle.includes(name))
    .sort();
}

/**
 * A block of a page: the lines that stand together.
 */
interface Block {
  /** The lines of the block, with their numbers, starting at zero. */
  lines: number[];
  /** Is the block read? A heading and a block of output are not. */
  read: boolean;
}

/**
 * The lines of a page that stand inside a block of output.
 *
 * A block of output of npm is an example, and an example is not a claim
 * about what npm does, so nobody reads its lines.
 *
 * @param lines the lines of the page
 * @returns for every line: does it stand inside a block of output?
 */
function codeLines(lines: string[]): boolean[] {
  const inside: boolean[] = [];
  let fence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      inside.push(true);
      continue;
    }
    inside.push(fence);
  }

  return inside;
}

/**
 * The blocks of a page.
 *
 * A paragraph is a block, a list item is a block of its own, and a
 * table row is a block of its own. A heading and a block of output are
 * blocks that nobody reads: a heading names the subject, and an example
 * of the output of npm is not a claim about what npm does.
 *
 * @param lines the lines of the page
 * @returns the blocks, in the order they stand on the page
 */
function blocksOf(lines: string[]): Block[] {
  const code = codeLines(lines);
  const blocks: Block[] = [];
  let prose: number[] = [];
  let output: number[] = [];

  const flushProse = (): void => {
    if (prose.length > 0) blocks.push({ lines: prose, read: true });
    prose = [];
  };
  const flushOutput = (): void => {
    if (output.length > 0) blocks.push({ lines: output, read: false });
    output = [];
  };

  lines.forEach((line, index) => {
    if (code[index]) {
      flushProse();
      output.push(index);
      return;
    }
    flushOutput();

    if (line.trim().length === 0) {
      flushProse();
      return;
    }
    if (/^\s*#/.test(line)) {
      flushProse();
      blocks.push({ lines: [index], read: false });
      return;
    }
    if (/^\s*\|/.test(line)) {
      flushProse();
      blocks.push({ lines: [index], read: true });
      return;
    }
    if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      flushProse();
      prose.push(index);
      return;
    }
    prose.push(index);
  });
  flushProse();
  flushOutput();

  return blocks;
}

/**
 * The sentences of a block, with the line each of them starts on.
 *
 * A sentence ends at a full stop, a question mark or an exclamation
 * mark, and the ones inside a number are not ends: "npm 11.18" holds
 * one sentence, and "npm 11.18." ends one.
 *
 * @param block the block of the page
 * @param lines the lines of the page
 * @returns the sentences, in the order they stand on the page
 */
function sentencesOf(block: Block, lines: string[]): Array<{ text: string; line: number }> {
  const text = block.lines.map((index) => lines[index] ?? '').join('\n');
  const first = block.lines[0] ?? 0;
  const sentences: Array<{ text: string; line: number }> = [];
  let start = 0;

  const push = (from: number, to: number): void => {
    const sentence = text.slice(from, to).trim();
    if (sentence.length === 0) return;
    const line = first + text.slice(0, from).split('\n').length - 1;
    sentences.push({ text: sentence, line });
  };

  for (const boundary of text.matchAll(/(?<=[.!?])\s+/g)) {
    const end = boundary.index ?? 0;
    push(start, end);
    start = end + boundary[0].length;
  }
  push(start, text.length);

  return sentences;
}

/**
 * A word a text claims with.
 */
interface ClaimWord {
  /** What the word claims: that npm blocks the scripts, or that it warns. */
  stance: 'blocks' | 'warns';
  /** Where the word stands in the text. */
  at: number;
}

/**
 * Is the word at a place negated?
 *
 * A word that is negated is not a claim: "prints no warning" says that
 * no warning comes, and it does not say that npm warns.
 *
 * @param text the text
 * @param at the place of the word
 * @returns true when the word is negated
 */
function negated(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 16), at).toLowerCase();

  return /\b(no|not|never|without)\s+$/.test(before);
}

/**
 * The words a text claims with, in the order they stand.
 *
 * The two ways of saying it are the two word families: `block` and
 * `warn`. A word that is negated is left out.
 *
 * @param text the text
 * @returns the claim words, in the order they stand
 */
function claimWords(text: string): ClaimWord[] {
  const words: ClaimWord[] = [];

  for (const match of text.matchAll(/\bblock(?:s|ed|ing)?\b/gi)) {
    const at = match.index ?? 0;
    if (negated(text, at)) continue;
    words.push({ stance: 'blocks', at });
  }
  for (const match of text.matchAll(/\bwarn(?:s|ed|ing)?\b/gi)) {
    const at = match.index ?? 0;
    if (negated(text, at)) continue;
    words.push({ stance: 'warns', at });
  }

  return words.sort((left, right) => left.at - right.at);
}

/**
 * The claims a page makes about npm 11 and npm 12.
 *
 * A page says what npm does with the install scripts of a dependency in
 * one of two ways: it blocks them, or it warns and lets them run. The
 * claim is read from the sentence, and not from the line: a line can
 * hold the end of one sentence and the start of the next, and the words
 * of the one have nothing to do with the words of the other.
 *
 * The word that belongs to a version is the one in the clause of that
 * version: the text between the name of the version before it and the
 * name of the version after it. "The install script does not run: under
 * npm 11 it is skipped, under npm 12 it is blocked" says that npm 12
 * blocks, because "blocked" stands in the clause of npm 12, and it
 * says nothing about npm 11, because its own clause holds no word of
 * either family.
 *
 * The first word of the clause is the claim of the clause: "npm 12
 * blocks the install scripts of a dependency until the dependency is
 * approved, and it names the package in a warning while it does"
 * blocks, because "blocks" stands first.
 *
 * The headings and the blocks of output of npm are left out. A heading
 * names the subject, and an example of the output of npm is not a claim
 * about what npm does.
 *
 * @param page the path of the page, relative to the repository
 * @returns the claims the page makes
 */
function claimsIn(page: string): Claim[] {
  const lines = fs.readFileSync(path.join(REPO_ROOT, page), 'utf8').split('\n');
  const claims: Claim[] = [];

  for (const block of blocksOf(lines)) {
    if (!block.read) continue;

    for (const sentence of sentencesOf(block, lines)) {
      const mentions = [...sentence.text.matchAll(/npm\s+(11|12)(?![\d])/g)]
        .map((match) => ({ version: `npm ${match[1] ?? ''}` as Version, at: match.index ?? 0, length: match[0].length }))
        .filter((mention) => (VERSIONS as readonly string[]).includes(mention.version));
      if (mentions.length === 0) continue;

      const seen = new Set<Version>();
      for (let index = 0; index < mentions.length; index += 1) {
        const mention = mentions[index];
        if (!mention || seen.has(mention.version)) continue;
        seen.add(mention.version);

        // The clause of the mention: the text between the mention before
        // it and the mention after it.
        const previous = mentions[index - 1];
        const next = mentions[index + 1];
        const from = previous ? previous.at + previous.length : 0;
        const to = next ? next.at : sentence.text.length;
        const words = claimWords(sentence.text.slice(from, to));
        if (words.length === 0) continue;

        claims.push({
          page,
          version: mention.version,
          stance: words[0].stance,
          line: sentence.line + 1,
          text: sentence.text,
        });
      }
    }
  }

  return claims;
}

/**
 * The path of a file, the way the tarball writes it.
 *
 * A script may name a file the way the shell reads it, and
 * "./scripts/postinstall.mjs" is the same file as
 * "scripts/postinstall.mjs". The tarball writes the path without the
 * leading "./", so the paths are compared in one shape.
 *
 * @param file the path of the file
 * @returns the path, relative to the root of the package
 */
function packagePath(file: string): string {
  const parts: string[] = [];

  for (const part of file.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join('/');
}

/**
 * The files a script of the manifest points at.
 *
 * A script that runs another script of the manifest is followed: the
 * files it points at are the files of the other script. The names are
 * read out of the manifest, and not out of a list this file carries.
 *
 * @param name the name of the script
 * @param seen the scripts that were followed already
 * @returns the paths of the files the script points at
 */
function pathsOf(name: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(name)) return [];
  seen.add(name);

  const command = MANIFEST.scripts[name];
  if (command === undefined) return [];

  const files = [
    ...command.matchAll(/(?<![\w.-])([\w.-]+(?:\/[\w.-]+)*\.(?:mjs|cjs|json|tsx|ts|js|sh))(?![\w])/g),
  ].map((match) => match[1] ?? '');

  for (const run of command.matchAll(/npm\s+run(?:-script)?\s+([\w:.-]+)/g)) {
    files.push(...pathsOf(run[1] ?? '', seen));
  }

  return files;
}

/**
 * The files the tarball of the package holds.
 *
 * The list is the one `npm pack` writes, so the guard reads the files of
 * the package as npm packs them, and not as the manifest lists them.
 *
 * The scripts are not run: `prepare` builds the package, and a test must
 * not build the package while the other tests run — the build deletes
 * `dist/` before it writes it (CONTRIBUTING). The list of the files does
 * not depend on the build: the allow-list of the manifest names them.
 *
 * @returns the paths of the files, relative to the root of the package
 */
async function packedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: REPO_ROOT,
    timeout: 600_000,
    env: npmEnv(),
  });
  const packed = JSON.parse(stdout.slice(stdout.indexOf('['))) as Array<{ files: Array<{ path: string }> }>;

  return (packed[0]?.files ?? []).map((file) => file.path);
}

/**
 * The environment of a nested npm.
 *
 * The configuration of the npm that runs the test would otherwise leak
 * into the npm the test runs. npm reads its own configuration from the
 * rc files anyway, so the variables are dropped and the nested npm
 * starts clean.
 */
function npmEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_config_')) continue;
    if (key.startsWith('npm_lifecycle_') || key === 'npm_command' || key === 'npm_execpath') continue;
    if (value !== undefined) env[key] = value;
  }

  return env;
}

describe('the documentation of the install scripts', () => {
  let packed: string[] = [];

  before(async () => {
    packed = await packedFiles();
  });

  test('the page counts the scripts the manifest names', () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, SCRIPT_PAGE), 'utf8');
    const install = scriptsOf(INSTALL_LIFECYCLE);
    const uninstall = scriptsOf(UNINSTALL_LIFECYCLE);
    const total = [...install, ...uninstall].sort();
    const hits: string[] = [];

    // The total: how many scripts the package ships.
    const totals = countsIn(text, TOTAL_COUNT);
    assert.ok(totals.length > 0, `${SCRIPT_PAGE} counts no scripts at all, so the guard would read nothing`);
    for (const claim of totals) {
      if (claim.count === total.length) continue;
      hits.push(
        `${SCRIPT_PAGE}:${claim.line} counts ${claim.count} scripts ("${claim.text}"), and the manifest names ${total.length}: ${total.join(', ')}`,
      );
    }

    // The install scripts: the ones npm runs when it installs the
    // package.
    const installCounts = countsIn(text, INSTALL_COUNT);
    assert.ok(installCounts.length > 0, `${SCRIPT_PAGE} counts no install scripts at all, so the guard would read nothing`);
    for (const claim of installCounts) {
      if (claim.count === install.length) continue;
      hits.push(
        `${SCRIPT_PAGE}:${claim.line} counts ${claim.count} install scripts ("${claim.text}"), and the manifest names ${install.length}: ${install.join(', ')}`,
      );
    }

    // The uninstall scripts: the ones npm runs when it removes the
    // package.
    const uninstallCounts = countsIn(text, UNINSTALL_COUNT);
    assert.ok(uninstallCounts.length > 0, `${SCRIPT_PAGE} counts no uninstall scripts at all, so the guard would read nothing`);
    for (const claim of uninstallCounts) {
      if (claim.count === uninstall.length) continue;
      hits.push(
        `${SCRIPT_PAGE}:${claim.line} counts ${claim.count} uninstall scripts ("${claim.text}"), and the manifest names ${uninstall.length}: ${uninstall.join(', ')}`,
      );
    }

    // The names of the scripts: the page has to name the scripts the
    // manifest names, and no others.
    const named = namedScripts(text);
    assert.deepEqual(
      [...named.install].sort(),
      install,
      `${SCRIPT_PAGE} names the install scripts as ${named.install.join(', ') || '(none)'}, and the manifest names ${install.join(', ')}`,
    );
    assert.deepEqual(
      [...named.uninstall].sort(),
      uninstall,
      `${SCRIPT_PAGE} names the uninstall scripts as ${named.uninstall.join(', ') || '(none)'}, and the manifest names ${uninstall.join(', ')}`,
    );

    assert.deepEqual(hits, [], `${SCRIPT_PAGE} counts the scripts of the package wrong:\n${hits.join('\n')}`);
  });

  test('the pages say the same about npm 11 and npm 12', () => {
    const claims = PAGES.flatMap((page) => claimsIn(page));
    const hits: string[] = [];

    for (const version of VERSIONS) {
      const about = claims.filter((claim) => claim.version === version);
      const stances = new Set(about.map((claim) => claim.stance));
      if (stances.size <= 1) continue;

      for (const claim of about) {
        const says = claim.stance === 'blocks' ? 'blocks the scripts of the dependency' : 'only warns and lets the scripts run';
        hits.push(`${version}: ${claim.page}:${claim.line} says that ${version} ${says} ("${claim.text}")`);
      }
    }

    assert.deepEqual(
      hits,
      [],
      'the pages say different things about the same npm version:\n' + hits.join('\n'),
    );
  });

  test('the scripts of the manifest point at files the package ships', () => {
    const hits: string[] = [];

    // The three scripts that run on the machine of the consumer: the
    // package has to ship them, or the install and the uninstall of
    // every consumer break.
    for (const name of ['postinstall', 'preuninstall', 'postuninstall']) {
      const command = MANIFEST.scripts[name];
      assert.ok(command !== undefined, `the manifest has no ${name} script`);

      const files = pathsOf(name);
      assert.ok(files.length > 0, `the manifest points at no file with scripts.${name} ("${command}")`);

      for (const file of files) {
        if (packed.includes(packagePath(file))) continue;
        hits.push(`package.json scripts.${name} ("${command}") points at ${file}, and the package does not ship that file`);
      }
    }

    // `prepare` is the one script that does not run on the machine of
    // the consumer: npm runs it when the package comes from a git
    // repository and when it is packed, and the published package ships
    // the compiled output, so the build does not run for it. Its files
    // are the files of the repository, and the tarball does not have to
    // hold them.
    const prepare = MANIFEST.scripts['prepare'];
    assert.ok(prepare !== undefined, 'the manifest has no prepare script');

    const prepared = pathsOf('prepare');
    assert.ok(prepared.length > 0, `the manifest points at no file with scripts.prepare ("${prepare}")`);

    for (const file of prepared) {
      if (fs.existsSync(path.join(REPO_ROOT, packagePath(file)))) continue;
      hits.push(`package.json scripts.prepare ("${prepare}") points at ${file}, and the repository does not have that file`);
    }

    assert.deepEqual(
      hits,
      [],
      'the scripts of the manifest point at files that are not there:\n' + hits.join('\n'),
    );
  });
});
