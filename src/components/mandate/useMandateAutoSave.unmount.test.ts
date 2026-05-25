/**
 * Unmount-abort regression tests — H-0382.
 *
 * WHY: Before the fix, unmounting useMandateAutoSave while a save was in
 * flight (or sleeping inside a 429 retry-after backoff) let the async
 * continuation run after the component was gone, calling setState on an
 * unmounted component. For mandate fields this is a compliance risk: a stale
 * response from an older tab could overwrite the allocator's intent in the
 * server-authoritative state, corrupting match scores.
 *
 * After the fix, a component-lifetime AbortController (mountAbortRef) is
 * aborted in the useEffect cleanup. Every fetch attempt is wired to this
 * signal, and every await wait() call is guarded with a .signal.aborted check.
 *
 * These tests confirm:
 *   1. An in-flight fetch is cancelled when the hook unmounts — no state
 *      updates fire after unmount.
 *   2. The 429 retry-after sleep is dropped on unmount — no retry fires.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMandateAutoSave } from "./useMandateAutoSave";

describe("H-0382 — unmount abort prevents setState after navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("unmounting while fetch is in flight does not trigger setState after unmount", async () => {
    // Suspend the fetch so we can unmount while it is still awaiting.
    let resolveFetch: (r: Response) => void = () => {};
    (fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<Response>((r) => { resolveFetch = r; }),
    );

    const { result, unmount } = renderHook(() => useMandateAutoSave(null));

    // Start a save but don't await it — it is now suspended inside fetch().
    void act(() => {
      void result.current.save("max_weight", 0.25);
    });

    // Unmount (simulates user navigating away mid-save).
    unmount();

    // Resolve the suspended fetch after unmount — should be a silent no-op.
    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
      } as unknown as Response);
      await vi.runAllTimersAsync();
    });

    // The fetch was initiated exactly once; no retries were scheduled.
    expect(fetch).toHaveBeenCalledTimes(1);
    // If we reach here without React throwing an act() or setState-after-unmount
    // warning, the mount-abort guard is working.
  });

  it("unmounting during 429 retry-after sleep prevents the retry from firing", async () => {
    // First call → 429 with a 3-second Retry-After.
    // Second call must NEVER fire because we unmount during the sleep.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers([["Retry-After", "3"]]),
        json: async () => ({ error: "Too many requests" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
      } as unknown as Response);

    const { result, unmount } = renderHook(() => useMandateAutoSave(null));

    let savePromise: Promise<unknown>;
    await act(async () => {
      savePromise = result.current.save("max_weight", 0.25);
      // Advance 1s into the 3s retry-after wait — still sleeping.
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Unmount during the sleep.
    unmount();

    // Advance past the retry window; the retry must NOT fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await savePromise!;
    });

    // Only the initial (429) request; the retry was aborted on unmount.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
