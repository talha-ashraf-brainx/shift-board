import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Keep as is
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={onConfirm}
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-ink">{children}</div>
    </Modal>
  );
}
