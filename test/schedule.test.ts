// One run at a time for a stream of requests: a request while one runs queues
// exactly one more, starts are spaced by the throttle, and stop drops what is
// queued.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "../src/schedule";

describe("createScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const deferred = () => {
    let resolve = () => undefined as void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("runs once per burst of requests", async () => {
    const run = vi.fn(async () => undefined);
    const s = createScheduler(run, 150);
    s.request();
    s.request();
    s.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("queues exactly one more run while one is in flight, spaced by the throttle", async () => {
    const first = deferred();
    const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const s = createScheduler(run, 150);
    s.request();
    await vi.advanceTimersByTimeAsync(0);
    s.request();
    s.request();
    first.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps going after a failed run", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("lost context")).mockResolvedValue(undefined);
    const s = createScheduler(run, 0);
    s.request();
    await vi.advanceTimersByTimeAsync(0);
    s.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops a pending start on stop", async () => {
    const run = vi.fn(async () => undefined);
    const s = createScheduler(run, 150);
    s.request();
    await vi.advanceTimersByTimeAsync(0);
    s.request();
    s.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("drops the queued run when stopped while one is in flight", async () => {
    const first = deferred();
    const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const s = createScheduler(run, 150);
    s.request();
    await vi.advanceTimersByTimeAsync(0);
    s.request();
    s.stop();
    first.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
