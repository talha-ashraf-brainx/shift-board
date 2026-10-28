# Shiftboard: project report

Ticket #18. This report covers what the project is, how it works and what state it is in. No code was changed to write it.

## In one sentence

Shiftboard is a local, single-user ticket board. You file issues against your own git repositories, and an AI agent built on the Claude Agent SDK picks them up. For each ticket the agent either fixes it and sends it to you for review, or asks you questions. Approving a fix merges it.

## The problem it solves

It turns "ask an AI to fix something" into a queue with a review step. You keep adding tickets while the agent works through them in priority order. Each ticket ends in a state that needs a human decision:

- **Review**: approve, which merges the fix, or reject it with feedback.
- **Needs context**: answer the agent's questions.
- **Failed**: retry or cancel.

The agent never pushes and never touches your main checkout. All of its work happens on a separate branch in a separate git worktree.

## Ticket lifecycle

```
Pending ──claim──▶ In progress ──submit_fix──────▶ Review ──approve (merge)──▶ Done
   ▲                    │ ──request_context──▶ Needs context
   │                    └─give_up / error───▶ Failed
   └──── answer / reject with feedback / retry ────┘          (any open state ─▶ Cancelled)
```

1. **Queue.** A background worker claims the next pending ticket across all projects. Order is priority (urgent > high > medium > low), then manual position, then age. The claim is one atomic Postgres `UPDATE … FOR UPDATE SKIP LOCKED`. Up to `AGENT_CONCURRENCY` tickets (default 3) run at once.
2. **Worktree and branch.** Each ticket gets a branch `agent/ticket-<n>`, checked out in one of the project's shared worktrees under `WORKTREES_DIR`. A worktree holds one open ticket at a time. Projects whose main checkout is dirty or not on its base branch are skipped until they are clean.
3. **Agent run.** `AgentRunner` calls the SDK's `query()` in the worktree. The prompt combines the Claude Code system prompt with the ticket and the global, project and ticket rules. The agent gets a restricted tool allowlist: read/edit/search plus `git status/diff/add/commit`. `push`, `checkout` and web access are blocked.
4. **Reporting back.** The agent can only finish a run through in-process MCP board tools:
   - `submit_fix` moves the ticket to Review.
   - `request_context` moves it to Needs context with 1–5 questions.
   - `give_up` moves it to Failed.
   - `add_note` posts a progress note without finishing the run.

   The outcome comes from these tool calls, not from parsing the agent's text. Optional per-project setup and check commands run around the agent; failing checks go back to the agent up to `AGENT_CHECK_RETRIES` times.
5. **Resume.** The SDK `session_id` is saved on the ticket. When you answer questions, reject a fix or retry, the agent resumes the same session and receives only the new input.
6. **Review and merge.** The UI shows the agent's summary, testing notes and the diff. Approving runs `git merge --no-ff` into the base branch and deletes the branch. On a merge conflict the merge is aborted, the API returns 409 and the ticket stays in Review.

## Architecture

pnpm monorepo, all TypeScript:

| Package | Stack | Role |
| --- | --- | --- |
| `shared/` (`@agent-board/shared`) | plain TS | Enums, DTO types, Socket.IO event names, the status-transition table, priority ordering |
| `backend/` (`@agent-board/backend`) | NestJS 11, TypeORM 1.1, PostgreSQL 16, Socket.IO 4.8, Claude Agent SDK 0.3.286, AWS S3 SDK | REST API under `/api`, realtime gateway, agent worker |
| `frontend/` (`@agent-board/frontend`) | React 19, Vite 8, TanStack Query, Tailwind v4, dnd-kit | Kanban board, ticket drawer, review/diff panel, settings and project management |
| `scripts/` | bash | `seed-sample-repo.sh` creates a small sample repo with deliberate bugs to try the board on |

Infrastructure (`docker-compose.yml`): Postgres 16, plus MinIO as the S3-compatible store for image attachments (optional; without it, image uploads return 503).

### Backend modules (`backend/src/`)

| Module | Responsibility |
| --- | --- |
| `agent/` | Worker loop (`agent-worker.service.ts`), SDK runner, prompt and resume-context builders, board MCP tools, PID tracking for orphaned agent processes, setup/check command runner |
| `tickets/` | Ticket entity, CRUD, and the state machine enforcing allowed status × actor transitions |
| `projects/` | Projects (repo path, base branch, rules, extra tools, setup/check commands, budgets) and their worktrees |
| `git/` | All git operations through `execFile` (never a shell string): worktrees, branches, diffs, merges |
| `events/`, `realtime/` | Per-ticket activity log and Socket.IO broadcasting (`ticket.*`, `agent.status`, `project.*`) |
| `settings/`, `notifications/` | Global rules and settings; webhook notifications (Slack/Discord) when a ticket needs a human |
| `attachments/` | Image uploads (checked by magic bytes, stored in S3) that are passed to the agent as image input |
| `auth/` | Optional shared-secret auth (`BOARD_TOKEN`): bearer header or HttpOnly cookie, rate-limited login |
| `status/`, `fs/`, `config/`, `database/` | Worker status endpoint, folder browser for adding repos, validated env config, migrations |

### Frontend (`frontend/src/`)

A single board page (`pages/BoardPage.tsx`) with status columns, drag-and-drop ordering, a project switcher, and a ticket drawer showing the activity timeline, needs-context Q&A panel and review/diff panel. `useSocketSync` patches the TanStack Query cache from socket events so the board updates live across tabs. Also includes desktop notifications, a tab-title badge, a light/dark theme and an auth gate.

## Reliability and safety

- **Crash recovery.** On startup, tickets left `in_progress` go back to Pending, and agent processes left over from a crashed API (tracked by PID files) are killed.
- **Bounded runs.** `AGENT_MAX_TURNS`, per-ticket/project/global spending limits (`maxBudgetUsd`) and a check-command timeout. Cost is tracked per ticket.
- **Isolation.** The agent works only in worktrees. Git is called without a shell. The API binds to `127.0.0.1` by default.
- **Missing finish call.** If a run ends without a board tool call, the agent is reminded once; if it still doesn't finish, the ticket fails. A `submit_fix` with no changes also fails the ticket.

## Testing and tooling

- `pnpm test`: shared tests (queue ordering, transitions) and backend Jest tests. The backend tests cover the state machine (every status × status × actor combination), concurrent claims against real Postgres, the git service against temporary repos, prompt builders, board tools, config validation, auth, attachments, and HTTP/Socket.IO end-to-end tests. Backend tests need `TEST_DATABASE_URL`.
- `pnpm lint`: oxlint on the frontend plus `tsc --noEmit` on all three packages.
- `./run.sh` / `pnpm dev`: starts the shared watcher, the API (port 3000) and the web app (port 5173).

## Project history and status

- It started from a build spec (`poc.md`, "Agent Ticket Board POC") and an implementation plan (`PLAN.md`). All plan phases are marked done as of 2026-10-01, and an acceptance run against the sample repo passed every criterion (README, "Acceptance run").
- Since then it has grown beyond the original POC scope: multiple projects, shared worktrees, concurrency, optional auth, image attachments, notifications, spending limits, and setup/check commands.
- `IMPROVEMENTS.md` lists proposed next steps: easier reviewing, a stronger agent, board UX, safety, team features and housekeeping.
- 18 commits on `master` at the time of writing. There are 21 test files: 17 backend unit specs, 3 backend e2e suites and 1 shared suite.

## Observations

- **Outdated README limitations.** The "Known limitations" section in `README.md` still says "One worker and one ticket at a time" and "No auth". Both are out of date: `AGENT_CONCURRENCY` allows up to 16 parallel tickets, and `BOARD_TOKEN` adds optional auth. The intro paragraph is already up to date. This report doesn't edit the README because the ticket asked for no changes.
- **Inconsistent naming.** Package names still use the original name `agent-board` / `@agent-board/*`, while the product is called Shiftboard.
- **Single user.** There are no per-user accounts, and branches are never pushed and no PRs are opened. Everything stays on the local machine.
