/**
 * ChatProvider — implements `vscode.LanguageModelChatProvider` and is
 * registered under the `minimax` vendor in `src/extension.ts`.
 *
 * T02 wires the catalog adapter:
 *   - `provideLanguageModelChatInformation` reads the live catalog
 *     and maps each `ModelInfo` to a `vscode.LanguageModelChatInformation`.
 *   - `onDidChangeLanguageModelChatInformation` re-fires when the
 *     catalog reports a live-list change, so the picker refreshes.
 *
 * The streaming response (`provideLanguageModelChatResponse`) and
 * tokenizer (`provideTokenCount`) are filled in by T07.
 */

import * as vscode from 'vscode';

import type { Logger } from '../ports/logger.js';
import type { MiniMaxClient } from '../ports/minimax-client.js';
import type { ModelCatalog, ModelInfo } from '../ports/model-catalog.js';
import type { SecretStore } from '../ports/secret-store.js';

export class ChatProvider implements vscode.LanguageModelChatProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly logger: Logger,
    _secretStore: SecretStore,
    _client: MiniMaxClient,
    private readonly catalog: ModelCatalog,
  ) {
    // Forward catalog change events to the chat-provider change emitter
    // so the VS Code model picker refreshes when a new model lands in
    // the live list (e.g. a brand-new MiniMax model shows up in
    // `/v1/models`).
    this.disposables.push(
      this.catalog.onDidChange(() => {
        this.logger.debug('ChatProvider: catalog change forwarded to picker');
        this.changeEmitter.fire();
      }),
    );
  }

  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this.changeEmitter.event;

  /**
   * Public hook used by the composition root (extension.ts) to
   * re-fire the change event after the API key or base URL is
   * mutated through the manage command. Mirrors
   * `vscode.EventEmitter.fire` so callers don't need to reach into
   * the private emitter.
   *
   * Implementation: T06.
   */
  fireChange(): void {
    this.changeEmitter.fire();
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) return [];
    try {
      const entries = await this.catalog.listModels();
      if (token.isCancellationRequested) return [];
      const mapped = entries.map(toLanguageModelChatInformation);
      if (options.silent && mapped.length === 0) {
        this.logger.debug('ChatProvider: silent resolve with no catalog entries');
      }
      return mapped;
    } catch (err) {
      this.logger.error('ChatProvider: catalog read failed', err);
      throw err;
    }
  }

  provideLanguageModelChatResponse(
    _model: vscode.LanguageModelChatInformation,
    _messages: ReadonlyArray<vscode.LanguageModelChatRequestMessage>,
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    _progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    _token: vscode.CancellationToken,
  ): Thenable<void> {
    throw new Error('ChatProvider.provideLanguageModelChatResponse not implemented (see T07)');
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    _text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Thenable<number> {
    throw new Error('ChatProvider.provideTokenCount not implemented (see T07)');
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) d.dispose();
    this.changeEmitter.dispose();
  }
}

// -----------------------------------------------------------------------------
// Mapping: ModelInfo -> vscode.LanguageModelChatInformation
// -----------------------------------------------------------------------------

/**
 * Map a domain `ModelInfo` to the VS Code `LanguageModelChatInformation`
 * shape. Pure function — no I/O, no side effects — so it can be unit
 * tested independently of the chat provider.
 *
 * Per AGENTS.md: `capabilities.toolCalling = true` on every
 * agent-capable model is the gate that keeps the model in the agent
 * model picker. We forward `imageInput` from the domain capability.
 */
export function toLanguageModelChatInformation(
  entry: ModelInfo,
): vscode.LanguageModelChatInformation {
  return {
    id: entry.id,
    name: entry.displayName,
    family: entry.family,
    version: entry.thinkingStyle === 'anthropic' ? '1' : '0',
    maxInputTokens: entry.maxInputTokens,
    maxOutputTokens: entry.maxOutputTokens,
    tooltip: buildTooltip(entry),
    detail: entry.detail,
    capabilities: {
      imageInput: entry.capabilities.imageInput,
      toolCalling: entry.capabilities.toolCalling ? true : false,
    },
  };
}

function buildTooltip(entry: ModelInfo): string {
  const lines = [
    `${entry.displayName} (${entry.id})`,
    `Family: ${entry.family}`,
    `Context: ${entry.maxInputTokens.toLocaleString()} input / ${entry.maxOutputTokens.toLocaleString()} output`,
    `Thinking: ${entry.capabilities.thinking ? `yes (${entry.thinkingStyle})` : 'no'}`,
    `Image input: ${entry.capabilities.imageInput ? 'yes' : 'no'}`,
  ];
  return lines.join('\n');
}
