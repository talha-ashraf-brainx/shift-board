/** What the agent's board tools recorded during one ticket run (shared by the reminder resume). */
export type RunOutcome = 'review' | 'needs_context' | 'failed';

export type FinishingTool = 'submit_fix' | 'request_context' | 'give_up';

export interface RunState {
  outcome?: RunOutcome;
  summary?: string;
  testing?: string;
  questions?: string[];
  reason?: string;
  /** Accepted finishing calls (0 or 1; a second call is rejected). */
  finishCalls: number;
  /** The finishing tool that was accepted, for the "already finished" error. */
  finishedWith?: FinishingTool;
}

export function createRunState(): RunState {
  return { finishCalls: 0 };
}
