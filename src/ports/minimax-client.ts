import type { Logger } from './logger.js';

/**
 * A single content part of a MiniMax wire message. The OpenAI-compatible
 * wire spec expresses a multi-part user message as an array of these
 * (text + image_url). The MiniMax endpoint accepts the same shape on
 * the `/v1/chat/completions` route. T04 produces these from VS Code
 * `ChatMessage` content parts; the transport (T05) serializes them.
 */
export type MiniMaxWireContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image_url';
      readonly image_url: {
        readonly url: string;
        readonly detail?: 'low' | 'high' | 'auto' | undefined;
      };
    };

/**
 * Wire-level MiniMax message. The full rich message shape (with images,
 * tool calls, etc.) is built in the domain layer's message mapper
 * (T04); this port is the *transport* contract, not the model contract.
 *
 * `content` is either a plain string (the common case) or a list of
 * content parts (when the message carries images). The discriminator
 * the transport uses to decide serialization is the runtime type of
 * `content` — `typeof content === 'string'`.
 */
export interface MiniMaxWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ReadonlyArray<MiniMaxWireContentPart>;
  /** Set when role is 'tool' — the tool call id this result answers. */
  toolCallId?: string;
  /** Tool calls emitted by the assistant; populated on assistant turns. */
  toolCalls?: ReadonlyArray<MiniMaxWireToolCall>;
}

export interface MiniMaxWireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface MiniMaxToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
}

export interface MiniMaxCompletionRequest {
  model: string;
  messages: ReadonlyArray<MiniMaxWireMessage>;
  tools?: ReadonlyArray<MiniMaxToolDefinition>;
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  stream: true;
}

export interface MiniMaxUsageDelta {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

export interface MiniMaxStreamEvent {
  /** Incremental text token from the assistant. */
  textDelta?: string;
  /**
   * M2.x OpenAI-style reasoning content. The MiniMax OpenAI-compatible
   * stream emits `delta.reasoning_content` as a sibling of
   * `delta.content`; the transport (T05) surfaces it as a separate
   * `reasoningDelta` event. Mapped to `LanguageModelThinkingPart` by
   * T04 — NEVER emitted as visible text.
   */
  reasoningDelta?: string;
  /**
   * M3 Anthropic-style thinking content block. The Anthropic-compatible
   * stream emits a `delta.type = 'thinking_delta'` event with a
   * `delta.thinking` field; the transport (T05) surfaces it as a
   * `thinkingDelta` event after the per-block split. Mapped to
   * `LanguageModelThinkingPart` by T04.
   */
  thinkingDelta?: string;
  /** Incremental tool-call argument token; accumulator logic lives in T03. */
  toolCallDelta?: { index: number; id?: string; name?: string; argumentsDelta?: string };
  /** Final usage block; emitted once at the end of the stream. */
  usage?: MiniMaxUsageDelta;
  /** Terminal marker. */
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
  /** Terminal error payload, if the stream aborted. */
  error?: { message: string; code?: string; retriable: boolean };
}

/**
 * MiniMaxClient — streaming transport port.
 *
 * Implemented in `src/adapters/transport.ts` (T05). The implementation
 * talks to platform.minimax.io over SSE in either OpenAI-compatible or
 * Anthropic-compatible dialect; the dialect is a constructor concern,
 * not a per-call one. Authentication is supplied by the caller via
 * `apiKey` — the adapter never persists it.
 */
export interface MiniMaxClient {
  /**
   * Open a streaming completion. Yields events until the stream terminates.
   * Throws on transport-level failures (DNS, TLS, non-2xx HTTP); per-event
   * stream errors arrive as `MiniMaxStreamEvent.error` and do not throw.
   */
  streamCompletion(
    request: MiniMaxCompletionRequest,
    apiKey: string,
    signal: AbortSignal,
    logger: Logger,
  ): AsyncIterable<MiniMaxStreamEvent>;
}
