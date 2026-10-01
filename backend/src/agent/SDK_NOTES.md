# Agent SDK notes (installed `@anthropic-ai/claude-agent-sdk` 0.3.286 vs poc.md)

Checked against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

## Same as poc.md
- `query({ prompt, options })` returns an async generator of `SDKMessage`.
- `tool(name, description, zodRawShape, handler)` and `createSdkMcpServer({ name, version, tools })` exist as described.
- These `Options` fields exist with the expected types: `cwd`, `resume`, `model`, `systemPrompt: { type: 'preset', preset: 'claude_code', append }`,
  `settingSources` (`'user' | 'project' | 'local'`), `permissionMode` (`'acceptEdits'`), `allowedTools`, `disallowedTools`,
  `mcpServers`, `maxTurns`, `abortController`.
- `system`/`init` messages carry `session_id`. `assistant` messages carry `message.content` blocks (`text`, `tool_use`, ...).
  `result` messages carry `subtype`, `total_cost_usd`, `is_error` and `num_turns`.
- Tools from the in-process server are exposed as `mcp__<server>__<tool>`, e.g. `mcp__board__submit_fix`.

## Differences and details
1. **The package is ESM-only** (`"type": "module"`, `sdk.mjs`) and the backend compiles to CommonJS. `agent/sdk-loader.ts` loads it
   with a real dynamic `import()`: `module: Node16` keeps `import()` as is. The loaded module is cached. Type imports need
   `with { 'resolution-mode': 'import' }`. Jest tests mock `sdk-loader`.
2. **`mcpServers` is a `Record<string, McpServerConfig>`.** `createSdkMcpServer()` returns an `McpSdkServerConfigWithInstance`
   (`type: 'sdk'`), which goes in under the key `board`.
3. **`tool()` takes a zod raw shape**, not a `z.object`. Both zod v3 and v4 shapes are accepted; the backend uses zod 4.6.5. The handler is
   `(args, extra) => Promise<CallToolResult>`. A tool error is `{ content: [...], isError: true }`.
4. **Result error subtypes** are `'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' |
   'error_max_structured_output_retries'`. Error results carry `errors: string[]`. A `'success'` result can still have
   `is_error: true` (e.g. an API error). The worker treats that as a result error too.
5. **`total_cost_usd` is cumulative per session.** Per the SDK docs, "a resumed or forked session continues from the total its
   transcript saved". Adding it to the ticket on every resume would double-count. At the end of each run the worker writes an
   `agent_log` event ("Run finished (...)") whose meta holds `{ sessionId, sessionCostUsd }`. The next run on that session adds only the
   increase over that baseline. If a resumed total is lower than the baseline (the transcript had no saved total), the whole amount
   is added.
6. **`env` replaces the child environment.** We pass `{ ...process.env }`, plus `ANTHROPIC_API_KEY` only when it is configured. When it
   isn't, the key is removed, so the SDK uses the local `claude` CLI login. The lead verified this: init reports `apiKeySource: 'none'`, and the
   default model is `claude-opus-5-5`.
7. **Aborting**: the SDK exports `AbortError`. An aborted run (that error, or `abortController.signal.aborted`) is reported as
   `aborted: true` and is never treated as a failure.
8. **stderr**: `Options.stderr` is used to keep the last 20 CLI stderr lines. They are appended to the error message when a run throws
   (they help diagnose, for example, a missing CLI login). They are never logged as ticket events.
9. Streamed `assistant` messages usually hold a single content block, so text excerpts are also time-throttled (at most one every 15 s,
   160 chars).
10. **Images in prompts** use streaming input: `prompt` may be an `AsyncIterable<SDKUserMessage>` instead of a string. The SDK turns a
   string prompt into exactly such a message (`{ type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user',
   content: [{ type: 'text', text }] } }`), so `AgentRunner.buildPrompt` sends the same shape with `image` blocks
   (`source: { type: 'base64', media_type, data }`) appended. `resume`, `abortController` and `mcpServers` work the same in both
   modes. With in-process MCP servers the SDK waits for the run to end before closing stdin, so an iterable that yields one message
   is still a single turn. Prompts without `/api/attachments/<id>` references stay plain strings.

## Resume prompts (documented for the README)
- First run (no `sessionId`): the full ticket brief.
- After an answer, a rejection or a retry: the texts from poc.md. Structured answers (one per question, from the
  step-by-step answer form) pair each question with its own answer, then the optional note. An older single free-text
  answer covering several questions is rendered as the list of questions, then the answer once.
- After crash recovery (the ticket was requeued by the system from `in_progress`, and has a `sessionId`):
  "The previous run was interrupted (the API restarted). Continue working on the ticket."
- If the agent ends without a finishing tool (and the result is not an error), the same session is resumed once with
  "You must finish by calling exactly one of submit_fix, request_context or give_up." If it still doesn't finish, the ticket fails.
  A result error subtype (e.g. max turns) without a finishing call fails right away, with no reminder.
