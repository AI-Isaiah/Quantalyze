import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload, PeerPercentilePayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { PeerPercentilePanel } from "./BatchDPanels";

/**
 * Phase 42 Plan 04 (PEER-02) — the PeerPercentilePanel scenario-path re-label +
 * hypothetical disclosure render contract.
 *
 * Three load-bearing proofs:
 *   1. SCENARIO path (csv + scenarioPeer): the header reads "Peer Percentile"
 *      with NO "Demo cohort" badge; the N={cohortSize} span + the 3 percentile
 *      bars render; the verbatim disclosure copy
 *      "hypothetical blend · ranked vs verified strategies · sample/252 basis"
 *      renders (plain 10px muted, NOT italic — the api footnote IS italic).
 *   2. API path (regression guard): the existing "Demo cohort" badge + the
 *      italic synthesized-cohort footnote are byte-unchanged.
 *   3. SUPPRESSION: csv with a null scenarioPeer → the panel renders nothing.
 *
 * FactsheetProvider's persistence primitive touches localStorage + sentry on
 * mount (even at persist={false}, the hooks still register), so both are stubbed.
 * Stub block mirrors FactsheetBody.scenario-mode.test.tsx.
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

/** Healthy full-resolution returns series so the csv payload is fully valid. */
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

const SCENARIO_PEER: PeerPercentilePayload = {
  cohortSize: 42,
  sharpe: 71,
  sortino: 64,
  max_dd: 58,
};

const DISCLOSURE = "hypothetical blend · ranked vs verified strategies · sample/252 basis";

/** A valid csv payload carrying the scenario peer carve-out. */
function csvPayload(scenarioPeer: PeerPercentilePayload | undefined): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
    ...(scenarioPeer ? { scenarioPeer } : {}),
  });
}

/**
 * A minimal api payload whose peerPercentile is set — exercises the demo-cohort
 * path. Built by flipping a csv payload to the api arm and attaching the four
 * api-only synthesized fields (the panel only reads peerPercentile + ingestSource).
 */
function apiPayload(peerPercentile: PeerPercentilePayload | null): FactsheetPayload {
  const base = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  // Strip the csv-only carve-out and attach the api-arm synthesized panels.
  const { scenarioPeer: _drop, ...common } = base;
  return {
    ...common,
    ingestSource: "api",
    peerPercentile,
    allocatorPortfolios: null,
    eventSignatures: null,
    benchEventSignatures: null,
  };
}

function renderPanel(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <PeerPercentilePanel />
    </FactsheetProvider>,
  );
}

describe("PeerPercentilePanel — scenario-path disclosure (PEER-02)", () => {
  it("scenario (csv + scenarioPeer): 'Peer Percentile' with NO Demo badge + N span + 3 bars + disclosure", () => {
    const { queryByText, getByText, container } = renderPanel(csvPayload(SCENARIO_PEER));

    // Header text present, but the Demo-cohort badge is gone on the scenario path.
    expect(getByText("Peer Percentile")).toBeTruthy();
    expect(queryByText(/Demo cohort/i)).toBeNull();

    // The cohort N span is retained verbatim.
    expect(getByText(`N=${SCENARIO_PEER.cohortSize}`)).toBeTruthy();

    // The three percentile bars render.
    expect(getByText("Sharpe")).toBeTruthy();
    expect(getByText("Sortino")).toBeTruthy();
    expect(getByText("Max DD (shallower = better)")).toBeTruthy();

    // The verbatim disclosure copy renders — plain muted micro-tier, NOT italic.
    // (Phase 52-06 / TYPE-04 migrated the raw `text-[10px]` onto the fluid
    // `--text-micro` tier; the PEER-02 plain-vs-italic distinction is preserved.)
    const disclosure = getByText(DISCLOSURE);
    expect(disclosure).toBeTruthy();
    expect(disclosure.className).toContain("text-micro");
    expect(disclosure.className).toContain("text-text-muted");
    expect(disclosure.className).not.toContain("italic");

    // The api/demo synthesized-cohort footnote is absent on the scenario path.
    expect(queryByText(/Synthesized peer cohort/i)).toBeNull();
    // No DOM leaked from a stale api branch.
    expect(container.querySelector("section")).toBeTruthy();
  });

  it("api path: 'Demo cohort' badge + italic synthesized-cohort footnote UNCHANGED (regression guard)", () => {
    const peer: PeerPercentilePayload = { cohortSize: 50, sharpe: 60, sortino: 55, max_dd: 48 };
    const { getByText, queryByText } = renderPanel(apiPayload(peer));

    // The demo badge + the italic footnote are exactly as before.
    expect(getByText(/Demo cohort/i)).toBeTruthy();
    const footnote = getByText(/Synthesized peer cohort/i);
    expect(footnote).toBeTruthy();
    expect(footnote.className).toContain("italic");

    // The scenario disclosure must NOT appear on the api path.
    expect(queryByText(DISCLOSURE)).toBeNull();
  });

  it("csv with a null scenarioPeer: the panel renders nothing (sample-floor / min-N suppression)", () => {
    const { container, queryByText } = renderPanel(csvPayload(undefined));
    // No header, no bars, no disclosure — honest absence.
    expect(container.querySelector("section")).toBeNull();
    expect(queryByText("Peer Percentile")).toBeNull();
    expect(queryByText(DISCLOSURE)).toBeNull();
  });
});
