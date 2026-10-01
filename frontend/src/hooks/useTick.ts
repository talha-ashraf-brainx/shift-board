import { useEffect, useState } from 'react';

/** Re-renders the caller every `ms` milliseconds (for relative timestamps). */
export function useTick(ms = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const handle = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(handle);
  }, [ms]);
  return tick;
}
