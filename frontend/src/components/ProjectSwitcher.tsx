import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useProjects } from '../api/queries';
import { useLayer } from '../hooks/useLayer';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';

interface ProjectSwitcherProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
}

/** Red/amber dot for a project whose repo isn't ready (amber = dirty/wrong branch, red = missing). */
export function RepoNotReadyDot({ reason, className }: { reason: string | null; className?: string }) {
  const missing = reason ? /not found|does not exist|missing|no such/i.test(reason) : false;
  return (
    <span
      aria-hidden="true"
      className={clsx('inline-block size-2 shrink-0 rounded-full', missing ? 'bg-red-500' : 'bg-amber-500', className)}
    />
  );
}

export function ProjectSwitcher({ selectedId, onSelect, onManage }: ProjectSwitcherProps) {
  const { data: projects, isLoading } = useProjects();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  useLayer('menu', () => close(), open);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Focus the checked item (or the first) when the menu opens.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const target =
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]');
    target?.focus();
  }, [open]);

  if (isLoading) return <Skeleton className="h-8 w-36" />;

  const selected = projects?.find((p) => p.id === selectedId);
  const label = selected ? selected.name : 'All projects';
  const anyBlocked = selected ? !selected.repoStatus.ready : false;

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = items[(index + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  function choose(id: string | null) {
    onSelect(id);
    close();
  }

  const itemClass =
    'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-meta text-ink outline-none transition-colors duration-100 hover:bg-stone-100 focus-visible:bg-stone-100 focus-visible:outline-none';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Project: ${label}. Change project`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={clsx(
          'inline-flex h-8 max-w-[14rem] items-center gap-2 rounded-control border px-2.5 text-meta font-medium transition-colors',
          open ? 'border-line-strong bg-stone-50' : 'border-line bg-surface hover:border-line-strong hover:bg-stone-50',
        )}
      >
        <Icon name="folder" width={14} height={14} className="shrink-0 text-muted" />
        <span className="truncate">{label}</span>
        {anyBlocked && selected ? <RepoNotReadyDot reason={selected.repoStatus.reason} /> : null}
        <Icon
          name="chevron-down"
          width={14}
          height={14}
          className={clsx('shrink-0 text-muted transition-transform duration-200 ease-out-soft', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Projects"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full left-0 z-30 mt-1.5 w-64 origin-top-left animate-pop-in rounded-card border border-line bg-surface p-1 shadow-pop"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selectedId === null}
            tabIndex={-1}
            onClick={() => choose(null)}
            className={itemClass}
          >
            <span className="w-4 shrink-0 text-accent">{selectedId === null ? <Icon name="check" width={14} height={14} /> : null}</span>
            <span className="truncate">All projects</span>
          </button>
          {projects && projects.length > 0 ? (
            <div className="my-1 max-h-72 overflow-y-auto border-t border-line pt-1">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedId === p.id}
                  tabIndex={-1}
                  onClick={() => choose(p.id)}
                  title={p.repoStatus.ready ? p.repoPath : `${p.repoStatus.reason ?? 'Repository not ready'}`}
                  className={itemClass}
                >
                  <span className="w-4 shrink-0 text-accent">
                    {selectedId === p.id ? <Icon name="check" width={14} height={14} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.repoStatus.ready ? null : (
                    <>
                      <RepoNotReadyDot reason={p.repoStatus.reason} />
                      <span className="sr-only">, not ready: {p.repoStatus.reason ?? 'repository not ready'}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          ) : null}
          <hr className="my-1 border-0 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              close(false);
              onManage();
            }}
            className={itemClass}
          >
            <span className="w-4 shrink-0 text-muted">
              <Icon name="gear" width={14} height={14} />
            </span>
            Manage projects…
          </button>
        </div>
      ) : null}
    </div>
  );
}
