# How Claude works on tickets

Shiftboard runs Claude locally through the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/typescript), which drives the `claude` CLI on your machine. With no `ANTHROPIC_API_KEY` set, it uses your logged-in CLI account.

## Lifecycle

1. **Claim**: the worker (`backend/src/agent/agent-worker.service.ts`) polls for the next `pending` ticket, one at a time. Projects whose main checkout is dirty or on the wrong branch are skipped.
2. **Worktree**: each ticket gets its own git worktree and branch (`agent/ticket-<n>`) under `WORKTREES_DIR`, so your main checkout is never touched.
3. **Run**: `AgentRunner` calls the SDK's `query()` with:
   - the Claude Code system prompt plus the ticket brief and global, project and ticket rules,
   - `cwd` set to the worktree,
   - limited tools: read/edit files, search, and `git status/diff/add/commit` (no push, checkout or web access), plus any extra tools allowed per project,
   - a max turn limit (`AGENT_MAX_TURNS`).
4. **Live log**: tool calls and short text excerpts stream to the board over Socket.IO.
5. **Finish**: Claude must call exactly one board tool (an in-process MCP server):
   - `submit_fix` → ticket moves to **Review** (it fails if nothing changed),
   - `request_context` → **Needs context**, with questions for you,
   - `give_up` → **Failed**.
   If Claude stops without calling one, it is reminded once, then the ticket fails.

## Your response

- **Answer questions / reject with feedback**: the ticket is requeued and Claude **resumes the same session** (it keeps its earlier context) with your reply.
- **Approve**: the branch is merged into the base branch with `--no-ff`, then the worktree and branch are removed. A conflict aborts the merge and leaves the base clean.

## Safety and recovery

- Claude's process ID is tracked, so an API crash can't leave an orphaned agent running. On restart, orphans are killed and interrupted tickets go back to `pending` and resume.
- Cost is tracked per ticket from the SDK's session totals.
