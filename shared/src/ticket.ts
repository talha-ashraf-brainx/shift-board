const FALLBACK_MAX = 120;

/** The ticket's title, or (when it has none) the first line of its description, clipped. */
export function ticketTitle(t: { title: string; description: string }): string {
  const title = t.title.trim();
  if (title) return title;
  const line = t.description.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? '';
  return line.length > FALLBACK_MAX ? `${line.slice(0, FALLBACK_MAX - 1).trimEnd()}…` : line;
}

/** "#12: Fix login", or just "#12" for an untitled ticket. Used in commit and merge messages. */
export function ticketSubject(t: { number: number; title: string }): string {
  const title = t.title.trim();
  return title ? `#${t.number}: ${title}` : `#${t.number}`;
}
