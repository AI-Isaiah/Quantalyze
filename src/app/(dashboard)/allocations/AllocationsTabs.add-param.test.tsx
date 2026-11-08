/**
 * Phase 198 D-07 — `/allocations?add=<strategyId>` opens the add-allocation flow
 * (AllocationsTabs.tsx).
 *
 * WHY this file exists: Phase 196's factsheet "Add to my allocation" links to
 * this URL, so its behaviour is a contract other pages depend on, and a reload
 * must never reopen the flow (research C8). This pins:
 *   - the param opens the flow with the raw value, over whatever tab is active,
 *     and the param leaves the URL when the flow opens (so a reload or a copied
 *     address bar never replays it);
 *   - `?add=` with no value opens the flow with no deep link;
 *   - it combines with `tab`, including the retired aliases: neither URL write
 *     may bring back a param the other removed (both build from the LIVE URL,
 *     not the render's searchParams snapshot);
 *   - the first render (before effects) has the flow closed, so the server
 *     render and hydration agree (RESEARCH P4);
 *   - a re-render after the strip neither closes nor reopens the flow, and a soft
 *     navigation to another id while mounted opens the flow for that id;
 *   - a flow-reported invalid id leaves one breadcrumb;
 *   - the URL alone never writes anything.
 *
 * The URL is real here: `window.history.replaceState` is spied on with a
 * call-through, and `useSearchParams` reads the live `window.location.search`
 * (identity changes only when the URL does, as in Next). The flow, the panels and
 * the composer are mocked: this asserts the host's wiring only.
 *
 * Local runs: touched allocations tests flake under parallelism, so run with
 * `--no-file-parallelism`.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReadonlyURLSearchParams } from "next/navigation";

// --- next/navigation mocks -------------------------------------------------

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", async () => {
  return {
    useSearchParams: vi.fn(),
    useRouter: vi.fn(),
    usePathname: vi.fn(() => "/allocations"),
  };
});

import { useSearchParams, useRouter } from "next/navigation";

// --- Shared capture state for the flow stub --------------------------------
const harness = vi.hoisted(() => ({
  // The last props the flow stub received, and how many renders had it open.
  last: null as null | {
    open: boolean;
    deepLink: { raw: string } | null;
    onClose: () => void;
    onInvalidDeepLink?: (reason: "malformed" | "unlisted" | "unlisted_truncated") => void;
  },
}));

vi.mock("./AllocationDashboardV2", () => ({
  AllocationDashboardV2: () => (
    <div data-testid="overview-v2">OVERVIEW_V2_BODY</div>
  ),
}));

vi.mock("./HoldingsTabPanel", () => ({
  HoldingsTabPanel: () => <div data-testid="holdings-body">HOLDINGS_BODY</div>,
}));

vi.mock("./ScenarioStub", () => ({
  ScenarioStub: () => <div data-testid="scenario-stub-body">STUB</div>,
}));

vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: () => <div data-testid="scenario-composer-body">C</div>,
}));

vi.mock("./components/SavedScenariosList", () => ({
  SavedScenariosList: () => <div data-testid="saved-list">LIST</div>,
}));

vi.mock("./components/ScenarioComparePanel", () => ({
  ScenarioComparePanel: () => <div data-testid="compare-panel">P</div>,
}));

vi.mock("./components/AddAllocationFlow", () => ({
  AddAllocationFlow: (props: {
    open: boolean;
    deepLink: { raw: string } | null;
    onClose: () => void;
    onInvalidDeepLink?: (
      reason: "malformed" | "unlisted" | "unlisted_truncated",
    ) => void;
  }) => {
    harness.last = props;
    if (!props.open) return null;
    return (
      <div
        role="dialog"
        aria-label="Add allocation"
        data-deep-link={props.deepLink ? props.deepLink.raw : "none"}
      >
        <button type="button" data-testid="flow-close" onClick={props.onClose}>
          close
        </button>
        {(["malformed", "unlisted", "unlisted_truncated"] as const).map((r) => (
          <button
            key={r}
            type="button"
            data-testid={`flow-invalid-${r}`}
            onClick={() => props.onInvalidDeepLink?.(r)}
          >
            {r}
          </button>
        ))}
      </div>
    );
  },
}));

// --- Imports after mocks ---------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EMPTY_EXPOSURE, type ExposureSectionData } from "./lib/exposure-props";

const ALLOCATOR_ID = "00000000-1111-2222-3333-444444444444";
const STRATEGY_A = "11111111-1111-4111-8111-111111111111";
const STRATEGY_B = "22222222-2222-4222-8222-222222222222";

// Only the fields the shell reads matter here; the panels are mocked.
const STUB_PROPS = {
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
  equityHistoryState: "rebuilding",
  equityDailyReturns: [],
  equityHistoryRebuildReason: null,
  derivedCurveComputedAt: null,
  activeVenues: [],
  hasConnectedKeys: false,
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  mandate: null,
  allocator_id: ALLOCATOR_ID,
  liveBaselineMetrics: null,
  perKeyReturnsByApiKeyId: {},
  perKeyDailiesGateSatisfied: false,
  eligibleApiKeyIds: [],
  allocatorEligibleApiKeyIds: [],
  contributingApiKeyIds: [],
  bookEntryGateSatisfied: false,
  apiKeysCount: 1,
  mandateIsSet: false,
} as unknown as MyAllocationDashboardPayload & {
  exposure: ExposureSectionData;
};

// --- The live URL ----------------------------------------------------------

const realReplaceState = window.history.replaceState.bind(window.history);
let replaceSpy: MockInstance<History["replaceState"]>;

/** Put the browser on `/allocations{query}` without going through the spy. */
function setUrl(query: string): void {
  realReplaceState(null, "", `/allocations${query}`);
}

/** The URL argument of every replaceState call the component made. */
function writes(): string[] {
  return replaceSpy.mock.calls.map((c) => String(c[2]));
}

/**
 * The invariant behind "neither write may bring back a param the other removed":
 * once a write drops `param`, no LATER write puts it back. Order-independent, so
 * it holds whichever of the two cleanups runs first. (A final-URL check alone
 * cannot see a transient resurrection: Next re-renders after a write, and the
 * alias cleanup would then fix the URL up again.)
 */
function resurrected(urls: string[], params: string[]): string[] {
  const out: string[] = [];
  for (const param of params) {
    let dropped = false;
    for (const u of urls) {
      const has = new URLSearchParams(u.split("?")[1] ?? "").has(param);
      if (!has) dropped = true;
      else if (dropped) out.push(`${param} came back in ${u}`);
    }
  }
  return out;
}

const searchParamsByQuery = new Map<string, URLSearchParams>();
function installLiveSearchParams(): void {
  // Identity changes only when the query string does, as in Next. A fresh object
  // per call would re-run every searchParams effect on every render.
  vi.mocked(useSearchParams).mockImplementation(() => {
    const q = window.location.search;
    let sp = searchParamsByQuery.get(q);
    if (!sp) {
      sp = new URLSearchParams(q);
      searchParamsByQuery.set(q, sp);
    }
    return sp as unknown as ReadonlyURLSearchParams;
  });
}

function dialog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Add allocation" });
}

describe("AllocationsTabs — /allocations?add=<strategyId> (Phase 198 D-07, C8, P4)", () => {
  beforeEach(() => {
    harness.last = null;
    searchParamsByQuery.clear();
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
      refresh: mockRefresh,
      push: mockPush,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    installLiveSearchParams();
    replaceSpy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation((...args) => realReplaceState(...args));
  });

  afterEach(() => {
    replaceSpy.mockRestore();
    realReplaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("?add=<uuid>: the flow opens with the raw id over the Overview, and add leaves the URL", () => {
    setUrl(`?add=${STRATEGY_A}`);
    render(<AllocationsTabs {...STUB_PROPS} />);

    expect(dialog()).not.toBeNull();
    expect(harness.last?.deepLink).toEqual({ raw: STRATEGY_A });
    expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
    // WHY (C8): the strip is what makes a reload or a copied URL safe.
    expect(writes().some((u) => u.includes("add="))).toBe(false);
    expect(window.location.search).toBe("");
    // The router is never used for the strip (no RSC refetch).
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("?add= (empty): the flow opens with no deep link and add leaves the URL", () => {
    setUrl("?add=");
    render(<AllocationsTabs {...STUB_PROPS} />);

    expect(dialog()).not.toBeNull();
    expect(harness.last?.deepLink).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("no add param: the flow stays closed and nothing is written", () => {
    setUrl("");
    render(<AllocationsTabs {...STUB_PROPS} />);
    expect(dialog()).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("?tab=holdings&add=<uuid>: Holdings stays active, the flow opens, the URL keeps ?tab=holdings", async () => {
    setUrl(`?tab=holdings&add=${STRATEGY_A}`);
    render(<AllocationsTabs {...STUB_PROPS} />);

    expect(dialog()).not.toBeNull();
    expect(harness.last?.deepLink).toEqual({ raw: STRATEGY_A });
    await screen.findByTestId("holdings-body");
    expect(window.location.search).toBe("?tab=holdings");
  });

  for (const legacy of ["risk", "mandate"] as const) {
    it(`?tab=${legacy}&add=<uuid>: Overview, the flow open, and NEITHER param left (whatever order the two cleanups run in)`, () => {
      // WHY: both cleanups write the URL. If either built its write from the
      // render's searchParams snapshot, the later write would put back the param
      // the earlier one removed.
      setUrl(`?tab=${legacy}&add=${STRATEGY_A}`);
      render(<AllocationsTabs {...STUB_PROPS} />);

      expect(dialog()).not.toBeNull();
      expect(screen.getByTestId("overview-v2")).toBeInTheDocument();
      expect(window.location.search).toBe("");
      expect(window.location.pathname).toBe("/allocations");
      expect(resurrected(writes(), ["tab", "add"])).toEqual([]);
    });
  }

  it("?tab=outcomes&add=<uuid>: Holdings, the flow open, and the URL is ?tab=holdings", async () => {
    setUrl(`?tab=outcomes&add=${STRATEGY_A}`);
    render(<AllocationsTabs {...STUB_PROPS} />);

    expect(dialog()).not.toBeNull();
    await screen.findByTestId("holdings-body");
    expect(window.location.search).toBe("?tab=holdings");
    // The alias becomes ?tab=holdings, and the strip must not write the old
    // value back from a stale snapshot.
    expect(writes().some((u) => u.includes("tab=outcomes"))).toBe(false);
    expect(resurrected(writes(), ["add"])).toEqual([]);
  });

  it("the first render, before any effect, has the flow closed (server render and hydration agree)", () => {
    // WHY (P4): reading the param in a useState initializer would open the flow
    // on the client's first render while the server rendered it closed.
    setUrl(`?add=${STRATEGY_A}`);
    renderToString(<AllocationsTabs {...STUB_PROPS} />);
    expect(harness.last?.open).toBe(false);
    expect(harness.last?.deepLink).toBeNull();
  });

  it("after the strip, a re-render with no add neither closes the open flow nor reopens a closed one", () => {
    setUrl(`?add=${STRATEGY_A}`);
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(dialog()).not.toBeNull();

    // The URL no longer carries add, as Next would now report.
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    expect(dialog()).not.toBeNull();

    fireEvent.click(screen.getByTestId("flow-close"));
    expect(dialog()).toBeNull();
    rerender(<AllocationsTabs {...STUB_PROPS} />);
    expect(dialog()).toBeNull();
  });

  it("a soft navigation to ?add=<other uuid> while mounted opens the flow for that id", () => {
    setUrl(`?add=${STRATEGY_A}`);
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    fireEvent.click(screen.getByTestId("flow-close"));
    expect(dialog()).toBeNull();

    setUrl(`?add=${STRATEGY_B}`);
    rerender(<AllocationsTabs {...STUB_PROPS} />);

    expect(dialog()).not.toBeNull();
    expect(harness.last?.deepLink).toEqual({ raw: STRATEGY_B });
    expect(window.location.search).toBe("");
  });

  it("a soft navigation to another id while the flow is still open re-points it at the new id", () => {
    setUrl(`?add=${STRATEGY_A}`);
    const { rerender } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(dialog()?.getAttribute("data-deep-link")).toBe(STRATEGY_A);

    setUrl(`?add=${STRATEGY_B}`);
    rerender(<AllocationsTabs {...STUB_PROPS} />);

    expect(dialog()?.getAttribute("data-deep-link")).toBe(STRATEGY_B);
  });

  for (const reason of ["malformed", "unlisted", "unlisted_truncated"] as const) {
    it(`the flow reporting '${reason}' leaves exactly one invalid_add_param breadcrumb`, () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      setUrl("?add=not-a-uuid");
      render(<AllocationsTabs {...STUB_PROPS} />);

      act(() => {
        fireEvent.click(screen.getByTestId(`flow-invalid-${reason}`));
      });

      const hits = warnSpy.mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("[AllocationsTabs]") &&
          c[0].includes("invalid_add_param"),
      );
      expect(hits).toHaveLength(1);
      expect(hits[0][1]).toEqual({ reason });
      warnSpy.mockRestore();
    });
  }

  it("the URL alone never writes: no fetch, no router navigation, no refresh", () => {
    // WHY (ROUTE-06 prohibition): a deep link only opens and pre-fills the flow.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setUrl(`?add=${STRATEGY_A}`);
    render(<AllocationsTabs {...STUB_PROPS} />);

    expect(dialog()).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
