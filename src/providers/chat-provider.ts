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
import type { MiniMaxClient, MiniMaxCompletionRequest } from '../ports/minimax-client.js';
import { MiniMaxClientError } from '../ports/minimax-client.js';
import type { ModelCatalog, ModelInfo } from '../ports/model-catalog.js';
import type { SecretStore } from '../ports/secret-store.js';
import type { ChatMessage, ChatMessageContentPart } from '../ports/message-mapping.js';
import { toLanguageModelTextPart, toLanguageModelToolCallPart } from '../ports/message-mapping.js';
import {
  mapRequestToMiniMax,
  mapStreamDeltaToResponseParts,
  isMessageMappingError,
} from '../lib/domain/messages.js';
import {
  mapToolsToMiniMax,
  mapToolModeToChoice,
  accumulatorSeed,
  accumulateToolCallDelta,
  finalizeAccumulator,
  isToolSchemaError,
} from '../lib/domain/tools.js';
import type { ChatTool, ChatToolMode } from '../ports/tool-schema.js';
import type { ThinkingStyle } from '../ports/model-catalog.js';

export class ChatProvider implements vscode.LanguageModelChatProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private disposables: vscode.Disposable[] = [];
  /**
   * Shadow cache of thinking blocks with signatures, keyed by a hash of
   * the assistant message content that preceded them. This cache bridges
   * the gap until LanguageModelThinkingPart lands in @types/vscode and
   * VS Code can persist thinking blocks in its own history. The cache
   * lifetime is the provider's lifetime (cleared on dispose).
   *
   * Key: hash of (text content + stringified tool calls) from the
   * assistant message. Value: {thinking, signature?}.
   */
  private readonly thinkingCache = new Map<string, { thinking: string; signature?: string }>();
  /**
   * Tool usage tracking for smart filtering. Maps tool names to call counts.
   * Used to prioritize frequently-used tools when filtering is enabled.
   */
  private readonly toolUsageStats = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    private readonly secretStore: SecretStore,
    private readonly client: MiniMaxClient,
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

    // In silent mode, only return models if we have an API key
    if (options.silent) {
      const hasKey = await this.secretStore.hasSecret('apiKey');
      if (!hasKey) {
        this.logger.debug('ChatProvider: silent resolve with no API key - returning []');
        return [];
      }
    }

    try {
      const entries = await this.catalog.listModels();
      if (token.isCancellationRequested) return [];
      const mapped = entries.map(toLanguageModelChatInformation);
      this.logger.debug('ChatProvider: returning catalog', {
        count: mapped.length,
        silent: options.silent,
      });
      return mapped;
    } catch (err) {
      this.logger.error('ChatProvider: catalog read failed', err);
      throw err;
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: ReadonlyArray<vscode.LanguageModelChatRequestMessage>,
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // Check for API key
    const apiKey = await this.secretStore.getSecret('apiKey');
    if (!apiKey) {
      throw new Error(
        'MiniMax API key not configured. Run "Manage Mighty Max (Set API Key)" to configure.',
      );
    }

    // Convert vscode messages to domain format
    const domainMessages = messages.map(vscodeToDomainMessage);

    // Inject cached thinking blocks into assistant messages
    const enrichedMessages = this.enrichWithThinking(domainMessages);

    // Get model info from catalog to determine thinking style
    const modelInfo = await this.catalog.getModel(model.id);
    const thinkingStyle: ThinkingStyle = modelInfo?.thinkingStyle ?? 'openai';
    // VSCode is deprecating the OpenAI method; always use Anthropic dialect
    const dialect = 'anthropic';

    // Map messages to MiniMax wire format (model first, then messages)
    const mappingResult = mapRequestToMiniMax({ id: model.id, thinkingStyle }, enrichedMessages);

    // Log any mapping warnings
    for (const warning of mappingResult.warnings) {
      if (isMessageMappingError(warning)) {
        this.logger.warn('Message mapping warning', { kind: warning.kind, warning });
      }
    }

    // Map tools to MiniMax format with smart filtering
    const allTools = options.tools?.map(vscodeToDomainTool) ?? [];

    // Extract user prompt for relevance scoring
    const userPrompt = messages
      .filter(m => m.role === vscode.LanguageModelChatMessageRole.User)
      .map(m => {
        const content = typeof m.content === 'string' ? m.content :
          m.content.map(p => p instanceof vscode.LanguageModelTextPart ? p.value : '').join(' ');
        return content;
      })
      .join(' ');

    // Apply smart filtering if configured
    const tools = this.filterTools(allTools, userPrompt);
    const miniMaxTools = tools.length > 0 ? mapToolsToMiniMax(tools) : undefined;

    // Convert vscode.LanguageModelChatToolMode to ChatToolMode
    let toolMode: ChatToolMode | undefined;
    if (options.toolMode === vscode.LanguageModelChatToolMode.Auto) {
      toolMode = 'auto';
    } else if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
      toolMode = 'required';
    }

    const toolChoice = toolMode !== undefined ? mapToolModeToChoice(toolMode) : undefined;

    // Build the request (conditionally include tools/toolChoice)
    const request: MiniMaxCompletionRequest = {
      model: model.id,
      messages: mappingResult.messages.filter((m) => m.role !== undefined),
      ...(miniMaxTools !== undefined ? { tools: miniMaxTools } : {}),
      ...(toolChoice !== undefined ? { toolChoice } : {}),
      stream: true,
      dialect,
    };

    this.logger.info('Starting streaming request', {
      model: model.id,
      dialect,
      messageCount: request.messages.length,
      toolCount: tools.length,
      toolMode,
      tools: tools.map(t => t.name),
    });

    try {
      // Set up tool-call accumulator
      let accumulatorState = accumulatorSeed();
      // Thinking accumulator for caching
      let currentThinking: { thinking: string; signature?: string } | undefined;
      // Text accumulator for cache key generation
      let currentText = '';
      // Tool call IDs accumulator for cache key generation
      const currentToolCallIds: string[] = [];

      // Convert CancellationToken to AbortSignal
      const abortController = new AbortController();
      const onCancel = token.onCancellationRequested(() => abortController.abort());

      try {
        // Stream the completion
        for await (const event of this.client.streamCompletion(
          request,
          apiKey,
          abortController.signal,
          this.logger,
        )) {
          if (token.isCancellationRequested) break;

          // Handle tool-call deltas
          if (event.toolCallDelta !== undefined) {
            const accumulated = accumulateToolCallDelta(accumulatorState, event.toolCallDelta);
            if (isToolSchemaError(accumulated)) {
              this.logger.warn('Tool call accumulation error', { error: accumulated });
            } else {
              accumulatorState = accumulated.state;
            }
          }

          // Map stream deltas to response parts (thinkingStyle, not model object)
          const parts = mapStreamDeltaToResponseParts(event, thinkingStyle);

          for (const part of parts) {
            // Skip MessageMappingError entries
            if (isMessageMappingError(part)) {
              this.logger.warn('Stream mapping error', { kind: part.kind, error: part });
              continue;
            }

            if (part.type === 'text') {
              currentText += part.value;
              this.logger.info('Text delta', { length: part.value.length, preview: part.value.substring(0, 100) });
              progress.report(toLanguageModelTextPart(part.value));
            } else if (part.type === 'thinking') {
              // Accumulate thinking content with signature for caching
              if (!currentThinking) {
                const accumulated: { thinking: string; signature?: string } = { thinking: part.value };
                if (part.signature) accumulated.signature = part.signature;
                currentThinking = accumulated;
              } else {
                currentThinking.thinking += part.value;
                if (part.signature) currentThinking.signature = part.signature;
              }
              this.logger.info('Thinking content', {
                length: part.value.length,
                hasSignature: !!part.signature,
                preview: part.value.substring(0, 100),
              });
            } else if (part.type === 'usage') {
              // Encode usage as a text part with a marker prefix so the host can introspect it
              const usageJson = JSON.stringify(part.usage);
              progress.report(toLanguageModelTextPart(`__minimax_usage__:${usageJson}`));
            }
          }

          // Handle finish reason
          if (event.finishReason !== undefined) {
            this.logger.info('Stream finished', {
              finishReason: event.finishReason,
              textLength: currentText.length,
              thinkingLength: currentThinking?.thinking.length ?? 0,
              toolCallCount: currentToolCallIds.length,
            });
          }
          if (event.finishReason === 'tool_calls') {
            // Finalize accumulated tool calls
            const finalized = finalizeAccumulator(accumulatorState);
            this.logger.info('Finalizing tool calls', { count: finalized.length });
            for (const toolCallOrError of finalized) {
              if (isToolSchemaError(toolCallOrError)) {
                this.logger.error('Tool call finalization error', toolCallOrError);
              } else {
                this.logger.info('Emitting tool call', {
                  callId: toolCallOrError.callId,
                  name: toolCallOrError.name,
                });
                currentToolCallIds.push(toolCallOrError.callId);
                progress.report(toLanguageModelToolCallPart(toolCallOrError));
                // Track tool usage for smart filtering
                this.recordToolUsage(toolCallOrError.name);
              }
            }
          }

          // Handle stream errors
          if (event.error !== undefined) {
            this.logger.error('Stream error event', event.error);
            throw new Error(`MiniMax stream error: ${event.error.message}`);
          }
        }
      } finally {
        onCancel.dispose();
      }

      // Cache the thinking block if we captured one, keyed by message content hash
      if (currentThinking && (currentText || currentToolCallIds.length > 0)) {
        const cacheKey = this.generateMessageHash(currentText, currentToolCallIds);
        this.thinkingCache.set(cacheKey, currentThinking);
        this.logger.debug('Cached thinking block', {
          cacheKey,
          thinkingLength: currentThinking.thinking.length,
          hasSignature: !!currentThinking.signature,
        });
      }

      this.logger.debug('Streaming request completed', { model: model.id });
    } catch (err) {
      if (err instanceof MiniMaxClientError) {
        this.logger.error('MiniMax client error', err, { kind: err.kind, status: err.status });
        // Abandoned requests get a distinct, user-facing message:
        // the model returned a "I'll build X now" / planning turn
        // but the tool loop never executed. Telling the user to
        // retry is more useful than the generic `MiniMax API
        // error (abandoned): ...` envelope.
        if (err.kind === 'abandoned') {
          throw new Error(
            'The model started a response but its tool loop was interrupted ' +
              'before any tool calls could run. Try again — if the issue persists, ' +
              'the model may be hitting a context-window or rate-limit ceiling.',
          );
        }
        throw new Error(`MiniMax API error (${err.kind}): ${err.message}`);
      }
      throw err;
    }
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    // Get the text content
    const content = typeof text === 'string' ? text : extractMessageText(text);

    // Get model info to determine family
    const modelInfo = await this.catalog.getModel(model.id);
    const isAnthropic = modelInfo?.thinkingStyle === 'anthropic';

    // Family-aware heuristic:
    // - Anthropic-style (M3): ~4 chars per token (more conservative)
    // - OpenAI-style (M2.x): ~3.5 chars per token
    // This is a rough estimate; a real tokenizer would be more accurate.
    const charsPerToken = isAnthropic ? 4.0 : 3.5;
    const estimate = Math.ceil(content.length / charsPerToken);

    return Math.max(1, estimate);
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) d.dispose();
    this.changeEmitter.dispose();
    this.thinkingCache.clear();
    this.toolUsageStats.clear();
  }

  /**
   * Generate a stable hash for an assistant message based on tool call IDs.
   * We use only tool call IDs (not text) because VS Code doesn't preserve
   * assistant text in message history - it only stores tool calls. So when
   * the message comes back in the next round, we only have the tool IDs to
   * match on. Uniqueness comes from tool call IDs being UUIDs.
   */
  private generateMessageHash(_text: string, toolCallIds: string[]): string {
    return toolCallIds.join(',');
  }

  /**
   * Score a tool's relevance to the current prompt using keyword matching.
   * Returns a score between 0 and 1, where higher scores indicate better relevance.
   */
  private scoreToolRelevance(prompt: string, tool: ChatTool): number {
    const promptLower = prompt.toLowerCase();
    const toolNameLower = tool.name.toLowerCase();
    const toolDescLower = tool.description.toLowerCase();

    let score = 0;

    // Exact name match (highest weight)
    if (promptLower.includes(toolNameLower)) {
      score += 1.0;
    }

    // Name keyword overlap (partial matches)
    const toolNameWords = toolNameLower.split(/[_\-\s]+/);
    for (const word of toolNameWords) {
      if (word.length > 2 && promptLower.includes(word)) {
        score += 0.3;
      }
    }

    // Description keyword overlap
    const descWords = toolDescLower.split(/\s+/).filter(w => w.length > 4);
    const promptWords = new Set(promptLower.split(/\s+/).filter(w => w.length > 4));
    let descMatches = 0;
    for (const word of descWords) {
      if (promptWords.has(word)) {
        descMatches++;
      }
    }
    if (descWords.length > 0) {
      score += (descMatches / descWords.length) * 0.5;
    }

    return Math.min(score, 1.0);
  }

  /**
   * Filter tools based on configuration and relevance/usage scoring.
   * Always includes priority tools from configuration.
   */
  private filterTools(
    allTools: ReadonlyArray<ChatTool>,
    userPrompt: string,
  ): ReadonlyArray<ChatTool> {
    const config = vscode.workspace.getConfiguration('mightyMax');
    const enabled = config.get<boolean>('enableSmartToolFiltering', true);
    const maxTools = config.get<number>('maxTools', 30);
    const alwaysInclude = new Set(config.get<string[]>('alwaysIncludeTools', [
      'read_file', 'write_file', 'edit_file', 'bash', 'grep', 'glob'
    ]));
    const strategy = config.get<'relevance' | 'usage' | 'hybrid'>('toolFilterStrategy', 'hybrid');

    // If filtering is disabled or we're under the limit, return all tools
    if (!enabled || allTools.length <= maxTools) {
      return allTools;
    }

    this.logger.info('Smart tool filtering enabled', {
      totalTools: allTools.length,
      maxTools,
      strategy,
      alwaysIncludeCount: alwaysInclude.size,
    });

    // Separate priority tools from others
    const priorityTools: ChatTool[] = [];
    const otherTools: ChatTool[] = [];

    for (const tool of allTools) {
      if (alwaysInclude.has(tool.name)) {
        priorityTools.push(tool);
      } else {
        otherTools.push(tool);
      }
    }

    // Calculate remaining budget after priority tools
    const remainingSlots = Math.max(0, maxTools - priorityTools.length);

    if (remainingSlots === 0) {
      this.logger.info('Tool filtering: using only priority tools', {
        priorityCount: priorityTools.length,
      });
      return priorityTools;
    }

    // Score and sort other tools
    const scoredTools = otherTools.map(tool => {
      let score = 0;

      // Relevance component
      if (strategy === 'relevance' || strategy === 'hybrid') {
        const relevanceScore = this.scoreToolRelevance(userPrompt, tool);
        score += relevanceScore * (strategy === 'hybrid' ? 0.6 : 1.0);
      }

      // Usage component
      if (strategy === 'usage' || strategy === 'hybrid') {
        const usageCount = this.toolUsageStats.get(tool.name) ?? 0;
        const maxUsage = Math.max(1, ...Array.from(this.toolUsageStats.values()));
        const usageScore = usageCount / maxUsage;
        score += usageScore * (strategy === 'hybrid' ? 0.4 : 1.0);
      }

      return { tool, score };
    });

    // Sort by score (descending) and take top N
    scoredTools.sort((a, b) => b.score - a.score);
    const selectedOthers = scoredTools.slice(0, remainingSlots).map(s => s.tool);

    const filtered = [...priorityTools, ...selectedOthers];

    this.logger.info('Tool filtering complete', {
      originalCount: allTools.length,
      filteredCount: filtered.length,
      priorityCount: priorityTools.length,
      selectedOthersCount: selectedOthers.length,
      topScoredTools: scoredTools.slice(0, 5).map(s => ({
        name: s.tool.name,
        score: s.score.toFixed(3),
      })),
    });

    return filtered;
  }

  /**
   * Track tool usage for smart filtering prioritization.
   */
  private recordToolUsage(toolName: string): void {
    const current = this.toolUsageStats.get(toolName) ?? 0;
    this.toolUsageStats.set(toolName, current + 1);
  }

  /**
   * Retrieve cached thinking block for an assistant message. Returns
   * undefined if no thinking was cached for this message.
   */
  private getCachedThinking(
    text: string,
    toolCallIds: string[],
  ): { thinking: string; signature?: string } | undefined {
    const key = this.generateMessageHash(text, toolCallIds);
    return this.thinkingCache.get(key);
  }

  /**
   * Enrich assistant messages with their cached thinking blocks.
   * This bridges the gap until VS Code can persist thinking blocks
   * in its own history via LanguageModelThinkingPart.
   */
  private enrichWithThinking(messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ChatMessage> {
    return messages.map((msg) => {
      if (msg.role !== 'assistant') return msg;

      // Extract text and tool call IDs from this message
      const textParts: string[] = [];
      const toolCallIds: string[] = [];
      for (const part of msg.content) {
        if (part.type === 'text') textParts.push(part.value);
        if (part.type === 'tool-call') toolCallIds.push(part.toolCall.callId);
      }

      // Look up cached thinking
      const cached = this.getCachedThinking(textParts.join('\n'), toolCallIds);
      if (!cached) return msg;

      // Prepend thinking part to the message content
      const thinkingPart: ChatMessageContentPart = {
        type: 'thinking',
        value: cached.thinking,
      };
      if (cached.signature) {
        (thinkingPart as { type: 'thinking'; value: string; signature?: string }).signature = cached.signature;
      }
      const enriched: ChatMessage = {
        ...msg,
        content: [thinkingPart, ...msg.content],
      };
      return enriched;
    });
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

// -----------------------------------------------------------------------------
// Helper: VS Code -> Domain conversions
// -----------------------------------------------------------------------------

/**
 * Convert a VS Code chat message to the domain `ChatMessage` format.
 * This is a thin struct-by-struct copy that mirrors the shapes.
 */
/**
 * Convert a VS Code chat message to the domain `ChatMessage` format.
 * This is a thin struct-by-struct copy that mirrors the shapes.
 *
 * Exported for unit testing — the `tool-result` content
 * normalization (in particular, the JSON-encode fallback for
 * non-text content) is a security-relevant boundary that
 * benefits from direct regression coverage.
 */
export function vscodeToDomainMessage(msg: vscode.LanguageModelChatRequestMessage): ChatMessage {
  const role = msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant';

  const content: ChatMessageContentPart[] = [];

  // Handle content that can be string or array
  const msgContent =
    typeof msg.content === 'string' ? [new vscode.LanguageModelTextPart(msg.content)] : msg.content;

  for (const part of msgContent) {
    if (part instanceof vscode.LanguageModelTextPart) {
      content.push({ type: 'text', value: part.value });
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      content.push({
        type: 'tool-call',
        toolCall: {
          callId: part.callId,
          name: part.name,
          input: part.input as { readonly [key: string]: unknown },
        },
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      // Convert tool result content to the domain format.
      // This helper is a free function (not a class method), so
      // we keep it pure: no `this.logger`, no `console.warn`.
      // The marker string on the JSON.stringify failure path is
      // itself the diagnostic — it appears in the model's
      // context and on the wire payload if a user wants to find
      // unserializable tool results.
      const resultContent = part.content.map((c) => {
        if (c instanceof vscode.LanguageModelTextPart) {
          return c.value;
        }
        // Other content types would be handled here. We
        // JSON-encode the payload so the model sees a primitive
        // string on the wire. `String(c)` on a structured object
        // produces the literal `[object Object]`, which leaks
        // into the model's context as garbage and is the most
        // common source of the `[object Object]` strings that
        // appear in chat transcripts when a tool returns a
        // non-text payload. Mirrors the defensive
        // `JSON.stringify` in the message mapper boundary at
        // `src/lib/domain/messages.ts:mapRequestToMiniMax`.
        try {
          return JSON.stringify(c);
        } catch {
          // Circular reference or BigInt or similar
          // unserializable value. Fall back to a marker the
          // model can see so the turn doesn't silently lose the
          // tool result. The marker includes the constructor
          // name (e.g. "Object", "Map") so a user inspecting
          // the wire payload can identify the offending type.
          const ctor = (c as { constructor?: { name?: string } })?.constructor?.name ?? typeof c;
          return `[unserializable tool result content: ${ctor}]`;
        }
      });
      content.push({
        type: 'tool-result',
        toolResult: {
          callId: part.callId,
          content: resultContent,
        },
      });
    }
    // Image parts would be handled here if supported
  }

  return { role, content, name: msg.name };
}

/**
 * Convert a VS Code tool definition to the domain `ChatTool` format.
 */
function vscodeToDomainTool(tool: vscode.LanguageModelChatTool): ChatTool {
  return {
    name: tool.name,
    description: tool.description,
    ...(tool.inputSchema !== undefined
      ? { inputSchema: tool.inputSchema as { readonly [key: string]: unknown } }
      : {}),
  };
}

/**
 * Extract text content from a chat message for token counting.
 */
function extractMessageText(msg: vscode.LanguageModelChatRequestMessage): string {
  const msgContent =
    typeof msg.content === 'string' ? [new vscode.LanguageModelTextPart(msg.content)] : msg.content;

  const textParts: string[] = [];
  for (const part of msgContent) {
    if (part instanceof vscode.LanguageModelTextPart) {
      textParts.push(part.value);
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      textParts.push(JSON.stringify(part.input));
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      for (const c of part.content) {
        if (c instanceof vscode.LanguageModelTextPart) {
          textParts.push(c.value);
        }
      }
    }
  }

  return textParts.join('\n');
}
