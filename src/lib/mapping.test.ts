import { deepStrictEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateMessages, type RichChatMessage } from './domain/mapping.js';

describe('validateMessages', () => {
  it('accepts supported part kinds with non-empty parts', () => {
    const messages: RichChatMessage[] = [
      {
        role: 'user',
        parts: [
          { kind: 'text', text: 'hello' },
          { kind: 'image', mimeType: 'image/png' },
        ],
      },
    ];

    deepStrictEqual(validateMessages(messages), []);
  });

  it('reports empty-parts when a message has no parts', () => {
    const messages: RichChatMessage[] = [{ role: 'assistant', parts: [] }];
    const errors = validateMessages(messages);

    equal(errors.length, 1);
    equal(errors[0]?.code, 'empty-parts');
  });

  it('reports unsupported-part for unknown kinds', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ kind: 'audio' }],
      },
    ] as unknown as RichChatMessage[];
    const errors = validateMessages(messages);

    equal(errors.length, 1);
    equal(errors[0]?.code, 'unsupported-part');
  });

  it('reports missing-tool-call-id for tool-call parts without a call id', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [{ kind: 'tool-call', name: 'read_file' }],
      },
    ] as RichChatMessage[];
    const errors = validateMessages(messages);

    equal(errors.length, 1);
    equal(errors[0]?.code, 'missing-tool-call-id');
  });

  it('reports missing-tool-call-id for tool-result parts without a call id', () => {
    const messages = [
      {
        role: 'tool',
        parts: [{ kind: 'tool-result', text: 'done', callId: '' }],
      },
    ] as RichChatMessage[];
    const errors = validateMessages(messages);

    equal(errors.length, 1);
    equal(errors[0]?.code, 'missing-tool-call-id');
  });
});
