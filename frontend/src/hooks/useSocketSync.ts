import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SocketEvents } from '@agent-board/shared';
import { createBoardSocket } from '../api/socket';
import { appendEvent, applyProject, applyTicket, queryKeys, removeProject } from '../api/cache';

export interface SocketState {
  connected: boolean;
  /** True once the socket has connected at least once. */
  everConnected: boolean;
}

/**
 * Opens the app's single Socket.IO connection and keeps the TanStack Query
 * cache in sync with server pushes. Mount it once, at the app root.
 */
export function useSocketSync(): SocketState {
  const qc = useQueryClient();
  const [state, setState] = useState<SocketState>({ connected: false, everConnected: false });

  useEffect(() => {
    const socket = createBoardSocket();
    let hasConnected = false;

    socket.on('connect', () => {
      if (hasConnected) {
        // We may have missed pushes while offline: refetch everything.
        void qc.invalidateQueries();
      }
      hasConnected = true;
      setState({ connected: true, everConnected: true });
    });

    socket.on('disconnect', () => {
      setState((s) => ({ ...s, connected: false }));
    });

    socket.on(SocketEvents.TicketCreated, (ticket) => applyTicket(qc, ticket));
    socket.on(SocketEvents.TicketUpdated, (ticket) => applyTicket(qc, ticket));
    socket.on(SocketEvents.TicketEvent, ({ ticketId, event }) => appendEvent(qc, ticketId, event));
    socket.on(SocketEvents.AgentStatus, (status) => {
      qc.setQueryData(queryKeys.agentStatus, status);
      // workerEnabled may have changed (e.g. toggled from another tab).
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
    });

    socket.on(SocketEvents.ProjectCreated, (project) => applyProject(qc, project));
    socket.on(SocketEvents.ProjectUpdated, (project) => applyProject(qc, project));
    socket.on(SocketEvents.ProjectDeleted, ({ id }) => removeProject(qc, id));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [qc]);

  return state;
}
