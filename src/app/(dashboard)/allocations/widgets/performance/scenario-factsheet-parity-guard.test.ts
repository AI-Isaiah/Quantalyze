import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * PARITY-01 (Phase 56) — STRUCTURAL single-source-of-truth guard.
 *
 * The runtime spec (scenario-factsheet-payload.test.ts) proves the factsheet
 * body EQUALS compute() on the engine's emitted series for a representative
 * scenario. This spec pins the STRUCTURE that makes that parity hold for EVERY
 * future call, not just the fixtures: the factsheet payload builder consumes the
 * engine's portfolioDaily series and RE-DERIVES NOTHING of the blend, and the
 * mount sources portfolioDaily from computeScenario's output.
 *
 * WHY a source-level guard (CLAUDE.md Rule 9): a runtime assertion can only test
 * the inputs it happens to build. The v1.5 risk is a FUTURE edit — someone routes
 * the payload through a re-derived blend, or feeds it a stale union series — that
 * a fixed fixture would silently miss. Reading the source and asserting the
 * builder contains NO membership/divisor/window math (and imports nothing from
 * the engine) makes any such regression fail LOUD, regardless of inputs. This
 * mirrors the established readFileSync source-guard pattern in
 * src/lib/scenario-window.test.ts and tap-target-minimums.test.ts (string reads +
 * toContain / not.toContain, NOT grep -c).
 *
 * Falsifiability (proven, not asserted): adding an import of covers from
 * "@/lib/scenario-window" to the builder turns case (b) RED — see the
 * mutation-check note in 56-01-SUMMARY.md. The not.toContain set is the
 * load-bearing half; do NOT weaken it to a tautology.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const PAYLOAD_BUILDER_PATH = resolve(HERE, "scenario-factsheet-payload.ts");
const FACTSHEET_CHART_PATH = resolve(HERE, "ScenarioFactsheetChart.tsx");
// ScenarioComposer.tsx lives two dirs up (…/allocations/components).
const COMPOSER_PATH = resolve(
  HERE,
  "..",
  "..",
  "components",
  "ScenarioComposer.tsx",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Strip comment lines so header/JSDoc prose that legitimately MENTIONS the blend
 * (coverageSpanOf, member_count, "re-derives NOTHING", …) cannot self-invalidate
 * a not.toContain gate. We only want the guard to fire on genuine CODE
 * references. Filters full-line //, block-open, and JSDoc-continuation lines —
 * the builder's comments are all block/JSDoc style, none are trailing on a code
 * line that carries one of the banned tokens.
 */
function codeLinesOnly(src: string): string {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !(
        t.startsWith("//") ||
        t.startsWith("/*") ||
        t.startsWith("*") ||
        t.startsWith("*/")
      );
    })
    .join("\n");
}

describe("PARITY-01 structural guard — factsheet payload builder is single-source-of-truth", () => {
  const builderSrc = read(PAYLOAD_BUILDER_PATH);
  const builderCode = codeLinesOnly(builderSrc);

  // (a) The builder CONSUMES the engine series and computes the body from it.
  // WHY THIS MATTERS: parity-by-construction requires the factsheet body come from
  // the SAME compute() the real strategy factsheet runs, applied to the engine's
  // portfolioDaily. If a future edit stopped feeding the body through
  // compute(rets, datesR) (e.g. hand-rolled scenario metrics), the body would no
  // longer equal the engine series' compute() and this pin goes RED.
  it("consumes portfolioDaily and derives the body via compute(rets, datesR)", () => {
    // The args surface names the engine series as its single input.
    expect(builderCode).toContain("portfolioDaily");
    expect(builderCode).toContain("ScenarioFactsheetPayloadArgs");
    // The body is the SAME compute() the real factsheet runs, on that series.
    expect(builderSrc).toContain("compute(rets, datesR)");
    // The equity/drawdown line is destructured off that compute() result
    // (eq, dd, ...strategyMetrics) — never a re-derived second pass.
    expect(builderSrc).toContain("...strategyMetrics } = compute(rets, datesR)");
    // The Worst-10 table is off the SAME dd (shared factsheet helper).
    expect(builderCode).toContain("worstDrawdowns(");
  });

  // (b) The builder RE-DERIVES NOTHING of the blend (the load-bearing half).
  // WHY THIS MATTERS: membership / divisor / weight / window math is the ENGINE's
  // job (scenario.ts + scenario-window.ts). Its ABSENCE here is the single-source-
  // of-truth proof: the factsheet cannot silently disagree with the engine's
  // coverage window because it never computes one. A future edit that pulled any
  // of these primitives into the builder — recomputing the blend instead of
  // consuming the emitted series — flips exactly one of these RED.
  const BANNED_ON_CODE_LINES = [
    "coverageSpanOf", // coverage-span derivation → engine only
    "covers(", // BLEND-02 membership containment → engine only
    "member_count", // v1.5 divisor → read from the engine, never recomputed
    "member_ids", // v1.5 membership list → engine only
    "activeWeightSum", // per-day weight renorm → engine only
    "normWeight", // weight normalization → engine only
    "computeScenario", // the engine itself must not be called from the builder
  ] as const;

  it.each(BANNED_ON_CODE_LINES)(
    "does NOT reference blend/divisor primitive %s on any code line",
    (token) => {
      expect(builderCode).not.toContain(token);
    },
  );

  it("imports NOTHING from the scenario engine or its window helper", () => {
    // The builder must depend only on the factsheet compute/panel helpers — never
    // on the engine (@/lib/scenario) or the window math (@/lib/scenario-window).
    // An import from either is the canonical signature of a re-derived blend.
    expect(builderCode).not.toContain('from "@/lib/scenario"');
    expect(builderCode).not.toContain('from "@/lib/scenario-window"');
    // Belt-and-suspenders: no bare relative import of the window helper either.
    expect(builderCode).not.toContain("scenario-window");
  });

  // (c) The mount sources portfolioDaily FROM the engine output.
  // WHY THIS MATTERS: single-source-of-truth is a two-ended contract. Even a pure
  // builder can be fed a stale series. These pins hold the wiring: the chart
  // forwards portfolioDaily into buildScenarioFactsheetPayload, and the composer
  // sources that prop from scenarioMetrics.portfolio_daily_returns (the engine's
  // ComputedMetrics output). A future edit that fed the chart a downsampled
  // equity_curve or a re-derived series instead breaks these.
  it("ScenarioFactsheetChart forwards portfolioDaily into buildScenarioFactsheetPayload", () => {
    const chartSrc = read(FACTSHEET_CHART_PATH);
    expect(chartSrc).toContain("buildScenarioFactsheetPayload(");
    expect(chartSrc).toContain("portfolioDaily");
  });

  it("ScenarioComposer sources portfolioDaily from scenarioMetrics.portfolio_daily_returns", () => {
    const composerSrc = read(COMPOSER_PATH);
    // The engine output is the source of the mount prop.
    expect(composerSrc).toContain("scenarioMetrics.portfolio_daily_returns");
    // Proximity: the portfolioDaily= JSX prop is fed DIRECTLY from the engine
    // series (not a downsampled/re-derived intermediary). A single regex pins the
    // mount wiring even if surrounding bytes drift.
    expect(composerSrc).toMatch(
      /portfolioDaily=\{[^}]*scenarioMetrics\.portfolio_daily_returns/,
    );
  });
});
