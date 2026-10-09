import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 170.5 SFH-01 — `fetchStrategyLazyMetricsClient` failure contract.
 *
 * The RPC `fetch_strategy_lazy_metrics` returns a JSONB OBJECT on every
 * non-failing path: `jsonb_build_object()` for an invisible strategy and for a
 * visible one with no stored rows (COALESCEd, so never SQL NULL). Everything
 * else is a FAILED fetch and must reject, so `useLazyPanelMetrics` reaches
 * status "error" and the panels show the retry banner. Before this contract a
 * failed fetch resolved `{}`, which the panels rendered as a confident, false
 * "no series is stored for this strategy".
 */

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: (...args: unknown[]) => rpcMock(...args) }),
}));

import { fetchStrategyLazyMetricsClient } from "./queries-client";

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rpcMock.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("fetchStrategyLazyMetricsClient", () => {
  it("passes the strategy and panel ids to the RPC and returns a valid object payload", async () => {
    const payload = { exposure_series: [{ date: "2026-06-01", gross: 2, net: 1 }] };
    rpcMock.mockResolvedValueOnce({ data: payload, error: null });
    await expect(fetchStrategyLazyMetricsClient("s1", "exposure")).resolves.toEqual(payload);
    expect(rpcMock).toHaveBeenCalledWith("fetch_strategy_lazy_metrics", {
      p_strategy_id: "s1",
      p_panel_id: "exposure",
    });
  });

  it("a valid EMPTY object (invisible strategy, or no stored rows) resolves {} and logs nothing", async () => {
    rpcMock.mockResolvedValueOnce({ data: {}, error: null });
    await expect(fetchStrategyLazyMetricsClient("s1", "rolling")).resolves.toEqual({});
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("rejects on an RPC error instead of resolving {}, and keeps the structured log", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    await expect(fetchStrategyLazyMetricsClient("s1", "exposure")).rejects.toThrow(
      /RPC failed.*statement timeout/,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "fetchStrategyLazyMetricsClient RPC error:",
      expect.objectContaining({ strategyId: "s1", panelId: "exposure", code: "57014" }),
    );
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("rejects on a %s payload (the RPC contract never returns SQL NULL)", async (_label, data) => {
    rpcMock.mockResolvedValueOnce({ data, error: null });
    await expect(fetchStrategyLazyMetricsClient("s1", "rolling")).rejects.toThrow(
      /no payload/,
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it.each([
    ["an array", [{ kind: "x" }]],
    ["a string", "oops"],
    ["a number", 7],
  ])("rejects on %s (wrong payload shape)", async (_label, data) => {
    rpcMock.mockResolvedValueOnce({ data, error: null });
    await expect(fetchStrategyLazyMetricsClient("s1", "rolling")).rejects.toThrow(
      /unexpected payload shape/,
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it("propagates a rejected RPC call (network failure) unchanged", async () => {
    rpcMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(fetchStrategyLazyMetricsClient("s1", "exposure")).rejects.toThrow(
      "Failed to fetch",
    );
  });
});
