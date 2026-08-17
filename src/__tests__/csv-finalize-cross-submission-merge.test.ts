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

/** The resolve arm's strategies re-fetch: row + error + recorded filters. */
const resolveFetch = vi.hoisted(() => ({
  row: null as { id: string; name?: string; status?: string } | null,
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

/** Metadata UPDATE recorder — the economic oracle's write vector. */
const updateCalls = vi.hoisted(
  () => [] as Array<{ payload: Record<string, unknown> }>,
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
            return Promise.resolve({ error: null });
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: vi.fn(async () => ({ error: null })),
    from: (table: string) => adminFromMock(table),
  }),
}));

process.env.INTERNAL_API_TOKEN = "test-internal-token";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return { ...actual, after: () => {} };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/strategies/csv-finalize/route";

const SESSION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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
  updateCalls.length = 0;
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
function arm23505(row: { id: string; name?: string; status?: string } | null) {
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
    // present — the fold committed all-or-nothing): exactly ONE fold call
    // (which rolled back), and the only post-resolve write is the metadata
    // UPDATE, which is the retry completing its fan-out.
    expect(foldCalls()).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
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
