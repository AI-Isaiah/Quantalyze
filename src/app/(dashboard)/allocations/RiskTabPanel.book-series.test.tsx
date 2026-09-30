import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";

import { RiskTabPanel } from "./RiskTabPanel";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { computeVaR } from "@/lib/portfolio-stats";
import { formatPercent } from "@/lib/utils";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
// ResponsiveContainer measures 0×0 in jsdom and draws nothing; sized here so
// the decomposition's bars are observable (HoldingsTabPanel.exposure idiom).
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 400, height: 300 }),
  };
});

// ---------------------------------------------------------------------------
// Phase 169.4-01 (SC2) — the Risk tab reads the same book the Overview reads.
//
// Why this matters: the Overview charts the book's own daily returns
// (`equityDailyReturns`) and, while the history is being rebuilt, shows the
// rebuilding panel and no figure at all (167.1.2 D-02). The Risk tab used to
// hand every widget the raw payload, so VaR / tail / regime computed from the
// legacy portfolio-strategies set. On a key-connected book that set is empty,
// and the tab said "Insufficient return data" beside an Overview showing the
// book. While rebuilding, it computed figures over a history the Overview had
// withheld as untrustworthy (T-169-25).
// ---------------------------------------------------------------------------

afterEach(cleanup);

// 60 book daily returns with real dispersion (VaR shows "insufficient" on fewer
// than 10 points or an all-zero result).
const bookReturns = Array.from({ length: 60 }, (_, i) => ({
  date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`,
  value: (((i * 37) % 23) - 11) / 1000,
}));

function payload(
  over: Partial<Record<string, unknown>> = {},
): MyAllocationDashboardPayload {
  return {
    strategies: [], // the legacy set: EMPTY for a key-connected book
    analytics: null,
    apiKeys: [],
    holdingsSummary: [],
    perKeyReturnsByApiKeyId: {},
    contributingApiKeyIds: [],
    equityHistoryState: "ready",
    equityHistoryRebuildReason: null,
    equityHistoryNotSyncingKeyIds: [],
    equityDailyReturns: bookReturns,
    ...over,
  } as unknown as MyAllocationDashboardPayload;
}

describe("RiskTabPanel — the book series (SC2)", () => {
  it("ready, empty legacy strategies: VaR renders a value computed from the book's 60 daily returns", async () => {
    render(<RiskTabPanel {...payload()} />);

    const widget = await screen.findByTestId("var-expected-shortfall");
    const expected95 = formatPercent(
      computeVaR(
        bookReturns.map((d) => d.value),
        0.95,
      ),
    );
    expect(widget.textContent).toContain(expected95);
    expect(
      screen.queryByText("Insufficient return data for VaR calculation"),
    ).toBeNull();
  });

  it("rebuilding: the Overview's rebuilding panel renders with its reason, and NO risk widget", () => {
    render(
      <RiskTabPanel
        {...payload({
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: "awaiting_derivation",
          equityDailyReturns: [],
        })}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Your equity history is being rebuilt",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your history is recomputed from each account's returns and cash flows once a day.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(document.querySelectorAll("[data-widget-id]")).toHaveLength(0);
    expect(
      screen.queryByText("Insufficient return data for VaR calculation"),
    ).toBeNull();
  });

  it("fail-closed: a missing state reads as rebuilding, as on the Overview", () => {
    render(<RiskTabPanel {...payload({ equityHistoryState: undefined })} />);
    expect(screen.getByTestId("overview-equity-rebuilding")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-widget-id]")).toHaveLength(0);
  });
});

describe("RiskTabPanel — decomposition and correlation over the Scenario's per-key set (SC2)", () => {
  const keyA = "key-aaaa-1111";
  const keyB = "key-bbbb-2222";
  const perKey = (seed: number) =>
    bookReturns.map((d, i) => ({ date: d.date, value: (((i * seed) % 11) - 5) / 1000 }));

  function twoKeyBook() {
    return payload({
      // The legacy set carries a row the per-key widgets must NOT show.
      strategies: [
        {
          strategy_id: "legacy-1",
          alias: "Legacy",
          current_weight: 1,
          strategy: { id: "legacy-1", strategy_analytics: { daily_returns: bookReturns } },
        },
      ],
      apiKeys: [
        { id: keyA, exchange: "binance", label: "Main" },
        { id: keyB, exchange: "binance", label: "Hedge" },
      ],
      perKeyReturnsByApiKeyId: { [keyA]: perKey(3), [keyB]: perKey(7) },
      contributingApiKeyIds: [keyA, keyB],
    });
  }

  it("the correlation matrix names the two keys the way the Scenario does, in full", async () => {
    render(<RiskTabPanel {...twoKeyBook()} />);
    const matrix = await screen.findByTestId("correlation-matrix");
    const headers = [...matrix.querySelectorAll("thead th[title]")].map((th) =>
      th.getAttribute("title"),
    );
    expect(headers).toEqual(["Binance — Main", "Binance — Hedge"]);
    expect(within(matrix).queryByText("Legacy")).toBeNull();
    expect(matrix.textContent).not.toContain(keyA);
  });

  it("the risk decomposition has one row per key", async () => {
    render(<RiskTabPanel {...twoKeyBook()} />);
    const decomposition = await screen.findByTestId("risk-decomposition");
    expect(decomposition.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
    const ticks = [
      ...decomposition.querySelectorAll(".recharts-cartesian-axis-tick-value"),
    ].map((t) => t.textContent);
    expect(ticks).toContain("Binance — Main");
    expect(ticks).toContain("Binance — Hedge");
    expect(ticks).not.toContain("Legacy");
  });
});
