/** @vitest-environment jsdom */
/**
 * Phase 89 Plan 03 — composite branch render pins (SIBLING file).
 *
 * The 874-line `SyncPreviewStep.render.test.tsx` + `SyncPreviewStep.test.ts`
 * are the SC-4 neutrality pins and stay FROZEN/untouched. This sibling adds the
 * composite-only pins:
 *   1. DISCRIMINATOR — composite-ness is a `strategy_keys` membership-count
 *      probe (compositeMemberCount > 0), NEVER `apiKeyId === null` (Pitfall 1).
 *      A REAL UUID `apiKeyId` + memberCount 2 must render the composite waiting
 *      heading, not the single-key one.
 *   2. FAILED BLOCKS + NAMES MEMBER — `computation_status==='failed'` reaches
 *      the composite gate heading, names the offending member from the
 *      server-scrubbed `computation_error`, and offers no primary submit CTA.
 *   3. WARNED PASSES — `complete_with_warnings` is terminal SUCCESS (Pitfall 3):
 *      the composite reaches `passed`, submit is allowed, and onComplete carries
 *      the additive `composite` snapshot payload.
 *   4. NO TRADES ROUTING — the composite terminal path never queries `trades`
 *      and never renders INSUFFICIENT_TRADES copy (Pitfall 1/4).
 *   5. SPARKLINE FALLBACK — a null `sparkline_returns` falls back to the served
 *      `csv_daily_returns` daily_return values (A1; served data, never
 *      recomputed).
 *
 * Mock idioms (chainable pure-stub, column-string discrimination, fake-timer
 * act-flush) mirror the frozen render test verbatim.
 */
import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";

// Mutable module-level client factory (mirrors the frozen render test).
let currentClientFactory: () => unknown = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  }),
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

// --- Fixtures ---------------------------------------------------------------

type PollOutcome =
  | { kind: "row"; status: string | null; error?: string | null }
  | { kind: "supabaseError" }
  | { kind: "throw" };

interface MemberRow {
  api_key_id: string;
  window_start: string;
  window_end: string | null;
  seq: number;
  api_keys: { exchange: string | null; label: string | null } | null;
}

interface CompositeMockOpts {
  memberCount: number;
  members: MemberRow[];
  analyticsRow: Record<string, unknown>;
  series: { date: string; daily_return: number }[];
  config: Record<string, unknown> | null;
  pollOutcome: () => PollOutcome;
}

// 2 members (seq 1-2, deribit); per_key windows with a 2-day interior gap
// (2025-01-06 → 2025-01-07); a ~10-day stitched series.
const DEFAULT_MEMBERS: MemberRow[] = [
  {
    api_key_id: "11111111-1111-4111-8111-111111111111",
    window_start: "2025-01-01",
    window_end: "2025-01-06",
    seq: 1,
    api_keys: { exchange: "deribit", label: "Key A" },
  },
  {
    api_key_id: "22222222-2222-4222-8222-222222222222",
    window_start: "2025-01-08",
    window_end: "2025-01-13",
    seq: 2,
    api_keys: { exchange: "deribit", label: "Key B" },
  },
];

const DEFAULT_SERIES = [
  { date: "2025-01-01", daily_return: 0.01 },
  { date: "2025-01-02", daily_return: -0.02 },
  { date: "2025-01-03", daily_return: 0.015 },
  { date: "2025-01-04", daily_return: 0.005 },
  { date: "2025-01-05", daily_return: -0.01 },
  { date: "2025-01-08", daily_return: 0.02 },
  { date: "2025-01-09", daily_return: -0.005 },
  { date: "2025-01-10", daily_return: 0.03 },
  { date: "2025-01-11", daily_return: -0.015 },
  { date: "2025-01-12", daily_return: 0.01 },
];

const DEFAULT_DQ = {
  per_key: [
    { seq: 1, first_day: "2025-01-01", last_day: "2025-01-05", n_days: 5 },
    { seq: 2, first_day: "2025-01-08", last_day: "2025-01-12", n_days: 5 },
  ],
  gap_spans: [{ start: "2025-01-06", end: "2025-01-07" }],
  gap_day_count: 2,
  overlap_days: [],
  composite: true,
};

function defaultAnalyticsRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    cagr: 0.15,
    sharpe: 1.2,
    sortino: 1.5,
    max_drawdown: -0.09,
    volatility: 0.22,
    cumulative_return: 0.34,
    sparkline_returns: [0.01, -0.02, 0.03, 0.01],
    metrics_json_by_basis: { cash_settlement: {} },
    data_quality_flags: DEFAULT_DQ,
    computed_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Chainable pure-stub composite client. Discriminates on (table, select-cols):
 *   - freshness probe (`computation_status, computed_at`) → stale complete
 *   - strategy_keys head-count (`select("*", {head})`) → { count: memberCount }
 *   - status poll (`computation_status, computation_error`) → pollOutcome()
 *   - strategy_keys member rows (cols include `api_keys(`) → members
 *   - strategy_analytics heavy (cols include `sparkline_returns`) → analyticsRow
 *   - csv_daily_returns (`date, daily_return`) → series
 *   - strategies (`returns_denominator_config`) → config
 *   - trades → tradesSpy + empty
 *   - unknown → empty
 */
function installCompositeSupabaseMock(opts: Partial<CompositeMockOpts> = {}) {
  const o: CompositeMockOpts = {
    memberCount: 2,
    members: DEFAULT_MEMBERS,
    analyticsRow: defaultAnalyticsRow(),
    series: DEFAULT_SERIES,
    config: { returns_denominator_config: null },
    pollOutcome: () => ({ kind: "row", status: "complete_with_warnings" }),
    ...opts,
  };

  const tradesSpy = vi.fn();

  const result = (data: unknown, count = 0) => ({
    eq: () => result(data, count),
    neq: () => result(data, count),
    order: () => result(data, count),
    limit: () => result(data, count),
    maybeSingle: () => Promise.resolve({ data, error: null }),
    then: (
      resolve: (v: { data: unknown; count: number; error: null }) => void,
    ) => resolve({ data, count, error: null }),
  });

  const client = {
    from: (table: string) => {
      if (table === "trades") tradesSpy(table);
      return {
        select: (cols: string, selectOpts?: { head?: boolean }) => {
          if (cols === "computation_status, computed_at") {
            // Stale complete freshness probe → kickoff POST still fires.
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      computation_status: "complete",
                      computed_at: "2000-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
              }),
            };
          }

          if (cols === "computation_status, computation_error") {
            return {
              eq: () => ({
                maybeSingle: () => {
                  const outcome = o.pollOutcome();
                  if (outcome.kind === "throw") {
                    return Promise.reject(new Error("poll exploded"));
                  }
                  if (outcome.kind === "supabaseError") {
                    return Promise.resolve({
                      data: null,
                      error: { message: "permission denied" },
                    });
                  }
                  return Promise.resolve({
                    data: {
                      computation_status: outcome.status,
                      computation_error: outcome.error ?? null,
                    },
                    error: null,
                  });
                },
              }),
            };
          }

          // Membership-count probe: strategy_keys select("*", {head:true}).
          if (table === "strategy_keys" && selectOpts?.head) {
            return result(null, o.memberCount);
          }

          // Member row list (embeds the api_keys metadata).
          if (table === "strategy_keys" && cols.includes("api_keys(")) {
            return result(o.members, 0);
          }

          if (table === "csv_daily_returns" && cols === "date, daily_return") {
            return result(o.series, 0);
          }

          if (table === "strategies" && cols.includes("returns_denominator_config")) {
            return result(o.config, 0);
          }

          if (table === "strategy_analytics" && cols.includes("sparkline_returns")) {
            return result(o.analyticsRow, 0);
          }

          // trades / anything else — empty/zero.
          return result(null, 0);
        },
      };
    },
  };

  currentClientFactory = () => client;
  return { tradesSpy };
}

const baseProps = {
  strategyId: "composite-strat-1",
  // Pitfall 1: a REAL first-member UUID, NOT null — the composite must still be
  // discriminated by the membership probe.
  apiKeyId: "11111111-1111-4111-8111-111111111111",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

describe("[89-03] SyncPreviewStep — composite branch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  // Pin 1 — DISCRIMINATOR (Pitfall 1). A UUID apiKeyId + memberCount 2 must
  // render the composite waiting heading. An `apiKeyId === null` implementation
  // would render the single-key heading here.
  it("discriminates a composite by membership count, not the apiKeyId prop", async () => {
    installCompositeSupabaseMock({
      pollOutcome: () => ({ kind: "row", status: "computing" }),
    });

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(
      screen.getByRole("heading", {
        name: /stitching your composite track record/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/computing your verified factsheet/i),
    ).not.toBeInTheDocument();
  });

  // Pin 2 — FAILED BLOCKS + NAMES MEMBER. A failed status reaches the composite
  // gate heading, names the offending member from the scrubbed
  // computation_error, and offers no primary submit CTA.
  it("blocks submit and names the failing member on computation_status='failed'", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installCompositeSupabaseMock({
      pollOutcome: () => ({
        kind: "row",
        status: "failed",
        error: "Key 2 (deribit) failed to reconstruct: geo-blocked",
      }),
    });

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(
      screen.getByRole("heading", { name: /we could not verify this composite/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Key 2 \(deribit\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-use-this-key")).not.toBeInTheDocument();

    const reviewBtn = screen.getByTestId("wizard-try-another-key");
    expect(reviewBtn).toHaveAccessibleName(/review your keys/i);
    errSpy.mockRestore();
  });

  // Pin 3 — WARNED PASSES (Pitfall 3). complete_with_warnings is terminal
  // success: the composite reaches passed, submit is allowed, and onComplete
  // carries the additive composite payload.
  it("reaches passed on complete_with_warnings and emits the composite snapshot", async () => {
    installCompositeSupabaseMock({
      pollOutcome: () => ({ kind: "row", status: "complete_with_warnings" }),
    });

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    const primary = screen.getByRole("button", {
      name: /use this composite and continue/i,
    });
    expect(primary).toBeEnabled();

    await act(async () => {
      fireEvent.click(primary);
    });

    expect(baseProps.onComplete).toHaveBeenCalledTimes(1);
    const snap = baseProps.onComplete.mock.calls[0][0];
    expect(snap.composite).toBeTruthy();
    expect(snap.composite.members.length).toBe(2);
    expect(snap.composite.gapDayCount).toBe(2);
    expect(snap.composite.series.length).toBe(DEFAULT_SERIES.length);
    expect(snap.tradeCount).toBe(0);
  });

  // Pin 4 — NO TRADES ROUTING (Pitfall 1/4). Across the full passed lifecycle
  // the trades table is never queried and no INSUFFICIENT_TRADES copy renders.
  it("never queries trades and never renders INSUFFICIENT_TRADES on the composite path", async () => {
    const { tradesSpy } = installCompositeSupabaseMock({
      pollOutcome: () => ({ kind: "row", status: "complete_with_warnings" }),
    });

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(
      screen.getByRole("heading", {
        name: /your verified composite factsheet is ready/i,
      }),
    ).toBeInTheDocument();
    expect(tradesSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/enough trades|trades to verify|INSUFFICIENT_TRADES/i)).not.toBeInTheDocument();
  });

  // Pin 5 — SPARKLINE FALLBACK (A1). A null sparkline_returns falls back to the
  // served csv_daily_returns daily_return values — served data, never recomputed.
  it("falls back to the served series daily_return values when sparkline_returns is null", async () => {
    installCompositeSupabaseMock({
      analyticsRow: defaultAnalyticsRow({ sparkline_returns: null }),
      pollOutcome: () => ({ kind: "row", status: "complete_with_warnings" }),
    });

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    const primary = screen.getByRole("button", {
      name: /use this composite and continue/i,
    });
    await act(async () => {
      fireEvent.click(primary);
    });

    const snap = baseProps.onComplete.mock.calls[0][0];
    expect(snap.sparkline).toEqual(DEFAULT_SERIES.map((d) => d.daily_return));
  });
});
