import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { ProjectDto } from '@agent-board/shared';
import { useProjects } from '../api/queries';

const STORAGE_KEY = 'agent-board.project';
const PARAM = 'project';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeStored(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode): the URL still holds the selection.
  }
}

export interface ProjectSelection {
  /** Selected project id from `?project=`; null = All projects. */
  selectedId: string | null;
  /** The selected project, once the projects list has loaded. */
  selected: ProjectDto | undefined;
  select: (id: string | null, options?: { replace?: boolean }) => void;
}

/**
 * The project filter lives in the URL query (`?project=<id>`, absent = All) so it
 * survives the /tickets/:id drawer route. The last choice is remembered in localStorage
 * and restored when the app opens without a `project` param.
 */
export function useProjectSelection(): ProjectSelection {
  const [params, setParams] = useSearchParams();
  const projects = useProjects();
  const selectedId = params.get(PARAM) || null;

  const select = useCallback(
    (id: string | null, options?: { replace?: boolean }) => {
      writeStored(id);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(PARAM, id);
          else next.delete(PARAM);
          return next;
        },
        { replace: options?.replace ?? false },
      );
    },
    [setParams],
  );

  // Restore the remembered choice once, on first load without a `project` param.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (selectedId) {
      writeStored(selectedId);
      return;
    }
    const stored = readStored();
    if (stored) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(PARAM, stored);
          return next;
        },
        { replace: true },
      );
    }
  }, [selectedId, setParams]);

  // Fall back to All when the selected project no longer exists (deleted here, elsewhere, or a stale link).
  const list = projects.data;
  const missing = Boolean(selectedId && list && !projects.isFetching && !list.some((p) => p.id === selectedId));
  useEffect(() => {
    if (missing) select(null, { replace: true });
  }, [missing, select]);

  return { selectedId, selected: list?.find((p) => p.id === selectedId), select };
}

/** Navigation that keeps the current query string (the project filter) intact. */
export function useBoardNav() {
  const navigate = useNavigate();
  const { search } = useLocation();
  return {
    openTicket: (id: string) => navigate({ pathname: `/tickets/${id}`, search }),
    toBoard: () => navigate({ pathname: '/', search }),
  };
}

/** Look a project up in the ['projects'] cache. */
export function useProject(id: string | null | undefined): ProjectDto | undefined {
  const { data } = useProjects();
  return id ? data?.find((p) => p.id === id) : undefined;
}
