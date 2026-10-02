import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScenarioBenchmarkSection } from "./ScenarioBenchmarkSection";
import { btcClosesFromReturns } from "../lib/btc-closes.test-utils";
import { computeAlphaBeta } from "@/lib/portfolio-stats";
import { pairScenarioWithBtc } from "../lib/scenario-benchmark";

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
 * over `{ portfolioDaily, btc }`. `btc` is the BTC closes the composer and the
 * share page read from `/api/benchmark/btc/prices` (Phase 169.4 D-67); `btc`
 * null models a failed / empty / wrong-shape fetch — it must degrade to the
 * honest empty state, never an error.
 *
 * Phase 169.4 plan 169.4-04 (SC11, SC12, D-66, D-68): the section pairs through
 * `pairScenarioWithBtc`. The weekday-only fixtures below turn their BTC returns
 * into closes with `btcClosesFromReturns`, so BTC has no Saturday or Sunday
 * close and every Monday after day one is UNPAIRED (a non-contiguous synthetic
 * calendar against BTC's 7-day one): 40 weekdays pair 33, 12 weekdays pair 10.
 * Those two literals moved for that reason and no other.
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
    // 40 business days on the SAME dates. The pairing leaves the 7 Mondays after
    // day one unpaired (no weekend BTC close; see the header), so n === 33.
    const dates = buildDates("2024-01-01", 40);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));

    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btc={btcClosesFromReturns(btcDaily)}
      />,
    );

    // Heading names the ALIGNED intersection count, not the union window.
    expect(
      screen.getByText(/vs BTC over 33 overlapping days/i),
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
      "Historical realized · 33 overlapping days · not a forecast.",
    );
    expect(container.textContent).toContain(
      "252-day annualized active returns",
    );

    // Metrics path is NOT an empty state.
    expect(screen.queryByText(EMPTY_HEADING)).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders the BELOW-FLOOR body (naming N) when overlap is 12 days", () => {
    // 12 business days → the 2 Mondays after day one are unpaired → n === 10
    // (< 30 floor).
    const dates = buildDates("2024-01-01", 12);
    const portfolioDaily = series(dates);
    const btcDaily = series(dates, (i) => (i % 3 === 0 ? 0.02 : -0.01));

    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btc={btcClosesFromReturns(btcDaily)}
      />,
    );

    expect(screen.getByText(EMPTY_HEADING)).toBeTruthy();
    // Below-floor body names the actual count and the 30 floor.
    expect(container.textContent).toContain(BELOW_FLOOR_FRAGMENT_HEAD);
    expect(container.textContent).toContain("10 overlapping days");
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
        btc={btcClosesFromReturns(btcDaily)}
      />,
    );

    expect(screen.getByText(EMPTY_HEADING)).toBeTruthy();
    expect(container.textContent).toContain(NO_OVERLAP_BODY);

    // The below-floor body must NOT appear (no fabricated "{n} overlapping days").
    expect(container.textContent).not.toContain(BELOW_FLOOR_FRAGMENT_A);

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".text-negative")).toBeNull();
  });

  it("renders the NO-OVERLAP body when btc is null (failed / wrong-shape fetch)", () => {
    const dates = buildDates("2024-01-01", 40);
    const portfolioDaily = series(dates);

    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btc={null}
      />,
    );

    expect(screen.getByText(EMPTY_HEADING)).toBeTruthy();
    expect(container.textContent).toContain(NO_OVERLAP_BODY);
    // A transport failure is honest absence — never an alert.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("names the SCENARIO-side cause (not the no-overlap body) when the scenario itself produced no returns", () => {
    // A degenerate scenario (no active strategies / below the engine floor)
    // yields portfolio_daily_returns: [] from computeScenario. The section is
    // mounted UNCONDITIONALLY in the composer, so [] reaches it here. Before the
    // fix this fell into the `n === 0` branch and blamed BTC coverage ("doesn't
    // cover this scenario's date window") — a false cause and a heading-matches-
    // body lie (#509): the scenario has no window at all. The body must name the
    // scenario-side cause instead.
    const btcDaily = series(buildDates("2024-01-01", 40)); // a real, fine benchmark
    const { container } = render(
      <ScenarioBenchmarkSection
        portfolioDaily={[]}
        btc={btcClosesFromReturns(btcDaily)}
      />,
    );

    expect(screen.getByText(EMPTY_HEADING)).toBeTruthy();
    // Scenario-side reason present…
    expect(container.textContent).toContain(
      "This scenario has no projected return history yet",
    );
    // …and the benchmark-coverage body explicitly ABSENT (must not misattribute
    // an empty scenario to BTC not covering the window).
    expect(container.textContent).not.toContain(NO_OVERLAP_BODY);
    // Honest absence — never an alert.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders an em-dash '—' for a null metric (constant benchmark → beta null), never a fabricated 0", () => {
    // 33 paired days (40 weekdays, see the header) but a CONSTANT benchmark → var(b)=0 → beta/alpha null,
    // while n >= 30 so the metrics path renders (not an empty state).
    const dates = buildDates("2024-01-01", 40);
    const portfolioDaily = series(dates, (i) => (i % 2 === 0 ? 0.012 : -0.006));
    const btcDaily = series(dates, () => 0.003); // constant → degenerate beta

    render(
      <ScenarioBenchmarkSection
        portfolioDaily={portfolioDaily}
        btc={btcClosesFromReturns(btcDaily)}
      />,
    );

    // Metrics path renders (heading present, not the empty state).
    expect(screen.getByText(/vs BTC over 33 overlapping days/i)).toBeTruthy();

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

  // ── Phase 169.4 plan 169.4-04 (SC11, SC12, D-66, D-68) ─────────────────────
  // The section pairs the portfolio with BTC CLOSES through the one pairing
  // function. These two cases pin the engine's rules on the rendered numbers.

  /** N consecutive CALENDAR-day ISO dates from startDate (a 7-day calendar). */
  function calendarDates(startDate: string, n: number): string[] {
    const out: string[] = [];
    const d = new Date(`${startDate}T00:00:00Z`);
    while (out.length < n) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }

  it("a BTC close missing inside the range unpairs both the missing day and the bridged day after it (SC11)", () => {
    // 7-day portfolio over 40 days; BTC closes on the same days, but the stored
    // close for 2024-03-21 is missing. The old date-intersection join lost the
    // missing day but PAIRED 2024-03-22 with the two-day bridged return
    // close(03-22)/close(03-20) - 1 as if it were one day's move: n = 39,
    // beta 0.57. The one pairing leaves 03-22 unpaired too: n = 38, beta 0.59.
    const dates = calendarDates("2024-03-01", 40);
    const btcReturns = series(dates, (i) => [0.02, -0.01, 0.015, -0.012, 0.004][i % 5]);
    const portfolioDaily = dates.map((date, i) => ({
      date,
      value: 0.6 * btcReturns[i].value + (i % 2 === 0 ? 0.003 : -0.002),
    }));
    const full = btcClosesFromReturns(btcReturns);
    const btc = { ...full, prices: full.prices.filter((p) => p.date !== "2024-03-21") };

    const pairs = pairScenarioWithBtc(portfolioDaily, btc);
    expect(pairs.dates).not.toContain("2024-03-21");
    expect(pairs.dates).not.toContain("2024-03-22");
    expect(pairs.p.length).toBe(38);
    // The rendered beta is computeAlphaBeta over exactly those pairs.
    expect(computeAlphaBeta(pairs.p, pairs.b, 252).beta).toBeCloseTo(0.587829, 5);

    const { container } = render(
      <ScenarioBenchmarkSection portfolioDaily={portfolioDaily} btc={btc} />,
    );
    expect(screen.getByText(/vs BTC over 38 overlapping days/i)).toBeTruthy();
    expect(container.textContent).toContain(
      "Historical realized · 38 overlapping days · not a forecast.",
    );
    expect(screen.getByTestId("benchmark-value-beta").textContent).toBe("0.59");
  });

  it("a weekday-only portfolio's Monday pairs with BTC's Friday-to-Monday move, not its Sunday-to-Monday day (D-68)", () => {
    // 40 weekday portfolio dates; BTC closes every calendar day. Each Monday
    // interval (Fri, Mon] pairs with close(Mon)/close(Fri) - 1. The portfolio is
    // built as 0.5 x that interval move plus alternating noise, so beta is
    // ~0.50 under the one pairing and 0.57 under the old join, which paired the
    // Monday with BTC's one-day Sunday-to-Monday return.
    const dates = buildDates("2024-01-01", 40);
    const btcDates = calendarDates("2024-01-01", 80).filter((d) => d <= dates[dates.length - 1]);
    const btc = btcClosesFromReturns(
      series(btcDates, (i) => [0.01, -0.02, 0.013, 0.006, -0.009, 0.017, -0.004][i % 7]),
    );
    const close = (d: string) => btc.prices.find((p) => p.date === d)!.close;
    const intervalMove = dates.map((d, i) =>
      i === 0 ? close(d) / close("2023-12-31") - 1 : close(d) / close(dates[i - 1]) - 1,
    );
    const portfolioDaily = dates.map((date, i) => ({
      date,
      value: 0.5 * intervalMove[i] + (i % 2 === 0 ? 0.001 : -0.001),
    }));

    const pairs = pairScenarioWithBtc(portfolioDaily, btc);
    // Monday 2024-01-08 (index 5) pairs with close(Mon 01-08)/close(Fri 01-05) - 1.
    expect(pairs.dates[5]).toBe("2024-01-08");
    expect(pairs.b[5]).toBeCloseTo(close("2024-01-08") / close("2024-01-05") - 1, 12);
    expect(pairs.b[5]).toBeCloseTo(0.02306132, 8);

    render(<ScenarioBenchmarkSection portfolioDaily={portfolioDaily} btc={btc} />);
    expect(screen.getByText(/vs BTC over 40 overlapping days/i)).toBeTruthy();
    expect(screen.getByTestId("benchmark-value-beta").textContent).toBe("0.50");
  });
});
