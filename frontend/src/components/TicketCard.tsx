import { clsx } from 'clsx';
import type { HTMLAttributes, Ref } from 'react';
import { TicketStatus, ticketTitle, type TicketDto } from '@agent-board/shared';
import { formatCost, needsHuman } from '../lib/meta';
import { useProjectTag } from '../lib/projectTags';
import { absoluteTime, relativeTime } from '../lib/time';
import { PriorityBadge } from './Badges';

interface TicketCardProps extends HTMLAttributes<HTMLDivElement> {
  ticket: TicketDto;
  dragging?: boolean;
  overlay?: boolean;
  /** Position in its column; staggers the entrance on first load. */
  index?: number;
  ref?: Ref<HTMLDivElement>;
}

/** Presentational card; drag/sortable wiring lives in SortableTicketCard. */
export function TicketCard({ ticket, dragging = false, overlay = false, index = 0, className, style, ref, ...rest }: TicketCardProps) {
  const attention = needsHuman(ticket.status);
  const muted = ticket.status === TicketStatus.Cancelled;
  const projectTag = useProjectTag(ticket.projectId);
  const working = ticket.status === TicketStatus.InProgress;
  return (
    <div
      ref={ref}
      style={overlay ? style : { animationDelay: `${Math.min(index, 8) * 35}ms`, ...style }}
      className={clsx(
        'group relative rounded-card border bg-card p-3 text-left',
        'transition-[border-color,opacity] duration-200 ease-out-soft',
        working ? 'working-edge border-violet-200' : 'border-line',
        !overlay && 'animate-card-in',
        dragging && !overlay && 'opacity-40',
        overlay && 'animate-lift border-accent/60',
        !dragging && !overlay && 'hover:border-line-strong',
        muted && 'opacity-65',
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
          <span className="shrink-0 text-[12px] font-medium text-muted tabular-nums">#{ticket.number}</span>
          {projectTag ? (
            <span
              className="truncate rounded-[5px] bg-stone-100 px-1.5 dark:bg-stone-300/60 text-[11px] leading-[18px] font-medium text-stone-600"
              title={`Project: ${projectTag}`}
            >
              {projectTag}
            </span>
          ) : null}
        </span>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <p className="mt-1.5 line-clamp-2 leading-snug font-medium break-words text-ink">{ticketTitle(ticket)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
        <time dateTime={ticket.updatedAt} title={`Updated ${absoluteTime(ticket.updatedAt)}`}>
          {relativeTime(ticket.updatedAt)}
        </time>
        {ticket.attemptCount > 1 ? <span>Attempt {ticket.attemptCount}</span> : null}
        {ticket.totalCostUsd > 0 ? <span title="Agent cost so far">{formatCost(ticket.totalCostUsd)}</span> : null}
        {working ? <span className="font-medium text-violet-700">Agent working</span> : null}
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
