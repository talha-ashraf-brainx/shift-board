import { clsx } from 'clsx';
import { useRef, useState, type KeyboardEvent } from 'react';
import {
  TicketEventType,
  answerText,
  normalizeQuestions,
  type AgentQuestion,
  type AgentQuestionMeta,
  type QuestionAnswer,
  type TicketEventDto,
  type TicketWithEventsDto,
} from '@agent-board/shared';
import { useAnswerTicket } from '../api/queries';
import { Button } from './Button';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { MarkdownField } from './MarkdownField';

function latestQuestion(ticket: TicketWithEventsDto) {
  for (let i = ticket.events.length - 1; i >= 0; i--) {
    const e = ticket.events[i];
    if (e?.type === TicketEventType.AgentQuestion) return e;
  }
  return undefined;
}

/** The human's in-progress answer to one question. `otherOn` = the "Other" choice is picked. */
interface Draft {
  selected: string[];
  other: string;
  otherOn: boolean;
}

const EMPTY_DRAFT: Draft = { selected: [], other: '', otherOn: false };

function isAnswered(q: AgentQuestion, d: Draft): boolean {
  if (q.options.length === 0) return d.other.trim() !== '';
  return d.selected.length > 0 || (d.otherOn && d.other.trim() !== '');
}

function toAnswer(q: AgentQuestion, d: Draft): QuestionAnswer {
  const typed = q.options.length === 0 || d.otherOn ? d.other.trim() : '';
  // Keep the agent's option order, whatever order they were clicked in.
  const selected = q.options.map((o) => o.label).filter((l) => d.selected.includes(l));
  return { question: q.question, selected, other: typed || null };
}

function isTextField(el: EventTarget | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

export function NeedsContextPanel({ ticket }: { ticket: TicketWithEventsDto }) {
  const event = latestQuestion(ticket);
  const meta = (event?.meta ?? {}) as Partial<AgentQuestionMeta>;
  return (
    <section aria-labelledby="needs-context-title" className="animate-rise-in rounded-card border border-amber-200 bg-amber-50/70 p-4">
      <h3 id="needs-context-title" className="flex items-center gap-1.5 text-meta font-semibold text-amber-900">
        <Icon name="question" width={14} height={14} />
        The agent needs more context
      </h3>
      {meta.reason ? <p className="mt-1 text-meta text-amber-900/80">{meta.reason}</p> : null}
      {/* A new question event starts a fresh wizard. */}
      <AnswerWizard key={event?.id ?? 'none'} ticketId={ticket.id} event={event} />
    </section>
  );
}

function AnswerWizard({ ticketId, event }: { ticketId: string; event: TicketEventDto | undefined }) {
  const answer = useAnswerTicket();
  const [questions] = useState(() => normalizeQuestions(event?.meta?.questions));
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => EMPTY_DRAFT));
  const [step, setStep] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Focus moves with the steps only after the human navigates, never on first render.
  const focusPending = useRef(false);

  const total = questions.length;
  const reviewing = step >= total;

  /** The step container remounts per step (it is keyed); focus its first control once it is in the DOM. */
  function focusStep(root: HTMLDivElement | null) {
    if (!root || !focusPending.current) return;
    focusPending.current = false;
    const target =
      root.querySelector<HTMLElement>('[data-step-focus]') ??
      root.querySelector<HTMLElement>('[role="radio"][tabindex="0"], [role="checkbox"][tabindex="0"]');
    target?.focus();
  }

  function goTo(target: number) {
    focusPending.current = true;
    setError(null);
    setStep(Math.max(0, Math.min(target, total)));
  }

  function updateDraft(index: number, d: Draft) {
    setDrafts((prev) => prev.map((p, i) => (i === index ? d : p)));
    setError(null);
  }

  function next(d: Draft = drafts[step] ?? EMPTY_DRAFT) {
    const q = questions[step];
    if (q && !isAnswered(q, d)) {
      setError(q.options.length === 0 ? 'Type an answer to continue.' : 'Pick an option or type your own answer.');
      return;
    }
    goTo(step + 1);
  }

  function submit() {
    if (answer.isPending) return;
    const message = note.trim();
    if (total === 0 && !message) {
      setError('Write an answer before requeueing.');
      return;
    }
    const firstOpen = questions.findIndex((q, i) => !isAnswered(q, drafts[i] ?? EMPTY_DRAFT));
    if (firstOpen >= 0) {
      goTo(firstOpen);
      return;
    }
    answer.mutate({
      id: ticketId,
      ...(total > 0 ? { answers: questions.map((q, i) => toAnswer(q, drafts[i] ?? EMPTY_DRAFT)) } : {}),
      ...(message ? { message } : {}),
    });
  }

  const sendOnShortcut = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  // No recorded questions (or an unreadable event): show what the agent wrote and take one free-text answer.
  if (total === 0) {
    return (
      <div className="mt-2">
        {event?.body ? (
          <Markdown>{event.body}</Markdown>
        ) : (
          <p className="text-meta text-muted">The agent did not record specific questions.</p>
        )}
        <div className="mt-3">
          <MarkdownField
            label="Your answer"
            ticketId={ticketId}
            value={note}
            onChange={(v) => {
              setNote(v);
              setError(null);
            }}
            onKeyDown={sendOnShortcut}
            error={error}
            required
            placeholder="Answer the agent's question."
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted">The agent resumes in the same session. Cmd/Ctrl + Enter to send.</p>
          <Button variant="primary" onClick={submit} loading={answer.isPending}>
            Send answer & requeue
          </Button>
        </div>
      </div>
    );
  }

  const question = questions[step];
  const draft = drafts[step] ?? EMPTY_DRAFT;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-amber-900/80" aria-live="polite">
          {reviewing ? 'Review your answers' : `Question ${step + 1} of ${total}`}
        </p>
        <div className="flex gap-1" aria-hidden="true">
          {questions.map((q, i) => (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- one segment per question position
              key={i}
              className={clsx(
                'h-1 w-5 rounded-full transition-colors duration-150',
                i === step ? 'bg-accent' : isAnswered(q, drafts[i] ?? EMPTY_DRAFT) ? 'bg-accent/40' : 'bg-amber-200',
              )}
            />
          ))}
        </div>
      </div>

      <div ref={focusStep} key={step} className="mt-2 animate-fade-in">
        {question ? (
          <QuestionStep
            index={step}
            question={question}
            draft={draft}
            error={error}
            onChange={(d) => updateDraft(step, d)}
            onNext={next}
          />
        ) : (
          <Review
            ticketId={ticketId}
            questions={questions}
            drafts={drafts}
            note={note}
            onNote={setNote}
            onJump={goTo}
            onKeyDown={sendOnShortcut}
          />
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => goTo(step - 1)} disabled={step === 0}>
          Back
        </Button>
        {reviewing ? (
          <Button variant="primary" onClick={submit} loading={answer.isPending}>
            Send answers & requeue
          </Button>
        ) : (
          <Button variant="primary" onClick={() => next()}>
            {step === total - 1 ? 'Review' : 'Next'}
          </Button>
        )}
      </div>
    </div>
  );
}

interface QuestionStepProps {
  index: number;
  question: AgentQuestion;
  draft: Draft;
  error: string | null;
  onChange: (d: Draft) => void;
  onNext: (d?: Draft) => void;
}

function QuestionStep({ index, question, draft, error, onChange, onNext }: QuestionStepProps) {
  const multi = question.multiSelect === true;
  const options = question.options;
  const otherIndex = options.length;
  const [active, setActive] = useState(() => {
    const picked = options.findIndex((o) => draft.selected.includes(o.label));
    return picked >= 0 ? picked : draft.otherOn ? otherIndex : 0;
  });
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const otherRef = useRef<HTMLInputElement>(null);
  const legendId = `q-${index}-legend`;
  const errorId = `q-${index}-error`;
  const helpId = `q-${index}-help`;

  /** Picks (single) or toggles (multi) item `i`; the "Other" item is `otherIndex`. Returns the new draft. */
  function pick(i: number): Draft {
    let d: Draft;
    if (i === otherIndex) {
      d = multi ? { ...draft, otherOn: !draft.otherOn } : { ...draft, selected: [], otherOn: true };
    } else {
      const label = options[i]!.label;
      if (multi) {
        const has = draft.selected.includes(label);
        d = { ...draft, selected: has ? draft.selected.filter((l) => l !== label) : [...draft.selected, label] };
      } else {
        d = { ...draft, selected: [label], otherOn: false };
      }
    }
    onChange(d);
    setActive(i);
    if (i === otherIndex && d.otherOn) requestAnimationFrame(() => otherRef.current?.focus());
    return d;
  }

  function onGroupKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isTextField(e.target) || e.altKey || e.metaKey || e.ctrlKey) return;
    const count = options.length + 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = (active + (e.key === 'ArrowDown' ? 1 : count - 1)) % count;
      setActive(i);
      itemRefs.current[i]?.focus();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < count) {
        e.preventDefault();
        pick(i);
        itemRefs.current[i]?.focus();
      }
      return;
    }
    if (e.key === 'Enter') {
      const i = Number((e.target as HTMLElement).dataset.optionIndex);
      if (Number.isNaN(i)) return;
      e.preventDefault();
      // Single-select: Enter picks the focused option and moves on. Multi-select: Space toggles, Enter moves on.
      if (multi) onNext();
      else if (i === otherIndex) pick(i);
      else onNext(pick(i));
    }
  }

  const header = question.header ? (
    <span className="mr-1.5 inline-block rounded-full bg-amber-100 px-2 py-px align-[1px] text-[11px] font-medium text-amber-800">
      {question.header}
    </span>
  ) : null;

  if (options.length === 0) {
    const id = `q-${index}-text`;
    return (
      <div>
        <label htmlFor={id} className="block text-ink">
          {header}
          <span className="font-medium">{question.question}</span>
        </label>
        <textarea
          id={id}
          value={draft.other}
          onChange={(e) => onChange({ ...draft, other: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onNext();
            }
          }}
          rows={4}
          placeholder="Type your answer."
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : helpId}
          data-step-focus
          className="field mt-2 resize-y"
        />
        <StepMessage error={error} errorId={errorId} helpId={helpId} help="Cmd/Ctrl + Enter for the next question." />
      </div>
    );
  }

  const items = [...options, { label: 'Other', description: 'Type your own answer.' }];

  return (
    <fieldset aria-describedby={error ? errorId : helpId}>
      <legend id={legendId} className="text-ink">
        {header}
        <span className="font-medium">{question.question}</span>
        {multi ? <span className="ml-1 text-[12px] text-muted">(pick any)</span> : null}
      </legend>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the role is radiogroup or group, set per question */}
      <div role={multi ? 'group' : 'radiogroup'} aria-labelledby={legendId} className="mt-2 flex flex-col gap-1.5" onKeyDown={onGroupKeyDown}>
        {items.map((item, i) => {
          const isOther = i === otherIndex;
          const checked = isOther ? draft.otherOn : draft.selected.includes(item.label);
          return (
            <button
              key={isOther ? '__other' : item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={checked}
              tabIndex={i === active ? 0 : -1}
              data-option-index={i}
              onClick={() => pick(i)}
              onFocus={() => setActive(i)}
              className={clsx(
                'flex w-full items-start gap-2.5 rounded-control border px-3 py-2 text-left',
                'transition-[background-color,border-color,box-shadow] duration-150',
                'focus-visible:ring-[3px] focus-visible:ring-accent/20 focus-visible:outline-none',
                checked ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <span
                aria-hidden="true"
                className={clsx(
                  'mt-0.5 grid size-4 shrink-0 place-items-center border transition-colors duration-150',
                  multi ? 'rounded-[4px]' : 'rounded-full',
                  checked ? 'border-accent bg-accent text-on-primary' : 'border-line-strong bg-surface',
                )}
              >
                {checked ? (
                  multi ? (
                    <Icon name="check" width={11} height={11} />
                  ) : (
                    <span className="size-1.5 rounded-full bg-surface" />
                  )
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block text-meta font-medium', isOther ? 'text-muted' : 'text-ink')}>{item.label}</span>
                {item.description ? <span className="mt-0.5 block text-[12px] text-muted">{item.description}</span> : null}
              </span>
              {i < 9 ? (
                <kbd aria-hidden="true" className="mt-px rounded-[4px] border border-line px-1 font-sans text-[11px] leading-4 text-muted">
                  {i + 1}
                </kbd>
              ) : null}
            </button>
          );
        })}
      </div>
      {draft.otherOn ? (
        <input
          ref={otherRef}
          type="text"
          value={draft.other}
          onChange={(e) => onChange({ ...draft, other: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onNext();
            }
          }}
          aria-label={`Your own answer to: ${question.question}`}
          placeholder="Type your answer."
          className="field mt-1.5"
        />
      ) : null}
      <StepMessage
        error={error}
        errorId={errorId}
        helpId={helpId}
        help={
          multi
            ? '↑/↓ to move, Space or 1–9 to toggle, Enter for next.'
            : '↑/↓ to move, 1–9 to pick, Enter to choose and continue.'
        }
      />
    </fieldset>
  );
}

function StepMessage({ error, errorId, helpId, help }: { error: string | null; errorId: string; helpId: string; help: string }) {
  return error ? (
    <p id={errorId} role="alert" className="mt-1.5 text-[12px] text-red-600">
      {error}
    </p>
  ) : (
    <p id={helpId} className="mt-1.5 text-[12px] text-muted">
      {help}
    </p>
  );
}

interface ReviewProps {
  ticketId: string;
  questions: AgentQuestion[];
  drafts: Draft[];
  note: string;
  onNote: (v: string) => void;
  onJump: (step: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

function Review({ ticketId, questions, drafts, note, onNote, onJump, onKeyDown }: ReviewProps) {
  return (
    <div>
      <ol className="flex flex-col gap-1.5">
        {questions.map((q, i) => {
          const text = answerText(toAnswer(q, drafts[i] ?? EMPTY_DRAFT));
          return (
            // oxlint-disable-next-line react/no-array-index-key -- answers are positional
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(i)}
                data-step-focus={i === 0 || undefined}
                aria-label={`Change answer ${i + 1}: ${q.question}`}
                className={clsx(
                  'group flex w-full items-start gap-2 rounded-control border border-line bg-surface px-3 py-2 text-left',
                  'transition-[border-color,box-shadow] duration-150 hover:border-line-strong',
                  'focus-visible:ring-[3px] focus-visible:ring-accent/20 focus-visible:outline-none',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-muted">
                    {q.header ? `${q.header} · ` : ''}
                    {q.question}
                  </span>
                  <span className={clsx('mt-0.5 block text-meta break-words', text ? 'text-ink' : 'text-red-600')}>
                    {text || 'Not answered'}
                  </span>
                </span>
                <Icon name="edit" width={12} height={12} className="mt-1 shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-3">
        <MarkdownField
          label="Anything else?"
          ticketId={ticketId}
          value={note}
          onChange={onNote}
          onKeyDown={onKeyDown}
          rows={3}
          hint="The agent resumes in the same session. Cmd/Ctrl + Enter to send."
          placeholder="Extra context for the agent."
        />
      </div>
    </div>
  );
}
