import { TicketPriority, TicketStatus } from '@agent-board/shared';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  [TicketStatus.Pending]: 'Pending',
  [TicketStatus.InProgress]: 'In progress',
  [TicketStatus.NeedsContext]: 'Needs context',
  [TicketStatus.Review]: 'Review',
  [TicketStatus.Done]: 'Done',
  [TicketStatus.Failed]: 'Failed',
  [TicketStatus.Cancelled]: 'Cancelled',
};

/** Dot color class per status. */
export const STATUS_DOT: Record<TicketStatus, string> = {
  [TicketStatus.Pending]: 'bg-stone-400',
  [TicketStatus.InProgress]: 'bg-indigo-500',
  [TicketStatus.NeedsContext]: 'bg-amber-500',
  [TicketStatus.Review]: 'bg-teal-500',
  [TicketStatus.Done]: 'bg-green-600',
  [TicketStatus.Failed]: 'bg-red-500',
  [TicketStatus.Cancelled]: 'bg-stone-400',
};

/** Badge (tinted background + darker text) per status. */
export const STATUS_BADGE: Record<TicketStatus, string> = {
  [TicketStatus.Pending]: 'bg-stone-100 text-stone-700',
  [TicketStatus.InProgress]: 'bg-indigo-50 text-indigo-700',
  [TicketStatus.NeedsContext]: 'bg-amber-50 text-amber-800',
  [TicketStatus.Review]: 'bg-teal-50 text-teal-800',
  [TicketStatus.Done]: 'bg-green-50 text-green-800',
  [TicketStatus.Failed]: 'bg-red-50 text-red-700',
  [TicketStatus.Cancelled]: 'bg-stone-100 text-stone-600',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  [TicketPriority.Urgent]: 'Urgent',
  [TicketPriority.High]: 'High',
  [TicketPriority.Medium]: 'Medium',
  [TicketPriority.Low]: 'Low',
};

export const PRIORITY_BADGE: Record<TicketPriority, string> = {
  [TicketPriority.Urgent]: 'bg-red-50 text-red-700 ring-red-200',
  [TicketPriority.High]: 'bg-orange-50 text-orange-700 ring-orange-200',
  [TicketPriority.Medium]: 'bg-blue-50 text-blue-700 ring-blue-200',
  [TicketPriority.Low]: 'bg-stone-100 text-stone-600 ring-stone-200',
};

export type ColumnKey = 'pending' | 'in_progress' | 'needs_context' | 'review' | 'done' | 'closed';

export interface ColumnDef {
  key: ColumnKey;
  title: string;
  statuses: readonly TicketStatus[];
  /** Status a ticket gets when dropped on this column. */
  dropStatus: TicketStatus;
  dot: string;
  empty: string;
  /** Whether cards can be reordered by dragging within the column. */
  reorderable: boolean;
}

export const COLUMNS: readonly ColumnDef[] = [
  {
    key: 'pending',
    title: 'Pending',
    statuses: [TicketStatus.Pending],
    dropStatus: TicketStatus.Pending,
    dot: STATUS_DOT[TicketStatus.Pending],
    empty: 'Nothing queued. Press N to file a ticket.',
    reorderable: true,
  },
  {
    key: 'in_progress',
    title: 'In progress',
    statuses: [TicketStatus.InProgress],
    dropStatus: TicketStatus.InProgress,
    dot: STATUS_DOT[TicketStatus.InProgress],
    empty: 'The agent picks up the top pending ticket.',
    reorderable: false,
  },
  {
    key: 'needs_context',
    title: 'Needs context',
    statuses: [TicketStatus.NeedsContext],
    dropStatus: TicketStatus.NeedsContext,
    dot: STATUS_DOT[TicketStatus.NeedsContext],
    empty: 'No open questions from the agent.',
    reorderable: true,
  },
  {
    key: 'review',
    title: 'Review',
    statuses: [TicketStatus.Review],
    dropStatus: TicketStatus.Review,
    dot: STATUS_DOT[TicketStatus.Review],
    empty: 'Fixes ready for review show up here.',
    reorderable: true,
  },
  {
    key: 'done',
    title: 'Done',
    statuses: [TicketStatus.Done],
    dropStatus: TicketStatus.Done,
    dot: STATUS_DOT[TicketStatus.Done],
    empty: 'Approved and merged tickets land here.',
    reorderable: true,
  },
  {
    key: 'closed',
    title: 'Failed / Cancelled',
    statuses: [TicketStatus.Failed, TicketStatus.Cancelled],
    dropStatus: TicketStatus.Cancelled,
    dot: STATUS_DOT[TicketStatus.Failed],
    empty: 'Drop a ticket here to cancel it.',
    reorderable: false,
  },
];

export function columnForStatus(status: TicketStatus): ColumnDef {
  const col = COLUMNS.find((c) => c.statuses.includes(status));
  if (!col) throw new Error(`No column for status ${status}`);
  return col;
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function shortId(id: string | null | undefined, len = 8): string {
  return id ? id.slice(0, len) : '';
}

export function needsHuman(status: TicketStatus): boolean {
  return status === TicketStatus.NeedsContext || status === TicketStatus.Review;
}
