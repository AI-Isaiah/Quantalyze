import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * BODY-03 / BODY-04 (Phase 40) — the REAL FactsheetBody renders safely across
 * the full degenerate blend matrix, and the api-only synthetic panels stay
 * absent on the csv blend by construction.
 *
 * This is the only render-level coverage of the real body subtree (the
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
 * Two load-bearing assertions per case:
 *   1. The real body MOUNTS without throwing (every panel either early-returns on
 *      its empty array or formats non-finite to "—" — no panel needs a new guard;
 *      RESEARCH audited all ~24 panels).
 *   2. The serialized container.innerHTML contains NEITHER "NaN" NOR "Infinity"
 *      (the StreakHist barW=Infinity tripwire — unconsumed in the empty case — and
 *      a format-drift guard against any future regression).
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
    it(`mounts the real body without throwing on the ${blend.name} blend`, () => {
      // The render itself is the no-throw assertion — if any panel threw on the
      // empty/degenerate payload, render() would reject and fail the test.
      expect(() => renderBlend(blend.portfolioDaily)).not.toThrow();
    });

    it(`emits no "NaN" and no "Infinity" in the serialized SVG for the ${blend.name} blend`, () => {
      const { container } = renderBlend(blend.portfolioDaily);
      const html = container.innerHTML;
      // The StreakHist barW=Infinity tripwire (unconsumed when maxLen=0) + a
      // format-drift guard: a non-finite value reaching any attribute would
      // serialize as "NaN"/"Infinity". The adapter's "—" formatting + each
      // panel's empty early-return must keep both substrings out of the DOM.
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
