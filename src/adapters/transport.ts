import type { Logger } from '../ports/logger.js';
import {
  MiniMaxClientError,
  type MiniMaxClient,
  type MiniMaxCompletionRequest,
  type MiniMaxDialect,
  type MiniMaxStreamEvent,
  type MiniMaxWireContentPart,
  type MiniMaxWireMessage,
  type MiniMaxWireToolCall,
} from '../ports/minimax-client.js';

/**
 * MiniMaxClientAdapter — SSE streaming HTTP client against
 * platform.minimax.io (OpenAI- and Anthropic-compatible endpoints).
 *
 * Construction takes a *callback* for the base URL so the
 * composition root can re-read the configuration on every call
 * (matches AGENTS.md: "Configuration … read fresh at the use-site
 * and invalidate on onDidChangeConfiguration").
 *
 * The API key is supplied per-call by `streamCompletion`. The
 * adapter never stores it, never logs it, and never includes it
 * in any error message. Bearer is used for the OpenAI dialect;
 * the Anthropic dialect uses `x-api-key` per Anthropic's spec.
 *
 * Retry policy: 429 responses are retried with bounded exponential
 * backoff + jitter up to `maxRetries` times. After exhaustion the
 * adapter throws a typed `MiniMaxClientError({ kind: 'rate-limit' })`.
 * 5xx and other non-2xx responses are NOT retried (the model
 * vendor's server is broken, retrying won't help).
 *
 * Cancellation: the caller-supplied `AbortSignal` is forwarded to
 * the underlying `fetch` call. Aborting mid-stream surfaces as
 * `MiniMaxClientError({ kind: 'abort' })`.
 */

export interface MiniMaxClientOptions {
  /** Reads the current base URL on every request. */
  baseUrl: () => string;
  /** Default: 3. Maximum 429 retries before surfacing RateLimitError. */
  maxRetries?: number;
  /** Default: 250ms. Initial backoff delay before the first retry. */
  initialBackoffMs?: number;
  /** Default: 8000ms. Cap on the backoff delay between retries. */
  maxBackoffMs?: number;
  /** Optional fetch override (used by the tests to inject the mock). */
  fetchImpl?: typeof fetch;
  /** Optional sleep override (used by the tests to skip real waits). */
  sleep?: (ms: number) => Promise<void>;
}

const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULTS = {
  maxRetries: 3,
  initialBackoffMs: 250,
  maxBackoffMs: 8_000,
};

export class MiniMaxClientAdapter implements MiniMaxClient {
  private readonly baseUrl: () => string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: MiniMaxClientOptions) {
    this.baseUrl = options.baseUrl;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULTS.initialBackoffMs;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async *streamCompletion(
    request: MiniMaxCompletionRequest,
    apiKey: string,
    signal: AbortSignal,
    logger: Logger,
  ): AsyncIterable<MiniMaxStreamEvent> {
    if (!apiKey) {
      throw new MiniMaxClientError('auth', 'API key is required');
    }
    if (signal.aborted) {
      throw new MiniMaxClientError('abort', 'request aborted before start');
    }

    const dialect = request.dialect ?? defaultDialectFor(request.model);
    const startedAt = Date.now();
    logger.debug('MiniMax request start', {
      dialect,
      model: request.model,
      toolCount: request.tools?.length ?? 0,
    });

    const response = await this.doRequestWithRetries(request, apiKey, signal, dialect, logger);
    if (!response.body) {
      throw new MiniMaxClientError('network', 'MiniMax response has no body');
    }
    try {
      yield* parseStream(response.body, dialect, signal, logger);
    } finally {
      logger.info('MiniMax request complete', {
        dialect,
        model: request.model,
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HTTP + retry
  // ───────────────────────────────────────────────────────────────────────────

  private async doRequestWithRetries(
    request: MiniMaxCompletionRequest,
    apiKey: string,
    signal: AbortSignal,
    dialect: MiniMaxDialect,
    logger: Logger,
  ): Promise<Response> {
    const maxAttempts = 1 + this.maxRetries;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptController = new AbortController();
      const onCallerAbort = (): void => attemptController.abort(signal.reason);
      signal.addEventListener('abort', onCallerAbort, { once: true });
      try {
        if (signal.aborted) {
          throw new MiniMaxClientError('abort', 'request aborted', { cause: signal.reason });
        }
        const response = await this.dispatch(request, apiKey, attemptController.signal, dialect);
        if (response.ok) {
          return response;
        }
        await response.body?.cancel().catch(() => undefined);
        const status = response.status;
        if (status === 429) {
          if (attempt < maxAttempts) {
            const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
            const waitMs = computeBackoff({
              attempt,
              initialMs: this.initialBackoffMs,
              maxMs: this.maxBackoffMs,
              ...(retryAfterMs !== undefined && { retryAfterMs }),
            });
            logger.warn('MiniMax 429 — retrying', {
              model: request.model,
              attempt,
              waitMs,
            });
            await this.sleep(waitMs);
            continue;
          }
          throw new MiniMaxClientError(
            'rate-limit',
            `MiniMax returned 429 after ${attempt} attempts`,
            { status, retriable: true },
          );
        }
        if (status === 401 || status === 403) {
          throw new MiniMaxClientError('auth', `MiniMax returned ${status}`, { status });
        }
        throw new MiniMaxClientError('http', `MiniMax returned ${status}`, { status });
      } catch (err) {
        if (err instanceof MiniMaxClientError) {
          if (err.kind === 'abort') throw err;
          if (err.kind === 'auth' || err.kind === 'http' || err.kind === 'parse') throw err;
          if (err.kind === 'rate-limit' && attempt < maxAttempts) {
            lastError = err;
            continue;
          }
          throw err;
        }
        if (signal.aborted) {
          throw new MiniMaxClientError('abort', 'request aborted', { cause: err });
        }
        if (attempt < maxAttempts && isRetriableNetworkError(err)) {
          const waitMs = computeBackoff({
            attempt,
            initialMs: this.initialBackoffMs,
            maxMs: this.maxBackoffMs,
          });
          logger.warn('MiniMax network error — retrying', {
            model: request.model,
            attempt,
            waitMs,
            error: errorMessage(err),
          });
          await this.sleep(waitMs);
          lastError = err;
          continue;
        }
        throw new MiniMaxClientError('network', errorMessage(err), { cause: err });
      } finally {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
    throw new MiniMaxClientError('network', 'request failed after retries', { cause: lastError });
  }

  private async dispatch(
    request: MiniMaxCompletionRequest,
    apiKey: string,
    signal: AbortSignal,
    dialect: MiniMaxDialect,
  ): Promise<Response> {
    const baseUrl = this.baseUrl().replace(/\/+$/, '');
    const url =
      dialect === 'anthropic' ? `${baseUrl}/anthropic/v1/messages` : `${baseUrl}/v1/chat/completions`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    };
    if (dialect === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = ANTHROPIC_VERSION;
    } else {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const body =
      dialect === 'anthropic'
        ? JSON.stringify(serializeAnthropicRequest(request))
        : JSON.stringify(serializeOpenAiRequest(request));

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal,
    });
    if (!response.ok) {
      return response;
    }
    if (!response.body) {
      throw new MiniMaxClientError('network', 'MiniMax response has no body');
    }
    return response;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire serializers (request)
// ─────────────────────────────────────────────────────────────────────────────

interface OpenAiRequest {
  model: string;
  messages: ReadonlyArray<unknown>;
  stream: true;
  tools?: ReadonlyArray<unknown>;
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
}

function serializeOpenAiRequest(request: MiniMaxCompletionRequest): OpenAiRequest {
  const out: OpenAiRequest = {
    model: request.model,
    messages: request.messages.map(serializeOpenAiMessage),
    stream: true,
  };
  if (request.tools !== undefined) out.tools = request.tools;
  if (request.toolChoice !== undefined) out.tool_choice = request.toolChoice;
  if (request.temperature !== undefined) out.temperature = request.temperature;
  if (request.maxTokens !== undefined) out.max_tokens = request.maxTokens;
  return out;
}

function serializeOpenAiMessage(message: MiniMaxWireMessage): unknown {
  const out: Record<string, unknown> = { role: message.role };
  out.content = message.content;
  if (message.toolCallId !== undefined) out.tool_call_id = message.toolCallId;
  if (message.toolCalls !== undefined) out.tool_calls = message.toolCalls;
  return out;
}

interface AnthropicRequest {
  model: string;
  system?: string;
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: unknown }>;
  stream: true;
  max_tokens: number;
  tools?: ReadonlyArray<unknown>;
  tool_choice?: unknown;
  temperature?: number;
}

function serializeAnthropicRequest(request: MiniMaxCompletionRequest): AnthropicRequest {
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const m of request.messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : extractTextFromParts(m.content);
      if (text.length > 0) systemParts.push(text);
      continue;
    }
    if (m.role === 'tool') {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: typeof m.content === 'string' ? m.content : extractTextFromParts(m.content),
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant') {
      const content: unknown[] = [];
      if (typeof m.content === 'string') {
        if (m.content.length > 0) content.push({ type: 'text', text: m.content });
      } else {
        for (const part of m.content) content.push(convertAnthropicContentPart(part));
      }
      if (m.toolCalls) {
        for (const call of m.toolCalls) {
          content.push({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: safeParseJson(call.function.arguments),
          });
        }
      }
      messages.push({ role: 'assistant', content });
      continue;
    }
    if (typeof m.content === 'string') {
      messages.push({ role: 'user', content: m.content });
    } else {
      messages.push({
        role: 'user',
        content: m.content.map((p) => convertAnthropicContentPart(p)),
      });
    }
  }

  const out: AnthropicRequest = {
    model: request.model,
    messages,
    stream: true,
    max_tokens: request.maxTokens ?? 4_096,
  };
  if (systemParts.length > 0) out.system = systemParts.join('\n');
  if (request.tools !== undefined) out.tools = request.tools;
  if (request.toolChoice !== undefined) out.tool_choice = request.toolChoice;
  if (request.temperature !== undefined) out.temperature = request.temperature;
  return out;
}

function convertAnthropicContentPart(part: MiniMaxWireContentPart): unknown {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  return {
    type: 'image',
    source: { type: 'url', url: part.image_url.url },
  };
}

function extractTextFromParts(parts: ReadonlyArray<MiniMaxWireContentPart>): string {
  return parts
    .filter((p): p is Extract<MiniMaxWireContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return s;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE stream parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the response stream into normalized `MiniMaxStreamEvent`s.
 * Incremental: yields events as they arrive; never buffers the full
 * body. The two dialects are normalized to the same shape so the
 * chat provider (T07) does not branch.
 */
async function* parseStream(
  body: ReadableStream<Uint8Array>,
  dialect: MiniMaxDialect,
  signal: AbortSignal,
  logger: Logger,
): AsyncIterable<MiniMaxStreamEvent> {
  if (dialect === 'openai') {
    yield* parseOpenAiStream(body, signal, logger);
  } else {
    yield* parseAnthropicStream(body, signal, logger);
  }
}

const textDecoder = new TextDecoder('utf-8');

/**
 * Stateful SSE parser. Consumes chunks of UTF-8 bytes, splits on
 * the blank-line record boundary, and yields one record per call.
 * Records may span chunk boundaries.
 */
type SseRecord = { event?: string; data: string };

function* parseSseRecords(buffer: { value: string }): Generator<SseRecord> {
  let pending = buffer.value;
  let start = 0;
  for (let i = 0; i < pending.length; i += 1) {
    if (pending[i] === '\n' && pending[i + 1] === '\n') {
      const record = pending.slice(start, i);
      buffer.value = pending.slice(i + 2);
      yield parseSseRecord(record);
      pending = buffer.value;
      start = 0;
      i = -1;
      continue;
    }
    if (
      pending[i] === '\r' &&
      pending[i + 1] === '\n' &&
      pending[i + 2] === '\r' &&
      pending[i + 3] === '\n'
    ) {
      const record = pending.slice(start, i);
      buffer.value = pending.slice(i + 4);
      yield parseSseRecord(record);
      pending = buffer.value;
      start = 0;
      i = -1;
      continue;
    }
  }
  buffer.value = pending.slice(start);
}

function parseSseRecord(raw: string): SseRecord {
  const lines = raw.split(/\r?\n/);
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      let payload = line.slice('data:'.length);
      if (payload.startsWith(' ')) payload = payload.slice(1);
      dataLines.push(payload);
    }
  }
  return event !== undefined
    ? { event, data: dataLines.join('\n') }
    : { data: dataLines.join('\n') };
}

async function* parseOpenAiStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  logger: Logger,
): AsyncIterable<MiniMaxStreamEvent> {
  const reader = body.getReader();
  const buffer = { value: '' };
  try {
    while (true) {
      if (signal.aborted) {
        throw new MiniMaxClientError('abort', 'request aborted');
      }
      const { value, done } = await reader.read();
      if (signal.aborted) {
        throw new MiniMaxClientError('abort', 'request aborted');
      }
      if (done) break;
      if (value) {
        buffer.value += textDecoder.decode(value, { stream: true });
      }
      for (const record of parseSseRecords(buffer)) {
        if (!record.data) continue;
        if (record.data === '[DONE]') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(record.data);
        } catch (err) {
          logger.warn('MiniMax SSE JSON parse error', { error: errorMessage(err) });
          throw new MiniMaxClientError(
            'parse',
            `MiniMax SSE JSON parse error: ${errorMessage(err)}`,
          );
        }
        for (const event of openAiEventToStreamEvents(parsed)) {
          yield event;
        }
      }
    }
    if (buffer.value.length > 0) {
      const record = parseSseRecord(buffer.value);
      if (record.data && record.data !== '[DONE]') {
        try {
          const parsed = JSON.parse(record.data) as unknown;
          for (const event of openAiEventToStreamEvents(parsed)) yield event;
        } catch {
          // Drop on the floor; stream is already done.
        }
      }
    }
  } catch (err) {
    if (err instanceof MiniMaxClientError) throw err;
    if (isAbortError(err) || signal.aborted) {
      throw new MiniMaxClientError('abort', 'request aborted', { cause: err });
    }
    throw new MiniMaxClientError('network', errorMessage(err), { cause: err });
  } finally {
    reader.releaseLock();
  }
}

function* openAiEventToStreamEvents(parsed: unknown): Generator<MiniMaxStreamEvent> {
  if (!isObject(parsed)) return;
  const choices = (parsed as { choices?: unknown }).choices;
  const usage = (parsed as { usage?: unknown }).usage;
  // The terminal record combines `choices[].finish_reason` and the
  // top-level `usage` block. We collect them into a single event so
  // downstream consumers see usage + finishReason together (the model
  // emits them in the same SSE record).
  let pendingFinishReason: FinishReason | undefined;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (!isObject(choice)) continue;
      const delta = (choice as { delta?: unknown }).delta;
      if (isObject(delta)) {
        const content = (delta as { content?: unknown }).content;
        if (typeof content === 'string' && content.length > 0) {
          yield { textDelta: content };
        }
        const reasoning = (delta as { reasoning_content?: unknown }).reasoning_content;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          yield { reasoningDelta: reasoning };
        }
        const toolCalls = (delta as { tool_calls?: unknown }).tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            if (!isObject(tc)) continue;
            const index = (tc as { index?: unknown }).index;
            const id = (tc as { id?: unknown }).id;
            const fn = (tc as { function?: unknown }).function;
            if (!isObject(fn)) continue;
            const name = (fn as { name?: unknown }).name;
            const args = (fn as { arguments?: unknown }).arguments;
            const toolDelta: MiniMaxStreamEvent['toolCallDelta'] = {
              index: typeof index === 'number' ? index : 0,
            };
            if (typeof id === 'string') toolDelta.id = id;
            if (typeof name === 'string') toolDelta.name = name;
            if (typeof args === 'string') toolDelta.argumentsDelta = args;
            yield { toolCallDelta: toolDelta };
          }
        }
      }
      const finishReason = (choice as { finish_reason?: unknown }).finish_reason;
      if (typeof finishReason === 'string' && finishReason.length > 0) {
        pendingFinishReason = normalizeOpenAiFinishReason(finishReason);
      }
    }
  }
  let usageEvent: MiniMaxStreamEvent | undefined;
  if (isObject(usage)) {
    const u = usage as {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
    };
    const out: MiniMaxStreamEvent['usage'] = {};
    if (typeof u.prompt_tokens === 'number') out.promptTokens = u.prompt_tokens;
    if (typeof u.completion_tokens === 'number') out.completionTokens = u.completion_tokens;
    if (typeof u.total_tokens === 'number') out.totalTokens = u.total_tokens;
    if (typeof u.cache_read_input_tokens === 'number')
      out.cacheReadTokens = u.cache_read_input_tokens;
    if (typeof u.cache_creation_input_tokens === 'number') {
      out.cacheCreateTokens = u.cache_creation_input_tokens;
    }
    if (Object.keys(out).length > 0) usageEvent = { usage: out };
  }
  if (pendingFinishReason !== undefined && usageEvent) {
    yield { ...usageEvent, finishReason: pendingFinishReason };
  } else {
    if (usageEvent) yield usageEvent;
    if (pendingFinishReason !== undefined) yield { finishReason: pendingFinishReason };
  }
}

type FinishReason = NonNullable<MiniMaxStreamEvent['finishReason']>;

function normalizeOpenAiFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
    case 'tool_calls':
    case 'length':
    case 'content_filter':
    case 'error':
      return reason;
    default:
      return 'stop';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic stream parser
// ─────────────────────────────────────────────────────────────────────────────

async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  logger: Logger,
): AsyncIterable<MiniMaxStreamEvent> {
  const reader = body.getReader();
  const buffer = { value: '' };
  try {
    while (true) {
      if (signal.aborted) {
        throw new MiniMaxClientError('abort', 'request aborted');
      }
      const { value, done } = await reader.read();
      if (signal.aborted) {
        throw new MiniMaxClientError('abort', 'request aborted');
      }
      if (done) break;
      if (value) {
        buffer.value += textDecoder.decode(value, { stream: true });
      }
      for (const record of parseSseRecords(buffer)) {
        if (!record.data) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(record.data);
        } catch (err) {
          logger.warn('MiniMax Anthropic SSE JSON parse error', { error: errorMessage(err) });
          throw new MiniMaxClientError(
            'parse',
            `MiniMax Anthropic SSE parse error: ${errorMessage(err)}`,
          );
        }
        for (const event of anthropicEventToStreamEvents(parsed)) yield event;
      }
    }
  } catch (err) {
    if (err instanceof MiniMaxClientError) throw err;
    if (isAbortError(err) || signal.aborted) {
      throw new MiniMaxClientError('abort', 'request aborted', { cause: err });
    }
    throw new MiniMaxClientError('network', errorMessage(err), { cause: err });
  } finally {
    reader.releaseLock();
  }
}

function* anthropicEventToStreamEvents(parsed: unknown): Generator<MiniMaxStreamEvent> {
  if (!isObject(parsed)) return;
  const type = (parsed as { type?: unknown }).type;
  if (type === 'error') {
    const err = (parsed as { error?: unknown }).error;
    if (isObject(err)) {
      const message = (err as { message?: unknown }).message;
      yield {
        error: {
          message: typeof message === 'string' ? message : 'unknown error',
          retriable: false,
        },
        finishReason: 'error',
      };
    }
    return;
  }
  if (type === 'content_block_start') {
    const cb = (parsed as { content_block?: unknown }).content_block;
    if (!isObject(cb)) return;
    const blockType = (cb as { type?: unknown }).type;
    if (blockType === 'tool_use') {
      const id = (cb as { id?: unknown }).id;
      const name = (cb as { name?: unknown }).name;
      const index = (parsed as { index?: unknown }).index;
      const idx = typeof index === 'number' ? index : 0;
      // Stash the tool-use header so the first input_json_delta can
      // be merged with it into a single toolCallDelta event carrying
      // id + name + first argument fragment. Without this merge the
      // consumer would see a toolCallDelta with no `argumentsDelta`
      // followed by argument-only fragments, which produces a
      // no-op entry when callers filter on `argumentsDelta`.
      const start: { id?: string; name?: string } = {};
      if (typeof id === 'string') start.id = id;
      if (typeof name === 'string') start.name = name;
      pendingToolUseStarts.set(idx, start);
    }
    return;
  }
  if (type === 'content_block_delta') {
    const delta = (parsed as { delta?: unknown }).delta;
    if (!isObject(delta)) return;
    const deltaType = (delta as { type?: unknown }).type;
    if (deltaType === 'text_delta') {
      const text = (delta as { text?: unknown }).text;
      if (typeof text === 'string' && text.length > 0) yield { textDelta: text };
      return;
    }
    if (deltaType === 'thinking_delta') {
      const thinking = (delta as { thinking?: unknown }).thinking;
      if (typeof thinking === 'string' && thinking.length > 0) yield { thinkingDelta: thinking };
      return;
    }
    if (deltaType === 'input_json_delta') {
      const partial = (delta as { partial_json?: unknown }).partial_json;
      const index = (parsed as { index?: unknown }).index;
      if (typeof partial === 'string') {
        const idx = typeof index === 'number' ? index : 0;
        const start = pendingToolUseStarts.get(idx);
        if (start) {
          // First fragment: emit a combined event with id + name + fragment.
          const toolDelta: MiniMaxStreamEvent['toolCallDelta'] = {
            index: idx,
            argumentsDelta: partial,
          };
          if (start.id !== undefined) toolDelta.id = start.id;
          if (start.name !== undefined) toolDelta.name = start.name;
          yield { toolCallDelta: toolDelta };
          pendingToolUseStarts.delete(idx);
        } else {
          // Continuation fragment.
          yield {
            toolCallDelta: {
              index: idx,
              argumentsDelta: partial,
            },
          };
        }
      }
    }
    return;
  }
  if (type === 'content_block_stop') {
    const index = (parsed as { index?: unknown }).index;
    if (typeof index === 'number') {
      // A block may end without ever receiving an input_json_delta
      // (e.g. a malformed tool_use). Clear any pending start so the
      // buffer does not leak into a later block at the same index.
      pendingToolUseStarts.delete(index);
    }
    return;
  }
  if (type === 'message_delta') {
    const delta = (parsed as { delta?: unknown }).delta;
    if (isObject(delta)) {
      const stop = (delta as { stop_reason?: unknown }).stop_reason;
      if (typeof stop === 'string' && stop.length > 0) {
        yield { finishReason: normalizeAnthropicStopReason(stop) };
      }
    }
    return;
  }
}

/**
 * Module-level buffer of pending `content_block_start` (tool_use) events
 * keyed by content block index. Anthropic emits the tool header and
 * argument fragments as separate SSE records; the transport merges the
 * header with the FIRST argument fragment so downstream consumers see
 * one `toolCallDelta` carrying `id` + `name` + first `argumentsDelta`
 * followed by continuation fragments.
 *
 * State is bounded by content_block_stop (or message_stop upstream),
 * which clears the entry. Keying by `index` prevents leakage across
 * parallel tool calls in the same turn.
 */
const pendingToolUseStarts = new Map<number, { id?: string; name?: string }>();

function normalizeAnthropicStopReason(reason: string): FinishReason {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    default:
      return 'stop';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function defaultDialectFor(_model: string): MiniMaxDialect {
  // VSCode is deprecating the OpenAI-compatible method; use Anthropic for all models.
  // See: https://platform.minimax.io/docs/token-plan/other-tools#anthropic-compatible-protocol
  return 'anthropic';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' ||
      (typeof (err as { code?: unknown }).code === 'string' &&
        ((err as { code?: string }).code === 'ABORT_ERR' ||
          (err as { code?: string }).code === '20')))
  );
}

function isRetriableNetworkError(err: unknown): boolean {
  if (!isObject(err)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') {
    return (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'EAI_AGAIN' ||
      code === 'ECONNREFUSED' ||
      code === 'EPIPE' ||
      code === 'ENOTFOUND'
    );
  }
  return false;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

interface BackoffOpts {
  attempt: number;
  initialMs: number;
  maxMs: number;
  retryAfterMs?: number;
}

function computeBackoff(opts: BackoffOpts): number {
  if (opts.retryAfterMs !== undefined) {
    return Math.min(opts.retryAfterMs, opts.maxMs);
  }
  const exp = opts.initialMs * 2 ** (opts.attempt - 1);
  const capped = Math.min(exp, opts.maxMs);
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(capped * 0.25)));
  return capped + jitter;
}

// Re-export the wire-call shape from the port so consumers can use
// the adapter's types without importing the port module separately.
export type { MiniMaxWireToolCall };
