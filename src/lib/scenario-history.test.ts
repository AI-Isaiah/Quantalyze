import { describe, expect, it } from "vitest";
import type { DailyPoint, StrategyForBuilder } from "@/lib/scenario";
import { shortestHistoryName } from "@/lib/scenario-history";

/**
 * Unit tests for the coverage-caveat `shortestHistoryName` helper.
 *
 * The fixtures use the REAL `StrategyForBuilder` element type — the element
 * type of the engine strategy set that the composer and builder call sites
 * actually pass. The helper must exercise that exact
 * shape, not a hand-rolled `{ name, days }` struct.
 */

/** Build a `daily_returns` window of `len` sequential business days. */
function window(len: number, startISO = "2024-01-01"): DailyPoint[] {
  const out: DailyPoint[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  for (let i = 0; i < len; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    out.push({ date: d.toISOString().slice(0, 10), value: 0 });
  }
  return out;
}

/**
 * Construct a full `StrategyForBuilder` with the given name + return window,
 * defaulting every other field so the fixture matches the real call-site
 * element type rather than a partial/hand-rolled struct.
 */
function strategy(
  id: string,
  name: string,
  returns: DailyPoint[],
): StrategyForBuilder {
  return {
    id,
    name,
    codename: null,
    disclosure_tier: "public",
    strategy_types: [],
    markets: [],
    start_date: returns[0]?.date ?? null,
    daily_returns: returns,
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
}

describe("shortestHistoryName", () => {
  it("returns the name of the strategy with the shortest return window (multi-strategy)", () => {
    const strategies: StrategyForBuilder[] = [
      strategy("a", "Long History", window(500)),
      strategy("b", "Short History", window(40)),
      strategy("c", "Medium History", window(120)),
    ];
    expect(shortestHistoryName(strategies)).toBe("Short History");
  });

  it("breaks ties by input order (first-seen wins) — deterministic", () => {
    const strategies: StrategyForBuilder[] = [
      strategy("a", "First Tied", window(30)),
      strategy("b", "Second Tied", window(30)),
      strategy("c", "Longer", window(90)),
    ];
    // Both tied at 30; the first one in input order is returned.
    expect(shortestHistoryName(strategies)).toBe("First Tied");
  });

  it("returns null for empty input (degenerate — never throws)", () => {
    expect(shortestHistoryName([])).toBeNull();
  });

  it("returns the lone name for a single-strategy input (degenerate)", () => {
    const strategies: StrategyForBuilder[] = [
      strategy("a", "Only One", window(250)),
    ];
    expect(shortestHistoryName(strategies)).toBe("Only One");
  });

  it("treats a strategy with an empty return window as the shortest", () => {
    const strategies: StrategyForBuilder[] = [
      strategy("a", "Populated", window(100)),
      strategy("b", "No Returns Yet", window(0)),
    ];
    expect(shortestHistoryName(strategies)).toBe("No Returns Yet");
  });
});
