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

/** Images open full size in a new tab. Upload placeholders (see useImageAttachments) render as a chip. */
function MarkdownImage({ node: _node, src, alt, ...props }: ComponentPropsWithoutRef<'img'> & ExtraProps) {
  if (typeof src !== 'string' || !src || src.startsWith('uploading-')) {
    return <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[12px] text-muted">{alt || 'Image'}</span>;
  }
  return (
    <a href={src} target="_blank" rel="noreferrer noopener" className="my-1 inline-block max-w-full align-top" title={alt || undefined}>
      <img
        {...props}
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="block max-h-96 max-w-full rounded-control border border-line bg-page object-contain"
      />
    </a>
  );
}

const COMPONENTS: Components = { a: MarkdownLink, img: MarkdownImage };

/** Renders untrusted markdown (raw HTML is not rendered by react-markdown). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('md', className)}>
      <ReactMarkdown components={COMPONENTS}>{children}</ReactMarkdown>
    </div>
  );
}
