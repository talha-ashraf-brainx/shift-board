import { clsx } from 'clsx';
import type { AgentStatusDto } from '@agent-board/shared';
import { useAgentStatus, useSettings, useUpdateSettings } from '../api/queries';
import { useBoardNav } from '../hooks/useProjectSelection';
import { setThemePreference, useTheme } from '../hooks/useTheme';
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
  /** Why New ticket is disabled (tooltip). */
  cantCreateReason?: string | null;
  onNewTicket: () => void;
  onOpenSettings: () => void;
}

function BlockedNote({ blocked }: { blocked: AgentStatusDto['blockedProjects'] }) {
  if (blocked.length === 0) return null;
  const title = blocked.map((b) => `${b.name}: ${b.reason}`).join('\n');
  return (
    <span className="inline-flex items-center gap-1 border-l border-current/15 pl-2 text-amber-700" title={`The worker skips these projects:\n${title}`}>
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
      <span className="inline-flex h-8 animate-fade-in items-center gap-2 rounded-full border border-line bg-surface px-3 text-meta text-muted">
        <span aria-hidden="true" className="size-2 rounded-full bg-stone-300" />
        Status unavailable
      </span>
    );
  }

  const waiting = status.waiting ?? [];
  const queue =
    status.queueLength > 0 ? (
      <span
        className="border-l border-current/15 pl-2 font-normal opacity-75 tabular-nums"
        title={
          waiting.length > 0
            ? waiting.map((w) => `#${w.ticketNumber} waits for ${w.worktreeName} (busy with #${w.heldByNumber})`).join('\n')
            : undefined
        }
      >
        {status.queueLength} queued{waiting.length > 0 ? `, ${waiting.length} waiting for a worktree` : ''}
      </span>
    ) : null;
  const blocked = status.blockedProjects ?? [];
  const blockedNote = <BlockedNote blocked={blocked} />;
  const blockedLabel = blocked.length > 0 ? `, ${blocked.length} project${blocked.length === 1 ? '' : 's'} blocked` : '';

  const running = status.running ?? [];
  if (status.state === 'running' && running.length > 1) {
    return (
      <span
        className="inline-flex h-8 animate-fade-in items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 text-meta font-medium text-violet-800"
        aria-label={`Worker is working on ${running.length} tickets${blockedLabel}`}
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-violet-500" />
        <span>
          Working on{' '}
          {running.map((r, i) => (
            <span key={r.ticketId}>
              {i > 0 ? ', ' : null}
              <button
                type="button"
                onClick={() => nav.openTicket(r.ticketId)}
                className="rounded-[4px] hover:underline"
                aria-label={`Open ticket ${r.ticketNumber}`}
              >
                #{r.ticketNumber}
              </button>
            </span>
          ))}
        </span>
        {queue}
        {blockedNote}
      </span>
    );
  }

  if (status.state === 'running' && status.ticketId) {
    const ticketId = status.ticketId;
    return (
      <button
        type="button"
        onClick={() => nav.openTicket(ticketId)}
        className="inline-flex h-8 animate-fade-in items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 text-meta font-medium text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-100"
        aria-label={`Worker is working on ticket ${status.ticketNumber ?? ''}${blockedLabel}. Open ticket.`}
      >
        <span aria-hidden="true" className="relative flex size-2">
          <span className="relative size-2 rounded-full bg-violet-500" />
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
        'inline-flex h-8 animate-fade-in items-center gap-2 rounded-full border px-3 text-meta font-medium',
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
          'duration-200 ease-out-soft',
          shown ? 'border-accent bg-accent' : 'border-line-strong bg-stone-200',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            'inline-block size-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-300 ease-spring',
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
  cantCreateReason,
  onNewTicket,
  onOpenSettings,
}: HeaderProps) {
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-surface/75 sm:px-5">
      <div className="flex items-center gap-2.5">
        <Logo />
        <h1 className="font-display text-[19px] leading-none font-semibold">Shiftboard</h1>
      </div>
      <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />
      <div className="flex min-w-0 items-center gap-2.5">
        <ProjectSwitcher selectedId={selectedProjectId} onSelect={onSelectProject} onManage={onManageProjects} />
        <WorkerStatusPill />
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <PauseSwitch />
        <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-line" />
        <ThemeToggle />
        <Button variant="ghost" onClick={onOpenSettings} icon={<Icon name="gear" />} aria-label="Settings">
          <span className="hidden md:inline">Settings</span>
        </Button>
        <Button
          variant="primary"
          onClick={onNewTicket}
          disabled={!canCreateTicket}
          icon={<Icon name="plus" />}
          aria-keyshortcuts="N"
          title={canCreateTicket ? 'New ticket (N)' : (cantCreateReason ?? 'Add a project first')}
          className="ml-1"
        >
          <span className="hidden sm:inline">New ticket</span>
          <kbd className="ml-0.5 hidden rounded-[4px] border border-on-primary/25 px-1 font-sans text-[11px] leading-4 text-on-primary/70 sm:inline">
            N
          </kbd>
        </Button>
      </div>
    </header>
  );
}

/** Three shift lanes; the middle one, the agent's, is lit. */
function Logo() {
  return (
    <span aria-hidden="true" className="grid size-7 place-items-center rounded-[8px] bg-primary text-on-primary">
      <svg viewBox="0 0 16 16" width="16" height="16">
        <rect x="2.5" y="3" width="2.5" height="10" rx="1.25" fill="currentColor" opacity="0.45" />
        <rect x="6.75" y="3" width="2.5" height="10" rx="1.25" className="fill-accent" />
        <rect x="11" y="3" width="2.5" height="10" rx="1.25" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  );
}

function ThemeToggle() {
  const { resolved } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="group grid size-8 place-items-center overflow-hidden rounded-control text-muted transition-colors hover:bg-stone-100 hover:text-ink"
    >
      <span key={resolved} className="grid animate-[pop-in_260ms_var(--ease-spring)_both] place-items-center">
        <Icon name={resolved === 'dark' ? 'moon' : 'sun'} className="transition-transform duration-300 group-hover:rotate-12" />
      </span>
    </button>
  );
}
