# Mighty Max

MiniMax M-series language models for VS Code Chat (BYOK).

## What this is

Mighty Max is a Visual Studio Code and VS Code Insiders extension that
contributes the MiniMax M-series models (M3, M2.7, M2.5, M2, M1) to
VS Code Chat via the Language Model Chat Provider API (finalized in
VS Code 1.104). It registers under the `minimax` vendor and works as
a complete drop-in backend for Ask, Edit, Inline Chat, Agent mode,
custom and local agents, and utility tasks (commit messages, etc).

The defining feature is full agentic tool-calling parity: VS Code
hands the model a tool set per request, Mighty Max translates that
set into MiniMax's tool schema, streams tool calls back as the model
emits them, feeds tool results back, and loops until the agent turn
completes — without dropping, reordering, or garbling calls across
many rounds.

It speaks the MiniMax OpenAI- and Anthropic-compatible endpoints on
platform.minimax.io, streams responses incrementally, surfaces M3's
native thinking blocks, supports image input, and reports accurate
token usage so the context-window widget stays correct. Usage is
billed by MiniMax and does not count against Copilot quotas.

## Requirements

- VS Code 1.104 or later (Stable or Insiders)
- A MiniMax API key — set via the `Mighty Max: Manage` command

## Installation

Install from the Visual Studio Marketplace or Open VSX. The
extension ships as a single CommonJS bundle; no native dependencies,
no `node_modules`.

## Configuration

| Setting              | Scope       | Default                  | Description                                                     |
| -------------------- | ----------- | ------------------------ | --------------------------------------------------------------- |
| `mightyMax.baseUrl`  | application | `https://api.minimax.io` | MiniMax API base URL. Restricted in untrusted workspaces.       |
| `mightyMax.logLevel` | window      | `info`                   | Minimum log level forwarded to the `Mighty Max` output channel. |

The API key never lives in settings — it is stored exclusively in
`context.secrets` (SecretStorage) and entered through the
`Mighty Max: Manage` command.

## Workspace trust posture

| Capability           | Status                                         |
| -------------------- | ---------------------------------------------- |
| Untrusted workspaces | `limited` (the base-URL setting is restricted) |
| Virtual workspaces   | `limited`                                      |

Agent-mode tools (apply-edit, run-in-terminal) remain a real security
boundary in untrusted workspaces. The manifest is the contract.

## Development

```bash
npm ci
npm run typecheck
npm run compile
npm test
npm run lint
```

The build pipeline is `tsc -p .` (type-check + emit to `out/`)
followed by `esbuild out/extension.js` (single-file CommonJS bundle
to `dist/extension.js`). Production builds add `--minify` and
disable sourcemaps.

### Layout

```
src/
  extension.ts                 # composition root
  ports/                       # port interfaces (Logger, SecretStore, MiniMaxClient, ModelCatalog)
  adapters/                    # port implementations (I/O lives here)
  providers/                   # VS Code LanguageModelChatProvider
  lib/                         # domain layer (no vscode, no HTTP)
    domain/                    # pure catalog, mapping, capability rules
    *.test.ts                  # unit tests (vanilla mocha, no host)
  test/                        # integration tests (run in the VS Code host)
```

## License

MIT
