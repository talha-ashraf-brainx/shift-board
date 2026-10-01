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
  /** Preselected project for a new ticket (the board's selection); falls back to the first project. */
  defaultProjectId?: string | null;
}

interface Errors {
  project?: string;
  title?: string;
  description?: string;
}

function validate(projectId: string, title: string, description: string, editing: boolean): Errors {
  const errors: Errors = {};
  if (!editing && !projectId) errors.project = 'Choose the project this ticket belongs to.';
  if (title.trim().length > TITLE_MAX) errors.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (!description.trim()) errors.description = 'Describe what is wrong or what to change.';
  return errors;
}

/** Trimmed, non-empty, de-duplicated rules (the API normalises the same way). */
function cleanRules(rules: string[]): string[] {
  return [...new Set(rules.map((r) => r.trim()).filter(Boolean))];
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function TicketFormModal({ ticket, onClose, onCreated, defaultProjectId }: TicketFormModalProps) {
  const editing = Boolean(ticket);
  const locked = ticket?.status === TicketStatus.InProgress;
  const projects = useProjects();
  const projectList = projects.data ?? [];

  const [chosenProjectId, setProjectId] = useState<string | null>(null);
  // Until the user picks one: the board's selection if it exists, else the first project.
  const projectId =
    chosenProjectId ??
    (defaultProjectId && projectList.some((p) => p.id === defaultProjectId) ? defaultProjectId : (projectList[0]?.id ?? ''));
  const ticketProject = ticket ? projectList.find((p) => p.id === ticket.projectId) : undefined;
  const chosenProject = projectList.find((p) => p.id === projectId);

  const [title, setTitle] = useState(ticket?.title ?? '');
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? TicketPriority.Medium);
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [rules, setRules] = useState<string[]>(ticket?.rules ?? []);
  const [submitted, setSubmitted] = useState(false);

  const create = useCreateTicket();
  const update = useUpdateTicket();
  const busy = create.isPending || update.isPending;

  const errors = submitted ? validate(projectId, title, description, editing) : {};

  function submit() {
    if (busy || locked) return;
    setSubmitted(true);
    const found = validate(projectId, title, description, editing);
    if (found.project || found.title || found.description) return;

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
        locked ? 'The agent is working on this ticket. Editing is disabled until the run ends.' : 'Cmd/Ctrl + Enter to save, Esc to close.'
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
          {ticket ? (
            <div className="flex items-center gap-2 text-meta">
              <span className="text-muted">Project</span>
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-control border border-line bg-page px-2 py-0.5 font-medium">
                <Icon name="folder" width={13} height={13} className="shrink-0 text-muted" />
                <span className="truncate">{ticketProject?.name ?? (ticket.projectId ? 'Unknown project' : 'No project')}</span>
              </span>
              <span className="text-[12px] text-muted">A ticket&rsquo;s project can&rsquo;t be changed.</span>
            </div>
          ) : (
            <div>
              <label htmlFor="ticket-project" className="mb-1 block text-meta font-medium">
                Project<span className="text-red-600"> *</span>
              </label>
              <select
                id="ticket-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-required="true"
                aria-invalid={errors.project ? true : undefined}
                aria-describedby="ticket-project-help"
                disabled={projects.isLoading}
                className="field"
              >
                {projectList.length === 0 ? <option value="">{projects.isLoading ? 'Loading projects…' : 'No projects yet'}</option> : null}
                {projectList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.repoStatus.ready ? '' : ' (repository not ready)'}
                  </option>
                ))}
              </select>
              <p
                id="ticket-project-help"
                className={errors.project ? 'mt-1 text-[12px] text-red-600' : 'mt-1 truncate text-[12px] text-muted'}
                role={errors.project ? 'alert' : undefined}
                title={chosenProject?.repoPath}
              >
                {errors.project ??
                  (chosenProject ? (
                    <>
                      <span className="font-mono">{chosenProject.repoPath}</span> &middot; branches off{' '}
                      <span className="font-mono">{chosenProject.baseBranch}</span>
                    </>
                  ) : (
                    'Add a project first.'
                  ))}
              </p>
            </div>
          )}
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
