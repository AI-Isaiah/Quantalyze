import { describe, it, expect } from "vitest";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { toStrategyRows } from "./strategies-row-adapter";

type PayloadStrategy = MyAllocationDashboardPayload["strategies"][number];

/** Minimal payload-strategy fixture with sensible defaults; override per test. */
function makeStrategy(over: {
  strategy_id?: string;
  current_weight?: number | null;
  allocated_amount?: number | null;
  alias?: string | null;
  added_at?: string;
  strategy?: Partial<PayloadStrategy["strategy"]>;
}): PayloadStrategy {
  return {
    strategy_id: over.strategy_id ?? "s-1",
    current_weight: over.current_weight ?? null,
    allocated_amount: over.allocated_amount ?? null,
    alias: over.alias ?? null,
    added_at: over.added_at ?? "2026-05-03T00:00:00Z",
    eligible_for_outcome: false,
    existing_outcome: null,
    strategy: {
      id: over.strategy?.id ?? "s-1",
      name: over.strategy?.name ?? null,
      codename: over.strategy?.codename ?? null,
      disclosure_tier: over.strategy?.disclosure_tier ?? "exploratory",
      strategy_types: over.strategy?.strategy_types ?? [],
      markets: over.strategy?.markets ?? [],
      start_date: over.strategy?.start_date ?? null,
      organization_name: over.strategy?.organization_name ?? null,
      strategy_analytics:
        over.strategy?.strategy_analytics !== undefined
          ? over.strategy.strategy_analytics
          : null,
    },
  };
}

const NOW = new Date("2026-06-02T00:00:00Z");

describe("toStrategyRows", () => {
  it("returns an empty array for no strategies", () => {
    expect(toStrategyRows({ strategies: [], now: NOW })).toEqual([]);
  });

  it("preserves one output row per input strategy (bijection, order kept)", () => {
    const rows = toStrategyRows({
      strategies: [
        makeStrategy({ strategy_id: "a" }),
        makeStrategy({ strategy_id: "b" }),
        makeStrategy({ strategy_id: "c" }),
      ],
      now: NOW,
    });
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  describe("strategy name (disclosure-tier redaction preserved)", () => {
    it("alias wins over everything", () => {
      const [row] = toStrategyRows({
        strategies: [
          makeStrategy({
            alias: "  My Delta Book  ",
            strategy: { name: "Real Name", codename: "ACME", disclosure_tier: "institutional" },
          }),
        ],
        now: NOW,
      });
      expect(row.strategy).toBe("My Delta Book");
    });

    it("institutional surfaces the real name when no alias", () => {
      const [row] = toStrategyRows({
        strategies: [
          makeStrategy({ strategy: { name: "Helios Basis", disclosure_tier: "institutional" } }),
        ],
        now: NOW,
      });
      expect(row.strategy).toBe("Helios Basis");
    });

    it("exploratory falls back to codename, never the real name", () => {
      const [row] = toStrategyRows({
        strategies: [
          makeStrategy({
            strategy: { name: "Secret Manager Name", codename: "ACME-7", disclosure_tier: "exploratory" },
          }),
        ],
        now: NOW,
      });
      expect(row.strategy).toBe("ACME-7");
      expect(row.strategy).not.toContain("Secret");
    });
  });

  describe("manager (org name redaction + codename fallback)", () => {
    it("institutional with server-provided organization_name surfaces it", () => {
      const [row] = toStrategyRows({
        strategies: [
          makeStrategy({
            strategy: { organization_name: "Acme Quant LLP", codename: "ACME", disclosure_tier: "institutional" },
          }),
        ],
        now: NOW,
      });
      expect(row.manager).toBe("Acme Quant LLP");
    });

    it("exploratory (organization_name redacted to null server-side) falls back to codename", () => {
      const [row] = toStrategyRows({
        strategies: [
          makeStrategy({
            strategy: { organization_name: null, codename: "ACME-7", disclosure_tier: "exploratory" },
          }),
        ],
        now: NOW,
      });
      expect(row.manager).toBe("ACME-7");
    });

    it("null org and null codename → manager null", () => {
      const [row] = toStrategyRows({
        strategies: [makeStrategy({ strategy: { organization_name: null, codename: null } })],
        now: NOW,
      });
      expect(row.manager).toBeNull();
    });
  });

  describe("MTD derivation from daily_returns", () => {
    function withReturns(daily: unknown): PayloadStrategy {
      return makeStrategy({
        strategy: {
          strategy_analytics: {
            daily_returns: daily as never,
            cagr: null,
            sharpe: null,
            volatility: null,
            max_drawdown: null,
          },
        },
      });
    }

    it("compounds returns within the last observed month", () => {
      const [row] = toStrategyRows({
        strategies: [withReturns({ "2026-06-01": 0.01, "2026-06-02": 0.02 })],
        now: NOW,
      });
      // (1.01 * 1.02) - 1 = 0.0302
      expect(row.mtd).toBeCloseTo(0.0302, 6);
    });

    it("only compounds the last observed month, excluding prior months", () => {
      const [row] = toStrategyRows({
        strategies: [
          withReturns({
            "2026-05-30": 0.5, // prior month — must be excluded
            "2026-06-01": 0.01,
            "2026-06-02": 0.02,
          }),
        ],
        now: NOW,
      });
      expect(row.mtd).toBeCloseTo(0.0302, 6);
    });

    it("anchors on the LAST observed date, not the wall clock", () => {
      // Series ends in April; MTD = April's compounding even though now is June.
      const [row] = toStrategyRows({
        strategies: [withReturns({ "2026-03-31": 0.9, "2026-04-01": 0.05, "2026-04-02": 0.05 })],
        now: NOW,
      });
      // (1.05 * 1.05) - 1 = 0.1025 (March excluded — different month)
      expect(row.mtd).toBeCloseTo(0.1025, 6);
    });

    it("returns null for empty daily_returns", () => {
      const [row] = toStrategyRows({ strategies: [withReturns({})], now: NOW });
      expect(row.mtd).toBeNull();
    });

    it("returns null when daily_returns is null", () => {
      const [row] = toStrategyRows({
        strategies: [makeStrategy({ strategy: { strategy_analytics: null } })],
        now: NOW,
      });
      expect(row.mtd).toBeNull();
    });
  });

  describe("age from added_at", () => {
    it("computes whole days since added_at", () => {
      const [row] = toStrategyRows({
        strategies: [makeStrategy({ added_at: "2026-05-03T00:00:00Z" })],
        now: NOW, // 2026-06-02 → 30 days
      });
      expect(row.age).toBe(30);
    });

    it("clamps a future added_at (clock skew) to 0, never negative", () => {
      const [row] = toStrategyRows({
        strategies: [makeStrategy({ added_at: "2026-07-01T00:00:00Z" })],
        now: NOW,
      });
      expect(row.age).toBe(0);
    });
  });

  it("passes weight, allocation, sharpe, and maxDd through null-safe", () => {
    const [withVals, withNulls] = toStrategyRows({
      strategies: [
        makeStrategy({
          current_weight: 0.42,
          allocated_amount: 128_400,
          strategy: {
            strategy_analytics: {
              daily_returns: null,
              cagr: null,
              sharpe: 1.8,
              volatility: null,
              max_drawdown: -0.064,
            },
          },
        }),
        makeStrategy({ current_weight: null, allocated_amount: null, strategy: { strategy_analytics: null } }),
      ],
      now: NOW,
    });
    expect(withVals).toMatchObject({ weight: 0.42, allocation: 128_400, sharpe: 1.8, maxDd: -0.064 });
    expect(withNulls).toMatchObject({ weight: null, allocation: null, sharpe: null, maxDd: null });
  });
});
