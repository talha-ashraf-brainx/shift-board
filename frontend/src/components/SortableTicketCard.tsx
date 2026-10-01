import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEvent } from 'react';
import { ticketTitle, type TicketDto } from '@agent-board/shared';
import type { ColumnKey } from '../lib/meta';
import { STATUS_LABEL } from '../lib/meta';
import { TicketCard } from './TicketCard';

interface SortableTicketCardProps {
  ticket: TicketDto;
  columnKey: ColumnKey;
  index: number;
  disabled: boolean;
  onOpen: (ticket: TicketDto) => void;
}

export function SortableTicketCard({ ticket, columnKey, index, disabled, onOpen }: SortableTicketCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    data: { type: 'card', columnKey, ticket },
    disabled: { draggable: disabled, droppable: false },
  });

  const style = { transform: CSS.Translate.toString(transform), transition };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    listeners?.onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(ticket);
    }
  }

  return (
    <TicketCard
      ref={setNodeRef}
      ticket={ticket}
      index={index}
      dragging={isDragging}
      style={style}
      {...attributes}
      {...listeners}
      tabIndex={0}
      aria-roledescription={disabled ? 'ticket' : 'draggable ticket'}
      aria-label={`#${ticket.number} ${ticketTitle(ticket)}, ${STATUS_LABEL[ticket.status]}, ${ticket.priority} priority. Press Enter to open${disabled ? '' : ', Space to move'}.`}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(ticket)}
      className={disabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}
    />
  );
}
