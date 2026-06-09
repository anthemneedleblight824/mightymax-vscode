import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
const isProd = process.argv.includes('--production') || process.argv.includes('--minify');

const options = {
  entryPoints: ['out/extension.js'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: !isProd,
  minify: isProd,
  treeShaking: true,
  banner: {
    // VS Code expects a CommonJS entry that calls `module.exports = { activate, deactivate }`.
    // esbuild's CJS output is fine, but we keep this banner slot for future license headers.
    js: `/*! ${pkg.name} v${pkg.version} */`,
  },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('esbuild watching…');
} else {
  await build(options);
  console.log('esbuild build complete →', options.outfile);
}
