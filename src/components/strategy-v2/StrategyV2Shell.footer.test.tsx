/**
 * Phase 170.5 (D-05, D-06) - composition test: getStrategyDetailV2's result
 * rendered through the REAL StrategyV2Shell with the REAL Disclaimer and
 * VerifiedBadge.
 *
 * WHY this file exists: StrategyV2Shell.test.tsx mocks Disclaimer and
 * VerifiedBadge, so a shell whose query never projected `trust_tier` still
 * passed - that is exactly how an API-verified strategy's footer called itself
 * self-reported. Mocking either component here would re-open that hole, so only
 * the seven panel bodies (irrelevant to the trust claim) are inert.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const ID = "22222222-2222-4222-8222-222222222222";

const rec = vi.hoisted(() => ({
  rpcResponse: { data: [], error: null } as { data: unknown; error: unknown },
}));

function strategyRow() {
  return {
    id: ID,
    name: "Footer Test Strategy",
    start_date: "2025-01-01",
    supported_exchanges: ["Binance"],
    strategy_types: ["systematic"],
    subtypes: [],
    markets: ["crypto"],
    leverage_range: null,
    avg_daily_turnover: null,
    strategy_analytics: null,
  };
}

function buildChain() {
  const result = { data: strategyRow(), error: null };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => buildChain(),
    rpc: () => Promise.resolve(rec.rpcResponse),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => buildChain() }),
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// 2026-10-09 Phase 170.5 (D-07): isolate the trust-tier tests from the joint read
// (getStrategyDetailV2 now reads the factsheet's live joint through an admin chain this
// file's thin mock does not model). Default: computed with null values.
vi.mock("@/lib/factsheet/v2-joint", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/factsheet/v2-joint")>()),
  readV2BenchmarkJoint: vi.fn(async () => ({
    values: { alpha: null, beta: null, correlation: null, ir: null, treynor: null },
    status: { kind: "computed", paired: 0, flatLeg: false },
  })),
}));

// Named inner component: react/display-name rejects the anonymous arrow the factory used to return.
const inert = vi.hoisted(() => (name: string) => {
  const Inert = () => <section data-panel={name}>{name}</section>;
  return Inert;
});
vi.mock("@/components/strategy-v2/OverviewPanel", () => ({ OverviewPanel: inert("overview") }));
vi.mock("@/components/strategy-v2/HeadlineMetricsPanel", () => ({ HeadlineMetricsPanel: inert("headline") }));
vi.mock("@/components/strategy-v2/DrawdownPanel", () => ({ DrawdownPanel: inert("drawdown") }));
vi.mock("@/components/strategy-v2/ReturnsDistributionPanel", () => ({ ReturnsDistributionPanel: inert("returns") }));
vi.mock("@/components/strategy-v2/RollingMetricsPanel", () => ({ RollingMetricsPanel: inert("rolling") }));
vi.mock("@/components/strategy-v2/TradeAndPositionPanel", () => ({ TradeAndPositionPanel: inert("trades") }));
vi.mock("@/components/strategy-v2/ExposureAndGreeksPanel", () => ({ ExposureAndGreeksPanel: inert("exposure") }));

import { getStrategyDetailV2 } from "@/lib/queries";
import { StrategyV2Shell } from "./StrategyV2Shell";

const API_FOOTER =
  "Data verified from exchange API. Quantalyze does not independently audit trading strategies. Past performance is not indicative of future results.";
const CSV_FOOTER =
  "Performance data uploaded by the manager as a daily-return series and not independently verified by Quantalyze or by an exchange API. Past performance is not indicative of future results.";
// Q5 (founder decision): Disclaimer keeps its unknown-tier default.
const UNKNOWN_FOOTER =
  "Performance data is self-reported by the manager and not independently verified by Quantalyze. Past performance is not indicative of future results.";

async function renderShell() {
  const detail = await getStrategyDetailV2(ID);
  expect(detail).not.toBeNull();
  const view = render(<StrategyV2Shell detail={detail!} />);
  const footer = view.container.querySelector("main > div > div:last-child p");
  const header = view.container.querySelector("header");
  return { view, footer, header };
}

beforeEach(() => {
  rec.rpcResponse = { data: [], error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("StrategyV2Shell footer and header chip follow the real trust tier (Phase 170.5 D-05)", () => {
  it("api_verified: footer states exchange-API verification, never self-reported, and the header shows Verified", async () => {
    rec.rpcResponse = {
      data: [{ strategy_id: ID, trust_tier: "api_verified", status: "published" }],
      error: null,
    };
    const { view, footer, header } = await renderShell();
    expect(footer?.textContent).toBe(API_FOOTER);
    expect(view.container.textContent).not.toMatch(/self-reported/);
    expect(header?.textContent).toContain("Verified");
  });

  it("csv_uploaded: footer reads the csv_uploaded sentence and the header shows no chip", async () => {
    rec.rpcResponse = {
      data: [{ strategy_id: ID, trust_tier: "csv_uploaded", status: "published" }],
      error: null,
    };
    const { footer, header } = await renderShell();
    expect(footer?.textContent).toBe(CSV_FOOTER);
    expect(header?.textContent).not.toContain("Verified");
  });

  it("RPC failure: footer keeps the unknown-tier default (Q5) and no chip renders", async () => {
    rec.rpcResponse = { data: null, error: { message: "rpc down", code: "XX000" } };
    const { footer, header } = await renderShell();
    expect(footer?.textContent).toBe(UNKNOWN_FOOTER);
    expect(header?.textContent).not.toContain("Verified");
  });
});
