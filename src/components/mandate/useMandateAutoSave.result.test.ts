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
 *   | { ok: false; reason: 'validation'|'auth'|'throttled'|'network'|'server';
 *       message: string; retryAfter?: number }
 *
 * All existing `void save(...)` call sites are unaffected — they ignore the
 * result exactly as they did with Promise<void>.
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
