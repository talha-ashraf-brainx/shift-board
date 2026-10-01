import { format, formatDistanceToNowStrict } from 'date-fns';

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.abs(d.getTime() - new Date().getTime());
  if (diff < 45_000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'PPpp');
}
