# Shiftboard — Implementation Plan

Source spec: [poc.md](poc.md). This plan follows that spec, with one change to the repo layout: a pnpm-workspace monorepo whose apps are at the root, in `frontend/` and `backend/`, plus a `shared/` package for types used by both.

Each phase ends with a **Done when** checklist. Don't start the next phase until the app runs and that checklist passes.

---

## Progress (updated 2026-10-01)

| Phase | Status |
| --- | --- |
| 0. Prerequisites | ✅ Done. Versions pinned; SDK types checked (notes in `backend/src/agent/SDK_NOTES.md`) |
| 1. Scaffold | ✅ Done |
| 2. Data model & state machine | ✅ Done. Migrations run; 152 state-machine tests |
| 3. REST API & realtime | ✅ Done. e2e tests via supertest + socket.io-client |
| 4. Board UI | ✅ Done. oxlint clean, typecheck and build pass |
| 5. Git module | ✅ Done. 14 tests against temp repos |
| 6. Agent worker | ✅ Done. Verified live against the sample repo |
| 7. Needs-context & review | ✅ Done. Verified live |
| 8. Failure, cancel, recovery | ✅ Done. Crash recovery verified live; cancel and retry covered by unit tests |
| 9. Acceptance & docs | ✅ Done. All acceptance criteria pass live; README written; final sweep clean |
| 10. Multiple projects | ✅ Done (added after the POC; see Phase 10 below) |

**Current checks:** `pnpm lint` ✅ · `pnpm test` ✅ (284 tests: 281 backend, 3 shared) · `pnpm build` ✅

**How to run:** `./run.sh` starts the shared watcher, the API and the web app; Ctrl+C stops all of them. The API is at http://localhost:3000/api; the web app is at http://localhost:5173, or the next free port, which Vite prints at startup.

**Live acceptance run (2026-10-01, sample repo `~/agent-board-sample`):**
| Criterion | Result |
| --- | --- |
| Priority order | ✅ urgent #2 → medium #3 → low #1 |
| Clear bug → Review | ✅ #2: summary + testing notes, commit on `agent/ticket-2`, correct diff |
| Vague ticket → Needs context → same session | ✅ #4: asked specific questions; resumed the same `sessionId` on every answer, then reached Review |
| Reject → revised fix on the same branch | ✅ #1: second commit on `agent/ticket-1`, same session |
| Approve merges + removes the worktree; a conflict returns 409 and the ticket stays in Review | ✅ #2 and #3 merged with `--no-ff`; #1 conflict aborted cleanly, `main` left clean |
| Ticket rules change behavior | ✅ #3: added the exact comment the rule required, no test files touched |
| Kill the API mid-run → ticket back to Pending | ✅ #5: recovered with a system event, re-run, reached Review |
| Live updates in a second tab | ✅ a second Socket.IO client received every create, update and event |

**Changes from the original plan:**
- **NestJS 11.2.6** (CommonJS) instead of 12. NestJS 12 is ESM-only, which breaks the CommonJS backend build and Jest on Node 24.2. 11.2.7 was also skipped, because pnpm's minimum-release-age policy rejects it.
- **TypeScript 5.9.3**. TypeScript 7 isn't supported by ts-jest.
- **`ANTHROPIC_API_KEY` is optional.** When it's empty, the Agent SDK uses the local `claude` CLI login (verified).
- **Tailwind v4.** The design tokens live in a CSS `@theme` block instead of `tailwind.config.ts`.
- **The diff viewer is a small custom renderer**, not `react-diff-view`.
- **Local Postgres 16** (Homebrew) was used for development; `docker-compose.yml` is still provided.
- **Agent SDK cost:** `total_cost_usd` counts the whole session, so the worker only adds the increase since the session's previous run.
- **New: orphaned agent cleanup.** A hard API crash left the SDK's `claude` subprocess running and still editing the worktree. The worker now spawns the CLI itself (`spawnClaudeCodeProcess`) and records its PID in `<WORKTREES_DIR>/.agent-pids/`. On startup, any recorded process still alive is killed before crash recovery requeues its ticket (`backend/src/agent/process-tracker.ts`).
- **Backend build:** TypeScript `incremental` is turned off, because Nest's `deleteOutDir` plus a stale `.tsbuildinfo` meant nothing was emitted.
- **`run.sh`** was added at the repo root.

---

## Repository layout

```
shift-board/
  docker-compose.yml            # postgres 16
  .env.example
  package.json                  # root scripts only (dev, build, lint, test, db:migrate)
  pnpm-workspace.yaml           # packages: frontend, backend, shared
  tsconfig.base.json            # strict settings shared by all packages
  scripts/
    seed-sample-repo.sh         # creates a sample git repo with obvious bugs
  shared/                       # @agent-board/shared
    package.json
    src/
      enums.ts                  # TicketStatus, TicketPriority, EventType, EventAuthor
      events.ts                 # socket event names + payload types
      dto.ts                    # request/response interfaces
      priority.ts               # PRIORITY_ORDER, compareTickets()
      transitions.ts            # HUMAN_ALLOWED_TRANSITIONS (used for drag and drop)
      index.ts
  backend/                      # @agent-board/backend (NestJS)
    package.json
    nest-cli.json
    tsconfig.json
    src/
      main.ts
      app.module.ts
      config/                   # typed + validated env
      database/                 # data-source.ts, migrations/
      common/                   # exception filter, utils
      tickets/                  # entity, service, controller, DTOs, state machine
      events/                   # ticket-event entity + service
      settings/                 # setting entity, service, controller
      git/                      # git.service.ts (execFile wrappers)
      agent/                    # worker, runner, prompt-builder, board tools, run-state
      realtime/                 # socket.io gateway
    test/                       # unit + integration tests
  frontend/                     # @agent-board/frontend (React + Vite)
    package.json
    vite.config.ts
    tailwind.config.ts
    .oxlintrc.json
    index.html
    src/
      main.tsx
      App.tsx
      api/                      # fetch client, query hooks, socket client
      components/               # Board, Column, TicketCard, Drawer, DiffViewer, ...
      pages/                    # BoardPage (drawer routed at /tickets/:id)
      hooks/                    # useSocketSync, useShortcut, ...
      styles/                   # index.css (Tailwind + tokens)
```

**Root scripts**

| Script | Runs |
| --- | --- |
| `pnpm dev` | `shared` in watch mode, `backend` (nest start --watch) and `frontend` (vite), concurrently |
| `pnpm build` | `shared` → `backend` → `frontend` |
| `pnpm db:migrate` | `pnpm --filter backend migration:run` |
| `pnpm lint` | `oxlint` in frontend + `tsc --noEmit` in shared, backend and frontend |
| `pnpm test` | backend unit/integration tests (Jest) + shared tests |

---

## Phase 0 — Prerequisites & decisions

Goal: tooling ready and open questions closed before any code is written.

- [x] **0.1** Confirm local tooling: Node 20+, pnpm 9+, Docker, git, an `ANTHROPIC_API_KEY`.
- [x] **0.2** Pick exact versions for all dependencies (NestJS, TypeORM, pg, socket.io, React, Vite, TanStack Query, Tailwind, @dnd-kit/core, oxlint, zod, `@anthropic-ai/claude-agent-sdk`) and pin them exactly (no `^`).
- [x] **0.3** Install `@anthropic-ai/claude-agent-sdk` in a scratch folder. Read its `.d.ts` to confirm the names of `query`, `tool`, `createSdkMcpServer`, the `Options` fields (`cwd`, `resume`, `systemPrompt`, `settingSources`, `permissionMode`, `allowedTools`, `disallowedTools`, `mcpServers`, `maxTurns`, `abortController`) and the message shapes (`system/init`, `assistant`, `result`, `session_id`, `total_cost_usd`). Write down any differences for the README.
- [x] **0.4** Run `git init` in the project root and add a `.gitignore` covering `node_modules`, `dist`, `.env` and coverage.

**Done when:** versions are chosen, SDK API differences are noted, and the repo is initialized.

---

## Phase 1 — Monorepo scaffold, shared package, infra, env validation

Goal: an empty but runnable monorepo. `pnpm dev` starts both apps, and the backend refuses to start if the env is invalid.

### Workspace
- [x] **1.1** Root `package.json` (private, `packageManager` field), `pnpm-workspace.yaml` listing `frontend`, `backend` and `shared`.
- [x] **1.2** `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (optional), `forceConsistentCasingInFileNames`.
- [x] **1.3** Root scripts from the table above, using `concurrently`.

### shared/
- [x] **1.4** Package `@agent-board/shared`, built with `tsc` to `dist/` (CJS output so NestJS can consume it; Vite handles it too). Add a `watch` script.
- [x] **1.5** `enums.ts`:
  - `TicketStatus`: `pending`, `in_progress`, `needs_context`, `review`, `done`, `failed`, `cancelled`
  - `TicketPriority`: `urgent`, `high`, `medium`, `low`
  - `TicketEventType`: `created`, `status_changed`, `agent_question`, `human_answer`, `agent_summary`, `review_rejected`, `review_approved`, `agent_log`, `error`
  - `EventAuthor`: `human`, `agent`, `system`
- [x] **1.6** `events.ts`: socket event name constants (`ticket.created`, `ticket.updated`, `ticket.event`, `agent.status`) and their payload types.
- [x] **1.7** `dto.ts`: `TicketDto`, `TicketEventDto`, `TicketWithEventsDto`, `CreateTicketInput`, `UpdateTicketInput`, `AnswerInput`, `RejectInput`, `RetryInput`, `SettingsDto`, `AgentStatusDto`, `DiffDto` (`files: {path, additions, deletions}[]`, `patch: string`), `ApiError`.
- [x] **1.8** `priority.ts`: `PRIORITY_RANK` and `compareTickets(a, b)` (priority, then position, then createdAt). The frontend's card sorting and the backend's tests both use it.
- [x] **1.9** `transitions.ts`: `HUMAN_ALLOWED_TRANSITIONS` map (needs_context→pending isn't drag-able since it requires an answer; define which drags open a modal vs. are direct).

### Infra
- [x] **1.10** `docker-compose.yml`: postgres:16, user/db `board`, volume, healthcheck, port 5432.
- [x] **1.11** `.env.example` with every variable from the spec (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `TARGET_REPO_PATH`, `BASE_BRANCH`, `WORKTREES_DIR`, `AGENT_MODEL`, `AGENT_MAX_TURNS`, `AGENT_EXTRA_ALLOWED_TOOLS`, `POLL_INTERVAL_MS`, `API_PORT`, `WEB_ORIGIN`).

### backend/ scaffold
- [x] **1.12** NestJS app (`main.ts`, `app.module.ts`), global prefix `/api`, CORS for `WEB_ORIGIN`, global `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`.
- [x] **1.13** `config/` module: env schema validated at boot (class-validator `validate()` function on `ConfigModule.forRoot`). It should:
  - fail fast with one readable message that lists every missing or invalid var
  - check that `TARGET_REPO_PATH` exists and is a git repo
  - check that `WORKTREES_DIR` is outside `TARGET_REPO_PATH`, creating the directory if it's missing
  - parse `AGENT_EXTRA_ALLOWED_TOOLS` into `string[]`
  - expose a typed `AppConfig` service and never log the API key
- [x] **1.14** Global exception filter returning `{ statusCode, message }`.

### frontend/ scaffold
- [x] **1.15** Vite + React + TS strict, Tailwind with the design tokens (see Phase 4), Inter font, React Router, TanStack Query provider.
- [x] **1.16** oxlint: dev dependency, `.oxlintrc.json` with plugins `react`, `react-hooks`, `typescript`, `jsx-a11y`, `import`; `correctness` = error, `suspicious` = warn; script `"lint": "oxlint --deny-warnings src"`. Make sure no ESLint is installed.
- [x] **1.17** Vite dev proxy for `/api` and `/socket.io` → backend (this avoids CORS during dev; keep CORS enabled anyway).

**Done when:** `docker compose up -d` and `pnpm dev` start both apps; the backend exits with a clear message when e.g. `TARGET_REPO_PATH` is missing; `pnpm lint` passes.

---

## Phase 2 — Data model, migration, state machine

Goal: the schema exists in Postgres, and every status change goes through one tested module.

### Entities
- [x] **2.1** `Ticket` entity with all columns from the spec: uuid PK, `number` (unique, generated identity/serial), `title` varchar(200), `description`, `context?`, `rules?`, `priority` enum (default medium), `status` enum (default pending), `sessionId?`, `branchName?`, `worktreePath?`, `agentSummary?`, `attemptCount` (0), `lastError?`, `totalCostUsd` numeric(10,4) (0; add a transformer that returns it as a number), `lockedAt?` timestamptz, `position` int, `createdAt`, `updatedAt`.
- [x] **2.2** Composite index on `(status, priority, position, createdAt)`. Note that a Postgres enum sorts in declaration order, so declare `urgent, high, medium, low` to get the right `ORDER BY priority`.
- [x] **2.3** `TicketEvent` entity: uuid, `ticketId` FK with cascade delete (indexed), `type` enum, `author` enum, `body` text, `meta` jsonb nullable, `createdAt` timestamptz.
- [x] **2.4** `Setting` entity: `key` (PK varchar), `value` (jsonb or text).

### Migrations
- [x] **2.5** `database/data-source.ts` for the TypeORM CLI (reads `DATABASE_URL`), with `synchronize: false` and `migrationsRun: false`.
- [x] **2.6** Generate the initial migration from the entities and review it by hand (enums, index, FK).
- [x] **2.7** A second migration that seeds the default settings: `globalRules = ""`, `workerEnabled = true`.
- [x] **2.8** Wire up `pnpm db:migrate` and test it against an empty database.

### Services
- [x] **2.9** `EventsService`: `append(ticketId, type, author, body, meta?)` saves the event and emits `ticket.event` (through an injected emitter so it's testable). Also `listForTicket(ticketId)`, oldest first.
- [x] **2.10** `SettingsService`: `get()` and `update()` with a typed `{ globalRules, workerEnabled }`, cached in memory and refreshed on write.
- [x] **2.11** `TicketStateMachine` (`tickets/ticket-state-machine.ts`):
  - a transition table keyed `from → to` with an `actor` (`worker` | `human` | `system`)
  - `transition(ticketId, to, { actor, reason?, patch? })` that, inside a DB transaction:
    1. loads the ticket with `FOR UPDATE`
    2. validates the transition and actor (invalid → `ConflictException` 409)
    3. applies side effects and the patch (`lockedAt`, `attemptCount++`, `lastError` cleared or set)
    4. saves the ticket
    5. writes a `status_changed` event with `meta: {from, to}`
  - after commit, emits `ticket.updated`
  - enforces "only the worker enters or leaves `in_progress`" (except cancel, which aborts first)
  - moves a requeued ticket back to `pending` with its priority and position unchanged
- [x] **2.12** Unit tests: every allowed transition succeeds with its side effects, every forbidden pair (the full status × status matrix) throws 409, and an actor mismatch throws. Run them against a real Postgres test DB, or mock the repository with an in-memory fake; prefer real Postgres via docker for the transaction semantics.

**Done when:** the migration runs on a clean DB and the state-machine tests are green.

---

## Phase 3 — Tickets & Settings REST API, realtime gateway

Goal: everything the UI needs, except the agent and git-backed endpoints.

- [x] **3.1** DTO classes with class-validator: `CreateTicketDto` (title 1–200, description required, context/rules optional, priority enum optional), `UpdateTicketDto` (all optional, plus `position` int), `AnswerDto { message }`, `RejectDto { feedback }` (required, non-empty), `RetryDto { note? }`, `UpdateSettingsDto`, `ListTicketsQuery { status?, priority?, q? }`.
- [x] **3.2** `TicketsService`:
  - `create`: assigns `position` = max position in that priority + 1, writes a `created` event, emits `ticket.created`, and signals the worker wake-up emitter
  - `list` with filters (`q` = `ILIKE` on title)
  - `get` with its events
  - `update`, rejected with 409 when `in_progress`; a priority change keeps the same position
- [x] **3.3** `TicketsController` thin endpoints: `GET /tickets`, `GET /tickets/:id`, `POST /tickets`, `PATCH /tickets/:id`, plus the action endpoints, which call the state machine:
  - `POST /:id/answer`: appends `human_answer`, then needs_context → pending, then wakes the worker
  - `POST /:id/reject`: appends `review_rejected`, then review → pending, then wakes the worker
  - `POST /:id/retry`: failed → pending, clears `lastError`, stores the note as an event, then wakes the worker
  - `POST /:id/cancel`: → cancelled. The abort hook and worktree removal come in Phase 8, so leave an interface (`AgentRunControl.abort(ticketId)`) that Phase 5 implements.
  - `POST /:id/approve`: route defined here, implemented in Phase 7
  - `POST /:id/start-fresh`: clears `sessionId`; allowed when not in progress
- [x] **3.4** `ParseUUIDPipe` on `:id`; 404 for unknown tickets.
- [x] **3.5** `SettingsController`: `GET /settings` and `PUT /settings`. The response also includes read-only `repoPath` and `baseBranch` for the settings modal, plus `startupWarning?` (Phase 8).
- [x] **3.6** `RealtimeGateway` (Socket.IO): listens to the internal event emitter (`@nestjs/event-emitter`) and broadcasts `ticket.created`, `ticket.updated`, `ticket.event` and `agent.status`. All event names come from `shared`.
- [x] **3.7** `AgentStatusController`: `GET /agent/status`. For now it returns `{ state: 'idle', ticketId: null, queueLength }`.
- [x] **3.8** Smoke tests (supertest): create → list → get → patch → cancel; check that validation errors return 400 with a readable message, and that an invalid transition returns 409.

**Done when:** every endpoint works from curl/HTTP files, and a socket client receives events when tickets change.

---

## Phase 4 — Board UI with create/edit and live updates (no worker yet)

Goal: a polished, live-updating board where tickets can be created and edited by hand.

### Foundations
- [x] **4.1** Tailwind theme tokens: background `#F7F7F5`, surface `#FFFFFF`, border `#E5E5E1`, text `#1F1F1D` / `#6B6B66`, accent `#4F46E5`, radius 8px (cards) / 6px (controls), base 14px, metadata 13px, max `shadow-sm`. Light theme only, so no `dark:` classes anywhere.
- [x] **4.2** `api/client.ts`: a typed fetch wrapper that throws `ApiError { statusCode, message }`; one function per endpoint, using `shared` types.
- [x] **4.3** `api/queries.ts`: TanStack Query hooks (`useTickets`, `useTicket(id)`, `useSettings`, `useAgentStatus`, and mutations for create/update/answer/reject/retry/cancel/approve/settings), with toasts on success and error.
- [x] **4.4** `hooks/useSocketSync.ts`: a single socket.io connection for the app. It keeps the query cache in sync:
  - `ticket.created` / `ticket.updated`: upsert into the `['tickets']` list and set `['ticket', id]`
  - `ticket.event`: append to the `['ticket', id]` events
  - `agent.status`: set `['agent-status']`

  It also tracks connection state for the "Reconnecting…" banner.
- [x] **4.5** Toast system (small custom one or `sonner`), plus skeleton components.

### Components
- [x] **4.6** `Header`: app name; worker status pill ("Idle" or "Working on #42" with a pulsing dot); a pause/resume switch (→ `PUT /settings`); a settings button; a "New ticket" button with an `N` shortcut that is ignored while typing in an input.
- [x] **4.7** `Board` and `Column`: columns for Pending, In progress, Needs context, Review and Done, plus a collapsible "Failed / Cancelled" column. Each column header has a colored dot (gray, indigo, amber, teal, green, red) and a count. Columns scroll independently, the board scrolls horizontally on narrow screens, and each column has an empty state.
- [x] **4.8** `TicketCard`: `#number`, title (2-line clamp), `PriorityBadge` (urgent red, high orange, medium blue, low gray), relative updated time, attempts badge if > 1, and an attention marker for needs_context or review. Cards are sorted with `compareTickets` from shared.
- [x] **4.9** `TicketFormModal` (new and edit): title, priority select, description/context/rules markdown textareas with a preview toggle (`react-markdown`), and inline validation.
- [x] **4.10** `TicketDrawer`, routed at `/tickets/:id` over the board:
  - header: number, title, status, an editable priority select, and status-dependent actions (Edit, Cancel, Retry, Start fresh)
  - tabs: Details, Activity, Diff. The Diff tab is a placeholder until Phase 7.
- [x] **4.11** `ActivityTimeline`: renders TicketEvents with an icon per type and the author. `agent_log` entries are compact, and the timeline updates live.
- [x] **4.12** Drag and drop (`@dnd-kit/core`):
  - only transitions allowed by `HUMAN_ALLOWED_TRANSITIONS` can be dragged
  - dropping onto an invalid column snaps back
  - drops that need input (Review → Pending needs feedback, Failed → Pending allows a note) open the matching modal
  - dragging within a column reorders it by updating `position` through PATCH
- [x] **4.13** `SettingsModal`: global rules textarea, read-only repo path and base branch.

**Done when:** tickets can be created, edited, reprioritized and cancelled; a second browser tab updates live with no refresh; `pnpm lint` (oxlint) is clean.

---

## Phase 5 — Git module

Goal: safe, tested git operations through `execFile` only.

- [x] **5.1** `git/git.service.ts` with a private `run(args: string[], cwd)` helper that uses `execFile('git', args)` (never a shell string), sets a timeout and `maxBuffer`, and throws a typed `GitError` that includes stderr.
- [x] **5.2** `createWorktree(ticket)`: branch `agent/ticket-<n>`, path `<WORKTREES_DIR>/ticket-<n>`.
  - If the worktree path exists and is registered, reuse it.
  - If only the branch exists, run `git worktree add <path> <branch>` (no `-b`).
  - Otherwise run `git worktree add -b <branch> <path> <BASE_BRANCH>`.
  - Returns `{ branchName, worktreePath }`; the caller persists them on the ticket.
- [x] **5.3** `hasNewCommits(ticket)`: `git rev-list --count <BASE>..<branch>` > 0.
- [x] **5.4** `hasUncommittedChanges(worktreePath)` and `commitAll(worktreePath, message)`, using `git add -A` and `git commit -m <msg>` as separate args. These are the fallback for an agent that forgot to commit.
- [x] **5.5** `diff(ticket)`: `git diff <BASE>...<branch>` for the patch and `git diff --numstat <BASE>...<branch>` for the file list. Binary files report `-`, which should map to 0 with a `binary` flag.
- [x] **5.6** `merge(ticket)`: in `TARGET_REPO_PATH`, verify it is on `BASE_BRANCH` with a clean tree, then run `git merge --no-ff -m "Merge ticket #<n>: <title>" <branch>`. On a non-zero exit, run `git merge --abort` and throw a `MergeConflictError` that lists the conflicting files.
- [x] **5.7** `removeWorktree(ticket, { deleteBranch })`: `git worktree remove --force <path>`, then `git branch -D <branch>` when asked, then `git worktree prune`. Tolerates the worktree already being gone.
- [x] **5.8** `checkBaseRepoClean()`: current branch == BASE and `git status --porcelain` is empty. Used at startup.
- [x] **5.9** Tests that create a temp repo in `os.tmpdir()` (init, commit, base branch) and cover:
  - create a worktree, then reuse it
  - commit in the worktree, then `hasNewCommits` and `diff`
  - a clean merge
  - a conflicting merge: aborted, base left clean
  - remove the worktree and branch
  - ticket titles containing shell metacharacters (`"; rm -rf /`) are handled safely

**Done when:** the git tests pass locally.

---

## Phase 6 — Agent worker: happy path (pending → in progress → review)

Goal: the worker claims tickets in priority order, runs the agent in the ticket's worktree, and lands the result in Review.

### Queue & claiming
- [x] **6.1** `TicketsRepository.claimNext()`: a single statement, `UPDATE tickets SET status='in_progress', locked_at=now(), attempt_count=attempt_count+1 WHERE id = (SELECT id FROM tickets WHERE status='pending' AND locked_at IS NULL ORDER BY priority, position, created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`. This claim goes through the state machine's side-effect and event logic: add a `stateMachine.recordClaim(ticket)` helper that writes the `status_changed` event and emits the update, so the claim stays atomic.
- [x] **6.2** Test: two concurrent `claimNext()` calls never return the same ticket; order is urgent > high > medium > low, then position, then createdAt.

### Worker service
- [x] **6.3** `agent/agent-worker.service.ts`:
  - starts its loop in `onApplicationBootstrap`, without awaiting it
  - each iteration is wrapped in try/catch, so the loop never dies
  - while `workerEnabled` is false, it sleeps `POLL_INTERVAL_MS`
  - the sleep can be interrupted by a wake-up signal (an `EventEmitter`/promise resolver triggered by create, answer, reject, retry, or a settings change)
  - keeps `running: Map<ticketId, AbortController>` (sized for future concurrency, with `MAX_CONCURRENCY = 1`)
  - emits `agent.status` whenever its state changes, and the status endpoint reads from it
- [x] **6.4** `agent/run-state.ts`: per-run object `{ outcome?: 'review' | 'needs_context' | 'failed', summary?, testing?, questions?, reason?, finishCalls: number }`.
- [x] **6.5** `agent/board-tools.ts`: `buildBoardServer(ticketId, runState)` using `createSdkMcpServer({ name: 'board', tools: [...] })` with zod schemas. A second finishing call is rejected with a tool error message.
  - `submit_fix({ summary, testing })`: sets `outcome = review` and writes an `agent_summary` event (body = summary + testing; meta holds both fields)
  - `request_context({ questions: string[1..5], reason })`: sets `outcome = needs_context` and writes one `agent_question` event (meta.questions)
  - `give_up({ reason })`: sets `outcome = failed`
  - `add_note({ message })`: writes an `agent_log` event with `meta.kind = 'note'` and is not a finishing call
- [x] **6.6** `agent/prompt-builder.ts`: pure functions `buildSystemAppend({ branchName, baseBranch, globalRules })`, `buildFirstRunPrompt(ticket)`, `buildAnswerResumePrompt(qaPairs)`, `buildRejectResumePrompt(feedback)`, `buildRetryResumePrompt(lastError, note?)`, and `FINISH_REMINDER`. The text comes verbatim from the spec.
- [x] **6.7** Snapshot or unit tests for each prompt builder.
- [x] **6.8** `agent/agent-runner.ts`: `run(ticket, prompt, runState, abort)` calls `query()` with the options from the spec (cwd = worktree, `resume`, `model`, `systemPrompt` preset `claude_code` + append, `settingSources: ['project']`, `permissionMode: 'acceptEdits'`, `allowedTools` + extras + `mcp__board__*`, `disallowedTools`, `mcpServers`, `maxTurns`, `abortController`). It consumes the stream as follows:
  - `system/init`: saves `session_id` to the ticket immediately, the first time only
  - `assistant`: for each `tool_use` block, builds a one-line summary (`Edit src/x.ts`, `Bash git commit -m …`, `Grep "foo"`). Logs are throttled: they're coalesced and flushed at most every ~2s or every N entries, with a cap per run.
  - `result`: adds `total_cost_usd` to the ticket and records `subtype` and errors
- [x] **6.9** Outcome resolution in the worker after the stream:
  - no finishing call: resume once with `FINISH_REMINDER`; still none → failed
  - `review`: if `hasUncommittedChanges`, run `commitAll("ticket #<n>: <title>")`. If there are still no new commits, the ticket fails ("agent reported a fix but made no changes"). Otherwise store `agentSummary` and move in_progress → review.
  - `needs_context` → needs_context
  - `failed` → failed with `lastError = reason`
  - result error subtype (e.g. max turns) with no finishing call → failed with that reason
  - thrown error → `lastError` + `error` event → failed
  - finally: clear `lockedAt`, remove from `running`, emit status
- [x] **6.10** `scripts/seed-sample-repo.sh`: creates `~/agent-board-sample` with a tiny TS/JS project containing 2–3 obvious bugs (an off-by-one, a wrong comparison, a typo in an output string), a test script that fails, a `CLAUDE.md`, and a commit on `main`.

**Done when:** a clear bug ticket goes Pending → In progress → Review against the sample repo, with a summary, testing notes, a commit on `agent/ticket-<n>`, a session ID saved, and cost recorded; three tickets with different priorities are processed in priority order.

---

## Phase 7 — Needs-context loop & review flow

Goal: the two human feedback loops work end to end, resuming the same session.

### Needs context
- [x] **7.1** The answer endpoint (from Phase 3) now drives a resume. On the next claim, the worker sees `sessionId` set and builds the resume prompt from the events since the last run: the latest `agent_question` and the `human_answer` events after it.
- [x] **7.2** `agent/resume-context.ts`: `determineResumePrompt(ticket, events)`. A pure function that picks answer, reject or retry mode by finding the most recent human-triggered requeue event, falling back to the first-run prompt when there is no `sessionId`. Unit-test it.
- [x] **7.3** Frontend `NeedsContextPanel` in the drawer: the agent's questions as a numbered list, the reason, an answer textarea, and a "Send answer & requeue" button.

### Review
- [x] **7.4** `GET /tickets/:id/diff` → `DiffDto` (allowed in review/done; for done, diff the merge commit range, or store the diff at approval time. Simplest option: snapshot the diff into a `review_approved` event's meta at approve time and serve that for done tickets).
- [x] **7.5** `POST /tickets/:id/approve`: run `git.merge`. A `MergeConflictError` returns 409 with a clear message and the ticket stays in review (also log an `error` event). On success, `removeWorktree({ deleteBranch: true })`, then a `review_approved` event, then review → done.
- [x] **7.6** Reject flow: on resume, the worktree and branch are reused and the agent revises the fix on the same branch.
- [x] **7.7** Frontend `ReviewPanel`: the agent summary and testing notes (markdown), then `DiffViewer` (a file list with +/- counts, and a unified diff per file with added/removed line coloring, via `react-diff-view` + `gitdiff-parser` or a small custom renderer). Buttons: **Approve & merge** (primary, loading state; a conflict shows as a toast) and **Reject** (opens a required feedback textarea).
- [x] **7.8** Diff tab enabled for review and done.

**Done when:**
- a vague ticket ends in Needs context with specific questions
- answering it requeues the ticket, and the same `sessionId` continues
- rejecting with feedback produces a revised commit on the same branch
- approve merges and removes the worktree
- a forced conflict shows an error and leaves the ticket in Review

---

## Phase 8 — Failure, retry, cancel, crash recovery, pause, startup checks

Goal: the system holds up under failure and is safe to leave running.

- [x] **8.1** Retry: failed → pending, clears `lastError`, and the resume prompt includes the previous error and the optional note. The drawer shows a Retry button with an optional note field.
- [x] **8.2** Cancel:
  - if in progress, call `abort()` on the run's controller, wait for the run to unwind, and make sure the worker's outcome logic sees the abort and leaves the ticket cancelled rather than failed
  - remove the worktree and delete the branch
  - allowed from any status except done
- [x] **8.3** Start fresh: a secondary action that clears `sessionId` (and optionally resets the worktree to base, behind a confirmation).
- [x] **8.4** Crash recovery: in `onApplicationBootstrap`, before the loop starts, move every `in_progress` ticket → pending with a `system` event ("Recovered after API restart; the previous run was interrupted"), clearing `lockedAt`. The state machine needs a `system`-actor transition for this.
- [x] **8.5** Shutdown: `app.enableShutdownHooks()`. On `onApplicationShutdown`, abort the running query and do **not** change the status; crash recovery takes care of it on the next boot.
- [x] **8.6** Startup repo check: if `checkBaseRepoClean()` fails, force `workerEnabled = false` for this boot and expose `startupWarning` in settings/status. The UI shows a yellow banner explaining why the worker is paused.
- [x] **8.7** Pause switch: toggling it emits `agent.status` and wakes the loop. Pausing doesn't interrupt the current run, it only stops new claims.
- [x] **8.8** Polish:
  - loading skeletons for the board and drawer
  - empty states for every column
  - toasts for every action
  - a "Reconnecting…" banner
  - focus rings in the accent color
  - keyboard: `N` for new ticket, `Esc` closes the drawer or modal
  - accessible labels, so jsx-a11y passes
- [x] **8.9** Unit tests for the worker's outcome resolution (mock the runner): no finishing call, then reminder, then failed; submit_fix without changes; a result error subtype; a thrown error; an abort during cancel.

**Done when:** killing the API mid-run and restarting returns the ticket to Pending; cancelling a running ticket stops the agent and cleans up the worktree; a dirty base repo starts with the worker paused and shows the banner.

---

## Phase 9 — Acceptance run, docs, final checks

Goal: demonstrate every acceptance criterion and document the system.

- [x] **9.1** Write `README.md`:
  - prerequisites
  - setup (`pnpm i`, `docker compose up -d`, `cp .env.example .env`, `scripts/seed-sample-repo.sh`, `pnpm db:migrate`, `pnpm dev`)
  - env reference
  - architecture diagram of the loop
  - ticket lifecycle table
  - how sessions and resume work
  - security notes (execFile only, tool allowlist, untrusted ticket text)
  - known limitations
  - Agent SDK differences found in 0.3
- [x] **9.2** Run every acceptance criterion against the sample repo and record the result in the README:
  - [x] 3 tickets with different priorities are processed in priority order
  - [x] a clear bug ends in Review with a summary, testing notes, a commit on `agent/ticket-<n>` and a correct diff
  - [x] a vague ticket ends in Needs context; answering it resumes the **same** `sessionId`
  - [x] a rejection produces a revised fix on the same branch
  - [x] approve merges and removes the worktree; a conflict shows an error and stays in Review
  - [x] ticket-specific rules ("do not modify tests") visibly change behavior
  - [x] killing the API mid-run and restarting puts the ticket back in Pending
  - [x] a second browser tab updates live
  - [x] `pnpm lint` is clean (oxlint in frontend, `tsc --noEmit` everywhere) and backend tests pass
- [x] **9.3** Final sweep: no TODOs or stubs in the core flow, the API key never appears in logs, every dependency version is pinned, and `pnpm build` succeeds.
- [x] **9.4** Final report: what was built, how to run it, anything incomplete, and the SDK differences.

---

## Phase 10 — Multiple projects (added after the POC)

Goal: choose and manage target repos from inside the board, instead of a single `TARGET_REPO_PATH` in `.env`.

- [x] **10.1** Shared types: `ProjectDto`, `RepoStatusDto`, `CreateProjectInput`, `UpdateProjectInput`, `RepoInspectDto`, `BrowseDto`; `projectId` on tickets; `project.created`/`project.updated`/`project.deleted` socket events.
- [x] **10.2** `projects` table and migration (`1759400000000-Projects`); `tickets.project_id` FK with cascade; queue index now starts with `project_id`.
- [x] **10.3** Projects API: `GET/POST /projects`, `GET /projects/inspect`, `GET/PATCH/DELETE /projects/:id`, and the `GET /fs/browse` folder browser.
- [x] **10.4** `GitServiceFactory.forProject()`. Each project has its own repo, base branch and worktrees in `<WORKTREES_DIR>/<slug>`; legacy tickets keep their stored worktree path.
- [x] **10.5** The worker claims across all projects in priority order and skips projects whose repo isn't ready (`blockedProjects` in the agent status) instead of pausing globally.
- [x] **10.6** Project rules and per-project extra allowed tools in the agent prompt and tool list.
- [x] **10.7** `TARGET_REPO_PATH` and `BASE_BRANCH` are now optional and only seed the first project; existing tickets were assigned to it.
- [x] **10.8** UI:
  - a header project switcher (`?project=` in the URL, remembered between visits)
  - a Manage projects modal with a folder browser, plus add, edit and delete
  - a project select in the new-ticket form, project tags on cards, a project-not-ready banner, and an empty state when there are no projects
- [x] **10.9** Checks: `pnpm lint` ✅ · `pnpm test` ✅ (285 tests: 282 backend, 3 shared) · `pnpm build` ✅ · live API smoke test ✅. Following the user's instruction to skip tests where not needed, only existing tests were updated.

## Cross-cutting rules (apply in every phase)

- **Security:** ticket text goes only to the model, never into a shell. All git calls use `execFile` with array args. The agent's tool allowlist forbids push and checkout.
- **Single source of truth:** status changes go only through `TicketStateMachine`, and enums and event names come only from `shared/`.
- **Thin controllers:** logic lives in services, controllers only map HTTP to services.
- **Concurrency-ready:** the atomic claim and `Map<ticketId, AbortController>` stay in place even with concurrency = 1.
- **Testing:** the state machine, git service, prompt builders, resume-context and worker outcome logic all have unit tests.

## Out of scope

Authentication and multiple users, multiple target repos, parallel workers (only the hooks for them are kept), pushing branches or opening PRs, dark mode, deployment.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Agent SDK option or message names differ from the spec | Phase 0.3 checks the installed types; isolate every SDK usage in `agent-runner.ts` + `board-tools.ts` |
| `shared` package resolution between Nest (CJS) and Vite (ESM) | Build `shared` to CJS + `.d.ts`; Vite pre-bundles it. If that causes friction, use TS project references with `tsc -b` |
| Agent never calls a finishing tool | One automatic reminder resume, then fail with a clear reason |
| Merge conflicts on approve | Abort the merge, 409, the ticket stays in Review, a toast explains why |
| Runaway logs or cost | Throttled `agent_log` events, `AGENT_MAX_TURNS`, cost shown on the ticket |
| Postgres enum ordering for priority | Declare the enum in rank order, and cover it with the claim-order test |
