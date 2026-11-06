/**
 * The lock around the route store (D10).
 *
 * The store is written atomically, so a reader never sees half a
 * document. That is not the same as being safe against a lost update:
 * two writers that read the store at the same time and write at the same
 * time keep the route of the one that wrote last.
 *
 * The lock is what stops that, and it is a lock between *processes*:
 * two agent sessions are two programs, and they register at the same
 * time. Every test here therefore spawns processes — a test that runs
 * two writers in one process cannot fail, and a test that cannot fail
 * proves nothing.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROUTES_LOCK_FILE, withRouteLock } from '../src/core/lock.ts';
import { RegistrationStore } from '../src/core/state.ts';
import { makeTempDir } from './helpers/tempdir.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITER = path.join(REPO_ROOT, 'test', 'helpers', 'lock-writer.ts');

function makeStateDir(): string {
  return makeTempDir('gatewarden-lock-');
}

/** Spawn a writer and wait for it to finish. */
function runWriter(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRITER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(code);
      else reject(new Error(`the writer failed (${code}): ${stderr}`));
    });
  });
}

/** Wait until the log holds a line. */
async function waitForLine(logFile: string, line: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes(line)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the log never held "${line}"`);
}

test('the lock is released when the write is done', async () => {
  const dir = makeStateDir();
  try {
    await withRouteLock(dir, () => {
      assert.ok(fs.existsSync(path.join(dir, ROUTES_LOCK_FILE)), 'the lock was not taken');
    });

    assert.equal(
      fs.existsSync(path.join(dir, ROUTES_LOCK_FILE)),
      false,
      'the lock was not released',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the lock is released when the write throws', async () => {
  const dir = makeStateDir();
  try {
    await assert.rejects(
      withRouteLock(dir, () => {
        throw new Error('the write failed');
      }),
      /the write failed/,
    );

    assert.equal(
      fs.existsSync(path.join(dir, ROUTES_LOCK_FILE)),
      false,
      'the lock was not released',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('two processes do not write at the same time', async () => {
  const dir = makeStateDir();
  const log = path.join(dir, 'log.txt');

  try {
    // The first writer takes the lock and holds it for a second.
    const first = runWriter([dir, log, 'A', '1500']);

    // The second writer tries to take the lock while the first one holds
    // it. It has to wait: the lock is what keeps the two writes apart.
    await waitForLine(log, 'A:start');
    const second = runWriter([dir, log, 'B', '0']);

    await Promise.all([first, second]);

    const lines = fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);

    // Without the lock, the second writer would be inside its write
    // while the first one still holds it: 'B:start' would come before
    // 'A:end'.
    assert.deepEqual(lines, ['A:start', 'A:end', 'B:start', 'B:end'], 'the two writers were not kept apart');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writers in different processes keep every route', async () => {
  const dir = makeStateDir();
  const log = path.join(dir, 'log.txt');

  try {
    const writers = 8;
    const routesEach = 5;

    // Every writer registers its own routes, and they all start at the
    // same time: without the lock, the ones that read the store before
    // the others wrote drop the routes of the others.
    await Promise.all(
      Array.from({ length: writers }, (_unused, index) =>
        runWriter([dir, log, `writer-${index}`, '0', `writer-${index}`, String(routesEach)]),
      ),
    );

    const routes = new RegistrationStore(dir).list();

    assert.equal(
      routes.length,
      writers * routesEach,
      'a route was lost on the way to the store',
    );
    for (let index = 0; index < writers; index += 1) {
      for (let route = 0; route < routesEach; route += 1) {
        assert.ok(
          routes.some((entry) => entry.project === `writer-${index}-${route}`),
          `the route of writer-${index}-${route} is missing`,
        );
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
