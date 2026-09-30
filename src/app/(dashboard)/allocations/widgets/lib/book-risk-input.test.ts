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
