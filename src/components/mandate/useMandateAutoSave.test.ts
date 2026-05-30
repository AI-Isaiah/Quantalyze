import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMandateAutoSave } from "./useMandateAutoSave";

// M-2 (red-team): hoist module-level mock so captureToSentry calls are
// observable. Existing tests do NOT assert on Sentry, so this is additive-safe.
const sentryCalls: Array<{ err: unknown; options: { level?: string } }> = [];
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, options: { level?: string }) => {
    sentryCalls.push({ err, options });
  },
}));

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

function errorResponse(
  status: number,
  body: unknown,
  retryAfter?: string,
  dateHeader?: string,
): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set("Retry-After", retryAfter);
  // Optional Date header — the base the HTTP-date Retry-After form resolves
  // against (server clock). Needed to exercise the date-delta parse path.
  if (dateHeader !== undefined) headers.set("Date", dateHeader);
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

  it("NEW-C05-06: a 12s per-attempt TIMEOUT is terminal and does NOT retry the non-idempotent write", async () => {
    // WHY: the timeout aborts only the client wait, not the server write —
    // update_allocator_mandates may still commit. Retrying re-issues the same
    // non-idempotent write, so a stale attempt-1 can overwrite a newer
    // attempt-2 value server-side. The hook must fail terminally on timeout
    // (reason 'timeout'), NOT loop. Pre-fix the catch retried every abort.
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        // Hang until the hook's 12s timer aborts the request.
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("The operation was aborted."), {
                name: "AbortError",
              }),
            );
          });
        }),
    );

    const { result } = renderHook(() => useMandateAutoSave(null));

    let res: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      // Fire the 12s per-attempt timeout → abort → fetch rejects (AbortError).
      await vi.advanceTimersByTimeAsync(12_000);
      res = await promise;
    });

    // No retry: the timed-out, possibly-committed write is NOT re-issued.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: false, reason: "timeout" });
    expect(result.current.saveState).toBe("error");
    // Field released so the spinner does not stick.
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

  // NEW-C05-01 regression: Retry-After as an HTTP-date string must not produce
  // NaN for retryAfterSec (Number("Mon, 26 May…") === NaN). The hook must
  // fall back to a finite seconds value (5s default) and still complete the
  // retry successfully without hanging forever or crashing.
  it("NEW-C05-01 Retry-After HTTP-date string falls back to 5s — retry succeeds, no NaN hang", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        errorResponse(429, { error: "Too many" }, "Mon, 26 May 2026 12:00:05 GMT"),
      )
      .mockResolvedValueOnce(okResponse());

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      // If NaN, wait(NaN * 1000) would never resolve — this would hang.
      // With the fix, the fallback is 5s.
      await vi.advanceTimersByTimeAsync(5000);
      await promise;
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe("saved");
    expect(result.current.fieldErrors.max_weight).toBeUndefined();
  });

  // B20 regression: an HTTP-date Retry-After in the PAST, WITH a Date header,
  // now resolves to the 5s default (parseRetryAfterSeconds returns null for a
  // non-positive delta → `?? 5`). Pre-B20 the inline `Math.max(1, Math.ceil(...))`
  // floored a past-date delta to 1s. This pins the new 5s value THROUGH the hook
  // (the primitive-level past-date→null is unit-tested separately); a revert to
  // the old 1s floor would fire the retry at 1000ms and fail the mid-wait assert.
  it("B20 past HTTP-date Retry-After (with Date header) waits the 5s default, not 1s", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        errorResponse(
          429,
          { error: "Too many" },
          "Wed, 21 Oct 2026 07:28:00 GMT", // Retry-After: 10s in the PAST
          "Wed, 21 Oct 2026 07:28:10 GMT", // Date (server clock) base
        ),
      )
      .mockResolvedValueOnce(okResponse());

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      // At 1s the retry must NOT have fired — the old 1s floor would already
      // show fetch #2 here; the new 5s default keeps it at a single call.
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetch).toHaveBeenCalledTimes(1);
      // Cross the 5s boundary — the retry now fires and succeeds.
      await vi.advanceTimersByTimeAsync(4000);
      await promise;
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe("saved");
  });

  // NEW-C05-03 regression: a concurrent save() that bumps the generation
  // while the first save() is sleeping in the 429 retry window must NOT see
  // its stale error message painted over after the second save succeeds.
  it("NEW-C05-03 stale-gen 429-error is not written when generation has been superseded", async () => {
    // first save gets 429, second save gets 200 immediately
    let resolveFirst: (res: Response) => void = () => {};
    const firstFetch = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    (fetch as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstFetch)  // first save -> 429 (resolved later)
      .mockResolvedValueOnce(okResponse()); // second save -> 200

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      // Start first save; don't await yet.
      const p1 = result.current.save("max_weight", 0.25);
      // Start second save immediately — bumps generation; resolves via its own fetch.
      const p2 = result.current.save("max_weight", 0.30);
      await p2;
      // Now resolve first fetch as 429; it must detect stale gen and skip writing error.
      resolveFirst(errorResponse(429, { error: "Too many" }, "1"));
      await p1;
    });

    // The second save succeeded — no error should be visible.
    expect(result.current.saveState).toBe("saved");
    expect(result.current.fieldErrors.max_weight).toBeUndefined();
  });

  // NEW-C05-05 regression: when a field save completes and sets saveState="saved",
  // the 2s fade-timer must NOT flip to "idle" if another field is still in-flight.
  // The savingFieldsSizeRef gate prevents a fast-finishing field from prematurely
  // moving the form-level status to idle. This test verifies the gate by ensuring
  // that after A finishes, starts the idle timer, and the timer fires, the hook
  // stays "saving" until B also completes.
  //
  // Strategy: start A, let it finish (saved), advance the 2s timer — hook must
  // stay in "saving" because B was started before advancing. Then finish B and
  // confirm the final state is "saved".
  it("NEW-C05-05 idle-gate: saved->idle transition is blocked while a second field is still saving", async () => {
    let resolveB: (res: Response) => void = () => {};
    const bFetch = new Promise<Response>((r) => {
      resolveB = r;
    });
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(okResponse()) // field A -> immediate success
      .mockReturnValueOnce(bFetch);         // field B -> pending until resolveB()

    const { result } = renderHook(() => useMandateAutoSave(null));

    // Step 1: save A and let it complete.
    await act(async () => {
      await result.current.save("max_weight", 0.25);
    });
    // A is done; saveState="saved"; A released from savingFields.
    expect(result.current.saveState).toBe("saved");
    expect(result.current.savingFields.has("max_weight")).toBe(false);

    // Step 2: start B's save (still pending).
    let pB: ReturnType<typeof result.current.save> | undefined;
    await act(async () => {
      pB = result.current.save("max_drawdown_tolerance", 0.05);
    });
    expect(result.current.savingFields.has("max_drawdown_tolerance")).toBe(true);
    // saveState must be "saving" again because B is in-flight.
    expect(result.current.saveState).toBe("saving");

    // Step 3: save A again so saveState goes back to "saved" from A's second
    // completion, kicking off a new 2s idle timer while B is still in-flight.
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okResponse()); // A second -> immediate
    await act(async () => {
      await result.current.save("max_weight", 0.30);
    });
    expect(result.current.saveState).toBe("saved");
    expect(result.current.savingFields.has("max_drawdown_tolerance")).toBe(true); // B still pending

    // Step 4: advance past the 2s fade timer. With the gate, "saved" must NOT
    // revert to "idle" because savingFieldsSizeRef.current > 0 (B still in-flight).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    // B still in-flight → gate blocked the "saved"->"idle" transition.
    // The state must NOT be "idle" — it should remain "saved" (the timer ran
    // but was blocked by the gate). This is the key invariant: no premature idle.
    expect(result.current.saveState).not.toBe("idle");

    // Step 5: finish B; hook should return to "saved".
    await act(async () => {
      resolveB(okResponse());
      await pB;
    });
    expect(result.current.savingFields.size).toBe(0);
    expect(result.current.saveState).toBe("saved");
  });

  // NEW-C05-07 regression: when field A receives a 429, field B (starting
  // shortly after) must also wait out the shared rate-limit window before
  // sending its first fetch, preventing the thundering-herd re-trip.
  it("NEW-C05-07 cross-field 429 gate: concurrent field respects rateLimitedUntilRef", async () => {
    // Field A gets 429 with Retry-After: 2; field B starts concurrently.
    // Field A's retry and field B's first attempt should both be delayed by ~2s.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse(429, { error: "Too many" }, "2")) // A first attempt
      .mockResolvedValueOnce(okResponse()) // B first attempt (after gate)
      .mockResolvedValueOnce(okResponse()); // A retry

    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      const pA = result.current.save("max_weight", 0.25);
      const pB = result.current.save("max_drawdown_tolerance", 0.05);
      // Advance past the 2s gate — both A's retry and B's first attempt fire.
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.all([pA, pB]);
    });

    // Field A and B both saved successfully.
    expect(result.current.saveState).toBe("saved");
    expect(result.current.fieldErrors.max_weight).toBeUndefined();
    expect(result.current.fieldErrors.max_drawdown_tolerance).toBeUndefined();
  });
});

// ===========================================================================
// M-2 (red-team) — failTerminal Sentry level for expected client errors
//
// Before: failTerminal always called captureToSentry with level:"error",
// meaning 400 (validation) and 401 (auth/session-expired) produced error-level
// Sentry events — normal user-side outcomes that inflate the error budget and
// mask genuine server failures.
// After: 400 and 401 call sites pass sentryLevel:"warning" so they are
// captured at warning severity. The 5xx exhaustion path still uses "error".
// ===========================================================================
describe("M-2 (red-team) — failTerminal Sentry level for 400/401 vs 5xx", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
    // Clear the shared collector between tests.
    sentryCalls.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("400 validation error captures Sentry at level:warning (not error)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse(400, { error: "max_weight must be between 0.05 and 0.50" }),
    );
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      await result.current.save("max_weight", 0.99);
    });

    expect(result.current.saveState).toBe("error");
    // M-2: the Sentry capture for a 400 must use level:"warning".
    const matchingCalls = sentryCalls.filter(
      (c) => c.options.level === "warning",
    );
    expect(matchingCalls.length).toBeGreaterThan(0);
    // Sanity: must NOT have emitted an "error"-level event for this 400.
    const errorCalls = sentryCalls.filter((c) => c.options.level === "error");
    expect(errorCalls.length).toBe(0);
  });

  it("401 auth error captures Sentry at level:warning (not error)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse(401, { error: "Session expired" }),
    );
    const { result } = renderHook(() => useMandateAutoSave(null));

    await act(async () => {
      await result.current.save("max_weight", 0.25);
    });

    expect(result.current.saveState).toBe("error");
    const matchingCalls = sentryCalls.filter(
      (c) => c.options.level === "warning",
    );
    expect(matchingCalls.length).toBeGreaterThan(0);
    const errorCalls = sentryCalls.filter((c) => c.options.level === "error");
    expect(errorCalls.length).toBe(0);
  });

  it("5xx exhaustion still captures Sentry at level:error", async () => {
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

    expect(result.current.saveState).toBe("error");
    // 5xx exhaustion must still fire at level:"error".
    const errorCalls = sentryCalls.filter((c) => c.options.level === "error");
    expect(errorCalls.length).toBeGreaterThan(0);
  });
});
