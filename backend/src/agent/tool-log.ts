import type { AgentLogMeta } from '@agent-board/shared';
import { isAbsolute, relative } from 'node:path';

export const MAX_LOG_LINE = 120;

export function truncate(text: string, max = MAX_LOG_LINE): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function str(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function displayPath(path: string | undefined, cwd?: string): string {
  if (!path) return '';
  if (cwd && isAbsolute(path)) {
    const rel = relative(cwd, path);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
  }
  return path;
}

/**
 * One-line, human-readable summary of a tool call, e.g. `Edit src/x.ts`,
 * `Bash: git commit -m …`, `Grep "foo"`. Absolute paths inside `cwd` are shown relative.
 * Always at most MAX_LOG_LINE characters.
 */
export function summarizeToolUse(name: string, input: unknown, cwd?: string): string {
  const path = displayPath(str(input, 'file_path') ?? str(input, 'notebook_path') ?? str(input, 'path'), cwd);

  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return truncate(path ? `${name} ${path}` : name);
    case 'Bash':
      return truncate(`Bash: ${str(input, 'command') ?? ''}`);
    case 'Grep': {
      const pattern = str(input, 'pattern') ?? '';
      return truncate(`Grep "${pattern}"${path ? ` in ${path}` : ''}`);
    }
    case 'Glob':
      return truncate(`Glob ${str(input, 'pattern') ?? ''}${path ? ` in ${path}` : ''}`);
    case 'LS':
      return truncate(`LS ${path}`);
    case 'TodoWrite':
      return 'Update todo list';
    case 'Task':
    case 'Agent':
      return truncate(`${name}: ${str(input, 'description') ?? str(input, 'prompt') ?? ''}`);
    case 'mcp__board__submit_fix':
      return 'submit_fix: submitted the fix for review';
    case 'mcp__board__request_context': {
      const qs = input && typeof input === 'object' ? (input as Record<string, unknown>).questions : undefined;
      const n = Array.isArray(qs) ? qs.length : 0;
      return `request_context: asked ${n} question${n === 1 ? '' : 's'}`;
    }
    case 'mcp__board__give_up':
      return truncate(`give_up: ${str(input, 'reason') ?? ''}`);
    case 'mcp__board__add_note':
      return truncate(`add_note: ${str(input, 'message') ?? ''}`);
    default: {
      if (path) return truncate(`${name} ${path}`);
      const firstString =
        input && typeof input === 'object'
          ? Object.values(input as Record<string, unknown>).find((v): v is string => typeof v === 'string')
          : undefined;
      return truncate(firstString ? `${name}: ${firstString}` : name);
    }
  }
}

export interface LogLineMeta {
  kind: AgentLogMeta['kind'];
  tool?: string;
}

export type LogEmitter = (body: string, meta: AgentLogMeta) => void | Promise<void>;

export interface LogThrottlerOptions {
  /** Flush buffered lines at most this often (ms). */
  intervalMs?: number;
  /** Flush as soon as this many lines are buffered. */
  maxLines?: number;
  /** Maximum log events per run; one "suppressed" event follows. */
  maxEvents?: number;
}

export const SUPPRESSED_MESSAGE = '…further log output suppressed';

/**
 * Coalesces log lines into few `agent_log` events: buffered lines are flushed
 * at most every `intervalMs` (2s) or once `maxLines` (10) are buffered. A change
 * of line kind flushes first so each event has one kind. After `maxEvents` (150)
 * events, a single "suppressed" event is emitted and everything else is dropped.
 * Call `flush()` when the run ends.
 */
export class LogThrottler {
  private readonly intervalMs: number;
  private readonly maxLines: number;
  private readonly maxEvents: number;
  private buffer: { line: string; meta: LogLineMeta }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private emitted = 0;
  private suppressed = false;

  constructor(
    private readonly emit: LogEmitter,
    options: LogThrottlerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 2000;
    this.maxLines = options.maxLines ?? 10;
    this.maxEvents = options.maxEvents ?? 150;
  }

  /** Number of events emitted so far, including the suppression notice. */
  get eventCount(): number {
    return this.emitted + (this.suppressed ? 1 : 0);
  }

  push(line: string, meta: LogLineMeta): void {
    if (this.suppressed) return;
    const first = this.buffer[0];
    if (first && first.meta.kind !== meta.kind) this.flush();
    if (this.suppressed) return;
    this.buffer.push({ line, meta });
    if (this.buffer.length >= this.maxLines) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.intervalMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const lines = this.buffer;
    this.buffer = [];
    if (this.suppressed) return;

    if (this.emitted >= this.maxEvents) {
      this.suppressed = true;
      this.safeEmit(SUPPRESSED_MESSAGE, { kind: 'text', count: lines.length });
      return;
    }

    const tools = new Set(lines.map((l) => l.meta.tool).filter((t): t is string => !!t));
    const meta: AgentLogMeta = { kind: lines[0]!.meta.kind, count: lines.length };
    if (tools.size === 1) meta.tool = [...tools][0];
    this.emitted++;
    this.safeEmit(lines.map((l) => l.line).join('\n'), meta);
  }

  private safeEmit(body: string, meta: AgentLogMeta): void {
    try {
      const result = this.emit(body, meta);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Logging must never break a run.
    }
  }
}
