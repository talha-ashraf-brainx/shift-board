import { Injectable } from '@nestjs/common';

interface ActiveRun {
  ticketId: string;
  ticketNumber: number;
  controller: AbortController;
  cancelRequested: boolean;
  finished: Promise<void>;
  markFinished: () => void;
}

export interface RunHandle {
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  /** True when the run was aborted because a human cancelled the ticket. */
  isCancelRequested(): boolean;
  /** Must be called exactly once when the run has fully unwound (use `finally`). */
  finish(): void;
}

/**
 * Tracks agent runs in progress so Cancel and shutdown can abort them.
 * The worker registers each run; TicketsService.cancel() calls `abort()`.
 */
@Injectable()
export class RunRegistry {
  private readonly runs = new Map<string, ActiveRun>();

  register(ticketId: string, ticketNumber: number): RunHandle {
    if (this.runs.has(ticketId)) throw new Error(`Ticket ${ticketId} already has an active run`);
    const controller = new AbortController();
    let markFinished!: () => void;
    const finished = new Promise<void>((resolve) => (markFinished = resolve));
    const run: ActiveRun = { ticketId, ticketNumber, controller, cancelRequested: false, finished, markFinished };
    this.runs.set(ticketId, run);
    return {
      signal: controller.signal,
      controller,
      isCancelRequested: () => run.cancelRequested,
      finish: () => {
        if (this.runs.get(ticketId) === run) this.runs.delete(ticketId);
        run.markFinished();
      },
    };
  }

  isRunning(ticketId: string): boolean {
    return this.runs.has(ticketId);
  }

  /** Every active run, oldest first. */
  list(): { ticketId: string; ticketNumber: number }[] {
    return [...this.runs.values()].map((r) => ({ ticketId: r.ticketId, ticketNumber: r.ticketNumber }));
  }

  /** The run shown in the status pill (first active run), or null. */
  current(): { ticketId: string; ticketNumber: number } | null {
    const first = this.runs.values().next();
    return first.done ? null : { ticketId: first.value.ticketId, ticketNumber: first.value.ticketNumber };
  }

  size(): number {
    return this.runs.size;
  }

  /**
   * Cancel: abort the ticket's run and wait (up to `timeoutMs`) for it to unwind.
   * Returns false when no run was active.
   */
  async abort(ticketId: string, timeoutMs = 30_000): Promise<boolean> {
    const run = this.runs.get(ticketId);
    if (!run) return false;
    run.cancelRequested = true;
    run.controller.abort();
    await raceTimeout(run.finished, timeoutMs);
    return true;
  }

  /** Shutdown: abort every run without marking it cancelled (crash recovery requeues it). */
  async abortAll(timeoutMs = 10_000): Promise<void> {
    const runs = [...this.runs.values()];
    for (const run of runs) run.controller.abort();
    await raceTimeout(Promise.all(runs.map((r) => r.finished)), timeoutMs);
  }
}

/** Resolves when `promise` settles or after `ms`, whichever is first; never keeps the process alive. */
async function raceTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref();
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
