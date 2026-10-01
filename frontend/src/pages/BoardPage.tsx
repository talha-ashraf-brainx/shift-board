import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { TicketDto } from '@agent-board/shared';
import { useProjects, useTickets } from '../api/queries';
import { TicketDialogHost, type TicketDialog } from '../components/ActionDialogs';
import { ProjectNotReadyBanner, ReconnectingBanner } from '../components/Banners';
import { Board } from '../components/Board';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { ProjectsModal } from '../components/ProjectsModal';
import { SettingsModal } from '../components/SettingsModal';
import { TicketFormModal } from '../components/TicketFormModal';
import { isModalOpen } from '../hooks/useLayer';
import { useBoardNav, useProjectSelection } from '../hooks/useProjectSelection';
import { ProjectTagsContext } from '../lib/projectTags';
import { useTick } from '../hooks/useTick';
import type { SocketState } from '../hooks/useSocketSync';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function NoProjectsState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md animate-pop-in flex-col items-center gap-3 rounded-[16px] border border-line bg-surface px-9 py-11 text-center shadow-card">
        <span aria-hidden="true" className="mb-1 grid size-12 place-items-center rounded-[12px] bg-accent-soft text-accent">
          <Icon name="folder" width={20} height={20} />
        </span>
        <h2 className="font-display text-[22px] leading-tight font-semibold">Add your first project</h2>
        <p className="text-meta text-pretty text-muted">
          A project is a git repository on this machine. The agent works on its tickets in separate worktrees and merges
          approved fixes into the base branch.
        </p>
        <Button variant="primary" icon={<Icon name="plus" />} onClick={onAdd} data-autofocus>
          Add project
        </Button>
      </div>
    </div>
  );
}

export function BoardPage({ socket }: { socket: SocketState }) {
  const nav = useBoardNav();
  const tickets = useTickets();
  const projects = useProjects();
  const selection = useProjectSelection();
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsModal, setProjectsModal] = useState<'list' | 'add' | null>(null);

  const noProjects = projects.data !== undefined && projects.data.length === 0;
  const canCreate = (projects.data?.length ?? 0) > 0;
  const canCreateRef = useRef(canCreate);
  useEffect(() => {
    canCreateRef.current = canCreate;
  });

  const { selectedId } = selection;
  const visibleTickets = useMemo(
    () => (selectedId ? tickets.data?.filter((t) => t.projectId === selectedId) : tickets.data),
    [tickets.data, selectedId],
  );
  // "All projects" mode: cards show a project tag.
  const projectTags = useMemo(
    () => (selectedId ? null : new Map((projects.data ?? []).map((p) => [p.id, p.name]))),
    [projects.data, selectedId],
  );
  const [dragDialog, setDragDialog] = useState<{ kind: TicketDialog; ticketId: string } | null>(null);
  // Keep relative timestamps on cards fresh.
  useTick();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || isModalOpen() || !canCreateRef.current) return;
      e.preventDefault();
      setCreating(true);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const open = (t: TicketDto) => nav.openTicket(t.id);
  // Resolve against the live list so the dialog sees the latest status.
  const dragTicket = dragDialog ? tickets.data?.find((t) => t.id === dragDialog.ticketId) : undefined;

  return (
    <div className="flex h-dvh flex-col">
      <Header
        selectedProjectId={selectedId}
        onSelectProject={selection.select}
        onManageProjects={() => setProjectsModal('list')}
        canCreateTicket={canCreate}
        onNewTicket={() => setCreating(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ProjectNotReadyBanner project={selection.selected} />
      <ReconnectingBanner connected={socket.connected} everConnected={socket.everConnected} />
      <main className="min-h-0 flex-1" aria-label="Ticket board">
        {noProjects ? (
          <NoProjectsState onAdd={() => setProjectsModal('add')} />
        ) : tickets.isError && !tickets.data ? (
          <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="font-display text-[18px] font-semibold">Could not load tickets</p>
            <p className="max-w-md text-meta text-muted">{tickets.error.message}</p>
            <Button onClick={() => void tickets.refetch()} loading={tickets.isFetching}>
              Try again
            </Button>
          </div>
        ) : (
          <ProjectTagsContext value={projectTags}>
            <Board
              tickets={visibleTickets}
              loading={tickets.isLoading}
              onOpen={open}
              onDialog={(kind, t) => setDragDialog({ kind, ticketId: t.id })}
            />
          </ProjectTagsContext>
        )}
      </main>

      <Outlet />

      {creating ? (
        <TicketFormModal defaultProjectId={selectedId} onClose={() => setCreating(false)} onCreated={open} />
      ) : null}
      {projectsModal ? (
        <ProjectsModal
          initialView={projectsModal}
          onClose={() => setProjectsModal(null)}
          onSelectProject={(id) => selection.select(id)}
        />
      ) : null}
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
      <TicketDialogHost kind={dragDialog?.kind ?? null} ticket={dragTicket} onClose={() => setDragDialog(null)} />
    </div>
  );
}
