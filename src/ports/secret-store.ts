/**
 * SecretStore — port for persisting the MiniMax API key.
 *
 * Implementations must use `vscode.SecretStorage` exclusively — the API
 * key is never written to settings, log channels, or any other store.
 * The key passed to `getSecret` / `storeSecret` is a logical name
 * (e.g. `mightyMax.apiKey`); the adapter maps it to a SecretStorage key.
 */
export interface SecretStore {
  getSecret(name: string): Promise<string | undefined>;
  storeSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  /** True if a secret with the given name is present (does not return the value). */
  hasSecret(name: string): Promise<boolean>;
}
