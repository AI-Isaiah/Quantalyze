import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkStuckNotifications } from "./observability";

/**
 * OPS-06 (Phase 163) — checkStuckNotifications: "nothing stuck" is NOT
 * "could not tell".
 *
 * Before this phase the function returned `{ stuck: number }` and answered `0`
 * on BOTH a healthy queue and a failed read (`return { stuck: 0 }` in the error
 * branch, plus `count ?? 0` on the success path, which collapsed a null count
 * the same way). One value for two states means a caller can only either trust
 * a false zero or distrust every zero; neither is a monitor.
 *
 * The three cases below are the three arms, and the second one is the reason
 * `count ?? 0` is not a fix: a null count arrives with `error: null`, so the
 * error branch never sees it.
 *
 * ⭐ RED DEMO — each arm neutered separately, measured 2026-08-26, restored
 * after (recorded per-case below). The point of recording it: this contract
 * lives behind a function with no runtime caller at HEAD, so nothing but these
 * cases can notice if it silently reverts.
 */

/** Minimal PostgREST count-chain double: `.select(...).eq(...).lt(...)`
 *  resolves to whatever `answer` says. Shape-faithful to the real chain the
 *  function builds, so a query that stops matching it fails loudly here rather
 *  than resolving undefined. */
function makeSupabase(answer: {
  count: number | null;
  error: { message: string } | null;
}): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "notification_dispatches") {
        throw new Error(`unmocked table: ${table}`);
      }
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          // Pin the read as a server-side COUNT. A `head: false` read would
          // materialise rows and hit PostgREST's max_rows cap silently — the
          // truncation defect the flag-monitor denominator was rewritten for.
          expect(opts).toMatchObject({ count: "exact", head: true });
          return {
            eq: (col: string, val: string) => {
              expect([col, val]).toEqual(["status", "queued"]);
              return {
                lt: async (col2: string, _cutoff: string) => {
                  expect(col2).toBe("created_at");
                  return answer;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("[OPS-06] checkStuckNotifications distinguishes zero from unknown", () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErr.mockRestore();
  });

  /**
   * ⭐ RED DEMO: collapse the error arm back to the shipped-before value —
   *   `if (error) { ...; return { kind: "ok", stuck: 0 }; }`
   * Observed: this case FAILS on `expect(result.kind).toBe("indeterminate")`
   * (received "ok"). Restored: green.
   */
  it("a read ERROR answers indeterminate and carries the reason — never a zero", async () => {
    const supabase = makeSupabase({
      count: null,
      error: { message: "PGRST301: JWT expired" },
    });

    const result = await checkStuckNotifications(supabase);

    expect(result.kind).toBe("indeterminate");
    // The old shape is unreachable: there is no `stuck` to misread as healthy.
    expect(result).not.toHaveProperty("stuck");
    if (result.kind !== "indeterminate") throw new Error("unreachable");
    expect(result.error).toContain("PGRST301");
    expect(consoleErr).toHaveBeenCalled();
  });

  /**
   * ⭐ RED DEMO: replace the usable-count guard with the shipped-before
   *   `return { kind: "ok", stuck: count ?? 0 }`.
   * Observed: THREE cases fail — null, NaN and negative all come back
   * `kind: "ok"` (`expected 'ok' to be 'indeterminate'`). That spread is the
   * point: `?? 0` is not a partial fix, it is the same collapse on three paths
   * the error branch cannot see. Restored: green.
   */
  it("a NULL count with NO error is indeterminate too — `?? 0` would call it a healthy queue", async () => {
    // postgrest-js leaves `count` null when the content-range header does not
    // parse. `error` is null on that path, so the error branch never fires.
    const supabase = makeSupabase({ count: null, error: null });

    const result = await checkStuckNotifications(supabase);

    expect(result.kind).toBe("indeterminate");
    expect(result).not.toHaveProperty("stuck");
  });

  it("a NaN count is indeterminate — it is not `=== 0`, so no zero-check would catch it", async () => {
    // A `*/*` content-range yields NaN via parseInt. NaN passes every `?? 0`
    // guard and fails every comparison, so a threshold check against it is
    // false in both directions: the check disarms itself in silence.
    const supabase = makeSupabase({ count: Number.NaN, error: null });

    const result = await checkStuckNotifications(supabase);

    expect(result.kind).toBe("indeterminate");
  });

  it("a negative count is indeterminate — a count cannot be negative, so this is a broken read", async () => {
    const supabase = makeSupabase({ count: -1, error: null });
    expect((await checkStuckNotifications(supabase)).kind).toBe("indeterminate");
  });

  /**
   * ⭐ RED DEMO: make the success arm return `{ kind: "indeterminate", ... }`
   * unconditionally. Observed: this case and "a real backlog is ok:n" both
   * FAIL (`expected 'indeterminate' to be 'ok'`). Restored: green. Recorded
   * because a
   * fix that answered "could not tell" to EVERYTHING would satisfy all three
   * cases above while being just as useless as the collapse it replaced —
   * the distinction has to hold in both directions.
   */
  it("a genuine EMPTY queue is ok:0 — the honest zero survives, distinguishable from unknown", async () => {
    const supabase = makeSupabase({ count: 0, error: null });

    const result = await checkStuckNotifications(supabase);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.stuck).toBe(0);
    expect(consoleErr).not.toHaveBeenCalled();
  });

  it("a real backlog is ok:n and passes the count through unchanged", async () => {
    const supabase = makeSupabase({ count: 7, error: null });

    const result = await checkStuckNotifications(supabase);

    expect(result).toEqual({ kind: "ok", stuck: 7 });
  });

  it("thresholdMinutes moves the cutoff (default 60) — the window is a real argument, not decoration", async () => {
    const cutoffs: string[] = [];
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            lt: async (_col: string, cutoff: string) => {
              cutoffs.push(cutoff);
              return { count: 0, error: null };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const now = Date.now();
    await checkStuckNotifications(supabase); // default 60
    await checkStuckNotifications(supabase, 15);

    const [defaultCutoff, shortCutoff] = cutoffs.map((c) => Date.parse(c));
    // ~60 min back and ~15 min back, with a second of slack for clock drift
    // across the two awaits.
    expect(now - defaultCutoff).toBeGreaterThanOrEqual(60 * 60_000 - 1000);
    expect(now - defaultCutoff).toBeLessThan(60 * 60_000 + 1000);
    expect(now - shortCutoff).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(now - shortCutoff).toBeLessThan(15 * 60_000 + 1000);
  });
});
