import { EventAuthor, TicketEventType, type AgentQuestion } from '@agent-board/shared';
import { z } from 'zod';
import type { FinishingTool, RunState } from './run-state';
import type { ClaudeSdk } from './sdk-loader';

/** Name of the in-process MCP server; tools are exposed to the model as `mcp__board__<tool>`. */
export const BOARD_SERVER_NAME = 'board';

export const BOARD_TOOL_NAMES = [
  'mcp__board__submit_fix',
  'mcp__board__request_context',
  'mcp__board__give_up',
  'mcp__board__add_note',
] as const;

/** The part of EventsService the tools need. */
export interface BoardEventsSink {
  append(input: {
    ticketId: string;
    type: TicketEventType;
    author: EventAuthor;
    body: string;
    meta?: Record<string, unknown> | null;
  }): Promise<unknown>;
}

export interface BoardToolDeps {
  ticketId: string;
  runState: RunState;
  events: BoardEventsSink;
}

/** Shape of an MCP CallToolResult as returned by our handlers. */
export interface BoardToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export const submitFixShape = {
  summary: z.string().min(1).describe('Markdown: what you changed and why.'),
  testing: z.string().min(1).describe('What you ran to verify the fix (tests, checks) and the result.'),
};

export const questionOptionShape = z.object({
  label: z.string().min(1).describe('The choice, in a few words.'),
  description: z.string().optional().describe('What picking this option means, or its trade-off.'),
});

export const questionShape = z.object({
  question: z.string().min(1).describe('One specific question, ending with a question mark.'),
  header: z.string().max(12).optional().describe('Very short label shown as a chip, e.g. "Scope" (at most 12 characters).'),
  options: z
    .array(questionOptionShape)
    .max(4)
    .describe(
      '0 to 4 choices. Offer 2-4 concrete options when the answer is a choice, recommended option first; ' +
        'use [] for an open question. The owner can always type their own answer instead.',
    ),
  multiSelect: z.boolean().optional().describe('True when more than one option may be picked.'),
});

export const requestContextShape = {
  questions: z.array(questionShape).min(1).max(5).describe('1 to 5 specific questions for the board owner.'),
  reason: z.string().min(1).describe('Why you cannot proceed without these answers.'),
};

export const giveUpShape = {
  reason: z.string().min(1).describe('Why the ticket cannot be completed.'),
};

export const addNoteShape = {
  message: z.string().min(1).describe('A short progress note for the ticket timeline.'),
};

export type SubmitFixArgs = { summary: string; testing: string };
export type RequestContextArgs = { questions: AgentQuestion[]; reason: string };
export type GiveUpArgs = { reason: string };
export type AddNoteArgs = { message: string };

function ok(text: string): BoardToolResult {
  return { content: [{ type: 'text', text }] };
}

function fail(text: string): BoardToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatSummaryBody(summary: string, testing: string): string {
  return `## Summary\n${summary.trim()}\n\n## Testing\n${testing.trim()}`;
}

/** Markdown fallback for the agent_question event: numbered questions, each with its options. */
export function formatQuestionsBody(questions: AgentQuestion[], reason: string): string {
  const list = questions
    .map((q, i) => {
      const header = q.header?.trim() ? `**${q.header.trim()}:** ` : '';
      const multi = q.multiSelect && q.options.length > 0 ? ' (pick any)' : '';
      const options = q.options.map((o) => {
        const description = o.description?.trim() ? `: ${o.description.trim()}` : '';
        return `\n   - ${o.label.trim()}${description}`;
      });
      return `${i + 1}. ${header}${q.question.trim()}${multi}${options.join('')}`;
    })
    .join('\n');
  return `${list}\n\nReason: ${reason.trim()}`;
}

/** Trims the parsed questions and drops empty optional fields before they are stored. */
function cleanQuestions(questions: AgentQuestion[]): AgentQuestion[] {
  return questions.map((q) => {
    const header = q.header?.trim();
    const options = q.options.map((o) => {
      const description = o.description?.trim();
      return description ? { label: o.label.trim(), description } : { label: o.label.trim() };
    });
    return {
      question: q.question.trim(),
      ...(header ? { header } : {}),
      options,
      ...(q.multiSelect && options.length > 0 ? { multiSelect: true } : {}),
    };
  });
}

/**
 * The tool handlers, separate from the SDK so they can be unit-tested directly.
 * Each finishing handler records the outcome on `runState`; a second finishing
 * call in the same run (the reminder resume shares the run state) is rejected.
 * An event is written first; if that fails, the outcome is not recorded and the
 * model gets a tool error so it can try again.
 */
export function createBoardToolHandlers({ ticketId, runState, events }: BoardToolDeps) {
  const alreadyFinished = (): BoardToolResult | null =>
    runState.finishedWith ? fail(`You already finished this run with ${runState.finishedWith}.`) : null;

  const finish = (tool: FinishingTool) => {
    runState.finishCalls += 1;
    runState.finishedWith = tool;
  };

  return {
    async submit_fix(args: SubmitFixArgs): Promise<BoardToolResult> {
      const rejected = alreadyFinished();
      if (rejected) return rejected;
      try {
        await events.append({
          ticketId,
          type: TicketEventType.AgentSummary,
          author: EventAuthor.Agent,
          body: formatSummaryBody(args.summary, args.testing),
          meta: { summary: args.summary, testing: args.testing },
        });
      } catch (err) {
        return fail(`Could not record the fix: ${errorMessage(err)}`);
      }
      finish('submit_fix');
      runState.outcome = 'review';
      runState.summary = args.summary;
      runState.testing = args.testing;
      return ok('Fix submitted for human review. Your run is complete; stop now.');
    },

    async request_context(args: RequestContextArgs): Promise<BoardToolResult> {
      const rejected = alreadyFinished();
      if (rejected) return rejected;
      const parsed = z.object(requestContextShape).safeParse(args);
      if (!parsed.success) {
        return fail(
          'request_context needs 1 to 5 questions (each a non-empty question, a header of at most 12 characters, ' +
            'and at most 4 options with non-empty labels) and a reason.',
        );
      }
      const questions = cleanQuestions(parsed.data.questions);
      const reason = parsed.data.reason;
      try {
        await events.append({
          ticketId,
          type: TicketEventType.AgentQuestion,
          author: EventAuthor.Agent,
          body: formatQuestionsBody(questions, reason),
          meta: { questions, reason },
        });
      } catch (err) {
        return fail(`Could not record the questions: ${errorMessage(err)}`);
      }
      finish('request_context');
      runState.outcome = 'needs_context';
      runState.questions = questions;
      runState.reason = reason;
      return ok('Questions sent to the board owner. Your run is complete; stop now.');
    },

    async give_up(args: GiveUpArgs): Promise<BoardToolResult> {
      const rejected = alreadyFinished();
      if (rejected) return rejected;
      finish('give_up');
      runState.outcome = 'failed';
      runState.reason = args.reason;
      return ok('Recorded. The ticket will be marked failed. Your run is complete; stop now.');
    },

    async add_note(args: AddNoteArgs): Promise<BoardToolResult> {
      try {
        await events.append({
          ticketId,
          type: TicketEventType.AgentLog,
          author: EventAuthor.Agent,
          body: args.message,
          meta: { kind: 'note' },
        });
      } catch (err) {
        return fail(`Could not record the note: ${errorMessage(err)}`);
      }
      return ok('Note added to the ticket timeline.');
    },
  };
}

export type BoardToolHandlers = ReturnType<typeof createBoardToolHandlers>;

/** Builds the in-process `board` MCP server with the four tools. */
export function buildBoardServer(sdk: Pick<ClaudeSdk, 'tool' | 'createSdkMcpServer'>, deps: BoardToolDeps) {
  const h = createBoardToolHandlers(deps);
  const tools = [
    sdk.tool(
      'submit_fix',
      'Finish the run: submit your committed fix for human review. Call exactly once, after committing.',
      submitFixShape,
      (args) => h.submit_fix(args),
    ),
    sdk.tool(
      'request_context',
      'Finish the run: ask the board owner 1-5 specific questions when the ticket is ambiguous. Do not guess. ' +
        'The owner answers one question at a time. When the answer is a choice, offer 2-4 concrete options ' +
        '(put the recommended option first and say so in its description); use no options for an open question. ' +
        'The owner can always type their own answer instead of picking an option. Set multiSelect when ' +
        'several options can apply together.',
      requestContextShape,
      (args) => h.request_context(args),
    ),
    sdk.tool(
      'give_up',
      'Finish the run: the ticket cannot be completed (explain why). The ticket is marked failed.',
      giveUpShape,
      (args) => h.give_up(args),
    ),
    sdk.tool(
      'add_note',
      'Add a short progress note to the ticket timeline. Does not finish the run.',
      addNoteShape,
      (args) => h.add_note(args),
    ),
  ];
  return sdk.createSdkMcpServer({ name: BOARD_SERVER_NAME, version: '1.0.0', tools });
}
