# Shiftboard: ideas for what to build next

A plain-language list of improvements, from ticket #15. Each idea says what it would do for you. Size is a rough guess: **small** (about a day), **medium** (a few days), **large** (a week or more).

## Do these first

1. **Lock down the server.** Right now anyone on the same Wi-Fi can reach Shiftboard, browse your files and start the agent. Make it accept connections only from your own computer, with an optional password. *Small.*
2. **Run several tickets at the same time.** Extra worktrees let a new ticket start while another waits for your review, but only one agent ever works at once. Let it run one agent per worktree in parallel. *Medium.*
3. **Set a spending limit.** Give each ticket or project a maximum dollar amount; the agent stops when it reaches it. *Small.*
4. **Check the work before review.** Today "run the tests" is just a request to the agent. Run the project's tests automatically before a ticket reaches Review, and send failures back to the agent to fix. *Medium.*
5. **Get notified.** A browser notification (or a Slack/email message) when a ticket needs your answer or review, so you don't have to keep the tab open. *Small.*

## Make reviewing easier

- **Comment on specific lines of the diff.** Click a line, leave a note, and send all notes back to the agent together, instead of one big feedback box. *Medium.*
- **Plan first, then code.** For bigger tickets, the agent first writes a short plan for you to approve. Fixing a bad plan is cheaper than fixing a bad change. *Medium.*
- **Fix merge conflicts for you.** When approving fails because the code changed underneath, one button sends the ticket back so the agent can resolve the conflict. *Medium.*
- **Open a pull request instead of merging locally** (optional per project), so your normal GitHub/GitLab review and CI run. *Medium.*
- **Ask a second agent to review first.** A cheaper model checks the change against the ticket and flags problems before you look. *Medium.*
- **Try a hard ticket 2–3 times and pick the best result.** Needs parallel runs (item 2). *Medium.*

## Make the agent better at its job

- **Setup step per project.** Install dependencies (and copy files like `.env`) when a worktree is created, so the agent can actually run tests. *Small to medium.*
- **Choose the model per project or ticket.** Use a cheaper model for small fixes and a stronger one for hard work. *Small.*
- **Retry smarter.** Retry with a different model or a higher limit, and automatically retry temporary errors such as rate limits. *Small.*
- **Remember lessons.** After each approved ticket, save short notes ("this repo uses pnpm", "reviewer prefers X") and give them to the agent next time. *Medium.*
- **Allow web research when you want it.** Add an easy "this ticket may use the web" option, plus ready-made tool presets per project instead of typed tool strings. *Small.*
- **Answer-only tickets.** Today a ticket must end in a code change. Let research and question tickets end with a written answer instead. *Small to medium.*

## Make the board nicer to use

- **Talk to a running agent.** Send it a message mid-run, or tell it to stop and ask you, instead of only being able to cancel. *Medium.*
- **See everything the agent did.** A full transcript view and a live list of files it has touched. *Medium.*
- **Better ticket creation.** Templates (bug, feature, docs), an "improve my description" button, a checklist of acceptance criteria, labels, and "blocked by #12". *Small each.*
- **Search and archive.** Search old tickets, filter by label, and use keyboard shortcuts for approve and reject. *Small.*
- **Stats.** Spend per project, success rate and time to done, which shows what kinds of tickets the agent handles well. *Medium.*
- **Take over by hand.** An "Open in terminal" button that continues the agent's session in Claude Code on your machine. *Small.*

## Safety

- **Keep the agent inside its worktree.** Block it from reading or editing files elsewhere on your computer and from touching protected files (`.env`, lock files, CI config) unless the ticket allows it. *Small to medium.*
- **Hide secrets in logs.** Mask anything that looks like an API key before it is saved. *Small.*
- **Limit request size and rate**, especially for image uploads. *Small.*

## Later, for teams

- Multiple users with roles (who can file tickets, who can approve). *Large.*
- Workers on other machines pulling from the same queue. *Large.*
- File tickets from outside the board: a command-line tool, CI failures or GitHub issues with a label. *Small to medium.*
- Scheduled tickets, such as "every Monday, update dependencies". *Medium.*
- A production setup with health checks and database backups. *Medium.*

## Housekeeping

- The README and HOW_IT_WORKS.md disagree on whether tickets run in parallel; make them say the same thing.
- PLAN.md still lists features as "out of scope" that now exist (multiple projects, dark mode).
- Add frontend tests and a CI workflow that runs lint, tests and the build.

## How other tools compare

Similar tools include GitHub Copilot coding agent, OpenAI Codex, Devin, Cursor background agents, Google Jules, OpenHands, Vibe Kanban and Conductor. Most of them run tests inside the loop, support a plan-first mode, run tasks in parallel and open pull requests; those are the biggest gaps above. Shiftboard is already ahead of several of them in asking you structured questions and resuming the same session after your feedback.

The agent couldn't browse the web when it wrote this (Shiftboard blocks web tools), so details about these tools come from its own knowledge and may be out of date.
