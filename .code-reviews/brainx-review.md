---
diff_hash: a5bd88883b483aea5dbb6c242e76a698db234e1a223ca72acdd18a910154b8fe
reviewed_at: 2026-10-28T10:27:18Z
---

## Summary

Scope: all changes (option b). `git add -A` was run and changed nothing; the only staged file is `PROJECT_REPORT.md`.

Stack: pnpm monorepo (`backend/` NestJS, `frontend/` React), but the diff only touches Markdown, so the stack-specific criteria don't apply. The diff rewrites the ticket #18 project report for non-technical readers. It drops the internals (env var names, module tables, SDK details) and the "Observations" section, and adds a "Limitations" section. The review checked the rewritten claims against the code.

Claims checked and found accurate:
- Up to three tickets at once by default (`AGENT_CONCURRENCY` default 3, `backend/src/config/env-validation.ts:19`).
- Failing checks go back to the agent twice by default and then go to Review marked "the checks are still failing" (`agentCheckRetries: 2`, `agent-worker.service.ts:241-258`). Retries also stop early when the budget runs out, a detail the plain-language version can leave out.
- One finish reminder; a result error such as max turns fails right away without a reminder; a fix with no changes fails (`agent-worker.service.ts:226-236`, `:269-276`).
- Approval leaves the ticket in Review with an event on a merge conflict or a main checkout that isn't ready (`tickets.service.ts:371-393`).
- The API binds to loopback by default; per-ticket, per-project and global budgets exist; extra tools per project exist (`extraAllowedTools`).

## Findings

### Critical (0)

### High (0)

### Medium (0)

### Low (2)
- **PROJECT_REPORT.md:22** — The report says the board waits only when the main copy "has unsaved changes". It also waits when the main checkout isn't on its base branch (`git.service.ts:295`, README "Known limitations"). *(correctness)*
  - status: resolved
  - dev_reasoning: Reworded to cover both cases: unsaved changes or switched away from its usual branch.
  - ai_reasoning: A user whose main checkout is clean but on another branch will see tickets stay in Pending, and the report gives no hint why. The old version said "dirty or not on its base branch". Suggested wording: "If the main copy has unsaved changes or is on a different branch, the board waits until it is back to normal before starting work."
- **PROJECT_REPORT.md:53** — The rewrite removes the "Observations" note that README.md "Known limitations" is out of date. The README is still wrong ("One worker and one ticket at a time", "No auth" at `README.md:224-225`), and nothing in the repo records that anymore. *(maintainability)*
  - status: skipped
  - dev_reasoning: The board owner asked for the report to be rewritten for non-technical stakeholders and to fix only the report, not the README (ticket #19 answers). A note about developer docs being out of date doesn't belong in a stakeholder report. The README inconsistency is recorded in the ticket #19 timeline note for a follow-up.
  - ai_reasoning: This is a lost record of a known inconsistency, not a new bug. Either keep a short note (for example in Limitations, or in a separate ticket) or fix the README in a follow-up. Skipping with a reason is reasonable if a ticket already tracks it.

## Reviewed files
- PROJECT_REPORT.md
