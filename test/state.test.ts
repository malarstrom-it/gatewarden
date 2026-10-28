/**
 * The route store (§3.1).
 *
 * The store keeps the routes in the state directory, in a file that is
 * written atomically. The file was renamed to `routes.json`; a state
 * directory that still holds the old name is read from it, so that the
 * routes of an installation that ran before the rename are not lost.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RegistrationStore, ROUTES_FILE } from '../src/core/state.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dev-gateway-state-'));
}

test('the routes live in routes.json in the state directory', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = new RegistrationStore(dir);
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'gwtest.local' });

  assert.equal(store.file, path.join(dir, ROUTES_FILE));
  assert.equal(ROUTES_FILE, 'routes.json');
  assert.ok(fs.existsSync(path.join(dir, 'routes.json')));
  assert.equal(store.list().length, 1);
});

test('a state directory that still holds the old file name is read from it', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(dir, 'registrations.json'),
    JSON.stringify({
      version: 1,
      registrations: [
        {
          id: 'alpha/main',
          project: 'alpha',
          branch: 'main',
          projectSlug: 'alpha',
          branchSlug: 'main',
          fqdn: 'main.alpha.gwtest.local',
          devPort: 3000,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    }),
  );

  const store = new RegistrationStore(dir);

  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].fqdn, 'main.alpha.gwtest.local');

  // The first write creates the new file, and from then on it is the one
  // that is read.
  store.upsert({ project: 'beta', branch: 'main', devPort: 4000, zone: 'gwtest.local' });
  assert.ok(fs.existsSync(path.join(dir, 'routes.json')));
  assert.equal(store.list().length, 2);
});

test('the write is atomic: no half-written document is left behind', (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = new RegistrationStore(dir);
  store.upsert({ project: 'alpha', branch: 'main', devPort: 3000, zone: 'gwtest.local' });

  const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.tmp'));
  assert.deepEqual(leftovers, []);
});
