import { clsx } from 'clsx';
import {
  EventAuthor,
  TicketEventType,
  answerText,
  normalizeAnswers,
  normalizeQuestions,
  type AgentLogMeta,
  type AgentQuestionMeta,
  type AgentSummaryMeta,
  type HumanAnswerMeta,
  type StatusChangedMeta,
  type TicketEventDto,
  type TicketStatus,
} from '@agent-board/shared';
import { useTick } from '../hooks/useTick';
import { STATUS_LABEL } from '../lib/meta';
import { absoluteTime, relativeTime } from '../lib/time';
import { Icon, type IconName } from './Icon';
import { Markdown } from './Markdown';

const TYPE_ICON: Record<TicketEventType, { icon: IconName; tone: string; label: string }> = {
  [TicketEventType.Created]: { icon: 'plus', tone: 'bg-stone-100 text-stone-600', label: 'Created' },
  [TicketEventType.StatusChanged]: { icon: 'arrow-swap', tone: 'bg-stone-100 text-stone-600', label: 'Status changed' },
  [TicketEventType.AgentQuestion]: { icon: 'question', tone: 'bg-amber-50 text-amber-700', label: 'Agent asked' },
  [TicketEventType.HumanAnswer]: { icon: 'reply', tone: 'bg-blue-50 text-blue-700', label: 'Answered' },
  [TicketEventType.AgentSummary]: { icon: 'sparkle', tone: 'bg-teal-50 text-teal-700', label: 'Fix submitted' },
  [TicketEventType.ReviewRejected]: { icon: 'x-circle', tone: 'bg-orange-50 text-orange-700', label: 'Rejected' },
  [TicketEventType.ReviewApproved]: { icon: 'merge', tone: 'bg-green-50 text-green-700', label: 'Approved & merged' },
  [TicketEventType.AgentLog]: { icon: 'terminal', tone: 'bg-stone-50 text-stone-500', label: 'Agent' },
  [TicketEventType.Error]: { icon: 'alert', tone: 'bg-red-50 text-red-700', label: 'Error' },
};

const AUTHOR_LABEL: Record<EventAuthor, string> = {
  [EventAuthor.Human]: 'You',
  [EventAuthor.Agent]: 'Agent',
  [EventAuthor.System]: 'System',
};

function meta<T>(e: TicketEventDto): Partial<T> {
  return (e.meta ?? {}) as Partial<T>;
}

function statusName(s: unknown): string {
  return typeof s === 'string' && s in STATUS_LABEL ? STATUS_LABEL[s as TicketStatus] : String(s ?? '?');
}

function Timestamp({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={absoluteTime(iso)} className="shrink-0 text-[12px] text-muted">
      {relativeTime(iso)}
    </time>
  );
}

function LogLine({ event }: { event: TicketEventDto }) {
  const m = meta<AgentLogMeta>(event);
  return (
    <li className="flex items-start gap-2 py-0.5 pl-8 font-mono text-[12px] leading-5 text-muted">
      <span className="shrink-0 text-stone-400" aria-hidden="true">
        {m.kind === 'tool' ? '›' : m.kind === 'note' ? '•' : '·'}
      </span>
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        {m.tool ? <span className="text-stone-600">{m.tool} </span> : null}
        {event.body}
        {m.count && m.count > 1 ? <span className="text-stone-400"> (+{m.count - 1})</span> : null}
      </span>
      <Timestamp iso={event.createdAt} />
    </li>
  );
}

function EventBody({ event }: { event: TicketEventDto }) {
  switch (event.type) {
    case TicketEventType.StatusChanged: {
      const m = meta<StatusChangedMeta>(event);
      return (
        <div className="text-meta">
          <p>
            {m.from && m.to ? (
              <>
                <span className="font-medium">{statusName(m.from)}</span> → <span className="font-medium">{statusName(m.to)}</span>
              </>
            ) : (
              event.body
            )}
          </p>
          {m.from && m.to && event.body && !/^Status changed from/i.test(event.body) ? (
            <p className="mt-0.5 text-muted">{event.body}</p>
          ) : null}
          {m.note ? <Markdown className="mt-1 rounded-control bg-page px-2 py-1">{m.note}</Markdown> : null}
        </div>
      );
    }
    case TicketEventType.AgentQuestion: {
      const m = meta<AgentQuestionMeta>(event);
      const questions = normalizeQuestions(m.questions);
      return (
        <div className="text-meta">
          {m.reason ? <p className="text-muted">{m.reason}</p> : null}
          {questions.length > 0 ? (
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {questions.map((q, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- questions are static text without ids
                <li key={i}>
                  {q.header ? (
                    <span className="mr-1 inline-block rounded-full bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800">
                      {q.header}
                    </span>
                  ) : null}
                  {q.question}
                  {q.multiSelect ? <span className="text-muted"> (pick any)</span> : null}
                  {q.options.length > 0 ? (
                    <ul className="mt-0.5 space-y-px text-[12px]">
                      {q.options.map((o) => (
                        <li key={o.label} className="flex gap-1.5">
                          <span className="text-stone-400" aria-hidden="true">
                            {q.multiSelect ? '☐' : '○'}
                          </span>
                          <span>
                            {o.label}
                            {o.description ? <span className="text-muted"> · {o.description}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <Markdown>{event.body}</Markdown>
          )}
        </div>
      );
    }
    case TicketEventType.HumanAnswer: {
      const m = meta<HumanAnswerMeta>(event);
      const answers = normalizeAnswers(m.answers);
      if (answers.length === 0) return event.body ? <Markdown>{event.body}</Markdown> : null;
      return (
        <div className="text-meta">
          <dl className="space-y-1">
            {answers.map((a, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- answers are positional
              <div key={i}>
                <dt className="text-[12px] text-muted">{a.question || `Question ${i + 1}`}</dt>
                <dd className="break-words">{answerText(a) || <span className="text-muted">No answer</span>}</dd>
              </div>
            ))}
          </dl>
          {typeof m.note === 'string' && m.note.trim() ? (
            <Markdown className="mt-1 rounded-control bg-page px-2 py-1">{m.note}</Markdown>
          ) : null}
        </div>
      );
    }
    case TicketEventType.AgentSummary: {
      const m = meta<AgentSummaryMeta>(event);
      return <Markdown>{m.summary || event.body}</Markdown>;
    }
    case TicketEventType.Error:
      return <p className="font-mono text-[12px] break-words whitespace-pre-wrap text-red-800">{event.body}</p>;
    default:
      return event.body ? <Markdown>{event.body}</Markdown> : null;
  }
}

export function ActivityTimeline({ events }: { events: TicketEventDto[] }) {
  useTick();
  if (events.length === 0) {
    return <p className="py-6 text-center text-meta text-muted">No activity yet.</p>;
  }
  return (
    <ol className="flex flex-col" aria-label="Activity">
      {events.map((event) => {
        if (event.type === TicketEventType.AgentLog) return <LogLine key={event.id} event={event} />;
        const t = TYPE_ICON[event.type] ?? TYPE_ICON[TicketEventType.AgentLog];
        return (
          <li key={event.id} className="flex gap-2.5 py-2">
            <span className={clsx('mt-px grid size-6 shrink-0 place-items-center rounded-full', t.tone)}>
              <Icon name={t.icon} width={13} height={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-meta">
                  <span className="font-medium">{AUTHOR_LABEL[event.author] ?? event.author}</span>{' '}
                  <span className="text-muted">{t.label.toLowerCase()}</span>
                </p>
                <Timestamp iso={event.createdAt} />
              </div>
              <div className="mt-0.5">
                <EventBody event={event} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
