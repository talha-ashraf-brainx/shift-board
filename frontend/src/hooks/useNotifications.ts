import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { TicketStatus, ticketTitle, type TicketDto } from '@agent-board/shared';
import { useTickets } from '../api/queries';

/** Statuses where the human is needed, with the notification title for each. */
const ATTENTION: Partial<Record<TicketStatus, (n: number) => string>> = {
  [TicketStatus.NeedsContext]: (n) => `#${n} needs your answer`,
  [TicketStatus.Review]: (n) => `#${n} is ready for review`,
  [TicketStatus.Failed]: (n) => `#${n} failed`,
};

const APP_TITLE = 'Shiftboard';
const STORAGE_KEY = 'shiftboard-desktop-notifications';
const BODY_MAX = 140;

export type NotificationPermissionState = NotificationPermission | 'unsupported';

// ---------- Per-browser preference + permission (a tiny external store) ----------

const listeners = new Set<() => void>();
const supported = typeof window !== 'undefined' && 'Notification' in window;

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readPermission(): NotificationPermissionState {
  return supported ? Notification.permission : 'unsupported';
}

let state = { enabled: readPreference(), permission: readPermission() };

function refresh() {
  const next = { enabled: readPreference(), permission: readPermission() };
  if (next.enabled === state.enabled && next.permission === state.permission) return;
  state = next;
  for (const l of listeners) l();
}

if (supported) {
  // The person may change the site permission in the browser UI.
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) refresh();
  });
  void navigator.permissions
    ?.query({ name: 'notifications' })
    .then((status) => status.addEventListener('change', refresh))
    .catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function writePreference(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
  state = { ...state, enabled };
  for (const l of listeners) l();
  refresh();
}

/** Turns desktop notifications on (asking for permission if needed) or off for this browser. */
export async function setDesktopNotifications(enabled: boolean): Promise<NotificationPermissionState> {
  if (!enabled || !supported) {
    writePreference(false);
    return readPermission();
  }
  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }
  writePreference(permission === 'granted');
  return permission;
}

/** The stored preference and the browser's permission. `active` = notifications will actually show. */
export function useDesktopNotificationSettings() {
  const s = useSyncExternalStore(subscribe, () => state);
  return { ...s, active: s.enabled && s.permission === 'granted' };
}

// ---------- The watcher ----------

function needsHuman(status: TicketStatus): boolean {
  return ATTENTION[status] !== undefined;
}

function show(ticket: TicketDto, onClick: () => void) {
  const title = ATTENTION[ticket.status]?.(ticket.number);
  if (!title) return;
  const text = ticketTitle(ticket);
  const body = text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1).trimEnd()}…` : text;
  try {
    const n = new Notification(title, { body, tag: `ticket-${ticket.id}` });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    // Some browsers (e.g. Android Chrome) only allow notifications from a service worker.
  }
}

/**
 * Mount once at the app root. Keeps the tab title badge ("(3) Shiftboard" = tickets waiting on
 * the human) and, when the tab is hidden or unfocused, shows a desktop notification for each
 * ticket that moves into needs_context, review or failed. The first load only sets the baseline.
 */
export function useNotifications(): void {
  const { data: tickets } = useTickets();
  const navigate = useNavigate();
  const { active } = useDesktopNotificationSettings();
  // Last statuses seen; re-running with the same list (e.g. navigate changed) finds no transitions.
  const seen = useRef<Map<string, TicketStatus> | null>(null);

  useEffect(() => {
    if (!tickets) return;
    const previous = seen.current;
    seen.current = new Map(tickets.map((t) => [t.id, t.status]));
    if (!previous) return; // initial load: baseline only

    const away = document.hidden || !document.hasFocus();
    if (!active || !away) return;
    for (const t of tickets) {
      const before = previous.get(t.id);
      if (before === undefined || before === t.status || !needsHuman(t.status)) continue;
      show(t, () => navigate({ pathname: `/tickets/${t.id}`, search: window.location.search }));
    }
  }, [tickets, active, navigate]);

  const waiting = tickets?.filter((t) => needsHuman(t.status)).length ?? 0;
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) ${APP_TITLE}` : APP_TITLE;
  }, [waiting]);
}
