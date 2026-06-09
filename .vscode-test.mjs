import { defineConfig } from '@vscode/test-cli';

/**
 * @vscode/test-cli profiles:
 *  - `unit`: vanilla Mocha on compiled domain tests, no host required.
 *  - `integration`: full VS Code host with the extension loaded from
 *    `dist/extension.cjs` (esbuild output). The `version: 'insiders'` flag
 *    matches the editor used for development; CI also runs against stable
 *    via a separate workflow matrix entry.
 */
export default defineConfig([
  {
    label: 'unit',
    files: 'out/lib/**/*.test.js',
    mocha: {
      ui: 'tdd',
      timeout: 10_000,
    },
  },
  {
    label: 'integration',
    files: 'out/test/**/*.test.js',
    version: 'insiders',
    launchArgs: ['--disable-extensions', '--disable-updates'],
    mocha: {
      ui: 'tdd',
      timeout: 30_000,
    },
  },
]);
