# Smart Tool Filtering

## Problem

M3 has difficulty calling tools when presented with 80+ tools (common in VS Code environments with MCP servers and extensions). Symptoms:

- Generates text like "I'll use the X tool..." but returns `finishReason: "stop"` with `toolCallCount: 0`
- Tool calls never execute despite explicit instructions
- Works fine with 20-40 tools

## Solution

Smart tool filtering automatically reduces the tool set sent to M3 based on:

1. **Relevance scoring**: Keyword matching between user prompt and tool names/descriptions
2. **Usage tracking**: Prioritizes tools that have been successfully called in the past
3. **Priority tools**: Always includes essential tools (configurable)

## Configuration

All settings are in the VS Code Settings UI under "Mighty Max" or in `settings.json`:

### `mightyMax.enableSmartToolFiltering`

- **Type**: Boolean
- **Default**: `true`
- **Description**: Enable/disable smart tool filtering. When disabled, all tools are sent to M3 (may cause tool-calling failures with large tool sets).

### `mightyMax.maxTools`

- **Type**: Number
- **Default**: `30`
- **Range**: 5-100
- **Description**: Maximum tools to send when filtering is enabled. M3 works best with 20-40 tools.

### `mightyMax.alwaysIncludeTools`

- **Type**: Array of strings
- **Default**: `["read_file", "write_file", "edit_file", "bash", "grep", "glob"]`
- **Description**: Tool names that are always included regardless of scoring. Common file/code operations included by default.

### `mightyMax.toolFilterStrategy`

- **Type**: Enum
- **Default**: `"hybrid"`
- **Options**:
  - `"relevance"`: Filter based on keyword matching with current prompt
  - `"usage"`: Filter based on historical call frequency
  - `"hybrid"`: Combine relevance (60%) and usage (40%) scoring

## How It Works

### 1. Priority Tools (Always Included)

Tools in `alwaysIncludeTools` are sent first, regardless of relevance. This ensures core functionality (file operations, bash) is always available.

### 2. Relevance Scoring (0-1 scale)

For each remaining tool, score is calculated based on:

- **Exact name match**: +1.0 if prompt contains full tool name
- **Name keyword overlap**: +0.3 per matching word (e.g., "read" in "read_file")
- **Description overlap**: +0.5 × (matched words / total words)

Example:

```
Prompt: "Use read_file to check the config"
Tool: { name: "read_file", description: "Read file contents" }
Score: 1.0 (exact match) + 0.5 (description overlap) = 1.5 → capped at 1.0
```

### 3. Usage Scoring (0-1 scale)

Normalized by most-called tool:

```
score = (tool_call_count) / (max_call_count_across_all_tools)
```

Tools never called have score 0. Frequently-used tools approach 1.0.

### 4. Hybrid Strategy

Combines both scores:

```
final_score = (relevance × 0.6) + (usage × 0.4)
```

### 5. Selection

1. Include all priority tools
2. Calculate remaining budget: `maxTools - priority_count`
3. Score and rank all other tools
4. Select top N by score to fill remaining slots

## Logging

When filtering is active, check the "Mighty Max" output channel for details:

```
[INFO] Smart tool filtering enabled
  totalTools: 80
  maxTools: 30
  strategy: "hybrid"
  alwaysIncludeCount: 6

[INFO] Tool filtering complete
  originalCount: 80
  filteredCount: 30
  priorityCount: 6
  selectedOthersCount: 24
  topScoredTools: [
    { name: "coraline_search", score: "0.850" },
    { name: "read_file", score: "0.820" },
    ...
  ]
```

## Example Configuration

### Minimal filtering (conservative)

```json
{
  "mightyMax.enableSmartToolFiltering": true,
  "mightyMax.maxTools": 50,
  "mightyMax.toolFilterStrategy": "usage"
}
```

### Aggressive filtering (maximum compatibility)

```json
{
  "mightyMax.enableSmartToolFiltering": true,
  "mightyMax.maxTools": 20,
  "mightyMax.toolFilterStrategy": "hybrid",
  "mightyMax.alwaysIncludeTools": [
    "read_file",
    "write_file",
    "edit_file",
    "bash"
  ]
}
```

### Disable filtering (use all tools)

```json
{
  "mightyMax.enableSmartToolFiltering": false
}
```

## Testing

To verify filtering is working:

1. Open a workspace with many MCP servers/tools (80+)
2. Open VS Code Settings → Extensions → Mighty Max
3. Set "Log Level" to "info"
4. Open "Mighty Max" output channel
5. Start a chat with M3
6. Check logs for "Smart tool filtering enabled" and "Tool filtering complete"

## Troubleshooting

### Issue: M3 still won't call tools after enabling filtering

**Solution**: Lower `maxTools` to 20-25. Some tool sets have verbose schemas that consume more tokens.

### Issue: Important tool is missing

**Solution**: Add it to `alwaysIncludeTools`:

```json
{
  "mightyMax.alwaysIncludeTools": [
    "read_file",
    "write_file",
    "my_critical_tool"
  ]
}
```

### Issue: Wrong tools are selected

**Solution**:

- If tools don't match your prompt: Switch to `"relevance"` strategy
- If rarely-used tools are prioritized: Switch to `"usage"` strategy
- For best results: Use `"hybrid"` and ensure good prompt keywords

## Implementation Details

- **Tool usage tracking**: Persists across requests within a session (cleared on extension reload)
- **Filtering scope**: Only affects tools sent to M3; doesn't modify VS Code's tool registry
- **Performance**: O(n log n) where n = tool count (negligible overhead even with 100+ tools)
- **Thread safety**: Single-threaded (VS Code extension host is single-threaded)

## Version History

- **0.1.4**: Initial implementation (default enabled, hybrid strategy, 30 tool limit)
