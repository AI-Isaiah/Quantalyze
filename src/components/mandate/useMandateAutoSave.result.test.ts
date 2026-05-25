/**
 * SaveResult discriminated-return tests — M-1115.
 *
 * WHY: Before the fix, save() returned Promise<void>. Every error mode —
 * 400 validation, 401 auth, 429 throttled, 5xx server, network exhausted —
 * resolved to void after stashing the result in hook state. Callers that
 * wanted to `await save(); if-error then close-dialog` had to subscribe to
 * saveState/fieldErrors instead, making the hook untestable for
 * throttle-then-success paths (the promise resolved before the retry finished).
 *
 * After the fix, save() returns Promise<SaveResult>:
 *   | { ok: true;  savedAt: Date }
 *   | { ok: false; reason: 'validation'|'auth'|'throttled'|'network'|'server'
 *                        |'superseded'|'cancelled';
 *       message: string; retryAfter?: number }
 *
 * `superseded` (a newer save bumped the generation) and `cancelled` (unmount)
 * are benign no-ops, distinct from genuine failures. All existing
 * `void save(...)` call sites are unaffected — they ignore the result.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMandateAutoSave } from "./useMandateAutoSave";
import type { SaveResult } from "./useMandateAutoSave";

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ success: true }),
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

describe("M-1115 — save() returns SaveResult", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("successful save resolves {ok:true, savedAt:Date}", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okResponse());
    const { result } = renderHook(() => useMandateAutoSave(null));

    let saveResult!: SaveResult;
    await act(async () => {
      saveResult = await result.current.save("max_weight", 0.25);
    });

    expect(saveResult.ok).toBe(true);
    if (saveResult.ok) {
      expect(saveResult.savedAt).toBeInstanceOf(Date);
    }
  });

  it("400 validation error resolves {ok:false, reason:'validation'}", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse(400, { error: "max_weight must be between 0.05 and 0.50" }),
    );
    const { result } = renderHook(() => useMandateAutoSave(null));

    let saveResult!: SaveResult;
    await act(async () => {
      saveResult = await result.current.save("max_weight", 0.99);
    });

    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.reason).toBe("validation");
      expect(saveResult.message).toContain("max_weight");
    }
  });

  it("401 resolves {ok:false, reason:'auth'}", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      errorResponse(401, { error: "Not authenticated" }),
    );
    const { result } = renderHook(() => useMandateAutoSave(null));

    let saveResult!: SaveResult;
    await act(async () => {
      saveResult = await result.current.save("mandate_archetype", "test");
    });

    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.reason).toBe("auth");
    }
  });

  it("429 followed by success resolves {ok:true} (retry path)", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse(429, { error: "Too many requests" }, "1"))
      .mockResolvedValueOnce(okResponse());

    const { result } = renderHook(() => useMandateAutoSave(null));

    let saveResult!: SaveResult;
    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      await vi.advanceTimersByTimeAsync(1000);
      saveResult = await promise;
    });

    expect(saveResult.ok).toBe(true);
  });

  it("5xx exhausted resolves {ok:false, reason:'server'}", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse(500, {}))
      .mockResolvedValueOnce(errorResponse(500, {}))
      .mockResolvedValueOnce(errorResponse(500, {}))
      .mockResolvedValueOnce(errorResponse(500, {}));

    const { result } = renderHook(() => useMandateAutoSave(null));

    let saveResult!: SaveResult;
    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      saveResult = await promise;
    });

    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.reason).toBe("server");
    }
  });

  it("429 budget-exhausted resolves {ok:false, reason:'throttled'} and clears the spinner", async () => {
    // MAX_ATTEMPTS (4) consecutive 429s: the hook must terminate cleanly rather
    // than fall through the loop and leave the field pinned in savingFields with
    // a message promising a retry that never runs (the 429-leak contract).
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(errorResponse(429, { error: "rate" }, "1"))
      .mockResolvedValueOnce(errorResponse(429, { error: "rate" }, "1"))
      .mockResolvedValueOnce(errorResponse(429, { error: "rate" }, "1"))
      .mockResolvedValueOnce(errorResponse(429, { error: "rate" }, "1"));

    const { result } = renderHook(() => useMandateAutoSave(null));

    let saveResult!: SaveResult;
    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      saveResult = await promise;
    });

    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.reason).toBe("throttled");
    }
    // No stuck spinner after a terminal outcome.
    expect(result.current.savingFields.has("max_weight")).toBe(false);
  });

  it("network failure exhausted resolves {ok:false, reason:'network'}", async () => {
    // Every attempt throws a (non-abort) network error → terminal network failure
    // after the retry budget, NOT a 'cancelled'/'superseded' benign no-op.
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("fetch failed"),
    );

    const { result } = renderHook(() => useMandateAutoSave(null));

    let saveResult!: SaveResult;
    await act(async () => {
      const promise = result.current.save("max_weight", 0.25);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      saveResult = await promise;
    });

    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.reason).toBe("network");
      expect(saveResult.message).toBe("Couldn't save.");
    }
  });

  it("a save superseded by a newer save for the same field resolves {ok:false, reason:'superseded'}", async () => {
    // First save hangs in fetch; a second save() for the same field bumps the
    // generation. When the first response finally arrives it is dropped as stale
    // (reason 'superseded') WITHOUT clobbering the newer save's success state.
    let resolveFirst!: (r: Response) => void;
    (fetch as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolveFirst = r;
        }),
      )
      .mockResolvedValueOnce(okResponse());

    const { result } = renderHook(() => useMandateAutoSave(null));

    let firstResult!: SaveResult;
    let secondResult!: SaveResult;
    await act(async () => {
      const first = result.current.save("max_weight", 0.25);
      const second = result.current.save("max_weight", 0.3); // bumps generation
      secondResult = await second;
      resolveFirst(okResponse()); // release the now-stale first response
      firstResult = await first;
      await vi.runAllTimersAsync();
    });

    expect(secondResult.ok).toBe(true);
    expect(firstResult.ok).toBe(false);
    if (!firstResult.ok) {
      expect(firstResult.reason).toBe("superseded");
    }
  });

  it("SaveResult type is exported and usable as discriminated union", () => {
    // Compile-time check: both branches are reachable via narrowing.
    const check = (r: SaveResult) => {
      if (r.ok) {
        return r.savedAt.toISOString();
      } else {
        return `${r.reason}: ${r.message}`;
      }
    };
    // Runtime: exercise both branches.
    const ok: SaveResult = { ok: true, savedAt: new Date() };
    const fail: SaveResult = { ok: false, reason: "validation", message: "bad" };
    expect(check(ok)).toContain("T");
    expect(check(fail)).toBe("validation: bad");
  });
});
