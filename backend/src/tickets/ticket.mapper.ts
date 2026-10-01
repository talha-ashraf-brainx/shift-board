import type { TicketDto } from '@agent-board/shared';
import type { TicketEntity } from './ticket.entity';

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

export function ticketToDto(t: TicketEntity): TicketDto {
  return {
    id: t.id,
    number: t.number,
    projectId: t.projectId ?? null,
    title: t.title,
    description: t.description,
    rules: t.rules ?? [],
    priority: t.priority,
    status: t.status,
    sessionId: t.sessionId ?? null,
    branchName: t.branchName ?? null,
    worktreePath: t.worktreePath ?? null,
    worktreeId: t.worktreeId ?? null,
    maxBudgetUsd: t.maxBudgetUsd ?? null,
    agentSummary: t.agentSummary ?? null,
    attemptCount: t.attemptCount,
    lastError: t.lastError ?? null,
    totalCostUsd: Number(t.totalCostUsd ?? 0),
    lockedAt: iso(t.lockedAt),
    position: t.position,
    createdAt: iso(t.createdAt) as string,
    updatedAt: iso(t.updatedAt) as string,
  };
}
