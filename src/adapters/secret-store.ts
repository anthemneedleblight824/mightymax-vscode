import type * as vscode from 'vscode';
import type { SecretStore } from '../ports/secret-store.js';

/**
 * SecretStoreAdapter — backed by `vscode.SecretStorage`.
 *
 * Implements the `SecretStore` port over the host's SecretStorage. The
 * API key never touches a setting, log channel, or any other surface.
 *
 * Implementation: T06. This file exists so the composition root can
 * wire a real-looking adapter at activation; every method throws to
 * make accidental use during T01 impossible to miss.
 */
export class SecretStoreAdapter implements SecretStore {
  constructor(_secrets: vscode.SecretStorage) {}

  getSecret(_name: string): Promise<string | undefined> {
    throw new Error('SecretStoreAdapter.getSecret not implemented (see T06)');
  }

  storeSecret(_name: string, _value: string): Promise<void> {
    throw new Error('SecretStoreAdapter.storeSecret not implemented (see T06)');
  }

  deleteSecret(_name: string): Promise<void> {
    throw new Error('SecretStoreAdapter.deleteSecret not implemented (see T06)');
  }

  hasSecret(_name: string): Promise<boolean> {
    throw new Error('SecretStoreAdapter.hasSecret not implemented (see T06)');
  }
}
