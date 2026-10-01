import type { AuthStatusDto } from '@agent-board/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '../api/client';

export const authStatusKey = ['auth-status'] as const;

/** Whether the server wants BOARD_TOKEN and whether this browser has it (as the cookie). */
export function useAuthStatus() {
  return useQuery({ queryKey: authStatusKey, queryFn: api.authStatus, staleTime: Infinity, refetchOnWindowFocus: false });
}

export function setSignedOut(qc: QueryClient): void {
  qc.setQueryData<AuthStatusDto>(authStatusKey, { required: true, authenticated: false });
}

/** Clears the cookie; AuthGate then shows the sign-in screen (and unmounts the board and its socket). */
export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      setSignedOut(qc);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== authStatusKey[0] });
    },
    onError: (err) => toast.error(`Could not sign out: ${errorMessage(err)}`),
  });
}
