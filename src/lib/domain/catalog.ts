/**
 * Domain: model catalog.
 *
 * Pure, framework-free. T02 fills in the M3 / M2.7 / M2.5 / M2 / M1
 * entries. T01 ships a validator + an empty entry list so the domain
 * layer compiles and has at least one passing unit test before any
 * real catalog data exists.
 *
 * Constraint: this file must not import `vscode` or any HTTP module.
 * The `src/lib/no-vscode.test.ts` test enforces that statically.
 */

import type { ModelCapabilities, ModelInfo } from '../../ports/model-catalog.js';

export type CatalogEntry = ModelInfo;

export interface CatalogValidationError {
  code: 'duplicate-id' | 'invalid-capability' | 'invalid-token-budget';
  modelId: string;
  message: string;
}

/**
 * Validate a catalog. Returns the list of errors found; an empty list
 * means the catalog is acceptable. Pure function — no I/O, no side effects.
 */
export function validateCatalog(entries: ReadonlyArray<CatalogEntry>): CatalogValidationError[] {
  const errors: CatalogValidationError[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      errors.push({
        code: 'duplicate-id',
        modelId: entry.id,
        message: `Duplicate model id: ${entry.id}`,
      });
    }
    seen.add(entry.id);

    const capability = validateCapabilities(entry.capabilities);
    if (capability) {
      errors.push({ code: 'invalid-capability', modelId: entry.id, message: capability });
    }

    if (entry.maxInputTokens <= 0 || entry.maxOutputTokens <= 0) {
      errors.push({
        code: 'invalid-token-budget',
        modelId: entry.id,
        message: `Token budgets must be positive (got ${entry.maxInputTokens}/${entry.maxOutputTokens})`,
      });
    }
  }

  return errors;
}

function validateCapabilities(cap: ModelCapabilities): string | undefined {
  // Capability flags are independent booleans today; this guard is here
  // so T02 can add cross-field rules (e.g. thinking requires imageInput)
  // without changing the call signature.
  if (typeof cap.toolCalling !== 'boolean') return 'capabilities.toolCalling must be a boolean';
  if (typeof cap.imageInput !== 'boolean') return 'capabilities.imageInput must be a boolean';
  if (typeof cap.thinking !== 'boolean') return 'capabilities.thinking must be a boolean';
  return undefined;
}
