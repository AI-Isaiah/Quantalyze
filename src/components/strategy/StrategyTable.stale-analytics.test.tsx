/**
 * STALE-01 — a FAILED computation must never present itself as a current one.
 *
 * THE DEFECT, measured on the production database 2026-08-25:
 *
 *     published strategies:                                18
 *     computation_status complete/complete_with_warnings:    1
 *     status 'failed' but still carrying sharpe/cagr:       17
 *     ...and still carrying a non-null computed_at:         17
 *
 * A `failed` analytics row keeps whatever KPI values an EARLIER run wrote —
 * the writer stamps the status and the error, not the metrics. So for 17 of 18
 * published strategies an anonymous visitor to /browse/[slug] and
 * /discovery/[slug] was shown Sharpe / CAGR / Max-DD from a computation that
 * did not finish, stamped "Synced <date>", and ordered `#1`…`#18` by sorting
 * those dead numbers.
 *
 * WHY THE DATE MAKES IT A FALSE CLAIM AND NOT MERELY A STALE ONE: the SQL
 * status bridge re-stamps `computed_at = now()` on the branches it writes,
 * INCLUDING `failed` (migration
 * 20260710150000_sync_status_supersede_failed_per_kind.sql:179) and `computing`
 * (:125). So `computed_at` dates the FAILURE while the figures beside it date
 * some earlier, unrecorded success. No timestamp on the row honestly describes
 * the numbers it holds.
 *
 * WHY THE ORDINAL IS THE WORST OF THE THREE: Phase 159 / RANK-01 had already
 * gated the percentile cohort on the same status, so these rows lost their
 * `Pnn` suffix — leaving a BARE `#3`. The hedge disappeared and the claim
 * stayed, so the surface got more authoritative-looking, not less.
 *
 * WHAT THE FIX IS, AND WHAT IT DELIBERATELY IS NOT. The 149-UI-SPEC States
 * invariant — a published row awaiting a recompute must not grow a chip on
 * /discovery; "red is forbidden — absence is not an error" — is UPHELD, not
 * reverted. Nothing here adds a public error state, a chip, or a colour. The
 * row keeps its name, its AUM, its link and its place in the list; only the
 * claims the failed computation cannot support are withheld, as em-dashes
 * (DESIGN.md: "a metric that cannot be computed says so with a dash. Never 0,
 * never blank, never a fabricated value"). Honest absence, which is already
 * this codebase's convention for a row that never computed at all.
 *
 * TWO LAYERS, TWO DIFFERENT KINDS OF CLAIM — hence three groups below:
 *   - `shapeRowAnalytics` (lib/queries.ts) owns the VALUES. It shapes a
 *     non-terminal-success row exactly like an absent one, so the dead numbers
 *     never leave the server. Group B.
 *   - `StrategyTable` owns the ORDINAL and the sync badge — positional and
 *     temporal claims that no null KPI can express. Group C.
 *   - Group A is the seam: real query → real shaper → real component, the path
 *     an anonymous visitor actually travels. It reddens if EITHER layer is
 *     neutered, which is what makes it the anti-vacuity anchor rather than a
 *     restatement of the other two.
 *
 * ANTI-VACUITY. Every assertion below was witnessed RED against the
 * pre-fix implementation before being committed. The fixtures carry REAL,
 * DISTINCTIVE stale values (sharpe 3.77, cagr 66.12%, computed_at "now") — not
 * nulls — so a test cannot pass merely because a fixture had nothing to show.
 * A `complete` control row sits beside every failed one in every group, so no
 * assertion can pass by blanking the whole table.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within } from "@testing-library/react";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

// --- Supabase mock (Group A + B) -----------------------------------------
// `getStrategiesByCategory` awaits the builder itself (no `.single()`), so the
// chain is a thenable. `readPublicVerificationSignals` — which shapeRankingRows
// calls before mapping — goes through `.rpc()`; it is seeded empty so every row
// arrives with `trust_tier: null`, keeping the badge surface out of this spec.
const seeded = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.then = (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      ) => Promise.resolve({ data: seeded.rows, error: null }).then(onFulfilled);
      return chain;
    },
    rpc: async () => ({ data: [], error: null }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({}) }),
}));

// Leaf that pulls in client-only modules; irrelevant to the claims under test.
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

import { getStrategiesByCategory } from "@/lib/queries";
import { StrategyTable } from "./StrategyTable";

// --- Fixtures ------------------------------------------------------------

const EM_DASH = "—";

const ID_LIVE = "51a10001-0000-4000-8000-000000000001";
const ID_DEAD = "51a10001-0000-4000-8000-000000000002";
const ID_DEAD_2 = "51a10001-0000-4000-8000-000000000003";

const NAME_LIVE = "Meridian Live";
const NAME_DEAD = "Orpheus Dead";
const NAME_DEAD_2 = "Cassini Dead";

/**
 * The stale KPI payload a `failed` row really carries. Values are chosen to be
 * unmistakable in rendered text AND to be the BEST in every column, so a row
 * sorted by any of them would land at `#1`. If the fix regresses, these strings
 * appear in the DOM and the assertions name exactly which one leaked.
 */
const STALE = {
  cumulative_return: 0.9134, // "+91.34%"
  cagr: 0.6612, //             "+66.12%"
  sharpe: 3.77, //             "3.77"
  max_drawdown: -0.0311, //    "-3.11%"
  volatility: 0.1855, //       "+18.55%"
  six_month_return: 0.4409, // "+44.09%"
} as const;

/** A modest but REAL computed row — the control that must keep everything. */
const LIVE = {
  cumulative_return: 0.12,
  cagr: 0.05,
  sharpe: 0.6,
  max_drawdown: -0.4,
  volatility: 0.33,
  six_month_return: 0.07,
} as const;

const STALE_TEXT = ["+91.34%", "+66.12%", "3.77", "-3.11%", "+18.55%", "+44.09%"];

/**
 * The metric bundle a fixture carries. Widened from `typeof STALE | typeof
 * LIVE` on purpose: both are `as const`, so their members narrow to literal
 * types and a test that needs a THIRD value (a second computed row, to prove
 * `#n` stays contiguous) cannot express one without this alias.
 */
type Metrics = Record<keyof typeof LIVE, number>;

/** A `strategy_analytics` embed as PostgREST returns it for the list read. */
function analyticsEmbed(
  status: string,
  metrics: Metrics,
): Record<string, unknown> {
  return {
    // A real bridge-stamped timestamp — NOT null. The whole point is that a
    // failed row carries one, so a `!computed_at` gate would never fire here.
    computed_at: new Date().toISOString(),
    computation_status: status,
    sparkline_returns: [1, 2, 3, 4, 5],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    calmar: 2.4,
    ...metrics,
  };
}

/** A `strategies` row as the category read returns it, analytics embedded. */
function dbRow(
  id: string,
  name: string,
  status: string,
  metrics: Metrics,
): Record<string, unknown> {
  return {
    id,
    name,
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    strategy_analytics: analyticsEmbed(status, metrics),
  };
}

/** The client-side row shape StrategyTable takes (Group C mounts these directly). */
type Row = Strategy & {
  analytics: StrategyAnalytics;
  analyticsPresent?: boolean;
};

function clientRow(
  id: string,
  name: string,
  status: string,
  metrics: Metrics,
): Row {
  const base = dbRow(id, name, status, metrics);
  const { strategy_analytics: embed, ...strat } = base;
  return {
    ...(strat as unknown as Strategy),
    analytics: {
      id: "an-1",
      strategy_id: id,
      computing_started_at: null,
      computation_error: null,
      benchmark: null,
      sortino: 1.2,
      max_drawdown_duration_days: 30,
      metrics_json: null,
      returns_series: null,
      drawdown_series: null,
      monthly_returns: null,
      daily_returns: null,
      rolling_metrics: null,
      return_quantiles: null,
      trade_metrics: null,
      volume_metrics: null,
      exposure_metrics: null,
      data_quality_flags: null,
      ...(embed as Record<string, unknown>),
    } as unknown as StrategyAnalytics,
    analyticsPresent: true,
  };
}

// --- Helpers -------------------------------------------------------------

function rowFor(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
    (tr.textContent ?? "").includes(name),
  );
  if (!row) throw new Error(`no rendered row for "${name}"`);
  return row as HTMLElement;
}

/** The leading rank cell's trimmed text (index 0 — no star column in scope). */
function rankText(row: HTMLElement): string {
  return (row.querySelectorAll("td")[0]?.textContent ?? "").trim();
}

/** Rendered row names, top to bottom. */
function renderedOrder(): string[] {
  return Array.from(document.querySelectorAll("tbody tr"))
    .map((tr) => tr.textContent ?? "")
    .map((t) =>
      [NAME_LIVE, NAME_DEAD, NAME_DEAD_2].find((n) => t.includes(n)) ?? "",
    )
    .filter(Boolean);
}

beforeEach(() => {
  installFetchMock();
  seeded.rows = [];
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});

afterEach(() => {
  restoreFetchMock();
});

// =========================================================================
// Group A — THE SEAM. The path an anonymous /browse visitor actually travels.
// =========================================================================

describe("STALE-01 seam — anonymous browse render of a failed-computation row", () => {
  /**
   * `categorySlug="stale-spec"` is deliberate: StrategyTable.test.tsx documents
   * a CI flake where a `discovery_view_preferences:*` key leaks across files
   * via the shared jsdom localStorage. A distinct slug cannot collide.
   */
  async function renderPublicCategory() {
    const rows = await getStrategiesByCategory("stale-spec");
    // The DEFAULT recipe — no `visibility` prop, exactly what /browse/[slug]
    // and /discovery/[slug] pass (both are RSCs and hand over nothing else).
    render(<StrategyTable strategies={rows} categorySlug="stale-spec" />);
    return rows;
  }

  it("prints NOT ONE stale figure from a failed computation anywhere in the table", async () => {
    // The prod ratio in miniature: one live row, two dead ones whose numbers
    // are strictly better in every column.
    seeded.rows = [
      dbRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
      dbRow(ID_DEAD, NAME_DEAD, "failed", STALE),
      dbRow(ID_DEAD_2, NAME_DEAD_2, "failed", STALE),
    ];

    await renderPublicCategory();

    const table = document.body.textContent ?? "";
    for (const leaked of STALE_TEXT) {
      expect(
        table,
        `a failed computation's "${leaked}" reached a public reader`,
      ).not.toContain(leaked);
    }

    // ...while the row that DID compute keeps every one of its figures. Without
    // this control the assertion above would also pass on an empty table.
    expect(table).toContain("+12.00%"); // cumulative_return
    expect(table).toContain("0.60"); //    sharpe

    // The dead rows are still LISTED — withholding numbers is not deleting a
    // manager's published strategy from discovery.
    expect(rowFor(NAME_DEAD)).toBeTruthy();
    expect(rowFor(NAME_DEAD_2)).toBeTruthy();
  });

  it("shows the dead rows' metric cells as em-dashes, not blanks or zeros", async () => {
    seeded.rows = [
      dbRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
      dbRow(ID_DEAD, NAME_DEAD, "failed", STALE),
    ];

    await renderPublicCategory();

    const dead = rowFor(NAME_DEAD);
    // Visible metric cells of a 13-td row: Return, CAGR, Sharpe, Max DD, Vol,
    // 6 Month. (AUM at index 8 lives on the `strategies` row, is NOT a product
    // of the analytics job, and must survive — asserted separately below.)
    for (const i of [2, 3, 4, 5, 6, 7]) {
      const text = (dead.querySelectorAll("td")[i]?.textContent ?? "").trim();
      expect(text, `metric cell ${i} of a failed row`).toContain(EM_DASH);
      expect(text).not.toContain("0.00");
    }
    // AUM is a fact about the strategy, not an output of the computation.
    expect((dead.querySelectorAll("td")[8]?.textContent ?? "").trim()).toBe("$1.0M");
  });

  it("makes no 'Synced' claim for a failed row, while the computed row keeps its badge", async () => {
    seeded.rows = [
      dbRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
      dbRow(ID_DEAD, NAME_DEAD, "failed", STALE),
    ];

    await renderPublicCategory();

    // The bridge stamped `computed_at = now()` on the failure, so a naive
    // render says "Synced just now" about a run that produced nothing.
    expect(rowFor(NAME_DEAD).textContent).not.toMatch(/Synced/);
    // The control proves the badge still works and that the assertion above is
    // not passing because SyncBadge is globally broken.
    expect(rowFor(NAME_LIVE).textContent).toMatch(/Synced/);
  });

  it("gives the failed rows NO rank ordinal and never lets one outrank a computed row", async () => {
    // STALE has the best sharpe (3.77 vs 0.60) and the table's default sort is
    // sharpe-desc, so on the pre-fix implementation BOTH dead rows sort above
    // the live one and it is the failed row that renders `#1`.
    seeded.rows = [
      dbRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
      dbRow(ID_DEAD, NAME_DEAD, "failed", STALE),
      dbRow(ID_DEAD_2, NAME_DEAD_2, "failed", STALE),
    ];

    await renderPublicCategory();

    // `#1` is a claim ("best here") sourced from numbers this page just
    // refused to print. A row that may not show its figures may not be
    // ordered by them either.
    expect(rankText(rowFor(NAME_DEAD))).toBe(EM_DASH);
    expect(rankText(rowFor(NAME_DEAD_2))).toBe(EM_DASH);
    expect(rankText(rowFor(NAME_DEAD))).not.toMatch(/#/);

    // The ONE computed strategy is the ONE ranked strategy, and it is #1.
    expect(rankText(rowFor(NAME_LIVE))).toBe("#1");

    // Ordering, not just numbering: the ranked row leads. Were a dead row left
    // interleaved, `#n` (derived from the paged index) would either skip a
    // number or hand its ordinal to the wrong row.
    expect(renderedOrder()[0]).toBe(NAME_LIVE);
  });
});

// =========================================================================
// Group B — the VALUES layer: shapeRowAnalytics via getStrategiesByCategory.
// =========================================================================

describe("STALE-01 values — the shaper withholds what the run did not produce", () => {
  it("nulls every KPI of a failed row and clears its computed_at", async () => {
    seeded.rows = [dbRow(ID_DEAD, NAME_DEAD, "failed", STALE)];

    const [row] = await getStrategiesByCategory("stale-spec");

    expect(row.analytics.sharpe).toBeNull();
    expect(row.analytics.cagr).toBeNull();
    expect(row.analytics.cumulative_return).toBeNull();
    expect(row.analytics.max_drawdown).toBeNull();
    expect(row.analytics.volatility).toBeNull();
    expect(row.analytics.six_month_return).toBeNull();
    expect(row.analytics.sparkline_returns).toBeNull();
    // Falsy so SyncBadge early-returns null; the timestamp dated the FAILURE.
    expect(row.analytics.computed_at).toBeFalsy();
  });

  it("PRESERVES the real computation_status and analyticsPresent — 'failed' is not 'never enqueued'", async () => {
    seeded.rows = [dbRow(ID_DEAD, NAME_DEAD, "failed", STALE)];

    const [row] = await getStrategiesByCategory("stale-spec");

    // Both are load-bearing and pull in OPPOSITE directions from the values:
    //  - letting EMPTY_ANALYTICS' hardcoded "pending" stand would turn a
    //    terminally failed row into a live job — a permanent "Syncing" chip on
    //    /my-strategies, the forever-spinner class the 16h bound exists to kill;
    //  - `analyticsPresent: false` would claim no analytics row EXISTS, routing
    //    it through the missing-row age window and resurrecting the same
    //    spinner from the other side.
    // `getOwnRowPercentiles` also reads this status to decide cohort
    // membership, so laundering it would silently re-admit dead rows there.
    expect(row.analytics.computation_status).toBe("failed");
    expect(row.analyticsPresent).toBe(true);
  });

  it("leaves a terminal-SUCCESS row completely untouched, warnings included", async () => {
    // `complete_with_warnings` is a terminal SUCCESS (a valid factsheet whose
    // run tripped a DQ guard). Treating it as non-computed would blank a
    // perfectly good strategy — the exact over-correction this fix must avoid.
    seeded.rows = [
      dbRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
      dbRow(ID_DEAD, NAME_DEAD, "complete_with_warnings", STALE),
    ];

    const rows = await getStrategiesByCategory("stale-spec");
    const complete = rows.find((r) => r.id === ID_LIVE)!;
    const warned = rows.find((r) => r.id === ID_DEAD)!;

    expect(complete.analytics.sharpe).toBe(LIVE.sharpe);
    expect(warned.analytics.sharpe).toBe(STALE.sharpe);
    expect(warned.analytics.cagr).toBe(STALE.cagr);
    expect(warned.analytics.computed_at).toBeTruthy();
  });

  it("withholds a `computing` row's figures too — the bridge stamps that branch as well", async () => {
    // A row under recompute holds the PREVIOUS run's numbers while the bridge
    // has already moved `computed_at` to now() (migration 20260710150000:125),
    // so keeping them renders "Synced just now" over figures from another run.
    // Same gate as the percentile cohort (RANK-01), which already excludes
    // `computing` — one predicate, not two that drift.
    seeded.rows = [dbRow(ID_DEAD, NAME_DEAD, "computing", STALE)];

    const [row] = await getStrategiesByCategory("stale-spec");

    expect(row.analytics.sharpe).toBeNull();
    expect(row.analytics.computation_status).toBe("computing");
  });
});

// =========================================================================
// Group C — the ORDINAL layer: claims no null KPI can express.
// =========================================================================

describe("STALE-01 ordinal — the table refuses to rank what it may not print", () => {
  /**
   * Group C mounts rows DIRECTLY, bypassing the shaper, so the component's own
   * gate is what is under test. The fixtures therefore still carry their stale
   * values — this is the adversarial case: even handed live-looking numbers,
   * the table must not turn them into a position.
   */
  it("does not award #1 to a failed row holding the best stale Sharpe", () => {
    render(
      <StrategyTable
        strategies={[
          clientRow(ID_DEAD, NAME_DEAD, "failed", STALE),
          clientRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
        ]}
        categorySlug="stale-spec"
      />,
    );

    expect(rankText(rowFor(NAME_LIVE))).toBe("#1");
    expect(rankText(rowFor(NAME_DEAD))).toBe(EM_DASH);
    expect(renderedOrder()).toEqual([NAME_LIVE, NAME_DEAD]);
  });

  it("keeps unranked rows last when the sort direction FLIPS — subordination is not a sort artifact", () => {
    // The falsifier for a direction-aware partition. `getSortValue` coerces a
    // null KPI to 0; under ascending sort that 0 would march the dead row to
    // the TOP and hand it `#1`, so a fix that merely reorders under one
    // direction is not a fix.
    const { container } = render(
      <StrategyTable
        strategies={[
          clientRow(ID_DEAD, NAME_DEAD, "failed", STALE),
          clientRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
        ]}
        categorySlug="stale-spec"
      />,
    );

    // Click the Sharpe header to flip desc → asc.
    const sharpeHeader = within(container).getByRole("columnheader", {
      name: /Sharpe/,
    });
    (sharpeHeader.querySelector("button") ?? sharpeHeader).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(renderedOrder()[0]).toBe(NAME_LIVE);
    expect(rankText(rowFor(NAME_LIVE))).toBe("#1");
    expect(rankText(rowFor(NAME_DEAD))).toBe(EM_DASH);
  });

  it("numbers the ranked rows CONTIGUOUSLY — an unranked row leaves no hole in #n", () => {
    render(
      <StrategyTable
        strategies={[
          clientRow(ID_DEAD, NAME_DEAD, "failed", STALE),
          clientRow(ID_LIVE, NAME_LIVE, "complete", LIVE),
          clientRow(ID_DEAD_2, NAME_DEAD_2, "complete", {
            ...LIVE,
            sharpe: 0.1,
          }),
        ]}
        categorySlug="stale-spec"
      />,
    );

    // Two computed rows → exactly #1 and #2, no gap and no #3.
    expect(rankText(rowFor(NAME_LIVE))).toBe("#1");
    expect(rankText(rowFor(NAME_DEAD_2))).toBe("#2");
    expect(rankText(rowFor(NAME_DEAD))).toBe(EM_DASH);
    expect(document.body.textContent).not.toContain("#3");
  });

  it("renders NO error chip, colour or marker on the public surface — absence is not an error", () => {
    // The 149-UI-SPEC States invariant, still standing. This fix withholds
    // claims; it must never ADD a public accusation about a manager's
    // strategy. If a future change "improves" the empty row with a red chip,
    // this reddens.
    render(
      <StrategyTable
        strategies={[clientRow(ID_DEAD, NAME_DEAD, "failed", STALE)]}
        categorySlug="stale-spec"
      />,
    );

    const dead = rowFor(NAME_DEAD);
    expect(dead.textContent).not.toMatch(/No data/);
    expect(dead.textContent).not.toMatch(/Syncing/);
    expect(dead.textContent).not.toMatch(/fail/i);
    expect(dead.textContent).not.toMatch(/error/i);
    // The two DATA_STATE_CHIP backgrounds (StrategyTable.tsx:88) — the amber
    // "Syncing" and the muted "No data". Asserted on the CLASS, not just the
    // copy, so a relabelled chip cannot slip past the text matchers above.
    //
    // Deliberately NOT asserted: `text-negative`. That token is the Max DD
    // cell's legitimate sign tint for a finite negative value (`drawdownColor`,
    // :145) and appears on healthy rows too — banning it here would conflate
    // "a number that is negative" with "an error", which is the very confusion
    // DESIGN.md's semantic-colour gate exists to prevent.
    expect(dead.innerHTML).not.toContain("bg-warning-bg");
    expect(dead.innerHTML).not.toContain("bg-track");
    // ...and the row is still a live link to its factsheet, not a dead end.
    expect(
      dead.querySelector(`a[href="/factsheet/${ID_DEAD}"]`),
    ).toBeTruthy();
  });
});
