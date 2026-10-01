import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import type { DiffDto } from '@agent-board/shared';
import { parseUnifiedDiff, type ParsedFile } from '../lib/diff';
import { Icon } from './Icon';

interface FileEntry {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  parsed: ParsedFile | undefined;
}

function fileAnchor(index: number) {
  return `diff-file-${index}`;
}

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 font-mono text-[12px] tabular-nums">
      <span className="text-green-700">+{additions}</span> <span className="text-red-700">−{deletions}</span>
    </span>
  );
}

function FileDiff({ entry, index }: { entry: FileEntry; index: number }) {
  const [open, setOpen] = useState(true);
  const parsed = entry.parsed;
  const bodyId = `${fileAnchor(index)}-body`;
  const label =
    parsed?.status === 'renamed' && parsed.oldPath ? `${parsed.oldPath} → ${entry.path}` : entry.path;

  return (
    <section id={fileAnchor(index)} className="overflow-hidden rounded-card border border-line bg-surface">
      <h3 className="sticky top-0 z-[1]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-2 border-b border-line bg-page px-3 py-1.5 text-left hover:bg-stone-100"
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium" title={label}>
            {label}
          </span>
          {parsed && parsed.status !== 'modified' && parsed.status !== 'renamed' ? (
            <span
              className={clsx(
                'rounded px-1 text-[11px] font-medium',
                parsed.status === 'added' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700',
              )}
            >
              {parsed.status}
            </span>
          ) : null}
          <Counts additions={entry.additions} deletions={entry.deletions} />
        </button>
      </h3>
      {open ? (
        <div id={bodyId} className="overflow-x-auto">
          {entry.binary || parsed?.binary ? (
            <p className="px-3 py-2 text-meta text-muted">Binary file; no preview.</p>
          ) : !parsed || parsed.hunks.length === 0 ? (
            <p className="px-3 py-2 text-meta text-muted">No textual changes (mode change or empty file).</p>
          ) : (
            <table className="w-full border-collapse font-mono text-[12px] leading-5">
              <tbody>
                {parsed.hunks.map((hunk, hi) => (
                  // oxlint-disable-next-line react/no-array-index-key -- hunks have no stable id
                  <HunkRows key={hi} header={hunk.header} lines={hunk.lines} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}

function HunkRows({ header, lines }: { header: string; lines: ParsedFile['hunks'][number]['lines'] }) {
  return (
    <>
      <tr className="bg-indigo-50/60 text-indigo-800">
        <td colSpan={3} className="px-3 py-0.5 whitespace-pre select-none">
          {header}
        </td>
      </tr>
      {lines.map((line, i) => (
        <tr
          // oxlint-disable-next-line react/no-array-index-key -- diff lines are positional
          key={i}
          className={clsx(
            line.kind === 'add' && 'bg-green-50',
            line.kind === 'del' && 'bg-red-50',
            line.kind === 'meta' && 'text-muted italic',
          )}
        >
          <td
            className={clsx(
              'w-10 border-r border-line px-2 text-right text-stone-400 select-none',
              line.kind === 'del' && 'bg-red-100/60',
            )}
          >
            {line.oldNo ?? ''}
          </td>
          <td
            className={clsx(
              'w-10 border-r border-line px-2 text-right text-stone-400 select-none',
              line.kind === 'add' && 'bg-green-100/60',
            )}
          >
            {line.newNo ?? ''}
          </td>
          <td className="px-3 whitespace-pre">
            <span
              aria-hidden="true"
              className={clsx(
                'inline-block w-3 select-none',
                line.kind === 'add' ? 'text-green-700' : line.kind === 'del' ? 'text-red-700' : 'text-stone-300',
              )}
            >
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
            </span>
            <span className="sr-only">{line.kind === 'add' ? 'added: ' : line.kind === 'del' ? 'removed: ' : ''}</span>
            {line.text}
          </td>
        </tr>
      ))}
    </>
  );
}

export function DiffViewer({ diff }: { diff: DiffDto }) {
  const entries = useMemo<FileEntry[]>(() => {
    const parsed = parseUnifiedDiff(diff.patch ?? '');
    const byPath = new Map(parsed.map((p) => [p.path, p]));
    const seen = new Set<string>();
    const out: FileEntry[] = diff.files.map((f) => {
      seen.add(f.path);
      const p = byPath.get(f.path);
      return { path: f.path, additions: f.additions, deletions: f.deletions, binary: f.binary, parsed: p };
    });
    for (const p of parsed) {
      if (!seen.has(p.path)) out.push({ path: p.path, additions: p.additions, deletions: p.deletions, binary: p.binary, parsed: p });
    }
    return out;
  }, [diff]);

  const totals = entries.reduce(
    (acc, e) => ({ additions: acc.additions + e.additions, deletions: acc.deletions + e.deletions }),
    { additions: 0, deletions: 0 },
  );

  if (entries.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-meta text-muted">
        No changes between <code className="font-mono">{diff.baseBranch}</code> and{' '}
        <code className="font-mono">{diff.branchName}</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-card border border-line bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-meta">
          <span className="min-w-0 truncate">
            <span className="font-medium">
              {entries.length} file{entries.length === 1 ? '' : 's'} changed
            </span>{' '}
            <span className="text-muted">
              <code className="font-mono text-[12px]">{diff.branchName}</code> into{' '}
              <code className="font-mono text-[12px]">{diff.baseBranch}</code>
            </span>
          </span>
          <Counts additions={totals.additions} deletions={totals.deletions} />
        </div>
        <ul className="max-h-48 overflow-y-auto py-1" aria-label="Changed files">
          {entries.map((e, i) => (
            <li key={e.path}>
              <a
                href={`#${fileAnchor(i)}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  document.getElementById(fileAnchor(i))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="flex items-center gap-2 px-3 py-0.5 hover:bg-page"
              >
                <Icon name="file" width={13} height={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{e.path}</span>
                {e.binary ? <span className="text-[11px] text-muted">binary</span> : null}
                <Counts additions={e.additions} deletions={e.deletions} />
              </a>
            </li>
          ))}
        </ul>
      </div>
      {entries.map((e, i) => (
        <FileDiff key={e.path} entry={e} index={i} />
      ))}
    </div>
  );
}
