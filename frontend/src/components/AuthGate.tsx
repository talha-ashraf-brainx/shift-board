import type { AuthStatusDto } from '@agent-board/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { onUnauthorized } from '../api/auth';
import { api, ApiError, errorMessage } from '../api/client';
import { authStatusKey, setSignedOut, useAuthStatus } from '../hooks/useAuth';
import { Button } from './Button';

function SignInScreen() {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const errorId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token || pending) return;
    setPending(true);
    setError(null);
    try {
      await api.login(token);
      qc.setQueryData<AuthStatusDto>(authStatusKey, { required: true, authenticated: true });
      // The board remounts (with a fresh socket); refetch anything that failed with 401.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== authStatusKey[0] });
    } catch (err) {
      setError(err instanceof ApiError && err.statusCode === 401 ? 'That token is not right. Try again.' : errorMessage(err));
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-page p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm animate-pop-in rounded-card border border-line bg-surface p-6 shadow-card"
        aria-labelledby={`${inputId}-title`}
      >
        <h1 id={`${inputId}-title`} className="font-display text-[22px] leading-tight font-semibold">
          Shiftboard
        </h1>
        <p className="mt-1.5 text-meta text-muted">
          This board is protected. Sign in with the <code className="font-mono text-[12px] text-ink">BOARD_TOKEN</code> from
          the server&apos;s <code className="font-mono text-[12px] text-ink">.env</code>.
        </p>
        <label htmlFor={inputId} className="mt-5 mb-1 block text-meta font-medium">
          Board token
        </label>
        <input
          id={inputId}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="current-password"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the only control on the page
          autoFocus
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="field font-mono"
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-meta text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={pending} disabled={!token} className="mt-4 w-full">
          Sign in
        </Button>
      </form>
    </main>
  );
}

/**
 * Shows the sign-in screen instead of `children` while the server requires BOARD_TOKEN and this
 * browser doesn't have it, including whenever any later API call answers 401. If the status call
 * itself fails (API down), the board renders as usual and shows its own offline state.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isPending } = useAuthStatus();

  useEffect(() => onUnauthorized(() => setSignedOut(qc)), [qc]);

  if (isPending) return null;
  if (data?.required && !data.authenticated) return <SignInScreen />;
  return children;
}
