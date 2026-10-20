// One run at a time for a stream of requests: a request while one runs queues
// exactly one more, and starts are spaced by `throttleMs`. A run that fails
// counts as finished. Stopping drops the queue and a pending start; a run
// already going finishes, and its caller ignores the result.

export interface Scheduler {
  request(): void;
  stop(): void;
}

export function createScheduler(run: () => Promise<void>, throttleMs: number): Scheduler {
  let stopped = false;
  let inFlight = false;
  let queued = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;

  const start = () => {
    timer = null;
    if (stopped) return;
    inFlight = true;
    lastStart = Date.now();
    run()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (queued && !stopped) {
          queued = false;
          request();
        }
      });
  };

  const request = () => {
    if (stopped) return;
    if (inFlight) {
      queued = true;
      return;
    }
    if (timer !== null) return;
    timer = setTimeout(start, Math.max(0, throttleMs - (Date.now() - lastStart)));
  };

  return {
    request,
    stop() {
      stopped = true;
      queued = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
