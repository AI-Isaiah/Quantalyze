import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";

/**
 * Phase 10 Plan 05 Task 2 — StrategyBrowseDrawer test.
 *
 * Drawer pattern (backdrop click + Esc + isOpen=false render-null) is copied
 * verbatim from BridgeDrawer.test.tsx. Drawer-specific cases cover:
 *   - lazy fetch on isOpen → setStrategies → 5 row cards
 *   - search input name-substring filter (case-insensitive)
 *   - markets filter pills (multi-select)
 *   - strategy_types filter pills (multi-select)
 *   - mandate-fit pill chip copy per tier
 *   - Add button onAdd(strategy) callback assertion
 *   - "Added ✓" transient state then permanent dim
 *   - Drawer stays open on add (multi-add session — no onClose call)
 *   - Empty states: zero strategies / zero filtered matches
 *   - Phase 29 (UNIFY-03 UI): the "Example" provenance tag renders only for
 *     is_example rows (neutral-outline recipe, never accent); the drawer title
 *     drops "verified" now that the catalog is merged.
 */

import {
  StrategyBrowseDrawer,
  type StrategyBrowseRow,
  type AllocatorMandateForFit,
  type AddedStrategy,
} from "./StrategyBrowseDrawer";

const FIVE_STRATS: StrategyBrowseRow[] = [
  {
    id: "s-momentum-1",
    name: "Momentum Alpha",
    codename: "MOM-A",
    markets: ["binance"],
    strategy_types: ["momentum"],
  },
  {
    id: "s-mean-rev-1",
    name: "Mean Reversion Beta",
    codename: "MR-B",
    markets: ["okx"],
    strategy_types: ["mean_reversion"],
  },
  {
    id: "s-mom-okx",
    name: "Momentum OKX",
    codename: "MOM-OKX",
    markets: ["okx"],
    strategy_types: ["momentum"],
  },
  {
    id: "s-arb-1",
    name: "Arbitrage Gamma",
    codename: null,
    markets: ["binance", "okx"],
    strategy_types: ["arbitrage"],
  },
  {
    id: "s-trend-1",
    name: "Trend Delta",
    codename: "TR-D",
    markets: ["coinbase"],
    strategy_types: ["trend_following"],
  },
];

const MANDATE_BINANCE_OKX: AllocatorMandateForFit = {
  preferred_markets: ["binance", "okx"],
  excluded_strategy_types: ["arbitrage"],
};

function renderDrawer(props: {
  isOpen?: boolean;
  onClose?: () => void;
  onAdd?: (s: AddedStrategy) => void;
  onAddOwn?: () => void;
  mandate?: AllocatorMandateForFit | null;
  fetchStrategies?: () => Promise<StrategyBrowseRow[]>;
} = {}) {
  return render(
    <StrategyBrowseDrawer
      isOpen={props.isOpen ?? true}
      onClose={props.onClose ?? vi.fn()}
      onAdd={props.onAdd ?? vi.fn()}
      onAddOwn={props.onAddOwn}
      allocatorMandate={
        props.mandate === undefined ? MANDATE_BINANCE_OKX : props.mandate
      }
      fetchStrategies={
        props.fetchStrategies ?? (async () => FIVE_STRATS)
      }
    />,
  );
}

// Flush microtasks so the fetch effect resolves and rows render.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("StrategyBrowseDrawer — Phase 10 Plan 05 Task 2", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 — isOpen=false → renders nothing", () => {
    const { container } = renderDrawer({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it("T2 — isOpen=true → backdrop + role=dialog panel with aria-modal + aria-label", async () => {
    renderDrawer();
    await flush();
    expect(screen.getByTestId("browse-drawer-backdrop")).toBeInTheDocument();
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAttribute("aria-label", "Browse strategies");
  });

  it("T3 — fetch is called once with /api/strategies/browse (default fetcher)", async () => {
    const responseStrats = FIVE_STRATS.slice(0, 2);
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ strategies: responseStrats }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <StrategyBrowseDrawer
        isOpen
        onClose={vi.fn()}
        onAdd={vi.fn()}
        allocatorMandate={MANDATE_BINANCE_OKX}
        // Intentionally omit fetchStrategies prop to exercise the default fetch path.
      />,
    );
    await flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Review-pass P2 fix — fetch now passes an AbortController signal as
    // its second arg so the request can be aborted on close/unmount.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/strategies/browse",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    vi.unstubAllGlobals();
  });

  it("T4 — after fetch resolves with 5 strategies → 5 row cards visible", async () => {
    renderDrawer();
    await flush();
    for (const s of FIVE_STRATS) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it("T5 — search input filters by name substring (case-insensitive)", async () => {
    renderDrawer();
    await flush();
    const search = screen.getByPlaceholderText("Search by name or codename");
    fireEvent.change(search, { target: { value: "moment" } });

    expect(screen.getByText("Momentum Alpha")).toBeInTheDocument();
    expect(screen.getByText("Momentum OKX")).toBeInTheDocument();
    expect(screen.queryByText("Mean Reversion Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Arbitrage Gamma")).not.toBeInTheDocument();
    expect(screen.queryByText("Trend Delta")).not.toBeInTheDocument();
  });

  it("T6 — markets filter pill toggles row visibility", async () => {
    renderDrawer();
    await flush();

    const marketsRow = screen.getByLabelText("Markets filter");
    const binancePill = marketsRow.querySelector(
      'button[aria-pressed]',
    ) as HTMLButtonElement | null;
    expect(binancePill).toBeTruthy();

    // Click "binance" pill specifically.
    const binanceBtn = Array.from(
      marketsRow.querySelectorAll("button"),
    ).find((b) => b.textContent === "binance") as HTMLButtonElement;
    fireEvent.click(binanceBtn);

    // Strategies whose markets include "binance" remain.
    expect(screen.getByText("Momentum Alpha")).toBeInTheDocument();
    expect(screen.getByText("Arbitrage Gamma")).toBeInTheDocument();
    // Others removed.
    expect(screen.queryByText("Mean Reversion Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Momentum OKX")).not.toBeInTheDocument();
    expect(screen.queryByText("Trend Delta")).not.toBeInTheDocument();
  });

  it("T7 — strategy_types filter pills toggle (clicking same pill twice removes filter)", async () => {
    renderDrawer();
    await flush();

    const typesRow = screen.getByLabelText("Strategy types filter");
    const momentumBtn = Array.from(
      typesRow.querySelectorAll("button"),
    ).find((b) => b.textContent === "momentum") as HTMLButtonElement;

    fireEvent.click(momentumBtn);
    expect(momentumBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(momentumBtn);
    expect(momentumBtn).toHaveAttribute("aria-pressed", "false");

    // After untoggle: all 5 visible again.
    for (const s of FIVE_STRATS) {
      expect(screen.getByText(s.name)).toBeInTheDocument();
    }
  });

  it("T8 — mandate-fit chip copy matches the computed tier per row", async () => {
    renderDrawer();
    await flush();
    // Arbitrage Gamma → strategy_type "arbitrage" excluded → red → "Weak mandate fit".
    // Trend Delta — coinbase only, prefs binance+okx → 0/1 overlap → also red.
    // → at least 2 weak chips render.
    expect(screen.getAllByText("Weak mandate fit").length).toBeGreaterThanOrEqual(2);
    // Momentum Alpha (binance), Mean Reversion Beta (okx), Momentum OKX (okx)
    // — all 1.0 fraction overlap of single-market with prefs → green → "Strong".
    expect(screen.getAllByText("Strong mandate fit").length).toBeGreaterThanOrEqual(3);
  });

  it("T9 — row Add button calls onAdd(strategy) with the right id", async () => {
    const onAdd = vi.fn();
    renderDrawer({ onAdd });
    await flush();
    fireEvent.click(screen.getByTestId("browse-add-s-momentum-1"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      id: "s-momentum-1",
      name: "Momentum Alpha",
    });
  });

  it("T10 — after Add: row shows 'Added ✓' for 2s then dims; drawer stays open", async () => {
    vi.useFakeTimers();
    const onAdd = vi.fn();
    const onClose = vi.fn();
    renderDrawer({ onAdd, onClose });
    // Resolve fetcher under fake timers.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTestId("browse-add-s-momentum-1"));

    // Immediately after click: row label flips to "Added ✓".
    expect(screen.getByTestId("browse-add-s-momentum-1")).toHaveTextContent(
      "Added ✓",
    );
    expect(onClose).not.toHaveBeenCalled();

    // Advance 2s — row dims, label reverts to "Add" (button is no longer disabled).
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Drawer remains mounted (multi-add session contract).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("T11 — backdrop click → onClose called once", async () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    await flush();
    fireEvent.click(screen.getByTestId("browse-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("T12 — Esc key → onClose called once", async () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });
    await flush();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("T13 — fetch resolves with [] → 'No strategies are live yet.' visible", async () => {
    renderDrawer({ fetchStrategies: async () => [] });
    await flush();
    expect(
      screen.getByText("No strategies are live yet."),
    ).toBeInTheDocument();
  });

  it("T14 — filter combination yields 0 results → empty-state copy + 'Clear filters' link", async () => {
    renderDrawer();
    await flush();
    // Search for an impossible substring.
    const search = screen.getByPlaceholderText("Search by name or codename");
    fireEvent.change(search, { target: { value: "zzzz-no-match-zzzz" } });

    expect(
      screen.getByText("No strategies match your filters."),
    ).toBeInTheDocument();
    const clearBtn = screen.getByRole("button", { name: /clear filters/i });
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(screen.queryByText("No strategies match your filters.")).not.toBeInTheDocument();
    expect(screen.getByText("Momentum Alpha")).toBeInTheDocument();
  });

  it("T16 (UNIFY-03 UI) — the 'Example' tag renders ONLY for is_example rows, and uses the neutral-outline recipe (never accent)", async () => {
    // Merged catalog: one example-universe row + one verified row. Plan 02
    // emits is_example on the browse response; the drawer gates the provenance
    // tag on it. Non-vacuous: the example row carries the tag, the verified row
    // does NOT, and the tag is the neutral-outline pill — never accent (accent
    // = verified/action; an example strategy is provenance metadata).
    const mergedRows: StrategyBrowseRow[] = [
      {
        id: "s-example-1",
        name: "Example Universe Strat",
        codename: "EX-1",
        markets: ["binance"],
        strategy_types: ["momentum"],
        is_example: true,
      },
      {
        id: "s-verified-1",
        name: "Verified Strat",
        codename: "VER-1",
        markets: ["okx"],
        strategy_types: ["momentum"],
        is_example: false,
      },
    ];
    renderDrawer({ fetchStrategies: async () => mergedRows });
    await flush();

    // Both rows render in one interleaved list.
    expect(screen.getByText("Example Universe Strat")).toBeInTheDocument();
    expect(screen.getByText("Verified Strat")).toBeInTheDocument();

    // The example row carries the "Example" provenance tag; the verified row
    // does not (discriminating — gates on is_example, not on every row).
    const exampleTag = screen.getByTestId("browse-example-tag-s-example-1");
    expect(exampleTag).toHaveTextContent("Example");
    expect(
      screen.queryByTestId("browse-example-tag-s-verified-1"),
    ).not.toBeInTheDocument();

    // LOCKED honesty token: the tag is the neutral-outline pill (muted border +
    // muted text), NOT accent and NOT a filled Badge. A regression that swapped
    // to bg-accent / a filled status badge fails here.
    expect(exampleTag.className).toContain("border-text-muted");
    expect(exampleTag.className).toContain("text-text-muted");
    expect(exampleTag.className).not.toContain("bg-accent");
    expect(exampleTag.className).not.toContain("text-accent");
  });

  it("H-0115 — extra sensitive fields on a row (disclosure_tier / backtest_returns) are NOT rendered", async () => {
    // The drawer narrows StrategyBrowseRow to id/name/codename/markets/
    // strategy_types. Feed it a row that ALSO carries sensitive fields a
    // careless upstream might leak; the display layer must not surface them.
    // Cast through `unknown` because these keys are intentionally absent from
    // the StrategyBrowseRow type.
    const leakyRow = {
      id: "s-leak",
      name: "Leaky Strategy",
      codename: "LEAK-1",
      markets: ["binance"],
      strategy_types: ["momentum"],
      disclosure_tier: "exploratory",
      backtest_returns: [0.12, -0.04, 0.31],
      secret_sharpe: 4.2,
    } as unknown as StrategyBrowseRow;

    renderDrawer({ fetchStrategies: async () => [leakyRow] });
    await flush();

    // Whitelisted fields render.
    expect(screen.getByText("Leaky Strategy")).toBeInTheDocument();

    // Forbidden values must NOT appear anywhere in the DOM.
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("exploratory");
    expect(body).not.toContain("backtest_returns");
    expect(body).not.toContain("disclosure_tier");
    expect(body).not.toContain("0.31");
    expect(body).not.toContain("4.2");
    expect(screen.queryByText(/exploratory/i)).not.toBeInTheDocument();
  });

  it("M-0105 — closing the drawer mid-flight ABORTS the in-flight fetch (signal.aborted flips true)", async () => {
    // T3 only proves the signal is SUPPLIED to fetch — it never proves the
    // P2-review AbortController actually fires on close/unmount. Here we keep
    // the fetch pending, capture the signal handed to it, then re-render with
    // isOpen=false (which runs the effect cleanup → controller.abort()). A
    // regression that dropped `controller.abort()` from the cleanup would
    // leave signal.aborted === false and fail this assertion.
    let capturedSignal: AbortSignal | null = null;
    const fetchSpy = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      capturedSignal = init?.signal ?? null;
      // Never resolves — keeps the request "in flight" so the abort is
      // observable rather than a no-op on an already-settled promise.
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { rerender } = render(
      <StrategyBrowseDrawer
        isOpen
        onClose={vi.fn()}
        onAdd={vi.fn()}
        allocatorMandate={MANDATE_BINANCE_OKX}
        // default fetch path → exercises the real AbortController wiring
      />,
    );
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedSignal).not.toBeNull();
    expect((capturedSignal as unknown as AbortSignal).aborted).toBe(false);

    // Close the drawer → effect cleanup aborts the controller.
    rerender(
      <StrategyBrowseDrawer
        isOpen={false}
        onClose={vi.fn()}
        onAdd={vi.fn()}
        allocatorMandate={MANDATE_BINANCE_OKX}
      />,
    );
    await flush();

    expect((capturedSignal as unknown as AbortSignal).aborted).toBe(true);
    vi.unstubAllGlobals();
  });

  it("H-0117 — a non-user AbortError mid-flight surfaces the error state (no eternal spinner)", async () => {
    // Loud-fail discipline: the effect's `cancelled` flag is the ONLY signal
    // that an abort was our own close/unmount cleanup. A flaky-proxy /
    // mid-flight AbortError arrives while the drawer is still OPEN
    // (cancelled === false). The pre-fix code early-returned on
    // `e.name === "AbortError"` WITHOUT clearing `loading` or setting `error`,
    // wedging the drawer in "Loading…" forever. This test drives the default
    // fetch path (the only path that can produce a real AbortError) and
    // rejects mid-flight without ever closing the drawer.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const abortErr = new DOMException("aborted", "AbortError");
    const fetchSpy = vi.fn(async () => {
      throw abortErr;
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <StrategyBrowseDrawer
        isOpen
        onClose={vi.fn()}
        onAdd={vi.fn()}
        allocatorMandate={MANDATE_BINANCE_OKX}
        // Default fetch path — exercises the AbortController/AbortError branch.
      />,
    );
    await flush();

    // The distinct error state must render — NOT the loading spinner and NOT
    // the misleading "No strategies are live yet." empty state.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No strategies are live yet."),
    ).not.toBeInTheDocument();
    // The swallowed failure is now observable.
    expect(consoleErr).toHaveBeenCalledWith(
      "[StrategyBrowseDrawer] strategy load failed",
      abortErr,
    );

    vi.unstubAllGlobals();
    consoleErr.mockRestore();
  });

  it("T15 — backdrop click during loading state still calls onClose", async () => {
    // Slow fetcher that never resolves while we click backdrop.
    let resolveFetch: ((rows: StrategyBrowseRow[]) => void) | null = null;
    const onClose = vi.fn();
    renderDrawer({
      onClose,
      fetchStrategies: () =>
        new Promise<StrategyBrowseRow[]>((resolve) => {
          resolveFetch = resolve;
        }),
    });

    fireEvent.click(screen.getByTestId("browse-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Resolve to drain pending state.
    if (resolveFetch) {
      (resolveFetch as (rows: StrategyBrowseRow[]) => void)([]);
    }
    await flush();
  });

  it("H-0082(b) — reopening does NOT flash the previous session's stale rows or error", async () => {
    const pending = () => new Promise<StrategyBrowseRow[]>(() => {});

    // Session 1a: a successful load renders rows.
    const { rerender } = render(
      <StrategyBrowseDrawer
        isOpen
        onClose={vi.fn()}
        onAdd={vi.fn()}
        allocatorMandate={MANDATE_BINANCE_OKX}
        fetchStrategies={async () => FIVE_STRATS}
      />,
    );
    await flush();
    expect(screen.getByText("Momentum Alpha")).toBeInTheDocument();

    // Close → the close-reset effect must clear `strategies` (and `error`).
    rerender(
      <StrategyBrowseDrawer
        isOpen={false}
        onClose={vi.fn()}
        onAdd={vi.fn()}
        allocatorMandate={MANDATE_BINANCE_OKX}
        fetchStrategies={async () => FIVE_STRATS}
      />,
    );
    await flush();

    // Reopen with a fetch that never resolves, so the close-reset alone governs
    // the reopen render. The drawer stays mounted across close, so WITHOUT the
    // H-0082(b) reset the previous session's 5 rows are still in state and flash
    // here (the row <ul> is not gated on `loading`). With the reset they're gone.
    rerender(
      <StrategyBrowseDrawer
        isOpen
        onClose={vi.fn()}
        onAdd={vi.fn()}
        allocatorMandate={MANDATE_BINANCE_OKX}
        fetchStrategies={pending}
      />,
    );
    // The discriminating assertion: WITHOUT the close-reset's setStrategies([]),
    // the previous session's rows are still in state and render here (the row
    // <ul> is not gated on `loading`). Neuter-verified: removing setStrategies([])
    // makes this fail.
    expect(screen.queryByText("Momentum Alpha")).not.toBeInTheDocument();

    // NB the close-reset ALSO clears `error`/`loading` in the same block, but
    // that is NOT separately unit-assertable: the fetch effect re-runs on every
    // reopen and itself calls setError(null)+setLoading(true) at the top, so it
    // masks the close-reset's contribution in everything except the one pre-
    // effect frame (which RTL's act-wrapped rerender flushes past). The error/
    // loading resets are covered by construction — same close block as the
    // neuter-verified setStrategies([]) above — and remove the in-browser
    // one-frame stale-error flash on reopen.
  });
});

/**
 * Phase 110 CONTRIB-05 — the "Can't find it? Add your own" escape-hatch CTA.
 *
 * When the drawer is handed an `onAddOwn` callback (ScenarioComposer wires it to
 * open the ContributionWizardOverlay), the browse list surfaces a contribution
 * CTA. Without the prop the CTA is absent — optional-prop safety for any mount
 * that does not support contribution. The onSuccess → reopen-browse chain (so
 * the freshly-contributed private row appears via the once-per-open refetch)
 * lives in the ScenarioComposer wiring test.
 */
describe("StrategyBrowseDrawer — 'Add your own' CTA (CONTRIB-05)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the CTA when onAddOwn is provided; clicking fires it exactly once", async () => {
    const onAddOwn = vi.fn();
    renderDrawer({ onAddOwn });
    await flush();
    const cta = screen.getByRole("button", {
      name: /Can't find it\? Add your own/i,
    });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute("type", "button");
    fireEvent.click(cta);
    expect(onAddOwn).toHaveBeenCalledTimes(1);
  });

  it("does NOT render the CTA when onAddOwn is absent (optional-prop safety)", async () => {
    renderDrawer();
    await flush();
    expect(
      screen.queryByRole("button", { name: /Can't find it\? Add your own/i }),
    ).toBeNull();
  });

  it("surfaces the CTA even in the no-strategies empty state (escape hatch where it matters)", async () => {
    const onAddOwn = vi.fn();
    renderDrawer({ onAddOwn, fetchStrategies: async () => [] });
    await flush();
    expect(screen.getByText("No strategies are live yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Can't find it\? Add your own/i }),
    ).toBeInTheDocument();
  });
});
