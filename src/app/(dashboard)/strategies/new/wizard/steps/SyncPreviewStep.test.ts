import { describe, it, expect } from "vitest";
import { deriveDetectedMarkets } from "./SyncPreviewStep";

// Regression: /qa 2026-05-21 — ISSUE-003. Connecting a Bybit read-only
// key surfaced "3331 trades detected across PORTFOLIO." on the verified
// factsheet preview and "Detected from your trade history: PORTFOLIO."
// on the metadata step. The Bybit + OKX ingest in
// analytics-service/services/exchange.py writes a daily portfolio-level
// aggregate row under the synthetic symbol "PORTFOLIO" alongside the
// real per-fill trades; the wizard's market-detection sample naively
// uppercase-bucketed everything including the sentinel, leaking the
// placeholder string into user-facing copy AND into the strategy
// preview subtitle that allocators eventually see.
describe("deriveDetectedMarkets", () => {
  it("filters the synthetic PORTFOLIO sentinel from Bybit/OKX aggregates", () => {
    const out = deriveDetectedMarkets([
      "BTCUSDT",
      "PORTFOLIO",
      "ETHUSDT",
      "PORTFOLIO",
      "SOLUSDT",
    ]);
    expect(out).not.toContain("PORTFOLIO");
    expect(out).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  });

  it("returns an empty array when every sampled trade is the PORTFOLIO sentinel", () => {
    expect(deriveDetectedMarkets(["PORTFOLIO", "PORTFOLIO"])).toEqual([]);
  });

  it("uppercases bases and dedupes by base asset", () => {
    expect(deriveDetectedMarkets(["btc-usd", "BTC-USD", "eth/usd"])).toEqual([
      "BTC",
      "ETH",
    ]);
  });

  it("ignores empty / nullish symbols without throwing", () => {
    expect(deriveDetectedMarkets(["BTCUSDT", "", null, undefined, "ETHUSDT"]))
      .toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("caps the result at the requested limit (default 6)", () => {
    const out = deriveDetectedMarkets([
      "A-USD",
      "B-USD",
      "C-USD",
      "D-USD",
      "E-USD",
      "F-USD",
      "G-USD",
      "H-USD",
    ]);
    expect(out).toHaveLength(6);
    expect(out).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("honors a custom limit", () => {
    expect(deriveDetectedMarkets(["A-USD", "B-USD", "C-USD"], 2)).toEqual([
      "A",
      "B",
    ]);
  });
});
