import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMandateAutoSave } from "./useMandateAutoSave";

/**
 * Phase 2 — useMandateAutoSave unit tests.
 *
 * @testing-library/react v16.3.2 is already installed (package.json).
 * All cases run unconditionally — no "if installed" fallback, no deferral
 * to Playwright for 429/5xx retry coverage.
 */

function okResponse(body: unknown = { success: true }): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown, retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set("Retry-After", retryAfter);
  return {
    ok: false,
    status,
    headers,
    json: async () => body,
  } as unknown as Response;
}

describe("useMandateAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("TC1 happy save sets saveState=saved + lastSavedAt + fetches PUT /api/preferences", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okResponse());
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      await result.current.save("max_weight", 0.25);
    });

    expect(result.current.saveState).toBe("saved");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ max_weight: 0.25 }),
      }),
    );
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
    expect(result.current.fieldErrors.max_weight).toBeUndefined();
  });

  it("TC2 'saved' auto-reverts to 'idle' after 2s", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okResponse());
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      await result.current.save("max_weight", 0.25);
    });
    expect(result.current.saveState).toBe("saved");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.saveState).toBe("idle");
  });

  it("TC3 null Reset sends { [field]: null }", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okResponse());
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      await result.current.save("max_weight", null);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ max_weight: null }),
      }),
    );
    expect(result.current.saveState).toBe("saved");
  });

  it("TC4 400 validation error populates fieldErrors + saveState=error + keeps lastSavedAt unchanged", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse(400, { error: "max_weight must be between 0.05 and 0.50" }),
    );
    const initialDate = new Date("2026-04-01T00:00:00Z");
    const { result } = renderHook(() => useMandateAutoSave(initialDate));

    await act(async () => {
      await result.current.save("max_weight", 0.99);
    });

    expect(result.current.saveState).toBe("error");
    expect(result.current.fieldErrors.max_weight).toBe(
      "max_weight must be between 0.05 and 0.50. Try again.",
    );
    expect(result.current.lastSavedAt?.getTime()).toBe(initialDate.getTime());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("TC5 429 rate-limit schedules retry after Retry-After seconds, then succeeds on retry", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse(429, { error: "Too many requests" }, "1"))
      .mockResolvedValueOnce(okResponse());

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      // Advance past the 1-second Retry-After wait.
      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    });

    // After the retry succeeds, fieldErrors should be cleared and saveState=saved.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe("saved");
    // WR-01 regression: stale "Saving too fast. Will retry in Ns." must be cleared
    // when the retried save succeeds.
    expect(result.current.fieldErrors.max_weight).toBeUndefined();
  });

  it("TC6 5xx with exponential backoff — 3x 500 then 200 succeeds", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse(500, { error: "internal" }))
      .mockResolvedValueOnce(errorResponse(500, { error: "internal" }))
      .mockResolvedValueOnce(errorResponse(500, { error: "internal" }))
      .mockResolvedValueOnce(okResponse());

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      // Advance through 1s + 2s + 4s exponential backoff = 7s total.
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      await promise;
    });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.current.saveState).toBe("saved");
    expect(result.current.fieldErrors.max_weight).toBeUndefined();
  });

  it("TC6b 5xx all attempts exhaust → saveState=error with 'Couldn't save.'", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse(500, { error: "internal" }))
      .mockResolvedValueOnce(errorResponse(500, { error: "internal" }))
      .mockResolvedValueOnce(errorResponse(500, { error: "internal" }))
      .mockResolvedValueOnce(errorResponse(500, { error: "internal" }));

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      await promise;
    });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.current.saveState).toBe("error");
    expect(result.current.fieldErrors.max_weight).toBe("Couldn't save.");
  });

  it("TC6c 429 on every attempt exhausts the budget → terminal error, field released (no stuck spinner)", async () => {
    // Regression for the 429 fall-through: previously the loop exited via the
    // unconditional `continue`, leaving the field pinned in savingFields and a
    // message falsely promising a retry that would never run.
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse(429, { error: "Too many requests" }, "1"),
    );

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      // Three 1s Retry-After waits precede the 4th, budget-exhausting attempt.
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.current.saveState).toBe("error");
    // Terminal message must NOT promise a retry.
    expect(result.current.fieldErrors.max_weight).toBe(
      "Saving too fast. Please wait a moment and try again.",
    );
    // The field must be released from the in-flight set.
    expect(result.current.savingFields.has("max_weight")).toBe(false);
  });

  it("TC7 concurrent saves: second save wins, first stale response is dropped", async () => {
    // First save's response resolves after the second save's.
    let resolveFirst: (res: Response) => void = () => {};
    const firstResponse = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    (fetch as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(okResponse());

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      // Kick off the first save but do NOT await it yet.
      const firstPromise = result.current.save("max_weight", 0.25);
      // Immediately start the second save; this bumps the generation ref
      // so the first response will be discarded.
      const secondPromise = result.current.save("max_weight", 0.30);
      await secondPromise;
      // Now resolve the first save's response; it should be silently dropped.
      resolveFirst(okResponse());
      await firstPromise;
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    // Most recent call should reflect value 0.30.
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const latestBody = calls[calls.length - 1][1].body;
    expect(latestBody).toBe(JSON.stringify({ max_weight: 0.30 }));
    // After both resolve, saveState should be "saved" from the second call.
    expect(result.current.saveState).toBe("saved");
  });

  it("TC8 lastSavedAt initialised from initialLastSavedAt on first render", () => {
    const seed = new Date("2026-04-18T10:00:00Z");
    const { result } = renderHook(() => useMandateAutoSave(seed));
    expect(result.current.lastSavedAt?.getTime()).toBe(seed.getTime());
  });
});
