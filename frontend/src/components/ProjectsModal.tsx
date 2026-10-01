import { useState } from 'react';
import { TicketStatus, type ProjectDto } from '@agent-board/shared';
import { useDeleteProject, useProjects } from '../api/queries';
import { STATUS_DOT, STATUS_LABEL } from '../lib/meta';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { FolderBrowser } from './FolderBrowser';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { AddProjectForm, EditProjectForm } from './ProjectForm';
import { RepoNotReadyDot } from './ProjectSwitcher';
import { Skeleton } from './Skeleton';

type View =
  | { kind: 'list' }
  | { kind: 'browse'; from: string | null }
  | { kind: 'add'; path: string }
  | { kind: 'edit'; projectId: string };

interface ProjectsModalProps {
  /** 'add' opens straight into the folder browser (e.g. from the empty board). */
  initialView?: 'list' | 'add';
  onClose: () => void;
  /** Called with a newly added (or an existing, picked) project so the board switches to it. */
  onSelectProject: (id: string) => void;
}

const COUNT_ORDER: TicketStatus[] = [
  TicketStatus.Pending,
  TicketStatus.InProgress,
  TicketStatus.NeedsContext,
  TicketStatus.Review,
  TicketStatus.Done,
  TicketStatus.Failed,
  TicketStatus.Cancelled,
];

const ACTIVE: TicketStatus[] = [TicketStatus.Pending, TicketStatus.InProgress, TicketStatus.NeedsContext, TicketStatus.Review];

function totalTickets(p: ProjectDto): number {
  return Object.values(p.ticketCounts).reduce((sum, n) => sum + (n ?? 0), 0);
}

function activeTickets(p: ProjectDto): number {
  return ACTIVE.reduce((sum, s) => sum + (p.ticketCounts[s] ?? 0), 0);
}

function TicketCounts({ project }: { project: ProjectDto }) {
  const entries = COUNT_ORDER.filter((s) => (project.ticketCounts[s] ?? 0) > 0);
  if (entries.length === 0) return <span className="text-muted">No tickets</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {entries.map((s) => (
        <span key={s} className="inline-flex items-center gap-1" title={STATUS_LABEL[s]}>
          <span aria-hidden="true" className={`size-1.5 rounded-full ${STATUS_DOT[s]}`} />
          <span className="tabular-nums">{project.ticketCounts[s]}</span>
          <span className="text-muted">{STATUS_LABEL[s].toLowerCase()}</span>
        </span>
      ))}
    </span>
  );
}

function ProjectRow({ project, onEdit, onDelete }: { project: ProjectDto; onEdit: () => void; onDelete: () => void }) {
  const ready = project.repoStatus.ready;
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold text-ink">{project.name}</h3>
          {ready ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-1.5 text-[11px] leading-[18px] font-medium text-green-800">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-green-600" />
              Ready
            </span>
          ) : (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 text-[11px] leading-[18px] font-medium text-amber-800"
              title={project.repoStatus.reason ?? undefined}
            >
              <RepoNotReadyDot reason={project.repoStatus.reason} className="size-1.5" />
              Not ready
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[12px] text-muted" title={project.repoPath}>
          {project.repoPath}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
          <span className="inline-flex items-center gap-1 text-muted">
            <Icon name="branch" width={12} height={12} />
            <code className="font-mono text-ink">{project.baseBranch}</code>
          </span>
          <TicketCounts project={project} />
        </p>
        {!ready && project.repoStatus.reason ? (
          <p className="mt-1 text-[12px] break-words text-amber-800">{project.repoStatus.reason}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" icon={<Icon name="edit" width={13} height={13} />} onClick={onEdit} aria-label={`Edit ${project.name}`}>
          Edit
        </Button>
        <Button size="sm" variant="danger" icon={<Icon name="trash" width={13} height={13} />} onClick={onDelete} aria-label={`Delete ${project.name}`}>
          Delete
        </Button>
      </div>
    </li>
  );
}

function DeleteProjectDialog({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const del = useDeleteProject();
  const total = totalTickets(project);
  const active = activeTickets(project);
  return (
    <ConfirmDialog
      title={`Delete ${project.name}?`}
      confirmLabel="Delete project"
      tone="danger"
      busy={del.isPending}
      onClose={onClose}
      onConfirm={() => del.mutate({ id: project.id, name: project.name }, { onSuccess: onClose })}
    >
      <p>
        {total > 0
          ? `Its ${total} ticket${total === 1 ? '' : 's'}, their worktrees and agent branches are deleted. `
          : 'The project has no tickets. '}
        The repository itself is not touched. This cannot be undone.
      </p>
      {active > 0 ? (
        <p className="mt-2 rounded-control border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-meta text-amber-900">
          {active} ticket{active === 1 ? ' is' : 's are'} still pending, running, waiting for an answer or in review. Finish or cancel
          {active === 1 ? ' it' : ' them'} first.
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

export function ProjectsModal({ initialView = 'list', onClose, onSelectProject }: ProjectsModalProps) {
  const [view, setView] = useState<View>(initialView === 'add' ? { kind: 'browse', from: null } : { kind: 'list' });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const projects = useProjects();
  const list = projects.data ?? [];
  const toList = () => setView({ kind: 'list' });

  if (view.kind === 'browse') {
    return (
      <FolderBrowser
        initialPath={view.from}
        onSelect={(path) => setView({ kind: 'add', path })}
        onBack={initialView === 'add' && list.length === 0 ? onClose : toList}
        onClose={onClose}
      />
    );
  }

  if (view.kind === 'add') {
    return (
      <AddProjectForm
        path={view.path}
        onBack={() => setView({ kind: 'browse', from: view.path })}
        onClose={onClose}
        onCreated={(p) => {
          onSelectProject(p.id);
          onClose();
        }}
        onOpenExisting={(id) => {
          onSelectProject(id);
          onClose();
        }}
      />
    );
  }

  if (view.kind === 'edit') {
    const project = list.find((p) => p.id === view.projectId);
    if (project) return <EditProjectForm key={project.id} project={project} onBack={toList} onClose={onClose} />;
  }

  const deleting = deletingId ? list.find((p) => p.id === deletingId) : undefined;

  return (
    <>
      <Modal
        title="Projects"
        description="Each project is a git repository the agent works in. Tickets from all projects share one queue."
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" icon={<Icon name="plus" />} onClick={() => setView({ kind: 'browse', from: null })} data-autofocus>
              Add project
            </Button>
          </>
        }
      >
        {projects.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : projects.isError && !projects.data ? (
          <p className="text-meta text-red-700">Could not load projects: {projects.error.message}</p>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-4 py-10 text-center">
            <Icon name="folder" width={20} height={20} className="text-muted" />
            <p className="font-medium">No projects yet</p>
            <p className="max-w-sm text-meta text-muted">Add a git repository to start creating tickets for it.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line" aria-label="Projects">
            {list.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                onEdit={() => setView({ kind: 'edit', projectId: p.id })}
                onDelete={() => setDeletingId(p.id)}
              />
            ))}
          </ul>
        )}
      </Modal>
      {deleting ? <DeleteProjectDialog project={deleting} onClose={() => setDeletingId(null)} /> : null}
    </>
  );
}
