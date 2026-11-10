import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { EmptyState } from "./EmptyState";
import { OnboardingBanner } from "./components/OnboardingBanner";
import { ProvenanceNote } from "./components/ProvenanceNote";
import { DefaultChangeNote } from "./components/DefaultChangeNote";
import { BlendHeader } from "./components/BlendHeader";
import type { ComputedMetrics } from "@/lib/scenario";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// ---------------------------------------------------------------------------
// Phase 199 plan 05 (ROUTE-11, D-04). The five "marker only" inventory entries
// keep their shipped JSX; each gains `data-degrade-id` so the scan test can
// attribute the element to its registry entry. The scan pins that the id LITERAL is
// in the file; this test pins that the attribute reaches the DOM, on the element a
// reader sees (the shared banners do not forward data-* props, so a marker placed
// on them would silently vanish).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const METRICS = {
  n: 2,
  member_count: 2,
  twr: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  max_drawdown: null,
  max_dd_days: null,
  correlation_matrix: null,
  avg_pairwise_correlation: null,
  equity_curve: [],
  effective_start: "2023-01-01",
  effective_end: "2024-12-31",
} as ComputedMetrics;

describe("marker-only inventory entries carry their data-degrade-id in the rendered DOM", () => {
  it("EmptyState (first sync) marks the sentence inside the InfoBanner", () => {
    const { container } = render(<EmptyState hasSyncing hasConnectedKeys={false} />);
    const marked = container.querySelectorAll('[data-degrade-id="allocation.first-sync"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe("Syncing your first positions — this usually takes under a minute.");
  });

  it("OnboardingBanner marks the banner's text block", () => {
    const { container } = render(<OnboardingBanner />);
    const marked = container.querySelectorAll('[data-degrade-id="allocation.onboarding"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain("Connect your exchange to see real performance");
  });

  it("ProvenanceNote marks the default window note, and NOT the membership variant a caller passes its own message to", () => {
    const { container } = render(<ProvenanceNote onShowFullRange={() => {}} />);
    expect(container.querySelectorAll('[data-degrade-id="scenario.provenance"]')).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("predates coverage windows");
    cleanup();
    const membership = render(
      <ProvenanceNote testId="scenario-membership-note" message="A data source saved with this scenario is no longer available." />,
    );
    expect(membership.container.querySelector("[data-degrade-id]")).toBeNull();
  });

  it("DefaultChangeNote marks the common-period note once it has hydrated", async () => {
    const { container } = render(
      <DefaultChangeNote memberCount={3} intersectionTruncatesUnion onShowFullRange={() => {}} />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll('[data-degrade-id="scenario.default-change"]')).toHaveLength(1),
    );
    expect(screen.getByRole("status").textContent).toContain("Now showing the common period");
  });

  it("BlendHeader marks its status line in its empty and its blend states", () => {
    const empty = render(<BlendHeader metrics={{ ...METRICS, member_count: 0 }} unionSpan={null} />);
    expect(empty.container.querySelectorAll('[data-degrade-id="scenario.blend-header"]')).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("No strategies span the selected window");
    cleanup();
    const blend = render(<BlendHeader metrics={METRICS} unionSpan={null} />);
    expect(blend.container.querySelectorAll('[data-degrade-id="scenario.blend-header"]')).toHaveLength(1);
  });
});
