/**
 * Pure prompt builders. The texts come verbatim from poc.md
 * ("Agent prompt template and custom tools"); keep them in sync with the README.
 */

export const FINISH_REMINDER =
  'You must finish by calling exactly one of submit_fix, request_context or give_up.';

export const INTERRUPTED_RESUME_PROMPT =
  'The previous run was interrupted (the API restarted). Continue working on the ticket.';

export interface PromptProject {
  name: string;
  repoPath: string;
  rules?: string | null;
}

export interface SystemAppendInput {
  branchName: string;
  baseBranch: string;
  globalRules: string | null | undefined;
  /** The ticket's project; adds a "Project:" line and the project rules section. */
  project?: PromptProject | null;
}

export interface PromptTicket {
  number: number;
  priority: string;
  title: string;
  description: string;
  rules?: string[] | null;
  /** Adds a `Project: <name>` line after the header. */
  projectName?: string | null;
}

export interface QaPair {
  question: string;
  answer: string;
  /** The answer was given to this question alone (a structured answer); never grouped with others. */
  own?: boolean;
}

function orNone(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'None';
}

function ruleList(rules: string[] | null | undefined): string {
  const items = (rules ?? []).map((r) => r.trim()).filter(Boolean);
  return items.length > 0 ? items.map((r) => `- ${r}`).join('\n') : 'None';
}

export function buildSystemAppend({ branchName, baseBranch, globalRules, project }: SystemAppendInput): string {
  const lines = [
    'You are an autonomous engineer working through tickets on Shiftboard.',
    ...(project ? [`Project: ${project.name} (${project.repoPath})`] : []),
    `You are inside a git worktree on branch ${branchName}, created from ${baseBranch}.`,
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
    orNone(globalRules),
  ];
  if (project) lines.push('', `Project rules for ${project.name}:`, orNone(project.rules));
  return lines.join('\n');
}

export function buildFirstRunPrompt(ticket: PromptTicket): string {
  return [
    `Ticket #${ticket.number} [${ticket.priority}]${ticket.title.trim() ? `: ${ticket.title.trim()}` : ''}`,
    ...(ticket.projectName ? [`Project: ${ticket.projectName}`] : []),
    '',
    '## Description',
    ticket.description.trim(),
    '',
    '## Ticket-specific rules (these override global rules if they conflict)',
    ruleList(ticket.rules),
  ].join('\n');
}

/**
 * "The board owner answered your questions:" + each question paired with its answer
 * + "Continue working on the ticket."
 *
 * Consecutive pairs that share the same answer (one human reply covering several
 * questions, the usual case) are grouped: the questions are listed, then the answer once.
 * Pairs marked `own` (answered one question at a time) are never grouped.
 * A pair with an empty question (no recorded questions) prints only the answer.
 * An optional extra note from the owner follows the answers.
 */
export function buildAnswerResumePrompt(qaPairs: QaPair[], note?: string): string {
  const groups: { questions: string[]; answer: string; own?: boolean }[] = [];
  for (const pair of qaPairs) {
    const last = groups[groups.length - 1];
    if (last && !last.own && !pair.own && last.answer === pair.answer) {
      if (pair.question.trim()) last.questions.push(pair.question.trim());
    } else {
      groups.push({ questions: pair.question.trim() ? [pair.question.trim()] : [], answer: pair.answer, own: pair.own });
    }
  }

  let n = 0;
  const blocks = groups.map((group) => {
    const lines: string[] = [];
    if (group.questions.length === 1) {
      lines.push(`Question ${++n}: ${group.questions[0]}`);
      lines.push(`Answer: ${group.answer.trim()}`);
    } else if (group.questions.length > 1) {
      for (const q of group.questions) lines.push(`Question ${++n}: ${q}`);
      lines.push(`Answer (covers the questions above): ${group.answer.trim()}`);
    } else {
      lines.push(`Answer: ${group.answer.trim()}`);
    }
    return lines.join('\n');
  });
  if (note?.trim()) blocks.push(`Note from the board owner: ${note.trim()}`);

  return ['The board owner answered your questions:', '', ...joinBlocks(blocks), '', 'Continue working on the ticket.'].join(
    '\n',
  );
}

function joinBlocks(blocks: string[]): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) out.push('');
    out.push(b);
  });
  return out;
}

export function buildRejectResumePrompt(feedback: string): string {
  return [
    'Your fix was reviewed and rejected. Reviewer feedback:',
    '',
    feedback.trim(),
    '',
    'Revise your work on the same branch.',
  ].join('\n');
}

export function buildRetryResumePrompt(lastError: string, note?: string | null): string {
  // Avoid a doubled period: the template already ends the error with ".".
  const error = (lastError.trim() || 'an unknown error').replace(/\.+$/, '');
  const lines = [`The previous run failed with: ${error}.`];
  const trimmedNote = note?.trim();
  if (trimmedNote) lines.push('', `Note from the board owner: ${trimmedNote}`);
  lines.push('', 'Try again.');
  return lines.join('\n');
}

export function buildChecksFailedPrompt(command: string, output: string): string {
  return [
    `Your fix was submitted, but the project's checks failed. The board ran \`${command}\` in your worktree:`,
    '',
    '```',
    output.trim() || '(no output)',
    '```',
    '',
    'Fix the failures (only those related to this ticket; mention any pre-existing failures in your summary),',
    'commit, and call submit_fix again.',
  ].join('\n');
}

export function buildInterruptedResumePrompt(): string {
  return INTERRUPTED_RESUME_PROMPT;
}
