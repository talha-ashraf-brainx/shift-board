import { TicketPriority } from './enums';

/** Lower rank = processed earlier. */
export const PRIORITY_RANK: Record<TicketPriority, number> = {
  [TicketPriority.Urgent]: 0,
  [TicketPriority.High]: 1,
  [TicketPriority.Medium]: 2,
  [TicketPriority.Low]: 3,
};

export interface QueueSortable {
  priority: TicketPriority;
  position: number;
  createdAt: string | Date;
}

/** Same order as the worker's queue: priority, then position, then createdAt. */
export function compareTickets(a: QueueSortable, b: QueueSortable): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  const byPosition = a.position - b.position;
  if (byPosition !== 0) return byPosition;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}
