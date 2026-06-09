import * as vscode from 'vscode';
import type { Logger } from '../ports/logger.js';
import type { MiniMaxClient } from '../ports/minimax-client.js';
import type { ModelCatalog } from '../ports/model-catalog.js';
import type { SecretStore } from '../ports/secret-store.js';

/**
 * ChatProvider — implements `vscode.LanguageModelChatProvider` and is
 * registered under the `minimax` vendor in `src/extension.ts`.
 *
 * Implementation: T07. The provider shape is fixed now so T07 can fill
 * in the per-request wiring (catalog → MiniMax mapping → transport)
 * without restructuring. Every method throws until then.
 */
export class ChatProvider implements vscode.LanguageModelChatProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  constructor(
    _logger: Logger,
    _secretStore: SecretStore,
    _client: MiniMaxClient,
    _catalog: ModelCatalog,
  ) {
    // Fields are bound in T05–T07. The composition root passes real
    // adapters now so the type system catches wiring errors early.
  }

  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this.changeEmitter.event;

  provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
    throw new Error(
      'ChatProvider.provideLanguageModelChatInformation not implemented (see T02+T07)',
    );
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
    this.changeEmitter.dispose();
  }
}
