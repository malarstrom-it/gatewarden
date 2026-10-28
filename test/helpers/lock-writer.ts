/**
 * A writer that takes the lock around its write.
 *
 * The lock is a lock between *processes* (D10): two agent sessions
 * register at the same time, and they are two programs. A test that
 * runs two writers in one process proves nothing — the read-modify-write
 * of the store is synchronous, so the writers never interleave inside
 * it. This program is what the test spawns.
 *
 * Usage:
 *
 *   node lock-writer.ts <stateDir> <logFile> <label> <holdMs> [project] [count]
 *
 * The writer takes the lock, writes `<label>:start` to the log, writes
 * `count` routes (when a project is named), waits `holdMs`
 * milliseconds, and writes `<label>:end`.
 */

import { appendFileSync } from 'node:fs';

import { withRouteLock } from '../../src/core/lock.ts';
import { RegistrationStore } from '../../src/core/state.ts';

const [stateDir, logFile, label, holdRaw, project, countRaw] = process.argv.slice(2);
const holdMs = Number.parseInt(holdRaw ?? '0', 10);
const count = Number.parseInt(countRaw ?? '1', 10);

await withRouteLock(stateDir, async () => {
  appendFileSync(logFile, `${label}:start\n`);

  if (project) {
    const store = new RegistrationStore(stateDir);
    for (let index = 0; index < count; index += 1) {
      store.upsert({
        project: count > 1 ? `${project}-${index}` : project,
        branch: 'main',
        devPort: 3000 + index,
        zone: 'gwtest.local',
      });
    }
  }

  await new Promise((resolve) => setTimeout(resolve, holdMs));
  appendFileSync(logFile, `${label}:end\n`);
});
