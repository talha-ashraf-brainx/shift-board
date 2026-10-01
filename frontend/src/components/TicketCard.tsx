import { clsx } from 'clsx';
import type { HTMLAttributes, Ref } from 'react';
import { TicketStatus, type TicketDto } from '@agent-board/shared';
import { formatCost, needsHuman } from '../lib/meta';
import { useProjectTag } from '../lib/projectTags';
import { absoluteTime, relativeTime } from '../lib/time';
import { PriorityBadge } from './Badges';

interface TicketCardProps extends HTMLAttributes<HTMLDivElement> {
  ticket: TicketDto;
  dragging?: boolean;
  overlay?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/** Presentational card; drag/sortable wiring lives in SortableTicketCard. */
export function TicketCard({ ticket, dragging = false, overlay = false, className, ref, ...rest }: TicketCardProps) {
  const attention = needsHuman(ticket.status);
  const muted = ticket.status === TicketStatus.Cancelled;
  const projectTag = useProjectTag(ticket.projectId);
  return (
    <div
      ref={ref}
      className={clsx(
        'group relative rounded-card border bg-surface p-3 text-left transition-[border-color,opacity]',
        'border-line',
        dragging && !overlay && 'opacity-40',
        overlay && 'rotate-[0.6deg] border-accent/50 shadow-sm',
        !dragging && 'hover:border-stone-300',
        muted && 'opacity-70',
        className,
      )}
      {...rest}
    >
      {attention ? (
        <span
          aria-hidden="true"
          className={clsx(
            'absolute inset-y-2 left-0 w-[3px] rounded-r-full',
            ticket.status === TicketStatus.NeedsContext ? 'bg-amber-500' : 'bg-teal-500',
          )}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-[12px] text-muted">#{ticket.number}</span>
          {projectTag ? (
            <span
              className="truncate rounded-[4px] bg-stone-100 px-1.5 text-[11px] leading-[18px] font-medium text-stone-600"
              title={`Project: ${projectTag}`}
            >
              {projectTag}
            </span>
          ) : null}
        </span>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <p className="mt-1.5 line-clamp-2 font-medium break-words text-ink">{ticket.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
        <time dateTime={ticket.updatedAt} title={`Updated ${absoluteTime(ticket.updatedAt)}`}>
          {relativeTime(ticket.updatedAt)}
        </time>
        {ticket.attemptCount > 1 ? <span>Attempt {ticket.attemptCount}</span> : null}
        {ticket.totalCostUsd > 0 ? <span title="Agent cost so far">{formatCost(ticket.totalCostUsd)}</span> : null}
        {ticket.status === TicketStatus.Failed ? <span className="font-medium text-red-700">Failed</span> : null}
        {ticket.status === TicketStatus.Cancelled ? <span>Cancelled</span> : null}
        {attention ? (
          <span
            className={clsx(
              'ml-auto inline-flex items-center gap-1 font-medium',
              ticket.status === TicketStatus.NeedsContext ? 'text-amber-700' : 'text-teal-700',
            )}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {ticket.status === TicketStatus.NeedsContext ? 'Answer needed' : 'Review needed'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
