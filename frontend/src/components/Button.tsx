import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-accent',
  secondary: 'bg-surface text-ink border border-line hover:bg-stone-50',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-stone-100 hover:text-ink',
  danger: 'bg-surface text-red-700 border border-red-200 hover:bg-red-50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-meta gap-1.5',
  md: 'h-8 px-3 gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // oxlint-disable-next-line react/button-has-type -- type is constrained by the prop's union type
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
}
