// @vitest-environment node

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEDGER_REFRESH_JOB_SOURCES,
  RETRACT_REFRESH_MARKER_RPC,
  RETRACTION_OUTCOMES,
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

/**
 * A fake admin client that answers ONE rpc and refuses every table.
 *
 * Phase 191 D-01: the retraction is a single SQL UPDATE behind
 * `retract_ledger_refresh_marker`. The helper may not read or write any table
 * itself, so `from` throws for every table: a read-modify-write body (today's
 * pre-191 shape) fails every case below with `unexpected table access`, which is
 * what makes these cases fail on the replace behaviour they retire.
 */
function fakeAdmin(answer: { data: unknown; error: unknown }) {
  const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => Promise.resolve(answer));
  const from = vi.fn((table: string) => {
    throw new Error(`unexpected table access: from(${table})`);
  });
  return { admin: { rpc, from } as unknown as SupabaseClient, rpc, from };
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
    // MOVED 2026-10-03 (Phase 164.5.2.1 BRIDGERESIDUE), 2 -> 3: migration
    // 20261003120000 adds a third literal list, read 1's unmarked-job FILTER
    // (the RETRY-PLAIN-COMPLETE keep, plan 02). MEASURED: `expected 3 to be 2`
    // after plan 04 regenerated the snapshot; each of the three lists still
    // equals the TS set, which the loop below asserts.
    expect(lists.length, "the snapshot's marker lists were not found; re-point the parse").toBe(3);
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

/**
 * Phase 191 — the TS helper and the SQL function it calls share three things that
 * must not drift: the marker set, the function's name, and the outcome words.
 * Each is read from the GENERATED snapshot
 * (`supabase/schema/functions/retract_ledger_refresh_marker.sql`), so a change to
 * the function that is not mirrored here turns a case red instead of leaving a
 * Sync routed to an answer the helper reads as success or throws on.
 *
 * Three copies of the marker set (Python, TS, SQL) must not drift (CONTEXT
 * Specifics). The snapshot is the third; `job_worker.py` and
 * `sync_strategy_analytics_status.sql` are pinned above.
 */
const RETRACT_FN_PATH = resolve(
  process.cwd(),
  "supabase/schema/functions/retract_ledger_refresh_marker.sql",
);
const RETRACT_FN_SQL = readFileSync(RETRACT_FN_PATH, "utf8");
const HELPER_SRC = readFileSync(resolve(process.cwd(), "src/lib/ledger-refresh-marker.ts"), "utf8");

/** Every `'outcome', '<word>'` literal in the function body, as a set. */
function parseSqlOutcomes(sql: string): Set<string> {
  return new Set([...sql.matchAll(/'outcome',\s*'([a-z_]+)'/g)].map((m) => m[1]));
}

/** The name in `CREATE [OR REPLACE] FUNCTION public.<name>(`. */
function parseSqlFunctionName(sql: string): string {
  const m = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\(/.exec(sql);
  if (!m) throw new Error("retract_ledger_refresh_marker.sql: no CREATE FUNCTION public.<name>( found");
  return m[1];
}

describe("[Phase 191] parity with the retract_ledger_refresh_marker snapshot", () => {
  it("both marker lists in the SQL function equal the TS set", () => {
    const lists = parseSqlLedgerRefreshSourceLists(RETRACT_FN_SQL, RETRACT_FN_PATH);
    // MEASURED 2026-11-05: two lists, the UPDATE's WHERE and the classifying
    // SELECT's CASE (which names the marker a finished job still carries). An
    // exact count, so a parse that silently finds none fails.
    expect(lists.length, "the snapshot's marker lists were not found; re-point the parse").toBe(2);
    for (const list of lists) {
      expect(list).toEqual(new Set(LEDGER_REFRESH_JOB_SOURCES));
    }
  });

  it("a marker added to the SQL function alone turns the marker parity case RED", () => {
    const widened = RETRACT_FN_SQL.replaceAll(
      "IN ('ledger-refresh', 'ledger-refresh-composite')",
      "IN ('ledger-refresh', 'ledger-refresh-composite', 'ledger-refresh-mt5')",
    );
    expect(widened).not.toBe(RETRACT_FN_SQL);
    const lists = parseSqlLedgerRefreshSourceLists(widened, "a widened copy");
    expect(lists.some((list) => list.size === 3)).toBe(true);
    expect(lists.every((list) => list.size === LEDGER_REFRESH_JOB_SOURCES.length)).toBe(false);
  });

  it("the function's name, RETRACT_REFRESH_MARKER_RPC and the literal the helper passes to .rpc( are the same string", () => {
    const sqlName = parseSqlFunctionName(RETRACT_FN_SQL);
    // The same quoted-literal shape MUTATING_RPC_RE (audit-coverage.test.ts)
    // matches: the helper must write the name as a literal at the call, because
    // the audit scanner reads no constant. Exactly one call, so a second `.rpc(`
    // added to the helper cannot hide behind the first.
    const literals = [...HELPER_SRC.matchAll(/\.rpc\(\s*["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
    expect(literals, "the helper must make one rpc call whose name is a quoted literal").toEqual([sqlName]);
    expect(RETRACT_REFRESH_MARKER_RPC).toBe(sqlName);
  });

  it("the function's name drifting from the helper's literal turns the name case RED", () => {
    const renamed = RETRACT_FN_SQL.replace(
      "FUNCTION public.retract_ledger_refresh_marker(",
      "FUNCTION public.retract_ledger_refresh_marker_v2(",
    );
    expect(renamed).not.toBe(RETRACT_FN_SQL);
    expect(parseSqlFunctionName(renamed)).not.toBe(RETRACT_REFRESH_MARKER_RPC);
  });

  it("the outcome words the function answers with equal RETRACTION_OUTCOMES", () => {
    const outcomes = parseSqlOutcomes(RETRACT_FN_SQL);
    // Anti-vacuity: four outcomes, so a regex that matched nothing, or only some
    // of them, cannot agree with a short list by accident.
    expect(outcomes.size).toBe(4);
    expect(RETRACTION_OUTCOMES).toHaveLength(4);
    expect(outcomes).toEqual(new Set(RETRACTION_OUTCOMES));
  });

  it("an outcome added to the SQL function alone turns the outcome parity case RED", () => {
    const widened = RETRACT_FN_SQL.replace(
      "jsonb_build_object('outcome', 'no_row')",
      "jsonb_build_object('outcome', 'no_row'), jsonb_build_object('outcome', 'gone')",
    );
    expect(widened).not.toBe(RETRACT_FN_SQL);
    const outcomes = parseSqlOutcomes(widened);
    expect(outcomes.size).toBe(5);
    expect(outcomes).not.toEqual(new Set(RETRACTION_OUTCOMES));
  });
});

/**
 * Phase 211 D11 (D11-2, D11-12) — the THIRD SQL copy of the marker set.
 * `_record_enqueue_dedup` records the caller's metadata on a dedup hit and
 * retracts an inherited refresh marker itself, for a caller that sends a
 * correlation id. It holds exactly one `(… ->> 'source') IN (…)` list (the
 * caller-has-no-marker conjunct) and reaches the marker UPDATE only through
 * `public.retract_ledger_refresh_marker(`. A marker the helper does not know
 * is never retracted by SQL, and the TS retraction above stays the only
 * backstop for it; a marker only the helper knows would drop a protection
 * nothing else honours. Read from the GENERATED snapshot, as the Phase 191
 * block does.
 */
const DEDUP_FN_PATH = resolve(
  process.cwd(),
  "supabase/schema/functions/_record_enqueue_dedup.sql",
);
const DEDUP_FN_SQL = readFileSync(DEDUP_FN_PATH, "utf8");

describe("[Phase 211 D11] parity with the _record_enqueue_dedup snapshot", () => {
  it("the helper's one marker list equals the TS set", () => {
    const lists = parseSqlLedgerRefreshSourceLists(DEDUP_FN_SQL, DEDUP_FN_PATH);
    // MEASURED 2026-11-14: one list, the caller-has-no-marker conjunct. An
    // exact count, so a parse that silently finds none fails.
    expect(lists.length, "the snapshot's marker list was not found; re-point the parse").toBe(1);
    expect(lists[0]).toEqual(new Set(LEDGER_REFRESH_JOB_SOURCES));
  });

  it("a marker added to the helper alone turns the helper parity case RED", () => {
    const widened = DEDUP_FN_SQL.replace(
      "IN ('ledger-refresh', 'ledger-refresh-composite')",
      "IN ('ledger-refresh', 'ledger-refresh-composite', 'ledger-refresh-mt5')",
    );
    expect(widened).not.toBe(DEDUP_FN_SQL);
    const lists = parseSqlLedgerRefreshSourceLists(widened, "a widened copy");
    expect(lists).toHaveLength(1);
    expect(lists[0].size).toBe(3);
    expect(lists[0]).not.toEqual(new Set(LEDGER_REFRESH_JOB_SOURCES));
  });

  it("the helper retracts through the one retraction function, once, outside comments", () => {
    // D11-12: one marker list and one UPDATE shape behind every retraction. The
    // header prose names the function, so `--` comments are stripped first.
    const code = DEDUP_FN_SQL.split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    const call = `public.${RETRACT_REFRESH_MARKER_RPC}(`;
    expect(code.split(call).length - 1, `expected exactly one ${call} outside comments`).toBe(1);
  });
});

describe("[161.1-D13] retractInheritedRefreshMarker", () => {
  // Pitfall 16: the UNION, not one value — one positive case per marker.
  it.each(["ledger-refresh", "ledger-refresh-composite"])(
    "retracts an inherited %s marker with ONE rpc carrying only the job id and this request's correlation id",
    async (marker) => {
      const f = fakeAdmin({ data: { outcome: "retracted", marker }, error: null });

      const result = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID);

      expect(result).toEqual({ retracted: true, marker });
      expect(f.rpc).toHaveBeenCalledTimes(1);
      // Only the ids travel: the helper never sends a metadata copy, so it cannot
      // write a stale one back over a concurrent writer's key (T-191-24).
      expect(f.rpc).toHaveBeenCalledWith("retract_ledger_refresh_marker", {
        p_job_id: JOB_ID,
        p_correlation_id: CORRELATION_ID,
      });
      expect(f.from).not.toHaveBeenCalled();
    },
  );

  // D-07 (STATUSBRIDGE review IN-R4-01): a FINISHED job's protection was decided
  // when it ran; the function leaves the row alone so `updated_at` keeps telling
  // when it finished. And a job with no marker is an ordinary no-op.
  it.each([
    ["done, marker still on the finished row", { outcome: "done", status: "done", marker: "ledger-refresh" }],
    ["done, no marker", { outcome: "done", status: "done", marker: null }],
    ["no_marker", { outcome: "no_marker", status: "running" }],
  ])("reports nothing retracted and does not throw (%s)", async (_label, data) => {
    const f = fakeAdmin({ data, error: null });

    const result = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID);

    expect(result).toEqual({ retracted: false });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });

  // LOW-1 (164.6 review fix): the id came back from enqueue_compute_job a
  // moment ago, so NO ROW is an unreadable job, not an unmarked one. It must
  // reach the caller's loud path instead of reading as "nothing to retract".
  it("throws when the just-enqueued job's row does not exist (no_row)", async () => {
    const f = fakeAdmin({ data: { outcome: "no_row" }, error: null });

    const err = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/not readable/);
  });

  it("throws on an rpc error, carrying the PostgREST error as cause, and retractionFailureCode reads its code", async () => {
    const rpcErr = { message: "permission denied for function", code: "42501" };
    const f = fakeAdmin({ data: null, error: rpcErr });

    const err = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBe(rpcErr);
    expect(retractionFailureCode(err)).toBe("42501");
  });

  // T-191-23: an answer this helper cannot read must never pass as "nothing to
  // retract" or as a retraction, or a Sync left protected as a refresh would be
  // reported as handled.
  it.each([
    ["an unknown outcome", { outcome: "retired" }, /unknown outcome \(retired\)/],
    ["a missing outcome", {}, /unknown outcome \(undefined\)/],
    ["a null answer", null, /not an object/],
    ["a string answer", "retracted", /not an object/],
    ["an array answer", [{ outcome: "retracted", marker: "ledger-refresh" }], /not an object/],
    [
      "a retraction of a marker outside the set",
      { outcome: "retracted", marker: "keys/sync" },
      /outside LEDGER_REFRESH_JOB_SOURCES/,
    ],
    ["a retraction naming no marker", { outcome: "retracted" }, /outside LEDGER_REFRESH_JOB_SOURCES/],
  ])("throws on %s", async (_label, data, message) => {
    const f = fakeAdmin({ data, error: null });

    const err = await retractInheritedRefreshMarker(f.admin, JOB_ID, CORRELATION_ID).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(message);
  });

  it.each([null, undefined, ""])("does not touch the database without a job id (%s)", async (jobId) => {
    const f = fakeAdmin({ data: null, error: null });

    const result = await retractInheritedRefreshMarker(f.admin, jobId, CORRELATION_ID);

    expect(result).toEqual({ retracted: false });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
  });

  // Retired with Phase 191 D-01: the cases that modelled the read-to-write window
  // (a zero-row UPDATE followed by a status re-read, `.neq("status", "done")` on
  // the UPDATE chain, the metadata read error). One UPDATE in SQL has no such
  // window, and the helper has no table access left to model.
  it("retractionFailureCode reads the SQLSTATE out of the cause, and says none when there is none", () => {
    expect(
      retractionFailureCode(new Error("x", { cause: { message: "denied", code: "42501" } })),
    ).toBe("42501");
    expect(retractionFailureCode(new Error("no cause"))).toBe("none");
    expect(retractionFailureCode("not an error")).toBe("none");
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
