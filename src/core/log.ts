/**
 * The log of the daemon.
 *
 * A line goes to two places: the standard output and the log file.
 *
 * The standard output is the journal of the platform when the daemon runs
 * as a service, and the log file itself when the CLI starts the daemon:
 * the CLI opens the file and hands it to the daemon as its standard
 * output, and the two are then one stream.
 *
 * The journal of the platform is not a file a reader can open, so a daemon
 * that runs as a service writes to the log file as well: the file the CLI
 * points at holds the log, whatever started the daemon. The journal keeps
 * what it had.
 */

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = LEVELS.info;

/** The handle of the log file, when the log is written to a file as well. */
let logHandle: number | null = null;

/** Set the minimum level that is printed. */
export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level] ?? LEVELS.info;
}

/**
 * Write the log to a file as well as to the standard output.
 *
 * The file is the one the CLI opens: the rule that decides where the log
 * lives is `logFileFor`, and the daemon and the CLI use it both, so that
 * they agree on the file.
 *
 * A daemon whose standard output is the file writes to it once: the CLI
 * starts the daemon with the log file as its standard output, and a daemon
 * that wrote to the file as well would write every line twice.
 *
 * @param file The log file, or `null` to write to the standard output only.
 */
export function setLogFile(file: string | null): void {
  closeLogFile();
  if (file === null) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const handle = fs.openSync(file, 'a');
    if (standardOutputIs(handle)) {
      fs.closeSync(handle);
      return;
    }
    logHandle = handle;
  } catch {
    // A log file that cannot be opened is not a reason to stop the daemon:
    // the standard output is the log as well.
    logHandle = null;
  }
}

/** Close the log file, when one is open. */
function closeLogFile(): void {
  if (logHandle === null) return;
  try {
    fs.closeSync(logHandle);
  } catch {
    // The file is closed already.
  }
  logHandle = null;
}

/**
 * Is the standard output the file of the handle?
 *
 * The CLI starts the daemon with the log file as its standard output, so
 * the daemon writes to the file through the standard output. The journal
 * of the platform is not a file, and the standard output of a daemon that
 * runs as a service is not the log file.
 *
 * @param handle The handle of the log file.
 * @returns Whether the standard output is that file.
 */
function standardOutputIs(handle: number): boolean {
  try {
    const out = fs.fstatSync(process.stdout.fd);
    const file = fs.fstatSync(handle);
    if (!out.isFile() || !file.isFile()) return false;
    // A machine that does not number its files cannot tell them apart.
    if (out.ino === 0 || file.ino === 0) return false;
    return out.dev === file.dev && out.ino === file.ino;
  } catch {
    return false;
  }
}

/** Write a line to the log file, when there is one. */
function writeToLogFile(line: string): void {
  if (logHandle === null) return;
  try {
    fs.writeSync(logHandle, line);
  } catch {
    // A log file that cannot be written is not a reason to stop the daemon.
  }
}

/** Log a line to the standard output and to the log file. */
export function log(level: LogLevel, scope: string, message: string, extra?: unknown): void {
  if ((LEVELS[level] ?? 0) < threshold) return;
  const stamp = new Date().toISOString();
  let line = `${stamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (extra !== undefined) {
    try {
      line += ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra));
    } catch {
      line += ' [unserialisable]';
    }
  }
  process.stdout.write(line + '\n');
  writeToLogFile(line + '\n');
}
// en rad som aer ingenting
