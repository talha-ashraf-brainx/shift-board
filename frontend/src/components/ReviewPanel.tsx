import { clsx } from 'clsx';
import { TicketEventType, type AgentSummaryMeta, type CommandLogMeta, type TicketWithEventsDto } from '@agent-board/shared';
import { useApproveTicket, useDiff } from '../api/queries';
import { Button } from './Button';
import { DiffViewer } from './DiffViewer';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { Skeleton } from './Skeleton';

export function latestSummary(ticket: TicketWithEventsDto): { summary: string; testing: string } {
  for (let i = ticket.events.length - 1; i >= 0; i--) {
    const e = ticket.events[i];
    if (e?.type === TicketEventType.AgentSummary) {
      const m = (e.meta ?? {}) as Partial<AgentSummaryMeta>;
      return { summary: m.summary || e.body || ticket.agentSummary || '', testing: m.testing ?? '' };
    }
  }
  return { summary: ticket.agentSummary ?? '', testing: '' };
}

/** Loads and renders the ticket's diff (review: live; done: snapshot). */
/** The latest run of the project's check command, if the project has one. */
function latestChecks(ticket: TicketWithEventsDto): CommandLogMeta | null {
  for (let i = ticket.events.length - 1; i >= 0; i--) {
    const meta = ticket.events[i]!.meta as Partial<CommandLogMeta> | null;
    if (ticket.events[i]!.type === TicketEventType.AgentLog && meta?.kind === 'checks') return meta as CommandLogMeta;
  }
  return null;
}

function ChecksResult({ ticket }: { ticket: TicketWithEventsDto }) {
  const checks = latestChecks(ticket);
  if (!checks) return null;
  return (
    <div>
      <h4 className="mb-1 text-[12px] font-medium text-muted">Checks</h4>
      <p
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium',
          checks.passed ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700',
        )}
      >
        <Icon name={checks.passed ? 'check' : 'x-circle'} width={13} height={13} />
        {checks.passed ? 'Passed' : checks.timedOut ? 'Timed out' : `Failing (exit ${checks.exitCode ?? '?'})`}
        <code className="font-mono font-normal opacity-80">{checks.command}</code>
      </p>
      {!checks.passed && checks.output ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[12px] text-muted hover:text-ink">Show output</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-control border border-line bg-page px-2.5 py-2 font-mono text-[12px] whitespace-pre-wrap">
            {checks.output}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function TicketDiff({ ticketId }: { ticketId: string }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useDiff(ticketId, true);
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading diff">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-meta text-red-800">
        <span>Could not load the diff: {error.message}</span>
        <Button size="sm" onClick={() => void refetch()} loading={isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  return data ? <DiffViewer diff={data} /> : null;
}

interface ReviewPanelProps {
  ticket: TicketWithEventsDto;
  onReject: () => void;
}

/** Summary, testing notes and approve / reject for a ticket in review. The diff renders in the drawer's Diff tab. */
export function ReviewPanel({ ticket, onReject }: ReviewPanelProps) {
  const approve = useApproveTicket();
  const { summary, testing } = latestSummary(ticket);

  return (
    <section aria-labelledby="review-title">
      <div className="animate-rise-in rounded-card border border-teal-200 bg-teal-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="review-title" className="flex items-center gap-1.5 text-meta font-semibold text-teal-900">
            <Icon name="sparkle" width={14} height={14} />
            Ready for review
          </h3>
          <div className="flex gap-2">
            <Button onClick={onReject} disabled={approve.isPending}>
              Reject
            </Button>
            <Button
              variant="primary"
              loading={approve.isPending}
              onClick={() => approve.mutate(ticket.id)}
              icon={<Icon name="merge" width={14} height={14} />}
            >
              Approve & merge
            </Button>
          </div>
        </div>
        <div className="mt-2 grid gap-3">
          <div>
            <h4 className="mb-0.5 text-[12px] font-medium text-muted">Summary</h4>
            {summary ? <Markdown>{summary}</Markdown> : <p className="text-meta text-muted">No summary provided.</p>}
          </div>
          <div>
            <h4 className="mb-0.5 text-[12px] font-medium text-muted">Testing</h4>
            {testing ? <Markdown>{testing}</Markdown> : <p className="text-meta text-muted">No testing notes provided.</p>}
          </div>
          <ChecksResult ticket={ticket} />
        </div>
      </div>
    </section>
  );
}
