import { TicketStatus as S, TransitionActor as A } from './enums';
import type { TicketStatus, TransitionActor } from './enums';

export interface TransitionRule {
  from: TicketStatus;
  to: TicketStatus;
  actors: readonly TransitionActor[];
}

const CANCELLABLE_FROM: readonly TicketStatus[] = [
  S.Pending,
  S.InProgress,
  S.NeedsContext,
  S.Review,
  S.Failed,
];

/**
 * Every allowed status transition. The backend state machine enforces this
 * table; the frontend uses it to decide which drags are allowed.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  { from: S.Pending, to: S.InProgress, actors: [A.Worker] },
  { from: S.InProgress, to: S.NeedsContext, actors: [A.Worker] },
  { from: S.InProgress, to: S.Review, actors: [A.Worker] },
  { from: S.InProgress, to: S.Failed, actors: [A.Worker] },
  // Crash recovery on startup.
  { from: S.InProgress, to: S.Pending, actors: [A.System] },
  { from: S.NeedsContext, to: S.Pending, actors: [A.Human] },
  { from: S.Review, to: S.Done, actors: [A.Human] },
  { from: S.Review, to: S.Pending, actors: [A.Human] },
  { from: S.Failed, to: S.Pending, actors: [A.Human] },
  ...CANCELLABLE_FROM.map((from) => ({ from, to: S.Cancelled, actors: [A.Human] })),
];

export function findTransition(from: TicketStatus, to: TicketStatus): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function isTransitionAllowed(
  from: TicketStatus,
  to: TicketStatus,
  actor: TransitionActor,
): boolean {
  return findTransition(from, to)?.actors.includes(actor) ?? false;
}

/** Transitions a human may trigger, as a from → to[] map. */
export const HUMAN_ALLOWED_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> =
  Object.fromEntries(
    Object.values(S).map((from) => [
      from,
      TRANSITIONS.filter((t) => t.from === from && t.actors.includes(A.Human)).map((t) => t.to),
    ]),
  ) as Record<TicketStatus, TicketStatus[]>;

/**
 * What the UI must collect before a drag-and-drop transition is sent.
 * - 'none': send immediately
 * - 'confirm': ask for confirmation (approve & merge, cancel)
 * - 'feedback': required feedback textarea (reject)
 * - 'note': optional note (retry)
 */
export type DragInput = 'none' | 'confirm' | 'feedback' | 'note';

export interface DragTransition {
  from: TicketStatus;
  to: TicketStatus;
  input: DragInput;
}

/**
 * Drags the board allows. needs_context → pending is intentionally absent:
 * it requires an answer, which is given in the ticket drawer.
 */
export const DRAG_TRANSITIONS: readonly DragTransition[] = [
  { from: S.Review, to: S.Done, input: 'confirm' },
  { from: S.Review, to: S.Pending, input: 'feedback' },
  { from: S.Failed, to: S.Pending, input: 'note' },
  ...CANCELLABLE_FROM.filter((s) => s !== S.InProgress).map((from) => ({
    from,
    to: S.Cancelled,
    input: 'confirm' as const,
  })),
];

export function findDragTransition(from: TicketStatus, to: TicketStatus): DragTransition | undefined {
  return DRAG_TRANSITIONS.find((t) => t.from === from && t.to === to);
}
