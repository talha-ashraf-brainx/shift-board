import { TicketEventType, TicketStatus, TransitionActor } from '@agent-board/shared';
import {
  buildAnswerResumePrompt,
  buildFirstRunPrompt,
  buildInterruptedResumePrompt,
  buildRejectResumePrompt,
  buildRetryResumePrompt,
  type PromptTicket,
  type QaPair,
} from './prompt-builder';

export type ResumeMode = 'first' | 'answer' | 'reject' | 'retry' | 'interrupted';

export interface ResumeTicket extends PromptTicket {
  sessionId?: string | null;
  lastError?: string | null;
}

/** The event fields this module reads; TicketEventEntity and TicketEventDto both satisfy it. */
export interface ResumeEvent {
  type: TicketEventType | string;
  body: string;
  meta?: Record<string, unknown> | null;
}

export interface ResumeDecision {
  mode: ResumeMode;
  prompt: string;
}

function metaString(e: ResumeEvent, key: string): string | undefined {
  const v = e.meta?.[key];
  return typeof v === 'string' ? v : undefined;
}

function isStatusChange(e: ResumeEvent, to?: TicketStatus): boolean {
  return e.type === TicketEventType.StatusChanged && (to === undefined || metaString(e, 'to') === to);
}

function lastIndex(events: ResumeEvent[], pred: (e: ResumeEvent, i: number) => boolean, before = events.length): number {
  for (let i = Math.min(before, events.length) - 1; i >= 0; i--) {
    if (pred(events[i]!, i)) return i;
  }
  return -1;
}

/**
 * Picks the prompt for the next run of a ticket (`events` oldest first).
 *
 * - No sessionId → the full first-run brief.
 * - Otherwise look at the most recent requeue (status_changed → pending):
 *   - by a human from needs_context → answer mode (latest agent_question + human_answers after it)
 *   - by a human from review → reject mode (latest review_rejected body)
 *   - by a human from failed → retry mode (previous error + optional note)
 *   - anything else (crash recovery by the system, or no requeue found) → "continue" prompt.
 */
export function determineResumePrompt(ticket: ResumeTicket, events: ResumeEvent[]): ResumeDecision {
  if (!ticket.sessionId) return { mode: 'first', prompt: buildFirstRunPrompt(ticket) };

  const requeueIdx = lastIndex(events, (e) => isStatusChange(e, TicketStatus.Pending));
  const requeue = requeueIdx >= 0 ? events[requeueIdx]! : undefined;

  if (requeue && metaString(requeue, 'actor') === TransitionActor.Human) {
    const from = metaString(requeue, 'from');

    if (from === TicketStatus.NeedsContext) {
      return { mode: 'answer', prompt: buildAnswerResumePrompt(collectQaPairs(events, requeueIdx)) };
    }

    if (from === TicketStatus.Review) {
      const rejIdx = lastIndex(events, (e) => e.type === TicketEventType.ReviewRejected, requeueIdx + 1);
      const feedback = rejIdx >= 0 ? events[rejIdx]!.body : '(no feedback recorded)';
      return { mode: 'reject', prompt: buildRejectResumePrompt(feedback) };
    }

    if (from === TicketStatus.Failed) {
      const previous = metaString(requeue, 'previousError');
      let lastError = previous && previous.trim() ? previous : undefined;
      if (!lastError) {
        const errIdx = lastIndex(
          events,
          (e) => e.type === TicketEventType.Error || isStatusChange(e, TicketStatus.Failed),
          requeueIdx,
        );
        lastError = errIdx >= 0 ? events[errIdx]!.body : (ticket.lastError ?? 'an unknown error');
      }
      return { mode: 'retry', prompt: buildRetryResumePrompt(lastError, metaString(requeue, 'note')) };
    }
  }

  return { mode: 'interrupted', prompt: buildInterruptedResumePrompt() };
}

/**
 * Pairs the latest agent_question's questions with the human_answer events after it.
 * The answers are joined into one reply that covers every question (a human answers
 * the whole list in one message).
 */
function collectQaPairs(events: ResumeEvent[], requeueIdx: number): QaPair[] {
  const qIdx = lastIndex(events, (e) => e.type === TicketEventType.AgentQuestion, requeueIdx + 1);
  const answers = events
    // retry() also stores its note as a human_answer (meta.kind 'retry_note'); those are not answers.
    .filter((e, i) => i > qIdx && e.type === TicketEventType.HumanAnswer && e.meta?.kind !== 'retry_note')
    .map((e) => e.body.trim())
    .filter((b) => b.length > 0);
  const answer = answers.length > 0 ? answers.join('\n\n') : '(no answer text recorded)';

  const rawQuestions = qIdx >= 0 ? events[qIdx]!.meta?.questions : undefined;
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    : [];
  if (questions.length === 0) return [{ question: '', answer }];
  return questions.map((question) => ({ question, answer }));
}
