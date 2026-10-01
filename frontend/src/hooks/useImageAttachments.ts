import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '../api/client';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Escapes a filename for use as markdown image alt text. */
function altText(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').replace(/[[\]\\]/g, '\\$&');
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

let nextUploadId = 1;

interface Options {
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Links uploads to an existing ticket (optional). */
  ticketId?: string;
  enabled: boolean;
}

/**
 * Image paste / drop / pick for a markdown textarea. Each image gets a placeholder at the cursor
 * while it uploads, replaced by `![name](/api/attachments/<id>)` on success or removed on failure.
 */
export function useImageAttachments({ value, onChange, textareaRef, ticketId, enabled }: Options) {
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Uploads finish after re-renders: always edit the latest text, not the one captured at start.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  function setValue(next: string) {
    valueRef.current = next;
    onChangeRef.current(next);
  }

  /** Replaces the first occurrence of `token`; returns false when the user already removed it. */
  function replaceToken(token: string, replacement: string): boolean {
    const current = valueRef.current;
    const i = current.indexOf(token);
    if (i < 0) return false;
    let end = i + token.length;
    // Removing a placeholder also removes the line break we added after it.
    if (!replacement && current[end] === '\n') end++;
    setValue(current.slice(0, i) + replacement + current.slice(end));
    return true;
  }

  function insertAtCursor(text: string) {
    const current = valueRef.current;
    const el = textareaRef.current;
    const start = el && document.activeElement === el ? el.selectionStart : current.length;
    const end = el && document.activeElement === el ? el.selectionEnd : current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    // Keep each image on its own line.
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const suffix = after.startsWith('\n') ? '' : '\n';
    const inserted = prefix + text + suffix;
    setValue(before + inserted + after);
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      if (el && document.activeElement === el) el.setSelectionRange(caret, caret);
    });
  }

  function uploadFiles(files: File[]) {
    if (!enabled || files.length === 0) return;
    const accepted: File[] = [];
    for (const f of files) {
      if (!IMAGE_TYPES.includes(f.type)) toast.error(`${f.name || 'File'} is not a PNG, JPEG, GIF or WebP image`);
      else if (f.size > MAX_IMAGE_BYTES) toast.error(`${f.name || 'Image'} is larger than 10 MB`);
      else accepted.push(f);
    }
    if (accepted.length === 0) return;

    const jobs = accepted.map((file) => {
      const name = file.name || 'image';
      return { file, name, token: `![Uploading ${altText(name)}…](uploading-${nextUploadId++})` };
    });
    insertAtCursor(jobs.map((j) => j.token).join('\n'));
    setUploading((n) => n + jobs.length);

    for (const job of jobs) {
      api
        .uploadAttachment(job.file, ticketId)
        .then((dto) => {
          replaceToken(job.token, `![${altText(dto.filename)}](${dto.url})`);
        })
        .catch((err: unknown) => {
          replaceToken(job.token, '');
          toast.error(`Could not upload ${job.name}`, { description: errorMessage(err) });
        })
        .finally(() => setUploading((n) => n - 1));
    }
  }

  return {
    uploading,
    dragging,
    uploadFiles,
    onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
      if (!enabled) return;
      const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
      // Rich copies (e.g. a spreadsheet cell) carry both text and an image: keep the text paste.
      if (images.length === 0 || e.clipboardData.types.includes('text/plain')) return;
      e.preventDefault();
      uploadFiles(images);
    },
    onDragOver(e: DragEvent<HTMLElement>) {
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    },
    onDragLeave(e: DragEvent<HTMLElement>) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop(e: DragEvent<HTMLElement>) {
      setDragging(false);
      if (!enabled || !hasFiles(e)) return;
      e.preventDefault();
      textareaRef.current?.focus();
      uploadFiles(Array.from(e.dataTransfer.files));
    },
  };
}
