import { clsx } from 'clsx';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { TicketDto } from '@agent-board/shared';
import type { ColumnDef } from '../lib/meta';
import { CardSkeleton } from './Skeleton';
import { Icon } from './Icon';
import { SortableTicketCard } from './SortableTicketCard';

export type DropState = 'source' | 'valid' | 'invalid' | null;

interface ColumnProps {
  column: ColumnDef;
  tickets: TicketDto[];
  loading: boolean;
  dropState: DropState;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpen: (ticket: TicketDto) => void;
  canDrag: (ticket: TicketDto) => boolean;
}

export function Column({
  column,
  tickets,
  loading,
  dropState,
  collapsed = false,
  onToggleCollapsed,
  onOpen,
  canDrag,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.key}`,
    data: { type: 'column', columnKey: column.key },
  });
  const headingId = `col-heading-${column.key}`;
  const overValid = isOver && dropState === 'valid';
  const overInvalid = isOver && dropState === 'invalid';

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-labelledby={headingId}
        className={clsx(
          'flex h-full w-11 shrink-0 flex-col items-center transition-colors',
          dropState === 'valid' && 'bg-accent-soft',
          overValid && 'ring-2 ring-accent/40 ring-inset',
          dropState === 'invalid' && 'opacity-40',
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded="false"
          aria-label={`Expand ${column.title} column (${tickets.length})`}
          className="flex h-full w-full flex-col items-center gap-2 py-3 text-muted hover:text-ink"
        >
          <Icon name="chevron-right" />
          <span aria-hidden="true" className={clsx('size-2 rounded-full', column.dot)} />
          <span className="text-meta font-medium tabular-nums">{tickets.length}</span>
          <span id={headingId} className="mt-1 text-meta font-medium whitespace-nowrap [writing-mode:vertical-rl]">
            {dropState === 'valid' ? (column.key === 'closed' ? 'Drop to cancel' : 'Drop here') : column.title}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={clsx(
        'flex h-full w-[23.5rem] shrink-0 flex-col transition-[background-color,opacity]',
        dropState === 'valid' && 'bg-accent-soft/60',
        overValid && 'bg-accent-soft ring-2 ring-accent/30 ring-inset',
        dropState === 'invalid' && 'opacity-45',
        overInvalid && 'cursor-not-allowed',
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span aria-hidden="true" className={clsx('size-2 rounded-full', column.dot)} />
        <h2 id={headingId} className="text-meta font-semibold text-ink">
          {column.title}
        </h2>
        <span className="rounded-full bg-surface px-1.5 text-[12px] leading-[18px] font-medium text-muted tabular-nums" aria-label={`${tickets.length} tickets`}>
          {loading ? '–' : tickets.length}
        </span>
        {dropState === 'valid' ? (
          <span className="ml-auto animate-fade-in text-[12px] font-medium text-accent">
            {column.key === 'closed' ? 'Drop to cancel' : 'Drop here'}
          </span>
        ) : null}
        {onToggleCollapsed && dropState !== 'valid' ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded="true"
            aria-label={`Collapse ${column.title} column`}
            className="ml-auto rounded-control p-0.5 text-muted hover:bg-stone-300/60 hover:text-ink"
          >
            <Icon name="chevron-down" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col gap-2">
            <CardSkeleton />
            <CardSkeleton />
            {column.key === 'pending' ? <CardSkeleton /> : null}
          </div>
        ) : (
          <SortableContext id={column.key} items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2" aria-label={`${column.title} tickets`}>
              {tickets.map((t, i) => (
                <li key={t.id}>
                  <SortableTicketCard ticket={t} index={i} columnKey={column.key} disabled={!canDrag(t)} onOpen={onOpen} />
                </li>
              ))}
            </ul>
            {tickets.length === 0 ? (
              <div className="rounded-card border border-dashed border-line-strong px-3 py-6 text-center text-meta text-muted">
                {column.empty}
              </div>
            ) : null}
          </SortableContext>
        )}
      </div>
    </section>
  );
}
