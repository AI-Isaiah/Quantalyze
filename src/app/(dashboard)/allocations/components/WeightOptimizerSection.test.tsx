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

/**
 * Phase 140.3 plan 08 / SEAMUX-05 (B-13) — the bare `} catch { setStatus("error"); }`.
 *
 * The caught value was discarded and the response outcome was never read, so
 * FOUR different failures collapsed into one state whose copy reads *"The
 * optimizer is unavailable right now. Try again shortly."*:
 *
 *   - a 5xx / breaker trip      → availability IS the fact. Copy correct.
 *   - a 4xx                     → the optimizer answered, immediately, refusing.
 *                                 "Try again shortly" is FALSE, and it steers the
 *                                 allocator into re-running a request that will
 *                                 be refused identically every time.
 *   - a body we cannot parse    → we do not know whether it ran. Claiming it is
 *                                 unavailable asserts something we cannot see.
 *   - a rejected fetch          → availability. Copy correct.
 *
 * ⚠️ TRAP-8. This file is ALSO the source of the locked `setResult(null)`
 * invalidate-before-refetch pattern that plan `140.3-07` copied to both live
 * members of the B-26 class. That line must survive this plan byte-unchanged;
 * the structural pin at the bottom of this block asserts it, and the plan's
 * acceptance criterion asserts it again against the diff.
 */
describe("WeightOptimizerSection — SEAMUX-05 / B-13: the failure is named", () => {
  function stubFetch(impl: () => Promise<Response>) {
    const f = vi.fn().mockImplementation(impl);
    vi.stubGlobal("fetch", f);
    return f;
  }

  function renderAndRun() {
    render(
      <WeightOptimizerSection
        strategies={[strat("a", "A"), strat("b", "B")]}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Suggest weights/ }));
  }

  it("a 503 says the optimizer is unavailable (availability IS the fact)", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "circuit open" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    renderAndRun();
    await waitFor(() =>
      expect(screen.getByText("Couldn't reach the optimizer")).toBeInTheDocument(),
    );
  });

  it("a 400 does NOT claim the optimizer is unavailable — it was answered and refused", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "bad series" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    renderAndRun();

    await waitFor(() =>
      expect(
        screen.getByText("The optimizer refused this request"),
      ).toBeInTheDocument(),
    );
    // THE assertion: the availability claim must NOT be made about a request the
    // optimizer answered. "Try again shortly" is the steering half of the lie.
    expect(
      screen.queryByText("Couldn't reach the optimizer"),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Try again shortly/);
  });

  it("an unparseable 200 says we couldn't READ the answer, and logs the caught value", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() =>
      Promise.resolve(
        new Response("<html><body>gateway</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    renderAndRun();

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't read the optimizer's answer"),
      ).toBeInTheDocument(),
    );
    // We do not know whether it ran, so we must not assert availability …
    expect(
      screen.queryByText("Couldn't reach the optimizer"),
    ).not.toBeInTheDocument();
    // … the raw caught value never reaches the DOM (140.3-07's B-27 discipline) …
    expect(document.body.textContent).not.toMatch(/SyntaxError|Unexpected token|JSON/);
    // … and it DOES reach the operator log, so debuggability was not traded away.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("a rejected fetch is an availability fact, and its message stays out of the DOM", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() =>
      Promise.reject(
        new TypeError("NetworkError when attempting to fetch resource http://localhost:8002/optimize"),
      ),
    );
    renderAndRun();

    await waitFor(() =>
      expect(screen.getByText("Couldn't reach the optimizer")).toBeInTheDocument(),
    );
    expect(document.body.textContent).not.toMatch(/NetworkError|localhost:8002/);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  /**
   * TRAP-8 STRUCTURAL PIN. This file is the source of the locked
   * invalidate-before-refetch shape `140.3-07` copied to `PortfolioOptimizer`
   * and `KeyPermissionBadge`. Plan `140.3-08` edits this file for B-13, and the
   * hazard is that the B-13 edit disturbs the very lines the other plan copied.
   *
   * Labelled STRUCTURAL, not behavioural: it reads the source text. It exists
   * because the invalidation is not observable from this component's DOM (the
   * loading branch returns first), which is the same asymmetry `140.3-07`
   * recorded for M72.
   */
  it("STRUCTURAL PIN: setResult(null) still precedes the fetch in requestWeights", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx",
      ),
      "utf8",
    );
    const lines = src.split("\n");
    const invalidateAt = lines.findIndex((l) => l.includes("setResult(null)"));
    const fetchAt = lines.findIndex((l) => l.includes("await fetch("));
    expect(
      invalidateAt,
      "WeightOptimizerSection.tsx must still call setResult(null) — it is the locked shape 140.3-07 copied to both live members of the B-26 class",
    ).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(
      invalidateAt,
      "the invalidation must stay ABOVE the fetch; that ordering is the pattern, not an accident",
    ).toBeLessThan(fetchAt);
  });

  /**
   * [140.4-05 / SEAMRIM-10] The named failure is ANNOUNCED, not only drawn.
   *
   * B-13 above established that this surface names WHICH failure occurred. That
   * naming is delivered entirely through `EmptyStateCard`'s visual text, so a
   * screen-reader user got neither the name nor the fact of the failure — the
   * "Suggest weights" button stays mounted, so there is not even a focus change
   * to notice.
   *
   * ⚠️ The expected headings are HAND-TYPED, never read from `FAILURE_COPY`.
   * An oracle that reads the table under test cannot fail when that table
   * changes (the C-1 lesson, and the house rule in this file already).
   *
   * ⚠️ `OptimizerFailure` has THREE members, not two — `refused` sits between
   * `unavailable` and `unreadable`. All three are driven here.
   */
  it.each([
    ["a 5xx", 503, "Couldn't reach the optimizer"],
    ["a 4xx", 422, "The optimizer refused this request"],
  ])(
    "ANNOUNCES the named failure through role=alert — %s",
    async (_label, status, heading) => {
      stubFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "x" }), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
      renderAndRun();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(heading);

      // The visible EmptyStateCard is unchanged — the region is additive.
      expect(screen.getByText(heading)).toBeInTheDocument();
    },
  );

  it("ANNOUNCES the named failure through role=alert — an unreadable 200", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() =>
      Promise.resolve(
        new Response("<html><body>gateway</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    renderAndRun();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't read the optimizer's answer");
    // The caught value must stay out of the announcement too — an ARIA region
    // is DOM, so B-27's no-raw-internals rule applies to it identically.
    expect(alert.textContent ?? "").not.toMatch(/SyntaxError|Unexpected token|JSON/);
    errSpy.mockRestore();
  });

  it("NEGATIVE CONTROL: the idle and success renders expose NO role=alert", async () => {
    // Without this, the three assertions above are satisfied by a component
    // that announces unconditionally — announcing on every render is worse
    // than silence, because it trains the user to tune the region out.
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            objective: "min_vol",
            n: 180,
            k: 2,
            weights: { a: 0.7, b: 0.3 },
            in_sample: true,
            reason: "ok",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(
      <WeightOptimizerSection
        strategies={[strat("a", "A"), strat("b", "B")]}
        onApply={() => {}}
      />,
    );
    // Idle — nothing has been requested yet.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Suggest weights/ }));
    await waitFor(() =>
      expect(screen.getByTestId("optimizer-result")).toBeInTheDocument(),
    );
    // Success — the optimizer answered.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
