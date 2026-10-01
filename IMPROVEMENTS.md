# Shiftboard: suggested improvements and new features

This document comes from ticket #15. It is based on a read of this repository (backend, frontend, shared, `README.md`, `PLAN.md`, `HOW_IT_WORKS.md`, `SDK_NOTES.md`) as of 2026-10-01, and a comparison with other "file a ticket, an AI agent does it" products (see [Landscape](#landscape-what-similar-tools-do)). No code was changed.

Each item says **what** to do, **why** it matters for Shiftboard in particular, and **where** in the code it would go. The effort tags are rough: **S** is under a day, **M** is a few days, **L** is a week or more.

---

## 1. Summary: the top 10

If you only do a few things, do these, roughly in this order:

| # | Item | Why now | Effort |
| --- | --- | --- | --- |
| 1 | [Bind the API to localhost and add a simple auth token](#21-the-api-listens-on-every-interface) | The API listens on all interfaces today and can browse your filesystem and run agents | S |
| 2 | [Real parallel runs (N concurrent tickets, one per worktree)](#31-real-parallel-runs) | The docs suggest extra worktrees give parallelism, but the worker still runs one ticket at a time | M |
| 3 | [Per-ticket / per-project cost budget (`maxBudgetUsd`)](#32-cost-budgets-and-a-cost-dashboard) | The runner already handles `error_max_budget_usd` but never sets a budget | S |
| 4 | [Verification gate: run tests/lint before Review](#33-verification-gate-before-review) | "Run the tests" is only a prompt rule; nothing checks it | M |
| 5 | [Push branch and open a GitHub/GitLab PR on approve (optional)](#41-push-and-open-a-pull-request) | Matches how teams actually review and merge; lets CI run | M |
| 6 | [Inline diff comments that become reject feedback](#42-inline-review-comments-on-the-diff) | Reviewing is the bottleneck; line-anchored feedback gives the agent much better input | M |
| 7 | [Rebase/refresh a stale branch before merge, and let the agent fix conflicts](#43-stale-branches-and-merge-conflicts) | Today a conflict just returns 409 and leaves the ticket stuck in Review | M |
| 8 | [Plan mode: agent proposes a plan, you approve it, then it codes](#44-plan-first-tickets) | Cheaper than reviewing a wrong diff; the SDK supports `permissionMode: 'plan'` | M |
| 9 | [Notifications (browser, Slack, email) when a ticket needs you](#51-notifications) | The whole loop waits on the human; today you have to keep the tab open | S |
| 10 | [Per-project "allow web research" and other tool presets](#24-tool-permissions-are-hard-to-manage) | This very ticket asked for web research, which the base allowlist blocks | S |

---

## 2. Security and safety

### 2.1 The API listens on every interface
- **What I found.** `backend/src/main.ts` calls `app.listen(config.apiPort)` with no host, so Node binds to all interfaces (`0.0.0.0`/`::`). The README says "Don't expose the API beyond localhost", but nothing enforces it. CORS (`app-setup.ts`) only limits browsers; `curl` from another machine on the same Wi-Fi works.
- **Why it matters.** Anyone who can reach the port can create projects, list any directory through `GET /api/fs/browse` (it starts at the home folder and follows symlinks), file tickets that an agent with `Edit`/`Write` access executes, and approve merges.
- **Suggestion.**
  1. Add an `API_HOST` env var that defaults to `127.0.0.1` and pass it to `app.listen(port, host)`. (S)
  2. Add an optional `BOARD_TOKEN`. If set, require it as a bearer token on HTTP and in the Socket.IO handshake. The frontend reads it once and keeps it in `localStorage`. (S)
  3. Later, real auth (GitHub OAuth or magic link) once there are several users (see [6.1](#61-multiple-users-and-roles)).

### 2.2 Sandbox the agent process
- The agent runs as your user, with your environment (`buildEnv()` copies all of `process.env`), so it can read anything you can read through `Read`/`Glob`/`Grep`. The worktree is only a convention, not a boundary.
- **Suggestions.**
  - Pass a minimal environment instead of `{ ...process.env }`: `PATH`, `HOME`, the API key, and an explicit per-project allowlist of variables. (S)
  - Use the SDK's sandbox settings and/or a `PreToolUse` hook (see 2.3) that rejects `Read`/`Edit`/`Write` paths outside the worktree. (S–M)
  - Optional "container mode": run each ticket in a Docker container with the worktree mounted, no network by default (the approach Codex cloud, Copilot coding agent and OpenHands take). (L)

### 2.3 Use SDK hooks for guardrails and audit
- Today the guardrails are only `allowedTools`/`disallowedTools` lists in `agent-runner.ts`. The Agent SDK also supports hooks (`PreToolUse`, `PostToolUse`, `Stop`, …).
- **Suggestions.**
  - `PreToolUse`: block paths outside the worktree, block edits to protected files (`.env`, lock files, migrations, CI config) unless the ticket allows it, and enforce ticket rules such as "Do not modify any code" mechanically instead of by prompt alone.
  - `PostToolUse`: write a complete, untruncated audit record of every tool call (the board log is deliberately throttled and truncated by `LogThrottler`).
  - `Stop`: make the "you must call a finishing tool" reminder a hook instead of a second resumed run.

### 2.4 Tool permissions are hard to manage
- Extra tools are free-text strings like `Bash(npm test:*)` in `AGENT_EXTRA_ALLOWED_TOOLS` and per project. Typos fail silently, and nothing per ticket is possible.
- **Suggestions.**
  - **Presets** in the project form: "Node tests" (`Bash(npm test:*)`, `Bash(pnpm test:*)`, `Bash(npx tsc:*)`), "Python tests", "Web research" (`WebSearch`, `WebFetch`), "Read-only" (no `Edit`/`Write`). (S)
  - **Per-ticket overrides**, e.g. a "This ticket may use the web" checkbox. Note that `DISALLOWED_TOOLS` wins over `allowedTools`, so `WebSearch`/`WebFetch` would need to move out of that hard block and into a default-off preset. (S)
  - Validate tool patterns when a project is saved and show what the agent will actually get. (S)

### 2.5 Smaller hardening items
- Rate-limit and size-limit ticket creation and attachments (`@nestjs/throttler`). (S)
- Mask secrets in agent log lines before they are stored as `agent_log` events (keys that look like `sk-…`, `ghp_…`, `AKIA…`). (S)
- Add a `Content-Security-Policy` header for the web app and attachments. (S)

---

## 3. Core worker improvements

### 3.1 Real parallel runs
- **What I found.** `AgentWorkerService.loop()` claims a ticket and then `await this.processTicket(ticket)`, so only one agent runs at a time across every project. `HOW_IT_WORKS.md` says "Add a second worktree to work on more tickets in parallel", which really means a second ticket can *run* while the first sits in Review or Needs context, not that two run at once. (The docs should say that more clearly either way.)
- **The groundwork is there:** the claim uses `FOR UPDATE SKIP LOCKED`, the run registry is a map of abort controllers, and worktrees are held per ticket.
- **Suggestion.** Add `AGENT_CONCURRENCY` (default 1) and keep up to N `processTicket` promises in flight, each in a different free worktree. Optionally cap concurrency per project. Make `agent.status` report a list of running tickets instead of one `ticketId`. (M)
- **Follow-up.** Auto-create worktrees on demand (up to a per-project limit) instead of making the user add them by hand. (S)

### 3.2 Cost budgets and a cost dashboard
- `agent-runner.ts` already maps `error_max_budget_usd` to a message, but `maxBudgetUsd` is never set, so the only limit is `AGENT_MAX_TURNS`.
- **Suggestions.**
  - `AGENT_MAX_BUDGET_USD` globally, overridable per project and per ticket. On hitting it, move to Failed with "budget reached", and let Retry raise the budget. (S)
  - A daily/monthly spend cap that pauses the worker (the existing pause switch) when reached. (S)
  - A small stats page: spend per project per week, average cost per ticket, cost per outcome (merged vs rejected vs failed), and token usage. All the data is already in `ticket_events` and `totalCostUsd`. (M)

### 3.3 Verification gate before Review
- Today "Run the project's relevant tests" is a sentence in the system prompt. The worker commits whatever is left on `submit_fix` and moves the ticket to Review even if nothing was tested.
- **Suggestion.** Give each project an optional **check command** (e.g. `pnpm lint && pnpm test`). After `submit_fix`, the worker runs it in the worktree (with a timeout, using `execFile`):
  - Pass: go to Review, and show "checks passed" with the output in the drawer.
  - Fail: resume the same session with the failing output ("Your checks failed: … Fix them and call submit_fix again"), up to K times, then go to Review marked "checks failing" or to Failed. (M)
- This is the single biggest quality lever in comparable tools (Copilot coding agent, Codex, Devin and OpenHands all run tests in the loop).

### 3.4 Per-project setup script and environment
- A fresh worktree has no `node_modules`, build output or `.env`. The agent either can't run tests or has to install dependencies itself (and usually isn't allowed to).
- **Suggestion.** An optional per-project **setup command** (e.g. `pnpm install --frozen-lockfile`) run when a worktree is created or its lock file changes, plus a list of files to copy from the main checkout (e.g. `.env`). (S–M)

### 3.5 Model and effort per project and per ticket
- `AGENT_MODEL` is global. Small typo fixes don't need the most expensive model, and hard tickets might want more thinking.
- **Suggestion.** A model picker on the project (default) and the ticket (override), plus an "effort" option, saved on the ticket and shown on the card. (S)

### 3.6 Better handling of the "repo not clean" block
- A project whose main checkout is dirty or on the wrong branch blocks all its tickets silently, apart from a banner. In practice, any uncommitted edit in the main checkout leaves tickets sitting in Pending.
- **Suggestions.**
  - Show *what* is dirty (the `git status --porcelain` list) in the banner, with "Open folder" and "Recheck now" buttons. (S)
  - Since tickets run in separate worktrees, only **approve** truly needs a clean main checkout. Consider letting runs start while the main checkout is dirty, and only blocking the merge. (M, needs a decision)

### 3.7 Smarter retries
- On Failed, allow **Retry with a different model** or **with a higher turn/budget limit**, as well as the current note. (S)
- Classify failures (rate limit, auth, max turns, budget, crash) and auto-retry transient ones (rate limit, network) with backoff instead of failing. (S)

### 3.8 Scheduled and recurring tickets
- "Every Monday: update dependencies and fix what breaks", "Nightly: fix new lint warnings". A cron field on a ticket template that files a new ticket on schedule. (M)

---

## 4. Review workflow

### 4.1 Push and open a pull request
- Approve currently runs `git merge --no-ff` locally, and branches are never pushed. That suits solo use, but most teams review in GitHub/GitLab, where CI and code owners run.
- **Suggestion.** A per-project **merge strategy**:
  1. *Local merge* (today's behaviour, default).
  2. *Push and open a PR*: push `agent/ticket-<n>` to a configured remote and open a PR with the agent's summary and testing notes as the body, linking back to the ticket. The ticket moves to a new **In PR** status (or stays in Review with a PR link) and goes to Done when the PR is merged (poll the API or use a webhook).
- This also lets PR review comments flow back as reject feedback (see 4.2). (M)

### 4.2 Inline review comments on the diff
- Rejecting means writing one free-text feedback box. Reviewers think in lines.
- **Suggestion.** Let the reviewer click a line in `DiffViewer` to leave a comment, then "Request changes" sends them all. The resume prompt lists them as `path:line — comment` with the surrounding hunk, so the agent knows exactly where to look. (M)
- Smaller wins in the same area: per-file "viewed" checkboxes, collapse large files, a split (side-by-side) view, syntax highlighting, and "show full file". (S each)

### 4.3 Stale branches and merge conflicts
- A branch is created from the base branch when the ticket starts. If other tickets merge first, approval can hit a conflict, and today that returns 409 and leaves the ticket stuck in Review with a toast.
- **Suggestions.**
  - Show "base has moved N commits since this branch was created" in the review panel. (S)
  - A **"Resolve conflicts"** action that requeues the ticket with a prompt like "Merge `<base>` into your branch and resolve the conflicts in: …". The agent would need `Bash(git merge:*)` for this run only. (M)
  - Optionally a **merge queue**: approve several tickets and let the board merge them one by one, refreshing each branch first. (M)

### 4.4 Plan-first tickets
- **Suggestion.** A "Plan first" checkbox on a ticket (or a project default). The first run uses `permissionMode: 'plan'` (read-only) and ends with a new board tool, `submit_plan`, which moves the ticket to a **Plan review** status. Approve resumes the same session in edit mode; reject sends plan feedback. Reviewing a 10-line plan is much cheaper than reviewing a wrong 300-line diff. (M)

### 4.5 Best-of-N attempts
- For hard tickets, start 2–3 runs in separate worktrees (optionally with different models) and let the reviewer pick the best diff; the others are discarded. Codex and Cursor both offer this. It depends on [3.1](#31-real-parallel-runs). (M)

### 4.6 Partial approval and follow-ups
- "Approve and file a follow-up": merge, and create a new ticket pre-filled from what's left (the agent could suggest follow-ups in `submit_fix`). (S)
- Let the agent propose new tickets it noticed while working (a `suggest_ticket` board tool that lands in a "Suggestions" inbox, not straight into Pending). (S)

---

## 5. Board UX

### 5.1 Notifications
- The loop waits on you, but you only find out by watching the board.
- **Suggestions.**
  - Browser notifications and a tab-title badge ("(2) Shiftboard") when a ticket enters Needs context, Review or Failed. (S)
  - A Slack/Discord/email webhook per project for the same events. (S)
  - Later, two-way Slack: answer a question or approve from a Slack message. (L)

### 5.2 Live run view
- `agent_log` events are throttled (text excerpts at most every 15 s, 160 chars) to keep the timeline readable. That's good for the timeline, but when something goes wrong you want everything.
- **Suggestion.** A "Full transcript" tab that reads the SDK session transcript for the ticket's `sessionId` and renders every message, tool call and result. Plus a live "what files has it touched so far" panel (from `git diff --stat` in the worktree). (M)

### 5.3 Steering a running agent
- Today you can only cancel a run. Add **"Send a message"** while it runs (the SDK's streaming input mode can take extra user messages mid-run) and **"Stop and ask me"**, which interrupts and moves to Needs context. (M)

### 5.4 Ticket creation helpers
- **Templates** per project (bug, feature, refactor, docs) with default rules, priority and tools. (S)
- **"Improve this ticket"**: a cheap model call that rewrites a vague description and suggests acceptance criteria before filing. That reduces the Needs context round-trips. (S)
- **Acceptance criteria** as a checklist field, shown to the agent and checked off in review. (S)
- **Dependencies**: "blocked by #12" so a ticket isn't claimed until its blocker is Done. (M)
- **Bulk create** from a pasted list or markdown, and **import** from GitHub Issues / Linear / Jira. (M)
- **Labels/tags** and filters by label. (S)

### 5.5 Search, filters and history
- The API already supports `?q=`, `status` and `priority`. Make sure the UI exposes them, and add an **archive** view for Done/Cancelled with search over summaries and diffs. (S)
- Keyboard shortcuts: `n` new ticket, `j`/`k` to move between cards, `a` approve, `r` reject. (S)

### 5.6 Analytics
- Per project: tickets per status over time, success rate (merged on the first review vs after rejections), mean Needs-context rounds, time from filed to Done, and cost (see 3.2). This tells you which kinds of tickets the agent is good at. (M)

---

## 6. Platform and scale

### 6.1 Multiple users and roles
- Out of scope for the POC. When needed: users, "who filed / who approved" on every event, roles (viewer, filer, approver), and approval rules (e.g. migrations need an admin). (L)

### 6.2 Remote and multiple workers
- Split the worker into its own process (it already shares nothing with the API except the DB and Socket.IO broadcasts), so several machines can claim from the same queue. The `SKIP LOCKED` claim already makes that safe. Worktrees would then live on the worker machine, and the review diff would come from a pushed branch. (L)

### 6.3 Project knowledge and memory
- The agent gets the repo's `CLAUDE.md` via `settingSources: ['project']`, and the project/global rules. Nothing it learns carries over between tickets.
- **Suggestions.**
  - Edit the project's `CLAUDE.md` from the Projects modal. (S)
  - After a ticket is approved, ask the agent (cheaply) for "lessons for future tickets in this repo" and keep them in a reviewable per-project notes list that is added to the system prompt. (M)
  - Include reject feedback history in that list ("the reviewer prefers X over Y"). (M)

### 6.4 MCP servers per project
- Let a project attach MCP servers (a database, Sentry, Figma, a browser for UI checks via Playwright) next to the in-process `board` server. That turns "check the error in Sentry and fix it" into a valid ticket. (M)

### 6.5 Triggers from outside the board
- A small public endpoint or CLI (`shiftboard new "Fix X" --project api --priority high`) to file tickets from scripts, git hooks or CI ("a test failed on main: open a ticket with the log"). (S)
- A GitHub webhook: label an issue `shiftboard` to import it as a ticket. (M)

### 6.6 Deployment
- A production `docker-compose` (API, web build served statically, Postgres, MinIO), health checks (`/api/health`), structured logs, and backups of the Postgres volume. (M)

---

## 7. Code and documentation housekeeping

- **Docs disagree on parallelism.** `README.md` says "one worker running one ticket at a time", while `HOW_IT_WORKS.md` says a second worktree lets you "work on more tickets in parallel". Clarify which is meant (see 3.1). (S)
- **`PLAN.md` "Out of scope"** still lists "multiple target repos" and "dark mode", which now exist (projects, `useTheme`). Update it or mark it historical. (S)
- **Finishing tool vs "no code changes" tickets.** `submit_fix` fails when there are no changes, which is right for code tickets. For research/question tickets ("analyse X and tell me"), add a ticket type or a `submit_answer` tool whose result is a markdown answer in the drawer, with no branch to merge. (S–M)
- **Frontend tests.** The backend and shared code are well tested; the frontend has none. Add Vitest + Testing Library for the drawer flows (answer, approve, reject) and one Playwright smoke test of the whole loop with a mocked SDK. (M)
- **CI.** Add a GitHub Actions workflow running `pnpm lint`, `pnpm test` (with a Postgres service) and `pnpm build`. (S)

---

## 8. More ideas borrowed from other tools

These come from the landscape below and aren't covered above:

- **Take over locally.** An "Open in terminal" button that runs `claude --resume <sessionId>` in the ticket's worktree, so you can finish a nearly-done ticket by hand with the agent's context intact (Claude Code "teleport", Cursor takeover). (S)
- **AI review pass before human review.** A second, read-only agent run (a cheaper model is fine) reviews the diff against the ticket and posts findings in the drawer before you look (Cursor BugBot, Codex review). (M)
- **Checkpoints.** Have the agent commit (or the worker snapshot) after each meaningful step, and let the reviewer "reset to checkpoint N and continue from there" (Conductor). (M)
- **Dev-server preview.** For web projects, a per-project "preview command" that starts the app from the worktree and links the URL, or attaches a screenshot, on the ticket (Vibe Kanban). (M)
- **Shiftboard as an MCP server.** Expose `create_ticket`, `list_tickets` and `ticket_status` over MCP so Claude Code sessions (or other agents) can file and track tickets on the board. (M)
- **Autonomy levels.** A per-project setting of low/medium/high autonomy that maps to tool presets, plan-first on or off, and whether checks must pass before Review (Factory). (S once 2.4, 3.3 and 4.4 exist)

---

## Landscape: what similar tools do

> **Caveat on sources.** The ticket asked for web research. In this run the agent's `WebSearch` and `WebFetch` tools are blocked by Shiftboard's own `DISALLOWED_TOOLS` (see [2.4](#24-tool-permissions-are-hard-to-manage)), so the pages below were **not fetched live**. This summary comes from the model's knowledge as of mid-2026. Treat product details, especially pricing, limits and product status, as unverified, and check the linked docs before relying on any of it.

| Tool | Trigger | Isolation | Review flow | Notable features |
| --- | --- | --- | --- | --- |
| **GitHub Copilot coding agent** | Assign an issue to Copilot; Slack, Teams, Linear, Jira | GitHub Actions runner with an outbound firewall | Opens a draft PR early and iterates on `@copilot` review comments | `copilot-setup-steps.yml` setup, MCP per repo, can only push to `copilot/*`, the person who assigned the task can't approve the PR |
| **OpenAI Codex (cloud)** | Web, CLI, IDE, `@codex` on GitHub, Slack, Linear | Container per task; internet on for setup, off by default afterwards | Diff with log citations, then "Create PR" | Best-of-N (1–4 attempts), automatic PR code review, `AGENTS.md` |
| **Devin** | Slack, Linear, Jira, API | VM per session, from a snapshot | PRs plus Devin Review | Interactive planning before acting, a Knowledge store it suggests additions to, Playbooks, live shell/browser you can take over, cost in ACUs |
| **Cursor background agents** | Editor, web/mobile, Slack, Linear, GitHub | Remote VM; local worktrees for parallel runs | Branch or PR, take over in the IDE | `environment.json` setup, several models in parallel to compare, BugBot reviewer |
| **Claude Code (GitHub Actions / on the web)** | `@claude` in issues and PRs; web, Slack, mobile | Your runners / cloud sandbox with a network policy | Opens PRs; parallel tasks, each on its own branch | Steer mid-run, teleport the session to the local CLI; the Agent SDK offers hooks, permission modes, subagents, MCP and cost data |
| **Google Jules** | Web, CLI/API, GitHub issue labels | Cloud VM with a setup snapshot | Plan approval, then diff, then PR | Plan-first by default, concurrency limits per tier, proactive TODO suggestions |
| **OpenHands** (open source) | `fix-me` label or `@openhands` mention, Slack/Jira/Linear in the cloud | Docker sandbox | Opens a PR | Self-hostable, replayable event stream, keyword-triggered "microagents" for knowledge, cost budget, security analyzer for risky actions |
| **Linear agents** | Assign or delegate an issue to an agent "app user" | Depends on the agent | In the issue | Agent Sessions API streams thoughts, actions, responses and *elicitations* into the issue; a human stays the owner. A good model for Shiftboard's timeline |
| **Factory** | Slack, Linear, Jira, CLI, CI | Varies | PRs | Specialised "droids", org-wide memory, spec mode (plan then approve), low/medium/high autonomy levels, headless exec in CI |
| **Vibe Kanban** (open source) | Local kanban board | Git worktree per attempt | Built-in diff with inline comments sent back to the agent; rebase, merge or PR | Closest analogue to Shiftboard: several attempts per task, several agent CLIs, setup/dev-server scripts, dev-server preview, MCP server for creating tasks |
| **Conductor** | Mac app | Worktree per workspace | Diff UI, then PR | Parallel Claude Code/Codex agents, setup scripts per repo, usage view, checkpoints and revert |
| **Sweep, Terragon** | Issue labels / web, CLI, Slack | Cloud sandbox | Automatic PRs | Earlier label-to-PR bots; both have reportedly pivoted or wound down |

**Patterns most of these share, and where Shiftboard stands:**

| Pattern | Shiftboard today | Suggested item |
| --- | --- | --- |
| Isolation per task | Git worktree, same user and environment | 2.2 |
| Setup script per repo | None | 3.4 |
| Tests or CI in the loop | Prompt rule only | 3.3 |
| Plan before code | No | 4.4 |
| Parallel tasks / best-of-N | One run at a time | 3.1, 4.5 |
| Review as a PR with inline comments | Local merge, one feedback box | 4.1, 4.2 |
| Asking the human questions (elicitation) | **Yes**: structured `request_context` with options. This is ahead of several tools | — |
| Resuming the same session after feedback | **Yes**: `resume` with the saved `sessionId` | — |
| Notifications and Slack triggers | None | 5.1, 6.5 |
| Cost per task and budgets | Cost shown, no budget | 3.2 |
| Learned project memory | `CLAUDE.md` and rules only | 6.3 |
| Steering and takeover | Cancel only | 5.3, 8 |

**Docs to check (not fetched in this run):**
- GitHub Copilot coding agent: https://docs.github.com/en/copilot/concepts/agents/coding-agent
- OpenAI Codex cloud: https://developers.openai.com/codex/cloud
- Devin: https://docs.devin.ai
- Cursor background agents: https://docs.cursor.com/background-agent
- Claude Code GitHub Actions: https://docs.claude.com/en/docs/claude-code/github-actions
- Claude Agent SDK: https://docs.claude.com/en/api/agent-sdk/overview
- Google Jules: https://jules.google/docs
- OpenHands: https://docs.all-hands.dev
- Linear agents: https://linear.app/docs/agents-in-linear and https://linear.app/developers/agents
- Factory: https://docs.factory.ai
- Vibe Kanban: https://github.com/BloopAI/vibe-kanban
- Conductor: https://conductor.build
