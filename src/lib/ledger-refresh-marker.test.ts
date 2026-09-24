// @vitest-environment node

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEDGER_REFRESH_JOB_SOURCES,
  retractInheritedRefreshMarker,
  retractionFailureCode,
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
 *
 * ⭐ 164.6 review fix (WR-01): the set is built from the frozenset's ACTUAL
 * MEMBERS, never from the two constants the union used to be checked for by
 * name. The earlier oracle confirmed both names appeared in the union and then
 * returned those two values, so a third member added on the Python side left
 * it at two and the parity case green while Python honoured a marker the TS
 * retraction never retracts. Each member is a `LEDGER_REFRESH_*_SOURCE`
 * constant (resolved to its string) or a string literal; anything else THROWS,
 * because a member this parser cannot read is a member it cannot compare.
 */
function parsePythonLedgerRefreshSources(py: string, where: string): Set<string> {
  const union = py.match(
    /^LEDGER_REFRESH_JOB_SOURCES: Final\[frozenset\[str\]\] = frozenset\(\s*\{([^}]*)\}\s*\)/m,
  );
  if (!union) {
    throw new Error(
      `161.1-D13 parity oracle: could not find the LEDGER_REFRESH_JOB_SOURCES frozenset in ${where}. ` +
        `If the Python declaration changed shape, re-point this parse — do NOT delete it, or the TS ` +
        `marker set loses its only tie to the set Python honours.`,
    );
  }
  const consts = new Map<string, string>();
  for (const m of py.matchAll(/^(LEDGER_REFRESH_\w+_SOURCE): Final\[str\] = "([^"]+)"$/gm)) {
    consts.set(m[1], m[2]);
  }
  const members = union[1]
    .split(",")
    .map((tok) => tok.trim())
    .filter((tok) => tok.length > 0)
    .map((tok) => {
      const literal = /^"([^"]+)"$/.exec(tok);
      if (literal) return literal[1];
      const value = consts.get(tok);
      if (value === undefined) {
        throw new Error(`161.1-D13 parity oracle: unresolvable union member ${tok} in ${where}`);
      }
      return value;
    });
  if (members.length === 0) {
    throw new Error(`161.1-D13 parity oracle: the LEDGER_REFRESH_JOB_SOURCES union in ${where} is empty`);
  }
  return new Set(members);
}

const JOB_WORKER_PATH = resolve(process.cwd(), "analytics-service/services/job_worker.py");
const JOB_WORKER_PY = readFileSync(JOB_WORKER_PATH, "utf8");
const PYTHON_LEDGER_REFRESH_JOB_SOURCES: ReadonlySet<string> = parsePythonLedgerRefreshSources(
  JOB_WORKER_PY,
  JOB_WORKER_PATH,
);

/**
 * IN-01 (164.6 review fix): the THIRD copy of the marker set, in SQL. The
 * `sync_strategy_analytics_status` snapshot spells it as a literal
 * `(… ->> 'source') IN ('…', '…')` list, once in `is_protected` and once in
 * the live-successor exclusion, and decides the publish state on every path
 * where no Python stamp runs. Every such list is parsed; a non-literal member
 * THROWS for the WR-01 reason.
 */
function parseSqlLedgerRefreshSourceLists(sql: string, where: string): Array<Set<string>> {
  const lists: Array<Set<string>> = [];
  for (const m of sql.matchAll(/->>\s*'source'\)\s*IN\s*\(([^)]*)\)/g)) {
    const members = m[1]
      .split(",")
      .map((tok) => tok.trim())
      .map((tok) => {
        const literal = /^'([^']+)'$/.exec(tok);
        if (!literal) {
          throw new Error(`161.1-D13 SQL parity oracle: unresolvable list member ${tok} in ${where}`);
        }
        return literal[1];
      });
    lists.push(new Set(members));
  }
  return lists;
}
const SYNC_STATUS_PATH = resolve(
  process.cwd(),
  "supabase/schema/functions/sync_strategy_analytics_status.sql",
);
const SYNC_STATUS_SQL = readFileSync(SYNC_STATUS_PATH, "utf8");

/** A fake admin client exposing only the two compute_jobs chains the helper uses. */
function fakeAdmin(
  read: { data: unknown; error: unknown },
  updateError: unknown = null,
  updatedRows: unknown = [{ id: "the-updated-row" }],
) {
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
            // LOW-1: the helper asks PostgREST for the updated rows, so a
            // zero-row UPDATE is visible instead of reading as success.
            return {
              select: (_cols: string) =>
                Promise.resolve({ data: updateError ? null : updatedRows, error: updateError }),
            };
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

  // WR-01 RED DEMO, kept as a case so it runs every time: a THIRD member added
  // to the Python union must reach the oracle and turn the parity case RED.
  // Measured before the fix: the name-check oracle stayed at 2 here.
  it("a third member added to the Python union reaches the oracle and breaks parity", () => {
    const original = /\{LEDGER_REFRESH_SINGLE_KEY_SOURCE, LEDGER_REFRESH_COMPOSITE_SOURCE\}/;
    expect(original.test(JOB_WORKER_PY), "the union's current spelling moved; re-point this demo").toBe(true);
    const widened = JOB_WORKER_PY.replace(
      original,
      '{LEDGER_REFRESH_SINGLE_KEY_SOURCE, LEDGER_REFRESH_COMPOSITE_SOURCE, "ledger-refresh-mt5"}',
    );
    expect(widened).not.toBe(JOB_WORKER_PY);
    const oracle = parsePythonLedgerRefreshSources(widened, "a widened copy");
    expect(oracle.size).toBe(3);
    expect(oracle.has("ledger-refresh-mt5")).toBe(true);
    expect(new Set(LEDGER_REFRESH_JOB_SOURCES)).not.toEqual(oracle);
  });

  it("a union member the parser cannot resolve THROWS instead of being dropped", () => {
    const unresolvable = JOB_WORKER_PY.replace(
      /\{LEDGER_REFRESH_SINGLE_KEY_SOURCE, LEDGER_REFRESH_COMPOSITE_SOURCE\}/,
      "{LEDGER_REFRESH_SINGLE_KEY_SOURCE, LEDGER_REFRESH_COMPOSITE_SOURCE, SOME_OTHER_NAME}",
    );
    expect(unresolvable).not.toBe(JOB_WORKER_PY);
    expect(() => parsePythonLedgerRefreshSources(unresolvable, "an unresolvable copy")).toThrow(
      /unresolvable union member SOME_OTHER_NAME/,
    );
  });
});

describe("[161.1-D13] LEDGER_REFRESH_JOB_SOURCES — parity with the SQL publish-state predicate (IN-01)", () => {
  it("every marker list in sync_strategy_analytics_status equals the TS set", () => {
    const lists = parseSqlLedgerRefreshSourceLists(SYNC_STATUS_SQL, SYNC_STATUS_PATH);
    // MEASURED 2026-09-24: two lists, `is_protected` and the live-successor
    // exclusion. An exact count, so a parse that silently finds none fails.
    expect(lists.length, "the snapshot's marker lists were not found; re-point the parse").toBe(2);
    for (const list of lists) {
      expect(list).toEqual(new Set(LEDGER_REFRESH_JOB_SOURCES));
    }
  });

  it("a marker added to the SQL list alone turns the SQL parity case RED", () => {
    const widened = SYNC_STATUS_SQL.replace(
      "IN ('ledger-refresh', 'ledger-refresh-composite')",
      "IN ('ledger-refresh', 'ledger-refresh-composite', 'ledger-refresh-mt5')",
    );
    expect(widened).not.toBe(SYNC_STATUS_SQL);
    const lists = parseSqlLedgerRefreshSourceLists(widened, "a widened copy");
    expect(lists.some((list) => list.size === 3)).toBe(true);
    expect(lists.every((list) => JSON.stringify([...list].sort()) === JSON.stringify([...LEDGER_REFRESH_JOB_SOURCES].sort()))).toBe(false);
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

  // LOW-1 (164.6 review fix): the id came back from enqueue_compute_job a
  // moment ago, so NO ROW is an unreadable job, not an unmarked one. It must
  // reach the caller's loud path instead of reading as "nothing to retract".
  it("throws when the just-enqueued job's row cannot be read at all, and writes nothing", async () => {
    const f = fakeAdmin({ data: null, error: null });

    const err = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/not readable/);
    expect(f.update).not.toHaveBeenCalled();
  });

  // LOW-1: without `.select`, a zero-row UPDATE reads as success and the
  // marker stays in place under a `retracted: true` result.
  it("throws when the UPDATE matched no row, instead of reporting a retraction", async () => {
    const f = fakeAdmin(
      { data: { metadata: { source: "ledger-refresh" } }, error: null },
      null,
      [],
    );

    const err = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/matched no row/);
    expect(f.update).toHaveBeenCalledTimes(1);
  });

  it("retractionFailureCode reads the SQLSTATE out of the cause, and says none when there is none", () => {
    expect(
      retractionFailureCode(new Error("x", { cause: { message: "denied", code: "42501" } })),
    ).toBe("42501");
    expect(retractionFailureCode(new Error("no cause"))).toBe("none");
    expect(retractionFailureCode("not an error")).toBe("none");
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
