import type {
  AgentStatusDto,
  AttachmentDto,
  AnswerInput,
  BrowseDto,
  CreateProjectInput,
  CreateTicketInput,
  DiffDto,
  ListTicketsQuery,
  ProjectDto,
  RejectInput,
  RepoInspectDto,
  RetryInput,
  SettingsDto,
  TicketDto,
  TicketWithEventsDto,
  UpdateProjectInput,
  UpdateSettingsInput,
  UpdateTicketInput,
} from '@agent-board/shared';

/** Error thrown for every non-2xx response; `message` is safe to show to the user. */
export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong';
}

function readMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string' && m) return m;
    if (Array.isArray(m) && m.length > 0) return m.map(String).join('; ');
  }
  return fallback;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      // FormData sets its own multipart Content-Type (with the boundary).
      headers:
        body === undefined || body instanceof FormData
          ? { Accept: 'application/json' }
          : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the API server. Is the backend running?');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const fallback = res.status >= 500 ? `Server error (${res.status})` : `Request failed (${res.status})`;
    throw new ApiError(res.status, readMessage(data, fallback));
  }
  return data as T;
}

const enc = encodeURIComponent;

function queryString(q?: ListTicketsQuery): string {
  if (!q) return '';
  const params = new URLSearchParams();
  if (q.projectId) params.set('projectId', q.projectId);
  if (q.status) params.set('status', q.status);
  if (q.priority) params.set('priority', q.priority);
  if (q.q) params.set('q', q.q);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  listTickets: (q?: ListTicketsQuery) => request<TicketDto[]>('GET', `/tickets${queryString(q)}`),
  getTicket: (id: string) => request<TicketWithEventsDto>('GET', `/tickets/${enc(id)}`),
  createTicket: (input: CreateTicketInput) => request<TicketDto>('POST', '/tickets', input),
  updateTicket: (id: string, input: UpdateTicketInput) => request<TicketDto>('PATCH', `/tickets/${enc(id)}`, input),
  answer: (id: string, input: AnswerInput) => request<TicketDto>('POST', `/tickets/${enc(id)}/answer`, input),
  approve: (id: string) => request<TicketDto>('POST', `/tickets/${enc(id)}/approve`),
  reject: (id: string, input: RejectInput) => request<TicketDto>('POST', `/tickets/${enc(id)}/reject`, input),
  retry: (id: string, input: RetryInput) => request<TicketDto>('POST', `/tickets/${enc(id)}/retry`, input),
  cancel: (id: string) => request<TicketDto>('POST', `/tickets/${enc(id)}/cancel`),
  startFresh: (id: string, input: { resetWorktree?: boolean }) =>
    request<TicketDto>('POST', `/tickets/${enc(id)}/start-fresh`, input),
  getDiff: (id: string) => request<DiffDto>('GET', `/tickets/${enc(id)}/diff`),
  getSettings: () => request<SettingsDto>('GET', '/settings'),
  updateSettings: (input: UpdateSettingsInput) => request<SettingsDto>('PUT', '/settings', input),
  getAgentStatus: () => request<AgentStatusDto>('GET', '/agent/status'),

  listProjects: () => request<ProjectDto[]>('GET', '/projects'),
  getProject: (id: string) => request<ProjectDto>('GET', `/projects/${enc(id)}`),
  inspectRepo: (path: string) => request<RepoInspectDto>('GET', `/projects/inspect?path=${enc(path)}`),
  createProject: (input: CreateProjectInput) => request<ProjectDto>('POST', '/projects', input),
  updateProject: (id: string, input: UpdateProjectInput) => request<ProjectDto>('PATCH', `/projects/${enc(id)}`, input),
  deleteProject: (id: string) => request<{ id: string }>('DELETE', `/projects/${enc(id)}`),
  addWorktree: (projectId: string, name: string) =>
    request<ProjectDto>('POST', `/projects/${enc(projectId)}/worktrees`, { name }),
  activateWorktree: (projectId: string, worktreeId: string) =>
    request<ProjectDto>('POST', `/projects/${enc(projectId)}/worktrees/${enc(worktreeId)}/activate`),
  removeWorktree: (projectId: string, worktreeId: string) =>
    request<ProjectDto>('DELETE', `/projects/${enc(projectId)}/worktrees/${enc(worktreeId)}`),

  /** Uploads one image (PNG, JPEG, GIF or WebP, at most 10 MB); reference it as `![filename](url)`. */
  uploadAttachment: (file: File, ticketId?: string) => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (ticketId) form.append('ticketId', ticketId);
    return request<AttachmentDto>('POST', '/attachments', form);
  },

  browse: (path: string | null, showHidden: boolean) => {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (showHidden) params.set('showHidden', 'true');
    const s = params.toString();
    return request<BrowseDto>('GET', `/fs/browse${s ? `?${s}` : ''}`);
  },
};
