import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A tiny stack of open overlays (drawer, modals). Esc closes only the topmost
 * layer, and the `N` shortcut can check whether a modal is open.
 */
export type LayerKind = 'modal' | 'drawer' | 'menu';

interface Layer {
  id: number;
  kind: LayerKind;
  close: () => void;
}

let stack: Layer[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.close();
}

let keyListenerInstalled = false;
function ensureKeyListener() {
  if (keyListenerInstalled) return;
  keyListenerInstalled = true;
  document.addEventListener('keydown', onKeyDown);
}

export function isModalOpen(): boolean {
  return stack.some((l) => l.kind === 'modal');
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, isModalOpen);
}

/** Registers an overlay while `active`; `onClose` runs when Esc targets it. */
export function useLayer(kind: LayerKind, onClose: () => void, active = true): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    ensureKeyListener();
    const layer: Layer = { id: nextId++, kind, close: () => closeRef.current() };
    stack = [...stack, layer];
    emit();
    return () => {
      stack = stack.filter((l) => l.id !== layer.id);
      emit();
    };
  }, [kind, active]);
}
