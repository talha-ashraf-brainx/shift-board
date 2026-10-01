import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { compareTickets, findDragTransition, TicketStatus, type TicketDto } from '@agent-board/shared';
import { toast } from 'sonner';
import { useReorderTickets, type PositionChange } from '../api/queries';
import { COLUMNS, columnForStatus, PRIORITY_LABEL, STATUS_LABEL, type ColumnDef, type ColumnKey } from '../lib/meta';
import type { TicketDialog } from './ActionDialogs';
import { Column, type DropState } from './Column';
import { TicketCard } from './TicketCard';

interface BoardProps {
  tickets: TicketDto[] | undefined;
  loading: boolean;
  onOpen: (ticket: TicketDto) => void;
  onDialog: (kind: TicketDialog, ticket: TicketDto) => void;
}

type CardData = { type: 'card'; columnKey: ColumnKey; ticket: TicketDto };
type ColumnData = { type: 'column'; columnKey: ColumnKey };
type DropData = CardData | ColumnData;

/** Which dialog a drag transition opens. */
function dialogFor(from: TicketStatus, to: TicketStatus): TicketDialog | null {
  if (to === TicketStatus.Cancelled) return 'cancel';
  if (from === TicketStatus.Review && to === TicketStatus.Done) return 'approve';
  if (from === TicketStatus.Review && to === TicketStatus.Pending) return 'reject';
  if (from === TicketStatus.Failed && to === TicketStatus.Pending) return 'retry';
  return null;
}

function canDropOn(ticket: TicketDto, column: ColumnDef): boolean {
  return Boolean(findDragTransition(ticket.status, column.dropStatus)) && !column.statuses.includes(ticket.status);
}

function canDrag(ticket: TicketDto): boolean {
  const own = columnForStatus(ticket.status);
  return own.reorderable || COLUMNS.some((c) => canDropOn(ticket, c));
}

/** Prefer the card under the pointer, then the column, then the closest droppable (keyboard). */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (within.length > 0) {
    const cardIds = new Set(
      within
        .filter((c) => {
          const container = args.droppableContainers.find((d) => d.id === c.id);
          return (container?.data.current as DropData | undefined)?.type === 'card';
        })
        .map((c) => c.id),
    );
    if (cardIds.size > 0) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((d) => cardIds.has(d.id)) });
    }
    return within;
  }
  return closestCenter(args);
};

export function Board({ tickets, loading, onOpen, onDialog }: BoardProps) {
  const [active, setActive] = useState<TicketDto | null>(null);
  const [closedCollapsed, setClosedCollapsed] = useState(true);
  const reorder = useReorderTickets();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const grouped = useMemo(() => {
    const map = new Map<ColumnKey, TicketDto[]>(COLUMNS.map((c) => [c.key, []]));
    for (const t of tickets ?? []) map.get(columnForStatus(t.status).key)?.push(t);
    for (const list of map.values()) list.sort(compareTickets);
    return map;
  }, [tickets]);

  function dropStateFor(column: ColumnDef): DropState {
    if (!active) return null;
    if (column.statuses.includes(active.status)) return 'source';
    return canDropOn(active, column) ? 'valid' : 'invalid';
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as CardData | undefined;
    setActive(data?.ticket ?? null);
  }

  function handleReorder(ticket: TicketDto, column: ColumnDef, overTicket: TicketDto) {
    if (!column.reorderable || overTicket.id === ticket.id) return;
    if (overTicket.projectId !== ticket.projectId) {
      toast.info('Cards are ordered within their project', {
        description: `#${ticket.number} and #${overTicket.number} belong to different projects.`,
      });
      return;
    }
    if (overTicket.priority !== ticket.priority) {
      toast.info('Cards are ordered by priority first', {
        description: `Change #${ticket.number}'s priority to move it into the ${PRIORITY_LABEL[overTicket.priority].toLowerCase()} group.`,
      });
      return;
    }
    // Positions are per project and priority.
    const group = (grouped.get(column.key) ?? []).filter(
      (t) => t.priority === ticket.priority && t.projectId === ticket.projectId,
    );
    const from = group.findIndex((t) => t.id === ticket.id);
    const to = group.findIndex((t) => t.id === overTicket.id);
    if (from === -1 || to === -1 || from === to) return;
    const reordered = arrayMove(group, from, to);
    // Renumber the priority group 0..n-1 (integers), sending only the changed ones.
    const changes: PositionChange[] = reordered
      .map((t, i) => ({ id: t.id, position: i, current: t.position }))
      .filter((c) => c.position !== c.current)
      .map(({ id, position }) => ({ id, position }));
    if (changes.length === 0) return;
    reorder.mutate({ changes, label: `Moved #${ticket.number}` });
  }

  function onDragEnd(e: DragEndEvent) {
    const ticket = active ?? (e.active.data.current as CardData | undefined)?.ticket ?? null;
    setActive(null);
    if (!ticket || !e.over) return;
    const over = e.over.data.current as DropData | undefined;
    if (!over) return;

    const source = columnForStatus(ticket.status);
    const target = COLUMNS.find((c) => c.key === over.columnKey);
    if (!target) return;

    if (target.key === source.key) {
      if (over.type === 'card') handleReorder(ticket, source, over.ticket);
      return;
    }

    const transition = findDragTransition(ticket.status, target.dropStatus);
    const kind = transition ? dialogFor(transition.from, transition.to) : null;
    if (!transition || !kind) {
      toast.error(`#${ticket.number} can't move from ${STATUS_LABEL[ticket.status]} to ${target.title}`, {
        description:
          ticket.status === TicketStatus.NeedsContext && target.dropStatus === TicketStatus.Pending
            ? 'Open the ticket and answer the agent’s questions to requeue it.'
            : undefined,
      });
      return;
    }
    onDialog(kind, ticket);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto px-4 pt-3 pb-4">
        {COLUMNS.map((column) => (
          <Column
            key={column.key}
            column={column}
            tickets={grouped.get(column.key) ?? []}
            loading={loading}
            dropState={dropStateFor(column)}
            collapsed={column.key === 'closed' ? closedCollapsed : false}
            onToggleCollapsed={column.key === 'closed' ? () => setClosedCollapsed((c) => !c) : undefined}
            onOpen={onOpen}
            canDrag={canDrag}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>{active ? <TicketCard ticket={active} overlay className="cursor-grabbing" /> : null}</DragOverlay>
    </DndContext>
  );
}
