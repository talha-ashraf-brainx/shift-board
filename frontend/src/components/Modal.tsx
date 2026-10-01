import { clsx } from 'clsx';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useLayer } from '../hooks/useLayer';
import { Icon } from './Icon';

interface ModalProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Prevents closing (Esc / backdrop) while a request is in flight. */
  busy?: boolean;
}

const WIDTHS = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

/** Accessible modal dialog: focus trap, Esc to close, backdrop click to close. */
export function Modal({ title, description, onClose, children, footer, size = 'md', busy = false }: ModalProps) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const safeClose = () => {
    if (!busy) onClose();
  };
  useLayer('modal', safeClose);
  useFocusTrap(panelRef);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:pt-[8vh]">
      <div aria-hidden="true" className="fixed inset-0 animate-fade-in bg-scrim backdrop-blur-[3px]" onMouseDown={safeClose} />
      <dialog
        open
        ref={panelRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={clsx(
          'relative m-0 flex max-h-[calc(100vh-2rem)] w-full animate-pop-in flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-ink shadow-pop sm:max-h-[84vh]',
          WIDTHS[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-4 pb-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[18px] leading-tight font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-meta text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={safeClose}
            aria-label="Close"
            className="-mr-1.5 rounded-control p-1.5 text-muted transition-colors hover:bg-stone-100 hover:text-ink"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-page/70 px-5 py-3">{footer}</div>
        ) : null}
      </dialog>
    </div>,
    document.body,
  );
}
