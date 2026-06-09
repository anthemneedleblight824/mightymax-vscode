/**
 * tool-schema — port for the VS Code ↔ MiniMax tool schema mapping.
 *
 * T03 lives mostly in `src/lib/domain/tools.ts`; this port file is the
 * boundary that re-exports the relevant `vscode` types and defines the
 * domain-neutral types the mapping functions operate on. The domain
 * layer is forbidden from importing `vscode`, so the chat-provider
 * (T07) is responsible for converting between
 * `vscode.LanguageModelChatTool` and the `ChatTool` alias below before
 * calling the domain functions.
 *
 * The contract this port captures:
 *  - `ChatTool` / `ChatToolMode` / `ChatToolCallPart` / `ChatToolResultPart`
 *    are the framework-free aliases the domain maps. They mirror the
 *    shape of the corresponding `vscode` types 1:1 so the adapter
 *    boundary stays a thin struct-by-struct copy.
 *  - `ToolSchemaError` is the discriminated union of typed errors the
 *    mapping may surface (invalid tool definition, malformed argument
 *    stream that could not be repaired, parallel-call id collision,
 *    unknown tool mode, …). The T03 spec mandates that one malformed
 *    tool call must not abort the agent turn — these errors are
 *    returned from the mapping functions rather than thrown.
 *  - `ToolCallAccumulatorState` is the opaque state for
 *    `accumulateToolCallDelta`; the transport (T05) holds one state
 *    per request, feeds `MiniMaxStreamEvent` deltas in, and pulls
 *    completed `ChatToolCallPart`s out as they finalize.
 *
 * The re-exports at the bottom are the convenience handles the
 * chat-provider uses to build `ChatTool` instances from the live VS
 * Code tool set.
 */

import { LanguageModelToolCallPart, LanguageModelTextPart } from 'vscode';
import type {
  LanguageModelChatTool,
  LanguageModelChatToolMode,
  LanguageModelToolResultPart,
} from 'vscode';

/**
 * A normalized tool definition the domain layer maps to a MiniMax
 * `tools[].function` block. Mirrors `vscode.LanguageModelChatTool`
 * with two relaxations:
 *  - `inputSchema` is narrowed to a plain JSON object (the vscode
 *    type already requires this; the narrowing is for stricter docs
 *    and to satisfy `exactOptionalPropertyTypes`).
 *  - the key set is closed (no `[extra: string]: unknown`) so the
 *    domain can rely on the shape.
 */
export interface ChatTool {
  name: string;
  description: string;
  inputSchema?: { readonly [key: string]: unknown } | undefined;
}

/**
 * The tool-selecting mode the chat request is running under. Maps to
 * the MiniMax `tool_choice` field. The domain treats the absence of
 * tools (empty `tools` array on the request) as "no tool_choice
 * emitted" — there is no `None` mode at this level; VS Code expresses
 * "no tools" by not passing any.
 */
export type ChatToolMode = 'auto' | 'required';

/**
 * A completed tool call the model wants the agent to execute.
 * Mirrors `vscode.LanguageModelToolCallPart`. The `input` is the
 * JSON-decoded argument object — the streaming accumulator is
 * responsible for parsing and repairing the raw argument stream.
 */
export interface ChatToolCallPart {
  callId: string;
  name: string;
  input: { readonly [key: string]: unknown };
}

/**
 * The result of executing a tool, fed back to the model. Mirrors
 * `vscode.LanguageModelToolResultPart` with one structural relaxation:
 * the `content` array is widened to `readonly unknown[]` because the
 * VS Code type allows arbitrary `LanguageModelPromptTsxPart` or
 * other future shapes; the domain only cares about the call id and
 * that the content is a list.
 */
export interface ChatToolResultPart {
  callId: string;
  content: ReadonlyArray<unknown>;
}

/**
 * The accumulator state the transport (T05) drives incrementally.
 * The state is opaque to callers — they receive it from the
 * `accumulatorSeed()` constructor and pass it back into
 * `accumulateToolCallDelta` on every event. The state is mutated
 * in place for performance, but the function is pure: given the
 * same input state and event, it always returns the same output
 * parts and the same new state.
 */
export interface ToolCallAccumulatorState {
  readonly perIndex: ReadonlyMap<number, AccumulatingCall>;
  /** Reused across requests; lets the transport reset cheaply. */
  readonly active: boolean;
}

interface AccumulatingCall {
  callId: string;
  name: string;
  arguments: string;
  /** True once we have observed a non-empty `arguments` delta at
   *  least once, or a `name` was set. Used to suppress emitting
   *  the accumulator's empty state. */
  started: boolean;
}

/**
 * Discriminated union of typed errors the tool-schema mapping may
 * surface. The transport (T05) and chat-provider (T07) translate
 * these into chat errors VS Code can surface to the user without
 * crashing the extension host.
 */
export type ToolSchemaError =
  | {
      readonly kind: 'invalid-tool-definition';
      readonly toolName: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'unknown-tool-mode';
      readonly rawValue: number;
    }
  | {
      readonly kind: 'duplicate-call-id';
      readonly callId: string;
      readonly index: number;
    }
  | {
      readonly kind: 'argument-parse-failed';
      readonly callId: string;
      readonly index: number;
      readonly rawArguments: string;
      readonly repairAttempted: boolean;
    }
  | {
      readonly kind: 'tool-result-missing-call-id';
    }
  | {
      readonly kind: 'tool-result-content-not-list';
      readonly callId: string;
    };

/**
 * Convenience: build a `ChatTool` from a `vscode.LanguageModelChatTool`
 * in the chat-provider (T07) glue layer. Kept here so the boundary
 * is documented in one place.
 */
export function toChatTool(tool: LanguageModelChatTool): ChatTool {
  const out: ChatTool = {
    name: tool.name,
    description: tool.description,
  };
  if (tool.inputSchema !== undefined) {
    // The vscode type says `object | undefined`; the JSON schema is
    // structurally a record of unknown values, so the cast is safe.
    return { ...out, inputSchema: tool.inputSchema as { readonly [key: string]: unknown } };
  }
  return out;
}

/**
 * Convenience: build a `ChatToolResultPart` from a
 * `vscode.LanguageModelToolResultPart`. The `content` list is taken
 * verbatim (the runtime types are not narrowed here — the domain
 * serializes them as a JSON-encoded string for the wire).
 */
export function toChatToolResultPart(part: LanguageModelToolResultPart): ChatToolResultPart {
  return { callId: part.callId, content: part.content };
}

/**
 * Convert a `vscode.LanguageModelChatToolMode` enum value to a
 * domain-neutral `ChatToolMode`. Returns undefined for unknown
 * numeric values (forward-compat: VS Code may add new modes).
 */
export function toChatToolMode(mode: LanguageModelChatToolMode): ChatToolMode | undefined {
  // The enum values are documented in the vscode types. We match
  // by numeric value so we don't depend on the enum's name being
  // unchanged across vscode versions. `Number(...)` strips the
  // enum type for the comparison, which is what we want here.
  const numeric = Number(mode);
  if (numeric === 1) return 'auto';
  if (numeric === 2) return 'required';
  return undefined;
}

/** Convenience: rebuild a `vscode.LanguageModelToolCallPart` from a
 *  domain `ChatToolCallPart`. The chat-provider uses this to convert
 *  the accumulator's output back into a vscode response part. */
export function toLanguageModelToolCallPart(part: ChatToolCallPart): LanguageModelToolCallPart {
  return new LanguageModelToolCallPart(part.callId, part.name, part.input);
}

/** Convenience: rebuild a `vscode.LanguageModelTextPart` from a
 *  string. The chat-provider uses this when packaging tool-result
 *  content for `LanguageModelToolResultPart.content`. */
export function toLanguageModelTextPart(value: string): LanguageModelTextPart {
  return new LanguageModelTextPart(value);
}

// Re-exports so the chat-provider does not need to import from
// `vscode` directly when building a `ChatTool` / `ChatToolResultPart`.
// The domain layer is not allowed to import vscode; this re-export
// is a port-file convenience, not a domain dependency.
// Re-exports so the chat-provider does not need to import from
// `vscode` directly when building a `ChatTool` / `ChatToolResultPart`.
// The domain layer is not allowed to import vscode; this re-export
// is a port-file convenience, not a domain dependency.
export type { LanguageModelChatTool, LanguageModelChatToolMode, LanguageModelToolResultPart };
