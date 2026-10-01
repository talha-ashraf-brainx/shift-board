import { useEffect, useState } from 'react';
import type { ProjectDto } from '@agent-board/shared';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/** Shown when the selected project's main checkout isn't ready (dirty, wrong branch, missing). */
export function ProjectNotReadyBanner({ project }: { project: ProjectDto | undefined }) {
  if (!project || project.repoStatus.ready) return null;
  return (
    <div role="alert" className="flex animate-fade-in items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-meta text-amber-900">
      <Icon name="alert" className="mt-px shrink-0 text-amber-600" />
      <p>
        <span className="font-semibold">{project.name}: repository not ready. </span>
        <span className="break-words">{project.repoStatus.reason ?? 'The main checkout is not clean or not on its base branch.'}</span>{' '}
        <span className="text-amber-800">
          The worker skips this project until it&rsquo;s clean and on{' '}
          <code className="font-mono text-[12px]">{project.baseBranch}</code>.
        </span>
      </p>
    </div>
  );
}

export function ReconnectingBanner({ connected, everConnected }: { connected: boolean; everConnected: boolean }) {
  // Before the first connection, give the socket a second before complaining.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGraceOver(true), 1000);
    return () => window.clearTimeout(t);
  }, []);

  if (connected || (!everConnected && !graceOver)) return null;
  return (
    <output className="flex animate-fade-in items-center gap-2 border-b border-line bg-stone-100 px-5 py-1.5 text-meta text-muted">
      <Spinner className="size-3.5" />
      {everConnected ? 'Reconnecting… live updates are paused.' : 'Connecting to live updates…'}
    </output>
  );
}
