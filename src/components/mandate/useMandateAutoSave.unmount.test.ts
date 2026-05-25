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
import type { SaveResult } from "./useMandateAutoSave";

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

  it("unmounting while a fetch is in flight aborts it and resolves {ok:false, reason:'cancelled'}", async () => {
    // A SIGNAL-RESPECTING fetch: rejects with an AbortError when the per-attempt
    // controller (wired to mountAbortRef) aborts on unmount. The previous version
    // resolved {ok:true}, silently driving the SUCCESS path so the catch-block
    // abort guard was never exercised (mutation-confirmed: deleting the guard
    // left the old test green). This version drives the real aborted-fetch path.
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const { result, unmount } = renderHook(() => useMandateAutoSave(null));

    let savePromise!: Promise<SaveResult>;
    void act(() => {
      savePromise = result.current.save("max_weight", 0.25);
    });

    // Navigate away mid-save → mountAbortRef aborts → the fetch rejects AbortError.
    unmount();

    let saveResult!: SaveResult;
    await act(async () => {
      saveResult = await savePromise;
      await vi.runAllTimersAsync();
    });

    // Exactly one fetch (no retry), and the hook reports the cancellation
    // explicitly rather than a spurious success or a generic network failure.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.reason).toBe("cancelled");
      expect(saveResult.message).toBe("Cancelled.");
    }
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
