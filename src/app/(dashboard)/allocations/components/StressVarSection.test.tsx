import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { StressVarSection } from "./StressVarSection";
import { SAMPLE_FLOOR_OVERLAPPING_DAYS } from "@/lib/sample-floor";
import { VAR_CONFIDENCE_LABEL } from "../lib/scenario-stress";

/**
 * Plan 26-02 Task 2 — the state-matrix + honesty pins for the StressVarSection.
 *
 * The section is the presentational half of Phase 26 (STRESS-01 + STRESS-02). It
 * is pulled out of the composer precisely so these honesty invariants are
 * unit-testable without mounting the 1900-line ScenarioComposer:
 *
 *   - The VaR is never bare: the ok state always renders the FULL methodology
 *     line (method · N · 95% · not a forecast) — asserted as the complete string
 *     incl. the literal N, not a substring (a mutation passing methodologyLine(0)
 *     must fail).
 *   - The shock-preset selection IS the interaction (STRESS-01): changing the
 *     active segment recomputes the projected impact; there is no submit CTA.
 *   - Em-dash discipline: a null estimate cell renders "—", NEVER "0.00".
 *   - Losses are MONOCHROME (no text-negative / #DC2626 / text-red on the
 *     VaR/CVaR cells) — the explicit divergence from VarExpectedShortfall.tsx.
 *   - Fixed guard order (#509): the scenario-side empty state names the SCENARIO
 *     cause and the BTC copy is ABSENT, and vice-versa (heading-matches-body).
 *   - The floor gate flips at the imported SAMPLE_FLOOR_OVERLAPPING_DAYS SoT, not
 *     a hard-coded 60 (no literal 60 anywhere in this test either).
 *   - Every empty state is honest absence: no role="alert", no red class.
 */

type DailyPoint = { date: string; value: number };

/** N sequential business-day ISO dates from startDate (skips weekends). */
function buildDates(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Build a dated daily-return series. `gen(i)` produces the i-th return; default
 * is a small alternating non-constant series so neither side is degenerate.
 */
function series(
  dates: string[],
  gen: (i: number) => number = (i) => (i % 2 === 0 ? 0.01 : -0.008),
): DailyPoint[] {
  return dates.map((date, i) => ({ date, value: gen(i) }));
}

// N >= the sample floor so the ok state renders. Use the SoT, never a literal.
const OK_N = SAMPLE_FLOOR_OVERLAPPING_DAYS + 4; // 64

// The verbatim UI-SPEC empty-state bodies (§Copywriting). They MUST stay
// distinct — the test fails if the component conflates them (#509).
const NO_SCENARIO_RETURNS_BODY_FRAGMENT =
  "This scenario has no projected return history yet";
const BTC_UNAVAILABLE_HEADING = "Stress testing unavailable";
const BTC_UNAVAILABLE_BODY_FRAGMENT =
  "The BTC factor series isn't available right now";
const FLOOR_HEADING = "Not enough history for this estimate";

describe("StressVarSection", () => {
  it("ok state renders the shock control, the three rows, and the FULL VaR disclosure line incl. N + 95%", () => {
    // OK_N fully-overlapping business days on the SAME dates → varN === betaN.
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));

    const { container } = render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={OK_N}
        strategyCount={3}
      />,
    );

    // The shock affordance — the −30% segment is active by default.
    const shockGroup = screen.getByRole("group", { name: "BTC shock" });
    const active = within(shockGroup)
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-pressed") === "true");
    expect(active).toBeTruthy();
    expect(active?.textContent).toBe("−30%");

    // The headline impact row + the VaR + CVaR rows.
    expect(screen.getByText("Projected portfolio impact")).toBeTruthy();
    expect(screen.getByText("Value at Risk (95%)")).toBeTruthy();
    expect(screen.getByText("Expected Shortfall (CVaR, 95%)")).toBeTruthy();

    // The VaR is NEVER bare: the FULL methodology line, incl. the literal N and
    // the confidence extension — not just the "overlapping days" substring. The
    // confidence label is the lib's VAR_CONFIDENCE_LABEL (derived from the SAME
    // constant the quantile is computed at), so the displayed "%" can never drift
    // from the actual computation (WR-02).
    expect(container.textContent).toContain(
      `Historical realized · ${OK_N} overlapping days · not a forecast. ${VAR_CONFIDENCE_LABEL} confidence.`,
    );
    // The label is the shipped 95% headline — pinned so a silent constant change
    // that desyncs the lib from the UI fails loud.
    expect(VAR_CONFIDENCE_LABEL).toBe("95%");

    // Heading names the scenario (VaR) N, not a union window.
    expect(
      screen.getByText(
        new RegExp(`BTC shock .* downside risk over ${OK_N} overlapping days`, "i"),
      ),
    ).toBeTruthy();

    // ok path is NOT an empty state.
    expect(screen.queryByText(BTC_UNAVAILABLE_HEADING)).toBeNull();
    expect(screen.queryByText(FLOOR_HEADING)).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shock interaction (STRESS-01): clicking a different preset recomputes the projected impact (no submit CTA)", () => {
    const dates = buildDates("2024-01-01", OK_N);
    // A positive-β book → a non-zero projected impact whose magnitude scales
    // with the shock, so −10% vs −30% produce DIFFERENT impact cells.
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, (i) => (i % 2 === 0 ? 0.02 : -0.012));

    render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={OK_N}
        strategyCount={3}
      />,
    );

    const impactBefore = screen.getByTestId("stress-value-projected-impact")
      .textContent;
    expect(impactBefore).not.toBe("—"); // a real β → a real impact

    // There is NO submit button — the selection IS the interaction.
    const shockGroup = screen.getByRole("group", { name: "BTC shock" });
    const tenPct = within(shockGroup)
      .getAllByRole("button")
      .find((b) => b.textContent === "−10%");
    expect(tenPct).toBeTruthy();
    fireEvent.click(tenPct as HTMLElement);

    const impactAfter = screen.getByTestId("stress-value-projected-impact")
      .textContent;
    // Smaller shock magnitude → a strictly different (smaller-magnitude) impact.
    expect(impactAfter).not.toBe(impactBefore);
    // And the −10% segment is now the active one.
    expect(tenPct?.getAttribute("aria-pressed")).toBe("true");
  });

  it("scenario-side empty (portfolioDaily=[]) names the SCENARIO cause, never the BTC cause (#509)", () => {
    const btcDaily = series(buildDates("2024-01-01", OK_N)); // a real, fine factor
    const { container } = render(
      <StressVarSection
        portfolioDaily={[]}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={0}
        strategyCount={3}
      />,
    );

    expect(screen.getByText("Stress & VaR unavailable")).toBeTruthy();
    expect(container.textContent).toContain(NO_SCENARIO_RETURNS_BODY_FRAGMENT);
    // The BTC-unavailable copy must be ABSENT (never blame BTC for an empty
    // scenario — heading-matches-body, #509).
    expect(container.textContent).not.toContain(BTC_UNAVAILABLE_BODY_FRAGMENT);
    expect(screen.queryByText(BTC_UNAVAILABLE_HEADING)).toBeNull();
    // Honest absence.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".text-negative")).toBeNull();
  });

  it("BTC-unavailable empty (btcAvailable=false) names the BTC cause, never the scenario cause (#509)", () => {
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates);
    const { container } = render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={[]}
        btcAvailable={false}
        n={OK_N}
        strategyCount={3}
      />,
    );

    expect(screen.getByText(BTC_UNAVAILABLE_HEADING)).toBeTruthy();
    expect(container.textContent).toContain(BTC_UNAVAILABLE_BODY_FRAGMENT);
    // The scenario-side copy must be ABSENT.
    expect(container.textContent).not.toContain(
      NO_SCENARIO_RETURNS_BODY_FRAGMENT,
    );
    expect(screen.queryByText("Stress & VaR unavailable")).toBeNull();
    // A transport failure is honest absence — never an alert.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("below-floor (n < floor) renders SampleFloorEmptyState; the VaR/CVaR rows are ABSENT", () => {
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates);
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));

    render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={SAMPLE_FLOOR_OVERLAPPING_DAYS - 1}
        strategyCount={3}
      />,
    );

    expect(screen.getByText(FLOOR_HEADING)).toBeTruthy();
    // The tail estimates are gated — the metric rows must NOT render.
    expect(screen.queryByText("Value at Risk (95%)")).toBeNull();
    expect(screen.queryByText("Expected Shortfall (CVaR, 95%)")).toBeNull();
    expect(screen.queryByText("Projected portfolio impact")).toBeNull();
  });

  it("em-dash discipline: a null projected-impact cell renders '—', NEVER '0.00'", () => {
    // OK_N overlapping days but a CONSTANT BTC series → var(b)=0 → β null →
    // projectedImpact null, while n >= floor so the ok path renders (not an
    // empty state). The impact cell must show the em-dash, never a fabricated 0.
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, () => 0.003); // constant → degenerate β

    render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={OK_N}
        strategyCount={3}
      />,
    );

    // ok path renders.
    expect(screen.getByText("Projected portfolio impact")).toBeTruthy();

    const impactRow = screen.getByTestId("stress-row-projected-impact");
    const impactValue = within(impactRow).getByTestId(
      "stress-value-projected-impact",
    );
    expect(impactValue.textContent).toBe("—");
    expect(impactValue.textContent).not.toContain("0.00");
  });

  it("β caption matches the data (#509, WR-03): a suppressed '—' impact never carries an affirmative β methodology claim", () => {
    // OK_N overlapping days but a CONSTANT BTC series → var(b)=0 → β null →
    // projectedImpact null (em-dash), while n >= floor so the ok path renders.
    // The β/shock methodology caption ("linear β propagation over N … not a
    // forecast") must NOT render: it would assert a methodology + N for a value
    // that did not produce a usable number. The honest "too short" note shows
    // instead, and the VaR disclosure (which DOES have a value) stays.
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, () => 0.003); // constant → β null → impact null

    const { container } = render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={OK_N}
        strategyCount={3}
      />,
    );

    // The impact cell IS the em-dash (precondition for the caption gate).
    expect(
      screen.getByTestId("stress-value-projected-impact").textContent,
    ).toBe("—");

    // The affirmative β methodology caption MUST be absent — neither phrasing
    // (the twoNs branch nor the single-caption branch) may render against "—".
    expect(container.textContent).not.toContain("linear β propagation");
    expect(container.textContent).not.toContain("Single-factor (BTC)");

    // The honest replacement note IS shown.
    expect(container.textContent).toContain(
      "BTC overlap too short to project a shock",
    );

    // The VaR/CVaR disclosure (which DOES carry a value in this ok path) still
    // renders — only the β caption is gated, not the VaR caption.
    expect(container.textContent).toContain(
      `Historical realized · ${OK_N} overlapping days · not a forecast. ${VAR_CONFIDENCE_LABEL} confidence.`,
    );
  });

  it("β caption present when the impact IS shown (#509, WR-03): the affirmative methodology claim accompanies a real value", () => {
    // The positive control for the gate above: a real β → a real impact → the
    // β methodology caption DOES render (with its N). This proves the gate keys
    // on impact-shown, not blanket suppression.
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, (i) => (i % 2 === 0 ? 0.02 : -0.012)); // non-degenerate

    const { container } = render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={OK_N}
        strategyCount={3}
      />,
    );

    // A real impact (not the em-dash).
    expect(
      screen.getByTestId("stress-value-projected-impact").textContent,
    ).not.toBe("—");
    // The affirmative β methodology caption renders, and the "too short" note does NOT.
    expect(container.textContent).toContain("linear β propagation");
    expect(container.textContent).not.toContain(
      "BTC overlap too short to project a shock",
    );
  });

  it("monochrome losses: the VaR/CVaR loss cells carry NO red / text-negative class (divergence from VarExpectedShortfall.tsx)", () => {
    // A loss-producing series → a negative VaR (the floor quantile) + a more
    // negative CVaR. Those are losses — they must render as neutral data.
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? -0.03 : -0.01));
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));

    render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={OK_N}
        strategyCount={3}
      />,
    );

    for (const metric of ["var", "cvar"]) {
      const value = screen.getByTestId(`stress-value-${metric}`);
      // The cell renders an actual loss (a signed negative percent).
      expect(value.textContent).toContain("-");
      const cls = value.getAttribute("class") ?? "";
      expect(cls).not.toMatch(/text-negative|text-red|text-destructive/);
      expect(cls).not.toContain("#DC2626");
      // It carries the neutral monochrome token.
      expect(cls).toContain("text-text-secondary");
    }
  });

  it("two-N disclosure: when varN !== betaN, TWO captions render — each names its OWN true N", () => {
    // Portfolio over OK_N dates; BTC overlaps only OK_N-2 of them → varN=OK_N,
    // betaN=OK_N-2. The VaR caption names varN; the β caption names betaN.
    const portDates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(portDates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    // BTC drops the last 2 dates (so the inner-join is OK_N-2) and is otherwise
    // a non-degenerate factor.
    const btcDaily = series(
      portDates.slice(0, OK_N - 2),
      (i) => (i % 3 === 0 ? 0.02 : -0.01),
    );

    const { container } = render(
      <StressVarSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        btcAvailable={true}
        n={OK_N}
        strategyCount={3}
      />,
    );

    // The VaR/CVaR caption names the scenario N (varN).
    expect(container.textContent).toContain(
      `Historical realized · ${OK_N} overlapping days · not a forecast.`,
    );
    // The β-shock caption names the BTC inner-join N (betaN), distinct from varN.
    expect(container.textContent).toContain(
      `Historical realized · ${OK_N - 2} overlapping days · not a forecast.`,
    );
  });

  it("honest absence: each empty state has NO role=alert and NO red/negative class", () => {
    // Scenario-side empty.
    const a = render(
      <StressVarSection
        portfolioDaily={[]}
        btcDaily={series(buildDates("2024-01-01", OK_N))}
        btcAvailable={true}
        n={0}
        strategyCount={3}
      />,
    );
    expect(a.container.querySelector('[role="alert"]')).toBeNull();
    expect(a.container.innerHTML).not.toMatch(
      /text-negative|text-red|text-destructive/,
    );
    a.unmount();

    // Below-floor empty.
    const dates = buildDates("2024-01-01", OK_N);
    const b = render(
      <StressVarSection
        portfolioDaily={series(dates)}
        btcDaily={series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01))}
        btcAvailable={true}
        n={SAMPLE_FLOOR_OVERLAPPING_DAYS - 1}
        strategyCount={3}
      />,
    );
    expect(b.container.querySelector('[role="alert"]')).toBeNull();
    expect(b.container.innerHTML).not.toMatch(
      /text-negative|text-red|text-destructive/,
    );
  });

  it("uses floor SoT: the gate flips at SAMPLE_FLOOR_OVERLAPPING_DAYS exactly (not a hard-coded 60)", () => {
    const dates = buildDates("2024-01-01", OK_N);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));
    const commonProps = {
      portfolioDaily,
      btcDaily,
      btcAvailable: true,
      strategyCount: 3,
    } as const;

    // One below the SoT floor → the floor empty state shows.
    const below = render(
      <StressVarSection {...commonProps} n={SAMPLE_FLOOR_OVERLAPPING_DAYS - 1} />,
    );
    expect(below.getByText(FLOOR_HEADING)).toBeTruthy();
    expect(below.queryByText("Value at Risk (95%)")).toBeNull();
    below.unmount();

    // Exactly at the SoT floor → the ok state shows (proves the gate keys on the
    // imported SoT value, not an independent literal 60).
    const at = render(
      <StressVarSection {...commonProps} n={SAMPLE_FLOOR_OVERLAPPING_DAYS} />,
    );
    expect(at.queryByText(FLOOR_HEADING)).toBeNull();
    expect(at.getByText("Value at Risk (95%)")).toBeTruthy();
  });
});
