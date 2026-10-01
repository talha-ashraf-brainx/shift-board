import { clsx } from 'clsx';
import { useId, useState, type KeyboardEvent } from 'react';
import { Markdown } from './Markdown';

interface MarkdownFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Markdown textarea with a Write / Preview toggle. */
export function MarkdownField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  rows = 5,
  placeholder,
  disabled,
  autoFocus,
  onKeyDown,
}: MarkdownFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [mode, setMode] = useState<'write' | 'preview'>('write');

  const describedBy = [hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <div className="mb-1 flex items-end justify-between gap-2">
        <label htmlFor={id} className="text-meta font-medium text-ink">
          {label}
          {required ? <span className="text-red-600"> *</span> : <span className="font-normal text-muted"> (optional)</span>}
        </label>
        <div className="flex rounded-control border border-line bg-page p-0.5 text-[12px]">
          {(['write', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={clsx(
                'rounded-[5px] px-2 py-0.5 font-medium capitalize transition-[background-color,color,box-shadow] duration-150',
                mode === m ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {mode === 'write' ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          data-autofocus={autoFocus || undefined}
          className="field resize-y font-mono text-[13px] leading-relaxed"
        />
      ) : (
        <section
          id={id}
          className="min-h-24 rounded-control border border-line bg-page/50 px-3 py-2"
          aria-label={`${label} preview`}
        >
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-meta text-muted">Nothing to preview.</p>}
        </section>
      )}
      {hint && !error ? (
        <p id={hintId} className="mt-1 text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-[12px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
