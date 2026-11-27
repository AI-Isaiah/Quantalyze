/**
 * Phase 256 plan 08 (D-05, SC-3, UI-SPEC D) - a switched strategy's list row carries the compact
 * `USD, then BTC` chip in the type-badge row, and never the `in BTC` chip, which would mislabel
 * its USD figures. A USD row's cell is unchanged. The row is fed through the REAL list projection
 * (`shapeRowAnalytics`), so the test fails on origin/main by an assertion on the projected scalar,
 * not by an import error. The fixtures are copied from the sibling native-unit file (file-local there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import { shapeRowAnalytics } from "@/lib/queries";
import { formatCloseDay as d } from "@/lib/factsheet/returns-unit";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

function makeAnalytics(
  overrides?: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    // Phase 239: yesterday, like series_end below, so a Phase 238 change to the computed_at
    // sort key or the current/stale partition cannot reorder these rows.
    computed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
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
    trades_fetched_at: null,
    // Phase 197 plan 03 (CLAR-02, D-03): a CURRENT newest return day by default (yesterday, against
    // the real clock, far inside the 7-day line). The published-only table now judges a row by
    // `series_end`, and a fixture without one is "age unknown": it would lose its `#n` and sort
    // after dated rows, which this file's ordinal and order cases are not about. A test that needs
    // a stale or undated row passes `series_end` explicitly (stale-series.test.tsx owns those).
    series_end: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    ...overrides,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): StrategyWithAnalytics {
  return {
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
    ...overrides,
    analytics: makeAnalytics({ strategy_id: overrides.id }),
  };
}


// `@/lib/queries` is imported for the REAL list projection; these two clients are what drag
// `server-only` into a component test, and the projection never touches them.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});
afterEach(() => {
  restoreFetchMock();
});


const ID_SWITCHED = "33333333-0000-4000-8000-000000000001";
const ID_USD = "33333333-0000-4000-8000-000000000002";
const ID_BTC = "33333333-0000-4000-8000-000000000003";

const SWITCH_FLAGS = { unit_switch: { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" } };

/** A row whose analytics went through the list projection from a stored flags blob. */
function projected(id: string, name: string, flags: Record<string, unknown> | null, nativeUnit: string | null = null) {
  const s = makeStrategy({ id, name });
  const raw = makeAnalytics({ strategy_id: id, data_quality_flags: flags as never, native_unit: nativeUnit });
  s.analytics = { ...shapeRowAnalytics(raw, id), series_end: raw.series_end };
  return s;
}

const cellOf = (name: string) => screen.getByRole("link", { name }).closest("td")!;

describe("StrategyTable - a switched row names the switch in the badge row (SC-3)", () => {
  it("the projection of a stored switch reaches the chip: visible text, attribute, sentence", () => {
    const strategy = projected(ID_SWITCHED, "Switched Book", SWITCH_FLAGS);
    // Anchors the test on the projection (RED on origin/main by assertion, never an import error).
    expect(strategy.analytics.unit_switch_coin).toBe("BTC");
    render(<StrategyTable strategies={[strategy]} categorySlug="crypto-sma" />);
    const chips = cellOf("Switched Book").querySelectorAll("[data-unit-switch]");
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute("data-unit-switch")).toBe("BTC");
    expect(chips[0].textContent).toContain("USD, then BTC");
    expect(chips[0].querySelector(".sr-only")!.textContent).toBe(
      `In USD to ${d("2026-11-14")}, in BTC from ${d("2026-11-15")}. `,
    );
    expect(chips[0].getAttribute("title")).toContain("with the BTC part converted at the stored daily BTC close.");
  });

  it("a switched row never shows the in BTC chip, even if a native unit were present beside it", () => {
    const strategy = projected(ID_SWITCHED, "Switched Book", SWITCH_FLAGS, "BTC");
    expect(strategy.analytics.unit_switch_coin).toBe("BTC");
    render(<StrategyTable strategies={[strategy]} categorySlug="crypto-sma" />);
    const cell = cellOf("Switched Book");
    expect(cell.querySelectorAll("[data-unit-switch]")).toHaveLength(1);
    expect(cell.querySelectorAll("[data-returns-unit]")).toHaveLength(0);
  });

  it("the chip is the first element of the type-badge row, before the strategy-type badges", () => {
    const strategy = projected(ID_SWITCHED, "Switched Book", SWITCH_FLAGS);
    expect(strategy.analytics.unit_switch_coin).toBe("BTC");
    render(<StrategyTable strategies={[strategy]} categorySlug="crypto-sma" />);
    const chip = cellOf("Switched Book").querySelector("[data-unit-switch]") as HTMLElement;
    expect(chip.parentElement!.firstElementChild).toBe(chip);
  });

  it("a USD row and a native BTC row beside it are unchanged: no switch chip, the BTC row keeps in BTC", () => {
    const usd = projected(ID_USD, "Usd Anchor", null);
    const btc = projected(ID_BTC, "Btc Collateral", { native_unit: "BTC" });
    const switched = projected(ID_SWITCHED, "Switched Book", SWITCH_FLAGS);
    expect(switched.analytics.unit_switch_coin).toBe("BTC");
    render(<StrategyTable strategies={[usd, btc, switched]} categorySlug="crypto-sma" />);
    expect(cellOf("Usd Anchor").querySelectorAll("[data-unit-switch],[data-returns-unit]")).toHaveLength(0);
    expect(cellOf("Btc Collateral").querySelectorAll("[data-unit-switch]")).toHaveLength(0);
    expect(cellOf("Btc Collateral").querySelectorAll("[data-returns-unit]")).toHaveLength(1);
  });

  it("a malformed switch renders no chip and no guessed day (the projection drops all three scalars)", () => {
    const strategy = projected(ID_SWITCHED, "Broken Switch", {
      unit_switch: { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-17" },
    });
    render(<StrategyTable strategies={[strategy]} categorySlug="crypto-sma" />);
    expect(cellOf("Broken Switch").querySelectorAll("[data-unit-switch]")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("USD, then");
  });

  it("a switched row sorts and ranks on its USD figures like any other row (no unit conversion)", () => {
    const a = projected(ID_USD, "Usd Anchor", null);
    a.analytics = { ...a.analytics, cagr: 0.1 };
    const b = projected(ID_SWITCHED, "Switched Book", SWITCH_FLAGS);
    b.analytics = { ...b.analytics, cagr: 0.3 };
    expect(b.analytics.unit_switch_coin).toBe("BTC");
    render(<StrategyTable strategies={[a, b]} categorySlug="crypto-sma" />);
    expect(cellOf("Switched Book").closest("tr")!.textContent).toContain("30");
  });
});
