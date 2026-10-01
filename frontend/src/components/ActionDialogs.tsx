import { useState, type KeyboardEvent } from 'react';
import type { TicketDto } from '@agent-board/shared';
import {
  useApproveTicket,
  useCancelTicket,
  useRejectTicket,
  useRetryTicket,
  useStartFresh,
} from '../api/queries';
import { useProject } from '../hooks/useProjectSelection';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { MarkdownField } from './MarkdownField';
import { Modal } from './Modal';

interface DialogProps {
  ticket: TicketDto;
  onClose: () => void;
}

function submitOnModEnter(submit: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };
}

export function CancelDialog({ ticket, onClose }: DialogProps) {
  const cancel = useCancelTicket();
  return (
    <ConfirmDialog
      title={`Cancel ticket #${ticket.number}?`}
      confirmLabel="Cancel ticket"
      tone="danger"
      busy={cancel.isPending}
      onClose={onClose}
      onConfirm={() => cancel.mutate(ticket.id, { onSuccess: onClose })}
    >
      <p>
        {ticket.status === 'in_progress' ? 'The running agent is stopped first. ' : ''}
        The ticket&rsquo;s worktree and branch are deleted. This cannot be undone.
      </p>
    </ConfirmDialog>
  );
}

export function ApproveDialog({ ticket, onClose }: DialogProps) {
  const approve = useApproveTicket();
  const base = useProject(ticket.projectId)?.baseBranch ?? 'the base branch';
  return (
    <ConfirmDialog
      title={`Approve and merge #${ticket.number}?`}
      confirmLabel="Approve & merge"
      busy={approve.isPending}
      onClose={onClose}
      onConfirm={() => approve.mutate(ticket.id, { onSuccess: onClose })}
    >
      <p>
        <code className="rounded bg-stone-100 px-1 font-mono text-[12px]">{ticket.branchName ?? 'The ticket branch'}</code> is
        merged into <code className="rounded bg-stone-100 px-1 font-mono text-[12px]">{base}</code> and the worktree is removed.
      </p>
    </ConfirmDialog>
  );
}

export function RejectDialog({ ticket, onClose }: DialogProps) {
  const reject = useRejectTicket();
  const [feedback, setFeedback] = useState('');
  const [touched, setTouched] = useState(false);
  const error = touched && !feedback.trim() ? 'Tell the agent what to change.' : null;

  function submit() {
    setTouched(true);
    if (!feedback.trim() || reject.isPending) return;
    reject.mutate({ id: ticket.id, feedback: feedback.trim() }, { onSuccess: onClose });
  }

  return (
    <Modal
      title={`Reject #${ticket.number}`}
      description="The ticket returns to Pending and the agent revises the fix on the same branch."
      onClose={onClose}
      busy={reject.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={reject.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={reject.isPending} onClick={submit}>
            Reject & requeue
          </Button>
        </>
      }
    >
      <MarkdownField
        label="Feedback"
        required
        value={feedback}
        onChange={setFeedback}
        onKeyDown={submitOnModEnter(submit)}
        rows={6}
        placeholder="What is wrong with this fix, and what should the agent do instead?"
        error={error}
        hint="Paste or drop screenshots; the agent sees them. Cmd/Ctrl + Enter to send."
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- becomes data-autofocus for the modal's focus trap
        autoFocus
        ticketId={ticket.id}
      />
    </Modal>
  );
}

export function RetryDialog({ ticket, onClose }: DialogProps) {
  const retry = useRetryTicket();
  const [note, setNote] = useState('');

  function submit() {
    if (retry.isPending) return;
    retry.mutate({ id: ticket.id, note: note.trim() || undefined }, { onSuccess: onClose });
  }

  return (
    <Modal
      title={`Retry #${ticket.number}`}
      description="The ticket goes back to Pending. The agent sees the previous error and your note."
      onClose={onClose}
      busy={retry.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={retry.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={retry.isPending} onClick={submit}>
            Retry ticket
          </Button>
        </>
      }
    >
      {ticket.lastError ? (
        <div className="mb-3 rounded-control border border-red-200 bg-red-50 px-3 py-2 text-meta text-red-800">
          <span className="font-medium">Last error: </span>
          <span className="break-words whitespace-pre-wrap">{ticket.lastError}</span>
        </div>
      ) : null}
      <MarkdownField
        label="Note for the agent"
        value={note}
        onChange={setNote}
        onKeyDown={submitOnModEnter(submit)}
        rows={4}
        placeholder="e.g. The test database was down; it is back now."
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- becomes data-autofocus for the modal's focus trap
        autoFocus
        ticketId={ticket.id}
      />
    </Modal>
  );
}

export function StartFreshDialog({ ticket, onClose }: DialogProps) {
  const startFresh = useStartFresh();
  const [resetWorktree, setResetWorktree] = useState(false);
  const base = useProject(ticket.projectId)?.baseBranch ?? 'the base branch';

  return (
    <ConfirmDialog
      title={`Start #${ticket.number} fresh?`}
      confirmLabel="Start fresh"
      tone="danger"
      busy={startFresh.isPending}
      onClose={onClose}
      onConfirm={() => startFresh.mutate({ id: ticket.id, resetWorktree }, { onSuccess: onClose })}
    >
      <p>The agent forgets its previous session and starts over on the next run.</p>
      <label className="mt-3 flex items-start gap-2 text-meta">
        <input
          type="checkbox"
          checked={resetWorktree}
          onChange={(e) => setResetWorktree(e.target.checked)}
          className="mt-0.5 size-4 accent-accent"
        />
        <span>
          Also reset the worktree to <code className="font-mono text-[12px]">{base}</code>, discarding the agent&rsquo;s commits on{' '}
          <code className="font-mono text-[12px]">{ticket.branchName ?? 'its branch'}</code>.
        </span>
      </label>
    </ConfirmDialog>
  );
}

export type TicketDialog = 'cancel' | 'approve' | 'reject' | 'retry' | 'start-fresh';

/** Renders the dialog for `kind`, or nothing. */
export function TicketDialogHost({
  kind,
  ticket,
  onClose,
}: {
  kind: TicketDialog | null;
  ticket: TicketDto | undefined;
  onClose: () => void;
}) {
  if (!kind || !ticket) return null;
  switch (kind) {
    case 'cancel':
      return <CancelDialog ticket={ticket} onClose={onClose} />;
    case 'approve':
      return <ApproveDialog ticket={ticket} onClose={onClose} />;
    case 'reject':
      return <RejectDialog ticket={ticket} onClose={onClose} />;
    case 'retry':
      return <RetryDialog ticket={ticket} onClose={onClose} />;
    case 'start-fresh':
      return <StartFreshDialog ticket={ticket} onClose={onClose} />;
  }
}
