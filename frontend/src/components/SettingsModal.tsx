import { clsx } from 'clsx';
import { useState } from 'react';
import type { SettingsDto } from '@agent-board/shared';
import { useSendTestNotification, useSettings, useUpdateSettings } from '../api/queries';
import { setDesktopNotifications, useDesktopNotificationSettings } from '../hooks/useNotifications';
import { useAuthStatus, useSignOut } from '../hooks/useAuth';
import { setThemePreference, useTheme, type ThemePreference } from '../hooks/useTheme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Markdown } from './Markdown';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';

const THEMES: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

function AppearancePicker() {
  const { preference } = useTheme();
  return (
    <fieldset className="mb-5">
      <legend className="mb-1.5 text-meta font-medium">Appearance</legend>
      <div className="inline-flex rounded-[9px] border border-line bg-page p-0.5">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={preference === t.value}
            onClick={() => setThemePreference(t.value)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1 text-meta font-medium transition-[background-color,color,box-shadow] duration-200 ease-out-soft',
              preference === t.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            <Icon name={t.icon} width={14} height={14} />
            {t.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Only shown when the server has BOARD_TOKEN set. */
function SignOutRow() {
  const { data } = useAuthStatus();
  const signOut = useSignOut();
  if (!data?.required) return null;
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-control border border-line bg-page/60 px-3 py-2 text-meta">
      <span className="text-muted">Signed in with the board token.</span>
      <Button size="sm" variant="ghost" onClick={() => signOut.mutate()} loading={signOut.isPending}>
        Sign out
      </Button>
    </div>
  );
}

function permissionHint(permission: string, enabled: boolean): string {
  switch (permission) {
    case 'unsupported':
      return 'This browser does not support desktop notifications (they also need https or localhost).';
    case 'denied':
      return 'Blocked by the browser. To unblock, click the icon left of the address bar, set Notifications to Allow, then reload this page.';
    case 'granted':
      return enabled
        ? 'On. You get a notification when a ticket needs an answer, is ready for review or fails while this tab is in the background.'
        : 'Allowed by the browser; currently off for this browser.';
    default:
      return 'Your browser will ask for permission when you turn this on.';
  }
}

function NotificationsSection({ settings }: { settings: SettingsDto }) {
  const desktop = useDesktopNotificationSettings();
  const [requesting, setRequesting] = useState(false);
  const saved = settings.notifyWebhookUrl ?? '';
  const [url, setUrl] = useState(saved);
  const update = useUpdateSettings({ successMessage: (s) => (s.notifyWebhookUrl ? 'Webhook saved' : 'Webhook removed') });
  const test = useSendTestNotification();
  const dirty = url.trim() !== saved;
  const blocked = desktop.permission === 'denied' || desktop.permission === 'unsupported';

  async function toggle() {
    setRequesting(true);
    try {
      await setDesktopNotifications(!desktop.active);
    } finally {
      setRequesting(false);
    }
  }

  function saveWebhook() {
    if (!dirty || update.isPending) return;
    update.mutate({ notifyWebhookUrl: url.trim() || null });
  }

  return (
    <fieldset className="mb-5">
      <legend className="mb-1.5 text-meta font-medium">Notifications</legend>
      <div className="space-y-3 rounded-control border border-line bg-page/60 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="desktop-notifications-label" className="text-meta font-medium">
              Desktop notifications
            </p>
            <p className={clsx('text-[12px]', desktop.permission === 'denied' ? 'text-red-700' : 'text-muted')}>
              {permissionHint(desktop.permission, desktop.enabled)}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={desktop.active}
            aria-labelledby="desktop-notifications-label"
            disabled={requesting || (blocked && !desktop.active)}
            onClick={() => void toggle()}
            className={clsx(
              'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out-soft disabled:opacity-60',
              desktop.active ? 'border-accent bg-accent' : 'border-line-strong bg-stone-200',
            )}
          >
            <span
              aria-hidden="true"
              className={clsx(
                'inline-block size-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-300 ease-spring',
                desktop.active ? 'translate-x-4' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
        <div>
          <label htmlFor="notify-webhook" className="mb-1 block text-meta font-medium">
            Webhook URL <span className="font-normal text-muted">(optional; Slack or Discord incoming webhook, all browsers)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="notify-webhook"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveWebhook();
                }
              }}
              maxLength={2000}
              placeholder="https://hooks.slack.com/services/…"
              spellCheck={false}
              autoComplete="off"
              className="field min-w-0 flex-1 font-mono text-[12px]"
            />
            <Button size="md" onClick={saveWebhook} loading={update.isPending} disabled={!dirty}>
              {url.trim() || !saved ? 'Save' : 'Remove'}
            </Button>
            <Button
              size="md"
              variant="ghost"
              onClick={() => test.mutate()}
              loading={test.isPending}
              disabled={!saved || dirty}
              title={!saved ? 'Save a webhook URL first' : dirty ? 'Save the URL first' : undefined}
            >
              Send test notification
            </Button>
          </div>
          <p className="mt-1 text-[12px] text-muted">
            The server posts here when a ticket needs your answer, is ready for review or fails.
          </p>
        </div>
      </div>
    </fieldset>
  );
}

function SettingsForm({ settings, onClose }: { settings: SettingsDto; onClose: () => void }) {
  const [rules, setRules] = useState(settings.globalRules);
  const [preview, setPreview] = useState(false);
  const update = useUpdateSettings({ successMessage: () => 'Global rules saved' });
  const dirty = rules !== settings.globalRules;

  function save() {
    if (!dirty || update.isPending) return;
    update.mutate({ globalRules: rules }, { onSuccess: onClose });
  }

  return (
    <Modal
      title="Settings"
      description="Appearance, notifications, and the global rules that apply to every ticket in every project."
      onClose={onClose}
      size="lg"
      busy={update.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={update.isPending}>
            Close
          </Button>
          <Button variant="primary" onClick={save} loading={update.isPending} disabled={!dirty}>
            Save rules
          </Button>
        </>
      }
    >
      <AppearancePicker />
      <NotificationsSection settings={settings} />
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-control border border-line bg-page/60 px-3 py-2.5 text-meta">
        <dt className="text-muted">Worktrees root</dt>
        <dd className="min-w-0 truncate font-mono text-[12px]" title={settings.worktreesRoot}>
          {settings.worktreesRoot}
        </dd>
      </dl>
      <SignOutRow />
      <div className="mb-1 flex items-end justify-between">
        <label htmlFor="global-rules" className="text-meta font-medium">
          Global rules <span className="font-normal text-muted">(all projects; each project can add its own)</span>
        </label>
        <button type="button" onClick={() => setPreview((p) => !p)} className="text-[12px] font-medium text-accent hover:underline" aria-pressed={preview}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div className="min-h-40 rounded-control border border-line bg-page/50 px-3 py-2">
          {rules.trim() ? <Markdown>{rules}</Markdown> : <p className="text-meta text-muted">No global rules.</p>}
        </div>
      ) : (
        <textarea
          id="global-rules"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          rows={12}
          placeholder={'- Run the test suite before submitting a fix\n- Keep changes minimal'}
          data-autofocus
          className="field resize-y font-mono text-[13px] leading-relaxed"
        />
      )}
    </Modal>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, isError, error } = useSettings();
  if (data) return <SettingsForm settings={data} onClose={onClose} />;
  return (
    <Modal title="Settings" onClose={onClose}>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : isError ? (
        <p className="text-meta text-red-700">Could not load settings: {error.message}</p>
      ) : null}
    </Modal>
  );
}
