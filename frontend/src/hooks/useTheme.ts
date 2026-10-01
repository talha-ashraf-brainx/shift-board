import { useSyncExternalStore } from 'react';

/** What the person chose; "system" follows the OS setting. */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

// Same key and resolution as the pre-paint script in index.html.
const STORAGE_KEY = 'shiftboard-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let preference = readPreference();

function resolve(p: ThemePreference): ResolvedTheme {
  return p === 'system' ? (media.matches ? 'dark' : 'light') : p;
}

function apply() {
  document.documentElement.dataset.theme = resolve(preference);
  for (const l of listeners) l();
}

media.addEventListener('change', () => {
  if (preference === 'system') apply();
});

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode or blocked storage: the choice lasts for this tab only.
  }
  // Crossfade where the browser supports it; the swap is instant otherwise.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && document.startViewTransition) document.startViewTransition(apply);
  else apply();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const snapshot = () => `${preference}:${resolve(preference)}`;

export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme } {
  const [p, r] = useSyncExternalStore(subscribe, snapshot).split(':') as [ThemePreference, ResolvedTheme];
  return { preference: p, resolved: r };
}
