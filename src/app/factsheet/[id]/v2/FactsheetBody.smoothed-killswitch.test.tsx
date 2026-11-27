import { describe, it, expect, vi, afterAll } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { mtmDisabledReasonCopy } from "./basis-context";
import { OPTIONS_CASH_WALLET_PHRASES } from "@/lib/factsheet/headline-basis";

/**
 * Phase 134 (smoothed_mtm kill-switch) — the DARK (flag-OFF) default of the
 * SegmentedControl smoothed segment. SMOOTHED_MTM_UI_ENABLED is a build-time
 * module-load const read from process.env at import time, so the flag must be
 * FORCED OFF before closed-sets is imported. vi.hoisted runs before all static
 * imports — delete the env here so the const reads false even if a sibling file
 * leaked "true" into this worker's process.env (isolate resets the module
 * registry, not process.env).
 *
 * The ON posture (segment renders enabled/disabled per bundle presence) is the
 * whole "Phase 133 SMTM-01 smoothed basis render surfaces" suite in
 * FactsheetBody.basis.test.tsx, which opts the flag ON via the same hoisted idiom.
 *
 * The load-bearing pin: with the flag OFF the smoothed segment is HIDDEN (not
 * rendered at all — never merely disabled), the control is the byte-identical
 * two-segment cash/MTM toggle, and no smoothed disabled-reason paragraph renders.
 */
vi.hoisted(() => {
  delete process.env.NEXT_PUBLIC_SMOOTHED_MTM_ENABLED;
});
afterAll(() => {
  delete process.env.NEXT_PUBLIC_SMOOTHED_MTM_ENABLED;
});

function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const CASH = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};
const SMOOTHED = {
  cumulative_return: 0.44,
  volatility: 0.09,
  max_drawdown: -0.03,
  cagr: 0.22,
  sharpe: 1.7,
  sortino: 2.4,
  calmar: 3.3,
};

function base(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  }) as unknown as FactsheetPayload;
}

// The FLAGSHIP options composite: MTM honestly gated OFF (unsmoothed_options_book),
// smoothed OPEN with a persisted basis. This is exactly the fixture that renders
// THREE segments when the flag is ON (FactsheetBody.basis.test.tsx). With the flag
// OFF it must collapse to the two-segment cash/MTM control.
function fixtureCompositeSmoothedFlagship(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH, smoothed_mtm: SMOOTHED },
    mtmGate: { available: false, reason: "unsmoothed_options_book" },
    smoothedGate: { available: true },
  } as unknown as FactsheetPayload;
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody
        payload={payload}
        hideHeader
        hideFooter={false}
      />
    </FactsheetProvider>,
  );
}

describe("FactsheetBody — Phase 134 smoothed_mtm kill-switch (UI dark default)", () => {
  it("flag OFF: the smoothed segment is NOT rendered — the control is the two-segment cash/MTM toggle", () => {
    const { container } = renderBody(fixtureCompositeSmoothedFlagship());
    const group = container.querySelector(
      '[role="group"][aria-label="Metrics basis"]',
    );
    // The control still renders (mtmGate present) — the flag only hides the THIRD segment.
    expect(group, "the cash/MTM basis toggle still renders").not.toBeNull();
    const g = within(group as HTMLElement);
    // cash + MTM segments are UNAFFECTED by the flag.
    expect(g.getByText("Cash settlement")).toBeTruthy();
    expect(g.getByText("Mark-to-market")).toBeTruthy();
    // The smoothed segment is HIDDEN — not merely disabled, absent from the DOM.
    expect(
      g.queryByText("Smoothed mark-to-market"),
      "dark launch: the smoothed segment must NOT be rendered when SMOOTHED_MTM_UI_ENABLED is off",
    ).toBeNull();
  });

  it("flag OFF: no smoothed disabled-reason paragraph leaks anywhere in the body", () => {
    const { container } = renderBody(fixtureCompositeSmoothedFlagship());
    // The smoothed pending/unavailable copy must not surface while the basis is dark.
    expect(container.textContent ?? "").not.toMatch(/smoothed/i);
  });
});

/**
 * Phase 252 G252-MTM-PROMOTION (plan 10), 2026-11-25 founder ruling ("... switch the headline to it
 * only if it actually works for these keys"). Under the flag-OFF posture of this file, a PROMOTED
 * composite (the worker stored the smoothed result as its headline: `payload.headlineBasis` names the
 * smoothed basis) must still open on the smoothed basis with its segment visible, while the Cash
 * settlement view stays withheld by name. The segment stays hidden for every other row.
 */
const NULL_CASH = Object.fromEntries(Object.keys(CASH).map((k) => [k, null]));

// Built through the REAL builder, as the composite read path hands it: the stored cash object is
// withheld (every mapped key null, which the strict overlay turns into the dash), the smoothed object
// carries the figures, and the marker names the basis the headline is measured on.
const PROMOTED_META = {
  id: "g252-promoted-composite",
  name: "Promoted Composite",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-11-27T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

function fixturePromotedComposite(): FactsheetPayload {
  const rows = makeReturnsSeries(300).map((p) => ({ date: p.date, value: p.value }));
  const built = buildFactsheetPayload(PROMOTED_META, rows, {
    headlineBasis: "smoothed_mtm",
    dataQuality: { composite: true, headlineWithheld: true, headlineWithheldCause: "options_cash_wallet" },
    metricsByBasis: { cash_settlement: NULL_CASH, smoothed_mtm: SMOOTHED },
    // A promoted row carries no mtm_gated_reason (plan 09 drops it), so the MTM reason is the default.
    mtmGate: { available: false },
    smoothedGate: { available: true },
    // The stored smoothed series row plan 09 writes beside the headline (a different drift from cash).
    smoothedSeries: {
      dailyReturns: makeReturnsSeries(300, 0.0021).map((p) => ({ date: p.date, value: p.value })),
      gapSpans: [],
    },
  });
  if (!built) throw new Error("fixture must build a payload");
  return built as FactsheetPayload;
}

function kpiValue(container: HTMLElement, label: string): string {
  const labelEl = within(container).getAllByText(label)[0]!;
  const cell = (labelEl.closest('[data-testid="factsheet-kpi-label"]') ?? labelEl).parentElement as HTMLElement;
  return cell.querySelector("p:last-child")?.textContent ?? "";
}

function segments(container: HTMLElement) {
  const group = container.querySelector('[role="group"][aria-label="Metrics basis"]');
  expect(group, "the basis control renders").not.toBeNull();
  return within(group as HTMLElement);
}

describe("G252-MTM-PROMOTION — a promoted composite's factsheet with the UI flag off", () => {
  /**
   * Rule 9: the founder ruled the headline switches to the smoothed basis. If the control hides the
   * segment (the flag is off on PROD) or the provider starts on cash, the owner lands on a withheld
   * headline and the ruling never reaches the page.
   */
  it("three segments render and Smoothed mark-to-market is the active one", () => {
    const { container } = renderBody(fixturePromotedComposite());
    const g = segments(container);
    expect(g.getByText("Cash settlement").getAttribute("aria-pressed")).toBe("false");
    expect(g.getByText("Smoothed mark-to-market").getAttribute("aria-pressed")).toBe("true");
    expect(g.getByText("Mark-to-market").getAttribute("aria-disabled")).toBe("true");
  });

  it("the headline strip shows the smoothed cumulative return, with no options-book sentence", () => {
    const { container } = renderBody(fixturePromotedComposite());
    expect(kpiValue(container, "Cum. Return")).toBe("+44.0%");
    expect(container.textContent ?? "").not.toContain(OPTIONS_CASH_WALLET_PHRASES.headline);
  });

  /**
   * Rule 9: the cash object of an options book is the cash-wallet artefact. Opening on smoothed must
   * not un-withhold it: selecting Cash settlement prints the named sentence and an em dash.
   */
  it("selecting Cash settlement shows the options-book sentence and an em dash for the cumulative return", () => {
    const { container } = renderBody(fixturePromotedComposite());
    fireEvent.click(segments(container).getByText("Cash settlement"));
    expect(container.textContent ?? "").toContain(OPTIONS_CASH_WALLET_PHRASES.headline);
    const cells = [...container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-value"]')];
    expect(cells.length, "the strip is mounted").toBeGreaterThanOrEqual(7);
    for (const c of cells) expect((c.textContent ?? "").trim(), "every strip cell reads the dash").toBe("\u2014");
  });

  /**
   * Rule 9: `build-payload` nulls the CASH windows of a withheld payload. If that leaked onto the
   * smoothed view, a promoted row would open on figures with a dashed rail, which reads as broken.
   * The rail's trailing windows come from the smoothed bundle on the smoothed basis, and stay dashes
   * on the withheld cash basis.
   */
  it("the rail's trailing windows show figures on the smoothed basis and dashes on the withheld cash basis", () => {
    const railCell = (container: HTMLElement, label: string) => {
      const returns = [...container.querySelectorAll("section")].find((sec) => sec.querySelector("h3")?.textContent === "Returns");
      expect(returns, "the Returns panel is mounted").toBeDefined();
      const tr = [...returns!.querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
      return (tr?.querySelectorAll("td")[1]?.textContent ?? "").trim();
    };
    const { container } = renderBody(fixturePromotedComposite());
    for (const label of ["3 Month", "6 Month"]) expect(railCell(container, label), `${label} on smoothed`).toMatch(/^[+-]?\d/);
    fireEvent.click(segments(container).getByText("Cash settlement"));
    for (const label of ["3 Month", "6 Month"]) expect(railCell(container, label), `${label} on cash`).toBe("\u2014");
  });

  it("the Mark-to-market segment's disabled reason is the default sentence, not the options one", () => {
    const { container } = renderBody(fixturePromotedComposite());
    const title = segments(container).getByText("Mark-to-market").getAttribute("title");
    expect(title).toBe(mtmDisabledReasonCopy(undefined));
    expect(title).not.toBe(mtmDisabledReasonCopy("unsmoothed_options_book"));
  });

  /**
   * Anti-vacuity: the same payload without the marker is the unpromoted options book, so the flag-off
   * control stays the two-segment cash/MTM toggle with Cash settlement active.
   */
  it("the same payload without headlineBasis renders the two-segment control with Cash settlement active", () => {
    const { headlineBasis: _drop, ...rest } = fixturePromotedComposite() as FactsheetPayload & {
      headlineBasis?: string;
    };
    const { container } = renderBody(rest as unknown as FactsheetPayload);
    const g = segments(container);
    expect(g.getByText("Cash settlement").getAttribute("aria-pressed")).toBe("true");
    expect(g.queryByText("Smoothed mark-to-market")).toBeNull();
  });
});
