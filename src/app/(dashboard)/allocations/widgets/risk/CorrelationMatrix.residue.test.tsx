import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { CorrelationMatrix } from "./CorrelationMatrix";
import type { TimeframeKey } from "../../lib/types";
import { CONSTANT_YIELDS, navConstantYield } from "@/__tests__/fixtures/dispersion-nav";

/**
 * Phase 166.2 T7 (D-17, D-07): the allocator Risk tab's CorrelationMatrix
 * widget, computed arm (no precomputed `analytics.correlation_matrix`), on a
 * compounding-NAV constant yield.
 *
 * A NAV that compounds at a constant rate has daily returns whose sd is about
 * 1.3e-16, float residue, not dispersion. A Pearson that divides by that
 * residue paints a "correlation" that is rounding noise, tinted like a real
 * one. The D-07 invariant: every cell of the constant-yield leg must render
 * EXACTLY as it renders for an all-zero leg (text, background and text colour,
 * and the accessible label), because no dispersion means no correlation. The
 * pair of two noisy legs is the control and must not move.
 *
 * What both render (founder decision D7, 2026-09-26; review round 1 WR-02 /
 * SFH-H2): "—" on the neutral background, titled "Insufficient data", as the
 * /compare matrix renders the same null. This file used to pin "0.00" there,
 * which made the misleading "uncorrelated" reading a requirement.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

const N = 366;
const DATES: string[] = Array.from({ length: N }, (_, i) =>
  new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
);

/** Deterministic noisy returns (no randomness). */
function noisy(phase: number): number[] {
  return Array.from(
    { length: N },
    (_, i) => 0.004 * Math.sin(i * 1.7 + phase) + 0.002 * Math.cos(i * 0.37 + 2 * phase),
  );
}

const ZERO = Array<number>(N).fill(0);

function row(id: string, returns: number[]) {
  return {
    strategy_id: id,
    alias: id,
    strategy: {
      id,
      strategy_analytics: {
        daily_returns: returns.map((value, i) => ({ date: DATES[i], value })),
      },
    },
  };
}

type Cell = { text: string; bg: string; color: string; label: string | null; title: string | null };

/** Every rendered cell, row-major, of the computed-arm matrix. */
function cells(legs: Array<ReturnType<typeof row>>): Cell[] {
  const { container, unmount } = render(<CorrelationMatrix data={{ strategies: legs }} {...base} />);
  const out = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="corr-cell"]')).map(
    (td) => ({
      text: td.textContent ?? "",
      bg: td.style.backgroundColor,
      color: td.style.color,
      label: td.getAttribute("aria-label"),
      title: td.getAttribute("title"),
    }),
  );
  unmount();
  return out;
}

describe("T7 CorrelationMatrix widget: a constant-yield leg renders as an all-zero leg", () => {
  it("reference: the all-zero leg's pair cells read '—' (insufficient data) in the neutral colour, never 0.00", () => {
    const ref = cells([row("Flat", ZERO), row("NoisyA", noisy(0)), row("NoisyB", noisy(0.9))]);
    expect(ref).toHaveLength(9);
    // Row 0 (the flat leg) against columns 1 and 2, and the mirror cells.
    for (const k of [1, 2, 3, 6]) {
      expect(ref[k].text).toBe("—");
      expect(ref[k].title).toBe("Insufficient data");
      expect(ref[k].bg).toBe("rgb(255, 255, 255)");
      expect(ref[k].label).toMatch(/: no data$/);
    }
    expect(ref.map((c) => c.text)).not.toContain("0.00");
  });

  it("a precomputed matrix with a missing cell renders that cell as '—', not 0.00", () => {
    const { container, unmount } = render(
      <CorrelationMatrix
        data={{
          strategies: [row("A", noisy(0)), row("B", noisy(0.9))],
          analytics: { correlation_matrix: { A: { A: 1, B: 0.42 }, B: { B: 1 } } },
        }}
        {...base}
      />,
    );
    const texts = Array.from(container.querySelectorAll('[data-testid="corr-cell"]')).map((td) => td.textContent);
    unmount();
    expect(texts).toEqual(["1.00", "0.42", "—", "1.00"]);
  });

  it.each(Object.entries(CONSTANT_YIELDS))(
    "%s: every cell equals the all-zero leg's render",
    (_id, dailyYield) => {
      const constant = cells([
        row("Flat", navConstantYield(dailyYield, N)),
        row("NoisyA", noisy(0)),
        row("NoisyB", noisy(0.9)),
      ]);
      const zero = cells([row("Flat", ZERO), row("NoisyA", noisy(0)), row("NoisyB", noisy(0.9))]);
      expect(constant).toEqual(zero);
    },
  );

  it("control: the noisy pair's cell is a real correlation and unchanged by the third leg", () => {
    const three = cells([row("Flat", ZERO), row("NoisyA", noisy(0)), row("NoisyB", noisy(0.9))]);
    const two = cells([row("NoisyA", noisy(0)), row("NoisyB", noisy(0.9))]);
    // three: row 1 col 2 is index 5; two: row 0 col 1 is index 1.
    expect(three[5].text).toBe(two[1].text);
    expect(three[5].bg).toBe(two[1].bg);
    expect(three[5].text).not.toBe("0.00");
  });

  it("control: a cent-rounded constant-yield NAV (real dispersion) is not forced to 0", () => {
    const cents = navConstantYield(CONSTANT_YIELDS["apy_1pct"], N, 10_000, true);
    const withCents = cells([row("Flat", cents), row("NoisyA", noisy(0))]);
    const withZero = cells([row("Flat", ZERO), row("NoisyA", noisy(0))]);
    expect(withCents[1]).not.toEqual(withZero[1]);
  });
});
