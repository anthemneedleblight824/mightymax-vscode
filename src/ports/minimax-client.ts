import type { Logger } from './logger.js';

/**
 * Wire-level MiniMax message. The full rich message shape (with images,
 * tool calls, etc.) is built in the domain layer's message mapper
 * (T04); this port is the *transport* contract, not the model contract.
 */
export interface MiniMaxWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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

export interface MiniMaxStreamEvent {
  /** Incremental text token from the assistant. */
  textDelta?: string;
  /** Incremental tool-call argument token; accumulator logic lives in T03. */
  toolCallDelta?: { index: number; id?: string; name?: string; argumentsDelta?: string };
  /** Final usage block; emitted once at the end of the stream. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
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
