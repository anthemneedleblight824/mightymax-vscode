/**
 * ModelCatalog — port for the static + dynamic list of MiniMax chat models
 * that this extension advertises to VS Code's chat model picker.
 *
 * The full catalog definition (T02) lives in `src/lib/domain/catalog.ts`;
 * this port is the seam between the domain (pure data + rules) and the
 * adapter that turns catalog entries into
 * `vscode.LanguageModelChatInformation[]` for `provideLanguageModelChatInformation`.
 */
export interface ModelInfo {
  /** Stable MiniMax model id used in API requests (e.g. "MiniMax-M3"). */
  id: string;
  /** Human-readable name shown in the picker (e.g. "M3 (MiniMax)"). */
  displayName: string;
  /** Vendor id used in the `languageModelChatProviders` contribution. */
  vendor: string;
  /** Family/grouping for picker UI ("m3", "m2", etc). */
  family: string;
  /** Maximum input token count for the model. */
  maxInputTokens: number;
  /** Maximum output token count for the model. */
  maxOutputTokens: number;
  /** Capability flags; `toolCalling` gates agent-mode eligibility. */
  capabilities: ModelCapabilities;
}

export interface ModelCapabilities {
  toolCalling: boolean;
  imageInput: boolean;
  /** Native thinking blocks (M3 exposes these on the Anthropic-compatible endpoint). */
  thinking: boolean;
}

export interface ModelCatalog {
  /** All models the extension supports. */
  listModels(): Promise<ReadonlyArray<ModelInfo>>;
  /** Lookup by id; returns undefined if the model is not in the catalog. */
  getModel(id: string): Promise<ModelInfo | undefined>;
}
