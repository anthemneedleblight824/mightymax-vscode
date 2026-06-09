# Changelog

All notable changes to Mighty Max are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.0.1] — 2026-06-09

### Added

- VS Code extension scaffold with strict TypeScript and esbuild
  bundling into a single CommonJS file (`dist/extension.js`).
- `languageModelChatProviders` contribution under the `minimax` vendor.
- `Mighty Max: Manage` command (`mightyMax.manage`) for API-key lifecycle.
- Settings: `mightyMax.baseUrl`, `mightyMax.logLevel`.
- Capability manifest: untrusted-workspaces (limited, with the
  base-URL setting in `restrictedConfigurations`) and virtual
  workspaces (limited).
- ESLint flat config with the project deny profile
  (no-floating-promises, no-misused-promises, no-explicit-any,
  await-thenable, no-unused-vars, no-non-null-assertion).
- Prettier configuration.
- `@vscode/test-cli` profiles: `unit` (vanilla mocha on the
  compiled domain) and `integration` (host-driven smoke tests).
- GitHub Actions CI matrix: Ubuntu / Windows / macOS on Node 20,
  with `xvfb-run` on Linux, npm audit, and `vsce package` artifact
  upload.

### Security

- API keys are stored exclusively in `context.secrets` (SecretStorage).
- The `LoggerAdapter` filters payloads before they reach the output
  channel; the API key and Authorization header never reach a log.
- The base-URL setting is restricted in untrusted workspaces.

### Planned (T02–T15)

- Real model catalog with tool-calling, image, and thinking flags.
- VS Code ↔ MiniMax message and tool schema mapping.
- SSE streaming MiniMax client (OpenAI- and Anthropic-compatible).
- API key management UI bound to SecretStorage.
- Provider implementation wired through the request tool set.
- Multi-round agent-loop fidelity tests, including apply-edit,
  run-in-terminal, and MCP server tools.
- `chat.utilityModel` eligibility.
- Capability matrix, README, security review, marketplace packaging.
