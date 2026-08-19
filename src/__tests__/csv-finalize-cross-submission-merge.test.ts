/**
 * CR-01 — the CSV finalize path must not merge two different submissions into
 * one strategy and report success.
 *
 * ⚠️ RE-POINTED BY PHASE 145 (D-09). The fence these five arms guard MOVED:
 * the fold (`finalize_csv_strategy_with_returns`, migration 20260819120000)
 * deleted the standalone merge-writing persist upsert, so the fabrication
 * mechanism the original fence blocked no longer exists. What remains is the
 * REPORTING hazard, decided in the route's 23505 resolve arm
 * (`resolveExistingStrategyOrRefuse`): a 23505 now means a PRIOR attempt for
 * this (user, wizard_session, source='csv') FULLY committed, and the arm must
 * verify — name first, then range, both as READS, both BEFORE any metadata
 * write — that THIS submission is the same one, or refuse.
 *
 * THE DEFECT CLASS, still in one sentence: `wizard_session_id` identifies a
 * SESSION, not a SUBMISSION, and it survives a failed submit
 * (`localStorage.ts:390-393` states that as load-bearing). So:
 *
 *   1. name "Alpha", upload 2024.csv, submit → strategy S fully committed
 *   2. the response is lost (window A). `CSV_SUBMIT_FAILED` says submit again.
 *   3. the user uploads 2025.csv under the SAME name and session
 *   4. 23505 → a naive resolve echoes S → the caller applies THIS request's
 *      metadata to S and reports success for a file S does not hold.
 *
 * THE ECONOMIC ORACLE (D-09, pinned here — never the implementation's own
 * predicate): a strategy's persisted series equals exactly the file that was
 * submitted. On a refusal, NOTHING of the refused submission may be written —
 * which after the fold means exactly one thing is left to block: the metadata
 * UPDATE. Every refusal arm asserts it did not run; the positive arms assert
 * it did (so the oracle is proven able to fire).
 *
 * ⚠️ THE POSITIVE COUNTERPARTS ARE LOAD-BEARING. A resolve arm that refused
 * every 23505 would satisfy the merge assertion while dead-ending the
 * instructed retry — re-opening C-2's dead end from the other side.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    <H extends (req: unknown, user: unknown) => unknown>(handler: H) =>
    async (req: unknown) =>
      handler(req, { id: "00000000-0000-0000-0000-000000000abc" }),
}));

const checkLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, retryAfter: 0 })),
);
vi.mock("@/lib/ratelimit", () => ({
  csvValidateLimiter: {},
  checkLimit: checkLimitMock,
}));

const USER_ID = "00000000-0000-0000-0000-000000000abc";
const EXISTING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
/** 146.2-01 / R1 — a discovery category. A UUID because `parseCsvMetadata`
 * accepts `category_id` only when `isUuid()` passes; any other string is
 * silently dropped, which would make the REQUEST side absent instead of
 * present and quietly defuse the arms below. */
const CATEGORY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
/** A DIFFERENT category — the conflict arm's "present and different" value. */
const OTHER_CATEGORY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/** The resolve arm's strategies re-fetch: row + error + recorded filters.
 *
 * 146.2-01 / R1 — the row shape now carries the two CLASSIFICATION columns the
 * resolve arm reads. They are OPTIONAL on purpose: a fixture that omits them
 * models an ABSENT reading (the column did not come back), which is a different
 * fact from `category_id: null` (the column came back and holds SQL NULL). Only
 * the arms that need one of those two facts declare them. */
const resolveFetch = vi.hoisted(() => ({
  row: null as {
    id: string;
    name?: string;
    status?: string;
    category_id?: string | null;
    asset_class?: string;
  } | null,
  error: null as { code?: string; message?: string } | null,
  /** Every eq-filter set the arm re-fetched with, so C-08 scope is assertable. */
  filters: [] as Array<Record<string, unknown>>,
}));

/** The committed series the resolved strategy ALREADY holds, per test.
 * Red-team fix 2026-08-18: the arm now reads COUNT + BOUNDARIES (two ordered
 * reads) instead of an outside-range probe, so the fixture models the
 * committed series shape rather than a probe result. */
const seriesProbe = vi.hoisted(() => ({
  count: 0,
  minDate: null as string | null,
  maxDate: null as string | null,
  error: null as { code?: string; message?: string } | null,
  /** Every ordered read the route made ('asc' | 'desc'), so coverage of both
   * boundary reads is assertable. */
  reads: [] as string[],
}));

/**
 * 146.2-01 / R1 — the CLOCK-SAFETY GUARD's read of `strategy_analytics`.
 *
 * The guard fires only on an EMPTY-series (fmt='trades') echo, where no
 * recompute is enqueued and so nothing would reconcile a moved annualization
 * clock. `row: null` is the DEFAULT and it is a MEASURED absence — the read
 * happened and returned no row — which is why every pre-existing arm in this
 * file is untouched by the branch's arrival.
 */
const analyticsProbe = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  error: null as { code?: string; message?: string } | null,
  /** Every strategy_id the guard read with, so "the read happened" is assertable. */
  reads: [] as string[],
}));

/** Metadata UPDATE recorder — the economic oracle's write vector. */
const updateCalls = vi.hoisted(
  () => [] as Array<{ payload: Record<string, unknown> }>,
);

/**
 * 146.2-02 / BL-01 — what PostgREST answers the metadata UPDATE with. It was
 * hardwired to `{ error: null }`, so NO case in this file could reach the
 * failure path, and the FILL arm's 200-over-a-failed-write was invisible to
 * every assertion here. `error: null` stays the default, so every pre-existing
 * arm is untouched.
 */
const updateOutcome = vi.hoisted(
  () => ({ error: null as { code?: string; message?: string } | null }),
);

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-user-jwt" } },
      }),
    },
    rpc: (name: string, args: Record<string, unknown>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rpcMock as any)(name, args),
    from: (table: string) => ({
      // The metadata UPDATE — must run ONLY after a successful create or a
      // successful resolve (Pitfall 6).
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => {
            updateCalls.push({ payload });
            return Promise.resolve({ error: updateOutcome.error });
          },
        }),
      }),
      select: (_cols: string) => {
        if (table === "strategies") {
          // The resolve arm's C-08 scoped re-fetch:
          // .eq(user_id).eq(wizard_session_id).eq(source).maybeSingle()
          const filters: Record<string, unknown> = {};
          const chain = {
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              return chain;
            },
            maybeSingle: async () => {
              resolveFetch.filters.push({ ...filters });
              return { data: resolveFetch.row, error: resolveFetch.error };
            },
          };
          return chain;
        }
        if (table === "strategy_analytics") {
          // 146.2-01 / R1 — the clock-safety guard's read:
          // .select(<the 7 ranked KPI columns>).eq(strategy_id).maybeSingle().
          // Without this branch the guard would fall into the series-probe
          // shape below, whose table assertion would fail it.
          return {
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                analyticsProbe.reads.push(val);
                return { data: analyticsProbe.row, error: analyticsProbe.error };
              },
            }),
          };
        }
        // The CR-01 series-equality check (READ) against committed dailies:
        // .select("date", {count}).eq(strategy_id).order(date, asc).limit(1)
        // then .select("date").eq(strategy_id).order(date, desc).limit(1).
        return {
          eq: (_col: string, _val: string) => ({
            order: (_ocol: string, opts: { ascending: boolean }) => ({
              limit: async (_n: number) => {
                expect(
                  table,
                  "the series check must read the series table, not another one",
                ).toBe("csv_daily_returns");
                seriesProbe.reads.push(opts.ascending ? "asc" : "desc");
                if (seriesProbe.error) {
                  return { data: null, count: null, error: seriesProbe.error };
                }
                const boundary = opts.ascending
                  ? seriesProbe.minDate
                  : seriesProbe.maxDate;
                return {
                  data: boundary === null ? [] : [{ date: boundary }],
                  count: seriesProbe.count,
                  error: null,
                };
              },
            }),
          }),
        };
      },
    }),
  }),
}));

const adminFromMock = vi.hoisted(() => vi.fn());
/**
 * 146.1-05 / A4 — the analytics enqueue's ACTUAL rpc, hoisted so it is STABLE
 * across `createAdminClient()` calls. The previous inline `vi.fn()` was minted
 * fresh on every call, so nothing could observe whether the enqueue ran at
 * all. A4 changes one post-outcome side effect (the metadata UPDATE) and must
 * prove it did NOT change the other.
 */
const enqueueRpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, rpcArgs: Record<string, unknown>) =>
      enqueueRpcMock(name, rpcArgs),
    from: (table: string) => adminFromMock(table),
  }),
}));

// (Phase 146.1-07, cosmetic batch) An orphaned `process.env.INTERNAL_API_TOKEN`
// set lived here from when csv-finalize proxied to the Python service. It was
// removed after verifying the route reads no such variable — the only mention
// left in `csv-finalize/route.ts` is the docblock explaining why a direct RPC
// needs NO internal token. Removing it was checked by re-running this suite,
// not assumed.

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

/**
 * 146.1-05 / A4 — `after()` callbacks are RECORDED rather than dropped. This
 * mock was a no-op, which made the enqueue side effect invisible to every
 * case in this file. Recording is behaviourally identical by default (the
 * callback still does not run unless a test calls `flushAfter()`), and it
 * makes "was the compute job actually enqueued?" assertable.
 */
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterCallbacks.push(fn);
    },
  };
});

import { NextRequest } from "next/server";
import { captureToSentry } from "@/lib/sentry-capture";
import { POST } from "@/app/api/strategies/csv-finalize/route";

const SESSION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/**
 * Run every `after()` callback the request scheduled, to completion, then
 * clear the queue. Awaiting here is what makes the enqueue assertions
 * deterministic (the callback awaits `import()` + `admin.rpc` internally).
 */
async function flushAfter(): Promise<void> {
  const pending = afterCallbacks.splice(0, afterCallbacks.length);
  for (const cb of pending) {
    await cb();
  }
}

/** The exact PostgREST shape the session index's 23505 surfaces as. */
const DUP_KEY_ERROR = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
};

/** Jan–Mar 2024 — "2024.csv". */
const SERIES_2024 = [
  { date: "2024-01-31", daily_return: 0.01 },
  { date: "2024-02-29", daily_return: 0.02 },
  { date: "2024-03-29", daily_return: 0.03 },
];

/** Jan–Mar 2025 — "2025.csv". Disjoint from the above. */
const SERIES_2025 = [
  { date: "2025-01-31", daily_return: -0.01 },
  { date: "2025-02-28", daily_return: -0.02 },
  { date: "2025-03-31", daily_return: -0.03 },
];

function post(series: Array<{ date: string; daily_return: number }>) {
  return POST(
    new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
      method: "POST",
      body: JSON.stringify({
        wizard_session_id: SESSION,
        fmt: "daily_returns",
        strategy_name: "Alpha",
        daily_returns_series: series,
        // Metadata ARMS the economic oracle: a successful outcome applies it
        // (updateCalls grows), a refusal must not. Without a metadata field
        // the "nothing was written" assertions would be vacuously true.
        metadata: { description: "cr01 oracle marker" },
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}

function foldCalls() {
  return rpcMock.mock.calls.filter(
    (c) => c[0] === "finalize_csv_strategy_with_returns",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveFetch.row = null;
  resolveFetch.error = null;
  resolveFetch.filters.length = 0;
  seriesProbe.count = 0;
  seriesProbe.minDate = null;
  seriesProbe.maxDate = null;
  seriesProbe.error = null;
  seriesProbe.reads.length = 0;
  analyticsProbe.row = null;
  analyticsProbe.error = null;
  analyticsProbe.reads.length = 0;
  updateCalls.length = 0;
  updateOutcome.error = null;
  afterCallbacks.length = 0;
  // `vi.clearAllMocks()` above strips the implementation, and the enqueue
  // callback destructures the result — restore it every test.
  enqueueRpcMock.mockResolvedValue({ error: null });
  checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  // Default: the fold succeeds and returns a fresh id.
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "finalize_csv_strategy_with_returns") {
      return { data: EXISTING_ID, error: null };
    }
    return { data: null, error: null };
  });
  adminFromMock.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    upsert: async () => ({ error: null }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Drive the fold into its 23505 arm with a resolvable committed row. */
function arm23505(
  row: {
    id: string;
    name?: string;
    status?: string;
    category_id?: string | null;
    asset_class?: string;
  } | null,
) {
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "finalize_csv_strategy_with_returns") {
      return { data: null, error: DUP_KEY_ERROR };
    }
    return { data: null, error: null };
  });
  resolveFetch.row = row;
}

describe("[140.4-16 / CR-01, re-pointed by 145] the 23505 resolve arm refuses a cross-submission echo", () => {
  it("🔴 THE MERGE CASE: a 2025 payload is refused when the committed strategy already holds 2024", async () => {
    // A prior attempt FULLY committed S with 2024's series (the fold is
    // all-or-nothing, so 23505 ⇒ S has its dailies). Same name — the range
    // check is the only fence that can see the changed FILE.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2024-01-31";
    seriesProbe.maxDate = "2024-03-29";

    const res = await post(SERIES_2025);

    expect(
      res.status,
      "the route reported success for a submission whose file the committed " +
        "strategy does not hold — the user is told 2025.csv saved while S " +
        "carries 2024's rows, on a product whose value is a verified track record",
    ).not.toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_SESSION_REUSED");

    // The economic oracle: NOTHING of the refused submission was written.
    // After the fold the only write vector left on this path is the metadata
    // UPDATE — Pitfall 6's whole point is that it runs AFTER the checks.
    expect(
      updateCalls,
      "the metadata UPDATE ran before/despite the refusal — the 409's " +
        "'refused before writing anything of this submission' copy is a lie",
    ).toEqual([]);
  });

  it("reads BOTH committed boundaries (asc + desc) before echoing, so equality means the committed series", async () => {
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2025-01-31";
    seriesProbe.maxDate = "2025-03-31";

    await post(SERIES_2025);

    expect(seriesProbe.reads).toEqual(["asc", "desc"]);
    // C-08: the re-fetch that precedes the range check carries the full
    // tenant scope — user_id AND wizard_session_id AND source — never the
    // session id alone.
    expect(resolveFetch.filters).toEqual([
      { user_id: USER_ID, wizard_session_id: SESSION, source: "csv" },
    ]);
  });

  it("POSITIVE: a FIRST submit (no 23505) creates through the fold and never runs the resolve arm", async () => {
    // Without this the fence above is satisfied by an arm that refuses
    // everything, which breaks every CSV upload on the product.
    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategy_id).toBe(EXISTING_ID);
    // Exactly one fold call, carrying the submitted rows as p_rows — the
    // dailies ride the SAME transaction as the strategy row (D-07).
    const calls = foldCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1].p_rows).toEqual(SERIES_2024);
    // No resolve reads on the create path.
    expect(resolveFetch.filters).toEqual([]);
    expect(seriesProbe.reads).toEqual([]);
    // The oracle CAN fire: the successful outcome applied the metadata.
    expect(updateCalls).toHaveLength(1);
  });

  it("POSITIVE: the INSTRUCTED retry resolves — same name, committed rows all inside the payload's range", async () => {
    // Window A's recovery: the prior attempt fully committed this very
    // submission; the retry must echo the existing id, not dead-end.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2024-01-31";
    seriesProbe.maxDate = "2024-03-29";

    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(EXISTING_ID);
    // The resolve arm persisted NOTHING itself (the dailies are guaranteed
    // present — the fold committed all-or-nothing): exactly ONE fold call,
    // which rolled back.
    expect(foldCalls()).toHaveLength(1);
    // WARNING 146.1-05 / A4 — CHANGED FROM 1 TO 0, deliberately, and this
    // line WAS the defect A4 closes. An echo is the SAME submission arriving
    // twice; applying THIS request's metadata to the already-committed row is
    // a mutation the user never asked for. See the A4 block at the end of
    // this file for the economic argument.
    expect(updateCalls).toEqual([]);
  });

  it("🔴 RED-TEAM RT-1: a SUPERSET file (appended month) is refused — containment is not identity", async () => {
    // Pre-fix, the outside-range probe passed whenever the committed range
    // sat INSIDE the payload's range — an appended-month re-export was echoed
    // ok:true and its series silently discarded. RED observed against the
    // pre-fix route: this test received the echo (200) instead of the 409.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.count = 2; // committed Jan–Feb…
    seriesProbe.minDate = "2025-01-31";
    seriesProbe.maxDate = "2025-02-28";

    const res = await post(SERIES_2025); // …payload appends March (3 rows)

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(updateCalls).toEqual([]);
  });

  it("🔴 RED-TEAM RT-2: a series payload against a ZERO-dailies committed row is refused, never echoed", async () => {
    // The vacuous edge: with zero committed rows, no row can be 'outside'
    // any range, so the pre-fix probe passed and the route echoed ok:true —
    // discarding the series AND enqueueing analytics against an empty
    // strategy (an fmt='trades' row or a pre-fold window-C orphan under a
    // surviving session id). RED observed against the pre-fix route.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.count = 0;
    seriesProbe.minDate = null;
    seriesProbe.maxDate = null;

    const res = await post(SERIES_2024);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(updateCalls).toEqual([]);
  });

  it("an EMPTY payload against a series-bearing committed row is refused (the old fence skipped empty payloads)", async () => {
    // fmt='trades' retry semantics: echo only when the committed series is
    // ALSO empty. A committed 3-row series vs an empty payload is a
    // different file, not the instructed retry.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2024-01-31";
    seriesProbe.maxDate = "2024-03-29";

    // fmt='trades' — an empty daily_returns payload 400s upstream (WR-04),
    // so the trades shape is the only one that reaches the resolve arm empty.
    const res = await POST(
      new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
        method: "POST",
        body: JSON.stringify({
          wizard_session_id: SESSION,
          fmt: "trades",
          strategy_name: "Alpha",
          daily_returns_series: [],
          metadata: { description: "cr01 oracle marker" },
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(updateCalls).toEqual([]);
  });

  it("a FAILED resolve read fails CLOSED — a read we could not make is never read as 'nothing is there'", async () => {
    // supabase-js RESOLVES on a read failure rather than throwing, so an
    // unchecked binding is `null` here and looks exactly like "no stale
    // rows". That is the C-3 defect this fence's original version closed;
    // the moved arm must not re-open it (a fence that cannot run must
    // refuse, not pass).
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.error = { code: "57014", message: "statement timeout" };

    const res = await post(SERIES_2025);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(
      updateCalls,
      "the route applied this submission's metadata after failing to " +
        "establish whether resolving was safe",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 146.1-04 / B3 — WHICH 23505 EARNS THE RESOLVE ARM
// ---------------------------------------------------------------------------

/**
 * The fold's dailies INSERT is a plain INSERT with no `ON CONFLICT`, so a
 * duplicate-date payload raises 23505 on `csv_daily_returns_strategy_date_key`
 * (migration 20260624120000:55-56) — a SECOND, real source of this SQLSTATE on
 * this path. Undiscriminated, it entered the resolve arm, found no committed
 * row and answered 503 "try again shortly": a retry invitation for a permanent
 * input defect that will fail identically forever.
 *
 * ⭐ THE ORACLE IS BEHAVIOURAL. Every case below asserts on whether the
 * `strategies` re-fetch was ISSUED (`resolveFetch.filters`) and on the write
 * vector (`updateCalls`) — never on whether the source contains a particular
 * `if`. A test that asserts the shape of the fix cannot detect a fix that is
 * wired to nothing.
 */

/** The dailies unique index (20260624120000:55-56) — the second 23505 source. */
const DAILIES_DUP_KEY_ERROR = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "csv_daily_returns_strategy_date_key"',
};

/** The SUPERSEDED session index (20260602190000:52), still listed by the leaf. */
const SUPERSEDED_DUP_KEY_ERROR = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "strategies_user_wizard_session_uniq"',
};

/** A 23505 carrying no parseable constraint name → `pgConstraintName` = null. */
const UNPARSEABLE_DUP_KEY_ERROR = {
  code: "23505",
  message: "duplicate key value violates a unique constraint",
};

/** Drive the fold into a 23505 carrying an ARBITRARY error shape. */
function arm23505With(
  err: { code?: string; message?: string },
  row: { id: string; name?: string; status?: string } | null,
) {
  rpcMock.mockImplementation(async (name: string) => {
    if (name === "finalize_csv_strategy_with_returns") {
      return { data: null, error: err };
    }
    return { data: null, error: null };
  });
  resolveFetch.row = row;
}

/** Every Sentry step tag captured during the request, in order. */
function sentrySteps(): string[] {
  return vi
    .mocked(captureToSentry)
    .mock.calls.map(
      (c) => (c[1] as { tags?: { step?: string } } | undefined)?.tags?.step ?? "",
    );
}

describe("[146.1-04 / B3] the 23505 branch enters the resolve arm only for a wizard-session fence", () => {
  it("ANTI-REGRESSION: the session constraint STILL resolves — the re-fetch is issued", async () => {
    arm23505With(DUP_KEY_ERROR, {
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
    });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2024-01-31";
    seriesProbe.maxDate = "2024-03-29";

    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    expect(
      resolveFetch.filters,
      "B3 narrowed the predicate so far that the ONE 23505 the arm exists " +
        "for no longer reaches it — the instructed retry now dead-ends",
    ).toHaveLength(1);
  });

  it("the SUPERSEDED session constraint name still resolves (older databases)", async () => {
    arm23505With(SUPERSEDED_DUP_KEY_ERROR, {
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
    });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2024-01-31";
    seriesProbe.maxDate = "2024-03-29";

    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    expect(resolveFetch.filters).toHaveLength(1);
  });

  it("🔴 THE DAILIES-INDEX 23505 does NOT enter the resolve arm and is not answered with a retry invitation", async () => {
    // A duplicate-date payload that slipped the route boundary raises 23505 on
    // the dailies index. Resolving it is meaningless — there is no committed
    // strategy this session collided with — and the arm's fail-closed 503 tells
    // the user to "try again shortly" for a defect that is permanent.
    arm23505With(DAILIES_DUP_KEY_ERROR, {
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
    });

    const res = await post(SERIES_2024);

    expect(
      resolveFetch.filters,
      "the strategies re-fetch was issued for a 23505 that named the DAILIES " +
        "index — the wrong arm is deciding this request",
    ).toEqual([]);
    expect(seriesProbe.reads).toEqual([]);
    expect(
      res.status,
      "a permanent payload defect was answered with the resolve arm's " +
        "retryable 503 ('try again shortly')",
    ).not.toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(
      body.code,
      "the dailies-index 23505 must fall through to the fold-failure arm",
    ).toBe("CSV_FINALIZE_FAIL");
    expect(
      updateCalls,
      "this submission's metadata was written despite the fold rolling back",
    ).toEqual([]);
  });

  it("an UNPARSEABLE 23505 STILL enters the resolve arm — null is UNKNOWN, not 'no constraint'", async () => {
    // `pgConstraintName` returns null when it could not READ a name, not when
    // no constraint was violated. Pre-existing behaviour for UNKNOWN is
    // any-23505 → resolve, and the arm already fails CLOSED (503) when it finds
    // no committed row. Making null bypass the arm converts that fail-closed
    // 503 into a fail-open 500 carrying the wrong copy.
    arm23505With(UNPARSEABLE_DUP_KEY_ERROR, {
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
    });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2024-01-31";
    seriesProbe.maxDate = "2024-03-29";

    const res = await post(SERIES_2024);

    expect(
      resolveFetch.filters,
      "an unparseable 23505 skipped the resolve arm — the leaf's UNKNOWN " +
        "contract was 'simplified' away",
    ).toHaveLength(1);
    expect(res.status).toBe(200);
  });

  it("a NAMED-but-unrecognised constraint is FAIL-LOUD: a distinct Sentry step tag carries the name", async () => {
    // Silence here would bury the arrival of a new constraint on this path
    // inside a generic fold failure. The name is safe to tag: it comes from
    // `message`, which Postgres composes from catalog names only.
    arm23505With(DAILIES_DUP_KEY_ERROR, {
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
    });

    await post(SERIES_2024);

    const steps = sentrySteps();
    expect(
      steps,
      "no capture named the unrecognised constraint — the class is silent",
    ).toContain("finalize-23505-unknown-constraint");
    expect(steps).not.toContain("finalize-resolve-refused");
    expect(steps).not.toContain("finalize-resolve-read-fail");
    const named = vi
      .mocked(captureToSentry)
      .mock.calls.find(
        (c) =>
          (c[1] as { tags?: { step?: string } } | undefined)?.tags?.step ===
          "finalize-23505-unknown-constraint",
      );
    const extra = (named?.[1] as { extra?: Record<string, unknown> } | undefined)
      ?.extra;
    expect(extra?.constraint).toBe("csv_daily_returns_strategy_date_key");
    expect(extra?.pg_code).toBe("23505");
  });
});

// ---------------------------------------------------------------------------
// 146.1-04 / A2 + C4 — TERMINAL STATUS, AND THE TWO FAIL-CLOSED PATHS
// ---------------------------------------------------------------------------

/**
 * A2 — THE CROSS-FLOW ECHO. This is an access-control defect (ASVS V4), not a
 * cosmetic one.
 *
 * The partial unique index the 23505 fires on is
 * `(user_id, wizard_session_id, source) WHERE wizard_session_id IS NOT NULL`
 * (20260728120000:167-169). `status` is NOT in the key. And
 * `src/lib/wizard/localStorage.ts` restores `wizard_session_id`
 * unconditionally from ONE shared storage key, so the manager flow and the
 * CONTRIB-02 contribution flow can arrive carrying the SAME session id.
 *
 * So a manager-flow resubmit (terminal status 'pending_review' — the admin
 * publish queue's membership predicate) could resolve onto a row committed as
 * 'private' and be echoed 200. The row's own status was then echoed back, so
 * the caller was told "saved" for a strategy that will never enter the review
 * queue — and in the other direction an owner-only contribution's id is handed
 * to the manager flow.
 *
 * ⛔ The refusal reuses the EXISTING `refuse()` closure. Minting a code here
 * would move `KNOWN_CSV_FINALIZE_CODES`, `EXPECTED_TABLE_SIZE` and the
 * vocabulary invariant in the same commit, for a state the user cannot act on
 * differently.
 */

/** POST as the CONTRIB-02 contribution flow (terminal status 'private'). */
function postContribution(
  series: Array<{ date: string; daily_return: number }>,
) {
  return POST(
    new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
      method: "POST",
      body: JSON.stringify({
        wizard_session_id: SESSION,
        fmt: "daily_returns",
        strategy_name: "Alpha",
        daily_returns_series: series,
        metadata: { description: "cr01 oracle marker" },
        entry_context: "contribution",
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}

/** The reason string every `refuse()` capture carries in its Error message. */
function refusalReasons(): string[] {
  return vi
    .mocked(captureToSentry)
    .mock.calls.filter(
      (c) =>
        (c[1] as { tags?: { step?: string } } | undefined)?.tags?.step ===
        "finalize-resolve-refused",
    )
    .map((c) => (c[0] as Error).message);
}

/** The committed series that makes an identical-retry resolve succeed. */
function armCommitted2024() {
  seriesProbe.count = 3;
  seriesProbe.minDate = "2024-01-31";
  seriesProbe.maxDate = "2024-03-29";
}

describe("[146.1-04 / A2] the resolve arm refuses a TERMINAL-STATUS mismatch", () => {
  it("🔴 manager resubmit onto a committed 'private' contribution row is REFUSED", async () => {
    // Without this, the manager flow is handed an owner-only contribution's id
    // and told it was saved — and the strategy never enters the admin review
    // queue, because 'private' is not the queue's membership predicate.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "private" });
    armCommitted2024();

    const res = await post(SERIES_2024);

    expect(
      res.status,
      "a manager-flow submission was answered with a 'private' row's id — a " +
        "cross-flow echo, and the strategy will never reach the review queue",
    ).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(
      updateCalls,
      "this submission's metadata was applied to a row belonging to the " +
        "other flow",
    ).toEqual([]);
    expect(sentrySteps()).toContain("finalize-resolve-refused");
  });

  it("🔴 THE OTHER DIRECTION: a contribution resubmit onto a committed 'pending_review' row is REFUSED", async () => {
    // Both directions, deliberately. One-direction-only coverage lets a
    // half-fix ship green.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    armCommitted2024();

    const res = await postContribution(SERIES_2024);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(updateCalls).toEqual([]);
  });

  it("POSITIVE: a contribution retry onto its OWN 'private' row still 200-echoes", async () => {
    // The counterpart that keeps the refusal from being refuse-everything.
    // Without it, A2 is satisfied by an arm that dead-ends every resubmit.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "private" });
    armCommitted2024();

    const res = await postContribution(SERIES_2024);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(EXISTING_ID);
    expect(body.status).toBe("private");
    // 146.1-05 / A4 — an echo writes no metadata (was 1 before A4).
    expect(updateCalls).toEqual([]);
  });

  it("an ABSENT status column is NOT read as a mismatch — absence is not a value", async () => {
    // The guard mirrors the name check's `typeof === "string" &&` shape for
    // exactly this reason. A guard that refuses every row whose `status` did
    // not come back would ship green without this case.
    //
    // ⚠️ 146.2-01 / A2 RESIDUAL RE-CUT THE OUTCOME, NOT THE RULE. This arm used
    // to assert `200` + `ok:true`, which pinned the echo that the SAME absence
    // then reported as `status: existingRow.status ?? "pending_review"` — a
    // value nobody read. Both halves of A2's discipline are now enforced and
    // they point at DIFFERENT answers: an absent reading is not an observed
    // MISMATCH (so: never the 409 refusal this arm guards), and it is not an
    // observed STATUS either (so: no echo, fail closed). What this arm pins is
    // the first half, and it still discriminates — an A2 check that dropped its
    // `typeof` guard would answer 409 / CSV_SESSION_REUSED here, not 503.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: undefined });
    armCommitted2024();

    const res = await post(SERIES_2024);

    const body = await res.json();
    expect(
      body.code,
      "a row with no readable status was refused as though a mismatch had " +
        "been OBSERVED — absence rendered as a measurement",
    ).not.toBe("CSV_SESSION_REUSED");
    expect(
      sentrySteps(),
      "the resolve arm reported a REFUSAL for a status it never read",
    ).not.toContain("finalize-resolve-refused");
    // The other half: unconfirmable, so nothing is echoed.
    expect(res.status).toBe(503);
    expect(body.code).toBe("CSV_PERSIST_FAIL");
  });

  it("the STATUS comparison runs BEFORE the name check — the reason names the flow, not the name", async () => {
    // A manager request landing on a 'private' row is a wrong-FLOW answer
    // whether or not the names happen to differ too. If the name check spoke
    // first the Sentry reason would send an operator hunting a rename.
    arm23505({ id: EXISTING_ID, name: "Renamed", status: "private" });
    armCommitted2024();

    const res = await post(SERIES_2024);

    expect(res.status).toBe(409);
    const reasons = refusalReasons();
    expect(reasons).toHaveLength(1);
    expect(
      reasons[0],
      "the refusal was attributed to the NAME while the actual fact is that " +
        "two different product flows collided on one session fence",
    ).toMatch(/terminal status/i);
    expect(reasons[0]).not.toMatch(/name mismatch/i);
  });
});

describe("[146.1-04 / C4] both resolve-arm fail-closed paths answer 503 and write NOTHING", () => {
  it("C4a — a FAILED strategies re-fetch fails closed (503) and issues zero metadata updates", async () => {
    // supabase-js RESOLVES on a read failure rather than throwing, so an
    // unchecked binding reads as "no row" — a read we could not make rendered
    // as a measurement. Asserting only the status code would miss a
    // fail-closed path that still issued the metadata UPDATE.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    resolveFetch.error = { code: "57014", message: "statement timeout" };

    const res = await post(SERIES_2024);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(
      updateCalls,
      "the route applied this submission's metadata after failing to read " +
        "what is already committed",
    ).toEqual([]);
    expect(sentrySteps()).toContain("finalize-resolve-read-fail");
  });

  it("C4b — a re-fetch that finds NO committed row fails closed (503), never fabricates an echo", async () => {
    // A 23505 with nothing to resolve to: a TOCTOU delete, an RLS hide, or a
    // non-session 23505 that slipped every upstream gate. We cannot establish
    // what exists, so we refuse.
    arm23505(null);

    const res = await post(SERIES_2024);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(updateCalls).toEqual([]);
  });

  it("C4b — a re-fetch row whose id is NOT a uuid fails closed too", async () => {
    arm23505({ id: "not-a-uuid", name: "Alpha", status: "pending_review" });

    const res = await post(SERIES_2024);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(updateCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 146.1-04 / C1 — THE ECHO SAYS WHAT WAS COMPARED, AND NOTHING MORE
// ---------------------------------------------------------------------------

/**
 * The resolve arm makes exactly TWO reads of the committed series: its row
 * COUNT and its [min, max] date boundaries. It does not read a single daily
 * value. The residual is documented and ACCEPTED in the route: equal count and
 * equal boundaries with different interior values still echoes 200.
 *
 * ⚖️ FOUNDER CALL (C1): option (b) — honest copy — ships. Option (a), a content
 * hash over the payload, would close the residual but needs persisted state: a
 * third migration in a phase already carrying two, a backfill for every
 * already-committed row, and a nullable-hash fail-open period. It is filed in
 * TODOS.md with that cost.
 *
 * ⭐ THE ASSERTION IS ON ABSENCE. A presence-only check ("does it contain the
 * new sentence?") is satisfied by CONCATENATING the new sentence onto the old
 * over-claiming one — the same hole as the `%5000%` substring failure. Both
 * polarities are asserted here.
 */

/**
 * Claims the arm CANNOT make from a count and two boundary dates. Each is a
 * sentence a reader would act on: "verified" and "confirmed" assert an
 * observation, "identical"/"element by element"/"matches the file you
 * submitted" assert equality of the interior values specifically.
 */
const OVERCLAIM_PHRASES: RegExp[] = [
  /\bverified\b/i,
  /\bconfirmed\b/i,
  /\bidentical\b/i,
  /element[\s-]by[\s-]element/i,
  /matches (?:the )?(?:file|series|track record) you (?:submitted|uploaded)/i,
  /\bevery (?:row|value|daily)\b/i,
];

describe("[146.1-04 / C1] the 200 echo states what was compared and does not over-claim", () => {
  it("the resolve echo carries copy naming BOTH reads and admitting what was not read", async () => {
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    armCommitted2024();

    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(
      typeof body.human_message,
      "the 200 echo says nothing about what it compared, so a caller cannot " +
        "tell a fresh save from a resolve onto a row it never re-read",
    ).toBe("string");
    // What it DID read.
    expect(body.human_message).toMatch(/row count/i);
    expect(body.human_message).toMatch(/first and last date/i);
    // ⭐ What it did NOT read — the admission is the whole point of C1.
    expect(
      body.human_message,
      "the echo does not admit that the individual daily values were never " +
        "compared, which is precisely the residual the arm accepts",
    ).toMatch(/not the individual daily values/i);
  });

  it("🔴 ABSENCE: the echo carries NO claim the two reads cannot support", async () => {
    // ⛔ This is the assertion that survives CONCATENATION. Restoring an
    // over-claiming sentence ALONGSIDE the honest one leaves every presence
    // check above green and REDs only here.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    armCommitted2024();

    const res = await post(SERIES_2024);
    const body = await res.json();
    const msg = String(body.human_message ?? "");

    for (const phrase of OVERCLAIM_PHRASES) {
      expect(
        msg,
        `the 200 echo asserts ${phrase} — an observation the arm never made. ` +
          "It read a row count and two boundary dates; it read no daily value " +
          "at all, and a caller acting on this sentence is acting on a claim " +
          "the server cannot support.",
      ).not.toMatch(phrase);
    }
  });

  it("a FRESH create carries no such note — nothing was resolved, so nothing was compared", async () => {
    // The discrimination that keeps the note honest in the other direction: a
    // first submit really did write this payload, and telling that caller
    // "we compared boundaries" would be its own fabricated observation.
    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.human_message).toBeUndefined();
  });

  it("BEHAVIOUR UNCHANGED: equal count and boundaries with different interior values still echoes 200", async () => {
    // C1 is a COPY change, not a refusal change. The residual stays open by
    // decision; what changed is that the envelope stops implying it is closed.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    seriesProbe.count = 3;
    seriesProbe.minDate = "2024-01-31";
    seriesProbe.maxDate = "2024-03-29";

    // Same dates, DIFFERENT returns — indistinguishable to a count + boundary
    // read, and accepted as such.
    const res = await post([
      { date: "2024-01-31", daily_return: 0.99 },
      { date: "2024-02-29", daily_return: -0.5 },
      { date: "2024-03-29", daily_return: 0.42 },
    ]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(EXISTING_ID);
  });
});

// ---------------------------------------------------------------------------
// 146.1-05 / A4 — AN ECHO MUST NOT REWRITE THE COMMITTED ROW'S METADATA
// ---------------------------------------------------------------------------

/**
 * A 23505 resolve echo means exactly this: a PRIOR attempt for this (user,
 * wizard_session, source='csv') already committed, and THIS attempt's own
 * writes rolled back completely. The route nevertheless ran
 * `applyCsvMetadataUpdate` with THIS request's metadata against the committed
 * row.
 *
 * THE ECONOMIC ORACLE — why this is money math, not hygiene. `asset_class`
 * decides the annualization clock: sqrt(365) for crypto, sqrt(252) for
 * traditional (#597 part 2), and `buildMetadataUpdatePayload` persists the
 * picker choice VERBATIM. The KPIs — Sharpe, Sortino, Calmar, CAGR — are
 * computed by the analytics worker from the dailies the FIRST submission
 * committed, under the clock THAT submission declared. So a retry that flips
 * `asset_class` rewrote the label while the stored numbers kept the old
 * convention: a Sharpe computed on 252 and displayed as a 365 crypto track
 * record. Nothing in the system reconciles the two. For `fmt='trades'` the
 * enqueue gate (`dailyReturnsSeries.length > 0`) means no recompute is even
 * scheduled, so the mismatch is permanent — on a product whose whole value is
 * a verified track record.
 *
 * THE ORACLE IS THE WRITE VECTOR, NEVER THE RETURN VALUE. Every case below
 * drives the real route and watches `updateCalls`. Asserting `fresh === false`
 * on `FinalizeAtomicOutcome` would pass with the field wired to nothing at
 * all — testing the helper instead of the wiring.
 */

/** POST carrying an ARBITRARY metadata block (the A4 cases need asset_class). */
function postWithMetadata(
  series: Array<{ date: string; daily_return: number }>,
  metadata: Record<string, unknown>,
) {
  return POST(
    new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
      method: "POST",
      body: JSON.stringify({
        wizard_session_id: SESSION,
        fmt: "daily_returns",
        strategy_name: "Alpha",
        daily_returns_series: series,
        metadata,
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}

/** Every rpc name the flushed `after()` callbacks issued on the admin client. */
function enqueuedRpcNames(): string[] {
  return enqueueRpcMock.mock.calls.map((c) => String(c[0]));
}

describe("[146.1-05 / A4] the metadata UPDATE belongs to the create, never to its echo", () => {
  it("POSITIVE: a FRESH create still applies this submission's asset_class", async () => {
    // Load-bearing. Without it, "skip the UPDATE on an echo" is
    // indistinguishable from "never UPDATE at all", and never-updating would
    // silently drop every CSV strategy's category, markets, description AND
    // its annualization clock.
    const res = await postWithMetadata(SERIES_2024, { asset_class: "crypto" });

    expect(res.status).toBe(200);
    expect(
      updateCalls,
      "the fresh create stopped writing its metadata — A4 gated the create " +
        "path instead of the echo path",
    ).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({ asset_class: "crypto" });
  });

  it("RED an echo against a CLASSIFIED row issues NO metadata UPDATE", async () => {
    // 146.2-01 / R1 NARROWED THIS ARM. It used to pin `updateCalls == []` for
    // EVERY echo, which did not merely miss R1 — it ASSERTED it: a row
    // committed with no classification at all could never receive one, so a
    // crypto track record stayed on the sqrt(252) column default forever. The
    // rule A4 actually needs is about a row that ALREADY carries the user's
    // classification: re-applying this request's metadata there would honour a
    // mutation the user never asked for.
    //
    // `category_id` is the never-classified discriminator (the fixture declares
    // a real UUID here, and the request sends the SAME one — `parseCsvMetadata`
    // drops a non-UUID category_id, which would make the request side absent
    // rather than matching).
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: CATEGORY_ID,
      asset_class: "crypto",
    });
    armCommitted2024();

    const res = await postWithMetadata(SERIES_2024, {
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(
      updateCalls,
      "the echo rewrote the already-committed row with THIS request's " +
        "metadata — a mutation applied to a row the user had already " +
        "committed, on a submission the route itself reports as 'nothing " +
        "new was written'",
    ).toEqual([]);
  });

  it("RED ECONOMIC ORACLE: a retry that FLIPS asset_class cannot rewrite the annualization clock", async () => {
    // The committed row was saved as a TRADITIONAL track record and its
    // stored KPIs were computed on sqrt(252). This retry declares 'crypto'
    // (sqrt(365)). If the UPDATE lands, the row claims 365 while every
    // persisted Sharpe/Sortino/CAGR still carries 252 — and no recompute
    // reconciles them (for fmt='trades' none is even enqueued).
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    armCommitted2024();

    await postWithMetadata(SERIES_2024, { asset_class: "crypto" });

    const clockWrites = updateCalls.filter((c) => "asset_class" in c.payload);
    expect(
      clockWrites,
      "a retry rewrote the committed strategy's annualization clock while " +
        "its stored KPIs keep the OLD convention — a Sharpe computed on 252 " +
        "presented as a 365 crypto track record",
    ).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it("the analytics enqueue STILL fires on a FRESH create", async () => {
    // A4 gates ONE side effect. This is the arm that reds if it gated the
    // fan-out wholesale, which would leave the strategy polling forever.
    await postWithMetadata(SERIES_2024, { asset_class: "crypto" });
    await flushAfter();

    expect(enqueuedRpcNames()).toContain("enqueue_compute_job");
  });

  it("the analytics enqueue STILL fires on an ECHO — A4 gates the UPDATE, not the enqueue", async () => {
    // Deliberate: re-enqueueing an echo is harmless-to-good (Phase 143's
    // sweep would do it anyway), and a series-bearing echo whose first
    // attempt lost its enqueue is exactly the case that needs it.
    arm23505({ id: EXISTING_ID, name: "Alpha", status: "pending_review" });
    armCommitted2024();

    await postWithMetadata(SERIES_2024, { asset_class: "crypto" });
    await flushAfter();

    expect(
      enqueuedRpcNames(),
      "A4 skipped the enqueue along with the UPDATE — an echo whose first " +
        "attempt lost its enqueue now never computes",
    ).toContain("enqueue_compute_job");
  });
});

// ---------------------------------------------------------------------------
// 146.2-01 / R1 — THE ECHO PATH MUST NOT SILENTLY DROP THE CLASSIFICATION
// ---------------------------------------------------------------------------

/**
 * The recovery A3's own copy instructs ("submit the same file again — an
 * unchanged resubmit from this wizard resolves to the strategy you already
 * started") lands on the 23505 resolve arm. When the FIRST attempt committed
 * the row but died before the metadata UPDATE, that row carries NO
 * classification at all — and A4's echo gate skipped the UPDATE, so the user's
 * choice was dropped for good: `asset_class` stayed at the column default
 * ('traditional' ⇒ sqrt(252)) while the file was a crypto track record, and
 * `category_id` stayed NULL so the row never entered discovery. There is no
 * post-creation editor for either field, so the user cannot repair it.
 *
 * ⭐ THE DISCRIMINATOR IS `category_id IS NULL`, NEVER `asset_class`.
 * `strategies.asset_class` is `NOT NULL DEFAULT 'traditional'`
 * (20260709130000:26-27), so on that column "never classified" and "the user
 * chose traditional" are the SAME stored value — filling there would overwrite
 * a legitimate choice, which is precisely what the ECONOMIC ORACLE above
 * forbids. `category_id` has no default and the fold's INSERT never writes it,
 * while `applyCsvMetadataUpdate` writes BOTH fields in one atomic UPDATE — so a
 * committed NULL is observable proof that UPDATE never ran.
 *
 * ⭐ THE CLOCK-SAFETY GUARD (the empty-series arms). Filling `asset_class` MOVES
 * the annualization clock. On a series-bearing echo that is safe because the
 * enqueue still fires after the awaited UPDATE, so the stored KPIs recompute
 * under the filled clock. On an fmt='trades' echo NO recompute is scheduled
 * (the enqueue is gated on `dailyReturnsSeries.length > 0`), so the route must
 * MEASURE — on this request, against this strategy — whether stored KPIs
 * already exist, and refuse if they do. The measured columns are exactly the
 * seven `PERCENTILE_ANALYTICS_COLUMNS` that rankings fold (queries.ts:126-127).
 * A refusal writes NOTHING: a `category_id`-only partial fill would promote the
 * row into discovery and make KPIs computed under a DIFFERENT clock reachable
 * in listings and percentile ranks.
 */

/** POST an fmt='trades' submission — the format that produces NO series, and
 * therefore the echo on which no recompute will follow the clock. */
function postTradesWithMetadata(metadata: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost:3000/api/strategies/csv-finalize", {
      method: "POST",
      body: JSON.stringify({
        wizard_session_id: SESSION,
        fmt: "trades",
        strategy_name: "Alpha",
        daily_returns_series: [],
        metadata,
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}

/** The measured PROD shape of the historical failed-with-KPIs class: 7 of the
 * 22 csv strategies with zero dailies carry a non-null `sharpe` AND `cagr` on a
 * `computation_status='failed'` analytics row, computed 2026-05-27 under
 * sqrt(252). Their KPIs are read UNGATED by the discovery listing
 * (StrategyTable.tsx:1091) and folded into percentile ranks
 * (getPercentiles, queries.ts). */
const PROD_FAILED_WITH_KPIS = {
  cagr: 0.32,
  sharpe: 1.41,
  sortino: null,
  calmar: null,
  max_drawdown: null,
  volatility: null,
  cumulative_return: null,
  computation_status: "failed",
};

describe("[146.2-01 / R1] an echo FILLS an absent classification and REFUSES a conflicting one", () => {
  it("RED FILL: an echo against a row committed with NO classification lands this request's clock", async () => {
    // The R1 chain: the fold committed, the connection died before the metadata
    // UPDATE, and the user did what the failure copy told them to do.
    // `category_id: null` is the proof that UPDATE never ran; `asset_class`
    // reads the column DEFAULT, which is not a user choice.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    armCommitted2024();

    const res = await postWithMetadata(SERIES_2024, {
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    await flushAfter();

    expect(res.status).toBe(200);
    expect(
      updateCalls,
      "the recovery resubmit dropped the user's classification — the crypto " +
        "track record keeps the 'traditional' column default, so its KPIs are " +
        "annualized sqrt(252) and published as 'Verified', with no editor " +
        "anywhere in the product that could repair it",
    ).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    // THE ECONOMIC PAIR: the clock lands AND the recompute rides it. A FILL
    // without the enqueue would relabel the row as crypto while every stored
    // Sharpe/Sortino/CAGR kept the sqrt(252) convention.
    expect(
      enqueuedRpcNames(),
      "the clock moved but nothing recomputes the KPIs under it — the same " +
        "mismatch the ECONOMIC ORACLE forbids, arrived at from the other side",
    ).toContain("enqueue_compute_job");
  });

  it("RED REFUSE: an echo whose classification CONFLICTS with the committed one is a 409 with zero writes", async () => {
    // The committed row IS classified, and differently. This is not a dropped
    // classification to repair — it is a mutation, and the stored KPIs were
    // computed under the committed clock.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: OTHER_CATEGORY_ID,
      asset_class: "traditional",
    });
    armCommitted2024();

    const res = await postWithMetadata(SERIES_2024, {
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(
      updateCalls,
      "a conflicting resubmit rewrote the committed row's classification — " +
        "the 409's 'we refused before writing anything' copy would be a lie",
    ).toEqual([]);
    // SEAMUX-04: the sentence must describe THIS refusal. The default 409
    // sentence talks about "a different track record", which is not what
    // happened here — the file is identical, the CLASSIFICATION is not.
    expect(typeof body.human_message).toBe("string");
    expect(
      String(body.human_message).toLowerCase(),
      "the refusal reused the different-track-record sentence for a " +
        "classification conflict — the user is told the wrong thing about " +
        "their own submission",
    ).toContain("classification");
  });

  it("RED TRADES FILL (KPIs measured ABSENT): an empty-series echo fills both fields and enqueues nothing", async () => {
    // fmt='trades' produces no series, so no recompute follows this echo. The
    // guard READ the strategy's analytics row on THIS request and found none —
    // a MEASURED absence, not an assumed one. Nothing exists that the missing
    // recompute could leave stale, so the FILL is clock-safe.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });

    const res = await postTradesWithMetadata({
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    await flushAfter();

    expect(res.status).toBe(200);
    expect(
      updateCalls,
      "the trades recovery resubmit dropped the classification — same R1 " +
        "defect, on the one fmt where no recompute would ever have healed it",
    ).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    expect(
      enqueuedRpcNames(),
      "an empty-series submission scheduled a compute job — there are no " +
        "dailies for it to read",
    ).not.toContain("enqueue_compute_job");
    expect(
      analyticsProbe.reads,
      "the FILL happened without the guard ever reading strategy_analytics — " +
        "clock safety was assumed rather than measured",
    ).toEqual([EXISTING_ID]);
  });

  it("RED TRADES REFUSE (KPIs measured PRESENT): stored KPIs on an empty-series echo refuse 409 and write nothing", async () => {
    // The historical PROD class: a zero-dailies strategy whose failed analytics
    // row nonetheless carries a sharpe and a cagr computed under sqrt(252).
    // FILLing here would move the clock with no recompute AND promote the row
    // into discovery, where those stale numbers are read ungated.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    analyticsProbe.row = { ...PROD_FAILED_WITH_KPIS };

    const res = await postTradesWithMetadata({
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    await flushAfter();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(
      updateCalls,
      "the clock moved over stored KPIs that nothing will recompute, AND the " +
        "category_id write promoted the row into discovery — a Sharpe " +
        "computed on 252 now ranks in the listings under a crypto label",
    ).toEqual([]);
    expect(enqueuedRpcNames()).toEqual([]);
    expect(typeof body.human_message).toBe("string");
  });

  it("RED A2 RESIDUAL: a committed row whose status did not come back fails closed instead of echoing 'pending_review'", async () => {
    // The arm's own comment says "reporting a status we did not read would be
    // fabricating an observation" — while `?? "pending_review"` did exactly
    // that. A contribution ('private') could be reported as being in the admin
    // review queue on the strength of a fallback nobody measured.
    arm23505({ id: EXISTING_ID, name: "Alpha" });
    armCommitted2024();

    const res = await postWithMetadata(SERIES_2024, { asset_class: "crypto" });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(
      JSON.stringify(body),
      "the echo reported a terminal status it never read — the fabricated " +
        "'pending_review' is indistinguishable from a measured one",
    ).not.toContain("pending_review");
    expect(updateCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 146.2-02 — REVIEW-BLOCKER CLOSURE ON THE FILL ARM 146.2-01 INTRODUCED
// ---------------------------------------------------------------------------

/**
 * Two data-integrity defects the phase's own code review found in the arm
 * above. Both are about the same thing from two directions: the FILL arm makes
 * a CLAIM it has not established.
 *
 * BL-01 — IT CLAIMS THE REPAIR HAPPENED. `applyCsvMetadataUpdate` answered
 * `null` on a FAILED UPDATE (it logged and captured to Sentry, then returned
 * the same value a success returns), and the call site only tested for a
 * response object. So a 42501 on the fill answered 200 carrying "…so we applied
 * them to it now." A user who is told the repair landed does not retry, and the
 * crypto track record keeps `asset_class 'traditional'` — sqrt(252) on
 * sqrt(365) returns — permanently, with no post-creation editor to fix it. That
 * is strictly worse than the R1 bug it replaced, which said nothing at all.
 *
 * BL-02 — IT CLAIMS THE RECONCILIATION WILL HAPPEN. The series-bearing arm
 * filled unguarded on the premise "the recompute is the reconciliation", while
 * the empty-series arm MEASURED the stored KPIs and refused. But the recompute
 * is an `after()` enqueue — the exact side effect Phase 143's sweep exists
 * because it DROPS. And a drop after a fill is unhealable: the placeholder
 * writer returns early on a terminal success, and the Phase 143 sweep excludes
 * `computation_status IN (…,'complete',…)`. The steady state is a
 * crypto-labelled, discovery-visible, `complete` row whose Sharpe and CAGR were
 * computed on sqrt(252) — precisely what the empty-series arm refuses to
 * create.
 *
 * THE ECONOMIC INVARIANT BOTH ARMS SERVE, stated independently of any
 * implementation: a strategy's stored KPIs and its `asset_class` label must
 * name the SAME annualization clock — sqrt(365) for crypto, sqrt(252) for
 * traditional (#597 part 2). The route may only move that label when it has
 * established that nothing stale is left wearing the old one. "Established" is
 * a measurement or a guarantee; it is never a premise about a scheduled job.
 */
describe("[146.2-02 / BL-01] a FILL that did not land cannot be reported as applied", () => {
  it("🔴 the metadata UPDATE FAILS on the FILL arm — the echo must not answer 200 'we applied them to it now'", async () => {
    // The R1 chain, with the repair itself failing: RLS denies the UPDATE.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    armCommitted2024();
    updateOutcome.error = {
      code: "42501",
      message: "new row violates row-level security policy",
    };

    const res = await postWithMetadata(SERIES_2024, {
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    await flushAfter();

    // The write vector, not the return value: the UPDATE was genuinely
    // attempted, so this arm cannot pass by declining to write.
    expect(
      updateCalls,
      "the fill never issued the UPDATE at all — this case is not testing " +
        "the failure path it claims to test",
    ).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({ asset_class: "crypto" });

    expect(
      res.status,
      "a FAILED classification repair answered 200 — the crypto track record " +
        "keeps the 'traditional' clock (sqrt(252) on sqrt(365) returns) and " +
        "the user, told it was repaired, will never retry",
    ).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(
      String(body.human_message ?? ""),
      "the refusal reused the FILL's success copy — it still tells the user " +
        "their classification was applied",
    ).not.toContain("so we applied them to it now");
    // SEAMUX-04: state the fact and put a non-destructive next step ahead of
    // the resubmit. The fill is idempotent — `category_id` still reads NULL.
    expect(String(body.human_message ?? "").toLowerCase()).toContain(
      "did not land",
    );
  });

  it("ANTI-REGRESSION: a FAILED UPDATE on a FRESH CREATE is still non-fatal — the persisted row is not rolled back", async () => {
    // Load-bearing counterweight. BL-01's fix must NOT change the long-standing
    // create-path semantics: `finalize_csv_strategy_with_returns` already
    // committed the strategy and its dailies, so answering 503 there would tell
    // the user nothing was saved while a strategy sits in their account. If
    // this arm reds, the fix leaked out of the arm 146.2-01 introduced.
    updateOutcome.error = {
      code: "42501",
      message: "new row violates row-level security policy",
    };

    const res = await postWithMetadata(SERIES_2024, { asset_class: "crypto" });

    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
  });

  it("🔴 an echo carrying NO classification is not a FILL — it neither claims one nor mutates the committed row", async () => {
    // `fillClassification` widens the metadata gate. With nothing to fill, that
    // widened gate wrote this request's OTHER metadata onto a row a PRIOR
    // request committed — the mutation-on-an-echo A4 forbids — while the copy
    // told the user their category and asset class had been applied. Neither
    // field is in this payload; `description` is, and it must not land.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    armCommitted2024();

    const res = await postWithMetadata(SERIES_2024, {
      description: "a mutation the user never asked for",
    });

    expect(res.status).toBe(200);
    expect(
      updateCalls,
      "an echo with no classification to fill still rewrote the committed " +
        "row's metadata — A4's rule, breached through the fill arm's gate",
    ).toEqual([]);
    const body = await res.json();
    expect(
      String(body.human_message ?? ""),
      "the echo claimed a classification repair on a request that carried no " +
        "classification",
    ).not.toContain("so we applied them to it now");
  });
});

describe("[146.2-02 / BL-02] the series-bearing FILL measures the clock safety it used to assume", () => {
  it("🔴 THE ECONOMIC CASE: a series-bearing fill over COMPLETE, sqrt(252)-computed KPIs is refused", async () => {
    // The committed row is never-classified (`category_id` NULL ⇒ the first
    // attempt's metadata UPDATE never ran) AND the worker already finished it:
    // `computation_status: 'complete'` with a real sharpe and cagr, computed
    // under the column default 'traditional' ⇒ sqrt(252).
    //
    // This request declares crypto ⇒ sqrt(365). Filling moves the LABEL. The
    // only thing that would move the NUMBERS is the `after()` enqueue, which is
    // not guaranteed to run — and if it drops, nothing heals it: the
    // placeholder writer returns early on a terminal success and the Phase 143
    // sweep excludes 'complete'. The row would sit crypto-labelled and
    // discovery-visible with sqrt(252) numbers, which is the exact state the
    // empty-series arm refuses to create.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    armCommitted2024();
    analyticsProbe.row = {
      ...PROD_FAILED_WITH_KPIS,
      computation_status: "complete",
    };

    const res = await postWithMetadata(SERIES_2024, {
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    await flushAfter();

    expect(
      analyticsProbe.reads,
      "the series-bearing fill never READ strategy_analytics — clock safety " +
        "was assumed from the arm it arrived on, not measured on this request",
    ).toEqual([EXISTING_ID]);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_SESSION_REUSED");
    expect(
      updateCalls,
      "the clock moved to crypto (sqrt(365)) over stored KPIs computed on " +
        "sqrt(252), on the strength of an after() enqueue that is not " +
        "guaranteed to run — and the category_id write promoted the row into " +
        "discovery, where those numbers are read ungated",
    ).toEqual([]);
    expect(
      enqueuedRpcNames(),
      "a refusal that writes nothing still scheduled a recompute",
    ).toEqual([]);
  });

  it("SYMMETRY: the empty-series arm still refuses the same state — the fix moved the guard UP, never down", async () => {
    // Non-negotiable direction check. If BL-02 had been "closed" by removing
    // the empty-series guard so the two arms agreed, this arm would go green
    // at 200 and the whole clock-safety rule would be gone.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    analyticsProbe.row = { ...PROD_FAILED_WITH_KPIS };

    const res = await postTradesWithMetadata({
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });

    expect(res.status).toBe(409);
    expect(updateCalls).toEqual([]);
  });

  it("POSITIVE: a series-bearing fill over MEASURED-ABSENT KPIs still lands the clock and rides the recompute", async () => {
    // The guard is a measurement, not a blanket refusal. `analyticsProbe.row`
    // is null — the read HAPPENED and found nothing — so no stored number
    // carries the old convention and the fill is clock-safe. Without this arm,
    // "refuse everything" would pass BL-02 while destroying R1's repair.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    armCommitted2024();

    const res = await postWithMetadata(SERIES_2024, {
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    await flushAfter();

    expect(res.status).toBe(200);
    expect(analyticsProbe.reads).toEqual([EXISTING_ID]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });
    expect(enqueuedRpcNames()).toContain("enqueue_compute_job");
  });

  it("a FAILED clock-safety read on the SERIES-BEARING arm fails CLOSED — an unmeasurable clock is never moved", async () => {
    // The empty-series arm already had this. Symmetry means the series-bearing
    // arm gets it too: a read we could not make is never read as "nothing is
    // there", because that reading is exactly the licence to move the clock.
    arm23505({
      id: EXISTING_ID,
      name: "Alpha",
      status: "pending_review",
      category_id: null,
      asset_class: "traditional",
    });
    armCommitted2024();
    analyticsProbe.error = { code: "PGRST301", message: "JWT expired" };

    const res = await postWithMetadata(SERIES_2024, {
      asset_class: "crypto",
      category_id: CATEGORY_ID,
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("CSV_PERSIST_FAIL");
    expect(updateCalls).toEqual([]);
  });
});
