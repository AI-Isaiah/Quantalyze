/**
 * Phase 170.1.3 NARROWCHARTS: `assertEmittersMeasured` counts `textPattern` matches per svg.
 *
 * Why: `minPatternTexts` guards a required long label ("Jan" twice, a six-digit percentage) from
 * passing hollow. Summed across every svg an emitter names, two svgs with one match each would
 * satisfy a minimum of two that no single svg meets. At least one svg must hold the minimum on
 * its own.
 */
import { describe, it, expect, vi } from "vitest";
import { assertEmittersMeasured, type SvgTextLayout } from "../../e2e/helpers/geometry";

function layout(index: number, texts: string[]): SvgTextLayout {
  return {
    index,
    label: null,
    emitter: "heatmap-2023",
    width: 770,
    rect: { left: 0, top: 0, right: 770, bottom: 112, width: 770, height: 112 },
    overflow: "hidden",
    texts: texts.map((text) => ({ text, inXAxis: false })),
  } as unknown as SvgTextLayout;
}

const REQUIRED = [{ key: "heatmap-2023", textPattern: "^Jan$", minPatternTexts: 2 }];

describe("assertEmittersMeasured counts textPattern matches per svg", () => {
  it("two svgs with one match each do not meet a minimum of two", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() =>
      assertEmittersMeasured([layout(0, ["Jan", "Feb"]), layout(1, ["Jan", "Feb"])], "t", REQUIRED),
    ).toThrow(/NARROWCHARTS-EMITTER-MISSING/);
  });

  it("one svg holding the minimum on its own passes", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() =>
      assertEmittersMeasured([layout(0, ["Jan", "Feb"]), layout(1, ["Jan", "Jan"])], "t", REQUIRED),
    ).not.toThrow();
  });
});
