/** @vitest-environment jsdom */
/**
 * Phase 201 plan 08 (D-10, SC-3): the factsheet's section numerals count in the order a reader
 * sees the sections, whatever renders.
 *
 * WHY it exists. At HEAD the numerals were typed in: Terms was always "V" and Benchmark always
 * "IV", and Style was "III". The rail rendered Terms BEFORE Benchmark, so a full rail read
 * I, II, III, V, IV, and with no Style (or no comparator) a numeral went missing: I, II, V, IV
 * or I, II, V. A reader cites a section by its numeral ("see section IV"), so a skipped or
 * out-of-order numeral is a wrong citation. The numeral is now the section's position among the
 * sections that rendered. The arms below read the numeral beside each heading in DOM order on
 * both arms of the rail (`all`, the whole rail, and `detailed`, the half inside Advanced) across
 * the Style and comparator matrix, and require the section NAMES to be byte-identical to
 * before: only the numeral is derived.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn, type MetricsPart } from "./MetricsColumn";
import { censusPayloadA } from "./test-fixtures/census-payloads";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn(() => "desktop" as const) }));
vi.setConfig({ testTimeout: 60_000 });

/** Fixture A with Style present (its own styleDrift) or absent, a comparator (BTC) or none. */
function payloadFor(style: boolean, comparator: boolean): FactsheetPayload {
  const base = censusPayloadA();
  if (style) expect(base.styleDrift, "control: fixture A carries a style drift").not.toBeNull();
  return { ...base, styleDrift: style ? base.styleDrift : null, activeComparator: comparator ? "btc" : "none" } as FactsheetPayload;
}

/** `[numeral, name]` for every editorial section, in DOM order. */
function sectionsOf(container: HTMLElement): Array<[string, string]> {
  return Array.from(container.querySelectorAll("section > header h2")).map((h2) => {
    const numeral = h2.parentElement!.querySelector("span")!.textContent ?? "";
    return [numeral, h2.textContent ?? ""];
  });
}

function mountRail(payload: FactsheetPayload, part: MetricsPart | undefined): HTMLElement {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <article id="factsheet-main">{part === undefined ? <MetricsColumn /> : <MetricsColumn part={part} />}</article>
    </FactsheetProvider>,
  ).container;
}

const BENCH = "Benchmark — vs BTC";

const PERF: [string, string] = ["§I", "Performance"];
const RISK: [string, string] = ["§II", "Risk"];

/**
 * `detailed` leaves the Style section out when there is no style drift (Phase 196, "Empty
 * sections"); `all` has always mounted it unconditionally, so there Style is present in every
 * case and only the comparator moves the numerals. Pinning that here records the difference
 * rather than hiding it.
 */
const MATRIX: Array<{
  style: boolean;
  comparator: boolean;
  detailed: Array<[string, string]>;
  all: Array<[string, string]>;
}> = [
  {
    style: true,
    comparator: true,
    detailed: [PERF, RISK, ["§III", "Style"], ["§IV", "Terms"], ["§V", BENCH]],
    all: [PERF, RISK, ["§III", "Style"], ["§IV", "Terms"], ["§V", BENCH]],
  },
  {
    style: false,
    comparator: true,
    detailed: [PERF, RISK, ["§III", "Terms"], ["§IV", BENCH]],
    all: [PERF, RISK, ["§III", "Style"], ["§IV", "Terms"], ["§V", BENCH]],
  },
  {
    style: false,
    comparator: false,
    detailed: [PERF, RISK, ["§III", "Terms"]],
    all: [PERF, RISK, ["§III", "Style"], ["§IV", "Terms"]],
  },
  {
    style: true,
    comparator: false,
    detailed: [PERF, RISK, ["§III", "Style"], ["§IV", "Terms"]],
    all: [PERF, RISK, ["§III", "Style"], ["§IV", "Terms"]],
  },
];

describe.each([
  ["all", undefined],
  ["detailed", "detailed"],
] as const)("the %s arm numbers its sections in render order (D-10)", (arm, part) => {
  it.each(MATRIX)("style=$style comparator=$comparator", (row) => {
    const got = sectionsOf(mountRail(payloadFor(row.style, row.comparator), part));
    expect(got).toEqual(row[arm]);
  });
});
