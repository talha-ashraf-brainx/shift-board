import { clsx } from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx('skeleton rounded-control', className)} />;
}

export function CardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
      <Skeleton className="mt-2.5 h-3.5 w-11/12" />
      <Skeleton className="mt-1.5 h-3.5 w-2/3" />
      <Skeleton className="mt-3 h-3 w-16" />
    </div>
  );
}
