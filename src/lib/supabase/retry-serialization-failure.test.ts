import { describe, it, expect, vi, afterEach } from "vitest";
import { retryOnceOnSerializationFailure } from "./retry-serialization-failure";

/**
 * Phase 164.6 (OPS-08-TS) — the single-retry policy for a lost enqueue race.
 *
 * Every assertion counts calls on the FACTORY. That is the unit that maps to a
 * database round-trip: a supabase-js builder is a thenable, so a helper that
 * re-awaited one would "retry" without sending a second request. Counting the
 * factory is what proves a real re-issue happened, and that it happened no
 * more than once.
 *
 * What each case protects:
 *   - 40001 then ok: the user gets the success, not an error, and the retry
 *     was logged (onRetry) with the FIRST result so the caller can say why.
 *   - 40001 twice: the budget is ONE retry. A third call would let one user
 *     request hammer a contended row; the second 40001 goes back to the caller
 *     so its existing failure path (curated copy, Sentry, 500) still runs.
 *   - any other code, or none: never retried. A 42501 retried is a permission
 *     denial asked twice; a PGRST301 retried is an expired JWT asked twice.
 *   - concurrency: the budget is per invocation. Module-level state would let
 *     one request spend another's retry.
 *   - no timer: the retry is immediate by design (the race's winner has
 *     already advanced), so a sleep would only add latency.
 */

type Result = { error: { code?: string | null; message?: string } | null; data?: string };

const RACE_LOST: Result = {
  error: { code: "40001", message: "enqueue race lost" },
};
const OK: Result = { error: null, data: "ok" };

describe("retryOnceOnSerializationFailure", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("40001 then ok → calls the factory twice, reports the first result to onRetry, returns the success", async () => {
    const call = vi.fn<() => Promise<Result>>();
    call.mockResolvedValueOnce(RACE_LOST).mockResolvedValueOnce(OK);
    const onRetry = vi.fn();

    const result = await retryOnceOnSerializationFailure(call, onRetry);

    expect(call, "a lost race must be re-issued exactly once").toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(RACE_LOST);
    expect(result).toBe(OK);
  });

  it("40001 twice → stops after the second call and returns the SECOND 40001 to the caller", async () => {
    const second: Result = { error: { code: "40001", message: "lost again" } };
    const call = vi.fn<() => Promise<Result>>();
    call.mockResolvedValueOnce(RACE_LOST).mockResolvedValueOnce(second).mockResolvedValue(OK);
    const onRetry = vi.fn();

    const result = await retryOnceOnSerializationFailure(call, onRetry);

    expect(
      call,
      "the retry budget is ONE — a third call would mean one request executes the RPC three times",
    ).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result).toBe(second);
  });

  it.each([
    ["42501 (permission denied)", { error: { code: "42501", message: "denied" } }],
    ["PGRST301 (JWT expired)", { error: { code: "PGRST301", message: "JWT expired" } }],
    ["a null code", { error: { code: null, message: "no code" } }],
    ["an error without a code", { error: { message: "no code field" } }],
    ["success", { error: null, data: "ok" }],
  ] as Array<[string, Result]>)("%s → one call, never retried", async (_label, only) => {
    const call = vi.fn<() => Promise<Result>>();
    call.mockResolvedValueOnce(only).mockResolvedValue(OK);
    const onRetry = vi.fn();

    const result = await retryOnceOnSerializationFailure(call, onRetry);

    expect(call, "only a 40001 may be retried").toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(result).toBe(only);
  });

  it("two concurrent invocations each get their own single-retry budget", async () => {
    const callA = vi.fn<() => Promise<Result>>();
    callA.mockResolvedValueOnce(RACE_LOST).mockResolvedValueOnce(OK);
    const callB = vi.fn<() => Promise<Result>>();
    callB.mockResolvedValueOnce(RACE_LOST).mockResolvedValueOnce(OK);

    const [a, b] = await Promise.all([
      retryOnceOnSerializationFailure(callA, vi.fn()),
      retryOnceOnSerializationFailure(callB, vi.fn()),
    ]);

    expect(callA, "invocation A lost its retry to invocation B — shared state").toHaveBeenCalledTimes(2);
    expect(callB, "invocation B lost its retry to invocation A — shared state").toHaveBeenCalledTimes(2);
    expect(a).toBe(OK);
    expect(b).toBe(OK);
  });

  it("retries immediately — resolves under fake timers without any timer being advanced", async () => {
    vi.useFakeTimers();
    const call = vi.fn<() => Promise<Result>>();
    call.mockResolvedValueOnce(RACE_LOST).mockResolvedValueOnce(OK);

    const result = await retryOnceOnSerializationFailure(call, vi.fn());

    expect(result).toBe(OK);
    expect(call).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount(), "the retry scheduled a timer — a sleep crept in").toBe(0);
  });
});
