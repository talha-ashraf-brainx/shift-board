# Agent Board

A ticket board where you file issues against a git repository and an AI agent, built on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/typescript), picks them up. For each ticket, the agent either fixes it and hands it back for review, or asks for more context. You answer its questions, or you approve the fix (which merges it) or reject it with feedback, and the agent resumes the same session. The board updates live.

This is a proof of concept: one user, no auth, one worker running one ticket at a time. Tickets belong to **projects** (git repos you add from the UI), and the worker serves every project from one queue.

```
shared/     @agent-board/shared   enums, DTO types, socket event names, transition table
backend/    @agent-board/backend  NestJS API + agent worker (TypeORM, Postgres, Socket.IO)
frontend/   @agent-board/frontend React + Vite board (TanStack Query, Tailwind, dnd-kit, oxlint)
scripts/    seed-sample-repo.sh   creates a small sample repo with obvious bugs
```

## Prerequisites

- Node.js 20+ (developed on 24.2) and pnpm 9+ (developed on 11.8)
- PostgreSQL 16, either via `docker compose up -d` or a local install
- git
- Claude credentials, either:
  - `ANTHROPIC_API_KEY` in `.env`, or
  - a logged-in `claude` CLI. If the key is empty, the SDK falls back to that login.

## Setup

```bash
pnpm install
docker compose up -d              # or use a local Postgres with user/db "board"
cp .env.example .env              # then edit the paths (see below)
scripts/seed-sample-repo.sh       # creates ~/agent-board-sample (optional, for trying it out)
pnpm db:migrate
./run.sh                          # or: pnpm dev
```

`./run.sh` builds `shared`, runs migrations, then starts the shared type watcher, the API (watch mode) and the web app. Ctrl+C stops all of them.

- API: http://localhost:3000/api
- Web: http://localhost:5173. If that port is busy, Vite picks the next free one and prints it.

## Configuration (`.env`)

The API validates the environment at startup. If anything is wrong, it exits with one message that lists every problem.

Projects (repo path, base branch, project rules, extra allowed tools) are managed in the UI under **Manage projects…**, not in `.env`. `TARGET_REPO_PATH`/`BASE_BRANCH` only seed a default project: on startup, if there are no projects yet and `TARGET_REPO_PATH` is a valid repo, a project named after the repo folder is created from it. Any ticket without a project (from before projects existed) is then assigned to the first project.

| Variable | Example | Required |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://board:board@localhost:5432/board` | Yes |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | No. Empty means use the local `claude` CLI login |
| `TARGET_REPO_PATH` | `/Users/me/agent-board-sample` | No. Seeds the default project (see above); an invalid value only logs a warning |
| `BASE_BRANCH` | `main` | No. Base branch of the seeded project; defaults to the repo's current branch |
| `WORKTREES_DIR` | `/Users/me/.agent-board/worktrees` | Yes. Root for all worktrees (`<root>/<project-slug>/ticket-<n>`); must be outside every project repo; created if missing |
| `AGENT_MODEL` | (blank = SDK default) | No |
| `AGENT_MAX_TURNS` | `60` | No |
| `AGENT_EXTRA_ALLOWED_TOOLS` | `Bash(npm test:*),Bash(node:*)` | No. Comma-separated; applies to every project (each project can add its own) |
| `POLL_INTERVAL_MS` | `3000` | No |
| `API_PORT` / `WEB_ORIGIN` | `3000` / `http://localhost:5173` | No |
| `TEST_DATABASE_URL` | `postgres://board:board@localhost:5432/board_test` | Only for backend tests |

## Scripts

| Command | What it does |
| --- | --- |
| `./run.sh` / `pnpm dev` | Shared watcher + API + web app |
| `pnpm db:migrate` | Run TypeORM migrations |
| `pnpm lint` | oxlint (frontend) + `tsc --noEmit` (shared, backend, frontend) |
| `pnpm test` | Shared tests + backend Jest tests. These need `TEST_DATABASE_URL` and drop/recreate its schema |
| `pnpm build` | Build shared → backend → frontend |

## How the loop works

```mermaid
flowchart LR
  P[Pending] -->|worker claims| IP[In progress]
  IP -->|submit_fix| R[Review]
  IP -->|request_context| NC[Needs context]
  IP -->|give_up / error / max turns| F[Failed]
  NC -->|human answers| P
  R -->|approve: merge| D[Done]
  R -->|reject with feedback| P
  F -->|retry| P
  P & IP & NC & R & F -->|cancel| C[Cancelled]
```

1. **Queue.** The worker picks the next pending ticket across all projects, ordered by priority (urgent > high > medium > low), then manual position, then age.
   - Each loop iteration it checks every project's main checkout. A project that isn't on its base branch with a clean tree (or whose repo is missing) is **skipped**: its tickets wait, other projects keep running. Blocked projects show in `agent.status` (`blockedProjects`) and in the UI.
   - It claims the ticket with one atomic `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`, so two workers can never take the same ticket.
   - The worker wakes immediately when a ticket is created or requeued; otherwise it polls.
   - An urgent ticket never interrupts a run in progress.
2. **Worktree.** Each ticket gets its own branch `agent/ticket-<n>` (ticket numbers are global) and a git worktree in `WORKTREES_DIR/<project-slug>/ticket-<n>`, created from the project's base branch. A resumed ticket reuses both; tickets created before projects keep their stored worktree path.
3. **Agent run.** `query()` runs in the worktree using the Claude Code system prompt plus the board's rules.
   - The prompt names the project, and includes the global rules (Settings), the project's rules and the ticket's own rules.
   - Allowed tools = the base set + `AGENT_EXTRA_ALLOWED_TOOLS` + the project's extra tools + the board tools.
   - The project repo's `CLAUDE.md` is loaded via `settingSources: ['project']`.
   - Edits are auto-accepted, and only an allowlisted set of tools is available (see Security).
4. **Board tools.** The agent reports back only through four in-process MCP tools:

   | Tool | Effect |
   | --- | --- |
   | `submit_fix` | Moves the ticket to Review |
   | `request_context` | Moves it to Needs context, with 1–5 questions |
   | `give_up` | Moves it to Failed |
   | `add_note` | Adds a progress note; doesn't finish the run |

   The outcome is decided from these tool calls, not from parsing the agent's prose. If a run ends without a finishing call, the agent is reminded once in the same session; if it still doesn't finish, the ticket fails.
   - On `submit_fix`, the worker commits anything the agent left uncommitted. If there are no changes at all, the ticket fails.
5. **Review.** The ticket drawer shows the agent's summary, its testing notes and the diff.
   - **Approve** runs `git merge --no-ff` into the project's base branch in its main checkout, then removes the worktree and branch. The diff is snapshotted, so it can still be viewed on the done ticket.
   - On a merge conflict, the merge is aborted, the API returns 409 with the conflicting files, and the ticket stays in Review.
   - **Reject** requeues the ticket with your feedback.
6. **Live updates.** Every change is pushed over Socket.IO, using the events `ticket.created`, `ticket.updated`, `ticket.event`, `agent.status` and `project.created`/`project.updated`/`project.deleted`, and the web app patches its query cache.

Deleting a project is refused (409) while it has pending, in-progress, needs-context or review tickets. Otherwise its remaining worktrees and branches are removed and its tickets are deleted with it.

### Sessions and resume

The SDK `session_id` is saved on the ticket from the first run, and every later run passes it as `resume`, so the agent keeps the files it read and the reasoning it did. Each resumed run gets only what's new:

| Requeued after | Prompt |
| --- | --- |
| Needs context | "The board owner answered your questions:" followed by question/answer pairs, then "Continue working on the ticket." |
| Review | "Your fix was reviewed and rejected. Reviewer feedback:" followed by the feedback, then "Revise your work on the same branch." |
| Failed (Retry) | "The previous run failed with: …", plus the optional note, then "Try again." |
| Crash recovery | "The previous run was interrupted (the API restarted). Continue working on the ticket." |

**Start fresh** (in the drawer) clears the session. It can optionally also reset the worktree to the project's base branch.

### Failure handling

- A run that throws is recorded as an `error` event and the ticket moves to Failed. The worker loop never dies.
- **Crash recovery.**
  - On startup, any ticket left `in_progress` goes back to Pending, with a system event explaining why.
  - The worker spawns the Claude CLI itself and records its PID in `WORKTREES_DIR/.agent-pids/`. On startup, any agent process left over from a crashed API is killed before its ticket is requeued.
- **Cancel** aborts a running agent, then removes the worktree and branch.
- **Pause** (the header switch) stops new claims; it never interrupts the current run.
- **Repo check per project.** A project whose main checkout isn't on its base branch or has uncommitted changes is skipped (see Queue) until it's clean again; the worker itself is never paused for it.

## Security notes

- **Git calls.** Every git call uses `execFile('git', [...args])`, never a shell string. Ticket text never reaches a shell; it only goes to the model.
- **Agent tools.**
  - Allowed: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `git status`/`diff`/`add`/`commit`, the four board tools, and whatever you add via `AGENT_EXTRA_ALLOWED_TOOLS`.
  - Blocked: `WebFetch`, `WebSearch`, `git push`, `git checkout`.
- **API key.** It is never logged.
- **Auth.** There is none (this is a POC). Don't expose the API beyond localhost.

## Tests

- **shared:** queue ordering and transition table.
- **backend (Jest):**
  - the state machine, including every allowed and forbidden status × status × actor combination
  - claim order and concurrent claims against real Postgres
  - the git service, against temporary repos
  - prompt builders, resume-mode detection, board tools, log throttling, worker outcome resolution, and orphan-process cleanup
  - config validation
  - HTTP and Socket.IO end-to-end tests

## Acceptance run

Run on 2026-10-01 against `~/agent-board-sample`:

| Criterion | Result |
| --- | --- |
| Three tickets with different priorities are processed in priority order | ✅ urgent → medium → low |
| A clear bug ends in Review with a summary, testing notes, a commit on `agent/ticket-<n>`, and a correct diff | ✅ |
| A vague ticket ends in Needs context; answering it resumes the same `sessionId` | ✅ The same session continued across three runs, then reached Review |
| A rejection produces a revised fix on the same branch | ✅ A second commit on the same branch, in the same session |
| Approve merges and removes the worktree; a merge conflict shows an error and leaves the ticket in Review | ✅ 409 with the conflicting file; the merge was aborted and the base left clean |
| Ticket rules visibly change behavior | ✅ The agent added the exact comment the rule required and left the tests alone |
| Killing the API mid-run and restarting returns the ticket to Pending | ✅ The ticket was recovered with a system event, re-run, and reached Review |
| The board updates live in a second tab | ✅ A second Socket.IO client received every event |
| `pnpm lint` clean, backend tests pass | ✅ |

To try it yourself, run `scripts/seed-sample-repo.sh`, which prints some ticket ideas. For example:
- "pageCount drops the last partial page" (`src/cart.js`)
- "Free shipping should apply at exactly the threshold" (`src/discount.js`)
- the vague ticket "Make checkout better"

For a merge conflict, file two tickets that both change `pageSize` in `src/config.js`.

## Differences from the original spec, and known limitations

**Version choices**
- **NestJS 11.2.6** instead of the latest stable (12). NestJS 12 is ESM-only, which breaks the CommonJS backend build and Jest on Node < 24.9.
- **TypeScript 5.9.3**, because ts-jest doesn't support TypeScript 7.
- **Tailwind v4.** The design tokens live in a CSS `@theme` block, not `tailwind.config.ts`.
- **Diff viewer.** A small custom renderer is used instead of `react-diff-view`.

**Agent SDK** (0.3.286; details in `backend/src/agent/SDK_NOTES.md`)
- The package is ESM-only, so it's loaded with a dynamic `import()`.
- `total_cost_usd` counts the whole session, so on each run the worker adds only the increase since the session's previous run.
- `ANTHROPIC_API_KEY` is optional, as described under Prerequisites.

**Known limitations**
- One worker and one ticket at a time. The atomic claim and run registry are ready for more.
- No auth.
- Branches are never pushed and no PRs are opened.
- Each project's main checkout must stay on its base branch with a clean tree for its tickets to run and for approvals to merge.
- Orphan cleanup relies on PID files. If the whole machine reboots, the processes are already gone, which is harmless.
