/**
 * Simple logger with timestamps and levels
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

class Logger {
  private level: LogLevel = 'info';
  private useColors = true;

  setLevel(level: LogLevel) {
    this.level = level;
  }

  setColors(enabled: boolean) {
    this.useColors = enabled;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private log(level: LogLevel, message: string, ...args: any[]) {
    if (LEVELS[level] < LEVELS[this.level]) return;

    const timestamp = this.formatTimestamp();
    const prefix = this.useColors
      ? `${COLORS[level]}[${timestamp}] [${level.toUpperCase()}]${COLORS.reset}`
      : `[${timestamp}] [${level.toUpperCase()}]`;

    console.log(prefix, message, ...args);
  }

  debug(message: string, ...args: any[]) {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: any[]) {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.log('error', message, ...args);
  }
}

export const logger = new Logger();
