import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { ALL_PRIORITIES, TicketPriority, TicketStatus, type TicketDto, type UpdateTicketInput } from '@agent-board/shared';
import { useCreateTicket, useProjects, useUpdateTicket } from '../api/queries';
import { PRIORITY_LABEL } from '../lib/meta';
import { Button } from './Button';
import { Icon } from './Icon';
import { MarkdownField } from './MarkdownField';
import { Modal } from './Modal';
import { RulesField } from './RulesField';

const TITLE_MAX = 200;

interface TicketFormModalProps {
  /** Present when editing. */
  ticket?: TicketDto;
  onClose: () => void;
  onCreated?: (ticket: TicketDto) => void;
  /** Project of a new ticket: the board's selected project (the switcher), never chosen in the form. */
  projectId?: string | null;
}

interface Errors {
  title?: string;
  description?: string;
}

function validate(title: string, description: string): Errors {
  const errors: Errors = {};
  if (title.trim().length > TITLE_MAX) errors.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (!description.trim()) errors.description = 'Describe what is wrong or what to change.';
  return errors;
}

/** Trimmed, non-empty, de-duplicated rules (the API normalises the same way). */
function cleanRules(rules: string[]): string[] {
  return [...new Set(rules.map((r) => r.trim()).filter(Boolean))];
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function TicketFormModal({ ticket, onClose, onCreated, projectId }: TicketFormModalProps) {
  const editing = Boolean(ticket);
  const locked = ticket?.status === TicketStatus.InProgress;
  const projects = useProjects();
  const projectList = projects.data ?? [];

  const project = projectList.find((p) => p.id === (ticket ? ticket.projectId : projectId));

  const [title, setTitle] = useState(ticket?.title ?? '');
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? TicketPriority.Medium);
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [rules, setRules] = useState<string[]>(ticket?.rules ?? []);
  const [submitted, setSubmitted] = useState(false);

  const create = useCreateTicket();
  const update = useUpdateTicket();
  const busy = create.isPending || update.isPending;

  const errors = submitted ? validate(title, description) : {};

  function submit() {
    if (busy || locked) return;
    setSubmitted(true);
    const found = validate(title, description);
    if (found.title || found.description) return;

    if (ticket) {
      const input: UpdateTicketInput = {};
      if (title.trim() !== ticket.title) input.title = title.trim();
      if (priority !== ticket.priority) input.priority = priority;
      if (description !== ticket.description) input.description = description;
      if (!sameList(cleanRules(rules), ticket.rules)) input.rules = cleanRules(rules);
      if (Object.keys(input).length === 0) {
        onClose();
        return;
      }
      update.mutate({ id: ticket.id, input }, { onSuccess: onClose });
    } else {
      if (!projectId) return;
      create.mutate(
        { projectId, title: title.trim(), priority, description, rules: cleanRules(rules) },
        {
          onSuccess: (created) => {
            onClose();
            onCreated?.(created);
          },
        },
      );
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  const formId = 'ticket-form';

  return (
    <Modal
      title={editing ? `Edit ticket #${ticket?.number}` : 'New ticket'}
      description={
        <>
          {project ? (
            <span className="inline-flex max-w-full items-center gap-1 align-bottom" title={project.repoPath}>
              <Icon name="folder" width={13} height={13} className="shrink-0" />
              <span className="truncate font-medium text-ink">{project.name}</span>
              <span aria-hidden="true">·</span>
            </span>
          ) : null}{' '}
          {locked
            ? 'The agent is working on this ticket. Editing is disabled until the run ends.'
            : 'Cmd/Ctrl + Enter to save, Esc to close.'}
        </>
      }
      onClose={onClose}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={locked}>
            {editing ? 'Save changes' : 'Create ticket'}
          </Button>
        </>
      }
    >
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keyboard shortcut for the whole form */}
      <form id={formId} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate className="flex flex-col gap-4">
        <fieldset disabled={locked} className="contents">
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <div>
              <label htmlFor="ticket-title" className="mb-1 block text-meta font-medium">
                Title <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="ticket-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={TITLE_MAX + 50}
                placeholder="Checkout total ignores the discount code"
                aria-invalid={errors.title ? true : undefined}
                aria-describedby="ticket-title-help"
                data-autofocus
                className="field"
              />
              <p
                id="ticket-title-help"
                className={errors.title ? 'mt-1 text-[12px] text-red-600' : 'mt-1 text-[12px] text-muted'}
                role={errors.title ? 'alert' : undefined}
              >
                {errors.title ?? `${title.trim().length}/${TITLE_MAX}`}
              </p>
            </div>
            <div>
              <label htmlFor="ticket-priority" className="mb-1 block text-meta font-medium">
                Priority
              </label>
              <select
                id="ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="field"
              >
                {ALL_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <MarkdownField
            label="Description"
            required
            value={description}
            onChange={setDescription}
            error={errors.description}
            rows={6}
            placeholder="What is wrong, and what should happen instead?"
            disabled={locked}
          />
          <RulesField
            label="Rules for this ticket"
            value={rules}
            onChange={setRules}
            placeholder="Do not modify tests"
            hint="Each rule is added to the global and project rules. Enter adds another."
            disabled={locked}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
