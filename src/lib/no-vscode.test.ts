/**
 * Static guard: the `src/lib/` domain layer must not import `vscode`
 * or any HTTP/network module. The hexagonal architecture promise —
 * adapters own all I/O — is enforceable by reading the source.
 *
 * This test is intentionally a static check rather than a runtime
 * import. If `src/lib/` accidentally pulls in `vscode`, the test
 * fails with a precise file/line citation instead of crashing the
 * mocha process.
 */
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// This file compiles to CommonJS for the test runner, so use the
// CommonJS-native `__filename` / `__dirname` rather than `import.meta.url`.
// The compiled .js lives under out/lib/, so we walk back to the source
// tree at src/lib/ — the static guard inspects the TypeScript sources
// (so comments and string literals are not preprocessed away by tsc).
const here = __filename;
const outDir = dirname(here);
const root = join(outDir, '..', '..');
const libDir = join(root, 'src', 'lib');

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /from\s+['"]vscode['"]/, reason: 'direct vscode module import' },
  { pattern: /require\(['"]vscode['"]\)/, reason: 'direct vscode require' },
  { pattern: /from\s+['"]node:https?['"]/, reason: 'node http/https import' },
  { pattern: /require\(['"]https?['"]\)/, reason: 'node http/https require' },
  { pattern: /from\s+['"]undici['"]/, reason: 'undici (HTTP client) import' },
  { pattern: /from\s+['"]node-fetch['"]/, reason: 'node-fetch (HTTP client) import' },
];

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      yield full;
    }
  }
}

describe('Domain layer purity (src/lib/)', () => {
  for (const file of walk(libDir)) {
    const rel = relative(root, file).split(sep).join('/');
    it(`no I/O imports in ${rel}`, () => {
      const source = readFileSync(file, 'utf8');
      for (const { pattern, reason } of FORBIDDEN_IMPORT_PATTERNS) {
        const match = source.match(pattern);
        assert.equal(
          match,
          null,
          `${rel} contains a forbidden import (${reason}): ${match?.[0] ?? ''}`,
        );
      }
    });
  }
});
