import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert/strict';
import { SecretStoreAdapter } from './secret-store.js';

/**
 * Mock SecretStorage backed by an in-memory Map. The vscode.SecretStorage
 * type does not provide `has` or `clear`; the adapter must implement
 * `hasSecret` via `get`.
 */
interface SecretStorageMock {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  onDidChange: { fire(): void };
}

function createMockSecretStorage(): SecretStorageMock {
  const storage = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(storage.get(key)),
    store: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      storage.delete(key);
      return Promise.resolve();
    },
    onDidChange: { fire: () => {} },
  };
}

describe('SecretStoreAdapter', () => {
  it('getSecret returns undefined for missing secret', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    const result = await adapter.getSecret('apiKey');
    strictEqual(result, undefined);
  });

  it('storeSecret then getSecret returns the stored value', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    const testValue = 'sk-test-1234567890';
    await adapter.storeSecret('apiKey', testValue);
    const result = await adapter.getSecret('apiKey');
    strictEqual(result, testValue);
  });

  it('storeSecret overwrites previous value', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    await adapter.storeSecret('apiKey', 'first-value');
    await adapter.storeSecret('apiKey', 'second-value');
    const result = await adapter.getSecret('apiKey');
    strictEqual(result, 'second-value');
  });

  it('deleteSecret removes the value', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    await adapter.storeSecret('apiKey', 'test-value');
    await adapter.deleteSecret('apiKey');
    const result = await adapter.getSecret('apiKey');
    strictEqual(result, undefined);
  });

  it('hasSecret returns true after storeSecret', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    await adapter.storeSecret('apiKey', 'test-value');
    const result = await adapter.hasSecret('apiKey');
    strictEqual(result, true);
  });

  it('hasSecret returns false after deleteSecret', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    await adapter.storeSecret('apiKey', 'test-value');
    await adapter.deleteSecret('apiKey');
    const result = await adapter.hasSecret('apiKey');
    strictEqual(result, false);
  });

  it('hasSecret returns false for never-stored secret', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    const result = await adapter.hasSecret('apiKey');
    strictEqual(result, false);
  });

  it('secret name is namespaced (mightyMax.apiKey)', async () => {
    const mock = createMockSecretStorage();
    const adapter = new SecretStoreAdapter(mock as never);
    const testValue = 'sk-test-1234567890';
    await adapter.storeSecret('apiKey', testValue);

    // The underlying storage should have the namespaced key.
    const rawValue = await mock.get('mightyMax.apiKey');
    strictEqual(rawValue, testValue);
  });
});
