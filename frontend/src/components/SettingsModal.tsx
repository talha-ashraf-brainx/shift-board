import { clsx } from 'clsx';
import { useState } from 'react';
import type { SettingsDto } from '@agent-board/shared';
import { useSettings, useUpdateSettings } from '../api/queries';
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
      description="Appearance, and the global rules that apply to every ticket in every project."
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
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-control border border-line bg-page/60 px-3 py-2.5 text-meta">
        <dt className="text-muted">Worktrees root</dt>
        <dd className="min-w-0 truncate font-mono text-[12px]" title={settings.worktreesRoot}>
          {settings.worktreesRoot}
        </dd>
      </dl>
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
