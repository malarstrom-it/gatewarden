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
 *
 * The log of a run stands in one file. The standard output is a file of
 * the installation when it is the log file itself or the copy the
 * rotation left behind, and a line goes to one of them only: a line that
 * stands in two files of the installation is a log that is in two places.
 */

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = LEVELS.info;

/** The handle of the log file, when the log is written to a file as well. */
let logHandle: number | null = null;

/** Whether the standard output is the log file: the log goes there alone. */
let standardOutputIsTheFile = false;

/** Whether the standard output is a copy of the log file: the log goes to the file alone. */
let standardOutputIsACopy = false;

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
 * The standard output decides where the line goes:
 *
 *   - it is the log file: the line goes to the standard output, and the
 *     file holds it. That is the daemon the CLI starts: the CLI opens the
 *     file and hands it to the daemon as its standard output.
 *   - it is a copy of the log file: the line goes to the file. That is the
 *     same daemon after the rotation at its start: the rotation moved the
 *     file, and the standard output kept the copy. The copy holds the
 *     lines of the run before it, and the log of this run stands in the
 *     log file alone.
 *   - it is anything else — the journal of the platform, the terminal of
 *     the user: the line goes to the standard output and to the file.
 *
 * @param file The log file, or `null` to write to the standard output only.
 * @param keep How many copies of the log file the rotation keeps.
 */
export function setLogFile(file: string | null, keep = 0): void {
  closeLogFile();
  standardOutputIsTheFile = false;
  standardOutputIsACopy = false;
  if (file === null) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const handle = fs.openSync(file, 'a');
    const out = standardOutputFile();
    if (out !== null) {
      if (sameFile(out, fs.fstatSync(handle))) {
        // The standard output is the log file: the log goes there.
        fs.closeSync(handle);
        standardOutputIsTheFile = true;
        return;
      }
      if (isCopyOfTheLogFile(out, file, keep)) {
        // The standard output is a copy of the log file: the log goes to
        // the file, and the copy keeps the lines of the run before it.
        standardOutputIsACopy = true;
      }
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
 * The stat of the standard output, when it is a regular file.
 *
 * The journal of the platform is a socket, and the terminal of the user
 * is a device: neither is a file of the installation.
 *
 * @returns The stat of the standard output, or `null`.
 */
function standardOutputFile(): fs.Stats | null {
  try {
    const out = fs.fstatSync(process.stdout.fd);
    return out.isFile() ? out : null;
  } catch {
    return null;
  }
}

/**
 * Are two files the same file?
 *
 * A machine that does not number its files cannot tell them apart.
 *
 * @param a The stat of one file.
 * @param b The stat of the other file.
 * @returns Whether they are the same file.
 */
function sameFile(a: fs.Stats, b: fs.Stats): boolean {
  if (a.ino === 0 || b.ino === 0) return false;
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Is the standard output a copy of the log file?
 *
 * The rotation keeps the copies next to the log file, and the standard
 * output of a daemon that the CLI started is the copy the rotation left
 * behind.
 *
 * @param out The stat of the standard output.
 * @param file The log file.
 * @param keep How many copies the rotation keeps.
 * @returns Whether the standard output is one of the copies.
 */
function isCopyOfTheLogFile(out: fs.Stats, file: string, keep: number): boolean {
  for (let index = 1; index <= keep; index += 1) {
    try {
      if (sameFile(out, fs.statSync(`${file}.${index}`))) return true;
    } catch {
      // There is no copy with that number.
    }
  }
  return false;
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
  if (!standardOutputIsACopy) process.stdout.write(line + '\n');
  if (!standardOutputIsTheFile) writeToLogFile(line + '\n');
}
