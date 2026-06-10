import type * as vscode from 'vscode';
import type { SecretStore } from '../ports/secret-store.js';

/**
 * SecretStoreAdapter — backed by `vscode.SecretStorage`.
 *
 * Implements the `SecretStore` port over the host's SecretStorage. The
 * API key never touches a setting, log channel, or any other surface.
 *
 * Keys are namespaced with the `mightyMax.` prefix to avoid collisions
 * with other extensions reading from the same SecretStorage.
 *
 * `vscode.SecretStorage` returns Thenables (not Promises). We wrap each
 * call in `Promise.resolve` so the port contract (`Promise<...>`) holds
 * and downstream code can rely on `await` + `.catch` ergonomics.
 *
 * Implementation: T06.
 */
const NAMESPACE = 'mightyMax.';

export class SecretStoreAdapter implements SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getSecret(name: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(NAMESPACE + name));
  }

  storeSecret(name: string, value: string): Promise<void> {
    return Promise.resolve(this.secrets.store(NAMESPACE + name, value));
  }

  deleteSecret(name: string): Promise<void> {
    return Promise.resolve(this.secrets.delete(NAMESPACE + name));
  }

  async hasSecret(name: string): Promise<boolean> {
    const value = await this.secrets.get(NAMESPACE + name);
    return value !== undefined;
  }
}
