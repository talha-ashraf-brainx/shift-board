import type { QueryClient } from '@tanstack/react-query';
import type { ProjectDto, TicketDto, TicketEventDto, TicketStatus, TicketWithEventsDto } from '@agent-board/shared';

export const queryKeys = {
  tickets: ['tickets'] as const,
  ticket: (id: string) => ['ticket', id] as const,
  settings: ['settings'] as const,
  agentStatus: ['agent-status'] as const,
  diff: (id: string) => ['diff', id] as const,
  projects: ['projects'] as const,
  inspect: (path: string) => ['projects', 'inspect', path] as const,
  browse: (path: string | null, showHidden: boolean) => ['fs-browse', path ?? '~', showHidden] as const,
};

function isNewer(incoming: TicketDto, existing: TicketDto): boolean {
  return new Date(incoming.updatedAt).getTime() >= new Date(existing.updatedAt).getTime();
}

/**
 * Upsert a ticket into the list cache and merge it into its detail cache
 * (keeping the already-loaded events). Stale payloads (older updatedAt) are ignored.
 * When the status changed, the cached diff is invalidated.
 */
export function applyTicket(qc: QueryClient, ticket: TicketDto): void {
  let previousStatus: TicketStatus | undefined;

  qc.setQueryData<TicketDto[]>(queryKeys.tickets, (old) => {
    if (!old) return old;
    const index = old.findIndex((t) => t.id === ticket.id);
    if (index === -1) return [...old, ticket];
    const existing = old[index];
    if (!existing) return old;
    previousStatus = existing.status;
    if (!isNewer(ticket, existing)) return old;
    const next = old.slice();
    next[index] = { ...existing, ...ticket };
    return next;
  });

  qc.setQueryData<TicketWithEventsDto>(queryKeys.ticket(ticket.id), (old) => {
    if (!old) return old;
    previousStatus ??= old.status;
    if (!isNewer(ticket, old)) return old;
    return { ...old, ...ticket, events: old.events };
  });

  if (previousStatus !== undefined && previousStatus !== ticket.status) {
    void qc.invalidateQueries({ queryKey: queryKeys.diff(ticket.id) });
  }
}

/** Append a timeline event to a cached ticket detail (deduped by id). */
export function appendEvent(qc: QueryClient, ticketId: string, event: TicketEventDto): void {
  qc.setQueryData<TicketWithEventsDto>(queryKeys.ticket(ticketId), (old) => {
    if (!old) return old;
    if (old.events.some((e) => e.id === event.id)) return old;
    return { ...old, events: [...old.events, event] };
  });
}

const byName = (a: ProjectDto, b: ProjectDto) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Upsert a project into the ['projects'] list cache (kept sorted by name). Stale payloads are ignored. */
export function applyProject(qc: QueryClient, project: ProjectDto): void {
  qc.setQueryData<ProjectDto[]>(queryKeys.projects, (old) => {
    if (!old) return old;
    const index = old.findIndex((p) => p.id === project.id);
    if (index === -1) return [...old, project].sort(byName);
    const existing = old[index];
    if (existing && new Date(project.updatedAt).getTime() < new Date(existing.updatedAt).getTime()) return old;
    const next = old.slice();
    next[index] = project;
    return next.sort(byName);
  });
}

/** Remove a project and its tickets from the caches. */
export function removeProject(qc: QueryClient, id: string): void {
  qc.setQueryData<ProjectDto[]>(queryKeys.projects, (old) => old?.filter((p) => p.id !== id));
  // Its tickets were deleted by cascade.
  qc.setQueryData<TicketDto[]>(queryKeys.tickets, (old) => old?.filter((t) => t.projectId !== id));
}
