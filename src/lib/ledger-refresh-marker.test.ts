// @vitest-environment node

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEDGER_REFRESH_JOB_SOURCES,
  retractInheritedRefreshMarker,
} from "./ledger-refresh-marker";

/**
 * Phase 164.6 / 161.1-D13 — the TS retraction of an inherited ledger-refresh
 * marker, and its parity with the Python marker set.
 *
 * WHY THIS MATTERS: `enqueue_compute_job` dedups a user's `stitch_composite`
 * onto an in-flight job. If that job is a background ledger refresh, its
 * `metadata.source` marker tells the Python guard and the SQL `is_protected`
 * predicate to keep a stale factsheet published over a failure. A user is
 * waiting on this request, so the marker must be retracted — for BOTH markers,
 * and only for them.
 */

/**
 * The oracle: Python's marker set, parsed from `job_worker.py` at module scope
 * so a parse miss is LOUD (the whole file fails to load) rather than yielding
 * an empty set that every comparison agrees with.
 */
const PYTHON_LEDGER_REFRESH_JOB_SOURCES: ReadonlySet<string> = (() => {
  const path = resolve(process.cwd(), "analytics-service/services/job_worker.py");
  const py = readFileSync(path, "utf8");
  const single = py.match(
    /^LEDGER_REFRESH_SINGLE_KEY_SOURCE: Final\[str\] = "([^"]+)"$/m,
  );
  const composite = py.match(
    /^LEDGER_REFRESH_COMPOSITE_SOURCE: Final\[str\] = "([^"]+)"$/m,
  );
  const union = py.match(
    /^LEDGER_REFRESH_JOB_SOURCES: Final\[frozenset\[str\]\] = frozenset\(([^)]*)\)/m,
  );
  const unionNamesBoth =
    union !== null &&
    /\bLEDGER_REFRESH_SINGLE_KEY_SOURCE\b/.test(union[1]) &&
    /\bLEDGER_REFRESH_COMPOSITE_SOURCE\b/.test(union[1]);
  if (!single || !composite || !unionNamesBoth) {
    throw new Error(
      `161.1-D13 parity oracle: could not parse the ledger-refresh marker set out ` +
        `of ${path}. If the Python declaration changed shape, re-point this parse — ` +
        `do NOT delete it, or the TS marker set loses its only tie to the set ` +
        `Python honours.`,
    );
  }
  return new Set([single[1], composite[1]]);
})();

/** A fake admin client exposing only the two compute_jobs chains the helper uses. */
function fakeAdmin(read: { data: unknown; error: unknown }, updateError: unknown = null) {
  const readEq = vi.fn();
  const update = vi.fn();
  const updateEq = vi.fn();
  const from = vi.fn((table: string) => {
    if (table !== "compute_jobs") throw new Error(`unexpected from(${table})`);
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: unknown) => {
          readEq(col, val);
          return { maybeSingle: () => Promise.resolve(read) };
        },
      }),
      update: (patch: Record<string, unknown>) => {
        update(patch);
        return {
          eq: (col: string, val: unknown) => {
            updateEq(col, val);
            return Promise.resolve({ error: updateError });
          },
        };
      },
    };
  });
  return {
    admin: { from } as unknown as SupabaseClient,
    from,
    readEq,
    update,
    updateEq,
  };
}

const JOB_ID = "33333333-3333-3333-3333-333333333333";
const CORRELATION_ID = "44444444-4444-4444-4444-444444444444";

describe("[161.1-D13] LEDGER_REFRESH_JOB_SOURCES — parity with job_worker.py", () => {
  it("the Python oracle is the two real markers, not an empty or partial parse", () => {
    // Anti-vacuity: the parity assertion below compares against this set, so a
    // regex that matched the wrong line would make it trivially agreeable.
    expect(PYTHON_LEDGER_REFRESH_JOB_SOURCES.size).toBe(2);
    expect(PYTHON_LEDGER_REFRESH_JOB_SOURCES.has("ledger-refresh")).toBe(true);
    expect(PYTHON_LEDGER_REFRESH_JOB_SOURCES.has("ledger-refresh-composite")).toBe(true);
  });

  it("the TS marker set equals the set Python honours", () => {
    expect(new Set(LEDGER_REFRESH_JOB_SOURCES)).toEqual(PYTHON_LEDGER_REFRESH_JOB_SOURCES);
  });
});

describe("[161.1-D13] retractInheritedRefreshMarker", () => {
  // Pitfall 16: the UNION, not one value — one positive case per marker.
  it.each(["ledger-refresh", "ledger-refresh-composite"])(
    "retracts an inherited %s marker: drops source, keeps every other key, records the marker and this request's correlation id",
    async (marker) => {
      const f = fakeAdmin({
        data: {
          metadata: {
            source: marker,
            correlation_id: "fanout-run",
            unified_backbone_at_claim: "true",
          },
        },
        error: null,
      });

      const result = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID);

      expect(result).toEqual({ retracted: true, marker });
      expect(f.readEq).toHaveBeenCalledWith("id", JOB_ID);
      expect(f.update).toHaveBeenCalledTimes(1);
      expect(f.update).toHaveBeenCalledWith({
        metadata: {
          unified_backbone_at_claim: "true",
          refresh_marker_retracted: marker,
          correlation_id: CORRELATION_ID,
        },
      });
      expect(f.updateEq).toHaveBeenCalledWith("id", JOB_ID);
    },
  );

  it.each([
    ["another source", { data: { metadata: { source: "keys/sync" } }, error: null }],
    ["null metadata", { data: { metadata: null }, error: null }],
    ["no row", { data: null, error: null }],
    ["array metadata", { data: { metadata: ["ledger-refresh"] }, error: null }],
  ])("never rewrites a job without a ledger-refresh marker (%s)", async (_label, read) => {
    const f = fakeAdmin(read);

    const result = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID);

    expect(result).toEqual({ retracted: false });
    expect(f.readEq).toHaveBeenCalledWith("id", JOB_ID);
    expect(f.update).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ""])("does not touch the database without a job id (%s)", async (jobId) => {
    const f = fakeAdmin({ data: null, error: null });

    const result = await retractInheritedRefreshMarker(f.admin, jobId, CORRELATION_ID);

    expect(result).toEqual({ retracted: false });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("throws on a read error, carrying the PostgREST error as cause, and writes nothing", async () => {
    const readErr = { message: "read denied", code: "42501" };
    const f = fakeAdmin({ data: null, error: readErr });

    const err = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBe(readErr);
    expect(f.update).not.toHaveBeenCalled();
  });

  it("throws on an update error, carrying the PostgREST error as cause", async () => {
    const updateErr = { message: "update denied", code: "42501" };
    const f = fakeAdmin(
      { data: { metadata: { source: "ledger-refresh-composite" } }, error: null },
      updateErr,
    );

    const err = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBe(updateErr);
  });
});

/*
 * ⭐ RED DEMO (run 2026-09-24, each restored from a byte backup after, `cmp`
 * silent, re-run green):
 *
 *   (i) keys/sync — replaced the `retractInheritedRefreshMarker(admin, rpcData,
 *   correlation_id)` call in the composite branch with `{ retracted: false }`.
 *   Observed in src/app/api/keys/sync/route.test.ts: both "a deduped job
 *   carrying ledger-refresh[-composite] is rewritten without source …" cases
 *   and "a failed retraction never changes the 202, and is LOUD under its own
 *   Sentry tag" FAILED (3 failed | 40 passed).
 *
 *   (ii) finalize-wizard — the same neuter on the composite enqueue's call.
 *   Observed in src/app/api/strategies/finalize-wizard/route.test.ts: both
 *   per-marker positive cases and "a failed retraction keeps the success
 *   envelope, is captured under its OWN tag, and never as an enqueue failure"
 *   FAILED (3 failed | 143 passed).
 *
 *   (iii) the helper — narrowed the membership check to
 *   `source !== "ledger-refresh-composite"` (the single-marker shape Pitfall 16
 *   warns about). Observed: "retracts an inherited ledger-refresh marker …"
 *   here, and the `ledger-refresh` positive case at BOTH routes, FAILED; every
 *   `ledger-refresh-composite` case stayed green — which is why each marker
 *   has its own case (3 failed | 199 passed across the three files).
 *
 *   (iv) the parity pin — changed the TS literal "ledger-refresh-composite" to
 *   "ledger-refresh-composit". Observed: "the TS marker set equals the set
 *   Python honours" FAILED, alongside the composite positive case and the
 *   update-error case, whose fixtures carry the real marker (3 failed |
 *   10 passed).
 */
