import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

/**
 * Phase 09.1 Plan 02 Task 3 — routing tests for AllocationsTabs.
 * Supersedes the Phase 07 2-tab suite. Verifies tab-shell routing only;
 * each panel body is mocked to a marker div so this file doesn't depend
 * on widget grids, holdings tables, or any downstream implementation.
 *
 * Tablist contract (Phase 198 D-02): exactly three tab buttons —
 * Overview / Holdings / Scenario, in that order. The Outcomes, Mandate and
 * Risk tabs are retired; their `?tab=` values are legacy aliases that land on
 * the content's new home (see the "legacy tab aliases" describe below).
 *
 * Cases:
 *   1. No tab param → Overview active.
 *   2. ?tab=holdings → Holdings active.
 *   3. ?tab=outcomes → Holdings active (legacy alias), URL rewritten.
 *   4. ?tab=mandate  → Overview active (legacy alias), tab param removed.
 *   5. ?tab=risk     → Overview active (legacy alias), tab param removed.
 *   6. ?tab=scenario → Scenario panel visible, Scenario tab present + selected.
 *   7. ?tab=performance (legacy Phase 07 alias) → Overview + the native
 *      history.replaceState strips the param (Phase 167.1.2 plan 07; was the
 *      router's replace, which re-ran the server render).
 *   8. ?tab=xyz (unknown) → Overview silent fallback (D-04). No URL cleanup
 *      because unknown is not in {overview, performance}.
 *   9. ArrowRight wraps focus across the 3 visible tabs in D-05 order.
 */

// --- next/navigation mocks --------------------------------------------------

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();
// Phase 167.1.2 plan 07 (SC-5c) — tab URLs go through the native History API.
// An App Router replace to a changed query on this force-dynamic page refetches
// the RSC payload (getMyAllocationDashboard re-runs); history.replaceState does
// not, and Next syncs useSearchParams to it. The spy is a no-op by default so
// jsdom's location does not leak across tests; `mockReplace` stays wired to the
// router mock so every arm can assert it is NEVER called.
let mockHistoryReplace: MockInstance<History["replaceState"]>;
/** The URL argument of every history.replaceState call, in order. */
function historyUrls(): string[] {
  return mockHistoryReplace.mock.calls.map((c) => String(c[2]));
}

vi.mock("next/navigation", async () => {
  return {
    useSearchParams: vi.fn(),
    useRouter: vi.fn(),
    usePathname: vi.fn(() => "/allocations"),
  };
});

// audit-2026-05-07 testing HIGH (conf 9) — `trackUsageEventClient` is hoisted
// to a `vi.fn` so dispatchWidgetPicker tests can assert the documented
// payload shape (widget_picker_dispatch + source + wasAlreadyOnOverview).
// `vi.hoisted` lets the mock factory below capture this fn by reference
// without TDZ issues across vi.mock hoisting.
const { mockTrackUsageEventClient } = vi.hoisted(() => ({
  mockTrackUsageEventClient: vi.fn(),
}));
vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: mockTrackUsageEventClient,
}));

import { useSearchParams, useRouter } from "next/navigation";

// --- Panel/body stubs -------------------------------------------------------
//
// Each panel/body component renders a unique marker so the tests can assert
// which surface is active without mounting the real implementation. Plans
// 05/08/10 fill these bodies later — the tab-shell contract should be
// independent of body content.

// Phase 198 D-02 — the Overview stub carries the `#risk` and `#mandate` section
// ids and the Holdings stub carries `#outcomes`: the real sections land there in
// plans 198-06 and 198-11, and the legacy-alias scroll targets them by id.
vi.mock("./AllocationDashboardV2", () => ({
  AllocationDashboardV2: () => (
    <div data-testid="overview-v2">
      OVERVIEW_V2_BODY
      <section id="risk" />
      <section id="mandate" />
    </div>
  ),
}));

vi.mock("./HoldingsTabPanel", () => ({
  HoldingsTabPanel: () => (
    <div data-testid="holdings-body">
      HOLDINGS_BODY
      <section id="outcomes" />
    </div>
  ),
}));

vi.mock("./ScenarioStub", () => ({
  ScenarioStub: () => (
    <div data-testid="scenario-body">SCENARIO_BODY</div>
  ),
}));

// Phase 10 / 10-06b — `?tab=scenario` now routes to ScenarioComposer when
// the v2 cohort flag is on (default in v0.15.7.0+). The composer is mocked
// to the SAME `scenario-body` testid as the legacy ScenarioStub so the
// existing 6-tab routing tests below continue to assert "scenario panel
// visible" without caring which branch rendered. Plan 06b's dedicated
// scenario-composer test file (AllocationsTabs.scenario-composer.test.tsx)
// asserts the v1/v2 branch contract directly.
vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: () => (
    <div data-testid="scenario-body">SCENARIO_COMPOSER_BODY</div>
  ),
}));

// Phase 198 D-03 / D-07 — the add-allocation flow is not under test here (its
// own suite is AllocationsTabs.add-param.test.tsx and AddAllocationFlow.test.tsx).
// A deep link in these URL-rewrite cases would otherwise open the real flow and
// start its list read.
vi.mock("./components/AddAllocationFlow", () => ({
  AddAllocationFlow: () => null,
}));

// --- Import after mocks -----------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EMPTY_EXPOSURE, type ExposureSectionData } from "./lib/exposure-props";

// --- Stub props -------------------------------------------------------------

const STUB_PROPS: MyAllocationDashboardPayload & {
  exposure: ExposureSectionData;
} = {
  exposure: EMPTY_EXPOSURE,
  portfolio: null,
  analytics: null,
  strategies: [],
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  holdingsSummary: [],
  snapshotCount: null,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  equityCurveSource: "legacy",
  // Phase 167.1.2 / D-02: the producer emits "rebuilding" for every allocator.
  equityHistoryState: "rebuilding",
  equityDailyReturns: [],
  equityHistoryRebuildReason: null,
  derivedCurveComputedAt: null,
  activeVenues: [],
  hasConnectedKeys: false,
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  mandate: null,
  // Phase 10 / Plan 10-03 — additive payload fields. Empty defaults match
  // the !portfolio + no-snapshots branch so the V1 / Stub paths render
  // their empty states unchanged.
  allocator_id: "00000000-0000-0000-0000-000000000000",
  liveBaselineMetrics: {
    aum: 0,
    ytdTwr: null,
    sharpe: null,
    maxDd: null,
    avgRho: null,
    equity: [],
    drawdown: [],
  },
  // Phase 37 / DSRC-01 — per-key channel additive fields (empty/false defaults
  // for the !portfolio + no-per-key-coverage path).
  perKeyReturnsByApiKeyId: {},
  perKeyDailiesGateSatisfied: false,
  eligibleApiKeyIds: [],
  // Phase 151 / AUM-04 — the split book-entry gate. No eligible keys here, so
  // no key can be allocator-side and none can contribute.
  allocatorEligibleApiKeyIds: [],
  contributingApiKeyIds: [],
  bookEntryGateSatisfied: false,
  // Phase 11 / 11-05 — onboarding visibility predicate inputs.
  apiKeysCount: 0,
  mandateIsSet: false,
};

// Phase 198 D-07 — the component builds every URL write from the LIVE
// `window.location.search` (two effects rewrite the URL in one commit, and a
// write built from the render's searchParams snapshot would resurrect a param the
// other had removed). So the mocked searchParams and the real jsdom location must
// say the same thing. Captured before any spy so it stays the real implementation.
const realReplaceState = window.history.replaceState.bind(window.history);
function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
  realReplaceState(null, "", query ? `/allocations?${query}` : "/allocations");
}

const ACTIVE_BODIES = [
  "overview-v2",
  "holdings-body",
  "scenario-body",
] as const;

function expectOnlyVisibleBody(testid: (typeof ACTIVE_BODIES)[number]): void {
  expect(screen.getByTestId(testid)).toBeInTheDocument();
  for (const other of ACTIVE_BODIES) {
    if (other === testid) continue;
    expect(screen.queryByTestId(other)).not.toBeInTheDocument();
  }
}

// Shared router/mocks reset — every describe below mounts AllocationsTabs,
// which calls useRouter(). The Phase-2 testing specialist flagged the
// four-line duplicated setup as maintainability noise. Hoisted here so all
// describes share one definition. Also resets `mockTrackUsageEventClient`
// (a no-op for the describes that don't read it) so later describes can
// rely on a clean call history without per-block boilerplate.
function resetRouterMocks(): void {
  mockHistoryReplace?.mockRestore();
  mockHistoryReplace = vi
    .spyOn(window.history, "replaceState")
    .mockImplementation(() => {});
  mockReplace.mockReset();
  mockRefresh.mockReset();
  mockPush.mockReset();
  mockTrackUsageEventClient.mockReset();
  vi.mocked(useRouter).mockReturnValue({
    replace: mockReplace,
    refresh: mockRefresh,
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
}

// Phase A6 — the Holdings tab body is loaded via next/dynamic({ ssr: false }),
// so it only appears after the
// lazy chunk resolves. findByTestId polls until the body appears or the
// jest timeout elapses, which is the right abstraction for lazy modules.
async function expectOnlyVisibleBodyAsync(
  testid: (typeof ACTIVE_BODIES)[number],
): Promise<void> {
  await screen.findByTestId(testid);
  for (const other of ACTIVE_BODIES) {
    if (other === testid) continue;
    expect(screen.queryByTestId(other)).not.toBeInTheDocument();
  }
}

describe("AllocationsTabs — Phase 170 item (a) narrow header strip", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  // WHY (Rule 9): below sm the tablist must be its own full-width scroller.
  // A flex item's default min-width is auto, so without min-w-0 + basis-full
  // the NAV-02 overflow never engages and the 682px tab bar widens the page
  // (2026-09-27 PROD measurement, 235px #main-content overflow).
  it("[SC2-(a)] the Allocation surfaces tablist is a full-width horizontal scroller", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const tablist = screen.getByRole("tablist", { name: "Allocation surfaces" });
    for (const token of [
      "min-w-0",
      "basis-full",
      "sm:basis-auto",
      "overflow-x-auto",
      "flex-nowrap",
    ]) {
      expect(tablist.className.split(/\s+/)).toContain(token);
    }
  });

  // WHY (170.1.1 D-06): DESIGN.md Voice is sentence case, and the sidebar
  // label, breadcrumb and e2e h1 anchors all key on "My allocation". The
  // string is hand-typed and case-sensitive so a title-case revert fails here.
  it("[170.1.1-D06] the page H1 reads 'My allocation' in sentence case", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent?.startsWith("My allocation")).toBe(true);
    for (const heading of screen.getAllByRole("heading")) {
      expect(heading.textContent).not.toContain("My Allocation");
    }
  });

  // WHY: JOURNEY-03 / axe aria-required-children. Re-nesting the tabs under
  // a scroll wrapper is a critical violation; the scroller IS the tablist.
  it("[JOURNEY-03] the tablist's direct children are the role=tab buttons", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const tablist = screen.getByRole("tablist", { name: "Allocation surfaces" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      expect(tab.parentElement).toBe(tablist);
    }
    for (const child of Array.from(tablist.children)) {
      expect(child.getAttribute("role")).toBe("tab");
    }
  });

  // WHY (GC-01, 2026-09-30): the tab strip is ONE scrolling line at every
  // width. It must never wrap into a second line of tabs and never switch to
  // visible overflow at a breakpoint. CI run 36764778803 measured both
  // failure modes of the old `sm:flex-wrap sm:overflow-x-visible` pair: at
  // V640 scrollWidth=264 == clientWidth=264 (the strip had stopped
  // scrolling), and at V960 the tablist sat 13 px off the Export row (it had
  // wrapped). From sm up it keeps sm:basis-auto, so it shares the action row
  // with Export and shrinks, scrolling inside itself only when it must.
  it("[GC-01] the tablist never wraps and never switches to visible overflow at any breakpoint", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const tablist = screen.getByRole("tablist", { name: "Allocation surfaces" });
    const tokens = tablist.className.split(/\s+/).filter(Boolean);
    // Strip any responsive/state prefix ("sm:", "md:hover:", …) so a wrap or
    // visible-overflow token cannot hide behind a breakpoint.
    const utilities = tokens.map((t) => t.slice(t.lastIndexOf(":") + 1));
    expect(utilities).not.toContain("flex-wrap");
    expect(utilities).not.toContain("overflow-x-visible");
    for (const token of ["flex-nowrap", "overflow-x-auto", "min-w-0", "sm:basis-auto"]) {
      expect(tokens).toContain(token);
    }
  });

  // WHY: the action row must be allowed to shrink and wrap so Export and
  // + Allocation drop to their own right-aligned row instead of widening
  // the page. justify-end keeps that wrapped row right-aligned.
  it("[SC2-(a)] the action wrapper shrinks, wraps, and right-aligns", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const tablist = screen.getByRole("tablist", { name: "Allocation surfaces" });
    const wrapper = tablist.parentElement;
    expect(wrapper).not.toBeNull();
    const classes = wrapper!.className.split(/\s+/);
    for (const token of [
      "min-w-0",
      "max-w-full",
      "flex-wrap",
      "justify-end",
      "sm:flex-nowrap",
    ]) {
      expect(classes).toContain(token);
    }
  });

  // WHY: below sm the hairline separator would sit on the action row with
  // no tabs beside it; hidden until sm. shrink-0 keeps Export and
  // + Allocation from compressing when the row is tight.
  it("[SC2-(a)] the separator hides below sm and the action buttons do not shrink", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const tablist = screen.getByRole("tablist", { name: "Allocation surfaces" });
    const separator = Array.from(tablist.parentElement?.children ?? []).find(
      (el) => el.getAttribute("aria-hidden") === "true" && el.tagName === "SPAN",
    );
    expect(separator).toBeTruthy();
    const sepClasses = separator!.className.split(/\s+/);
    expect(sepClasses).toContain("hidden");
    expect(sepClasses).toContain("sm:inline-block");

    const exportBtn = screen.getByRole("button", { name: "Export" });
    expect(exportBtn.className.split(/\s+/)).toContain("shrink-0");
    const addBtn = screen.getByRole("button", {
      name: /Add allocation|Add strategy/i,
    });
    expect(addBtn.className.split(/\s+/)).toContain("shrink-0");
  });

  // WHY: Phase 195 D-05 removed the Tweaks panel for every user. The header
  // action row must read Export then the add button, with no Tweaks button and
  // no empty slot where it stood (UC-5): an allocator should never see a
  // control that no longer does anything.
  it("[D-05] the header action row holds Export then the add button, and no Tweaks control", () => {
    setSearchParams("");
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(container.querySelector("[data-tweaks-toggle]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /tweaks/i }),
    ).toBeNull();
    const exportBtn = screen.getByRole("button", { name: "Export" });
    const addBtn = screen.getByRole("button", {
      name: /Add allocation|Add strategy/i,
    });
    const row = exportBtn.parentElement as HTMLElement;
    expect(addBtn.parentElement).toBe(row);
    // Export, then the add button, and nothing else between or after them.
    expect(exportBtn.nextElementSibling).toBe(addBtn);
    expect(addBtn.nextElementSibling).toBeNull();
  });
});

describe("AllocationsTabs — Phase 117 / UIFIX-02 clip-proof tab focus ring", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  // WHY (Rule 9 — intent): the tab strip is `overflow-x-auto` on mobile and the
  // buttons hang `-mb-[10px]` below it. The UA default `outline` paints OUTSIDE
  // the border edge, so the overflow container CLIPS it at the strip edge — a
  // keyboard user tabbing through the tabs sees no focus indicator (WCAG 2.4.7).
  // The fix is two tokens working together: `focus-visible:outline-none`
  // SUPPRESSES the UA outline (so nothing paints outside to be clipped), and the
  // INSET box-shadow ring paints INSIDE the button → never clipped. So the
  // correct idiom CONTAINS `outline-none` (suppression) but must NOT reintroduce
  // an outset outline (`outline-2` / `outline-offset` / `outline-accent`).
  // Full-opacity `ring-accent` (NOT `ring-accent/20`) clears WCAG 1.4.11.
  it("[UIFIX-02] a rendered tab button carries the inset ring tokens AND suppresses the clip-prone UA outline", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    expect(overviewTab.className).toContain("focus-visible:ring-2");
    expect(overviewTab.className).toContain("focus-visible:ring-inset");
    expect(overviewTab.className).toContain("focus-visible:ring-accent");
    // The UA outline must be suppressed so it can't paint outside and clip.
    expect(overviewTab.className).toContain("focus-visible:outline-none");
    // But no OUTSET outline idiom may be reintroduced (only `-none` is allowed).
    expect(overviewTab.className).not.toMatch(
      /focus-visible:outline-(?!none)(offset|2|4|accent|\[)/,
    );
    expect(overviewTab.className).not.toContain("ring-accent/20");
  });
});

describe("AllocationsTabs — Phase 09.1 D-04 / D-05 / D-06", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  it("no tab param → Overview tab active, only overview body rendered", () => {
    setSearchParams("");
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    expect(overviewTab.getAttribute("aria-selected")).toBe("true");
    expect(
      container.querySelector("#panel-overview")?.getAttribute("hidden"),
    ).toBeNull();
    expect(
      container.querySelector("#panel-holdings")?.getAttribute("hidden"),
    ).not.toBeNull();
  });

  it("?tab=holdings → Holdings tab active", async () => {
    setSearchParams("tab=holdings");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("holdings-body");
    expect(
      screen.getByRole("tab", { name: "Holdings" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  // Phase 198 D-02 — retired tab is an alias now. The tab each lands on and the
  // URL after mount are pinned in depth by the "legacy tab aliases" describe.
  it("?tab=outcomes → Holdings tab active (legacy alias)", async () => {
    setSearchParams("tab=outcomes");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("holdings-body");
    expect(
      screen.getByRole("tab", { name: "Holdings" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=mandate → Overview tab active (legacy alias)", () => {
    setSearchParams("tab=mandate");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    expect(
      screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=risk → Overview tab active (legacy alias)", () => {
    setSearchParams("tab=risk");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    expect(
      screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("?tab=scenario → Scenario panel visible AND Scenario tab present + selected in tablist (SURF-01, Phase 21)", async () => {
    setSearchParams("tab=scenario");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // Phase 10 / 10-06b — ScenarioComposer is dynamic-imported (next/dynamic
    // ssr:false), so the body resolves on the next microtask. The sync
    // helper would race with the loading-skeleton fallback; the async
    // helper polls until the testid appears.
    await expectOnlyVisibleBodyAsync("scenario-body");
    // SURF-01 (Phase 21) — Scenario is now a visible tab button in the
    // tablist (added to VISIBLE_TAB_KEYS), reversing the prior PR3
    // "hidden from tablist" contract. It remains independently routable
    // via ?tab=scenario and the green "+ Allocation" chip.
    const scenarioTab = screen.getByRole("tab", { name: "Scenario" });
    expect(scenarioTab).toBeInTheDocument();
    expect(scenarioTab.getAttribute("aria-selected")).toBe("true");
  });

  it("?tab=performance (legacy alias) → Overview + router.replace strips the param", () => {
    setSearchParams("tab=performance");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    // The cleanup effect must call history.replaceState with the tab param
    // removed, and never the router's replace (SC-5c).
    const cleanupUrl = historyUrls().find((u) => !u.includes("tab="));
    expect(
      cleanupUrl,
      "history.replaceState called with tab param stripped",
    ).toBe("/allocations");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // M-0042 (pr-test-analyzer) — the legacy ?tab=performance strip effect
  // rebuilds the query string from `new URLSearchParams(searchParams)` and
  // only deletes the `tab` key (AllocationsTabs.tsx:366-374). The existing
  // test above only exercises a SOLE `tab=performance` param. This pins the
  // co-existing-param case: a regression that rebuilds from scratch (e.g.
  // `router.replace(pathname)`) instead of mutating the existing params
  // would silently drop `otherParam` from a deep-linked URL.
  it("?tab=performance&otherParam=value → strips tab but preserves otherParam", () => {
    setSearchParams("tab=performance&otherParam=value");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    // The cleanup call is the one without a `tab=` segment (the param strip).
    const url = historyUrls().find((u) => !u.includes("tab="));
    expect(
      url,
      "history.replaceState called with tab param stripped",
    ).toBeDefined();
    // otherParam must survive the strip — assert both the key and its value.
    expect(url).toContain("otherParam=value");
    expect(url).toContain("/allocations?");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("?tab=xyz (unknown) → Overview silent fallback, no URL cleanup", () => {
    setSearchParams("tab=xyz");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    // Unknown values are NOT cleaned up — only "overview" and "performance"
    // trigger the strip effect. No URL write of either kind.
    expect(mockHistoryReplace).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // Phase 167.1.2 plan 07 (SC-5c). A tab click writes the URL through the
  // native History API exactly once and never through the router: the
  // router's replace to a changed query on this force-dynamic page refetches
  // the RSC payload, so every tab click re-ran getMyAllocationDashboard.
  it("SC-5c — clicking a tab calls history.replaceState once with the tab URL and never the router's replace", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    mockHistoryReplace.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Holdings" }));
    expect(mockHistoryReplace).toHaveBeenCalledTimes(1);
    expect(mockHistoryReplace).toHaveBeenCalledWith(
      null,
      "",
      "/allocations?tab=holdings",
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // The visible tab is derived from useSearchParams. Next documents that
  // history.replaceState integrates with useSearchParams; this arm models that
  // sync (the mock reads the live jsdom URL, and a re-render stands in for the
  // router's update) and pins that the component switches its visible body off
  // the URL alone. That Next itself performs the sync is the browser check's
  // to confirm (recorded as pending in the plan SUMMARY), not this mock's.
  it("SC-5c — after history.replaceState, the URL-derived visible tab switches", async () => {
    mockHistoryReplace.mockRestore();
    const realReplace = window.history.replaceState.bind(window.history);
    mockHistoryReplace = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation((...args) => realReplace(...args));
    const originalUrl = window.location.pathname + window.location.search;
    realReplace(null, "", "/allocations");
    vi.mocked(useSearchParams).mockImplementation(
      () =>
        new URLSearchParams(
          window.location.search,
        ) as unknown as ReadonlyURLSearchParams,
    );
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    fireEvent.click(screen.getByRole("tab", { name: "Holdings" }));
    expect(window.location.search).toBe("?tab=holdings");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("holdings-body");
    expect(mockReplace).not.toHaveBeenCalled();
    realReplace(null, "", originalUrl);
  });

  it("ArrowRight wraps focus across the three visible tabs in VISIBLE_TAB_KEYS order (includes Scenario, SURF-01)", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // SURF-01 (Phase 21) — Scenario is now in VISIBLE_TAB_KEYS, so the
    // keyboard walk includes it as the last visible tab. Overview is the
    // factsheet view (no separate Analytics tab). Wrap from Scenario → Overview.
    // Phase 198 D-02: three tabs, so the walk is Overview → Holdings → Scenario.
    const order = ["Overview", "Holdings", "Scenario"];
    for (let i = 0; i < order.length; i++) {
      mockHistoryReplace.mockClear();
      const current = screen.getByRole("tab", { name: order[i] });
      fireEvent.keyDown(current, { key: "ArrowRight" });
      const expectedNext = order[(i + 1) % order.length];
      expect(mockHistoryReplace).toHaveBeenCalled();
      const url = historyUrls()[0];
      if (expectedNext === "Overview") {
        // Overview is the default — no tab param in URL.
        expect(url.includes("tab=")).toBe(false);
      } else {
        expect(url).toContain(`tab=${expectedNext.toLowerCase()}`);
      }
    }
  });
});

// --- audit-2026-05-07 cluster P regression tests ----------------------------

describe("AllocationsTabs — audit-2026-05-07 cluster P count badges (H-1189 / M-1042; Phase 198 D-02)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  // Phase 198 D-02: the Outcomes tab and its badge left with the tab. The
  // Holdings badge still counts strategies, and a populated outcomes array must
  // not put a badge or a tab back in the strip.
  it("renders the count badge on the Holdings tab (8) and no Outcomes tab even when outcomes are populated", () => {
    setSearchParams("");
    // F4b: the Holdings badge counts onboarded strategies, not raw positions.
    const strategies = Array.from({ length: 8 }).map((_, i) => ({ strategy_id: `s-${i}` }));
    const outcomes = Array.from({ length: 4 }).map((_, i) => ({ id: `o-${i}` }));
    render(
      <AllocationsTabs
        {...STUB_PROPS}
        strategies={strategies as unknown as MyAllocationDashboardPayload["strategies"]}
        outcomes={outcomes as unknown as MyAllocationDashboardPayload["outcomes"]}
      />,
    );

    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).getByText("8")).toBeInTheDocument();

    expect(screen.queryByRole("tab", { name: /Outcomes/ })).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("hides the badge when count is 0 — no '0' chip", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).queryByText("0")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Outcomes/ })).toBeNull();
  });

  it("renders '1' badge correctly (pins the >0 gate, not >=2)", () => {
    setSearchParams("");
    render(
      <AllocationsTabs
        {...STUB_PROPS}
        strategies={[{ strategy_id: "s-only" }] as unknown as MyAllocationDashboardPayload["strategies"]}
      />,
    );
    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).getByText("1")).toBeInTheDocument();
  });

  it("undefined holdingsSummary does not crash and no badge renders", () => {
    setSearchParams("");
    render(
      <AllocationsTabs
        {...STUB_PROPS}
        holdingsSummary={
          undefined as unknown as MyAllocationDashboardPayload["holdingsSummary"]
        }
      />,
    );
    const holdingsTab = screen.getByRole("tab", { name: /Holdings/ });
    expect(within(holdingsTab).queryByText(/\d/)).toBeNull();
  });
});

describe("AllocationsTabs — audit-2026-05-07 cluster P Export chip (M-1041 / M-1044)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  // Phase 198 D-02: Risk is an alias of Overview now (and rewrites the URL on
  // mount), so these Export arms start from the Overview, a non-Holdings tab.
  it("Export chip from the Overview tab navigates to Holdings (M-1041 regression)", async () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);
    expect(mockHistoryReplace).toHaveBeenCalled();
    const url = historyUrls()[0];
    expect(url).toContain("tab=holdings");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("Export chip announces redirect via aria-live region (M-1044 silent-failure fix)", async () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const liveRegion = screen.getByTestId("allocations-tabs-live-region");
    expect(liveRegion.textContent).toBe("");
    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);
    // audit-2026-05-07 Phase-4 red-team: microtask-clear pattern means the
    // live region first commits "" (forces React re-render even on repeat
    // clicks) and the microtask sets the message. Flush microtasks AND
    // React's pending commit with act() — a bare `await Promise.resolve()`
    // only yields one microtask cycle, which lets the queueMicrotask
    // callback run but leaves React 19's commit pending until the next
    // tick, leaving textContent at "".
    await act(async () => { await Promise.resolve(); });
    expect(liveRegion.textContent).toContain("Export");
    expect(liveRegion.textContent).toContain("Holdings");
    // aria-live wiring keeps the message a polite announcement.
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.getAttribute("role")).toBe("status");
  });

  it("Export chip clicked from Holdings does NOT re-announce (no surface change)", async () => {
    setSearchParams("tab=holdings");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const liveRegion = screen.getByTestId("allocations-tabs-live-region");
    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);
    await Promise.resolve();
    expect(liveRegion.textContent).toBe("");
  });
});

describe("AllocationsTabs — audit-2026-05-07 cluster P silent-failure breadcrumbs (M-1045 / M-1046)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  it("?tab=outcoms (typo) emits warnAudit invalid_tab_fallback breadcrumb (M-1045)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=outcoms");
    render(<AllocationsTabs {...STUB_PROPS} />);

    expect(warnSpy).toHaveBeenCalled();
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("[AllocationsTabs]") &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeDefined();
    expect(matching![1]).toEqual({ raw: "outcoms" });
    warnSpy.mockRestore();
  });

  it("?tab=performance (known legacy alias) does NOT emit invalid_tab breadcrumb (M-1045)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=performance");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("no tab param does NOT emit invalid_tab breadcrumb (M-1045)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("router.refresh throw is caught and breadcrumbed (M-1046)", () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockRefresh.mockImplementation(() => {
      throw new Error("simulated route-handler 5xx");
    });
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    // Polling interval is 30s — advance past one tick.
    vi.advanceTimersByTime(31_000);

    expect(mockRefresh).toHaveBeenCalled();
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("router_refresh_failed"),
    );
    expect(matching).toBeDefined();
    expect(
      (matching![1] as { reason: string }).reason,
    ).toContain("simulated route-handler 5xx");
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  // audit-2026-05-07 testing HIGH (conf 8) — the previous M-1046 test only
  // advances one 31s tick. A regression that lets the throw escape the
  // interval callback (e.g. removing the try/catch) would STILL pass that
  // test because setInterval keeps firing the SAME callback even after
  // a throw escapes it — but the breadcrumb assertion would also pass on
  // the FIRST tick. The whole point of the M-1046 fix is "we don't want
  // the interval to silently die" — this test pins that by advancing TWO
  // ticks and asserting mockRefresh fires twice AND the breadcrumb fires
  // twice. Cleanup: unmount and advance a third tick — mockRefresh must
  // NOT be called a third time.
  it("router.refresh throw — interval keeps polling across multiple ticks and cleans up on unmount (M-1046)", () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockRefresh.mockImplementation(() => {
      throw new Error("simulated route-handler 5xx");
    });
    setSearchParams("");
    const { unmount } = render(<AllocationsTabs {...STUB_PROPS} />);

    // Two ticks (60s + slop). Each must call refresh + emit a breadcrumb;
    // the interval MUST keep polling after the first throw is swallowed.
    vi.advanceTimersByTime(62_000);

    expect(mockRefresh.mock.calls.length).toBeGreaterThanOrEqual(2);
    const breadcrumbCount = warnSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("router_refresh_failed"),
    ).length;
    expect(breadcrumbCount).toBeGreaterThanOrEqual(2);

    // Cleanup contract — unmount must clearInterval. Advance a 3rd tick
    // worth and assert mockRefresh stays at its current call count.
    const beforeUnmount = mockRefresh.mock.calls.length;
    unmount();
    vi.advanceTimersByTime(31_000);
    expect(mockRefresh.mock.calls.length).toBe(beforeUnmount);

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});

// audit-2026-05-07 testing MED — capture the ORIGINAL window.localStorage
// descriptor exactly once at module load, before any describe block has had
// a chance to install a shim. Restoring via descriptor avoids the
// "originalLocalStorage captured a partial-failure shim" leak that a
// per-describe beforeEach would have if a prior test crashed mid-setup.
// Also more robust against test reordering: regardless of which test runs
// first, the restore always points back to the real jsdom Storage.
const ORIGINAL_LOCALSTORAGE_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

describe("AllocationsTabs — audit-2026-05-07 cluster P ui_v2 flag (C-0336 / H-0060)", () => {
  // Vitest's jsdom environment here exposes a localStorage backend that
  // doesn't permit direct setItem/spyOn (see `--localstorage-file` warning).
  // Override `window.localStorage` with a vanilla in-memory shim so the
  // C-0336 / H-1188 paths are exercisable. `Object.defineProperty` is the
  // only setter that works on the read-only window.localStorage descriptor.
  type StorageShim = {
    map: Map<string, string>;
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
    clear: () => void;
    key: (i: number) => string | null;
    readonly length: number;
  };
  let storageShim: StorageShim;

  beforeEach(() => {
    resetRouterMocks();

    const map = new Map<string, string>();
    storageShim = {
      map,
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        map.set(k, String(v));
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      get length() {
        return map.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storageShim,
    });
  });

  afterEach(() => {
    // Restore from the module-load descriptor so partial-failure shims
    // installed by a prior test can never leak into subsequent describes.
    if (ORIGINAL_LOCALSTORAGE_DESCRIPTOR) {
      Object.defineProperty(
        window,
        "localStorage",
        ORIGINAL_LOCALSTORAGE_DESCRIPTOR,
      );
    }
  });

  it("localStorage getItem throw surfaces a fail-loud cross-tab breadcrumb (C-0336)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    storageShim.getItem = () => {
      throw new Error("SecurityError: storage blocked");
    };

    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    // B7: the ui_v2 read routes through useCrossTabStorage; a getItem throw is
    // caught + logged by the primitive (tagged with the key + the actual
    // error), replacing the old readUiV2Flag try/catch breadcrumb. Default V2
    // behaviour is preserved (the flag falls back to "default"). Other
    // co-mounted readers may log through the primitive too, so we target the
    // ui_v2-keyed breadcrumb specifically rather than the first one.
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("[cross-tab] localStorage read threw") &&
        (c[1] as { key?: string } | undefined)?.key === "allocations.ui_v2",
    );
    expect(matching).toBeDefined();
    // The underlying error (C-0336 reason) is preserved as the third warn arg.
    expect(String(matching![2])).toContain("SecurityError");
    warnSpy.mockRestore();
  });

  it("explicit allocations.ui_v2=false emits ui_v2_rollback_scope_scenario_only breadcrumb (H-1188)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    storageShim.setItem("allocations.ui_v2", "false");
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("ui_v2_rollback_scope_scenario_only"),
    );
    expect(matching).toBeDefined();
    expect(
      (matching![1] as { affected_surface: string }).affected_surface,
    ).toBe("scenario");
    warnSpy.mockRestore();
  });

  it("no allocations.ui_v2 (default branch) does NOT emit rollback breadcrumb (H-1188)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("ui_v2_rollback_scope_scenario_only"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("B7: a cross-tab storage event flipping allocations.ui_v2 to 'false' is adopted post-mount", () => {
    // Rule-9 coverage gap (type-design review): the read-only ui_v2 flag now
    // routes through useCrossTabStorage, so an operator setting the rollback
    // flag in ANOTHER tab must sync into this one. Mount with no flag (default
    // V2, no breadcrumb), then dispatch a foreign storage event and assert the
    // primitive adopted the flip — observed via the H-1188 breadcrumb firing
    // only AFTER the event (not on mount).
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);

    const rollbackBefore = warnSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("ui_v2_rollback_scope_scenario_only"),
    ).length;
    expect(rollbackBefore).toBe(0);

    // Another tab sets the rollback flag → storage event (the primitive decodes
    // e.newValue directly; setItem keeps the shim consistent for any re-read).
    act(() => {
      storageShim.setItem("allocations.ui_v2", "false");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "allocations.ui_v2",
          newValue: "false",
        }),
      );
    });

    const rollbackAfter = warnSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("ui_v2_rollback_scope_scenario_only") &&
        (c[1] as { affected_surface?: string } | undefined)?.affected_surface ===
          "scenario",
    ).length;
    expect(rollbackAfter).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});

// Each describe below resets the router mocks in beforeEach via the shared
// resetRouterMocks helper (defined near the top of this file). Covers:
//   - parseTab boundary cases — pins the KNOWN_TAB_RAW contract.
//   - Export chip scroll:false + single-shot routing pin.
//   - Export chip same-tab repeat click re-announce (React Object.is bail-out
//     path the original aria-live fix didn't cover).

describe("AllocationsTabs — audit-2026-05-07 Phase-2 parseTab boundary cases (MED conf 8)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  // Pin the KNOWN_TAB_RAW contract — none of these canonical keys (nor the
  // Phase 198 D-02 retired-tab aliases outcomes / mandate / risk) should emit
  // invalid_tab_fallback. Locks the constant set as part of the tested
  // contract instead of leaving it as documentation.
  for (const raw of [
    "overview",
    "holdings",
    "outcomes",
    "mandate",
    "risk",
    "scenario",
    "performance",
  ] as const) {
    it(`?tab=${raw} (canonical or legacy alias) does NOT emit invalid_tab_fallback breadcrumb`, () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      setSearchParams(`tab=${raw}`);
      render(<AllocationsTabs {...STUB_PROPS} />);
      const matching = warnSpy.mock.calls.find(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("invalid_tab_fallback"),
      );
      expect(matching).toBeUndefined();
      warnSpy.mockRestore();
    });
  }

  it("?tab= (empty string) does NOT warn (length>0 guard pins this)", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("?tab=%20 (whitespace) DOES warn — case-sensitive, no .trim() in parseTab", () => {
    // Documents the current contract: whitespace is non-empty and not in
    // KNOWN_TAB_RAW → it warns. If a future fix adds .trim(), this test
    // is the canonical place to flip the assertion to .toBeUndefined().
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=%20");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeDefined();
    warnSpy.mockRestore();
  });

  it("?tab=HOLDINGS (uppercase canonical) DOES warn — case-sensitive contract", () => {
    // Documents the current contract: canonical keys are lowercase-only.
    // If a future fix adds toLowerCase(), this test is the canonical
    // place to flip the assertion to .toBeUndefined().
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setSearchParams("tab=HOLDINGS");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const matching = warnSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("invalid_tab_fallback"),
    );
    expect(matching).toBeDefined();
    warnSpy.mockRestore();
  });
});

describe("AllocationsTabs — audit-2026-05-07 Phase-2 Export chip hardening (MED conf 8)", () => {
  beforeEach(() => {
    resetRouterMocks();
  });

  it("Export chip from Overview: history.replaceState called exactly ONCE, the router's replace never", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    // Pre-render setup may call replace zero times. Clear to isolate the
    // click's effect.
    mockHistoryReplace.mockClear();

    const exportChip = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportChip);

    // Single-shot: exactly one URL write from the click path, and it is the
    // native History API (no RSC refetch, no scroll: replaceState never
    // scrolls, which is what `{ scroll: false }` used to ask the router for).
    expect(mockHistoryReplace).toHaveBeenCalledTimes(1);
    const [state, unused] = mockHistoryReplace.mock.calls[0];
    expect(state).toBeNull();
    expect(unused).toBe("");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("Export chip clicked twice from Overview → re-announces (microtask-clear pinned)", async () => {
    // audit-2026-05-07 Phase-4 red-team (MED conf 8) — replaced the
    // unbounded ZWS-suffix counter with a microtask-clear pattern. Each
    // click sets the live region to "" first (forcing React to commit an
    // empty render), then a queued microtask sets the human-readable
    // message. The empty render between announcements is what triggers
    // aria-live=polite to re-announce identical text — the suffix is no
    // longer needed and (importantly) does not leak into clipboard reads.
    // This test pins both halves: textContent reverts to "" right after
    // click, then reverts to the message after the microtask flush.
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const liveRegion = screen.getByTestId("allocations-tabs-live-region");
    const exportChip = screen.getByRole("button", { name: "Export" });

    fireEvent.click(exportChip);
    // Synchronous-after-click: setExportAnnouncement("") landed; React
    // committed an empty render before the microtask fires.
    expect(liveRegion.textContent).toBe("");
    // act() flushes BOTH the queued microtask (which calls setState) AND
    // the pending React commit. A bare `await Promise.resolve()` only
    // does the first half — see M-1044 test note above.
    await act(async () => { await Promise.resolve(); });
    const firstText = liveRegion.textContent ?? "";
    expect(firstText).toContain("Export");
    expect(firstText).toContain("Holdings");

    // Second click from the same tab — the empty-render gap fires again,
    // so aria-live=polite re-announces even though the final text is
    // identical to the first announcement.
    setSearchParams("");
    fireEvent.click(exportChip);
    expect(liveRegion.textContent).toBe("");
    await act(async () => { await Promise.resolve(); });
    const secondText = liveRegion.textContent ?? "";
    expect(secondText).toContain("Export");
    expect(secondText).toContain("Holdings");
  });

  // audit-2026-05-07 Phase-4 red-team regression (MED conf 8).
  // Pins the clipboard-safety contract: the live region textContent must
  // equal the human-readable string exactly — no U+200B (zero-width-space)
  // sentinel characters from the previous suffix-based re-render trick.
  // A user copying the announcement into a support ticket or trade-note
  // form should NOT paste invisible characters.
  it("Export live region textContent equals the human-readable string (no ZWS leak)", async () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    const liveRegion = screen.getByTestId("allocations-tabs-live-region");
    const exportChip = screen.getByRole("button", { name: "Export" });

    fireEvent.click(exportChip);
    // act() flushes microtask + React commit (see M-1044 note above).
    await act(async () => { await Promise.resolve(); });
    const text = liveRegion.textContent ?? "";
    expect(text).toBe(
      "Export lives in the Holdings tab — taking you there.",
    );
    expect(text).not.toMatch(/​/);

    // Click again — even after multiple announcements, the textContent
    // stays equal to the single human-readable string. Pre-fix the suffix
    // would have grown to two ZWS characters here.
    setSearchParams("");
    fireEvent.click(exportChip);
    await act(async () => { await Promise.resolve(); });
    const text2 = liveRegion.textContent ?? "";
    expect(text2).toBe(
      "Export lives in the Holdings tab — taking you there.",
    );
    expect(text2).not.toMatch(/​/);
  });
});

// Phase 195 D-05 — the Tweaks panel is gone, so a value an allocator stored
// under allocations.tweaks while it existed must change nothing. Every knob
// resolves to its default with no storage read and no DOM attribute write
// (threat T-195-07: a stored value used to hide the Outcomes tab and the
// benchmark line). These tests seed the FULL set of non-default values and
// assert none of it leaks into the shell.
const TWEAK_DOM_ATTRS = [
  ["body", "data-density"],
  ["body", "data-display-font"],
  ["body", "data-show-outcomes"],
  ["html", "data-accent-intensity"],
] as const;

function clearTweakAttrs() {
  for (const [el, attr] of TWEAK_DOM_ATTRS) {
    (el === "body" ? document.body : document.documentElement).removeAttribute(
      attr,
    );
  }
}

const STALE_TWEAKS_VALUE = JSON.stringify({
  density: "tight",
  accentIntensity: "full",
  displayFont: "sans",
  bridgeVariant: "subtle",
  chartStyle: "line",
  showBench: false,
  showOutcomes: false,
});

describe("AllocationsTabs — a stored Tweaks value changes nothing (Phase 195 D-05)", () => {
  // Same localStorage shim pattern as the cluster-P describe above —
  // jsdom's default Storage doesn't permit direct setItem here. The
  // module-load descriptor is restored in afterEach.
  type StorageShim = {
    map: Map<string, string>;
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
    clear: () => void;
    key: (i: number) => string | null;
    readonly length: number;
  };
  let storageShim: StorageShim;

  beforeEach(() => {
    resetRouterMocks();
    const map = new Map<string, string>();
    storageShim = {
      map,
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        map.set(k, String(v));
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      get length() {
        return map.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storageShim,
    });
    clearTweakAttrs();
  });
  afterEach(() => {
    if (ORIGINAL_LOCALSTORAGE_DESCRIPTOR) {
      Object.defineProperty(
        window,
        "localStorage",
        ORIGINAL_LOCALSTORAGE_DESCRIPTOR,
      );
    }
    clearTweakAttrs();
  });

  // Phase 198 D-02 — Outcomes is a legacy alias of Holdings now. The intent is
  // unchanged: a stale showOutcomes=false must not redirect an Outcomes link
  // away from its content, so the link lands on Holdings and the only URL
  // write is the alias rewrite to ?tab=holdings (never a strip to Overview).
  it("an ?tab=outcomes link still lands on Holdings when a stale value says showOutcomes=false", async () => {
    window.localStorage.setItem("allocations.tweaks", STALE_TWEAKS_VALUE);
    setSearchParams("tab=outcomes");
    await act(async () => {
      render(<AllocationsTabs {...STUB_PROPS} />);
    });
    expect(
      screen.getByRole("tab", { name: "Holdings" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(historyUrls()).toEqual(["/allocations?tab=holdings"]);
  });

  it("sets none of the Tweaks DOM attributes from a stale stored value", async () => {
    window.localStorage.setItem("allocations.tweaks", STALE_TWEAKS_VALUE);
    setSearchParams("");
    await act(async () => {
      render(<AllocationsTabs {...STUB_PROPS} />);
    });
    for (const [el, attr] of TWEAK_DOM_ATTRS) {
      const node = el === "body" ? document.body : document.documentElement;
      expect(node.hasAttribute(attr), `${el}[${attr}]`).toBe(false);
    }
  });

  it("keyboard arrow-nav still walks every tab (a stale value hides none)", async () => {
    window.localStorage.setItem("allocations.tweaks", STALE_TWEAKS_VALUE);
    setSearchParams("");
    await act(async () => {
      render(<AllocationsTabs {...STUB_PROPS} />);
    });
    const holdings = screen.getByRole("tab", { name: "Holdings" });
    holdings.focus();
    mockHistoryReplace.mockClear();
    fireEvent.keyDown(holdings, { key: "ArrowRight" });
    const urls = historyUrls();
    const lastUrl = urls[urls.length - 1] ?? "";
    expect(lastUrl).toMatch(/tab=scenario/);
  });
});

// Phase 198 D-02 — My allocation has three tabs, and the three retired tabs
// (Outcomes, Mandate, Risk) are legacy aliases: a link to one lands on the tab
// holding that content, the URL is rewritten with no history entry, and the page
// scrolls once to the section. A user who bookmarked ?tab=risk, or the sidebar's
// Risk item, must never land on an empty or wrong surface.
describe("AllocationsTabs — Phase 198 D-02 three tabs and legacy tab aliases", () => {
  // A hand-driven requestAnimationFrame so the bounded retry loop is observable
  // frame by frame, and a stubbed scrollIntoView (jsdom has none).
  let rafQueue: Map<number, FrameRequestCallback>;
  let rafSeq: number;
  let rafRequests: number;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  let cancelSpy: MockInstance<Window["cancelAnimationFrame"]>;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalMatchMedia = window.matchMedia;

  function flushFrames(n: number): void {
    for (let i = 0; i < n; i++) {
      const pending = Array.from(rafQueue.values());
      rafQueue.clear();
      if (pending.length === 0) return;
      act(() => {
        for (const cb of pending) cb(0);
      });
    }
  }

  function setReducedMotion(reduce: boolean): void {
    window.matchMedia = vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  beforeEach(() => {
    resetRouterMocks();
    rafQueue = new Map();
    rafSeq = 0;
    rafRequests = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafRequests += 1;
      rafSeq += 1;
      rafQueue.set(rafSeq, cb);
      return rafSeq;
    });
    cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        rafQueue.delete(id);
      });
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView =
      scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
  });

  function tabNames(): string[] {
    return screen.getAllByRole("tab").map((t) => t.textContent ?? "");
  }

  it("the tablist has exactly three tabs: Overview, Holdings, Scenario, in that order", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(tabNames()).toEqual(["Overview", "Holdings", "Scenario"]);
    for (const retired of ["Outcomes", "Mandate", "Risk"]) {
      expect(screen.queryByRole("tab", { name: retired })).toBeNull();
    }
  });

  it("End focuses Scenario and Home focuses Overview (keyboard walks three tabs)", () => {
    setSearchParams("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), {
      key: "End",
    });
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Scenario" }),
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Scenario" }), {
      key: "Home",
    });
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Overview" }),
    );
  });

  // WHY: the alias must land on the tab that HOLDS the content, and the URL must
  // be rewritten once with no router navigation (no RSC refetch, no history entry).
  it("?tab=outcomes lands on Holdings and rewrites the URL once to ?tab=holdings", async () => {
    setSearchParams("tab=outcomes");
    render(<AllocationsTabs {...STUB_PROPS} />);
    await expectOnlyVisibleBodyAsync("holdings-body");
    expect(
      screen.getByRole("tab", { name: "Holdings" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(mockHistoryReplace).toHaveBeenCalledTimes(1);
    expect(historyUrls()).toEqual(["/allocations?tab=holdings"]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  for (const legacy of ["risk", "mandate"] as const) {
    it(`?tab=${legacy} lands on Overview and removes the tab param (/allocations)`, () => {
      setSearchParams(`tab=${legacy}`);
      render(<AllocationsTabs {...STUB_PROPS} />);
      expectOnlyVisibleBody("overview-v2");
      expect(
        screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
      ).toBe("true");
      expect(mockHistoryReplace).toHaveBeenCalledTimes(1);
      expect(historyUrls()).toEqual(["/allocations"]);
    });
  }

  // WHY: a deep link carrying another param (add= opens the add-allocation flow)
  // must keep it through the alias rewrite, or the alias silently drops user
  // intent. The alias write is the FIRST write; the add strip that follows it, and
  // the final URL once both have run, are pinned in AllocationsTabs.add-param.test.tsx
  // against a real URL (this file's replaceState spy is a no-op).
  it("?tab=risk&add=abc: the alias rewrite keeps add (/allocations?add=abc)", () => {
    setSearchParams("tab=risk&add=abc");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(historyUrls()[0]).toBe("/allocations?add=abc");
  });

  it("?tab=outcomes&add=abc: the alias rewrite goes to ?tab=holdings with add kept", () => {
    setSearchParams("tab=outcomes&add=abc");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(historyUrls()[0]).toBe("/allocations?tab=holdings&add=abc");
  });

  describe("anchor scroll", () => {
    it("?tab=risk scrolls once to #risk with behavior smooth", () => {
      setSearchParams("tab=risk");
      render(<AllocationsTabs {...STUB_PROPS} />);
      flushFrames(5);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
      expect((scrollIntoView.mock.contexts[0] as HTMLElement).id).toBe("risk");
    });

    it("?tab=mandate scrolls once to #mandate", () => {
      setSearchParams("tab=mandate");
      render(<AllocationsTabs {...STUB_PROPS} />);
      flushFrames(5);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect((scrollIntoView.mock.contexts[0] as HTMLElement).id).toBe("mandate");
    });

    // WHY: a vestibular-sensitive user who asked for reduced motion must get an
    // instant jump, never an animated scroll.
    it("honours prefers-reduced-motion: the scroll is instant (behavior auto)", () => {
      setReducedMotion(true);
      setSearchParams("tab=risk");
      render(<AllocationsTabs {...STUB_PROPS} />);
      flushFrames(5);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "auto",
        block: "start",
      });
    });

    it("?tab=outcomes scrolls once to #outcomes inside the Holdings panel", async () => {
      setSearchParams("tab=outcomes");
      render(<AllocationsTabs {...STUB_PROPS} />);
      await screen.findByTestId("holdings-body");
      flushFrames(5);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect((scrollIntoView.mock.contexts[0] as HTMLElement).id).toBe(
        "outcomes",
      );
    });

    // WHY (RESEARCH P6): the Holdings panel mounts lazily, so the anchor does not
    // exist on the first frames. The retry must keep waiting for it, not give up
    // early or scroll to nothing. Modelled by hiding the anchor's id for a few
    // frames (the lazy chunk's late mount), then restoring it.
    it("keeps retrying while the anchor is absent, then scrolls once when it appears", () => {
      setSearchParams("tab=risk");
      render(<AllocationsTabs {...STUB_PROPS} />);
      const anchor = document.getElementById("risk") as HTMLElement;
      anchor.id = "risk-not-mounted-yet";
      flushFrames(3);
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(rafQueue.size).toBe(1);
      anchor.id = "risk";
      flushFrames(3);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(anchor);
    });

    // WHY: a missing anchor (the section is not built, or the panel failed to
    // load) must end silently inside the frame budget, never loop forever and
    // never throw.
    it("gives up silently after 120 frames when no anchor appears", () => {
      setSearchParams("tab=risk");
      render(<AllocationsTabs {...STUB_PROPS} />);
      // No anchor ever exists in this render.
      const anchor = document.getElementById("risk") as HTMLElement;
      anchor.id = "risk-never-mounted";
      expect(() => flushFrames(500)).not.toThrow();
      expect(rafRequests).toBe(120);
      expect(rafQueue.size).toBe(0);
      expect(scrollIntoView).not.toHaveBeenCalled();
      // The budget is spent: an anchor that shows up later does not scroll.
      anchor.id = "risk";
      flushFrames(5);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("cancels the pending frame on unmount", () => {
      setSearchParams("tab=risk");
      const { unmount } = render(<AllocationsTabs {...STUB_PROPS} />);
      expect(rafQueue.size).toBe(1);
      unmount();
      expect(cancelSpy).toHaveBeenCalled();
      expect(rafQueue.size).toBe(0);
      flushFrames(5);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    // WHY: a user who clicks to another tab before the scroll fires must not be
    // yanked to a section on a tab they already left.
    it("a tab change before the scroll cancels it", () => {
      setSearchParams("tab=risk");
      const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
      setSearchParams("tab=scenario");
      rerender(<AllocationsTabs {...STUB_PROPS} />);
      flushFrames(5);
      expect(scrollIntoView).not.toHaveBeenCalled();
      // And it does not fire later when the user returns to Overview.
      setSearchParams("");
      rerender(<AllocationsTabs {...STUB_PROPS} />);
      flushFrames(5);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("a plain ?tab=holdings or no tab never scrolls", () => {
      setSearchParams("tab=holdings");
      render(<AllocationsTabs {...STUB_PROPS} />);
      flushFrames(5);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  // WHY: the Sidebar's Risk item links /allocations?tab=risk. Clicked while the
  // user is already on /allocations, that is a soft navigation (searchParams
  // change), not a first mount, and it must still land on the Risk section.
  it("a soft navigation from ?tab=holdings to ?tab=risk lands on Overview, rewrites the URL and scrolls", async () => {
    setSearchParams("tab=holdings");
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    await screen.findByTestId("holdings-body");
    mockHistoryReplace.mockClear();
    flushFrames(5);
    expect(scrollIntoView).not.toHaveBeenCalled();

    setSearchParams("tab=risk");
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    expectOnlyVisibleBody("overview-v2");
    expect(historyUrls()).toEqual(["/allocations"]);
    flushFrames(5);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.contexts[0] as HTMLElement).id).toBe("risk");
  });

  describe("invalid_tab_fallback breadcrumb", () => {
    function breadcrumbs(spy: MockInstance<Console["warn"]>) {
      return spy.mock.calls.filter(
        (c) =>
          typeof c[0] === "string" && c[0].includes("invalid_tab_fallback"),
      );
    }

    it("?tab=nonsense falls back to Overview and logs the breadcrumb", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      setSearchParams("tab=nonsense");
      render(<AllocationsTabs {...STUB_PROPS} />);
      expectOnlyVisibleBody("overview-v2");
      const found = breadcrumbs(warnSpy);
      // parseTab runs on every render, so the breadcrumb may repeat; what is
      // pinned is that it fires and names the raw value.
      expect(found.length).toBeGreaterThan(0);
      expect(found[0][1]).toEqual({ raw: "nonsense" });
    });

    for (const legacy of ["outcomes", "risk", "mandate"] as const) {
      it(`?tab=${legacy} (a retired tab) does NOT log the breadcrumb`, () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        setSearchParams(`tab=${legacy}`);
        render(<AllocationsTabs {...STUB_PROPS} />);
        expect(breadcrumbs(warnSpy)).toHaveLength(0);
      });
    }
  });
});
