/**
 * The daemon of a service unit writes to the log file the CLI points at.
 *
 * A daemon that the CLI starts writes to the log file: the CLI opens the
 * file and hands it to the daemon as its standard output, and the two are
 * then one stream. A daemon that the unit of the platform starts writes
 * to the journal of the platform, and the journal is not a file a reader
 * can open: the log file the CLI points at stayed empty, and the reader
 * found an empty file where the log should be.
 *
 * The daemon of the service writes to the log file as well, and the
 * journal of the platform keeps what it had.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { serviceUnitFor } from '../src/cli/service.ts';
import { loadConfig } from '../src/core/config.ts';
import { ensureDaemon, logFilePath } from '../src/core/daemonControl.ts';
import { logFileFor } from '../src/core/paths.ts';
import { DAEMON, makeCliFixture } from './helpers/cli.ts';

/**
 * Wait until the file holds the line.
 *
 * The timeout is a backstop that keeps the test from running for ever,
 * not the thing the test waits for: the line is what the test asserts.
 *
 * @param file The file to read.
 * @param line The line the file has to hold.
 * @param timeoutMs How long to wait.
 * @returns Whether the file holds the line.
 */
async function waitForLine(file: string, line: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.readFileSync(file, 'utf8').includes(line)) return true;
    } catch {
      // The file is not there yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** How often a line stands in the log. */
function occurrences(content: string, line: string): number {
  return content.split('\n').filter((entry) => entry.includes(line)).length;
}

test('a daemon started by the service unit writes to the log file the CLI points at', async (t) => {
  const fixture = await makeCliFixture();

  const unit = serviceUnitFor({
    platform: 'linux',
    home: fixture.dir,
    daemonPath: DAEMON,
    configPath: fixture.configPath,
    stateDir: fixture.dir,
    nodePath: process.execPath,
  });

  // The unit runs the daemon with its standard output on the journal of
  // the platform: the journal is a stream, and not a file.
  const daemon = spawn(unit.command.command, unit.command.args, {
    env: {
      ...fixture.env,
      GATEWARDEN_CONFIG: fixture.configPath,
      GATEWARDEN_STATE_DIR: fixture.dir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let journal = '';
  daemon.stdout?.on('data', (chunk: Buffer) => {
    journal += chunk.toString();
  });
  daemon.stderr?.on('data', (chunk: Buffer) => {
    journal += chunk.toString();
  });

  t.after(async () => {
    await fixture.stopDaemon();
    daemon.stdout?.destroy();
    daemon.stderr?.destroy();
    daemon.unref();
    fixture.cleanup();
  });

  // The file the CLI points at.
  const config = loadConfig({ configPath: fixture.configPath, stateDir: fixture.dir });
  const logFile = logFilePath(config);
  assert.equal(logFile, logFileFor(fixture.dir), 'the CLI and the daemon do not open the same log file');

  const started = await waitForLine(logFile, '[daemon] daemon started');
  assert.ok(started, `the daemon of the service did not write to ${logFile}`);

  // The workers write to the same file: the reader of the log looks for
  // what they say.
  const workers = await waitForLine(logFile, '[worker] registry listening on');
  assert.ok(workers, 'the workers of the daemon did not write to the log file');

  // The journal of the platform keeps the log as well.
  assert.match(journal, /\[daemon\] daemon started/, 'the journal of the platform does not hold the log');
});

test('a daemon started by the CLI writes every line of the log once', async (t) => {
  const fixture = await makeCliFixture();

  t.after(async () => {
    await fixture.stopDaemon();
    fixture.cleanup();
  });

  // The CLI starts the daemon the way the lazy start does: the log file
  // is the standard output of the daemon.
  const config = loadConfig({ configPath: fixture.configPath, stateDir: fixture.dir });
  const started = await ensureDaemon(config, { configPath: fixture.configPath });
  assert.equal(started.started, true, `the daemon did not start: ${started.error ?? ''}`);

  const logFile = logFilePath(config);
  const written = await waitForLine(logFile, '[daemon] daemon started');
  assert.ok(written, `the daemon did not write to ${logFile}`);

  const content = fs.readFileSync(logFile, 'utf8');
  assert.equal(
    occurrences(content, '[daemon] daemon started'),
    1,
    'the daemon wrote the line of the log more than once',
  );
});
