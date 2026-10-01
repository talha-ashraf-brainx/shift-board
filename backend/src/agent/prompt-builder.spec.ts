import {
  buildAnswerResumePrompt,
  buildFirstRunPrompt,
  buildInterruptedResumePrompt,
  buildRejectResumePrompt,
  buildRetryResumePrompt,
  buildSystemAppend,
  FINISH_REMINDER,
} from './prompt-builder';

describe('prompt-builder', () => {
  it('FINISH_REMINDER is verbatim', () => {
    expect(FINISH_REMINDER).toBe('You must finish by calling exactly one of submit_fix, request_context or give_up.');
  });

  it('buildSystemAppend fills branch, base and rules', () => {
    expect(buildSystemAppend({ branchName: 'agent/ticket-7', baseBranch: 'main', globalRules: 'Use tabs.' })).toBe(
      [
        'You are an autonomous engineer working through tickets on Shiftboard.',
        'You are inside a git worktree on branch agent/ticket-7, created from main.',
        '',
        'Rules for every ticket:',
        '- Work only inside this worktree. Never push, switch branches, or rewrite history.',
        '- Make the smallest change that fully resolves the ticket. Match the existing style.',
        "- Run the project's relevant tests or checks if they exist, and report the result.",
        '- Commit your work with a clear message before finishing.',
        '- If the ticket is ambiguous, or you would have to guess about behavior, data, or',
        '  intent, do not guess: call request_context with specific questions.',
        '- You must end every run by calling exactly one of: submit_fix, request_context, give_up.',
        '',
        'Global rules from the board owner:',
        'Use tabs.',
      ].join('\n'),
    );
  });

  it('buildSystemAppend uses "None" for empty global rules', () => {
    expect(buildSystemAppend({ branchName: 'b', baseBranch: 'main', globalRules: '  ' })).toMatch(
      /Global rules from the board owner:\nNone$/,
    );
  });

  it('buildFirstRunPrompt renders the full brief', () => {
    expect(
      buildFirstRunPrompt({
        number: 42,
        priority: 'high',
        title: 'Fix login',
        description: 'Login fails.',
        rules: ['Do not modify tests', 'Use pnpm'],
      }),
    ).toBe(
      [
        'Ticket #42 [high]: Fix login',
        '',
        '## Description',
        'Login fails.',
        '',
        '## Ticket-specific rules (these override global rules if they conflict)',
        '- Do not modify tests',
        '- Use pnpm',
      ].join('\n'),
    );
  });

  it('buildFirstRunPrompt uses "None" for missing rules', () => {
    const p = buildFirstRunPrompt({ number: 1, priority: 'low', title: 't', description: 'd', rules: [' '] });
    expect(p).toMatch(/conflict\)\nNone$/);
  });

  it('buildAnswerResumePrompt lists several questions then one shared answer', () => {
    expect(
      buildAnswerResumePrompt([
        { question: 'Which page?', answer: 'The /login page, and keep the old API.' },
        { question: 'Keep the old API?', answer: 'The /login page, and keep the old API.' },
      ]),
    ).toBe(
      [
        'The board owner answered your questions:',
        '',
        'Question 1: Which page?',
        'Question 2: Keep the old API?',
        'Answer (covers the questions above): The /login page, and keep the old API.',
        '',
        'Continue working on the ticket.',
      ].join('\n'),
    );
  });

  it('buildAnswerResumePrompt pairs distinct answers one to one', () => {
    expect(
      buildAnswerResumePrompt([
        { question: 'A?', answer: 'yes' },
        { question: 'B?', answer: 'no' },
      ]),
    ).toBe(
      [
        'The board owner answered your questions:',
        '',
        'Question 1: A?',
        'Answer: yes',
        '',
        'Question 2: B?',
        'Answer: no',
        '',
        'Continue working on the ticket.',
      ].join('\n'),
    );
  });

  it('buildAnswerResumePrompt prints only the answer when no question was recorded', () => {
    expect(buildAnswerResumePrompt([{ question: '', answer: 'Use v2.' }])).toBe(
      'The board owner answered your questions:\n\nAnswer: Use v2.\n\nContinue working on the ticket.',
    );
  });

  it('buildRejectResumePrompt', () => {
    expect(buildRejectResumePrompt('Also handle empty input.')).toBe(
      'Your fix was reviewed and rejected. Reviewer feedback:\n\nAlso handle empty input.\n\nRevise your work on the same branch.',
    );
  });

  it('buildRetryResumePrompt with and without a note', () => {
    expect(buildRetryResumePrompt('Max turns reached')).toBe(
      'The previous run failed with: Max turns reached.\n\nTry again.',
    );
    expect(buildRetryResumePrompt('Boom.', 'Look at utils.ts')).toBe(
      'The previous run failed with: Boom.\n\nNote from the board owner: Look at utils.ts\n\nTry again.',
    );
  });

  it('buildInterruptedResumePrompt', () => {
    expect(buildInterruptedResumePrompt()).toBe(
      'The previous run was interrupted (the API restarted). Continue working on the ticket.',
    );
  });
});
