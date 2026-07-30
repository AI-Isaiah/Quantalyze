/**
 * CR-01 — the CSV finalize path must not merge two different submissions into
 * one strategy and report success.
 *
 * ⚠️ THE DEFECT, IN ONE SENTENCE. `persist_csv_daily_returns` is
 * `INSERT … ON CONFLICT (strategy_id, date) DO UPDATE` with no delete outside
 * the incoming range, and phase 140.4's SEAMRIM-03 fence made it reachable
 * against a strategy that a DIFFERENT submission created: a repeat submit now
 * resolves to the existing strategy id, and `wizard_session_id` survives a
 * failed submit (`localStorage.ts:390-393` states that as load-bearing). So:
 *
 *   1. name "Alpha 2024", upload 2024.csv, submit → strategy S created
 *   2. the step AFTER the create fails (metadata 400 / persist 500 / timeout).
 *      `CSV_SUBMIT_FAILED` tells the user to submit again.
 *   3. the user renames, uploads 2025.csv, submits
 *   4. 23505 → S echoed → 2025's rows upserted onto S
 *
 *   Result: S carries 2024 ∪ 2025. Neither file. Reported as success, on a
 *   product whose entire value is a trustworthy verified track record.
 *
 * TWO LAYERS GUARD IT AND NEITHER IS SUFFICIENT ALONE. The rename is refused in
 * `routers/process_key.py`'s 23505 arm before any write (see
 * `test_cr01_csv_finalize_23505_refuses_a_DIFFERENT_submission`). This file
 * guards the other half — a changed FILE under an UNCHANGED name, which the
 * name check cannot see — at the site of the merge itself, so it holds for both
 * the legacy and the unified path without either knowing how it got its id.
 *
 * ⚠️ THE POSITIVE COUNTERPARTS ARE LOAD-BEARING. A fence that refused every
 * write would satisfy the merge assertion while breaking the FIRST submit and
 * the instructed retry — i.e. it would re-open C-2's dead end from the other
 * side. Both are asserted below.
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

const EXISTING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** Rows the target strategy ALREADY holds, and the read's error, per test. */
const staleProbe = vi.hoisted(() => ({
  data: [] as Array<{ date: string }>,
  error: null as { code?: string; message?: string } | null,
  /** Every (min,max) the route probed with, so the filter can be asserted. */
  filters: [] as string[],
}));

const persistArgs = vi.hoisted(
  () => [] as Array<{ p_strategy_id: string; p_rows: unknown }>,
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
      // The metadata UPDATE the route runs before persisting.
      update: () => ({
        eq: () => ({ eq: () => ({ error: null }) }),
      }),
      // The CR-01 stale-range probe.
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          or: (filter: string) => ({
            limit: async (_n: number) => {
              expect(
                table,
                "the stale-range probe must read the series table, not another one",
              ).toBe("csv_daily_returns");
              staleProbe.filters.push(filter);
              return { data: staleProbe.data, error: staleProbe.error };
            },
          }),
        }),
      }),
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

// The unified backbone resolves to the EXISTING strategy — this is exactly what
// the SEAMRIM-03 23505 arm does on a repeat submit.
vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: vi.fn(async () => ({
    ok: true,
    status: 200,
    body: { ok: true, strategy_id: EXISTING_ID },
  })),
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
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  staleProbe.data = [];
  staleProbe.error = null;
  staleProbe.filters.length = 0;
  persistArgs.length = 0;
  checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  rpcMock.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      if (name === "persist_csv_daily_returns") {
        persistArgs.push(
          args as unknown as { p_strategy_id: string; p_rows: unknown },
        );
        return { data: 3, error: null };
      }
      return { data: null, error: null };
    },
  );
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

describe("[140.4-16 / CR-01] csv-finalize refuses a cross-submission merge", () => {
  it("🔴 THE MERGE CASE: a 2025 payload is NOT written onto a strategy that already holds 2024", async () => {
    // S already carries 2024 — the first submission got as far as persisting.
    staleProbe.data = [{ date: "2024-01-31" }];

    const res = await post(SERIES_2025);

    expect(
      res.status,
      "the route reported success for a write that leaves 2024's rows in place " +
        "beside 2025's — the strategy ends up holding a series that was never " +
        "submitted, on a product whose value is a verified track record",
    ).not.toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CSV_SESSION_REUSED");

    // The load-bearing half: NOTHING was written. A refusal that still persists
    // is not a refusal.
    expect(
      persistArgs,
      "persist_csv_daily_returns ran anyway — the fence returned an error " +
        "envelope while the merge it describes already happened",
    ).toEqual([]);
  });

  it("probes with the payload's OWN min/max, so 'stale' means 'outside what was submitted'", async () => {
    staleProbe.data = [];
    await post(SERIES_2025);
    expect(staleProbe.filters).toEqual([
      "date.lt.2025-01-31,date.gt.2025-03-31",
    ]);
  });

  it("POSITIVE: a FIRST submit (no existing rows) writes normally", async () => {
    // Without this the fence above is satisfied by one that refuses everything,
    // which breaks every CSV upload on the product.
    staleProbe.data = [];

    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    expect(persistArgs).toHaveLength(1);
    expect(persistArgs[0].p_strategy_id).toBe(EXISTING_ID);
  });

  it("POSITIVE: the INSTRUCTED retry still works — an identical resubmit is not a merge", async () => {
    // The recovery SEAMRIM-03 exists to allow: S already holds this very
    // series, every date is inside the payload's range, the upsert is a no-op
    // rewrite. Refusing here would re-open C-2's dead end from the other side.
    staleProbe.data = [];

    const res = await post(SERIES_2024);

    expect(res.status).toBe(200);
    expect(persistArgs).toHaveLength(1);
  });

  it("a FAILED probe fails CLOSED — a read we could not make is never read as 'nothing is there'", async () => {
    // supabase-js RESOLVES on a read failure rather than throwing, so an
    // unchecked binding is `null` here and looks exactly like "no stale rows".
    // That is the C-3 defect this milestone exists to close; it must not be
    // re-created by the guard written to close its sibling.
    staleProbe.error = { code: "57014", message: "statement timeout" };

    const res = await post(SERIES_2025);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(
      persistArgs,
      "the route wrote the series after failing to establish whether writing " +
        "it was safe",
    ).toEqual([]);
  });
});
