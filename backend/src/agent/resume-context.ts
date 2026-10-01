import {
  TicketEventType,
  TicketStatus,
  TransitionActor,
  answerText,
  normalizeAnswers,
  normalizeQuestions,
  type QuestionAnswer,
} from '@agent-board/shared';
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
      const { pairs, note } = collectQaPairs(events, requeueIdx);
      return { mode: 'answer', prompt: buildAnswerResumePrompt(pairs, note) };
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
 *
 * When the latest answer is structured (meta.answers, one answer per question), each
 * question gets its own answer, matched by question text and then by position; its extra
 * note, and any free-text answers, become the note. Otherwise (older free-text answers)
 * the answers are joined into one reply that covers every question.
 */
function collectQaPairs(events: ResumeEvent[], requeueIdx: number): { pairs: QaPair[]; note?: string } {
  const qIdx = lastIndex(events, (e) => e.type === TicketEventType.AgentQuestion, requeueIdx + 1);
  const answerEvents = events
    // retry() also stores its note as a human_answer (meta.kind 'retry_note'); those are not answers.
    .filter((e, i) => i > qIdx && i < requeueIdx && e.type === TicketEventType.HumanAnswer && e.meta?.kind !== 'retry_note');
  const questions = normalizeQuestions(qIdx >= 0 ? events[qIdx]!.meta?.questions : undefined).map((q) => q.question);

  const structuredIdx = lastIndex(answerEvents, (e) => normalizeAnswers(e.meta?.answers).length > 0);
  if (structuredIdx >= 0) {
    const structured = answerEvents[structuredIdx]!;
    const answers = normalizeAnswers(structured.meta?.answers);
    const notes = [
      ...answerEvents.filter((_, i) => i !== structuredIdx).map((e) => e.body.trim()),
      typeof structured.meta?.note === 'string' ? structured.meta.note.trim() : '',
    ].filter((b) => b.length > 0);
    const asked = questions.length > 0 ? questions : answers.map((a) => a.question);
    const pairs = asked.map((question, i) => ({
      question,
      answer: answerText(matchAnswer(answers, question, i) ?? { selected: [], other: null }) || '(no answer)',
      own: true,
    }));
    return { pairs, note: notes.length > 0 ? notes.join('\n\n') : undefined };
  }

  const bodies = answerEvents.map((e) => e.body.trim()).filter((b) => b.length > 0);
  const answer = bodies.length > 0 ? bodies.join('\n\n') : '(no answer text recorded)';
  if (questions.length === 0) return { pairs: [{ question: '', answer }] };
  return { pairs: questions.map((question) => ({ question, answer })) };
}

/** The answer whose question text matches, else the one at the same position. */
function matchAnswer(answers: QuestionAnswer[], question: string, index: number): QuestionAnswer | undefined {
  const key = question.trim().toLowerCase();
  return answers.find((a) => a.question.trim().toLowerCase() === key) ?? answers[index];
}
