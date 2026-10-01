import { clsx } from 'clsx';
import type { AgentStatusDto } from '@agent-board/shared';
import { useAgentStatus, useSettings, useUpdateSettings } from '../api/queries';
import { useBoardNav } from '../hooks/useProjectSelection';
import { Button } from './Button';
import { Icon } from './Icon';
import { ProjectSwitcher } from './ProjectSwitcher';
import { Skeleton } from './Skeleton';

interface HeaderProps {
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onManageProjects: () => void;
  /** False until at least one project exists. */
  canCreateTicket: boolean;
  onNewTicket: () => void;
  onOpenSettings: () => void;
}

function BlockedNote({ blocked }: { blocked: AgentStatusDto['blockedProjects'] }) {
  if (blocked.length === 0) return null;
  const title = blocked.map((b) => `${b.name}: ${b.reason}`).join('\n');
  return (
    <span className="inline-flex items-center gap-1 text-amber-700" title={`The worker skips these projects:\n${title}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
      {blocked.length} {blocked.length === 1 ? 'project' : 'projects'} blocked
    </span>
  );
}

function WorkerStatusPill() {
  const { data: status, isLoading, isError } = useAgentStatus();
  const nav = useBoardNav();

  if (isLoading) return <Skeleton className="h-7 w-28 rounded-full" />;
  if (isError || !status) {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-meta text-muted">
        <span aria-hidden="true" className="size-2 rounded-full bg-stone-300" />
        Status unavailable
      </span>
    );
  }

  const queue = status.queueLength > 0 ? <span className="text-muted">{status.queueLength} queued</span> : null;
  const blocked = status.blockedProjects ?? [];
  const blockedNote = <BlockedNote blocked={blocked} />;
  const blockedLabel = blocked.length > 0 ? `, ${blocked.length} project${blocked.length === 1 ? '' : 's'} blocked` : '';

  if (status.state === 'running' && status.ticketId) {
    const ticketId = status.ticketId;
    return (
      <button
        type="button"
        onClick={() => nav.openTicket(ticketId)}
        className="inline-flex h-7 items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 text-meta font-medium text-indigo-800 hover:bg-indigo-100"
        aria-label={`Worker is working on ticket ${status.ticketNumber ?? ''}${blockedLabel}. Open ticket.`}
      >
        <span aria-hidden="true" className="relative flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-indigo-400 opacity-60" />
          <span className="relative size-2 animate-pulse-dot rounded-full bg-indigo-500" />
        </span>
        Working on #{status.ticketNumber ?? '…'}
        {queue}
        {blockedNote}
      </button>
    );
  }

  const paused = status.state === 'paused';
  return (
    <output
      className={clsx(
        'inline-flex h-7 items-center gap-2 rounded-full border px-2.5 text-meta font-medium',
        paused ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-line bg-surface text-ink',
      )}
      aria-label={`Worker ${paused ? 'paused' : 'idle'}, ${status.queueLength} queued${blockedLabel}`}
    >
      <span aria-hidden="true" className={clsx('size-2 rounded-full', paused ? 'bg-amber-500' : 'bg-green-500')} />
      {paused ? 'Paused' : 'Idle'}
      {queue}
      {blockedNote}
    </output>
  );
}

function PauseSwitch() {
  const { data: settings, isLoading } = useSettings();
  const update = useUpdateSettings({
    successMessage: (s) => (s.workerEnabled ? 'Worker resumed' : 'Worker paused; the current run finishes first'),
  });

  const enabled = settings?.workerEnabled ?? false;
  const pending = update.isPending;
  const shown = pending && update.variables?.workerEnabled !== undefined ? update.variables.workerEnabled : enabled;

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="hidden text-meta text-muted sm:inline">
        Worker
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        aria-label={shown ? 'Worker running; click to pause' : 'Worker paused; click to resume'}
        title={shown ? 'Pause the worker (the current run finishes)' : 'Resume the worker'}
        disabled={isLoading || !settings || pending}
        onClick={() => update.mutate({ workerEnabled: !enabled })}
        className={clsx(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60',
          shown ? 'border-accent bg-accent' : 'border-stone-300 bg-stone-200',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            'inline-block size-4 rounded-full bg-white shadow-sm transition-transform',
            shown ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function Header({
  selectedProjectId,
  onSelectProject,
  onManageProjects,
  canCreateTicket,
  onNewTicket,
  onOpenSettings,
}: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="grid size-6 place-items-center rounded-control bg-accent text-white">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <rect x="2" y="3" width="3" height="10" rx="1" />
            <rect x="6.5" y="3" width="3" height="7" rx="1" />
            <rect x="11" y="3" width="3" height="4" rx="1" />
          </svg>
        </span>
        <h1 className="text-[15px] font-semibold tracking-tight">Agent Board</h1>
      </div>
      <div className="ml-2 flex min-w-0 items-center gap-3">
        <ProjectSwitcher selectedId={selectedProjectId} onSelect={onSelectProject} onManage={onManageProjects} />
        <WorkerStatusPill />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <PauseSwitch />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <Button variant="ghost" onClick={onOpenSettings} icon={<Icon name="gear" />} aria-label="Settings">
          <span className="hidden sm:inline">Settings</span>
        </Button>
        <Button
          variant="primary"
          onClick={onNewTicket}
          disabled={!canCreateTicket}
          icon={<Icon name="plus" />}
          aria-keyshortcuts="N"
          title={canCreateTicket ? 'New ticket (N)' : 'Add a project first'}
        >
          New ticket
          <kbd className="ml-0.5 hidden rounded border border-white/30 px-1 font-sans text-[11px] leading-4 text-white/80 sm:inline">
            N
          </kbd>
        </Button>
      </div>
    </header>
  );
}
