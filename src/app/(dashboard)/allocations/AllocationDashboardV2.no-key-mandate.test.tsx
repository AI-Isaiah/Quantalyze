import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// Phase 198 review WR-04. The retired Mandate tab lives in `<section id="mandate">`
// at the foot of the Overview (D-02: nothing is deleted silently). With no
// eligible key the Overview returns early with the connect-a-key card, so the
// mandate snapshot showed nowhere and a legacy `?tab=mandate` link scrolled to
// an anchor that did not exist. The mandate is not tied to a key, so the early
// branch renders it too.

vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div />,
}));
vi.mock("./components/AlertBanner", () => ({ AlertBanner: () => <div /> }));
vi.mock("./widgets/performance/EquityChart", () => ({
  default: () => <div />,
}));

const props = {
  portfolio: null,
  analytics: null,
  apiKeys: [],
  holdingsSummary: [],
  flaggedHoldings: [],
  equityDailyPoints: [],
  activeVenues: [],
  snapshotCount: 0,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  hasConnectedKeys: false,
} as unknown as MyAllocationDashboardPayload;

describe("AllocationDashboardV2 with no eligible key (WR-04)", () => {
  it("still renders the Mandate section, so #mandate exists and the snapshot is reachable", () => {
    const { container } = render(<AllocationDashboardV2 {...props} />);
    expect(container.querySelector("#mandate")).not.toBeNull();
    expect(screen.getByTestId("mandate-snapshot")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mandate" })).toBeInTheDocument();
  });

  // Phase 201 plan 12 (D-02, D-06): the Mandate heading is a registered term, so the allocator can
  // read what the word means where it first meets it. The heading's accessible name stays "Mandate".
  it("renders the Mandate heading through Term with the mandate key (201-12 D-06)", () => {
    render(<AllocationDashboardV2 {...props} />);
    const heading = screen.getByRole("heading", { name: "Mandate" });
    const term = heading.querySelector<HTMLElement>('[data-term="mandate"]');
    expect(term).not.toBeNull();
    expect(term!.textContent).toBe("Mandate");
  });
});
