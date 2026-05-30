import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { abortableWait } from "./wait";

describe("abortableWait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves after the full delay when never aborted", async () => {
    const c = new AbortController();
    let done = false;
    const p = abortableWait(1000, c.signal).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it("resolves immediately when the signal is already aborted", async () => {
    const c = new AbortController();
    c.abort();
    let done = false;
    const p = abortableWait(10_000, c.signal).then(() => {
      done = true;
    });
    // No timer advance — must resolve on its own.
    await p;
    expect(done).toBe(true);
  });

  it("resolves early when the signal aborts mid-wait (does not wait out the timer)", async () => {
    const c = new AbortController();
    let done = false;
    const p = abortableWait(10_000, c.signal).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    c.abort();
    await p;
    expect(done).toBe(true);
  });

  it("detaches its abort listener on a normal timer-fire (no listener leak across sleeps)", async () => {
    // Real timers (not the fake clock the other cases use) so the assertion
    // cannot race the fake-timer microtask flush under parallel-worker load.
    // The normal timer-fire path must call removeEventListener("abort", …) so
    // listeners don't accumulate on a long-lived signal across repeated sleeps.
    vi.useRealTimers();
    const c = new AbortController();
    const removeSpy = vi.spyOn(c.signal, "removeEventListener");
    await abortableWait(2, c.signal);
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
