import { useState } from 'react';
import { TicketEventType, type AgentQuestionMeta, type TicketWithEventsDto } from '@agent-board/shared';
import { useAnswerTicket } from '../api/queries';
import { Button } from './Button';
import { Icon } from './Icon';
import { Markdown } from './Markdown';

function latestQuestion(ticket: TicketWithEventsDto) {
  for (let i = ticket.events.length - 1; i >= 0; i--) {
    const e = ticket.events[i];
    if (e?.type === TicketEventType.AgentQuestion) return e;
  }
  return undefined;
}

export function NeedsContextPanel({ ticket }: { ticket: TicketWithEventsDto }) {
  const answer = useAnswerTicket();
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const event = latestQuestion(ticket);
  const meta = (event?.meta ?? {}) as Partial<AgentQuestionMeta>;
  const questions = Array.isArray(meta.questions) ? meta.questions.filter((q) => typeof q === 'string') : [];
  const error = touched && !message.trim() ? 'Write an answer before requeueing.' : null;

  function submit() {
    setTouched(true);
    if (!message.trim() || answer.isPending) return;
    answer.mutate(
      { id: ticket.id, message: message.trim() },
      {
        onSuccess: () => {
          setMessage('');
          setTouched(false);
        },
      },
    );
  }

  return (
    <section aria-labelledby="needs-context-title" className="animate-rise-in rounded-card border border-amber-200 bg-amber-50/70 p-4">
      <h3 id="needs-context-title" className="flex items-center gap-1.5 text-meta font-semibold text-amber-900">
        <Icon name="question" width={14} height={14} />
        The agent needs more context
      </h3>
      {meta.reason ? <p className="mt-1 text-meta text-amber-900/80">{meta.reason}</p> : null}
      {questions.length > 0 ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink marker:text-amber-700">
          {questions.map((q, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- questions are positional text
            <li key={i} className="pl-1">
              {q}
            </li>
          ))}
        </ol>
      ) : event?.body ? (
        <Markdown className="mt-2">{event.body}</Markdown>
      ) : (
        <p className="mt-2 text-meta text-muted">The agent did not record specific questions.</p>
      )}
      <label htmlFor="answer-text" className="mt-3 mb-1 block text-meta font-medium text-ink">
        Your answer
      </label>
      <textarea
        id="answer-text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={5}
        placeholder={questions.length > 1 ? 'Answer each question; numbering them helps the agent.' : 'Answer the question above.'}
        aria-invalid={error ? true : undefined}
        aria-describedby="answer-help"
        className="field resize-y"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p id="answer-help" className={error ? 'text-[12px] text-red-600' : 'text-[12px] text-muted'}>
          {error ?? 'The agent resumes in the same session. Cmd/Ctrl + Enter to send.'}
        </p>
        <Button variant="primary" onClick={submit} loading={answer.isPending}>
          Send answer & requeue
        </Button>
      </div>
    </section>
  );
}
