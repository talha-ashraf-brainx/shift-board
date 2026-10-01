import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AnswerInput,
  CreateProjectInput,
  CreateTicketInput,
  SettingsDto,
  TicketDto,
  UpdateProjectInput,
  UpdateSettingsInput,
  UpdateTicketInput,
} from '@agent-board/shared';
import { toast } from 'sonner';
import { api, errorMessage } from './client';
import { applyProject, applyTicket, queryKeys, removeProject } from './cache';

export { queryKeys } from './cache';

// ---------- Queries ----------

export function useTickets() {
  return useQuery({ queryKey: queryKeys.tickets, queryFn: () => api.listTickets() });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ticket(id ?? ''),
    queryFn: () => api.getTicket(id as string),
    enabled: Boolean(id),
  });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.getSettings });
}

export function useAgentStatus() {
  return useQuery({ queryKey: queryKeys.agentStatus, queryFn: api.getAgentStatus });
}

/** All projects (sorted by name). Polled because repoStatus can change outside the app. */
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: api.listProjects,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useBrowse(path: string | null, showHidden: boolean) {
  return useQuery({
    queryKey: queryKeys.browse(path, showHidden),
    queryFn: () => api.browse(path, showHidden),
    retry: false,
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });
}

export function useInspectRepo(path: string | null) {
  return useQuery({
    queryKey: queryKeys.inspect(path ?? ''),
    queryFn: () => api.inspectRepo(path as string),
    enabled: Boolean(path),
    retry: false,
    staleTime: 0,
  });
}

export function useDiff(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.diff(id),
    queryFn: () => api.getDiff(id),
    enabled,
    retry: false,
    staleTime: 10_000,
  });
}

// ---------- Mutations ----------

function onTicketSuccess(qc: QueryClient, message: string | ((t: TicketDto) => string) | null) {
  return (ticket: TicketDto) => {
    applyTicket(qc, ticket);
    // Pull fresh events (e.g. the status_changed entry) in case the socket is down.
    void qc.invalidateQueries({ queryKey: queryKeys.ticket(ticket.id) });
    if (message) toast.success(typeof message === 'string' ? message : message(ticket));
  };
}

function onError(prefix: string) {
  return (err: unknown) => {
    toast.error(prefix, { description: errorMessage(err) });
  };
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => api.createTicket(input),
    onSuccess: onTicketSuccess(qc, (t) => `Created ticket #${t.number}`),
    onError: onError('Could not create the ticket'),
  });
}

export function useUpdateTicket(options: { silent?: boolean; successMessage?: string } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTicketInput }) => api.updateTicket(id, input),
    onSuccess: onTicketSuccess(
      qc,
      options.silent ? null : (t) => options.successMessage ?? `Saved ticket #${t.number}`,
    ),
    onError: (err) => {
      onError('Could not update the ticket')(err);
      void qc.invalidateQueries({ queryKey: queryKeys.tickets });
    },
  });
}

export function useAnswerTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & AnswerInput) => api.answer(id, input),
    onSuccess: onTicketSuccess(qc, (t) => `Answer sent; #${t.number} is back in the queue`),
    onError: onError('Could not send the answer'),
  });
}

export function useApproveTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.approve(id),
    onSuccess: onTicketSuccess(qc, (t) => `Approved and merged #${t.number}`),
    onError: onError('Merge failed'),
  });
}

export function useRejectTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, feedback }: { id: string; feedback: string }) => api.reject(id, { feedback }),
    onSuccess: onTicketSuccess(qc, (t) => `Rejected #${t.number}; the agent will revise it`),
    onError: onError('Could not reject the ticket'),
  });
}

export function useRetryTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => api.retry(id, note ? { note } : {}),
    onSuccess: onTicketSuccess(qc, (t) => `Requeued #${t.number} for another attempt`),
    onError: onError('Could not retry the ticket'),
  });
}

export function useCancelTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancel(id),
    onSuccess: onTicketSuccess(qc, (t) => `Cancelled #${t.number}`),
    onError: onError('Could not cancel the ticket'),
  });
}

export function useStartFresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resetWorktree }: { id: string; resetWorktree: boolean }) =>
      api.startFresh(id, { resetWorktree }),
    onSuccess: onTicketSuccess(qc, (t) => `#${t.number} will start a fresh session`),
    onError: onError('Could not start fresh'),
  });
}

export function useUpdateSettings(options: { successMessage?: (s: SettingsDto) => string } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.updateSettings(input),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.settings, settings);
      void qc.invalidateQueries({ queryKey: queryKeys.agentStatus });
      toast.success(options.successMessage ? options.successMessage(settings) : 'Settings saved');
    },
    onError: (err) => {
      onError('Could not update settings')(err);
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.createProject(input),
    onSuccess: (project) => {
      applyProject(qc, project);
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      toast.success(`Added project ${project.name}`);
    },
    onError: onError('Could not add the project'),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProjectInput }) => api.updateProject(id, input),
    onSuccess: (project) => {
      applyProject(qc, project);
      toast.success(`Saved project ${project.name}`);
    },
    onError: onError('Could not save the project'),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => api.deleteProject(id),
    onSuccess: (_res, { id, name }) => {
      removeProject(qc, id);
      void qc.invalidateQueries({ queryKey: queryKeys.agentStatus });
      toast.success(`Deleted project ${name}`);
    },
    onError: onError('Could not delete the project'),
  });
}

export function useAddWorktree() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) => api.addWorktree(projectId, name),
    onSuccess: (project, { name }) => {
      applyProject(qc, project);
      toast.success(`Added worktree ${name}`);
    },
    onError: onError('Could not add the worktree'),
  });
}

export function useActivateWorktree() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, worktreeId }: { projectId: string; worktreeId: string; name: string }) =>
      api.activateWorktree(projectId, worktreeId),
    onSuccess: (project, { name }) => {
      applyProject(qc, project);
      void qc.invalidateQueries({ queryKey: queryKeys.agentStatus });
      toast.success(`New tickets now run in ${name}`);
    },
    onError: onError('Could not switch the worktree'),
  });
}

export function useRemoveWorktree() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, worktreeId }: { projectId: string; worktreeId: string; name: string }) =>
      api.removeWorktree(projectId, worktreeId),
    onSuccess: (project, { name }) => {
      applyProject(qc, project);
      toast.success(`Removed worktree ${name}`);
    },
    onError: onError('Could not remove the worktree'),
  });
}

export interface PositionChange {
  id: string;
  position: number;
}

/** Reorder within a column: PATCH each changed position, with an optimistic cache update. */
export function useReorderTickets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ changes }: { changes: PositionChange[]; label: string }) =>
      Promise.all(changes.map((c) => api.updateTicket(c.id, { position: c.position }))),
    onMutate: async ({ changes }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tickets });
      const previous = qc.getQueryData<TicketDto[]>(queryKeys.tickets);
      const byId = new Map(changes.map((c) => [c.id, c.position]));
      qc.setQueryData<TicketDto[]>(queryKeys.tickets, (old) =>
        old?.map((t) => (byId.has(t.id) ? { ...t, position: byId.get(t.id) ?? t.position } : t)),
      );
      return { previous };
    },
    onSuccess: (tickets, { label }) => {
      for (const t of tickets) applyTicket(qc, t);
      toast.success(label);
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.tickets, ctx.previous);
      onError('Could not reorder')(err);
      void qc.invalidateQueries({ queryKey: queryKeys.tickets });
    },
  });
}
