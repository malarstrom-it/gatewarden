/** Tiny timestamped logger. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = LEVELS.info;

/** Set the minimum level that is printed. */
export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level] ?? LEVELS.info;
}

/** Log a line to stdout (the daemon redirects stdout to the log file). */
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
}
