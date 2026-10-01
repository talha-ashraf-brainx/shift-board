/**
 * Tiny pub-sub for "the server said 401": api/client.ts publishes, AuthGate listens and
 * swaps the board for the sign-in screen. Kept separate so client.ts has no React deps.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyUnauthorized(): void {
  for (const l of listeners) l();
}
