export enum TicketStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  NeedsContext = 'needs_context',
  Review = 'review',
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/** Declared in rank order: a Postgres enum sorts in declaration order. */
export enum TicketPriority {
  Urgent = 'urgent',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

export enum TicketEventType {
  Created = 'created',
  StatusChanged = 'status_changed',
  AgentQuestion = 'agent_question',
  HumanAnswer = 'human_answer',
  AgentSummary = 'agent_summary',
  ReviewRejected = 'review_rejected',
  ReviewApproved = 'review_approved',
  AgentLog = 'agent_log',
  Error = 'error',
}

export enum EventAuthor {
  Human = 'human',
  Agent = 'agent',
  System = 'system',
}

/** Who triggers a status transition. */
export enum TransitionActor {
  Worker = 'worker',
  Human = 'human',
  System = 'system',
}

export const ALL_STATUSES: readonly TicketStatus[] = Object.values(TicketStatus);
export const ALL_PRIORITIES: readonly TicketPriority[] = Object.values(TicketPriority);
