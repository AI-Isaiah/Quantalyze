import { describe, it, expect } from "vitest";
import type {
  MyAllocationDashboardPayload,
  OwnCapitalStrategy,
} from "@/lib/queries";
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
      trust_tier: over.strategy?.trust_tier ?? null,
      is_composite: over.strategy?.is_composite ?? false,
      series_state: over.strategy?.series_state ?? "empty",
      strategy_analytics:
        over.strategy?.strategy_analytics !== undefined
          ? over.strategy.strategy_analytics
          : null,
    },
  };
}

const NOW = new Date("2026-06-02T00:00:00Z");

// The pre-150 F4b cases below all exercise the POSITION half of the union —
// they feed `portfolio_strategies` rows. Plan 07 narrowed `strategies` to the
// marked shape and made `positions` required (the B-3 slack that let a payload
// row arrive under `strategies` is gone), so each of them names `positions`
// explicitly. The assertions are unchanged: what a position row renders is
// exactly what it rendered before this phase.
describe("toStrategyRows", () => {
  it("returns an empty array for no strategies", () => {
    expect(toStrategyRows({ strategies: [], positions: [], now: NOW })).toEqual(
      [],
    );
  });

  it("preserves one output row per input strategy (bijection, order kept)", () => {
    const rows = toStrategyRows({
      strategies: [],
      positions: [
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
        strategies: [],
        positions: [
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
        strategies: [],
        positions: [
          makeStrategy({ strategy: { name: "Helios Basis", disclosure_tier: "institutional" } }),
        ],
        now: NOW,
      });
      expect(row.strategy).toBe("Helios Basis");
    });

    it("exploratory falls back to codename, never the real name", () => {
      const [row] = toStrategyRows({
        strategies: [],
        positions: [
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
        strategies: [],
        positions: [
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
        strategies: [],
        positions: [
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
        strategies: [],
        positions: [makeStrategy({ strategy: { organization_name: null, codename: null } })],
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
        strategies: [],
        positions: [withReturns({ "2026-06-01": 0.01, "2026-06-02": 0.02 })],
        now: NOW,
      });
      // (1.01 * 1.02) - 1 = 0.0302
      expect(row.mtd).toBeCloseTo(0.0302, 6);
    });

    it("only compounds the last observed month, excluding prior months", () => {
      const [row] = toStrategyRows({
        strategies: [],
        positions: [
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
        strategies: [],
        positions: [withReturns({ "2026-03-31": 0.9, "2026-04-01": 0.05, "2026-04-02": 0.05 })],
        now: NOW,
      });
      // (1.05 * 1.05) - 1 = 0.1025 (March excluded — different month)
      expect(row.mtd).toBeCloseTo(0.1025, 6);
    });

    it("returns null for empty daily_returns", () => {
      const [row] = toStrategyRows({
        strategies: [],
        positions: [withReturns({})],
        now: NOW,
      });
      expect(row.mtd).toBeNull();
    });

    it("returns null when daily_returns is null", () => {
      const [row] = toStrategyRows({
        strategies: [],
        positions: [makeStrategy({ strategy: { strategy_analytics: null } })],
        now: NOW,
      });
      expect(row.mtd).toBeNull();
    });
  });

  describe("age from added_at", () => {
    it("computes whole days since added_at", () => {
      const [row] = toStrategyRows({
        strategies: [],
        positions: [makeStrategy({ added_at: "2026-05-03T00:00:00Z" })],
        now: NOW, // 2026-06-02 → 30 days
      });
      expect(row.age).toBe(30);
    });

    it("clamps a future added_at (clock skew) to 0, never negative", () => {
      const [row] = toStrategyRows({
        strategies: [],
        positions: [makeStrategy({ added_at: "2026-07-01T00:00:00Z" })],
        now: NOW,
      });
      expect(row.age).toBe(0);
    });
  });

  it("passes allocation, sharpe, and maxDd through null-safe — and weight is NULL even when current_weight is set", () => {
    const [withVals, withNulls] = toStrategyRows({
      strategies: [],
      positions: [
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
    // Review round 2 W-1 / D-12-B: `current_weight` is no longer a display
    // source. This row feeds 0.42 and STILL gets null, because it is not in
    // the marked own-capital set. Re-adding `weight: ps.current_weight` to the
    // adapter must redden this expectation — it is the ledger oracle for that
    // mutation, and the reason the expectation changed from 0.42.
    expect(withVals).toMatchObject({ weight: null, allocation: 128_400, sharpe: 1.8, maxDd: -0.064 });
    expect(withNulls).toMatchObject({ weight: null, allocation: null, sharpe: null, maxDd: null });
  });
});

// ═══════════════════════════════════════════════ Phase 150 / OWN-03 additions

/** Minimal own-capital marked-strategy fixture (the getOwnCapitalStrategies shape). */
function makeMarked(over: {
  id?: string;
  name?: string | null;
  codename?: string | null;
  disclosure_tier?: PayloadStrategy["strategy"]["disclosure_tier"];
  capital_ownership?: string | null;
  /**
   * Review round 3 E2 — MTD is now a SCALAR on the payload, reduced
   * server-side by `getOwnCapitalStrategies`; the marked half no longer
   * carries a return series at all. The server-side reduction has its own
   * coverage in `queries.own-capital-strategies.test.ts`.
   */
  mtd?: number | null;
  analytics?: {
    sharpe?: number | null;
    max_drawdown?: number | null;
  } | null;
}): OwnCapitalStrategy {
  return {
    id: over.id ?? "m-1",
    name: over.name === undefined ? "Helios Basis" : over.name,
    codename: over.codename ?? null,
    disclosure_tier: over.disclosure_tier ?? "exploratory",
    status: "private",
    capital_ownership: (over.capital_ownership === undefined
      ? "own_capital"
      : over.capital_ownership) as OwnCapitalStrategy["capital_ownership"],
    mtd: over.mtd ?? null,
    strategy_analytics:
      over.analytics === undefined || over.analytics === null
        ? null
        : ({
            cagr: null,
            sharpe: over.analytics.sharpe ?? null,
            volatility: null,
            max_drawdown: over.analytics.max_drawdown ?? null,
          } as OwnCapitalStrategy["strategy_analytics"]),
  };
}

describe("toStrategyRows — D-12-A union row set", () => {
  it("emits one row per element of (marked strategies) ∪ (positions)", () => {
    const rows = toStrategyRows({
      strategies: [makeMarked({ id: "both" }), makeMarked({ id: "marked-only" })],
      positions: [
        makeStrategy({ strategy_id: "both", allocated_amount: 100_000 }),
        makeStrategy({ strategy_id: "position-only", allocated_amount: 50_000 }),
      ],
      now: NOW,
    });
    expect(rows.map((r) => r.id).sort()).toEqual([
      "both",
      "marked-only",
      "position-only",
    ]);
    // A strategy in BOTH sets produces exactly ONE row, not two.
    expect(rows.filter((r) => r.id === "both")).toHaveLength(1);
  });

  it("[D-12-A] a position whose strategy is NOT marked KEEPS its row — allocated money never leaves the money surface", () => {
    const rows = toStrategyRows({
      strategies: [],
      positions: [
        makeStrategy({ strategy_id: "legacy", allocated_amount: 250_000 }),
      ],
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "legacy",
      allocation: 250_000,
      // No allocate/edit affordance data — Plan 07 renders this row without
      // the action, but the MONEY is still visible.
      capitalOwnership: null,
    });
  });

  it("a marked strategy WITHOUT a position produces an unallocated row with honest nulls, never zeros", () => {
    const [row] = toStrategyRows({
      strategies: [makeMarked({ id: "fresh" })],
      positions: [],
      now: NOW,
    });
    expect(row.id).toBe("fresh");
    expect(row.capitalOwnership).toBe("own_capital");
    // Explicitly null — a 0 age would read as "added today" (fabricated) and a
    // 0 allocation would read as "allocated nothing" rather than "not yet".
    expect(row.allocation).toBeNull();
    expect(row.age).toBeNull();
    expect(row.weight).toBeNull();
  });

  it("a marked strategy WITH a position carries the position's allocation and age", () => {
    const [row] = toStrategyRows({
      strategies: [makeMarked({ id: "live" })],
      positions: [
        makeStrategy({
          strategy_id: "live",
          allocated_amount: 120_000,
          added_at: "2026-05-03T00:00:00Z", // 30 days before NOW
        }),
      ],
      now: NOW,
    });
    expect(row).toMatchObject({
      capitalOwnership: "own_capital",
      allocation: 120_000,
      age: 30,
    });
  });

  it("fails CLOSED: a marked-set row carrying a garbled mark is NOT treated as own-capital", () => {
    // getOwnCapitalStrategies filters server-side, but the column is `text`.
    // If that filter ever drifts, the adapter must not hand a money affordance
    // to a row it cannot vouch for.
    const [row] = toStrategyRows({
      strategies: [makeMarked({ id: "garbled", capital_ownership: "OWN_CAPITAL " })],
      positions: [],
      now: NOW,
    });
    expect(row.capitalOwnership).toBeNull();
  });

  it("fails CLOSED on the POSITIONED arm too — membership alone is not the predicate", () => {
    // The two halves derive `capitalOwnership` at two separate call sites.
    // Measured, not assumed: a mutation replacing the positioned arm's
    // `isAllocatable(...)` with a bare `owned ? … : null` left the suite GREEN
    // until this case existed, because the case above only exercises the
    // marked-WITHOUT-position arm.
    const [row] = toStrategyRows({
      strategies: [
        makeMarked({ id: "garbled", capital_ownership: "team_review" }),
      ],
      positions: [
        makeStrategy({ strategy_id: "garbled", allocated_amount: 50_000 }),
      ],
      now: NOW,
    });
    expect(row.capitalOwnership).toBeNull();
    // …and therefore it is excluded from the derived-weight denominator.
    expect(row.weight).toBeNull();
  });
});

describe("toStrategyRows — D-12-B render-derived weight", () => {
  it("divides each allocated own-capital row by the allocated own-capital total", () => {
    const rows = toStrategyRows({
      strategies: [makeMarked({ id: "a" }), makeMarked({ id: "b" })],
      positions: [
        makeStrategy({ strategy_id: "a", allocated_amount: 120_000 }),
        makeStrategy({ strategy_id: "b", allocated_amount: 380_000 }),
      ],
      now: NOW,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // 120k / 500k and 380k / 500k — the denominator is the ALLOCATED
    // OWN-CAPITAL set, which is what the column header names.
    expect(byId.a.weight).toBeCloseTo(0.24, 10);
    expect(byId.b.weight).toBeCloseTo(0.76, 10);
    // Economic invariant: the derived shares partition the allocated book.
    expect(byId.a.weight! + byId.b.weight!).toBeCloseTo(1, 10);
  });

  it("a single allocated own-capital row is the whole book (weight 1)", () => {
    const [row] = toStrategyRows({
      strategies: [makeMarked({ id: "solo" })],
      positions: [makeStrategy({ strategy_id: "solo", allocated_amount: 7_500 })],
      now: NOW,
    });
    expect(row.weight).toBe(1);
  });

  it("an UNMARKED positioned row keeps weight null even with a live allocation, and is EXCLUDED from the denominator", () => {
    const rows = toStrategyRows({
      strategies: [makeMarked({ id: "mine" })],
      positions: [
        makeStrategy({ strategy_id: "mine", allocated_amount: 100_000 }),
        makeStrategy({ strategy_id: "theirs", allocated_amount: 900_000 }),
      ],
      now: NOW,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.theirs.weight).toBeNull();
    // Its money still shows in the Allocation column…
    expect(byId.theirs.allocation).toBe(900_000);
    // …but it is not in the denominator: 100k/100k, not 100k/1M.
    expect(byId.mine.weight).toBe(1);
  });

  it("a marked-but-unallocated row is excluded from the denominator and gets weight null", () => {
    const rows = toStrategyRows({
      strategies: [makeMarked({ id: "funded" }), makeMarked({ id: "idle" })],
      positions: [
        makeStrategy({ strategy_id: "funded", allocated_amount: 40_000 }),
      ],
      now: NOW,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.idle.weight).toBeNull();
    expect(byId.funded.weight).toBe(1);
  });

  it("a zero denominator yields null weights, never NaN or Infinity", () => {
    const rows = toStrategyRows({
      strategies: [makeMarked({ id: "z" })],
      positions: [makeStrategy({ strategy_id: "z", allocated_amount: 0 })],
      now: NOW,
    });
    expect(rows[0].weight).toBeNull();
  });

  it("[W-1 LEDGER ORACLE] a positioned row with a non-null current_weight never renders it", () => {
    // Both arms of the re-add mutation (`weight: ps.current_weight`):
    // unmarked → null, marked+allocated → the DERIVED share, never 0.42.
    const rows = toStrategyRows({
      strategies: [makeMarked({ id: "marked" })],
      positions: [
        makeStrategy({
          strategy_id: "marked",
          current_weight: 0.42,
          allocated_amount: 10_000,
        }),
        makeStrategy({ strategy_id: "unmarked", current_weight: 0.42 }),
      ],
      now: NOW,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.unmarked.weight).toBeNull();
    expect(byId.marked.weight).toBe(1);
    expect(rows.map((r) => r.weight)).not.toContain(0.42);
  });
});

describe("toStrategyRows — OWN-05 SC 1c owner-name carve-out", () => {
  it("renders the owner's REAL name for a wizard-shaped row (codename null, tier exploratory)", () => {
    // Without the carve-out this row renders "Strategy #<id8>" — the
    // 2026-08-05 holdings-confusion mechanism, and the whole point of OWN-05.
    const [row] = toStrategyRows({
      strategies: [
        makeMarked({
          id: "8d382aaf-0000-4000-8000-000000000000",
          name: "Alpha Centauri",
          codename: null,
          disclosure_tier: "exploratory",
        }),
      ],
      positions: [],
      now: NOW,
    });
    expect(row.strategy).toBe("Alpha Centauri");
    expect(row.strategy).not.toContain("Strategy #");
  });

  it("makes a RENAME visible: the new strategies.name reaches the Holdings label", () => {
    const before = toStrategyRows({
      strategies: [makeMarked({ id: "s", name: "Black Swan" })],
      positions: [makeStrategy({ strategy_id: "s", allocated_amount: 1_000 })],
      now: NOW,
    })[0];
    const after = toStrategyRows({
      strategies: [makeMarked({ id: "s", name: "Helios Basis Sleeve" })],
      positions: [makeStrategy({ strategy_id: "s", allocated_amount: 1_000 })],
      now: NOW,
    })[0];
    expect(before.strategy).toBe("Black Swan");
    expect(after.strategy).toBe("Helios Basis Sleeve");
  });

  it("an allocator-set alias still WINS over the real name", () => {
    const [row] = toStrategyRows({
      strategies: [makeMarked({ id: "s", name: "Alpha Centauri" })],
      positions: [
        makeStrategy({ strategy_id: "s", alias: "  My Delta Book  " }),
      ],
      now: NOW,
    });
    expect(row.strategy).toBe("My Delta Book");
  });

  it("falls through to displayStrategyName when the owner's name is null", () => {
    const [row] = toStrategyRows({
      strategies: [
        makeMarked({ id: "s", name: null, codename: "ACME-7" }),
      ],
      positions: [],
      now: NOW,
    });
    expect(row.strategy).toBe("ACME-7");
  });

  it("[DISCLOSURE] the carve-out NEVER reaches an unmarked third-party position row", () => {
    // The carve-out is owner-scoped: marked-set membership IS ownership
    // (getOwnCapitalStrategies is user_id-filtered). A third-party exploratory
    // row must still redact to its codename — pairing the real name with the
    // codename defeats pseudonymity (browse/route.ts:44-56).
    const [row] = toStrategyRows({
      strategies: [],
      positions: [
        makeStrategy({
          strategy_id: "theirs",
          strategy: {
            name: "Secret Manager Name",
            codename: "ACME-7",
            disclosure_tier: "exploratory",
          },
        }),
      ],
      now: NOW,
    });
    expect(row.strategy).toBe("ACME-7");
    expect(row.strategy).not.toContain("Secret");
  });

  it("manager stays honest for an owner's own row: no org, no codename → null", () => {
    const [row] = toStrategyRows({
      strategies: [makeMarked({ id: "s", codename: null })],
      positions: [],
      now: NOW,
    });
    expect(row.manager).toBeNull();
  });

  it("E3: the Manager cell does not change meaning when money arrives — an owner's own strategy shows its CODENAME whether or not it has a position", () => {
    // The product call behind E3. Both halves resolve
    // `organization_name ?? codename ?? null`, and an owner's own strategy is
    // non-institutional (organization_name redacted to null server-side), so
    // both land on the codename. Had half 2 been dropped to `manager: null`,
    // this SAME strategy would read "—" while unallocated and "OWL-3" the
    // moment an allocation was made — a cell whose meaning turns on an
    // unrelated event.
    const CODENAME = "OWL-3";
    const [unallocated] = toStrategyRows({
      strategies: [makeMarked({ id: "s", codename: CODENAME })],
      positions: [],
      now: NOW,
    });
    const [allocated] = toStrategyRows({
      strategies: [makeMarked({ id: "s", codename: CODENAME })],
      positions: [
        makeStrategy({
          strategy_id: "s",
          allocated_amount: 100_000,
          strategy: { organization_name: null, codename: CODENAME },
        }),
      ],
      now: NOW,
    });

    // Non-vacuity: these really are the two different halves (only the second
    // carries money), so an identical Manager cell is a claim, not a tautology.
    expect(unallocated.allocation).toBeNull();
    expect(allocated.allocation).toBe(100_000);
    expect(unallocated.manager).toBe(CODENAME);
    expect(allocated.manager).toBe(CODENAME);
  });

  it("carries MTD/sharpe/maxDd from the marked strategy's own payload when it has no position", () => {
    // Review round 3 E2 — MTD arrives as a SCALAR the server already reduced;
    // sharpe/maxDd were always scalars. The adapter's job on this half is to
    // put all three on the row, not to recompute any of them.
    const [row] = toStrategyRows({
      strategies: [
        makeMarked({
          id: "s",
          mtd: 0.0302,
          analytics: { sharpe: 1.8, max_drawdown: -0.064 },
        }),
      ],
      positions: [],
      now: NOW,
    });
    expect(row.mtd).toBe(0.0302);
    expect(row.sharpe).toBe(1.8);
    expect(row.maxDd).toBe(-0.064);
  });

  it("E2: the marked half carries NO return series — the row's MTD is the payload's scalar and nothing else", () => {
    // The falsifier for the RSC-payload fix. If `OwnCapitalStrategy` ever
    // regrows a series field and the adapter goes back to reducing it here,
    // this row's MTD would come from the series instead of the scalar and the
    // two assertions below would disagree.
    const marked = makeMarked({ id: "s", mtd: -0.017 });
    // The payload genuinely has no series to reduce — the discriminator.
    expect(
      Object.keys((marked.strategy_analytics ?? {}) as object),
    ).not.toContain("daily_returns");
    expect(marked).not.toHaveProperty("returns_series");

    const [row] = toStrategyRows({ strategies: [marked], positions: [], now: NOW });
    expect(row.mtd).toBe(-0.017);
  });
});

// The B-3 back-compat slack (`HAND-OFF 150-07`) and the two cases that pinned
// it are DELETED in Plan 07 Task 3, together with the union parameter type and
// the runtime `strategy_id`-shape discrimination they exercised. They pinned an
// INTERIM state — a one-argument `toStrategyRows({ strategies })` call carrying
// payload rows — which no longer exists: `HoldingsTabPanel` now passes
// `{ strategies: marked, positions }` explicitly and `positions` is required.
// A test that survives the deletion of its subject would be asserting about a
// code path nobody can reach.
