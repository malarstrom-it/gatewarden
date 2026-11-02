/**
 * The lock around the route store.
 *
 * The store is written atomically: a reader never sees half a document.
 * That is not the same as being safe against a lost update. Two agent
 * sessions that register at the same time both read the store, both add
 * their route, and the second write drops the first one.
 *
 * The fix is a lock file around the read-modify-write. The lock is held
 * by the process that writes, and the write happens inside it:
 *
 *   await withRouteLock(stateDir, () => store.upsert({ … }));
 *
 * `proper-lockfile` does the locking. It creates the lock with a `mkdir`,
 * which is atomic on every filesystem that matters, and it removes the
 * lock when it is released. A lock whose holder died is *stale*: the lock
 * is older than the stale window, and the next writer takes it over. That
 * is why the lock is not a promise of exclusivity forever, and why a
 * crashed process cannot block the gateway for good.
 *
 * The lock is taken on the route store's path, in the state directory. The
 * file itself may not exist yet — a first registration creates it — so the
 * real path is not resolved (`realpath: false`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { lock } from 'proper-lockfile';

import { ROUTES_FILE } from './state.ts';

/** The name of the lock file that guards the route store. */
export const ROUTES_LOCK_FILE = `${ROUTES_FILE}.lock`;

/** The window after which a lock is considered stale, in milliseconds. */
const STALE_MS = 30_000;

/** How long a writer waits for a lock that another writer holds. */
const RETRIES = {
  retries: 60,
  factor: 1.5,
  minTimeout: 20,
  maxTimeout: 500,
  randomize: true,
};

export interface LockOptions {
  /** The window after which a lock is considered stale, in milliseconds. */
  stale?: number;
  /** How long to wait for a lock that another writer holds. */
  retries?: number;
}

/**
 * Run `fn` while the route store of `stateDir` is locked.
 *
 * The lock is released when `fn` returns, also when it throws.
 *
 * @param stateDir the state directory that holds the route store
 * @param fn the read-modify-write that has to be atomic
 */
export async function withRouteLock<T>(
  stateDir: string,
  fn: () => T | Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  fs.mkdirSync(stateDir, { recursive: true });

  const release = await lock(path.join(stateDir, ROUTES_FILE), {
    realpath: false,
    stale: options.stale ?? STALE_MS,
    update: Math.floor((options.stale ?? STALE_MS) / 2),
    retries: options.retries ?? RETRIES,
  });

  try {
    return await fn();
  } finally {
    await release();
  }
}
