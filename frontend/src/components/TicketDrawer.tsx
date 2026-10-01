import { clsx } from 'clsx';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  ALL_PRIORITIES,
  HUMAN_ALLOWED_TRANSITIONS,
  TicketStatus,
  type TicketPriority,
  type TicketWithEventsDto,
} from '@agent-board/shared';
import { ApiError } from '../api/client';
import { useTicket, useUpdateTicket } from '../api/queries';
import { useLayer } from '../hooks/useLayer';
import { useBoardNav, useProject } from '../hooks/useProjectSelection';
import { useTick } from '../hooks/useTick';
import { formatCost, PRIORITY_LABEL, shortId } from '../lib/meta';
import { absoluteTime, relativeTime } from '../lib/time';
import { TicketDialogHost, type TicketDialog } from './ActionDialogs';
import { ActivityTimeline } from './ActivityTimeline';
import { StatusBadge } from './Badges';
import { Button } from './Button';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { NeedsContextPanel } from './NeedsContextPanel';
import { ReviewPanel, TicketDiff } from './ReviewPanel';
import { Skeleton } from './Skeleton';
import { TicketFormModal } from './TicketFormModal';

type Tab = 'details' | 'activity' | 'diff';

const EDITABLE: readonly TicketStatus[] = [
  TicketStatus.Pending,
  TicketStatus.InProgress,
  TicketStatus.NeedsContext,
  TicketStatus.Review,
  TicketStatus.Failed,
];

function MetaItem({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="truncate text-meta" title={title}>
        {children}
      </dd>
    </div>
  );
}

function DetailsTab({ ticket }: { ticket: TicketWithEventsDto }) {
  const sections: { label: string; body: string | null; empty: string }[] = [
    { label: 'Description', body: ticket.description, empty: 'No description.' },
    { label: 'Context', body: ticket.context, empty: 'No extra context provided.' },
    { label: 'Rules for this ticket', body: ticket.rules, empty: 'No ticket-specific rules; only the global rules apply.' },
  ];
  return (
    <div className="flex flex-col gap-5">
      {sections.map((s) => (
        <section key={s.label} aria-label={s.label}>
          <h3 className="mb-1 text-[12px] font-medium text-muted">{s.label}</h3>
          {s.body?.trim() ? <Markdown>{s.body}</Markdown> : <p className="text-meta text-muted">{s.empty}</p>}
        </section>
      ))}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading ticket">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-3/4" />
      <div className="grid grid-cols-4 gap-3">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function DrawerContent({ ticket, onClose }: { ticket: TicketWithEventsDto; onClose: () => void }) {
  useTick();
  const [tab, setTab] = useState<Tab | null>(null);
  const [dialog, setDialog] = useState<TicketDialog | null>(null);
  const [editing, setEditing] = useState(false);
  const updatePriority = useUpdateTicket({ successMessage: 'Priority updated' });
  const project = useProject(ticket.projectId);
  const projectName = project?.name ?? (ticket.projectId ? 'Unknown project' : 'No project');

  const status = ticket.status;
  const inProgress = status === TicketStatus.InProgress;
  const diffEnabled = status === TicketStatus.Review || status === TicketStatus.Done;
  const defaultTab: Tab = diffEnabled ? 'diff' : 'details';
  const activeTab: Tab = tab === null || (tab === 'diff' && !diffEnabled) ? defaultTab : tab;
  const canCancel = HUMAN_ALLOWED_TRANSITIONS[status].includes(TicketStatus.Cancelled);
  const showStartFresh = status !== TicketStatus.Done && status !== TicketStatus.Cancelled;
  const priorityLocked = inProgress || status === TicketStatus.Done || status === TicketStatus.Cancelled;

  const tabs: { key: Tab; label: string; disabled: boolean; hint?: string }[] = [
    { key: 'details', label: 'Details', disabled: false },
    { key: 'activity', label: `Activity`, disabled: false },
    { key: 'diff', label: 'Diff', disabled: !diffEnabled, hint: 'Available once the ticket is in review' },
  ];
  const enabledTabs = tabs.filter((t) => !t.disabled);

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = enabledTabs.findIndex((t) => t.key === activeTab);
    const next = enabledTabs[(idx + (e.key === 'ArrowRight' ? 1 : enabledTabs.length - 1)) % enabledTabs.length];
    if (next) {
      setTab(next.key);
      document.getElementById(`tab-${next.key}`)?.focus();
    }
  }

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-meta text-muted">#{ticket.number}</span>
          <StatusBadge status={status} />
          <span
            className="inline-flex min-w-0 items-center gap-1 text-meta text-muted"
            title={project ? `${project.name} (${project.repoPath})` : undefined}
          >
            <Icon name="folder" width={13} height={13} className="shrink-0" />
            <span className="truncate">{projectName}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ticket"
            className="ml-auto rounded-control p-1 text-muted hover:bg-stone-100 hover:text-ink"
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="drawer-title" className="mt-1.5 text-[17px] leading-snug font-semibold break-words">
          {ticket.title}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="drawer-priority" className="sr-only">
            Priority
          </label>
          <select
            id="drawer-priority"
            value={ticket.priority}
            disabled={priorityLocked || updatePriority.isPending}
            title={inProgress ? 'Priority is locked while the agent works on the ticket' : 'Priority'}
            onChange={(e) =>
              updatePriority.mutate({ id: ticket.id, input: { priority: e.target.value as TicketPriority } })
            }
            className="field h-8 w-auto py-0 pr-7 text-meta"
          >
            {ALL_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]} priority
              </option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap gap-2">
            {EDITABLE.includes(status) ? (
              <Button
                size="sm"
                icon={<Icon name="edit" width={13} height={13} />}
                onClick={() => setEditing(true)}
                disabled={inProgress}
                title={inProgress ? 'Editing is disabled while the agent works on the ticket' : undefined}
              >
                Edit
              </Button>
            ) : null}
            {status === TicketStatus.Failed ? (
              <Button size="sm" variant="primary" icon={<Icon name="refresh" width={13} height={13} />} onClick={() => setDialog('retry')}>
                Retry
              </Button>
            ) : null}
            {showStartFresh ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDialog('start-fresh')}
                disabled={inProgress}
                title={inProgress ? 'Not available while the agent is running' : 'Clear the agent session and start over'}
              >
                Start fresh
              </Button>
            ) : null}
            {canCancel ? (
              <Button size="sm" variant="danger" onClick={() => setDialog('cancel')}>
                Cancel ticket
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-card border border-line bg-page/50 px-3 py-2.5 sm:grid-cols-4">
          <MetaItem label="Project" title={project?.repoPath}>
            {projectName}
          </MetaItem>
          <MetaItem label="Base branch">
            {project ? <code className="font-mono text-[12px]">{project.baseBranch}</code> : <span className="text-muted">Unknown</span>}
          </MetaItem>
          <MetaItem label="Attempts">{ticket.attemptCount}</MetaItem>
          <MetaItem label="Cost">{formatCost(ticket.totalCostUsd)}</MetaItem>
          <MetaItem label="Branch" title={ticket.branchName ?? undefined}>
            {ticket.branchName ? <code className="font-mono text-[12px]">{ticket.branchName}</code> : <span className="text-muted">None yet</span>}
          </MetaItem>
          <MetaItem label="Session" title={ticket.sessionId ?? undefined}>
            {ticket.sessionId ? <code className="font-mono text-[12px]">{shortId(ticket.sessionId)}</code> : <span className="text-muted">None</span>}
          </MetaItem>
          <MetaItem label="Created" title={absoluteTime(ticket.createdAt)}>
            {relativeTime(ticket.createdAt)}
          </MetaItem>
          <MetaItem label="Updated" title={absoluteTime(ticket.updatedAt)}>
            {relativeTime(ticket.updatedAt)}
          </MetaItem>
        </dl>

        {status === TicketStatus.Failed && ticket.lastError ? (
          <div role="alert" className="rounded-card border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-meta font-semibold text-red-800">
              <Icon name="alert" width={14} height={14} />
              The last run failed
            </p>
            <pre className="mt-1 max-h-48 overflow-auto font-mono text-[12px] break-words whitespace-pre-wrap text-red-900">
              {ticket.lastError}
            </pre>
          </div>
        ) : null}

        {status === TicketStatus.NeedsContext ? <NeedsContextPanel ticket={ticket} /> : null}
        {status === TicketStatus.Review ? <ReviewPanel ticket={ticket} onReject={() => setDialog('reject')} /> : null}

        <div>
          <div role="tablist" aria-label="Ticket sections" className="flex gap-1 border-b border-line">
            {tabs.map((t) => (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                aria-controls={`tabpanel-${t.key}`}
                tabIndex={activeTab === t.key ? 0 : -1}
                disabled={t.disabled}
                title={t.disabled ? t.hint : undefined}
                onClick={() => setTab(t.key)}
                onKeyDown={onTabKeyDown}
                className={clsx(
                  '-mb-px border-b-2 px-2.5 py-1.5 text-meta font-medium',
                  activeTab === t.key ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted',
                )}
              >
                {t.label}
                {t.key === 'activity' ? (
                  <span className="ml-1 text-[12px] text-muted tabular-nums">{ticket.events.length}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div id={`tabpanel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="pt-4">
            {activeTab === 'details' ? <DetailsTab ticket={ticket} /> : null}
            {activeTab === 'activity' ? <ActivityTimeline events={ticket.events} /> : null}
            {activeTab === 'diff' && diffEnabled ? <TicketDiff ticketId={ticket.id} /> : null}
          </div>
        </div>
      </div>

      {editing ? <TicketFormModal ticket={ticket} onClose={() => setEditing(false)} /> : null}
      <TicketDialogHost kind={dialog} ticket={ticket} onClose={() => setDialog(null)} />
    </>
  );
}

/** Routed at /tickets/:id; renders over the board (non-modal, so the board stays usable). */
export function TicketDrawer() {
  const { id } = useParams<{ id: string }>();
  return id ? <DrawerPanel key={id} id={id} /> : null;
}

function DrawerPanel({ id }: { id: string }) {
  const nav = useBoardNav();
  const panelRef = useRef<HTMLDialogElement>(null);
  const { data, isLoading, isError, error } = useTicket(id);
  const close = nav.toBoard;
  useLayer('drawer', close);

  // Move focus into the drawer when it opens; restore it on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  const notFound = isError && error instanceof ApiError && error.statusCode === 404;

  return (
    <dialog
      open
      ref={panelRef}
      aria-modal="false"
      aria-labelledby={data ? 'drawer-title' : undefined}
      aria-label={data ? undefined : 'Ticket'}
      tabIndex={-1}
      className="fixed inset-y-0 right-0 left-auto z-40 m-0 flex h-full max-h-none w-full max-w-[46rem] flex-col border-l border-line bg-surface text-ink shadow-sm outline-none"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data ? (
          <DrawerContent key={data.id} ticket={data} onClose={close} />
        ) : isLoading ? (
          <DrawerSkeleton />
        ) : (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="font-medium">{notFound ? 'This ticket does not exist.' : 'Could not load the ticket.'}</p>
            {!notFound && error ? <p className="text-meta text-muted">{error.message}</p> : null}
            <Button onClick={close}>Back to the board</Button>
          </div>
        )}
      </div>
    </dialog>
  );
}
