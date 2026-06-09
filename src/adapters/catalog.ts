/**
 * CatalogAdapter — implements the `ModelCatalog` port for production.
 *
 * Owns:
 *   - The static built-in catalog (sourced from the domain).
 *   - A "live" override list updated by the transport layer (T05)
 *     after fetching from the MiniMax `/v1/models` endpoint.
 *   - A `vscode.Event<void>` fired whenever the live list changes,
 *     so `ChatProvider` can re-emit
 *     `onDidChangeLanguageModelChatInformation` and the picker
 *     refreshes automatically.
 *
 * Domain (`src/lib/domain/catalog.ts`) does the actual merging and
 * validation; this adapter is a thin vscode-aware shell.
 */

import * as vscode from 'vscode';

import type { Logger } from '../ports/logger.js';
import type { ModelCatalog, ModelInfo } from '../ports/model-catalog.js';
import { BUILT_IN_CATALOG, type CatalogEntry, mergeCatalog } from '../lib/domain/catalog.js';

export class CatalogAdapter implements ModelCatalog {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private liveModels: ReadonlyArray<CatalogEntry> = [];
  private cachedMerged: ReadonlyArray<ModelInfo> | undefined;
  private cachedMergedLiveKey: ReadonlyArray<CatalogEntry> | undefined;

  constructor(private readonly logger: Logger) {
    this.logger.debug('CatalogAdapter constructed');
  }

  /** Fires when the live list changes. Subscribed by `ChatProvider`. */
  public readonly onDidChange: vscode.Event<void> = this.changeEmitter.event;

  listModels(): Promise<ReadonlyArray<ModelInfo>> {
    // Returned synchronously but typed as a Promise to match the
    // ModelCatalog port and to keep the public surface async-only
    // (live-list updates may be async in the future).
    return Promise.resolve(this.computeMerged());
  }

  async getModel(id: string): Promise<ModelInfo | undefined> {
    return (await this.listModels()).find((entry) => entry.id === id);
  }

  /**
   * Replace the live override list. The transport layer calls this
   * after fetching from `/v1/models`. Passing an equal-length list
   * with identical ids does NOT fire the change event (we only fire
   * when the resulting merged catalog actually differs).
   */
  public setLiveModels(live: ReadonlyArray<ModelInfo>): void {
    const next = Object.freeze([...live]);
    const previousIds = this.liveModels.map((e) => e.id).join(',');
    const nextIds = next.map((e) => e.id).join(',');
    if (previousIds === nextIds && this.liveModels.length === next.length) {
      // No structural change — short-circuit so we don't re-emit.
      return;
    }
    this.liveModels = next;
    this.cachedMerged = undefined;
    this.cachedMergedLiveKey = undefined;
    this.logger.debug(`CatalogAdapter: live list updated (${next.length} entries)`);
    this.changeEmitter.fire();
  }

  private computeMerged(): ReadonlyArray<ModelInfo> {
    if (this.cachedMerged && this.cachedMergedLiveKey === this.liveModels) {
      return this.cachedMerged;
    }
    const merged = mergeCatalog(BUILT_IN_CATALOG, this.liveModels);
    this.cachedMerged = Object.freeze(merged);
    this.cachedMergedLiveKey = this.liveModels;
    return this.cachedMerged;
  }

  /** Test seam: returns the live list as currently set. */
  public _liveForTest(): ReadonlyArray<CatalogEntry> {
    return this.liveModels;
  }
}
