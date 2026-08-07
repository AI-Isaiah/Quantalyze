/**
 * Phase 150 review WR-02 — the allocations page must CONSUME the null-vs-empty
 * contract, not collapse it.
 *
 * `getOwnCapitalStrategies` and `getMyStrategies` both return `null` (never
 * `[]`) on a transient DB/RLS failure. The page previously wrote
 * `ownCapitalStrategies ?? []` and `(myStrategies?.length ?? 0) > 0`, which
 * makes a failed fetch INDISTINGUISHABLE from an empty account at the render
 * layer: the owner's marked rows vanish, positioned rows read as unmarked (the
 * adapter derives `capitalOwnership` from marked-set membership, so the
 * Allocate affordance goes with them), and the panel states "No strategies
 * yet." about an account that has plenty.
 *
 * This spec pins the PAGE side of that boundary — which props leave the server
 * component — because it is the only place the `null` still exists. The copy
 * consequence is pinned separately in
 * `components/HoldingsTable.degraded-strategies-read.test.tsx`; together they
 * cover null → prop → rendered sentence.
 *
 * Rule-9 falsifier: restore either collapse and the matching case goes RED
 * (measured — `strategiesReadFailed` arrives `false` while the marked rows are
 * gone). The empty-account control is what stops the cases passing on a page
 * that simply always reports failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  ownCapitalMock,
  myStrategiesMock,
  tabsPropsSpy,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  ownCapitalMock: vi.fn(),
  myStrategiesMock: vi.fn(),
  tabsPropsSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));
vi.mock("@/lib/auth/requireRolePage", () => ({
  requireRolePage: async () => undefined,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

vi.mock("@/lib/queries", () => ({
  getMyAllocationDashboard: async () => ({ flaggedHoldings: [] }),
  getOwnCapitalStrategies: (...args: unknown[]) => ownCapitalMock(...args),
  getMyStrategies: (...args: unknown[]) => myStrategiesMock(...args),
}));
vi.mock("@/lib/portfolio-exposure", () => ({
  getLatestExposureSnapshot: async () => null,
  getNetExposureSeries: async () => [],
  getAllocationSeries: async () => [],
}));
vi.mock("./lib/watchlist-read", () => ({
  getFavoritesWithStrategies: async () => [],
  getOptimizerPrefetch: async () => ({}),
}));
vi.mock("./lib/dashboard-note-read", () => ({
  getDashboardNote: async () => ({ initialContent: "", initialLastSavedAt: null }),
}));
vi.mock("@/lib/analytics/onboarding-funnel", () => ({
  maybeEmitSignup: async () => undefined,
  maybeEmitOnboardingEvent: async () => undefined,
  maybeEmitFirstBridgeSurfaced: async () => undefined,
}));

// The tab shell is where the props land; capture them rather than rendering the
// whole client tree (the rendered consequence is the sibling spec's job).
vi.mock("./AllocationsTabs", () => ({
  AllocationsTabs: (props: Record<string, unknown>) => {
    tabsPropsSpy(props);
    return React.createElement("div", { "data-testid": "tabs" });
  },
}));
vi.mock("./AllocationContext", () => ({
  AllocationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import MyAllocationPage from "./page";

const MARKED = [{ id: "s-1", name: "Helios Basis" }];
const OWNED = [{ id: "s-1" }, { id: "s-2" }];

/**
 * Run the server component and return the props the tab shell received.
 * The page is async: await it for the element, then render so the tab shell
 * (mocked to a props spy) actually executes.
 */
async function runPage(): Promise<Record<string, unknown>> {
  const element = await MyAllocationPage();
  render(element as React.ReactElement);
  expect(tabsPropsSpy).toHaveBeenCalled();
  return tabsPropsSpy.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "u-1" } } });
});

describe("MyAllocationPage — WR-02 null-vs-empty at the only consumption point", () => {
  it("a failed own-capital read is reported as a FAILURE, not as an empty marked set", async () => {
    ownCapitalMock.mockResolvedValue(null);
    myStrategiesMock.mockResolvedValue(OWNED);

    const props = await runPage();

    expect(props.strategiesReadFailed).toBe(true);
    // The pre-fix page sent `[]` down with nothing to distinguish it — the
    // panel then renders an account-state claim off these two props alone.
    expect(props.ownCapitalStrategies).toEqual([]);
    expect(props.hasAnyStrategies).toBe(true);
  });

  it("a failed my-strategies read is reported as a FAILURE, not as 'this account has no strategies'", async () => {
    ownCapitalMock.mockResolvedValue(MARKED);
    myStrategiesMock.mockResolvedValue(null);

    const props = await runPage();

    expect(props.strategiesReadFailed).toBe(true);
    // `hasAnyStrategies: false` is exactly the value a strategy-less account
    // produces — which is why it may not be the ONLY signal the panel gets.
    expect(props.hasAnyStrategies).toBe(false);
  });

  it("both reads failing is still one honest failure", async () => {
    ownCapitalMock.mockResolvedValue(null);
    myStrategiesMock.mockResolvedValue(null);

    const props = await runPage();

    expect(props.strategiesReadFailed).toBe(true);
  });

  it("CONTROL — a genuinely empty account is NOT a failure (the definitive empty state stays reachable)", async () => {
    ownCapitalMock.mockResolvedValue([]);
    myStrategiesMock.mockResolvedValue([]);

    const props = await runPage();

    expect(props.strategiesReadFailed).toBe(false);
    expect(props.ownCapitalStrategies).toEqual([]);
    expect(props.hasAnyStrategies).toBe(false);
  });

  it("CONTROL — a healthy populated account passes the marked rows through untouched", async () => {
    ownCapitalMock.mockResolvedValue(MARKED);
    myStrategiesMock.mockResolvedValue(OWNED);

    const props = await runPage();

    expect(props.strategiesReadFailed).toBe(false);
    expect(props.ownCapitalStrategies).toEqual(MARKED);
    expect(props.hasAnyStrategies).toBe(true);
  });
});
