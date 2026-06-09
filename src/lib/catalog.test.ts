import * as assert from 'node:assert/strict';
import { validateCatalog } from './domain/catalog.js';
import { validateMessages } from './domain/mapping.js';
import { evaluateAgentEligibility } from './domain/capability.js';

suite('validateCatalog', () => {
  test('returns no errors for an empty catalog', () => {
    assert.deepEqual(validateCatalog([]), []);
  });

  test('flags duplicate ids', () => {
    const entry = {
      id: 'MiniMax-M3',
      displayName: 'M3',
      vendor: 'minimax',
      family: 'm3',
      maxInputTokens: 1_048_576,
      maxOutputTokens: 8192,
      capabilities: { toolCalling: true, imageInput: true, thinking: true },
    };
    const errors = validateCatalog([entry, entry]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'duplicate-id');
    assert.equal(errors[0]?.modelId, 'MiniMax-M3');
  });

  test('flags non-positive token budgets', () => {
    const entry = {
      id: 'X',
      displayName: 'X',
      vendor: 'minimax',
      family: 'x',
      maxInputTokens: 0,
      maxOutputTokens: 0,
      capabilities: { toolCalling: true, imageInput: false, thinking: false },
    };
    const errors = validateCatalog([entry]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'invalid-token-budget');
  });
});

suite('validateMessages', () => {
  test('flags messages with no parts', () => {
    const errors = validateMessages([{ role: 'user', parts: [] }]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'empty-parts');
  });

  test('flags unknown part kinds', () => {
    const errors = validateMessages([{ role: 'user', parts: [{ kind: 'telemetry' as 'text' }] }]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'unsupported-part');
  });
});

suite('evaluateAgentEligibility', () => {
  test('tool-calling model is agent-eligible', () => {
    const result = evaluateAgentEligibility({
      toolCalling: true,
      imageInput: false,
      thinking: false,
    });
    assert.equal(result.agentEligible, true);
    assert.equal(result.utilityEligible, true);
    assert.deepEqual(result.reasons, []);
  });

  test('non-tool-calling model is not agent-eligible', () => {
    const result = evaluateAgentEligibility({
      toolCalling: false,
      imageInput: false,
      thinking: false,
    });
    assert.equal(result.agentEligible, false);
    assert.equal(result.utilityEligible, true); // utility tasks don't require tool calling
    assert.equal(result.reasons.length, 1);
  });
});
