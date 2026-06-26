import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type {
  PeerPercentilePayload,
  ScenarioMandatePayload,
  OwnBookDeltaPayload,
} from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * BODY-03 / BODY-04 (Phase 40) — the REAL FactsheetBody renders safely across
 * the full degenerate blend matrix, and the api-only synthetic panels stay
 * absent on the csv blend by construction.
 *
 * This is the render-level coverage of the real body subtree (the
 * AllocationDashboardV2 tests MOCK FactsheetBody; the BODY-02 test uses a single
 * healthy payload). It exercises the composer mount shape (scenarioMode,
 * hideHeader, hideAllocatorSection, hideFooter={false}) against EVERY blend the
 * Phase-39 adapter can produce:
 *
 *   - safe-empty   : portfolioDaily = []        → every array [], scalars 0/null
 *   - single/sub-N : ~30 points (10 ≤ n < 252)  → populated, low-N caveats fire
 *   - healthy      : ~300 points                → fully populated
 *   - non-finite   : a series with a NaN value  → the adapter degenerate gate
 *                    collapses it to safe-empty BEFORE compute() — the body never
 *                    sees NaN/Inf (PAYLOAD-05)
 *
 * Dynamic-panel coverage (WR-01 fix). The two Heatmaps panels
 * (MonthlyReturnsHeatmap / DailyReturnsHeatmap) are loaded via
 * `next/dynamic(..., { ssr:false, loading: () => <PanelSkeleton/> })`
 * (FactsheetView.tsx). They are NOT api-gated and NOT behind LazyMount, so they
 * DO render on the csv blend — but the dynamic loader paints a `PanelSkeleton`
 * placeholder on first paint and only swaps in the REAL component once its async
 * `import()` settles. So each case here is async: it pre-imports the chunk
 * (beforeAll), renders once, then `await`s until the heatmaps section
 * (#factsheet-heatmaps) holds NO `.animate-pulse` skeleton — i.e. both dynamic
 * imports have resolved and the real MonthlyReturnsHeatmap / DailyReturnsHeatmap
 * functions have run. On the populated blends those functions render their
 * `<h3>Monthly Returns</h3>` / `<h3>Daily Returns Calendar</h3>` headings (asserted
 * below); on the empty/degenerate blends they hit their `rows.length === 0` /
 * `years.length === 0` early-return and render null (an honest empty state).
 *
 * NB (out of scope): the LazyMount-gated panels (SignaturesSection,
 * CrossSignaturesSection, AllocatorSection) stay UNMOUNTED — jsdom's
 * IntersectionObserver stub (src/test-setup.ts) never fires `isIntersecting`. But
 * all three are also api-gated (ingestSource === "api"), so they are
 * double-excluded on the csv blend and render nothing here regardless.
 *
 * Two load-bearing assertions per case, against ONE mounted tree:
 *   1. The real body MOUNTS without throwing — render() itself would reject if any
 *      panel threw on the empty/degenerate payload — AND the awaited dynamic
 *      heatmaps mount without throwing (every panel either early-returns on its
 *      empty array or formats non-finite to "—").
 *   2. The serialized container.innerHTML — NOW INCLUDING the resolved real
 *      heatmap DOM — contains NEITHER "NaN" NOR "Infinity" (the StreakHist
 *      barW=Infinity tripwire — unconsumed in the empty case — and a format-drift
 *      guard against any future regression).
 *
 * BODY-04 render-absence (csv blend): getElementById("factsheet-allocator") and
 * "factsheet-signatures" are null, and the PeerPercentile panel is absent — all
 * gated on ingestSource === "api", which the synth payload never is ("csv").
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount (even at persist={false}, the hook still
 * registers). Stub block copied verbatim from scenario-shared-window.test.tsx.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// Pre-resolve the dynamic Heatmaps chunk so next/dynamic's loader promise settles
// deterministically across EVERY blend — including the empty blend, where the
// resolved heatmap components render null (their length===0 guard) and leave no
// DOM heading to wait on. Without this the import resolution would be racy and the
// "skeleton gone" wait could pass before the real component function ever ran.
beforeAll(async () => {
  await import("./HeatmapPanels");
});

// Daily-RETURN series (decimal). The single adapter input — `dates`/equity/
// drawdowns/returns/panels all derive from this. UTC consecutive days.
function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// A series with one non-finite value — the adapter's degenerate gate collapses
// the ENTIRE payload to safe-empty BEFORE compute(), so the body never sees it.
function makeNonFiniteSeries(n = 120): DailyPoint[] {
  const pts = makeReturnsSeries(n);
  pts[Math.floor(n / 2)] = { ...pts[Math.floor(n / 2)], value: NaN };
  return pts;
}

type Blend = { name: string; portfolioDaily: DailyPoint[] };

const BLENDS: Blend[] = [
  { name: "safe-empty (portfolioDaily=[])", portfolioDaily: [] },
  { name: "single/sub-N (~30 points, 10 ≤ n < 252)", portfolioDaily: makeReturnsSeries(30) },
  { name: "healthy (~300 points)", portfolioDaily: makeReturnsSeries(300) },
  { name: "non-finite (NaN → collapsed to safe-empty)", portfolioDaily: makeNonFiniteSeries(120) },
];

// Mount shape mirrors the composer mount (Plan 40-02): scenarioMode, hideHeader,
// hideAllocatorSection, hideFooter={false}.
function renderBlend(portfolioDaily: DailyPoint[]) {
  const payload = buildScenarioFactsheetPayload({ portfolioDaily, benchmark: null });
  const result = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody
        payload={payload}
        scenarioMode
        hideHeader
        hideAllocatorSection
        hideFooter={false}
      />
    </FactsheetProvider>,
  );
  return { payload, ...result };
}

describe("FactsheetBody — degenerate render matrix (BODY-03)", () => {
  for (const blend of BLENDS) {
    it(`mounts the real body (incl. the dynamic heatmaps) and emits no NaN/Infinity on the ${blend.name} blend`, async () => {
      // The render itself is the no-throw assertion for the synchronous body — if
      // any panel threw on the empty/degenerate payload, render() would reject and
      // fail the test. ONE mounted tree carries both assertions below (no
      // double-render).
      const { payload, container } = renderBlend(blend.portfolioDaily);
      const heatmaps = container.querySelector("#factsheet-heatmaps");
      expect(heatmaps).not.toBeNull();

      // Flush the next/dynamic(ssr:false) loaders so the REAL MonthlyReturnsHeatmap
      // / DailyReturnsHeatmap mount (not just their PanelSkeleton). The skeleton
      // carries the `.animate-pulse` class and is the dynamic loader's `loading`
      // placeholder; once both imports resolve, every skeleton inside the heatmaps
      // section is replaced by the real component DOM (populated blend) or by null
      // (empty/degenerate blend, via the length===0 guard). Waiting for zero
      // skeletons proves both real heatmap functions actually RAN.
      await waitFor(() => {
        expect(heatmaps!.querySelectorAll(".animate-pulse").length).toBe(0);
      });

      // On the populated blends the real heatmaps render their section headings —
      // assert them so the awaited DOM is provably the REAL component, not an
      // empty section. (On the empty/degenerate blends both components hit their
      // length===0 early-return and render null, which is the honest empty state
      // — there is no heading to assert.)
      if (payload.monthlyReturns.length > 0) {
        expect(heatmaps!.textContent ?? "").toContain("Monthly Returns");
      }
      if (payload.dailyHeatmap.length > 0) {
        expect(heatmaps!.textContent ?? "").toContain("Daily Returns Calendar");
      }

      // Now re-read the fully-resolved tree (the real heatmap DOM is included).
      // The StreakHist barW=Infinity tripwire (unconsumed when maxLen=0) + a
      // format-drift guard: a non-finite value reaching any attribute would
      // serialize as "NaN"/"Infinity". The adapter's "—" formatting + each panel's
      // empty early-return must keep both substrings out of the DOM.
      const html = container.innerHTML;
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
    });
  }
});

describe("FactsheetBody — api-only panels absent on the csv blend (BODY-04)", () => {
  // Assert on the healthy AND safe-empty cases (where a crash is most/least
  // likely). The allocator / signatures / peer panels all gate on
  // ingestSource === "api"; the synth payload is "csv" by construction, so none
  // of them is ever rendered.
  for (const blend of [
    { name: "healthy", portfolioDaily: makeReturnsSeries(300) },
    { name: "safe-empty", portfolioDaily: [] as DailyPoint[] },
  ]) {
    it(`renders no allocator / signatures / peer panels on the ${blend.name} csv blend`, () => {
      const { payload, container } = renderBlend(blend.portfolioDaily);

      // By construction: the synth payload is always ingestSource "csv".
      expect(payload.ingestSource).toBe("csv");

      // Render-absence: the api-gated sections never mount on a csv blend.
      expect(document.getElementById("factsheet-allocator")).toBeNull();
      expect(document.getElementById("factsheet-signatures")).toBeNull();

      // The PeerPercentile panel (api-only, gated in MetricsColumn.tsx:121)
      // renders a "Peer Percentile" header; absent on csv. (A real strategy's
      // factsheet shows it; the blend never does.) NB: don't match the badge
      // copy "Demo cohort" — the shown footer disclaimer ("Demo cohorts and demo
      // portfolios are flagged inline") contains that phrase in static prose,
      // unrelated to the peer panel; the panel header is the precise signal.
      expect(container.textContent ?? "").not.toMatch(/Peer Percentile/i);
    });
  }
});

// ── Affirmative scenarioMode gate (code-review WR — Testing) ──────────
// GUARD-02 (byte-identity) + the degenerate matrix above prove the
// scenarioMode={false} path and the null-carve-out path. NEITHER exercises the
// AFFIRMATIVE branch: scenarioMode={true} WITH populated carve-outs, where the
// MetricsColumn gates must MOUNT the Peer / Own-Book / Mandate panels onto the
// REAL body. Without this, a regression that dropped the scenarioMode wiring or
// inverted a gate would let all three silently never render on the composer
// while CI stayed green (the isolated panel tests render each panel directly via
// context, bypassing the MetricsColumn gate entirely).
const SCENARIO_PEER: PeerPercentilePayload = {
  cohortSize: 42,
  sharpe: 71,
  sortino: 64,
  max_dd: 58,
};
const SCENARIO_MANDATE: ScenarioMandatePayload = {
  constituents: [
    { name: "Trend Alpha", strategy_types: ["trend-following"], markets: ["BTC", "ETH"], leverage: 2 },
  ],
};
const OWN_BOOK_DELTA: OwnBookDeltaPayload = {
  sharpe: 0.24,
  sortino: -0.18,
  max_dd: 0.018,
  blend_n: 287,
  book_n: 412,
};

// A healthy (n=300) csv blend payload carrying all three scenario carve-outs.
// The payload goes to BOTH the provider (panels read carve-outs from context)
// and the body prop (MetricsColumn reads the gate off the prop).
function renderWithCarveouts(scenarioMode: boolean) {
  const base = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  const payload = {
    ...base,
    scenarioPeer: SCENARIO_PEER,
    scenarioMandate: SCENARIO_MANDATE,
    scenarioOwnBookDelta: OWN_BOOK_DELTA,
  };
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody
        payload={payload}
        scenarioMode={scenarioMode}
        hideHeader
        hideAllocatorSection
        hideFooter={false}
      />
    </FactsheetProvider>,
  );
}

describe("FactsheetBody — affirmative scenarioMode gate mounts the carve-out panels (PEER-01/04/05 wiring)", () => {
  it("scenarioMode + populated carve-outs: Peer Percentile, Mandate constituent, and vs-Your-Book all render", () => {
    const text = renderWithCarveouts(true).container.textContent ?? "";
    expect(text).toMatch(/Peer Percentile/); // PEER-01 gate
    expect(text).toMatch(/Trend Alpha/); // PEER-04 mandate constituent chip
    expect(text).toMatch(/vs Your Book/); // PEER-05 own-book delta
  });

  it("scenarioMode=false with the SAME populated carve-outs: all three stay absent (the scenarioMode disjunct is load-bearing — falsifiable proof the gate isn't a no-op)", () => {
    const text = renderWithCarveouts(false).container.textContent ?? "";
    expect(text).not.toMatch(/Peer Percentile/);
    expect(text).not.toMatch(/Trend Alpha/);
    expect(text).not.toMatch(/vs Your Book/);
  });
});
