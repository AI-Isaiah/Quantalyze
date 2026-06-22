import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WeightOptimizerSection } from "./WeightOptimizerSection";

/**
 * Plan 28-02 (OPT-01 + OPT-02) — state matrix + honesty pins for the optimizer
 * section. The math is Python (pinned in test_optimizer.py); this owns the UI
 * contract: the request lifecycle, the never-fabricate-weights empty states, the
 * mandatory in-sample caveat, and the apply-to-draft-only seam.
 */

type DP = { date: string; value: number };
function strat(id: string, name: string): { id: string; name: string; dailyReturns: DP[] } {
  return { id, name, dailyReturns: [{ date: "2024-01-01", value: 0.01 }] };
}

function mockFetchOnce(body: unknown, ok = true) {
  const f = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WeightOptimizerSection", () => {
  it("< 2 active strategies ⇒ the add-2 empty state, no request", () => {
    const f = mockFetchOnce({});
    render(<WeightOptimizerSection strategies={[strat("a", "A")]} onApply={() => {}} />);
    expect(screen.getByText("Suggested weights unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Add at least 2 active strategies/)).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("ok result ⇒ weights + the mandatory in-sample caveat + apply writes to draft only", async () => {
    mockFetchOnce({
      ok: true,
      objective: "min_vol",
      n: 180,
      k: 2,
      weights: { a: 0.7, b: 0.3 },
      in_sample: true,
      reason: "ok",
    });
    const onApply = vi.fn();
    render(
      <WeightOptimizerSection strategies={[strat("a", "Alpha"), strat("b", "Beta")]} onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Suggest weights/ }));

    await waitFor(() => expect(screen.getByTestId("optimizer-result")).toBeInTheDocument());
    // H2 — the rendered magnitude must be the percent (0.7 -> "70%"), the whole
    // user-facing payload of the feature.
    expect(screen.getByTestId("optimizer-weight-a")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("optimizer-weight-a")).toHaveTextContent("70");
    // The in-sample caveat is always present with the weights (never a forecast).
    const disclosure = screen.getByTestId("optimizer-result").textContent ?? "";
    expect(disclosure).toContain("in-sample over 180 overlapping days");
    expect(disclosure).toContain("not a forecast");

    // Apply writes to the draft ONLY on the explicit click — never before.
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Apply to draft/ }));
    expect(onApply).toHaveBeenCalledWith({ a: 0.7, b: 0.3 });
  });

  it("ok:false (below-sample-gate) ⇒ honest empty state, NEVER fabricated weights", async () => {
    mockFetchOnce({
      ok: false,
      objective: "min_vol",
      n: 40,
      k: 2,
      weights: null,
      in_sample: true,
      reason: "below-sample-gate",
    });
    render(<WeightOptimizerSection strategies={[strat("a", "A"), strat("b", "B")]} onApply={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Suggest weights/ }));
    await waitFor(() => expect(screen.getByTestId("optimizer-empty")).toBeInTheDocument());
    expect(screen.getByText("Not enough history to optimize")).toBeInTheDocument();
    expect(screen.queryByTestId("optimizer-result")).not.toBeInTheDocument();
  });

  it("a non-ok HTTP response ⇒ the couldn't-reach empty state", async () => {
    mockFetchOnce({}, false);
    render(<WeightOptimizerSection strategies={[strat("a", "A"), strat("b", "B")]} onApply={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Suggest weights/ }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't reach the optimizer")).toBeInTheDocument(),
    );
  });

  it("selection change between suggest and apply ⇒ stale guard, not a mismatched apply (H1)", async () => {
    mockFetchOnce({
      ok: true,
      objective: "min_vol",
      n: 180,
      k: 2,
      weights: { a: 0.6, b: 0.4 },
      in_sample: true,
      reason: "ok",
    });
    const { rerender } = render(
      <WeightOptimizerSection strategies={[strat("a", "A"), strat("b", "B")]} onApply={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Suggest weights/ }));
    await waitFor(() => expect(screen.getByTestId("optimizer-result")).toBeInTheDocument());
    // The allocator swaps a strategy AFTER computing — weights no longer match.
    rerender(<WeightOptimizerSection strategies={[strat("a", "A"), strat("c", "C")]} onApply={() => {}} />);
    expect(screen.getByTestId("optimizer-stale")).toBeInTheDocument();
    expect(screen.queryByTestId("optimizer-result")).not.toBeInTheDocument();
  });

  it("max-Sharpe shows the overfit caveat", () => {
    mockFetchOnce({});
    render(<WeightOptimizerSection strategies={[strat("a", "A"), strat("b", "B")]} onApply={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Max Sharpe/ }));
    expect(screen.getByText(/most\s+overfit-prone objective/)).toBeInTheDocument();
  });
});
