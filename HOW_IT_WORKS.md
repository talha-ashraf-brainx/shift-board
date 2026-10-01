# How Claude works on tickets

Shiftboard runs Claude locally through the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/typescript), which drives the `claude` CLI on your machine. With no `ANTHROPIC_API_KEY` set, it uses your logged-in CLI account.

## Lifecycle

1. **Claim**: the worker (`backend/src/agent/agent-worker.service.ts`) polls for the next `pending` ticket and runs up to `AGENT_CONCURRENCY` (default 3) at once, each in its own worktree. Projects whose main checkout is dirty or on the wrong branch are skipped.
2. **Worktree**: each project has shared git worktrees under `WORKTREES_DIR` (one, `main`, is created with the project; add more under Manage projects and pick which one new tickets use). A ticket runs in the project's active worktree on its own branch (`agent/ticket-<n>`), so your main checkout is never touched. A worktree runs one ticket at a time: while a ticket is in progress, needs context or is in review, other tickets for that worktree wait (the header shows them as waiting). Add more worktrees to a project to run more of its tickets at the same time.
3. **Run**: `AgentRunner` calls the SDK's `query()` with:
   - the Claude Code system prompt plus the ticket brief and global, project and ticket rules,
   - `cwd` set to the worktree,
   - limited tools: read/edit files, search, and `git status/diff/add/commit` (no push, checkout or web access), plus any extra tools allowed per project,
   - a max turn limit (`AGENT_MAX_TURNS`).
4. **Live log**: tool calls and short text excerpts stream to the board over Socket.IO.
4b. **Setup and spending limit**: if the project has a setup command (e.g. `pnpm install`), it runs in the worktree first; a failure fails the ticket. If the ticket has a spending limit (its own, else the project's, else `AGENT_MAX_BUDGET_USD`), the run gets what is left of it as the SDK's `maxBudgetUsd`; a ticket that already spent its limit fails with "Spending limit reached".
5. **Finish**: Claude must call exactly one board tool (an in-process MCP server):
   - `submit_fix` → ticket moves to **Review** (it fails if nothing changed). If the project has a check command (e.g. `pnpm lint && pnpm test`), the board runs it first; on failure the output goes back to the agent in the same session to fix, up to `AGENT_CHECK_RETRIES` times, after which the ticket goes to Review marked as failing checks,
   - `request_context` → **Needs context**, with questions for you (each can offer a few options to pick from),
   - `give_up` → **Failed**.
   If Claude stops without calling one, it is reminded once, then the ticket fails.

## Your response

- **Answer questions / reject with feedback**: questions are answered one at a time (pick an option or type your own answer, then review and send). The ticket is requeued and Claude **resumes the same session** (it keeps its earlier context) with your reply.
- **Approve**: the branch is merged into the base branch with `--no-ff`, the branch is deleted and the worktree goes back to the base branch for the next ticket. A conflict aborts the merge and leaves the base clean.
- **Cancel**: the branch is deleted and the worktree is handed back the same way.

## Safety and recovery

- Claude's process ID is tracked, so an API crash can't leave an orphaned agent running. On restart, orphans are killed and interrupted tickets go back to `pending` and resume.
- Cost is tracked per ticket from the SDK's session totals.
