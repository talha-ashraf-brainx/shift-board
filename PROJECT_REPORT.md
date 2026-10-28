# Shiftboard: project report

What Shiftboard is, how it works and what state it is in.

## In one sentence

Shiftboard is a task board where you file requests against your own code projects, and an AI assistant (built on Anthropic's Claude) works through them. For each one it either delivers a fix for you to review or comes back with questions.

## The problem it solves

Asking an AI to fix something is usually a one-off conversation. Shiftboard turns it into a queue with a review step. You keep adding tickets while the assistant works through them, most important first. Each ticket ends with something for a person to decide:

- **Review**: the assistant made a fix. You look at the changes and either approve them, which adds them to the project, or send them back with feedback.
- **Needs context**: the assistant has questions. You answer them, and it carries on from where it stopped.
- **Failed**: the assistant couldn't finish. You can retry or cancel.

Nothing reaches the project until a person approves it.

## How a ticket moves through the board

1. **Queued.** New tickets wait in Pending. The assistant picks them up by priority (urgent, high, medium, low), then by the order you arranged them on the board, then by age. By default it works on up to three tickets at once.
2. **Work happens in a separate copy.** Each ticket gets its own working copy of the project. The assistant never touches the main copy and never publishes anything outside your machine. If the main copy has unsaved changes or is switched away from its usual branch, the board waits until it is back to normal before starting work.
3. **The assistant works.** It is given the ticket and any rules you set for all projects, for one project, or for one ticket. It can read and edit files and save its work. It cannot browse the web or publish changes. It also can't run a project's tests itself unless you allow that. Instead, a project can have an automatic check that runs after each fix.
4. **It reports back.** Every run ends in exactly one of three ways: a fix sent for review, questions for you, or giving up. It can also post progress notes while it works.
5. **Checks.** If a project has an automatic check and the fix fails it, the assistant gets the failure details and tries again (twice by default). If the check is still failing after that, the fix goes to Review anyway, clearly marked as failing, so a person decides.
6. **Picking up where it left off.** When you answer questions, send feedback or retry, the assistant continues the same session. It remembers what it already did and only needs your new input.
7. **Approval.** The review screen shows the assistant's summary, its testing notes and exactly what changed. Approving adds the changes to the project. If they clash with other changes made in the meantime, or the main copy isn't in a clean state, nothing is changed: the ticket stays in Review with an explanation.

## What it is built from

- A web app showing the board, with columns for each status, drag-and-drop ordering, a project switcher and a detail panel for each ticket. It updates live across browser tabs and supports desktop notifications and light and dark themes.
- A server that stores tickets in a database, runs the assistant and keeps the web app up to date.
- Optional extras: image attachments on tickets (shown to the assistant), Slack or Discord alerts when a ticket needs a person, and a password-style access token.

It runs on your own computer and is reached from your browser.

## Safety and reliability

- **Contained work.** The assistant only works in separate copies and can't publish anything. The board is only reachable from the same computer by default.
- **Spending limits.** You can cap AI spending per ticket, per project or for the whole board. The cost of each ticket is tracked. Each run also has a limit on how many steps it can take.
- **Recovering from crashes.** If the board shuts down unexpectedly, interrupted tickets go back into the queue and leftover assistant processes are stopped when it starts again.
- **No silent endings.** If the assistant stops without reporting an outcome, it gets one reminder to report. If it still doesn't, or it can't be reminded (for example, because it hit its step limit), the ticket is marked Failed. A "fix" that changes nothing is also marked Failed.

## Quality checks

The project has an automated test suite. It covers the rules for moving tickets between statuses, several tickets being picked up at the same time, the handling of project files, the server's web interface, sign-in and attachments. It also has automated code-style and type checks.

## Status

- The original plan has been completed in full, and a trial run on a sample project met every acceptance criterion.
- Since then it has grown beyond that first version: several projects at once, several tickets in parallel, optional access control, image attachments, chat notifications, spending limits and automatic checks.

## Limitations

- **Single user.** There are no individual user accounts. It is designed for one person on their own computer.
- **Local only.** Approved changes stay on your computer. Shiftboard doesn't publish them or open them for review on services like GitHub.
