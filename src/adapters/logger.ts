import type * as vscode from 'vscode';
import type { Logger } from '../ports/logger.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * LoggerAdapter — wraps a `vscode.LogOutputChannel` and translates the
 * minimal `Logger` port to the host's structured logging surface. The
 * minimum level is supplied by the composition root from
 * `mightyMax.logLevel` and re-applied on `onDidChangeConfiguration`.
 *
 * The adapter also acts as a filter: messages below `minLevel` are
 * dropped before they reach the channel, so the channel's own
 * `Output → Log Level` user-controlled filter is the secondary gate.
 */
export class LoggerAdapter implements Logger {
  private minLevel: LogLevel;

  constructor(
    private readonly channel: vscode.LogOutputChannel,
    initialLevel: LogLevel = 'info',
  ) {
    this.minLevel = initialLevel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.allows('debug')) this.channel.debug(message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.allows('info')) this.channel.info(message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.allows('warn')) this.channel.warn(message, context);
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    // Always allow error; the filter is a minimum, not a maximum.
    const detail = error instanceof Error ? error : error !== undefined ? String(error) : undefined;
    if (detail) {
      this.channel.error(message, detail);
    } else {
      this.channel.error(message, context);
    }
  }

  private allows(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.minLevel];
  }
}
