import type { Logger } from '../ports/logger.js';
import type {
  MiniMaxClient,
  MiniMaxCompletionRequest,
  MiniMaxStreamEvent,
} from '../ports/minimax-client.js';

/**
 * MiniMaxClientAdapter — SSE streaming HTTP client against
 * platform.minimax.io (OpenAI- and Anthropic-compatible endpoints).
 *
 * Implementation: T05. The class shape and constructor surface are
 * fixed now so the composition root can inject the real adapter without
 * a second round of refactors.
 */
export class MiniMaxClientAdapter implements MiniMaxClient {
  constructor(_baseUrl: string, _dialect: 'openai' | 'anthropic') {}

  streamCompletion(
    _request: MiniMaxCompletionRequest,
    _apiKey: string,
    _signal: AbortSignal,
    _logger: Logger,
  ): AsyncIterable<MiniMaxStreamEvent> {
    throw new Error('MiniMaxClientAdapter.streamCompletion not implemented (see T05)');
  }
}
