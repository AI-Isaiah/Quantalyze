/**
 * PortfolioOptimizer — shared optimizer component mounted on BOTH /allocations
 * (via OptimizerPanel) and /portfolios/[id]. Red-team F-2 honesty regression:
 * the metric cells must NOT render unitless quantities as signed percentages.
 *
 *   - `corr_with_portfolio` is a -1..1 correlation → plain decimal ("0.45"),
 *     never "+45.00%".
 *   - `sharpe_lift` is a unitless Sharpe delta → signed decimal ("+0.15"),
 *     never "+15.00%".
 *   - `dd_improvement` IS a fraction of NAV → stays a percentage ("+3.00%").
 *
 * Because this is the shared component, the corrected formatting applies
 * identically on /portfolios/[id].
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PortfolioOptimizer, {
  type OptimizerSuggestion,
} from "./PortfolioOptimizer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const SUGGESTION: OptimizerSuggestion = {
  strategy_id: "s-1",
  strategy_name: "Uncorrelated Vol",
  corr_with_portfolio: 0.45,
  sharpe_lift: 0.15,
  dd_improvement: 0.03,
  score: 0.8,
};

/** The value <p> is the 2nd <p> inside the MetricCell that owns `label`. */
function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  const cell = labelEl.parentElement as HTMLElement;
  const ps = cell.querySelectorAll("p");
  return ps[1]?.textContent ?? "";
}

function renderOptimizer() {
  return render(
    <PortfolioOptimizer
      portfolioId="p1"
      initialSuggestions={[SUGGESTION]}
      computedAt="2026-07-11T00:00:00Z"
      computationStatus="complete"
    />,
  );
}

describe("PortfolioOptimizer metric formatting (F-2 honesty)", () => {
  it("renders correlation as a plain decimal, NOT a percentage", () => {
    renderOptimizer();
    const value = metricValue("Corr w/ portfolio");
    expect(value).toBe("0.45");
    expect(value).not.toMatch(/%/);
    expect(value).not.toBe("+45.00%"); // the old formatPercent output
  });

  it("renders Sharpe lift as a signed decimal, NOT a percentage", () => {
    renderOptimizer();
    const value = metricValue("Sharpe lift");
    expect(value).toBe("+0.15");
    expect(value).not.toMatch(/%/);
    expect(value).not.toBe("+15.00%"); // the old formatPercent output
  });

  it("keeps DD improve as a percentage (it IS a fraction of NAV)", () => {
    renderOptimizer();
    expect(metricValue("DD improve")).toBe("+3.00%");
  });

  it("does not render a raw correlation anywhere as a signed percentage", () => {
    const { container } = renderOptimizer();
    expect(container.textContent).not.toContain("+45.00%");
    expect(container.textContent).not.toContain("+15.00%");
  });
});

/**
 * [140.3-07 / SEAMUX-09 / B-26 live member 1] — the phase's money-bearing item.
 *
 * A failed recompute used to leave the PREVIOUS ranked allocation on screen with
 * live, clickable "Add to portfolio" links under one small red line. An allocator
 * reads that as a current answer and acts on it.
 *
 * Two independent faults produced it:
 *   1. `runOptimizer`'s catch set `error` but never discarded `suggestions`, so
 *      execution fell through to the SUCCESS branch.
 *   2. the error card was gated on `computationStatus === "failed"`, a
 *      SERVER-RENDERED prop that a client-side re-run failure never updates —
 *      so the card was unreachable twice over.
 *
 * The assertions below deliberately query for the ACTION CONTROL, not only for
 * the error text. A red line beside a live "Add to portfolio" link is the hazard;
 * the presence of a message proves nothing about the absence of the control.
 */
describe("[140.3-07 / SEAMUX-09] a failed re-run discards the invalidated ranking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Hand-typed, NOT imported from src/lib/seam-copy.ts. An oracle that reads the
  // module under test cannot fail when that module changes (lesson C-1).
  const BREAKER_SENTENCE =
    "The analytics service is temporarily unavailable. Please try again in a moment.";

  /**
   * `computedAt` is pinned far in the past so `isStale` is true deterministically
   * and the "Re-run" control in the stale banner is present. A `computedAt` near
   * today would make the re-run affordance appear or vanish with the wall clock.
   */
  function renderLoaded(suggestions: OptimizerSuggestion[] = [SUGGESTION]) {
    return render(
      <PortfolioOptimizer
        portfolioId="p1"
        initialSuggestions={suggestions}
        computedAt="2020-01-01T00:00:00Z"
        computationStatus="complete"
      />,
    );
  }

  function clickReRun() {
    fireEvent.click(screen.getByRole("button", { name: "Re-run" }));
  }

  /** Every live control that would let a user act on the invalidated ranking. */
  function addToPortfolioControls() {
    return screen.queryAllByRole("link", { name: "Add to portfolio" });
  }

  it("removes every 'Add to portfolio' control when the re-run hits a breaker 503", async () => {
    // The ranking is on screen and actionable before the failure.
    renderLoaded();
    expect(addToPortfolioControls()).toHaveLength(1);
    expect(screen.getByText("Uncorrelated Vol")).toBeInTheDocument();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          status: "failed",
          suggestions: null,
          error: BREAKER_SENTENCE,
        }),
      }),
    );

    clickReRun();

    await waitFor(() =>
      expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument(),
    );

    // THE assertion: the action control is gone, not merely accompanied by a
    // red line. `suggestions` must have been discarded, not annotated.
    expect(addToPortfolioControls()).toHaveLength(0);
    expect(screen.queryByText("Uncorrelated Vol")).toBeNull();
    expect(screen.queryByText("View strategy")).toBeNull();
  });

  it("reaches the client-side error state, which the server-rendered prop cannot express", async () => {
    renderLoaded();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ status: "failed", suggestions: null, error: BREAKER_SENTENCE }),
      }),
    );

    clickReRun();

    // `computationStatus` is still "complete" — the prop never changes on a
    // client-side failure. The error card must be reachable anyway, otherwise
    // the user gets an empty panel and a red line instead of an error state.
    await waitFor(() =>
      expect(screen.getByText("Optimizer failed")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the route's breaker sentence rather than swallowing it (B-27 must not over-fire)", async () => {
    renderLoaded();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ status: "failed", suggestions: null, error: BREAKER_SENTENCE }),
      }),
    );

    clickReRun();

    // The route's `error` field is reviewed, scrubbed copy — on a breaker trip
    // it IS the single-source sentence from src/lib/seam-copy.ts. A B-27 fix
    // that replaced every caught message with a component fallback would delete
    // the breaker surface at a seam consumer.
    await waitFor(() =>
      expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument(),
    );
  });

  it("does NOT render a raw caught message when the fetch itself rejects (B-27)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderLoaded();

    // The shape a real network failure arrives as. Its message can carry an
    // internal URL or header name via undici.
    const raw = new TypeError(
      "NetworkError: connect ECONNREFUSED http://localhost:8002/optimize",
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(raw));

    clickReRun();

    await waitFor(() =>
      expect(screen.getByText("Optimizer failed")).toBeInTheDocument(),
    );

    // The raw value never reaches the DOM …
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
    expect(screen.queryByText(/localhost:8002/)).toBeNull();
    expect(document.body.textContent).not.toContain("ECONNREFUSED");
    // … but it DOES reach the console, so debuggability was not traded away.
    const logged = consoleSpy.mock.calls.find((call) =>
      call.some((arg) => arg === raw),
    );
    expect(logged).toBeDefined();
    // And the ranking is still discarded on this path too.
    expect(addToPortfolioControls()).toHaveLength(0);
  });

  it("PIN (pre-satisfied): the stale ranking is already gone while the re-run is in flight", async () => {
    // ⚠️ Recorded as a PIN, not as evidence of this plan's work. `runOptimizer`
    // sets `loading` first and the `loading` branch returns the shimmer BEFORE
    // any success branch, so no ranking rendered during the in-flight window
    // even on the untouched tree. Measured, not assumed. It is kept because a
    // future edit that reorders the loading branch below the success branch
    // would re-open the in-flight half of the hazard.
    renderLoaded();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    clickReRun();

    await waitFor(() => expect(addToPortfolioControls()).toHaveLength(0));
    expect(screen.queryByText("Uncorrelated Vol")).toBeNull();
  });

  it("ANTI-REGRESSION: a successful re-run renders the new ranking", async () => {
    renderLoaded();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "complete",
          suggestions: [
            { ...SUGGESTION, strategy_id: "s-2", strategy_name: "Fresh Carry" },
          ],
        }),
      }),
    );

    clickReRun();

    await waitFor(() =>
      expect(screen.getByText("Fresh Carry")).toBeInTheDocument(),
    );
    expect(addToPortfolioControls()).toHaveLength(1);
    expect(screen.queryByText("Uncorrelated Vol")).toBeNull();
  });

  /**
   * ⚠️ Added in response to a GREEN mutation, and recorded as such.
   *
   * M72 (delete `setSuggestions(null)` from the top of `runOptimizer`) left all
   * eleven cases above GREEN. That is a real finding, not a pass: this member
   * needed TWO fixes — the invalidation AND making the error card reachable —
   * and the render guard alone already keeps every ranking off screen while an
   * error is set, so the invalidation is behaviourally redundant on every
   * reachable path. (M72b, deleting the guard's `error` disjunct, reddens 4
   * cases, so the behavioural oracle above is not vacuous — it binds to the
   * other half.)
   *
   * Redundant is not worthless: the invalidation is the LOCKED house pattern,
   * it keeps the component from holding a result it has already invalidated,
   * and it is the only thing covering a `router.refresh()` throw that lands
   * AFTER a successful `setSuggestions`. Left unpinned it could be deleted
   * tomorrow with a green suite. So it is pinned structurally, which is the
   * honest instrument for a structural property — and it is labelled as
   * structural rather than dressed up as behaviour.
   *
   * Member 2 needs no such pin: `setPerms(null)` is its ONLY fix, so M73
   * reddens its behavioural cases directly.
   */
  describe("STRUCTURAL PIN: the locked invalidate-before-refetch idiom, at both live members", () => {
    const read = (rel: string) =>
      readFileSync(join(process.cwd(), "src", rel), "utf8");

    it.each([
      ["components/portfolio/PortfolioOptimizer.tsx", "setSuggestions(null)"],
      ["components/connect/KeyPermissionBadge.tsx", "setPerms(null)"],
    ])("%s invalidates before its fetch", (file, call) => {
      const lines = read(file).split("\n");
      const invalidateAt = lines.findIndex((l) => l.trim() === `${call};`);
      const fetchAt = lines.findIndex((l) => l.includes("await fetch("));

      expect(
        invalidateAt,
        `${file} must call ${call} — the locked shape from WeightOptimizerSection.tsx`,
      ).toBeGreaterThan(-1);
      expect(
        invalidateAt,
        `${file} must invalidate BEFORE the request, not in the catch: a catch-side ` +
          `discard leaves the stale result rendered for the whole in-flight window ` +
          `on any surface whose loading branch does not mask it.`,
      ).toBeLessThan(fetchAt);
    });
  });

  it("ANTI-REGRESSION: the server-rendered computationStatus='failed' card still renders", () => {
    render(
      <PortfolioOptimizer
        portfolioId="p1"
        initialSuggestions={null}
        computedAt={null}
        computationStatus="failed"
      />,
    );

    expect(screen.getByText("Optimizer failed")).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't compute suggestions for this portfolio."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  /**
   * [140.4-05 / SEAMRIM-10] The failure is ANNOUNCED, not only drawn.
   *
   * This surface is the headline instance of the measured regression: the
   * error branch `return`s a DIFFERENT tree, so the "Re-run" button the user
   * just activated UNMOUNTS and focus falls to `<body>`. A screen-reader user
   * therefore gets no focus event, no announcement, and no way to discover
   * that anything happened at all — the announcement is the ONLY channel.
   *
   * The assertion is `getByRole("alert")`, not a DOM-attribute string match, so
   * a refactor that preserves the semantics keeps this green. A grep would not
   * do: an announcement added AFTER the early `return` is dead code that greps
   * clean and announces nothing.
   */
  it("ANNOUNCES the failure through role=alert, carrying the sentence the card shows", async () => {
    renderLoaded();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ status: "failed", suggestions: null, error: BREAKER_SENTENCE }),
      }),
    );

    clickReRun();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(BREAKER_SENTENCE);

    // The visible tree is unchanged — the announcement is ADDITIVE, not a
    // replacement for the card a sighted user reads.
    expect(screen.getByText("Optimizer failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("NEGATIVE CONTROL: the success render exposes NO role=alert", () => {
    // Without this, the assertion above is satisfied by a component that
    // announces unconditionally — which would announce on every render and is
    // worse than silence, because it trains the user to ignore the region.
    renderLoaded();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Uncorrelated Vol")).toBeInTheDocument();
  });
});
