import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScenarioBuilder } from "@/components/scenarios/ScenarioBuilder";
import type { DailyPoint, StrategyForBuilder } from "@/lib/scenario";
// IMPACT-02 — imported REAL (never mocked) so the neuter guard's positive
// control renders a genuine PercentileRankBadge in isolation, proving the
// data-testid query matches a real badge (non-vacuous). See ScenarioComposer's
// strengthened R3 guard, which this replicates for the Sandbox surface.
import { PercentileRankBadge } from "@/components/strategy/PercentileRankBadge";

/**
 * First test file for the example-universe Strategy Sandbox (ScenarioBuilder).
 *
 * Covers the honesty contract this surface gained in Plan 21-04:
 *  - IMPACT-01 framing: the "Example universe" badge (SURF-03 label), the
 *    persistent "PROJECTED — hypothetical, not your live book" badge, and the
 *    coverage caveat (N overlapping days + shortest-history strategy name).
 *  - CORR-03: the correlation MetricCard reads "Avg |ρ|" (not "Avg |corr|"),
 *    reconciled with the composer / KPI strip.
 *  - IMPACT-02: a NON-VACUOUS neuter guard asserting NO PercentileRankBadge
 *    renders on the Sandbox blend (a hypothetical what-if must never be
 *    peer-ranked / percentile-scored). The ABSENT assertion keys on the unique
 *    render-only `data-testid="percentile-rank-badge"` (Plan 21-03 added it),
 *    NOT a visible label (which collides with the Sandbox's own MetricCards)
 *    and NOT `/percentile/i` (which lives only in a `title=` attribute → a
 *    vacuous pass). A required positive-control isolation render proves the
 *    query matches a real badge, so an all-null tree can't pass vacuously.
 *
 * The fixtures use the REAL `StrategyForBuilder` element type — the shape the
 * page (`scenarios/page.tsx`) actually passes — with ≥2 strategies and ≥10
 * overlapping days, distinct non-constant return series (so the engine produces
 * a non-null correlation matrix instead of the empty state).
 */

afterEach(cleanup);

/**
 * Build a `daily_returns` window of `len` sequential business days. `seed`
 * shifts the deterministic series so two strategies have distinct (non-equal,
 * non-constant) returns → a genuine pairwise correlation. Every `1 + r` stays
 * positive and cumulative > 0, so the engine returns a real matrix (it nulls
 * the matrix on non-finite values or a non-positive cumulative).
 */
function window(len: number, seed: number, startISO = "2024-01-01"): DailyPoint[] {
  const out: DailyPoint[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  for (let i = 0; i < len; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    // Small bounded oscillation around a slight positive drift; the seed phase
    // makes each strategy's series distinct without ever pushing 1+r ≤ 0.
    const value = 0.002 + 0.01 * Math.sin((i + seed) * 0.7);
    out.push({ date: d.toISOString().slice(0, 10), value });
  }
  return out;
}

/**
 * Construct a full `StrategyForBuilder` so the fixture matches the real
 * call-site element type, not a partial/hand-rolled struct.
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
    strategy_types: ["systematic"],
    markets: ["BTC"],
    start_date: returns[0]?.date ?? null,
    daily_returns: returns,
    cagr: 0.1,
    sharpe: 1,
    volatility: 0.2,
    max_drawdown: -0.1,
  };
}

/**
 * Two strategies, 30 overlapping days, distinct series. "Short Leg" has the
 * fewest return points → it is the shortest-history name the caveat must show.
 */
function twoStrategies(): StrategyForBuilder[] {
  return [
    strategy("long", "Long Leg", window(30, 0)),
    // Shorter window (fewer daily_returns points) → shortest-history name.
    strategy("short", "Short Leg", window(20, 4)),
  ];
}

describe("ScenarioBuilder honesty surface", () => {
  it("IMPACT-01 — renders the Example universe badge, the persistent PROJECTED badge, and the coverage caveat", () => {
    render(<ScenarioBuilder strategies={twoStrategies()} />);

    // SURF-03 — the surface is labeled as an illustrative example universe.
    const exampleBadge = screen.getByTestId("sandbox-example-universe-badge");
    expect(exampleBadge).toBeInTheDocument();
    expect(exampleBadge.textContent).toBe("Example universe");

    // IMPACT-01 — the persistent PROJECTED badge (always rendered).
    const projected = screen.getByTestId("scenario-projected-badge");
    expect(projected).toBeInTheDocument();
    expect(projected.textContent).toBe(
      "PROJECTED — hypothetical, not your live book",
    );

    // IMPACT-01 — the coverage caveat names the live N overlapping days AND the
    // shortest-history strategy ("Short Leg" has the fewest return points).
    const caveat = screen.getByTestId("scenario-coverage-caveat");
    const text = caveat.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toMatch(/^Projected from \d+ overlapping days\./);
    expect(text).toContain("Shortest history: Short Leg.");
    expect(text).toContain("Not a forecast.");
  });

  it("IMPACT-01 — the honesty badges are neutral-outline pills, NOT bg-accent / warning / role=alert / <Badge>", () => {
    render(<ScenarioBuilder strategies={twoStrategies()} />);

    for (const testid of [
      "sandbox-example-universe-badge",
      "scenario-projected-badge",
    ]) {
      const badge = screen.getByTestId(testid);
      // Neutral-outline tokens present.
      expect(badge.className).toContain("border-text-muted");
      expect(badge.className).toContain("text-text-muted");
      // Wrong signals absent: no accent fill, no warning amber, no alert role.
      expect(badge.className).not.toContain("bg-accent");
      expect(badge.className).not.toMatch(/warning|amber/);
      expect(badge.getAttribute("role")).not.toBe("alert");
      // A plain <span> pill, not the filled <Badge> primitive.
      expect(badge.tagName.toLowerCase()).toBe("span");
    }
  });

  it("CORR-03 — the correlation MetricCard label reads 'Avg |ρ|', not 'Avg |corr|'", () => {
    render(<ScenarioBuilder strategies={twoStrategies()} />);
    // "Avg |ρ|" appears as the KPI MetricCard label AND the single-sourced
    // heatmap caption (the CORR-03 reconciliation — one literal across the
    // surface). The old "Avg |corr|" literal is gone entirely.
    expect(screen.getAllByText("Avg |ρ|").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Avg |corr|")).toBeNull();
  });

  it("IMPACT-02 — NO PercentileRankBadge renders on the Sandbox blend (no peer-ranking a what-if); the guard is non-vacuous", () => {
    render(<ScenarioBuilder strategies={twoStrategies()} />);

    // Positive control: the projection DID render its KPI surface (so an
    // all-null tree can't make the ABSENT assertions below pass vacuously).
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.getAllByText("Avg |ρ|").length).toBeGreaterThanOrEqual(1);

    // The hazard: a peer/percentile panel on a hypothetical blend peer-ranks a
    // book that doesn't exist — a no-invented-data violation. The Sandbox builds
    // from computeScenario + MetricCards, never a FactsheetBody / percentile
    // panel, so PercentileRankBadge is structurally absent. The ABSENT assertion
    // keys on the UNIQUE render-only data-testid (NOT queryByText(/percentile/i),
    // which only matches a title= attr → vacuous, and NOT a visible label like
    // "Sharpe", which collides with the Sandbox's own MetricCards). If a
    // PercentileRankBadge is ever wired onto the Sandbox projection, this FAILS.
    expect(screen.queryByTestId("percentile-rank-badge")).toBeNull();
    expect(screen.queryByText(/ranked against peers/i)).toBeNull();

    // Positive control — prove the testid query is NON-VACUOUS. Render a real
    // PercentileRankBadge in isolation and assert the SAME query FINDS it. If the
    // testid were ever renamed/removed (silently turning the ABSENT guard above
    // into a vacuous pass), this control fails loudly.
    cleanup();
    render(<PercentileRankBadge metric="sharpe" percentile={95} />);
    expect(screen.getByTestId("percentile-rank-badge")).toBeInTheDocument();
  });
});
