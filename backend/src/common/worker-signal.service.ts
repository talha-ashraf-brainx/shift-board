import { Injectable } from '@nestjs/common';

/**
 * Wakes the worker loop early. Call `wake()` whenever a ticket becomes
 * claimable (created, requeued) or the worker settings change; the worker
 * sleeps with `waitForWake(ms)` between polls.
 */
@Injectable()
export class WorkerSignal {
  private waiters: Array<() => void> = [];
  private pending = false;

  wake(): void {
    if (this.waiters.length === 0) {
      // Nobody is sleeping right now; make the next wait return immediately.
      this.pending = true;
      return;
    }
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Resolves after `ms`, or earlier when `wake()` is called. */
  waitForWake(ms: number): Promise<void> {
    if (this.pending) {
      this.pending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.push(done);
    });
  }
}
