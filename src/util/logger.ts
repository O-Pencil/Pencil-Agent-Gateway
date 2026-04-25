/**
 * Pencil Agent Gateway Logger
 *
 * [WHO]  Gateway developers
 * [FROM] All gateway modules
 * [TO]  Console/stdout
 * [HERE] Centralized logging with consistent formatting
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  setLevel(level: LogLevel | string): void {
    if (typeof level === 'string') {
      const upperLevel = level.toUpperCase();
      if (upperLevel in LogLevel) {
        this.level = LogLevel[upperLevel as keyof typeof LogLevel];
      }
    } else {
      this.level = level;
    }
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (level < this.level) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];
    const logLine = `[${timestamp}] ${levelName} ${message}`;

    if (meta && Object.keys(meta).length > 0) {
      console.log(logLine, JSON.stringify(meta, null, 2));
    } else {
      console.log(logLine);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, meta);
  }
}

// Export singleton instance
export const logger = new Logger();

// Also export the class for testing
export { Logger };
