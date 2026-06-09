import type { ModelCatalog, ModelInfo } from '../ports/model-catalog.js';

/**
 * CatalogAdapter — delegates to the pure domain catalog defined in
 * `src/lib/domain/catalog.ts`. Keeps the port boundary explicit so the
 * catalog rules stay framework-free.
 *
 * Implementation: T02 (catalog entries) + T07 (mapping to
 * `vscode.LanguageModelChatInformation`). Methods throw until then.
 */
export class CatalogAdapter implements ModelCatalog {
  listModels(): Promise<ReadonlyArray<ModelInfo>> {
    throw new Error('CatalogAdapter.listModels not implemented (see T02)');
  }

  getModel(id: string): Promise<ModelInfo | undefined> {
    void id;
    throw new Error('CatalogAdapter.getModel not implemented (see T02)');
  }
}
