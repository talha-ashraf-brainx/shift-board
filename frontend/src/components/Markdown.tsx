import { clsx } from 'clsx';
import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';

function MarkdownLink({ node: _node, children, ...props }: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  return (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

const COMPONENTS: Components = { a: MarkdownLink };

/** Renders untrusted markdown (raw HTML is not rendered by react-markdown). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('md', className)}>
      <ReactMarkdown components={COMPONENTS}>{children}</ReactMarkdown>
    </div>
  );
}
