import { clsx } from 'clsx';
import type { TicketPriority, TicketStatus } from '@agent-board/shared';
import { PRIORITY_BADGE, PRIORITY_LABEL, STATUS_BADGE, STATUS_DOT, STATUS_LABEL } from '../lib/meta';

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-1.5 py-px text-[12px] leading-4 font-medium ring-1 ring-inset',
        PRIORITY_BADGE[priority],
        className,
      )}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function StatusDot({ status, className }: { status: TicketStatus; className?: string }) {
  return <span aria-hidden="true" className={clsx('inline-block size-2 shrink-0 rounded-full', STATUS_DOT[status], className)} />;
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-meta font-medium', STATUS_BADGE[status])}>
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
