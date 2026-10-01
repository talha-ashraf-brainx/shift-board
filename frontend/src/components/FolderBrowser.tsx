import { clsx } from 'clsx';
import { useState, type FormEvent } from 'react';
import { useBrowse } from '../api/queries';
import { Button } from './Button';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

interface FolderBrowserProps {
  /** Folder to open first; null = home. */
  initialPath?: string | null;
  onSelect: (path: string) => void;
  onBack: () => void;
  onClose: () => void;
}

export function GitBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-1.5 text-[11px] leading-[18px] font-medium text-teal-800 ring-1 ring-teal-200 ring-inset">
      <Icon name="branch" width={11} height={11} />
      git
    </span>
  );
}

function crumbs(path: string): { label: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  const out = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    out.push({ label: part, path: acc });
  }
  return out;
}

/** Step 1 of "Add project": pick a git repository folder on the server's machine. */
export function FolderBrowser({ initialPath = null, onSelect, onBack, onClose }: FolderBrowserProps) {
  const [path, setPath] = useState<string | null>(initialPath);
  const [lastGood, setLastGood] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // null = mirror the current folder; a string = the user is typing a path.
  const [draft, setDraft] = useState<string | null>(null);
  const browse = useBrowse(path, showHidden);
  const data = browse.isError ? undefined : browse.data;

  function go(next: string | null) {
    if (data) setLastGood(data.path);
    setPath(next);
    setDraft(null);
  }

  function onGo(e: FormEvent) {
    e.preventDefault();
    const typed = (draft ?? '').trim();
    if (!typed) return;
    go(typed.startsWith('~') && data ? data.home + typed.slice(1) : typed);
  }

  const canSelect = Boolean(data?.isGitRepo) && !browse.isFetching;

  return (
    <Modal
      title="Add project: choose a repository"
      description="Browse to the root folder of a git repository on this machine."
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button onClick={onBack} className="mr-auto">
            Back
          </Button>
          <span className="truncate text-[12px] text-muted">
            {data ? (data.isGitRepo ? 'This folder is a git repository.' : 'Pick a folder marked git.') : null}
          </span>
          <Button variant="primary" disabled={!canSelect} onClick={() => data && onSelect(data.path)}>
            Select this folder
          </Button>
        </>
      }
    >
      <form onSubmit={onGo} className="mb-3 flex gap-2">
        <label htmlFor="browse-path" className="sr-only">
          Folder path
        </label>
        <input
          id="browse-path"
          value={draft ?? data?.path ?? path ?? ''}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="/Users/me/code/my-repo"
          spellCheck={false}
          autoComplete="off"
          className="field font-mono text-[13px]"
        />
        <Button type="submit" disabled={!draft?.trim()}>
          Go
        </Button>
      </form>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={<Icon name="arrow-up" width={13} height={13} />}
          disabled={!data?.parent}
          onClick={() => data?.parent && go(data.parent)}
          aria-label="Up to the parent folder"
        >
          Up
        </Button>
        <Button size="sm" variant="ghost" disabled={!data || data.path === data.home} onClick={() => data && go(data.home)}>
          Home
        </Button>
        <nav aria-label="Current folder" className="flex min-w-0 flex-1 flex-wrap items-center text-meta">
          {data
            ? crumbs(data.path).map((c, i, all) => (
                <span key={c.path} className="flex min-w-0 items-center">
                  {i > 1 ? <span className="px-0.5 text-muted">/</span> : null}
                  {i === all.length - 1 ? (
                    <span aria-current="page" className="truncate font-medium text-ink">
                      {c.label}
                    </span>
                  ) : (
                    <button type="button" onClick={() => go(c.path)} className="truncate text-accent hover:underline">
                      {c.label}
                    </button>
                  )}
                </span>
              ))
            : null}
          {data?.isGitRepo ? <span className="ml-2"><GitBadge /></span> : null}
        </nav>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="size-3.5 accent-accent"
          />
          Show hidden
        </label>
      </div>

      <div className="relative h-80 overflow-y-auto rounded-control border border-line bg-surface">
        {browse.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-3 text-meta">
            <p className="text-red-700">{browse.error.message}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => go(lastGood)}>
                Go back
              </Button>
              <Button size="sm" variant="ghost" onClick={() => go(null)}>
                Home folder
              </Button>
            </div>
          </div>
        ) : !data ? (
          <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading folders">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : data.entries.length === 0 ? (
          <p className="p-3 text-meta text-muted">No subfolders here.</p>
        ) : (
          <ul aria-label="Subfolders" className={clsx('divide-y divide-line', browse.isFetching && 'opacity-60')}>
            {data.entries.map((entry) => (
              <li key={entry.path} className="group flex items-center gap-2 pr-2 hover:bg-stone-50">
                <button
                  type="button"
                  onClick={() => go(entry.path)}
                  title={entry.path}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-meta"
                >
                  <Icon name="folder" width={14} height={14} className="shrink-0 text-muted" />
                  <span className="truncate">{entry.name}</span>
                  {entry.isGitRepo ? <GitBadge /> : null}
                </button>
                {entry.isGitRepo ? (
                  <Button size="sm" variant="ghost" onClick={() => onSelect(entry.path)} aria-label={`Select ${entry.name}`}>
                    Select
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {browse.isFetching && data ? (
          <span className="absolute top-2 right-2 text-muted">
            <Spinner className="size-3.5" />
          </span>
        ) : null}
      </div>
      {data && data.entries.length >= 500 ? (
        <p className="mt-1 text-[12px] text-muted">Showing the first 500 folders. Paste a path to go deeper.</p>
      ) : null}
    </Modal>
  );
}
