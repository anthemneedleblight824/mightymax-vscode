/**
 * Domain: tool and message mapping.
 *
 * Pure, framework-free. T03 implements the VS Code ↔ MiniMax tool schema
 * conversion; T04 implements the message and response-part mapping. T01
 * ships the package boundaries plus a sanity validator so the domain
 * layer has a tested shape.
 *
 * Constraint: this file must not import `vscode` or any HTTP module.
 * The `src/lib/no-vscode.test.ts` test enforces that statically.
 */

/**
 * Discriminated union of the message parts VS Code can send to the
 * provider. The mapping layer (T04) translates these into MiniMax
 * wire messages.
 */
export type RichChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface RichChatPart {
  kind: 'text' | 'image' | 'tool-call' | 'tool-result' | 'thinking';
  text?: string;
  // Image / tool fields are intentionally loose for T01 — T03/T04 will
  // narrow them with branded types (CallId, ModelId, etc.).
  [extra: string]: unknown;
}

export interface RichChatMessage {
  role: RichChatRole;
  parts: ReadonlyArray<RichChatPart>;
}

export interface MappingValidationError {
  code: 'empty-parts' | 'unsupported-part' | 'missing-tool-call-id';
  index: number;
  message: string;
}

const KNOWN_PART_KINDS = new Set(['text', 'image', 'tool-call', 'tool-result', 'thinking']);

function partCallId(part: RichChatPart): string | undefined {
  if (typeof part.callId === 'string' && part.callId.length > 0) {
    return part.callId;
  }
  const nestedToolCall = part.toolCall;
  if (
    typeof nestedToolCall === 'object' &&
    nestedToolCall !== null &&
    'callId' in nestedToolCall &&
    typeof (nestedToolCall as { callId?: unknown }).callId === 'string' &&
    (nestedToolCall as { callId: string }).callId.length > 0
  ) {
    return (nestedToolCall as { callId: string }).callId;
  }
  const nestedToolResult = part.toolResult;
  if (
    typeof nestedToolResult === 'object' &&
    nestedToolResult !== null &&
    'callId' in nestedToolResult &&
    typeof (nestedToolResult as { callId?: unknown }).callId === 'string' &&
    (nestedToolResult as { callId: string }).callId.length > 0
  ) {
    return (nestedToolResult as { callId: string }).callId;
  }
  return undefined;
}

/**
 * Validate a list of rich messages before they reach the transport.
 * Pure function. T04 will reuse this and tighten the checks.
 */
export function validateMessages(
  messages: ReadonlyArray<RichChatMessage>,
): MappingValidationError[] {
  const errors: MappingValidationError[] = [];

  messages.forEach((message, index) => {
    if (message.parts.length === 0) {
      errors.push({ code: 'empty-parts', index, message: `Message ${index} has no parts` });
    }

    for (const part of message.parts) {
      if (!KNOWN_PART_KINDS.has(part.kind)) {
        errors.push({
          code: 'unsupported-part',
          index,
          message: `Message ${index} has unsupported part kind: ${part.kind}`,
        });
        continue;
      }

      if (
        (part.kind === 'tool-call' || part.kind === 'tool-result') &&
        partCallId(part) === undefined
      ) {
        errors.push({
          code: 'missing-tool-call-id',
          index,
          message: `Message ${index} has ${part.kind} content without a non-empty callId`,
        });
      }
    }
  });

  return errors;
}
