import { clsx } from 'clsx';
import { useState, type FormEvent } from 'react';
import type { ProjectDto, WorktreeDto } from '@agent-board/shared';
import { useActivateWorktree, useAddWorktree, useRemoveWorktree } from '../api/queries';
import { useBoardNav } from '../hooks/useProjectSelection';
import { STATUS_LABEL } from '../lib/meta';
import { Button } from './Button';
import { Icon } from './Icon';

/** A project's shared worktrees: which one new tickets run in, who is using each, add and remove. */
export function WorktreesPanel({ project }: { project: ProjectDto }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = useAddWorktree();

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || add.isPending) return;
    add.mutate(
      { projectId: project.id, name: trimmed },
      {
        onSuccess: () => {
          setName('');
          setAdding(false);
        },
      },
    );
  }

  return (
    <section aria-label={`Worktrees of ${project.name}`} className="mt-2.5 rounded-control border border-line bg-page/60">
      <ul className="divide-y divide-line">
        {project.worktrees.map((w) => (
          <WorktreeRow key={w.id} project={project} worktree={w} canRemove={project.worktrees.length > 1} />
        ))}
      </ul>
      <div className="border-t border-line px-2.5 py-2">
        {adding ? (
          <form onSubmit={submit} className="flex items-center gap-2">
            <label htmlFor={`wt-name-${project.id}`} className="sr-only">
              Worktree name
            </label>
            <input
              id={`wt-name-${project.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setAdding(false);
                }
              }}
              maxLength={40}
              placeholder="e.g. second"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field was just opened by the user
              autoFocus
              className="field h-7 py-0 text-meta"
            />
            <Button size="sm" type="submit" variant="primary" loading={add.isPending} disabled={!name.trim()}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="ghost" icon={<Icon name="plus" width={13} height={13} />} onClick={() => setAdding(true)}>
            Add worktree
          </Button>
        )}
      </div>
    </section>
  );
}

function WorktreeRow({ project, worktree: w, canRemove }: { project: ProjectDto; worktree: WorktreeDto; canRemove: boolean }) {
  const activate = useActivateWorktree();
  const remove = useRemoveWorktree();
  const nav = useBoardNav();
  const removeBlocked = w.active ? 'Make another worktree active first' : w.heldBy ? `In use by #${w.heldBy.number}` : null;

  return (
    <li className="flex items-center gap-2 px-2.5 py-2 text-meta">
      <Icon name="branch" width={13} height={13} className={clsx('shrink-0', w.active ? 'text-accent' : 'text-muted')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{w.name}</span>
          {w.active ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[11px] leading-[18px] font-medium text-accent">
              New tickets run here
            </span>
          ) : null}
        </div>
        <p className="truncate font-mono text-[11px] text-muted" title={w.path}>
          {w.path}
        </p>
      </div>
      {w.heldBy ? (
        <button
          type="button"
          onClick={() => nav.openTicket(w.heldBy!.ticketId)}
          className="shrink-0 text-[12px] text-muted hover:text-ink hover:underline"
          title="Other tickets wait until this one is approved, rejected, answered or cancelled"
        >
          Busy: #{w.heldBy.number} ({STATUS_LABEL[w.heldBy.status].toLowerCase()})
        </button>
      ) : (
        <span className="shrink-0 text-[12px] text-muted">Free</span>
      )}
      {w.active ? null : (
        <Button
          size="sm"
          onClick={() => activate.mutate({ projectId: project.id, worktreeId: w.id, name: w.name })}
          loading={activate.isPending}
        >
          Use for new tickets
        </Button>
      )}
      {canRemove ? (
        <button
          type="button"
          onClick={() => remove.mutate({ projectId: project.id, worktreeId: w.id, name: w.name })}
          disabled={Boolean(removeBlocked) || remove.isPending}
          aria-label={`Remove worktree ${w.name}`}
          title={removeBlocked ?? `Remove ${w.name}`}
          className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
        >
          <Icon name="trash" width={13} height={13} />
        </button>
      ) : null}
    </li>
  );
}
