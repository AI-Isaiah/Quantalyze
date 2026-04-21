/**
 * Phase 08 Plan 03 — useNoteAutoSave.test.ts
 *
 * Six assertions covering:
 *   1. Happy path — transitions idle→saving→saved; 2s auto-fade to idle.
 *   2. 4xx — no retry; ends in error; fetch called exactly once.
 *   3. 5xx — retries once after 2s; ends in saved.
 *   4. 5xx exhausted — 2 calls, ends in error.
 *   5. Rapid-blur race — stale response from first save does NOT mutate state.
 *   6. does NOT flush on unmount — pins the S2 fire-and-forget exit contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useNoteAutoSave } from "./useNoteAutoSave";

type FetchMock = ReturnType<typeof vi.fn>;

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useNoteAutoSave", () => {
  let fetchSpy: FetchMock;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("happy path: PATCH body + idle→saving→saved; 2s auto-fade to idle", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { updated_at: "2026-04-21T00:00:00Z" }),
    );
    const { result } = renderHook(() =>
      useNoteAutoSave("portfolio", "abc"),
    );
    expect(result.current.saveState).toBe("idle");

    await act(async () => {
      await result.current.save("hello");
    });

    // Body shape assertion
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/notes");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      scope_kind: "portfolio",
      scope_ref: "abc",
      content: "hello",
    });
    expect(result.current.saveState).toBe("saved");
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);

    // Advance 2s — "saved" flash fades back to "idle"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.saveState).toBe("idle");
  });

  it("4xx: no retry; ends in error; fetch called exactly once", async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(400, { error: "Bad" }));

    const { result } = renderHook(() =>
      useNoteAutoSave("portfolio", "abc"),
    );

    await act(async () => {
      await result.current.save("oops");
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe("error");
  });

  it("5xx: retries once after 2s; ends in saved", async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(200, { updated_at: "t" }));

    const { result } = renderHook(() =>
      useNoteAutoSave("portfolio", "abc"),
    );

    const pending = act(async () => {
      await result.current.save("retry-ok");
    });
    // Advance past the 2s backoff to let the retry run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await pending;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe("saved");
  });

  it("5xx retry exhausted: 2 fetch calls; ends in error", async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(500));

    const { result } = renderHook(() =>
      useNoteAutoSave("portfolio", "abc"),
    );

    const pending = act(async () => {
      await result.current.save("still-broken");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await pending;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe("error");
  });

  it("Rapid-blur race: stale first response does NOT overwrite second", async () => {
    // First save resolves slow with 200; second save fires immediately and
    // resolves fast with 200. After both settle, state reflects the second
    // save's generation (the first's state update was dropped by the guard).
    let resolveFirst!: (r: Response) => void;
    const firstPromise = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    let resolveSecond!: (r: Response) => void;
    const secondPromise = new Promise<Response>((r) => {
      resolveSecond = r;
    });

    fetchSpy
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    const { result } = renderHook(() =>
      useNoteAutoSave("portfolio", "abc"),
    );

    // Fire both saves without awaiting either yet.
    let firstDone: Promise<void> | null = null;
    let secondDone: Promise<void> | null = null;
    await act(async () => {
      firstDone = result.current.save("a");
      secondDone = result.current.save("b");
    });

    // Resolve the SECOND save first (it wins — its generation is current).
    await act(async () => {
      resolveSecond(makeResponse(200, { updated_at: "second" }));
      await secondDone;
    });
    const afterSecond = result.current.saveState;
    const lastSavedAfterSecond = result.current.lastSavedAt;
    expect(afterSecond).toBe("saved");
    expect(lastSavedAfterSecond).toBeInstanceOf(Date);

    // Now resolve the FIRST save — its response must be dropped (stale gen).
    await act(async () => {
      resolveFirst(makeResponse(200, { updated_at: "first" }));
      await firstDone;
    });

    // State must NOT regress — the stale response does not bump lastSavedAt.
    expect(result.current.saveState).toBe("saved");
    // The lastSavedAt reference from the 2nd save must still be the same Date
    // instance (stale 1st save's setLastSavedAt was guarded out).
    expect(result.current.lastSavedAt).toBe(lastSavedAfterSecond);
  });

  it("does NOT flush on unmount — fire-and-forget exit contract (S2)", async () => {
    // Mount hook, do NOT call save(), unmount. Expect zero fetch calls.
    const { unmount } = renderHook(() =>
      useNoteAutoSave("portfolio", "abc"),
    );
    unmount();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
