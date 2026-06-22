import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScenarioBenchmarkSection } from "./ScenarioBenchmarkSection";

/**
 * Plan 24-03 Task 1 — TDD RED pins for the extracted benchmark metrics section.
 *
 * The section is pulled OUT of the 1900-line ScenarioComposer precisely so the
 * BENCH-01 honesty invariants are unit-testable without mounting the composer:
 *
 *   - The heading reports the INTERSECTION {N} (not the union window).
 *   - The four active-return metric labels render (TE / IR / Alpha / Beta).
 *   - The two empty-state bodies are DISTINCT (#509): a no-overlap / not-covered
 *     window and a below-the-30-floor window must NEVER share a body string —
 *     each test asserts its own body present AND the other absent.
 *   - A null/non-finite metric renders the em-dash "—", never a fabricated 0.
 *   - Both empty states are honest absence: NO `role="alert"`, no red/negative.
 *
 * Props (the contract this test drives): the section is purely presentational
 * over `{ portfolioDaily, btcDaily, benchmarkAvailable }`. `benchmarkAvailable`
 * = false models a failed/empty `/api/benchmark/btc` fetch — it must degrade to
 * the honest empty state, never an error.
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

// The two verbatim UI-SPEC empty-state bodies (§Copywriting). They MUST stay
// distinct — the test fails if the component conflates them (#509).
const NO_OVERLAP_BODY =
  "The BTC benchmark series doesn't cover this scenario's date window, so there's nothing to compare against. Pick strategies whose history overlaps the benchmark.";
const BELOW_FLOOR_FRAGMENT_A = "fewer than the 30 needed";
const BELOW_FLOOR_FRAGMENT_HEAD = "These dates share";
const EMPTY_HEADING = "Benchmark comparison unavailable";

describe("ScenarioBenchmarkSection", () => {
  it("renders the four metrics + intersection-N heading when n >= 30", () => {
    // 40 fully-overlapping business days on the SAME dates → aligned n === 40.
    const dates = buildDates("2024-01-01", 40);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));

    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        benchmarkAvailable={true}
      />,
    );

    // Heading names the ALIGNED intersection count, not the union window.
    expect(
      screen.getByText(/vs BTC over 40 overlapping days/i),
    ).toBeTruthy();

    // The four active-return metric labels.
    expect(screen.getByText("Tracking Error")).toBeTruthy();
    expect(screen.getByText("Information Ratio")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();

    // Methodology stamp: the EXACT methodologyLine(N) output — not just the
    // "overlapping days" substring. Asserting only the substring would let a
    // mutation passing methodologyLine(0) (a wrong/fabricated N) still pass;
    // pinning the N inside the line catches it.
    expect(container.textContent).toContain(
      "Historical realized · 40 overlapping days · not a forecast.",
    );
    expect(container.textContent).toContain(
      "252-day annualized active returns",
    );

    // Metrics path is NOT an empty state.
    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders the BELOW-FLOOR body (naming N) when overlap is 12 days", () => {
    // 12 fully-overlapping business days → aligned n === 12 (< 30 floor).
    const dates = buildDates("2024-01-01", 12);
    const portfolioDaily = series(dates);
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));

    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        benchmarkAvailable={true}
      />,
    );

    expect(screen.getByText(EMPTY_HEADING)).toBeTruthy();
    // Below-floor body names the actual count and the 30 floor.
    expect(container.textContent).toContain(BELOW_FLOOR_FRAGMENT_HEAD);
    expect(container.textContent).toContain("12 overlapping days");
    expect(container.textContent).toContain(BELOW_FLOOR_FRAGMENT_A);

    // The no-overlap body must NOT appear (the two are distinct — #509).
    expect(container.textContent).not.toContain(NO_OVERLAP_BODY);

    // Honest absence: no alert, no red/negative class.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".text-negative")).toBeNull();
  });

  it("renders the NO-OVERLAP body when the windows are disjoint", () => {
    // Portfolio dates and BTC dates do not intersect at all → n === 0.
    const portDates = buildDates("2024-01-01", 40);
    const btcDates = buildDates("2025-06-01", 40);
    const portfolioDaily = series(portDates);
    const btcDaily = series(btcDates);

    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        benchmarkAvailable={true}
      />,
    );

    expect(screen.getByText(EMPTY_HEADING)).toBeTruthy();
    expect(container.textContent).toContain(NO_OVERLAP_BODY);

    // The below-floor body must NOT appear (no fabricated "{n} overlapping days").
    expect(container.textContent).not.toContain(BELOW_FLOOR_FRAGMENT_A);

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".text-negative")).toBeNull();
  });

  it("renders the NO-OVERLAP body when benchmarkAvailable is false (failed fetch)", () => {
    const dates = buildDates("2024-01-01", 40);
    const portfolioDaily = series(dates);

    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btcDaily={[]}
        benchmarkAvailable={false}
      />,
    );

    expect(screen.getByText(EMPTY_HEADING)).toBeTruthy();
    expect(container.textContent).toContain(NO_OVERLAP_BODY);
    // A transport failure is honest absence — never an alert.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders an em-dash '—' for a null metric (constant benchmark → beta null), never a fabricated 0", () => {
    // 40 overlapping days but a CONSTANT benchmark → var(b)=0 → beta/alpha null,
    // while n >= 30 so the metrics path renders (not an empty state).
    const dates = buildDates("2024-01-01", 40);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, () => 0.003); // constant → degenerate beta

    render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btcDaily={btcDaily}
        benchmarkAvailable={true}
      />,
    );

    // Metrics path renders (heading present, not the empty state).
    expect(screen.getByText(/vs BTC over 40 overlapping days/i)).toBeTruthy();

    // The Beta row must show the em-dash, never "0.00".
    const betaLabel = screen.getByText("Beta");
    const betaRow = betaLabel.closest("[data-testid='benchmark-row-beta']");
    expect(betaRow).toBeTruthy();
    const betaText = (betaRow as HTMLElement).textContent ?? "";
    expect(betaText).toContain("—");
    expect(betaText).not.toContain("0.00");

    // No fabricated-zero leak anywhere in the beta cell.
    const betaValue = within(betaRow as HTMLElement).getByTestId(
      "benchmark-value-beta",
    );
    expect(betaValue.textContent).toBe("—");

    // Alpha is ALSO null on a constant benchmark (var(b)=0) — assert its cell
    // renders the em-dash too, never a fabricated "0.00".
    const alphaLabel = screen.getByText("Alpha");
    const alphaRow = alphaLabel.closest("[data-testid='benchmark-row-alpha']");
    expect(alphaRow).toBeTruthy();
    const alphaValue = within(alphaRow as HTMLElement).getByTestId(
      "benchmark-value-alpha",
    );
    expect(alphaValue.textContent).toBe("—");
    expect(alphaValue.textContent).not.toContain("0.00");
  });
});
