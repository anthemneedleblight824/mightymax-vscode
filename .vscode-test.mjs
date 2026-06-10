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
    // Pure-domain tests live under out/lib/; adapter tests (HTTP, secret
    // store, transport) live under out/adapters/. Both run without the
    // VS Code host. The src/lib/no-vscode.test.ts static guard enforces
    // that the domain layer stays framework-free; adapter tests
    // intentionally import HTTP modules.
    files: ['out/lib/**/*.test.js', 'out/adapters/**/*.test.js'],
    mocha: {
      // BDD: the test files use `describe`/`it`/`beforeEach`/`afterEach`,
      // which only register with mocha under the BDD interface. The TDD
      // interface uses `suite`/`test` and would silently skip these tests
      // (returning 0 failures but executing nothing).
      ui: 'bdd',
      timeout: 15_000,
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
  {
    label: 'agent-harness',
    // Agent-loop fidelity tests: multi-round conversations, parallel tool
    // calls, malformed call recovery, cancellation. Runs with the VS Code
    // host to test the full ChatProvider against scripted agent scenarios.
    files: 'out/test/agent-harness.test.js',
    version: 'insiders',
    launchArgs: ['--disable-extensions', '--disable-updates'],
    mocha: {
      ui: 'bdd',
      timeout: 30_000,
    },
  },
]);
