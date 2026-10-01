# Agent Ticket Board POC — Build Prompt

> **How to use:** Save this file as `BUILD_PROMPT.md` in an empty folder, open Claude Code there, and say: "Build the system described in BUILD_PROMPT.md". Before running it, have these ready: Node.js 20+, git, an `ANTHROPIC_API_KEY`, and a sample git repository the agent can fix tickets in. Skim the Agent SDK section against the current [Agent SDK TypeScript reference](https://docs.claude.com/en/api/agent-sdk/typescript), since option names can change between versions.

---

## Role, goal and scope

You are a senior full-stack TypeScript engineer. Build a working proof of concept called **Agent Board**: a ticket system where a human files issues against a git repository and a continuously running AI agent (built on the Claude Agent SDK) picks them up, fixes them, asks for more context when needed, and hands finished work back for human review.

The human's workflow the POC must support:

1. Create a ticket with a title, description, context, priority, and optional ticket-specific rules for the agent.
2. The ticket lands in **Pending**. The worker picks the highest-priority pending ticket and moves it to **In progress**.
3. The agent either fixes the issue and moves it to **Review**, or decides it lacks information and moves it to **Needs context** with specific questions.
4. The human answers questions (ticket returns to Pending and the agent resumes the same session), or reviews the diff and either **Approves** (merge, ticket goes to Done) or **Rejects** with feedback (ticket returns to Pending and the agent resumes with that feedback).
5. The human keeps adding tickets while all of this happens; the board updates live.

This is a POC: one user, no authentication, one target repository, one worker running one ticket at a time (but designed so concurrency can be raised later). Favor clarity and working end-to-end flow over polish. Every feature listed in this prompt must actually work; do not leave stubs or TODOs in the core flow.

## Tech stack and repo layout

Use exactly this stack. Pin dependency versions in `package.json`.

| Layer | Choice | Notes |
| --- | --- | --- |
| Monorepo | pnpm workspaces | `apps/api`, `apps/web`, `packages/shared` |
| Backend | NestJS (latest stable) | TypeScript strict mode |
| ORM | TypeORM | Migrations, not `synchronize: true` |
| Database | PostgreSQL 16 via `docker-compose.yml` | SQLite fallback via env var is a bonus, not required |
| Agent | `@anthropic-ai/claude-agent-sdk` | Runs inside the NestJS process as a worker service |
| Realtime | Socket.IO via `@nestjs/websockets` | Pushes ticket changes to the board |
| Validation | `class-validator` + `class-transformer` | Global `ValidationPipe` |
| Frontend | React 18+ with Vite, TypeScript strict | |
| Data fetching | TanStack Query | Invalidate on socket events |
| Styling | Tailwind CSS, light theme only | See the frontend section |
| Drag and drop | `@dnd-kit/core` | Only for human-allowed moves |
| Lint (web) | oxlint | Replaces ESLint in `apps/web`; no ESLint config there |
| Shared types | `packages/shared` | Enums and DTO interfaces used by both apps |

Repository layout:

```
agent-board/
  docker-compose.yml        # postgres
  .env.example
  pnpm-workspace.yaml
  packages/shared/src/      # TicketStatus, TicketPriority, event names, DTO types
  apps/api/src/
    main.ts
    app.module.ts
    config/                 # typed config from env
    database/               # data-source.ts, migrations/
    tickets/                # entity, service, controller, DTOs, state machine
    events/                 # ticket-event entity (activity log + Q&A thread)
    agent/                  # worker, runner, prompt builder, sdk tools
    git/                    # worktree, diff, merge helpers
    realtime/               # socket gateway
  apps/web/src/
    api/  components/  pages/  hooks/  styles/
```

Root scripts: `pnpm dev` (api + web concurrently), `pnpm db:migrate`, `pnpm lint` (oxlint for web, tsc for both), `pnpm build`.

## Data model (TypeORM entities)

Create three entities with a generated initial migration. Use UUID primary keys, `createdAt`/`updatedAt` timestamp columns, and Postgres enums for status and priority (define the TypeScript enums in `packages/shared`).

**Ticket**

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| number | int, unique, auto-increment | Human-friendly `#42`; used in branch names |
| title | varchar(200) | Required |
| description | text | What is wrong / what to do |
| context | text, nullable | Files, logs, reproduction steps the human provides up front |
| rules | text, nullable | Ticket-specific rules for the agent (in addition to the global rules) |
| priority | enum `TicketPriority` | `urgent`, `high`, `medium`, `low`; default `medium` |
| status | enum `TicketStatus` | See lifecycle section; default `pending` |
| sessionId | varchar, nullable | Agent SDK session ID; set on first run, reused on every resume |
| branchName | varchar, nullable | e.g. `agent/ticket-42` |
| worktreePath | varchar, nullable | Absolute path of the ticket's git worktree |
| agentSummary | text, nullable | Agent's latest summary of what it did |
| attemptCount | int, default 0 | Incremented on each agent run |
| lastError | text, nullable | Set when a run crashes |
| totalCostUsd | numeric(10,4), default 0 | Summed from SDK result messages |
| lockedAt | timestamptz, nullable | Set when the worker claims the ticket |
| position | int | Manual ordering within the same priority (lower = earlier) |

**TicketEvent** (one table drives both the activity timeline and the Q&A thread)

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| ticketId | uuid FK → Ticket, cascade delete | Indexed |
| type | enum | `created`, `status_changed`, `agent_question`, `human_answer`, `agent_summary`, `review_rejected`, `review_approved`, `agent_log`, `error` |
| author | enum | `human`, `agent`, `system` |
| body | text | Markdown |
| meta | jsonb, nullable | e.g. `{from, to}` for status changes, tool name for logs |
| createdAt | timestamptz | |

**Setting** (key/value, for the POC's global configuration)

| Key | Value |
| --- | --- |
| `globalRules` | Text applied to every ticket (editable in the UI); complements the repo's own `CLAUDE.md` |
| `workerEnabled` | `true`/`false`, a pause switch for the agent |

Add an index on `(status, priority, position, createdAt)` for the queue query.

## Ticket lifecycle and priority rules

Implement the lifecycle as a single state-machine module (`tickets/ticket-state-machine.ts`) that every status change goes through. It validates the transition, writes a `status_changed` TicketEvent, saves the ticket, and emits a socket event. Reject invalid transitions with HTTP 409.

Statuses: `pending`, `in_progress`, `needs_context`, `review`, `done`, `failed`, `cancelled`.

| From | To | Triggered by | Side effects |
| --- | --- | --- | --- |
| pending | in_progress | Worker claims ticket | Set `lockedAt`, increment `attemptCount` |
| in_progress | needs_context | Agent calls `request_context` | Store questions as `agent_question` events |
| in_progress | review | Agent calls `submit_fix` | Store summary; worker verifies there are commits on the branch |
| in_progress | failed | Run throws, or agent calls `give_up`, or max turns hit | Store `lastError` |
| needs_context | pending | Human posts an answer | Store `human_answer` event; ticket requeued |
| review | done | Human approves | Merge branch into base branch, remove worktree |
| review | pending | Human rejects with feedback | Store `review_rejected` event; ticket requeued |
| failed | pending | Human clicks Retry (optionally with a note) | Clear `lastError` |
| any except done | cancelled | Human cancels | Abort run if in progress; remove worktree |

Only the worker may move a ticket into or out of `in_progress`. Drag and drop in the UI is allowed only for transitions a human may trigger, and a drop onto an invalid column must snap back.

**Queue order.** The worker selects the next ticket with `status = pending AND lockedAt IS NULL`, ordered by priority (`urgent` > `high` > `medium` > `low`), then `position`, then `createdAt`. Claim it atomically (`UPDATE ... WHERE id = :id AND status = 'pending' RETURNING *`, or a `SELECT ... FOR UPDATE SKIP LOCKED` transaction) so two workers can never take the same ticket.

**Resumed tickets keep their place.** A ticket returning to pending from needs_context or review keeps its priority; do not push it to the back of its priority group.

**Urgent does not preempt.** A new urgent ticket waits for the current run to finish; it does not interrupt it.

**Crash recovery.** On API startup, any ticket left `in_progress` is moved back to `pending` with a `system` event explaining why.

## Backend API (NestJS)

Modules: `ConfigModule` (typed, validated env), `DatabaseModule` (TypeORM data source + migrations), `TicketsModule`, `EventsModule`, `SettingsModule`, `GitModule`, `AgentModule`, `RealtimeModule`. Keep controllers thin; all status logic lives in the state machine service. Use DTO classes with `class-validator` for every request body, and enable CORS for the Vite dev origin.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tickets` | List tickets; query `status`, `priority`, `q` (title search) |
| GET | `/api/tickets/:id` | Ticket with its events (oldest first) |
| POST | `/api/tickets` | Create: `title`, `description`, `context?`, `rules?`, `priority?` |
| PATCH | `/api/tickets/:id` | Edit title, description, context, rules, priority, position; allowed when not `in_progress` |
| POST | `/api/tickets/:id/answer` | Body `{ message }`; needs_context → pending |
| POST | `/api/tickets/:id/approve` | review → done; merges the branch |
| POST | `/api/tickets/:id/reject` | Body `{ feedback }` (required); review → pending |
| POST | `/api/tickets/:id/retry` | Body `{ note? }`; failed → pending |
| POST | `/api/tickets/:id/cancel` | Any non-done → cancelled |
| GET | `/api/tickets/:id/diff` | Unified diff of the ticket branch vs base branch, plus a changed-file list with +/- counts |
| GET | `/api/settings` / PUT `/api/settings` | Read/update `globalRules` and `workerEnabled` |
| GET | `/api/agent/status` | Worker state: idle/running, current ticket id, queue length |

**GitModule** wraps the `git` CLI via `execFile` (never a shell string; ticket text must never reach a shell). It provides:

- `createWorktree(ticket)`: `git worktree add -b agent/ticket-<n> <WORKTREES_DIR>/ticket-<n> <BASE_BRANCH>`. If the branch already exists (a resumed ticket), reuse the existing worktree.
- `diff(ticket)`: `git diff <BASE_BRANCH>...<branch>` plus `--numstat`.
- `hasNewCommits(ticket)`: commits on the branch not on base.
- `merge(ticket)`: in the main checkout, `git merge --no-ff <branch>`. On conflict, abort the merge, keep the ticket in review, and return a 409 with a clear message.
- `removeWorktree(ticket)`: `git worktree remove --force` and delete the branch after a successful merge or cancel.

## Agent worker (Claude Agent SDK)

The worker is a NestJS provider (`agent/agent-worker.service.ts`) that starts on `onApplicationBootstrap` and runs a loop until shutdown. Before writing code, open the installed package's type definitions (`node_modules/@anthropic-ai/claude-agent-sdk`) and confirm the exact names of `query`, `tool`, `createSdkMcpServer`, the `Options` fields and the message types used below. If anything differs, follow the installed types and note the difference in the README.

**Loop**

1. If `workerEnabled` is false, sleep `POLL_INTERVAL_MS` (default 3000) and repeat.
2. Atomically claim the next pending ticket (see Queue order). None found → sleep and repeat. Also wake immediately when a ticket is created or requeued (use an in-process event emitter) instead of waiting for the poll.
3. Ensure the ticket's worktree exists (GitModule).
4. Build the prompt (next section). For a first run it is the full ticket brief. For a resumed run it is only what is new since the last run: the human's answers, or the rejection feedback, or the retry note.
5. Call `query()` and consume the async message stream (below).
6. After the stream ends, decide the outcome from what the agent's tools recorded during the run (not by parsing prose). If the agent ended without calling `submit_fix`, `request_context` or `give_up`, resume the same session once with: "You must finish by calling exactly one of submit_fix, request_context or give_up." If it still doesn't, mark the ticket failed.
7. On `submit_fix`, verify `hasNewCommits`; if the agent forgot to commit, commit any working-tree changes yourself with message `ticket #<n>: <title>` before moving to review. If there are no changes at all, move to failed with an explanation.
8. Release the lock and loop.

**query() call** (shape; confirm against the installed types):

```ts
const abort = new AbortController();
this.running.set(ticket.id, abort); // so Cancel can abort it

const stream = query({
  prompt,
  options: {
    cwd: ticket.worktreePath,
    resume: ticket.sessionId ?? undefined,
    model: config.agentModel,              // from env, optional
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend },
    settingSources: ['project'],           // loads the target repo's CLAUDE.md
    permissionMode: 'acceptEdits',
    allowedTools: [
      'Read', 'Edit', 'Write', 'Glob', 'Grep',
      'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
      ...config.extraAllowedTools,         // e.g. 'Bash(pnpm test:*)'
      'mcp__board__submit_fix', 'mcp__board__request_context',
      'mcp__board__give_up', 'mcp__board__add_note',
    ],
    disallowedTools: ['WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git checkout:*)'],
    mcpServers: { board: buildBoardServer(ticket.id, runState) },
    maxTurns: config.agentMaxTurns,        // default 60
    abortController: abort,
  },
});

for await (const msg of stream) {
  if (msg.type === 'system' && msg.subtype === 'init') saveSessionId(msg.session_id);
  if (msg.type === 'assistant') logAssistantTurn(msg);   // short agent_log events
  if (msg.type === 'result') recordResult(msg);          // cost, subtype, error
}
```

**Session handling.** Save `session_id` from the first message that carries it and store it on the ticket. Every later run for that ticket passes it as `resume`, so the agent keeps the files it read and the reasoning it did. Never start a new session for an existing ticket unless the human explicitly clicks "Start fresh" (a small secondary action that clears `sessionId`).

**Logging.** Turn assistant messages into short `agent_log` events (tool name and a one-line summary of its input, e.g. `Edit src/auth/login.ts`), throttled so a run produces dozens of events, not thousands. Stream them to the UI over the socket.

**Result.** From the `result` message, add `total_cost_usd` to `totalCostUsd`. If its subtype is an error (for example max turns reached), mark the ticket failed with that reason unless a finishing tool was already called.

**Cancel and shutdown.** Cancel calls `abort()` on that ticket's controller. On `onApplicationShutdown`, abort the running query and leave the ticket for crash recovery.

## Agent prompt template and custom tools

The agent talks back to the board only through four in-process tools, built with `tool()` and `createSdkMcpServer({ name: 'board', ... })` and validated with zod. Each handler writes to the database through the tickets/events services and records the outcome on a per-run `runState` object the worker reads afterwards. Handlers must reject a second finishing call in the same run.

| Tool | Input | Effect |
| --- | --- | --- |
| `submit_fix` | `summary` (markdown: what changed and why), `testing` (what was run and the result) | Marks run outcome = review; stores an `agent_summary` event |
| `request_context` | `questions`: array of 1–5 specific strings, `reason` | Marks run outcome = needs_context; stores one `agent_question` event |
| `give_up` | `reason` | Marks run outcome = failed |
| `add_note` | `message` | Non-finishing progress note shown in the ticket timeline |

**System prompt append** (`systemAppend`, built in `agent/prompt-builder.ts`):

```
You are an autonomous engineer working through tickets on the Agent Board.
You are inside a git worktree on branch {branchName}, created from {baseBranch}.

Rules for every ticket:
- Work only inside this worktree. Never push, switch branches, or rewrite history.
- Make the smallest change that fully resolves the ticket. Match the existing style.
- Run the project's relevant tests or checks if they exist, and report the result.
- Commit your work with a clear message before finishing.
- If the ticket is ambiguous, or you would have to guess about behavior, data, or
  intent, do not guess: call request_context with specific questions.
- You must end every run by calling exactly one of: submit_fix, request_context, give_up.

Global rules from the board owner:
{globalRules}
```

**First-run prompt:**

```
Ticket #{number} [{priority}]: {title}

## Description
{description}

## Context provided
{context or "None"}

## Ticket-specific rules (these override global rules if they conflict)
{rules or "None"}
```

**Resume prompts:**

- After an answer: `The board owner answered your questions:` followed by each question paired with the answer, then `Continue working on the ticket.`
- After a rejection: `Your fix was reviewed and rejected. Reviewer feedback:` followed by the feedback, then `Revise your work on the same branch.`
- After a retry: `The previous run failed with: {lastError}.` plus the optional note, then `Try again.`

Keep every prompt builder a pure function with unit tests, so the exact text is easy to inspect and change.

## Frontend (React, light theme, oxlint)

**Visual direction: light theme only.** Calm, dense, readable, like a well-made internal tool. Do not add a dark mode or `dark:` classes.

| Token | Value | Use |
| --- | --- | --- |
| Page background | `#F7F7F5` | App shell |
| Surface | `#FFFFFF` | Cards, panels, modals |
| Border | `#E5E5E1` | 1px hairlines; no heavy shadows (max `shadow-sm`) |
| Text primary / secondary | `#1F1F1D` / `#6B6B66` | |
| Accent | `#4F46E5` | Primary buttons, focus rings, links |
| Font | Inter, system-ui fallback | 14px base, 13px for metadata |
| Radius | 8px cards, 6px controls | |

Priority badges (pill, tinted background + darker text of the same hue): urgent red, high orange, medium blue, low gray. Status columns get a small colored dot in the header: pending gray, in progress indigo, needs context amber, review teal, done green, failed red.

**Pages and components**

1. **Board** (`/`): a header with the app name, a worker status pill ("Idle", or "Working on #42" with a subtle pulsing dot), a pause/resume switch, a settings button, and a "New ticket" button (shortcut `N`). Below, columns: Pending, In progress, Needs context, Review, Done, plus a collapsed "Failed / Cancelled" column. Each column shows a count. Columns scroll independently; the board scrolls horizontally on narrow screens.
2. **Ticket card**: `#number`, title (2-line clamp), priority badge, relative updated time, attempt count if > 1, and an attention marker when the human must act (needs context or review). Cards within a column are sorted the same way as the worker's queue.
3. **New/Edit ticket modal**: title, priority select, description, context, rules (markdown textareas with a preview toggle). Validate required fields inline.
4. **Ticket drawer** (opens on card click, URL `/tickets/:id`): header with status, priority (editable), and actions that depend on status. Tabs: **Details** (description, context, rules), **Activity** (timeline of TicketEvents, live), **Diff** (only in review/done).
5. **Needs context view** (inside the drawer): the agent's questions as a numbered list, an answer textarea, and "Send answer & requeue".
6. **Review view**: the agent's summary and testing notes, then a diff viewer (file list with +/- counts, unified diff per file with added/removed line coloring; `react-diff-view` or a small custom renderer is fine). Buttons: **Approve & merge** (primary) and **Reject** (opens a required feedback textarea).
7. **Settings modal**: global rules textarea, read-only display of repo path and base branch.

Empty states for each column, loading skeletons, and toast notifications for actions and errors (e.g. merge conflict) are required.

**oxlint.** Add `oxlint` as a dev dependency of `apps/web` with an `.oxlintrc.json` enabling the `react`, `react-hooks`, `typescript`, `jsx-a11y` and `import` plugins, `correctness` as errors and `suspicious` as warnings. Script: `"lint": "oxlint --deny-warnings src"`. The final code must lint clean. Do not install ESLint in the web app.

## Realtime, configuration and error handling

**Socket events** (names defined in `packages/shared`). The gateway emits:

- `ticket.created` and `ticket.updated` with the full ticket.
- `ticket.event` with `{ ticketId, event }` for new timeline entries.
- `agent.status` with `{ state, ticketId, queueLength }`.

The web app keeps one socket connection, updates the TanStack Query cache on each event, and shows a small "reconnecting" banner when disconnected.

**Environment** (`.env.example`, validated at startup; the app refuses to start with a clear message if a required value is missing):

| Variable | Example | Required |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://board:board@localhost:5432/board` | Yes |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Yes |
| `TARGET_REPO_PATH` | `/home/me/projects/my-app` | Yes; must be a git repo |
| `BASE_BRANCH` | `main` | Yes |
| `WORKTREES_DIR` | `/home/me/.agent-board/worktrees` | Yes; outside the target repo |
| `AGENT_MODEL` | (blank = SDK default) | No |
| `AGENT_MAX_TURNS` | `60` | No |
| `AGENT_EXTRA_ALLOWED_TOOLS` | `Bash(pnpm test:*),Bash(pnpm lint:*)` | No; comma-separated |
| `POLL_INTERVAL_MS` | `3000` | No |
| `API_PORT` / `WEB_ORIGIN` | `3000` / `http://localhost:5173` | No |

**Error handling**

- A run that throws is caught, its error saved to `lastError` plus an `error` event, and the ticket moved to failed. The worker loop itself must never die; wrap each iteration.
- On startup, check that `TARGET_REPO_PATH` has a clean working tree on `BASE_BRANCH`. If not, start with the worker paused and show a warning banner in the UI explaining why.
- Global exception filter returns `{ statusCode, message }` JSON; the UI shows `message` in a toast.
- Never log the API key. Treat all ticket text as untrusted: it goes to the model, never into a shell command.

## Build order, acceptance criteria, out of scope

**Build in this order**, and run the app after each step before moving on:

1. Monorepo scaffold, shared package, docker-compose, env validation.
2. Entities, migration, state machine with unit tests for every allowed and forbidden transition.
3. Tickets/settings REST API.
4. Board UI with create/edit and live socket updates (worker not yet running).
5. GitModule with tests against a temporary repo created in the test.
6. Agent worker: happy path pending → in progress → review.
7. Needs-context loop with session resume.
8. Review: diff endpoint, diff viewer, approve/merge, reject/resume.
9. Failed/retry/cancel, crash recovery, pause switch, polish and empty states.
10. README: setup, env, how the loop works, known limitations.

**Acceptance criteria** (demonstrate each against a small sample repo, and include a script `scripts/seed-sample-repo.sh` that creates one with a couple of obvious bugs):

- [ ] Creating three tickets with different priorities results in the worker processing them in priority order.
- [ ] A clear bug ticket ends in Review with a summary, testing notes, a commit on `agent/ticket-<n>`, and a correct diff in the UI.
- [ ] A deliberately vague ticket ends in Needs context with specific questions; answering requeues it and the agent continues in the same session (verify the same `sessionId`).
- [ ] Rejecting a fix with feedback produces a revised fix on the same branch.
- [ ] Approving merges into the base branch and removes the worktree; a merge conflict shows an error and leaves the ticket in Review.
- [ ] Ticket-specific rules visibly change agent behavior (e.g. "do not modify tests").
- [ ] Killing the API mid-run and restarting returns the ticket to Pending.
- [ ] The board updates live in a second browser tab without refresh.
- [ ] `pnpm lint` passes (oxlint clean in web, `tsc --noEmit` clean in both apps); backend unit tests pass.

**Out of scope for the POC:** authentication and multiple users, multiple target repos, parallel workers (but keep the atomic claim so it can be enabled), pushing branches or opening pull requests, dark mode, deployment.

When you finish, report what you built, how to run it, anything you could not complete, and any place where the installed Agent SDK differed from this prompt.