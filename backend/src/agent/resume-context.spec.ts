import { TicketEventType as T } from '@agent-board/shared';
import { determineResumePrompt, type ResumeEvent, type ResumeTicket } from './resume-context';

const base: ResumeTicket = {
  number: 3,
  priority: 'medium',
  title: 'Fix bug',
  description: 'Broken.',
  rules: [],
  sessionId: 'sess-1',
  lastError: null,
};

const status = (from: string, to: string, actor: string, extra: Record<string, unknown> = {}): ResumeEvent => ({
  type: T.StatusChanged,
  body: `Status changed from ${from} to ${to}`,
  meta: { from, to, actor, ...extra },
});

const claim = status('pending', 'in_progress', 'worker');

describe('determineResumePrompt', () => {
  it('first mode when there is no session', () => {
    const r = determineResumePrompt({ ...base, sessionId: null }, [claim]);
    expect(r.mode).toBe('first');
    expect(r.prompt).toMatch(/^Ticket #3 \[medium\]: Fix bug/);
  });

  it('answer mode pairs the latest questions with the answers after them', () => {
    const events: ResumeEvent[] = [
      claim,
      { type: T.AgentQuestion, body: 'old', meta: { questions: ['Old?'], reason: 'r' } },
      { type: T.HumanAnswer, body: 'old answer', meta: null },
      status('needs_context', 'pending', 'human'),
      claim,
      { type: T.AgentQuestion, body: '1. Q1\n2. Q2', meta: { questions: ['Q1?', 'Q2?'], reason: 'r' } },
      status('in_progress', 'needs_context', 'worker'),
      { type: T.HumanAnswer, body: 'Both: yes.', meta: null },
      { type: T.HumanAnswer, body: 'a retry note', meta: { kind: 'retry_note' } },
      status('needs_context', 'pending', 'human'),
    ];
    const r = determineResumePrompt(base, events);
    expect(r.mode).toBe('answer');
    expect(r.prompt).toContain('Question 1: Q1?\nQuestion 2: Q2?\nAnswer (covers the questions above): Both: yes.');
    expect(r.prompt).not.toContain('Old?');
    expect(r.prompt).not.toContain('old answer');
    expect(r.prompt).not.toContain('a retry note');
  });

  it('answer mode pairs each structured question with its own answer', () => {
    const questions = [
      { question: 'Which page?', header: 'Scope', options: [{ label: 'Login' }, { label: 'Signup' }] },
      { question: 'Which browsers?', options: [{ label: 'Chrome' }, { label: 'Safari' }], multiSelect: true },
      { question: 'Anything to avoid?', options: [] },
    ];
    const events: ResumeEvent[] = [
      claim,
      { type: T.AgentQuestion, body: 'md', meta: { questions, reason: 'r' } },
      status('in_progress', 'needs_context', 'worker'),
      {
        type: T.HumanAnswer,
        body: 'md',
        meta: {
          // Out of order on purpose: matched by question text, not only by position.
          answers: [
            { question: 'Which browsers?', selected: ['Chrome', 'Safari'], other: null },
            { question: 'Which page?', selected: ['Login'], other: 'and the reset form' },
            { question: 'Anything to avoid?', selected: [], other: null },
          ],
          note: 'Keep it small.',
        },
      },
      status('needs_context', 'pending', 'human'),
    ];
    const r = determineResumePrompt(base, events);
    expect(r.mode).toBe('answer');
    expect(r.prompt).toBe(
      [
        'The board owner answered your questions:',
        '',
        'Question 1: Which page?',
        'Answer: Login; and the reset form',
        '',
        'Question 2: Which browsers?',
        'Answer: Chrome; Safari',
        '',
        'Question 3: Anything to avoid?',
        'Answer: (no answer)',
        '',
        'Note from the board owner: Keep it small.',
        '',
        'Continue working on the ticket.',
      ].join('\n'),
    );
  });

  it('answer mode matches structured answers by position and handles old string questions', () => {
    const events: ResumeEvent[] = [
      { type: T.AgentQuestion, body: 'md', meta: { questions: ['Q1?', 'Q2?'], reason: 'r' } },
      {
        type: T.HumanAnswer,
        body: 'md',
        meta: {
          answers: [
            { question: 'renamed', selected: [], other: 'yes' },
            { question: 'renamed too', selected: [], other: 'yes' },
          ],
        },
      },
      status('needs_context', 'pending', 'human'),
    ];
    expect(determineResumePrompt(base, events).prompt).toBe(
      'The board owner answered your questions:\n\nQuestion 1: Q1?\nAnswer: yes\n\nQuestion 2: Q2?\nAnswer: yes\n\nContinue working on the ticket.',
    );
  });

  it('reject mode uses the latest review_rejected feedback', () => {
    const events: ResumeEvent[] = [
      claim,
      { type: T.ReviewRejected, body: 'first feedback', meta: null },
      status('review', 'pending', 'human'),
      claim,
      status('in_progress', 'review', 'worker'),
      { type: T.ReviewRejected, body: 'Handle nulls too.', meta: null },
      status('review', 'pending', 'human'),
    ];
    const r = determineResumePrompt(base, events);
    expect(r.mode).toBe('reject');
    expect(r.prompt).toBe(
      'Your fix was reviewed and rejected. Reviewer feedback:\n\nHandle nulls too.\n\nRevise your work on the same branch.',
    );
  });

  it('retry mode prefers meta.previousError and includes the note', () => {
    const events: ResumeEvent[] = [
      claim,
      status('in_progress', 'failed', 'worker'),
      status('failed', 'pending', 'human', { note: 'Check config.ts', previousError: 'Tests failed' }),
    ];
    const r = determineResumePrompt(base, events);
    expect(r.mode).toBe('retry');
    expect(r.prompt).toBe(
      'The previous run failed with: Tests failed.\n\nNote from the board owner: Check config.ts\n\nTry again.',
    );
  });

  it('retry mode falls back to the latest error / failed status event', () => {
    const events: ResumeEvent[] = [
      claim,
      { type: T.Error, body: 'spawn ENOENT', meta: null },
      { ...status('in_progress', 'failed', 'worker'), body: 'spawn ENOENT (failed)' },
      status('failed', 'pending', 'human'),
    ];
    const r = determineResumePrompt(base, events);
    expect(r.mode).toBe('retry');
    expect(r.prompt).toBe('The previous run failed with: spawn ENOENT (failed).\n\nTry again.');
  });

  it('interrupted mode after crash recovery, even when an earlier human requeue exists', () => {
    const events: ResumeEvent[] = [
      { type: T.ReviewRejected, body: 'fb', meta: null },
      status('review', 'pending', 'human'),
      claim,
      status('in_progress', 'pending', 'system'),
    ];
    const r = determineResumePrompt(base, events);
    expect(r.mode).toBe('interrupted');
    expect(r.prompt).toBe('The previous run was interrupted (the API restarted). Continue working on the ticket.');
  });

  it('interrupted mode when a session exists but no requeue is found', () => {
    expect(determineResumePrompt(base, [claim]).mode).toBe('interrupted');
  });
});
