import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CandidateDetail } from "./CandidateDetail";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";

/**
 * 167.1.1.1 GAP-01 — an admin opening a candidate whose returns share too few days with the
 * allocation sees WHY the Allocation fit is empty, beside the Allocation fit bar.
 *
 * The cause lives in `score_breakdown.raw` only. The allocator-facing `reasons` list never
 * carries it, and an absent or unknown reason (or a count that is not a number) renders
 * nothing: a wrong or half-filled sentence is worse than no sentence.
 */

const CANDIDATE_STRATEGY_ID = "22222222-2222-4222-8222-222222222222";

const REASONS = ["Strong Sharpe lift", "Low correlation with book"];

function candidateWithRaw(raw: Record<string, unknown>): CandidateRow {
  return {
    id: "cand-1",
    strategy_id: CANDIDATE_STRATEGY_ID,
    score: 55,
    score_breakdown: {
      portfolio_fit: 0,
      preference_fit: 0.5,
      track_record: 0.5,
      capacity_fit: 0.5,
      raw: raw as NonNullable<CandidateRow["score_breakdown"]["raw"]>,
    },
    reasons: REASONS,
    rank: 1,
    exclusion_reason: null,
    exclusion_provenance: null,
    strategies: {
      id: CANDIDATE_STRATEGY_ID,
      name: "Candidate Strategy",
      codename: "Falcon",
      disclosure_tier: "institutional",
      status: null,
      strategy_types: ["trend"],
      supported_exchanges: ["binance"],
      aum: 1_000_000,
      max_capacity: 5_000_000,
      user_id: "user-x",
    },
    analytics: null,
  };
}

function renderDetail(raw: Record<string, unknown>) {
  return render(
    <CandidateDetail
      candidate={candidateWithRaw(raw)}
      alreadySent={false}
      isKept={false}
      isSkipped={false}
      onSendIntro={vi.fn()}
      onKeep={vi.fn()}
      onSkip={vi.fn()}
    />,
  );
}

const LINE = /Allocation fit not computed/;

/**
 * Phase 201 plan 20 (U-24, D-06) - the admin sub-scores read "Allocation fit" and "Mandate fit".
 * WHY: staff and allocator name the holdings an allocation and the criteria a mandate. Only the
 * visible labels changed (T-201-26), so each label must still show ITS OWN field's value: the two
 * scores are different numbers here so a swapped binding fails.
 */
describe("CandidateDetail sub-score labels (U-24, D-06)", () => {
  function rowValue(label: string): string {
    return screen.getByText(label).parentElement?.textContent ?? "";
  }

  it("reads Allocation fit and Mandate fit, each beside its own field's value", () => {
    const base = candidateWithRaw({});
    const candidate: CandidateRow = {
      ...base,
      score_breakdown: { ...base.score_breakdown, portfolio_fit: 0.8, preference_fit: 0.3 },
    };
    render(
      <CandidateDetail
        candidate={candidate}
        alreadySent={false}
        isKept={false}
        isSkipped={false}
        onSendIntro={vi.fn()}
        onKeep={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(rowValue("Allocation fit")).toBe("Allocation fit80");
    expect(rowValue("Mandate fit")).toBe("Mandate fit30");
    expect(screen.queryByText("Portfolio fit")).not.toBeInTheDocument();
    expect(screen.queryByText("Preference fit")).not.toBeInTheDocument();
  });
});

describe("CandidateDetail short-overlap line (GAP-01)", () => {
  it("renders the cause with the numbers from raw", () => {
    renderDetail({
      fit_unavailable_reason: "overlap_below_min",
      fit_overlap_days: 8,
      fit_min_overlap_days: 30,
    });
    expect(
      screen.getByText(
        "Allocation fit not computed: only 8 shared days with the allocation (needs 30).",
      ),
    ).toBeInTheDocument();
  });

  it("uses the singular for one shared day", () => {
    renderDetail({
      fit_unavailable_reason: "overlap_below_min",
      fit_overlap_days: 1,
      fit_min_overlap_days: 30,
    });
    expect(
      screen.getByText(
        "Allocation fit not computed: only 1 shared day with the allocation (needs 30).",
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing when raw carries no reason", () => {
    renderDetail({ sharpe_lift: 0.4 });
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
  });

  it("renders nothing for an unknown reason, even with numeric counts", () => {
    renderDetail({
      fit_unavailable_reason: "some_future_reason",
      fit_overlap_days: 8,
      fit_min_overlap_days: 30,
    });
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
  });

  it("renders nothing when the shared-day count is missing or not a number", () => {
    const { unmount } = renderDetail({
      fit_unavailable_reason: "overlap_below_min",
      fit_min_overlap_days: 30,
    });
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
    unmount();

    renderDetail({
      fit_unavailable_reason: "overlap_below_min",
      fit_overlap_days: "8",
      fit_min_overlap_days: 30,
    });
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
  });

  it("keeps the line out of the Why this match list, which shows exactly the reasons", () => {
    renderDetail({
      fit_unavailable_reason: "overlap_below_min",
      fit_overlap_days: 8,
      fit_min_overlap_days: 30,
    });
    const heading = screen.getByText("Why this match");
    const list = heading.parentElement?.querySelector("ul");
    expect(list).not.toBeNull();
    const items = within(list as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(REASONS);
  });
});

describe("CandidateDetail no-returns line (GAP-01, SFH-R5 M1)", () => {
  const NO_RETURNS =
    "Allocation fit not computed: this strategy has no daily returns to compare with the allocation.";

  it("names a candidate with no returns series, and only that sentence", () => {
    renderDetail({
      fit_unavailable_reason: "no_candidate_returns",
      fit_overlap_days: 0,
      fit_min_overlap_days: 30,
    });
    expect(screen.getByText(NO_RETURNS)).toBeInTheDocument();
    expect(screen.getAllByText(LINE)).toHaveLength(1);
  });

  it("does not show the short-overlap sentence for a short-overlap candidate", () => {
    renderDetail({
      fit_unavailable_reason: "overlap_below_min",
      fit_overlap_days: 8,
      fit_min_overlap_days: 30,
    });
    expect(screen.queryByText(NO_RETURNS)).not.toBeInTheDocument();
  });

  it("keeps the line out of the Why this match list", () => {
    renderDetail({
      fit_unavailable_reason: "no_candidate_returns",
      fit_overlap_days: 0,
      fit_min_overlap_days: 30,
    });
    const heading = screen.getByText("Why this match");
    const list = heading.parentElement?.querySelector("ul");
    expect(list).not.toBeNull();
    const items = within(list as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(REASONS);
  });
});

/**
 * Phase 194.1 B12b (194 D-12 / D-15) - the candidate detail judges Sharpe, CAGR and
 * Volatility on THAT strategy's total record. Titles are typed by hand so a reworded
 * sentence in `figure-gate.ts` fails here instead of agreeing with itself. Dates come from
 * `endAfter` (start plus `days - 1`, D-20).
 *
 * Neuter to redden: render Volatility as the bare `fmtPct(analytics?.volatility)` in
 * `CandidateDetail.tsx`, without `annualizedCell` (that cell prints `—` for a withheld state
 * whatever text it is handed, so removing `gatedValue` alone stays green).
 */
describe("CandidateDetail withholds annualised figures by the strategy's total record (194.1 B12b)", () => {
  const START = "2025-01-01";

  function endAfter(days: number): string {
    const d = new Date(`${START}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days - 1);
    return d.toISOString().slice(0, 10);
  }

  function renderWith(
    assetClass: string | null,
    aliases: Record<string, unknown> | null,
  ) {
    const base = candidateWithRaw({});
    const candidate: CandidateRow = {
      ...base,
      strategies: base.strategies && { ...base.strategies, asset_class: assetClass },
      analytics:
        aliases === null
          ? null
          : {
              sharpe: 2.1,
              sortino: 3.1,
              max_drawdown: -0.1,
              cagr: 0.5,
              volatility: 0.25,
              six_month_return: 0.2,
              cumulative_return: 0.9,
              sparkline_returns: null,
              ...aliases,
            },
    };
    return render(
      <CandidateDetail
        candidate={candidate}
        alreadySent={false}
        isKept={false}
        isSkipped={false}
        onSendIntro={vi.fn()}
        onKeep={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
  }

  function aliasesFor(days: number, observations: number | null = days) {
    return {
      series_start: START,
      series_end: endAfter(days),
      headline_since: null,
      record_observations: observations,
    };
  }

  /** The value `<p>` that follows the label `<p>` of one metric. */
  function cell(label: string): HTMLElement {
    return screen.getByText(label, { selector: "p" }).nextElementSibling as HTMLElement;
  }

  it("a 40-day crypto record withholds Sharpe, CAGR and Volatility; the other three print", () => {
    renderWith("crypto", aliasesFor(40));
    for (const label of ["Sharpe", "CAGR", "Volatility"]) {
      const c = cell(label);
      expect(c.textContent).toContain("—");
      expect(c.textContent).not.toMatch(/2\.10|50\.0|25\.0/);
      expect(
        c.querySelector(
          '[title="Withheld until the record reaches 90 days (40 days so far)."]',
        ),
      ).not.toBeNull();
    }
    expect(cell("Max DD").textContent).toBe("-10.0%");
    expect(cell("6M return").textContent).toBe("20.0%");
    expect(cell("Total return").textContent).toBe("90.0%");
  });

  it("a 200-day record prints the three figures with the <1y marker and its reason", () => {
    renderWith("crypto", aliasesFor(200));
    for (const [label, figure] of [
      ["Sharpe", "2.10"],
      ["CAGR", "50.0%"],
      ["Volatility", "25.0%"],
    ] as const) {
      const c = cell(label);
      expect(c.textContent).toContain(figure);
      expect(c.textContent).toContain("<1y");
      expect(
        c.querySelector('[title="Annualized from 200 days of record, under one year."]'),
      ).not.toBeNull();
    }
  });

  it("a 400-day record reads exactly as today", () => {
    renderWith("crypto", aliasesFor(400));
    expect(cell("Sharpe").textContent).toBe("2.10");
    expect(cell("CAGR").textContent).toBe("50.0%");
    expect(cell("Volatility").textContent).toBe("25.0%");
  });

  it("a candidate with no analytics reads as today (dashes, no withheld title)", () => {
    const { container } = renderWith("crypto", null);
    expect(cell("Sharpe").textContent).toBe("—");
    expect(container.querySelector('[title^="Withheld"]')).toBeNull();
  });

  it("analytics with no aliases reads as today (unknown record, never withheld)", () => {
    renderWith("crypto", {});
    expect(cell("Sharpe").textContent).toBe("2.10");
    expect(cell("Volatility").textContent).toBe("25.0%");
  });

  it("a traditional record with 59 observations is withheld on the 60-trading-day basis", () => {
    renderWith("traditional", aliasesFor(120, 59));
    for (const label of ["Sharpe", "CAGR", "Volatility"]) {
      expect(
        cell(label).querySelector(
          '[title="Withheld until the record reaches 60 trading days (59 so far)."]',
        ),
      ).not.toBeNull();
    }
  });
});
