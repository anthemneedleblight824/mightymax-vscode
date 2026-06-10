import * as vscode from 'vscode';
import { LoggerAdapter, type LogLevel } from './adapters/logger.js';
import { SecretStoreAdapter } from './adapters/secret-store.js';
import { MiniMaxClientAdapter } from './adapters/transport.js';
import { CatalogAdapter } from './adapters/catalog.js';
import { ChatProvider } from './providers/chat-provider.js';
import type { Logger } from './ports/logger.js';

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Composition root. Wires the four adapters (logger, secret store, transport,
 * catalog) and the chat provider, then registers them with VS Code. Every
 * disposable is pushed to `context.subscriptions` so deactivate is automatic.
 */
export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Mighty Max', { log: true });
  context.subscriptions.push(channel);

  const config = vscode.workspace.getConfiguration('mightyMax');
  const logLevelRaw = config.get<unknown>('logLevel');
  const initialLevel: LogLevel = isLogLevel(logLevelRaw) ? logLevelRaw : 'info';
  const DEFAULT_BASE_URL = 'https://api.minimax.io';
  // The baseUrl is read on every request via this callback so config
  // changes are honored without restarting the extension host.
  const baseUrl = (): string =>
    vscode.workspace.getConfiguration('mightyMax').get<string>('baseUrl') ?? DEFAULT_BASE_URL;

  const logger = new LoggerAdapter(channel, initialLevel);
  const secretStore = new SecretStoreAdapter(context.secrets);
  const client = new MiniMaxClientAdapter({ baseUrl });
  const catalog = new CatalogAdapter(logger);
  const chatProvider = new ChatProvider(logger, secretStore, client, catalog);

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('minimax', chatProvider),
    vscode.commands.registerCommand('mightyMax.manage', () => {
      logger.info('Mighty Max management command invoked');
      // TODO(T06): open the management QuickPick that reads/writes the
      // SecretStoreAdapter. The UI will prompt for the API key, validate it
      // against the MiniMax /models endpoint, and store it on success.
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('mightyMax.logLevel')) {
        const next = vscode.workspace.getConfiguration('mightyMax').get<unknown>('logLevel');
        if (isLogLevel(next)) {
          logger.setLevel(next);
          logger.info('Log level updated', { level: next });
        }
      }
      // baseUrl re-reads happen via the callback above; no action needed
      // here other than noting that the next request will pick up the
      // new value automatically.
    }),
  );

  // Expose a logger for downstream code without re-importing the adapter.
  context.subscriptions.push(
    vscode.Disposable.from({ dispose: () => logger.info('Mighty Max extension deactivated') }),
  );

  logger.info('Mighty Max extension activated', { vendor: 'minimax', baseUrl: baseUrl() });
}

export function deactivate(): void {
  // Disposables pushed to context.subscriptions are released automatically;
  // this function exists for vsce packaging and explicit shutdown hooks.
}

// Surface the Logger port as a public export so T02–T07 can re-use it
// without importing the adapter directly.
export type { Logger };
