/**
 * Logger — port owned by the extension, implemented by an adapter in
 * `src/adapters/logger.ts`. The contract intentionally does not bind to
 * `vscode.LogOutputChannel`; the adapter translates this minimal surface
 * to whatever the host offers. Payloads passed to the logger must be
 * redacted by callers — the API key, Authorization header, and full
 * request/response bodies must never reach the log channel.
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
}
