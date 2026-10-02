import { describe, it, expect } from "vitest";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { bookRiskInput } from "./book-risk-input";

// ---------------------------------------------------------------------------
// Phase 169.4-01 (SC2) — the Risk tab's one adapter from the dashboard payload
// to the risk widgets.
//
// Why this matters: every risk widget reads `compositeReturns` first and only
// falls back to `buildCompositeReturns(strategies)`, the legacy
// portfolio-strategies set. On a key-connected book that set is empty or
// zero-weighted, so VaR said "Insufficient return data" while the Overview
// charted the book. The adapter hands the widgets the book's OWN daily returns,
// the series the Overview's factsheet is built from, and must not reweight,
// reorder or drop anything else the widgets (or 169.4-02's alpha/beta) read.
// ---------------------------------------------------------------------------

const bookReturns = Array.from({ length: 60 }, (_, i) => ({
  date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`,
  value: (((i * 37) % 23) - 11) / 1000,
}));

function payload(
  over: Partial<Record<string, unknown>> = {},
): MyAllocationDashboardPayload {
  return {
    strategies: [],
    analytics: null,
    apiKeys: [],
    holdingsSummary: [],
    perKeyReturnsByApiKeyId: {},
    contributingApiKeyIds: [],
    equityHistoryState: "ready",
    equityDailyReturns: bookReturns,
    unrelatedField: { keep: "me" },
    ...over,
  } as unknown as MyAllocationDashboardPayload;
}

describe("bookRiskInput — the book's daily returns reach the risk widgets", () => {
  it("compositeReturns IS the book's daily-return series, unchanged", () => {
    const out = bookRiskInput(payload());
    expect(out.compositeReturns).toEqual(bookReturns);
  });

  it("every other payload field passes through untouched", () => {
    const p = payload({ btcBenchmarkPrices: [{ date: "2026-01-01", value: 1 }] });
    const out = bookRiskInput(p) as unknown as Record<string, unknown>;
    expect(out.unrelatedField).toBe(
      (p as unknown as Record<string, unknown>).unrelatedField,
    );
    expect(out.btcBenchmarkPrices).toBe(
      (p as unknown as Record<string, unknown>).btcBenchmarkPrices,
    );
  });
});

// ---------------------------------------------------------------------------
// Task 3 (SC2): risk decomposition and the correlation matrix run over the
// per-key set the Scenario uses, each key named by the one label rule and
// weighted by the Scenario's per-key equity share. The legacy
// portfolio-strategies set (and its precomputed correlation matrix, which
// describes THAT set) must not reach them.
// ---------------------------------------------------------------------------

const keyA = "key-aaaa-1111";
const keyB = "key-bbbb-2222";
const keyManager = "key-mmmm-9999";
const seriesA = bookReturns.map((d) => ({ date: d.date, value: d.value / 2 }));
const seriesB = bookReturns.map((d, i) => ({ date: d.date, value: ((i % 7) - 3) / 500 }));

function holding(
  api_key_id: string,
  holding_type: "spot" | "derivative",
  value_usd: number,
  unrealized_pnl_usd: number | null,
) {
  return {
    symbol: "X",
    quantity: 1,
    mark_price_usd: null,
    value_usd,
    venue: "binance",
    holding_type,
    api_key_id,
    side: holding_type === "spot" ? "flat" : "long",
    entry_price: null,
    unrealized_pnl_usd,
  };
}

function perKeyPayload(over: Partial<Record<string, unknown>> = {}) {
  return payload({
    strategies: [{ strategy_id: "legacy-1", alias: "Legacy", current_weight: 1 }],
    analytics: {
      correlation_matrix: { "legacy-1": { "legacy-1": 1 } },
      keepMe: 42,
    },
    apiKeys: [
      { id: keyA, exchange: "binance", label: "Main" },
      { id: keyB, exchange: "binance", label: "Hedge" },
      { id: keyManager, exchange: "okx", label: "Manager" },
    ],
    perKeyReturnsByApiKeyId: {
      [keyA]: seriesA,
      [keyB]: seriesB,
      // A manager-side key has a series but is not contributing: the Scenario
      // drops it, so the Risk tab must too.
      [keyManager]: seriesA,
    },
    contributingApiKeyIds: [keyA, keyB],
    holdingsSummary: [
      holding(keyA, "spot", 1000, null),
      // A derivative contributes its unrealized P&L, never its notional.
      holding(keyA, "derivative", 50_000, 250),
      holding(keyB, "spot", 400, null),
      holding(keyB, "derivative", 90_000, -900),
    ],
    ...over,
  });
}

describe("bookRiskInput — the per-key set the Scenario uses", () => {
  it("one strategies entry per contributing key, named by the one label rule and carrying that key's returns", () => {
    const out = bookRiskInput(perKeyPayload());
    expect(out.strategies).toHaveLength(2);
    const [a, b] = out.strategies;
    expect(a.strategy_id).toBe(keyA);
    expect(a.alias).toBe("Binance — Main");
    expect(a.strategy?.id).toBe(keyA);
    expect(a.strategy?.name).toBe("Binance — Main");
    expect(a.strategy?.strategy_analytics?.daily_returns).toEqual(seriesA);
    expect(b.strategy_id).toBe(keyB);
    expect(b.alias).toBe("Binance — Hedge");
    expect(b.strategy?.strategy_analytics?.daily_returns).toEqual(seriesB);
    // Never a raw key id as a label (T-169-26), never the legacy row.
    for (const s of out.strategies) {
      expect(s.alias).not.toContain("key-");
      expect(s.alias).not.toBe("Legacy");
    }
  });

  it("weights each key by its equity share, as the Scenario does: spot value plus derivative P&L, clamped at 0", () => {
    const out = bookRiskInput(perKeyPayload());
    const [a, b] = out.strategies;
    expect(a.current_weight).toBe(1250); // 1000 spot + 250 derivative P&L
    expect(b.current_weight).toBe(0); // 400 - 900 = -500, clamped
  });

  it("a key with an empty series is skipped", () => {
    const out = bookRiskInput(
      perKeyPayload({
        perKeyReturnsByApiKeyId: { [keyA]: seriesA, [keyB]: [] },
      }),
    );
    expect(out.strategies.map((s) => s.strategy_id)).toEqual([keyA]);
  });

  it("a key with no label row falls back to the Scenario's neutral name, never its id", () => {
    const out = bookRiskInput(perKeyPayload({ apiKeys: [] }));
    for (const s of out.strategies) expect(s.alias).toBe("Connected key");
  });

  it("drops the precomputed correlation matrix (it describes the legacy set) and keeps every other analytics field", () => {
    const out = bookRiskInput(perKeyPayload());
    const analytics = out.analytics as Record<string, unknown> | null;
    expect(analytics).not.toBeNull();
    expect(analytics).not.toHaveProperty("correlation_matrix");
    expect(analytics?.keepMe).toBe(42);
  });

  it("a null analytics stays null", () => {
    expect(bookRiskInput(perKeyPayload({ analytics: null })).analytics).toBeNull();
  });
});
