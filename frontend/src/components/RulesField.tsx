import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

interface RulesFieldProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
}

/** A list of one-line rules: each entry is its own input, added and removed individually. */
export function RulesField({ label, value, onChange, hint, placeholder, disabled }: RulesFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  // Stable keys so focus and typing survive removals above the current row.
  const nextKey = useRef(value.length);
  const [keys, setKeys] = useState(() => value.map((_, i) => i));
  // Row to focus once it renders (a new row, or the neighbour of a removed one).
  const focusKey = useRef<number | null>(null);

  function add(at = value.length) {
    const key = nextKey.current++;
    setKeys((k) => [...k.slice(0, at), key, ...k.slice(at)]);
    onChange([...value.slice(0, at), '', ...value.slice(at)]);
    focusKey.current = key;
  }

  function remove(index: number) {
    setKeys((k) => k.filter((_, i) => i !== index));
    onChange(value.filter((_, i) => i !== index));
    const neighbour = keys[index - 1] ?? keys[index + 1];
    if (neighbour !== undefined) focusKey.current = neighbour;
  }

  function edit(index: number, text: string) {
    onChange(value.map((v, i) => (i === index ? text : v)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      add(index + 1);
    } else if (e.key === 'Backspace' && value[index] === '' && value.length > 0) {
      e.preventDefault();
      remove(index);
    }
  }

  return (
    <fieldset aria-describedby={hint ? hintId : undefined} className="min-w-0">
      <legend className="mb-1 text-meta font-medium text-ink">
        {label} <span className="font-normal text-muted">(optional)</span>
      </legend>
      {value.length > 0 ? (
        <ol className="mb-2 flex flex-col gap-1.5">
          {value.map((rule, i) => {
            const key = keys[i] ?? -1 - i;
            return (
              <li key={key} className="flex animate-rise-in items-center gap-2">
                <span className="w-5 shrink-0 text-right text-[12px] text-muted tabular-nums">{i + 1}.</span>
                <input
                  ref={(el) => {
                    if (el && focusKey.current === key) {
                      focusKey.current = null;
                      el.focus();
                    }
                  }}
                  value={rule}
                  onChange={(e) => edit(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  placeholder={placeholder}
                  aria-label={`Rule ${i + 1}`}
                  maxLength={2000}
                  disabled={disabled}
                  className="field"
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={`Remove rule ${i + 1}`}
                  className="grid size-8 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Icon name="trash" width={14} height={14} />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
      <Button size="sm" icon={<Icon name="plus" width={13} height={13} />} onClick={() => add()} disabled={disabled}>
        Add rule
      </Button>
      {hint ? (
        <p id={hintId} className="mt-1 text-[12px] text-muted">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
