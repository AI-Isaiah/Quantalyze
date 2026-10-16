import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CandidateDetail } from "./CandidateDetail";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";

/**
 * 167.1.1.1 GAP-01 — an admin opening a candidate whose returns share too few days with the
 * book sees WHY the Portfolio fit is empty, beside the Portfolio fit bar.
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

const LINE = /Portfolio fit not computed/;

describe("CandidateDetail short-overlap line (GAP-01)", () => {
  it("renders the cause with the numbers from raw", () => {
    renderDetail({
      fit_unavailable_reason: "overlap_below_min",
      fit_overlap_days: 8,
      fit_min_overlap_days: 30,
    });
    expect(
      screen.getByText(
        "Portfolio fit not computed: only 8 shared days with the book (needs 30).",
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
        "Portfolio fit not computed: only 1 shared day with the book (needs 30).",
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
