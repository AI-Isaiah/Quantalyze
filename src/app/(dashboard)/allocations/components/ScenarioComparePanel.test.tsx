/**
 * Phase 23 Plan 05 / Task 2 — RED tests for ScenarioComparePanel.
 *
 * The in-tab compare panel (PERSIST-04): given selected rows (each with its
 * persisted draft) + an includeLiveBook flag + the live payload, it computes
 * one ComputedMetrics per selection via computeMetricsForDraft and the live-book
 * column via computeMetricsForDraft(buildLiveBookDraft(...)), then mounts
 * ScenarioCompareTable.
 *
 * Honesty invariants pinned here:
 *   - The live-book column is present and labeled "Live book" when included.
 *   - With < 2 columns the under-selection hint shows — no fabricated table.
 *   - A degenerate draft (codec reset OR null engine metrics) reaches the table
 *     as NULL metrics → em-dash; the panel never coerces to 0 (no `?? 0`).
 *   - The live payload is reused — no second fetch is issued.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ComputedMetrics } from "@/lib/scenario";
import type { ScenarioDraft } from "../lib/scenario-state";
import type {
  ScenarioCompareInputs,
} from "../lib/scenario-compare";

// --- Mock the compute engine so wiring is deterministic --------------------
// (The real engine path is covered by scenario-compare.test.ts; here we assert
//  the panel calls it once per selection + the live book and threads null
//  metrics through to the table without coercion.)
const mockComputeMetricsForDraft = vi.fn();
const mockBuildLiveBookDraft = vi.fn();

vi.mock("../lib/scenario-compare", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/scenario-compare")>();
  return {
    ...actual,
    computeMetricsForDraft: (draft: ScenarioDraft, inputs: ScenarioCompareInputs) =>
      mockComputeMetricsForDraft(draft, inputs),
    buildLiveBookDraft: () => mockBuildLiveBookDraft(),
  };
});

import { ScenarioComparePanel } from "./ScenarioComparePanel";
import type { ScenarioComparePanelProps } from "./ScenarioComparePanel";
import type { SavedScenarioListRow } from "./SavedScenariosList";

function metrics(partial: Partial<ComputedMetrics>): ComputedMetrics {
  return {
    n: 120,
    twr: 0.2,
    cagr: 0.18,
    volatility: 0.1,
    sharpe: 1.5,
    sortino: 2.0,
    max_drawdown: -0.05,
    max_dd_days: 10,
    correlation_matrix: null,
    avg_pairwise_correlation: null,
    equity_curve: [],
    effective_start: null,
    effective_end: null,
    ...partial,
  };
}

const nullMetrics: ComputedMetrics = {
  n: 0,
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
  effective_start: null,
  effective_end: null,
};

// A current-schema (v2) draft JSONB so the codec decodes "ok".
function v2Draft(fingerprint: string): unknown {
  return {
    schema_version: 2,
    init_holdings_fingerprint: fingerprint,
    toggleByScopeRef: {},
    addedStrategies: [],
    weightOverrides: {},
    lastEditedAt: "2026-06-01T00:00:00.000Z",
  };
}

function row(
  id: string,
  name: string,
  draft: unknown,
): SavedScenarioListRow {
  return {
    id,
    name,
    schema_version: 2,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    draft,
  };
}

const PAYLOAD: ScenarioComparePanelProps["payload"] = {
  holdingsSummary: [
    { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  ],
  strategies: [],
  holdingReturnsByScopeRef: {
    "holding:binance:BTC:spot": [
      { date: "2026-01-01", value: 0.001 },
    ],
  },
} as unknown as ScenarioComparePanelProps["payload"];

describe("ScenarioComparePanel (Plan 23-05 Task 2)", () => {
  beforeEach(() => {
    mockComputeMetricsForDraft.mockReset();
    mockBuildLiveBookDraft.mockReset();
    mockBuildLiveBookDraft.mockReturnValue({
      schema_version: 2,
      init_holdings_fingerprint: "live-book",
      toggleByScopeRef: {},
      addedStrategies: [],
      weightOverrides: {},
      lastEditedAt: "1970-01-01T00:00:00.000Z",
    } satisfies ScenarioDraft);
    // No real fetch is used; assert none is issued.
    vi.stubGlobal("fetch", vi.fn());
  });

  // -------------------------------------------------------------------------
  // T_CP1 — Two selections compute via the engine path and render the table.
  // -------------------------------------------------------------------------
  it("T_CP1 computes each selection via computeMetricsForDraft and mounts the compare table", () => {
    mockComputeMetricsForDraft
      .mockReturnValueOnce(metrics({ sharpe: 1.0 }))
      .mockReturnValueOnce(metrics({ sharpe: 2.5 }));

    render(
      <ScenarioComparePanel
        selectedRows={[
          row("a", "Alpha", v2Draft("fp-a")),
          row("b", "Beta", v2Draft("fp-b")),
        ]}
        includeLiveBook={false}
        payload={PAYLOAD}
      />,
    );

    // One compute call per selection (no live book in this case).
    expect(mockComputeMetricsForDraft).toHaveBeenCalledTimes(2);
    // Columns render under their names.
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // The Sharpe leader callout names the higher-Sharpe column (Beta).
    expect(screen.getByTestId("sharpe-leader")).toHaveTextContent("Beta");
    // No second fetch issued — the live payload is reused.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T_CP2 — Live book column is present + labeled, computed via the synthetic
  //         all-on draft.
  // -------------------------------------------------------------------------
  it("T_CP2 includes a 'Live book' column computed via buildLiveBookDraft", () => {
    mockComputeMetricsForDraft.mockReturnValue(metrics({}));

    render(
      <ScenarioComparePanel
        selectedRows={[row("a", "Alpha", v2Draft("fp-a"))]}
        includeLiveBook={true}
        payload={PAYLOAD}
      />,
    );

    // The synthetic live-book draft was built + run through the engine path.
    expect(mockBuildLiveBookDraft).toHaveBeenCalledTimes(1);
    // 1 selection + the live book = 2 compute calls.
    expect(mockComputeMetricsForDraft).toHaveBeenCalledTimes(2);
    // The live-book column header is labeled "Live book".
    expect(screen.getByText("Live book")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_CP3 — < 2 columns → under-selection hint, no fabricated table.
  // -------------------------------------------------------------------------
  it("T_CP3 with fewer than 2 columns renders the under-selection hint (no table)", () => {
    mockComputeMetricsForDraft.mockReturnValue(metrics({}));

    render(
      <ScenarioComparePanel
        selectedRows={[row("a", "Alpha", v2Draft("fp-a"))]}
        includeLiveBook={false}
        payload={PAYLOAD}
      />,
    );

    expect(
      screen.getByText(
        "Select 2 or more scenarios (or the live book) to compare.",
      ),
    ).toBeInTheDocument();
    // No metric rows fabricated.
    expect(screen.queryByText("Cumulative Return")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_CP4 — A degenerate column reaches the table as NULL metrics (em-dash),
  //         never 0. The panel does not coerce.
  // -------------------------------------------------------------------------
  it("T_CP4 a degenerate selection flows to the table as null metrics (em-dash, not 0)", () => {
    mockComputeMetricsForDraft
      .mockReturnValueOnce(metrics({ twr: 0.2 })) // healthy column
      .mockReturnValueOnce(nullMetrics); // degenerate column → all em-dash

    render(
      <ScenarioComparePanel
        selectedRows={[
          row("a", "Alpha", v2Draft("fp-a")),
          row("b", "Degenerate", v2Draft("fp-b")),
        ]}
        includeLiveBook={false}
        payload={PAYLOAD}
      />,
    );

    // The degenerate column's cells render em-dash, not a fabricated 0.
    const twrCell = screen.getByTestId("cell-Degenerate-twr");
    expect(twrCell).toHaveTextContent("—");
    expect(twrCell.textContent).not.toMatch(/0\.00/);
    expect(twrCell.textContent).not.toMatch(/\bN\/A\b/);
    expect(twrCell.textContent).not.toBe("0");
  });

  // -------------------------------------------------------------------------
  // T_CP5 — An older-format (codec "reset") draft surfaces as a null-metrics
  //         column (honest em-dash) — the panel decodes through the codec,
  //         never a bare cast, and never silently drops the column to 0.
  // -------------------------------------------------------------------------
  it("T_CP5 an older-format draft decodes to a null-metrics column (em-dash), not a fabricated value", () => {
    mockComputeMetricsForDraft.mockReturnValue(metrics({ twr: 0.2 }));

    // A schema_version=1 blob → codec "reset" → the panel must NOT call the
    // engine for it (cannot compute an older format) and must render em-dash.
    const olderDraft = { schema_version: 1, foo: "bar" };

    render(
      <ScenarioComparePanel
        selectedRows={[
          row("a", "Alpha", v2Draft("fp-a")),
          row("b", "Old format", olderDraft),
        ]}
        includeLiveBook={false}
        payload={PAYLOAD}
      />,
    );

    // The engine ran only for the ok (v2) column, never for the reset column.
    expect(mockComputeMetricsForDraft).toHaveBeenCalledTimes(1);
    // The older-format column renders em-dash across its cells.
    const cell = screen.getByTestId("cell-Old format-sharpe");
    expect(cell).toHaveTextContent("—");
    expect(cell.textContent).not.toBe("0");
    // FIX 6: the reset column's footer carries the DISTINCT older-format stamp,
    // not the sample-floor "0 overlapping days" copy.
    const stamp = screen.getByTestId("stamp-Old format");
    expect(stamp).toHaveTextContent("Saved in an older format — can't be compared");
    expect(stamp.textContent).not.toMatch(/overlapping days/);
  });

  // -------------------------------------------------------------------------
  // T_CP6 — The compute engine receives a derived ScenarioCompareInputs built
  //         from the payload (no second fetch path).
  // -------------------------------------------------------------------------
  it("T_CP6 derives ScenarioCompareInputs from the payload and passes it to the engine", () => {
    mockComputeMetricsForDraft.mockReturnValue(metrics({}));

    render(
      <ScenarioComparePanel
        selectedRows={[
          row("a", "Alpha", v2Draft("fp-a")),
          row("b", "Beta", v2Draft("fp-b")),
        ]}
        includeLiveBook={false}
        payload={PAYLOAD}
      />,
    );

    const inputs = mockComputeMetricsForDraft.mock
      .calls[0][1] as ScenarioCompareInputs;
    expect(inputs.holdingsSummary).toEqual(PAYLOAD.holdingsSummary);
    expect(inputs.holdingReturnsByScopeRef).toEqual(
      PAYLOAD.holdingReturnsByScopeRef,
    );
    // symbolByHoldingId is a Map keyed by the holding ref.
    expect(inputs.symbolByHoldingId).toBeInstanceOf(Map);
    expect(inputs.symbolByHoldingId.size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // T_CP7 — A THROWING compute for one column does NOT crash the tab: that
  //         column falls back to a NULL-metrics ("—") column and the others
  //         still render. The panel is mounted outside an error boundary, so an
  //         unguarded synchronous throw in render would blank the whole tab.
  // -------------------------------------------------------------------------
  it("T_CP7 a throwing column falls back to an em-dash column; the panel still renders", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockComputeMetricsForDraft
      .mockReturnValueOnce(metrics({ twr: 0.2, sharpe: 1.0 })) // healthy column
      .mockImplementationOnce(() => {
        throw new Error("engine boom");
      }); // throwing column

    // Rendering must NOT throw (no crash propagated out of the panel).
    expect(() =>
      render(
        <ScenarioComparePanel
          selectedRows={[
            row("a", "Alpha", v2Draft("fp-a")),
            row("b", "Boom", v2Draft("fp-b")),
          ]}
          includeLiveBook={false}
          payload={PAYLOAD}
        />,
      ),
    ).not.toThrow();

    // The healthy column still renders its real value.
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByTestId("cell-Alpha-twr")).not.toHaveTextContent("—");

    // The throwing column degraded to honest absence (em-dash), not a crash
    // and not a fabricated 0.
    expect(screen.getByText("Boom")).toBeInTheDocument();
    const boomCell = screen.getByTestId("cell-Boom-sharpe");
    expect(boomCell).toHaveTextContent("—");
    expect(boomCell.textContent).not.toBe("0");

    // A breadcrumb was logged for the failed column.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("scenario_compare_compute_failed"),
      expect.objectContaining({ id: "b" }),
    );
    warnSpy.mockRestore();
  });
});
