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
// Review WR-05 — the persisted twin, imported so the drift guard below can
// compare the two shapes. Type-only: nothing from scenario-state.ts runs here.
import type { AddedStrategy as PersistedAddedStrategy } from "../lib/scenario-state";

// ---------------------------------------------------------------------------
// Review WR-05 — COMPILE-TIME drift guard for the drawer/scenario-state seam.
//
// These two aliases used to be independent hand-written interfaces with the same
// name and a divergent `isOwn` (`boolean` vs `boolean | null`). The assignment
// compiled because `boolean | undefined` IS assignable to
// `boolean | null | undefined` — which is exactly what made it dangerous: the
// reverse direction did not compile and was one refactor away, and a field added
// to one side and not the other would have errored nowhere.
//
// The check is MUTUAL on purpose. A one-way assertion would have passed against
// the very drift WR-05 found. `npm run typecheck` covers test files, so a future
// fork of the two shapes fails the build here rather than at a call site.
//
// The id is deliberately excluded: the persisted side brands it
// (`StrategyForBuilderId`, minted inside scenario-state's mutators) and the
// drawer holds a raw wire string. That difference is the contract, not drift.
// ---------------------------------------------------------------------------
type WR05DrawerBody = Omit<AddedStrategy, "id">;
type WR05PersistedBody = Omit<PersistedAddedStrategy, "id">;
const WR05_DRAWER_TO_PERSISTED: WR05PersistedBody =
  null as unknown as WR05DrawerBody;
const WR05_PERSISTED_TO_DRAWER: WR05DrawerBody =
  null as unknown as WR05PersistedBody;

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

  // REGRESSION (PR #620 composer close-drawer e2e). The "Add your own" CTA MUST
  // NOT live in the `browse-add-*` testid namespace the per-strategy Add buttons
  // use. The composer-driving automation clicks "the first strategy" via
  // `[data-testid^="browse-add-"]`.first(); the browse fetch is async, so during
  // the loading window NO strategy row has rendered. If the CTA carried a
  // `browse-add-`-prefixed testid (it formerly did — `browse-add-own`), that
  // first-match locator would bind to the CTA and fire onAddOwn — closing the
  // Browse drawer and opening the contribution wizard, so the drawer's
  // "Close drawer" affordance vanishes and the flow times out. The WHY this
  // encodes: an "add the first strategy" first-match over that selector must only
  // ever resolve to a real strategy Add, never the contribute escape hatch —
  // even mid-load. So: while strategies are still loading, zero elements match
  // the strategy-add selector, and the CTA — though present — is excluded from it.
  it("keeps the contribute CTA OUT of the browse-add-* selector, even while strategies load", async () => {
    const onAddOwn = vi.fn();
    // A fetch that never resolves → the drawer stays in its loading state with
    // zero strategy rows, exactly the window the e2e first-match races against.
    renderDrawer({ onAddOwn, fetchStrategies: () => new Promise(() => {}) });
    await flush();

    // The escape hatch is present (feature intact)…
    const cta = screen.getByRole("button", {
      name: /Can't find it\? Add your own/i,
    });
    expect(cta).toBeInTheDocument();
    // …but it is NOT reachable via the strategy-add automation selector, so a
    // first-match "add the first strategy" click cannot land on it mid-load.
    expect(cta.getAttribute("data-testid") ?? "").not.toMatch(/^browse-add-/);
    expect(
      document.querySelectorAll('[data-testid^="browse-add-"]'),
    ).toHaveLength(0);
  });

  // Companion to the above: once strategies HAVE loaded, the strategy-add
  // selector resolves ONLY to real per-strategy Add buttons (five here), and the
  // contribute CTA still stays out of that namespace — so a first-match click
  // deterministically hits a strategy, never the escape hatch.
  it("after load, browse-add-* matches only strategy Add buttons (not the CTA)", async () => {
    const onAddOwn = vi.fn();
    renderDrawer({ onAddOwn });
    await flush();
    const addButtons = document.querySelectorAll('[data-testid^="browse-add-"]');
    expect(addButtons).toHaveLength(FIVE_STRATS.length);
    for (const el of addButtons) {
      expect(el.getAttribute("data-testid")).toMatch(/^browse-add-s-/);
    }
    expect(
      screen
        .getByRole("button", { name: /Can't find it\? Add your own/i })
        .getAttribute("data-testid") ?? "",
    ).not.toMatch(/^browse-add-/);
  });
});

/**
 * CONNECT-01 — the prominent, top-of-drawer "Connect a key" CTA.
 *
 * WHY it exists: the bottom "Can't find it? Add your own" link (CONTRIB-05) was
 * the ONLY add-your-own entry point, and it sat below the results — so an
 * allocator handed a fresh exchange key by a new team clicked "+ Strategy", saw
 * a browse list (or the "No strategies are live yet — check back later" empty
 * state) and concluded there was no way to add a key. The hoisted CTA makes the
 * connect-a-key path discoverable regardless of list state; both CTAs call the
 * same onAddOwn.
 */
describe("StrategyBrowseDrawer — prominent 'Connect a key' CTA (CONNECT-01)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the prominent CTA when onAddOwn is provided; clicking fires it once", async () => {
    const onAddOwn = vi.fn();
    renderDrawer({ onAddOwn });
    await flush();
    const cta = screen.getByTestId("browse-connect-own");
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute("type", "button");
    fireEvent.click(cta);
    expect(onAddOwn).toHaveBeenCalledTimes(1);
  });

  it("is absent without onAddOwn (optional-prop safety)", async () => {
    renderDrawer();
    await flush();
    expect(screen.queryByTestId("browse-connect-own")).toBeNull();
  });

  it("surfaces the CTA in the no-strategies empty state — the exact miss it fixes", async () => {
    const onAddOwn = vi.fn();
    renderDrawer({ onAddOwn, fetchStrategies: async () => [] });
    await flush();
    // The dead-end empty copy is still shown, but the connect action now sits
    // above it so the allocator with their own key is not told only to "wait".
    expect(screen.getByText("No strategies are live yet.")).toBeInTheDocument();
    expect(screen.getByTestId("browse-connect-own")).toBeInTheDocument();
  });

  it("keeps the prominent CTA OUT of the browse-add-* selector, even while strategies load", async () => {
    const onAddOwn = vi.fn();
    renderDrawer({ onAddOwn, fetchStrategies: () => new Promise(() => {}) });
    await flush();
    const cta = screen.getByTestId("browse-connect-own");
    expect(cta.getAttribute("data-testid") ?? "").not.toMatch(/^browse-add-/);
    expect(
      document.querySelectorAll('[data-testid^="browse-add-"]'),
    ).toHaveLength(0);
  });
});

/**
 * Phase 152 / SCEN-02 — the ownership bit survives the drawer seam.
 *
 * `handleAdd` is the FOURTH construction site of an `AddedStrategy` payload in
 * this codebase (the other three live in ScenarioComposer). It is the only one
 * unreachable from `ScenarioComposer.test.tsx`, because that suite module-mocks
 * this drawer away — so if `isOwn` is dropped here, every composer-side test
 * still passes and the chip silently never renders for browse-added rows.
 * These two tests are the only place that can fail.
 *
 * The pair is deliberately two-sided: `true` proves the bit is carried, and the
 * legacy row proves the drawer does NOT invent a boolean when the wire is
 * silent. A one-sided "carries true" test passes against an implementation that
 * hardcodes `isOwn: true`.
 */
describe("StrategyBrowseDrawer — SCEN-02 isOwn on the onAdd payload (Phase 152)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("an own row (isOwn: true on the wire) hands onAdd a payload with isOwn === true", async () => {
    const ownRow: StrategyBrowseRow = {
      id: "s-own-1",
      name: "Alpha Centauri",
      codename: null,
      markets: ["binance"],
      strategy_types: ["momentum"],
      isOwn: true,
    };
    const onAdd = vi.fn();
    renderDrawer({ onAdd, fetchStrategies: async () => [ownRow] });
    await flush();

    fireEvent.click(screen.getByTestId("browse-add-s-own-1"));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const payload = onAdd.mock.calls[0][0] as AddedStrategy;
    // Assert the VALUE, not merely that the payload decodes/matches: an
    // implementation that omits the key entirely still satisfies a
    // toMatchObject on the other four fields (152-02's measured vacuity lesson).
    expect(payload.isOwn).toBe(true);
    expect(payload).toMatchObject({ id: "s-own-1", name: "Alpha Centauri" });
  });

  it("a legacy row with no isOwn key hands onAdd isOwn === undefined (never fabricates ownership)", async () => {
    // The pre-152 wire shape. CONTEXT lock: absence is honest — undefined must
    // pass through as undefined, never be coerced to false (which would read as
    // a positive "not yours" claim) and never defaulted to true.
    const legacyRow: StrategyBrowseRow = {
      id: "s-legacy-1",
      name: "Legacy Strat",
      codename: "LEG-1",
      markets: ["okx"],
      strategy_types: ["momentum"],
    };
    const onAdd = vi.fn();
    renderDrawer({ onAdd, fetchStrategies: async () => [legacyRow] });
    await flush();

    fireEvent.click(screen.getByTestId("browse-add-s-legacy-1"));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const payload = onAdd.mock.calls[0][0] as AddedStrategy;
    expect(payload.isOwn).toBeUndefined();
  });
});

/**
 * Phase 152 / SCEN-05 — own-vs-own duplicate disambiguation line.
 *
 * The founder holds two private strategies both named "Alpha Centauri",
 * created 15 days apart. In the browse list they are pixel-identical, so the
 * choice is a coin flip. The line makes it resolvable — and DISAMBIGUATES
 * rather than hides: no collapsing, no merge, no "(2)" suffix.
 *
 * It is a TIEBREAKER, not a metadata dump. Hence three independent gates, each
 * separately falsifiable below:
 *   - `isOwn === true` — a third party's creation date is a correlation vector
 *     against the pseudonymised codename and must never render (nor, per
 *     152-01, ever reach the wire — two independent fences).
 *   - a detected COLLISION over the FILTERED rows (D-2) — a unique row gets no
 *     line, and narrowing the filter to one row clears it.
 *   - `created_at` present — the pre-152 wire shape renders no line rather than
 *     an "Created Invalid Date" claim.
 *
 * Date oracles are LITERALS, not recomputations of the implementation's own
 * `toLocaleDateString` call (Oracle Independence, 152-VALIDATION.md). The
 * fixtures sit at 12:00:00Z so the calendar date is stable across CI (UTC) and
 * local machines, and Node ships full-icu so "en-US" month names agree.
 */
describe("StrategyBrowseDrawer — WR-05 type-seam drift guard", () => {
  it("the drawer's AddedStrategy body is MUTUALLY assignable with the persisted twin's", () => {
    // The real assertion is the pair of annotated `const`s at the top of this
    // file: they are checked by `npm run typecheck`, and a fork of the two
    // shapes (a new field on one side, or a nullability change like the
    // `boolean` vs `boolean | null` divergence WR-05 found) fails to compile
    // there. This body exists so the guard is a named, discoverable test rather
    // than two floating declarations a cleanup pass would delete as dead.
    expect(WR05_DRAWER_TO_PERSISTED).toBe(WR05_PERSISTED_TO_DRAWER);
  });
});

describe("StrategyBrowseDrawer — SCEN-05 own-vs-own dedup line (Phase 152)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // The founder's real case: two private own rows, same name, 15 days apart.
  const COLLIDING_OWN: StrategyBrowseRow[] = [
    {
      id: "s-ac-new",
      name: "Alpha Centauri",
      codename: "AC-NEW",
      markets: ["binance"],
      strategy_types: ["momentum"],
      isOwn: true,
      created_at: "2026-08-04T12:00:00.000Z",
      status: "private",
    },
    {
      id: "s-ac-old",
      name: "Alpha Centauri",
      codename: "AC-OLD",
      markets: ["binance"],
      strategy_types: ["momentum"],
      isOwn: true,
      created_at: "2026-07-20T12:00:00.000Z",
      status: "private",
    },
  ];

  it("two colliding own rows BOTH render the line with the literal created date and product-cased status", async () => {
    renderDrawer({ fetchStrategies: async () => COLLIDING_OWN });
    await flush();

    expect(screen.getByTestId("browse-dedup-s-ac-new").textContent).toBe(
      "Created Aug 4, 2026 · Private",
    );
    expect(screen.getByTestId("browse-dedup-s-ac-old").textContent).toBe(
      "Created Jul 20, 2026 · Private",
    );
  });

  it("a UNIQUE own row renders no line — the line is a tiebreaker, not a metadata dump", async () => {
    // Same row shape as the colliding fixture (own, created_at, status all
    // present) — the ONLY difference is that no second own row shares its
    // name. An implementation that rendered the line on every own row with
    // metadata would pass every other test in this block and fail here.
    const soloOwn: StrategyBrowseRow[] = [
      { ...COLLIDING_OWN[0], id: "s-solo", name: "Solitary Alpha" },
    ];
    renderDrawer({ fetchStrategies: async () => soloOwn });
    await flush();

    expect(screen.getByText("Solitary Alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("browse-dedup-s-solo")).toBeNull();
    expect(document.querySelectorAll('[data-testid^="browse-dedup-"]')).toHaveLength(0);
  });

  it("two THIRD-PARTY rows with identical labels render no line, even when the wire leaks created_at/status", async () => {
    // Defence in depth: the 152-01 route never emits created_at/status for a
    // third-party row, so this fixture is a deliberately HOSTILE wire shape.
    // The render gate must refuse it on `isOwn` alone — the drawer does not get
    // to assume the route upstream stayed correct.
    const thirdParty: StrategyBrowseRow[] = [
      {
        id: "s-tp-1",
        name: "Shared Label",
        codename: "TP-1",
        markets: ["okx"],
        strategy_types: ["momentum"],
        isOwn: false,
        created_at: "2026-08-04T12:00:00.000Z",
        status: "published",
      },
      {
        id: "s-tp-2",
        name: "Shared Label",
        codename: "TP-2",
        markets: ["okx"],
        strategy_types: ["momentum"],
        isOwn: false,
        created_at: "2026-07-20T12:00:00.000Z",
        status: "published",
      },
    ];
    renderDrawer({ fetchStrategies: async () => thirdParty });
    await flush();

    expect(document.querySelectorAll('[data-testid^="browse-dedup-"]')).toHaveLength(0);
    // The leaked dates must not surface anywhere in the drawer either.
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Aug 4, 2026");
    expect(body).not.toContain("Jul 20, 2026");
  });

  it("a lone own row whose name matches TWO third-party rows gets no line — collisions are counted own-only", async () => {
    // SC4 falsifier target. The gate under test here is the COLLISION BUILDER,
    // not the render gate: with `isOwn === true` dropped from pass 1, the
    // normalized name "shared label" counts 3 and the own row — which passes
    // every render-gate term on its own merits — starts claiming a duplicate
    // that does not exist among its own strategies. Only ONE own row carries
    // this name, so the honest answer is no line anywhere.
    const mixed: StrategyBrowseRow[] = [
      {
        id: "s-mix-own",
        name: "Shared Label",
        codename: "MIX-OWN",
        markets: ["binance"],
        strategy_types: ["momentum"],
        isOwn: true,
        created_at: "2026-08-04T12:00:00.000Z",
        status: "private",
      },
      {
        id: "s-mix-tp-1",
        name: "Shared Label",
        codename: "MIX-TP-1",
        markets: ["okx"],
        strategy_types: ["momentum"],
        isOwn: false,
      },
      {
        id: "s-mix-tp-2",
        name: "Shared Label",
        codename: "MIX-TP-2",
        markets: ["okx"],
        strategy_types: ["momentum"],
        isOwn: false,
      },
    ];
    renderDrawer({ fetchStrategies: async () => mixed });
    await flush();

    expect(screen.queryByTestId("browse-dedup-s-mix-own")).toBeNull();
    expect(document.querySelectorAll('[data-testid^="browse-dedup-"]')).toHaveLength(0);
  });

  it("collision matching is normalized — trailing whitespace and case differences still collide", async () => {
    const normalizedPair: StrategyBrowseRow[] = [
      { ...COLLIDING_OWN[0], id: "s-norm-a", name: "alpha centauri " },
      { ...COLLIDING_OWN[1], id: "s-norm-b", name: "Alpha Centauri" },
    ];
    renderDrawer({ fetchStrategies: async () => normalizedPair });
    await flush();

    // A raw-string collision key would see two distinct names and render nothing.
    expect(screen.getByTestId("browse-dedup-s-norm-a").textContent).toBe(
      "Created Aug 4, 2026 · Private",
    );
    expect(screen.getByTestId("browse-dedup-s-norm-b").textContent).toBe(
      "Created Jul 20, 2026 · Private",
    );
  });

  it("narrowing the filter so only ONE colliding row survives clears its line (D-2: scope is the filtered result)", async () => {
    renderDrawer({ fetchStrategies: async () => COLLIDING_OWN });
    await flush();
    // Both lines present before the filter narrows.
    expect(screen.getByTestId("browse-dedup-s-ac-new")).toBeInTheDocument();
    expect(screen.getByTestId("browse-dedup-s-ac-old")).toBeInTheDocument();

    // The two rows share a name, so narrow by CODENAME (the search matches
    // either) to leave exactly one of them visible.
    const search = screen.getByPlaceholderText("Search by name or codename");
    fireEvent.change(search, { target: { value: "AC-NEW" } });

    expect(screen.getByText("Alpha Centauri")).toBeInTheDocument();
    expect(screen.queryByTestId("browse-dedup-s-ac-old")).toBeNull();
    // The survivor no longer has anything to be disambiguated FROM — a
    // collision set computed over `strategies` instead of `filtered` would
    // leave this line stranded on a row that is now unambiguous.
    expect(screen.queryByTestId("browse-dedup-s-ac-new")).toBeNull();
  });

  it("a colliding own row MISSING created_at renders no line, while its sibling keeps one", async () => {
    // Older wire shape. UI-SPEC honesty invariant: render nothing rather than
    // "Created Invalid Date". Discriminating in both directions — the sibling
    // proves the collision itself was still detected.
    const partial: StrategyBrowseRow[] = [
      { ...COLLIDING_OWN[0], id: "s-has-date" },
      {
        id: "s-no-date",
        name: "Alpha Centauri",
        codename: "AC-LEGACY",
        markets: ["binance"],
        strategy_types: ["momentum"],
        isOwn: true,
      },
    ];
    renderDrawer({ fetchStrategies: async () => partial });
    await flush();

    expect(screen.getByTestId("browse-dedup-s-has-date").textContent).toBe(
      "Created Aug 4, 2026 · Private",
    );
    expect(screen.queryByTestId("browse-dedup-s-no-date")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("Invalid Date");
  });

  // -------------------------------------------------------------------------
  // Review WR-04 — the ABSENT-key test above is not the whole hazard.
  //
  // The shipped gate was `typeof s.created_at === "string"`, which covers an
  // absent key but waves through a present-and-UNPARSEABLE one: it flowed
  // straight into `new Date(…).toLocaleDateString(…)`, which does not throw —
  // it renders the literal text "Created Invalid Date" at the allocator. Not
  // reachable from the first-party route (Postgres ISO timestamps only), but
  // reachable the moment a second producer feeds `strategies` into this drawer,
  // and the inline comment claimed it was already handled.
  //
  // The sibling arm is what makes this discriminating: the collision must still
  // be DETECTED (name matching does not depend on the timestamp) — the bad row
  // loses its line, it does not silently disappear from the results.
  // -------------------------------------------------------------------------
  it("WR-04: a colliding own row with an UNPARSEABLE created_at renders no line — never 'Created Invalid Date'", async () => {
    const malformed: StrategyBrowseRow[] = [
      { ...COLLIDING_OWN[0], id: "s-good-date" },
      { ...COLLIDING_OWN[1], id: "s-bad-date", created_at: "not-a-timestamp" },
    ];
    renderDrawer({ fetchStrategies: async () => malformed });
    await flush();

    // The good sibling proves the collision was detected at all.
    expect(screen.getByTestId("browse-dedup-s-good-date").textContent).toBe(
      "Created Aug 4, 2026 · Private",
    );
    expect(screen.queryByTestId("browse-dedup-s-bad-date")).toBeNull();
    // The literal string the pre-fix code rendered.
    expect(document.body.textContent ?? "").not.toContain("Invalid Date");
    // …and the row itself is still on screen and still addable — a malformed
    // metadata field must not cost the allocator the strategy.
    expect(screen.getByTestId("browse-add-s-bad-date")).toBeInTheDocument();
  });

  it("WR-04: an EMPTY-STRING created_at renders no line either (new Date('') is Invalid Date, not epoch)", async () => {
    const emptyish: StrategyBrowseRow[] = [
      { ...COLLIDING_OWN[0], id: "s-ok" },
      { ...COLLIDING_OWN[1], id: "s-empty", created_at: "" },
    ];
    renderDrawer({ fetchStrategies: async () => emptyish });
    await flush();

    expect(screen.getByTestId("browse-dedup-s-ok")).toBeInTheDocument();
    expect(screen.queryByTestId("browse-dedup-s-empty")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("Invalid Date");
    // The falsifier for a `?? new Date(0)` style "fix": the epoch date must not
    // appear anywhere.
    expect(document.body.textContent ?? "").not.toContain("Jan 1, 1970");
  });

  it("renders the raw status enum product-cased, and omits the segment entirely when status is absent", async () => {
    const statusPair: StrategyBrowseRow[] = [
      { ...COLLIDING_OWN[0], id: "s-st-review", status: "pending_review" },
      { ...COLLIDING_OWN[1], id: "s-st-none", status: undefined },
    ];
    renderDrawer({ fetchStrategies: async () => statusPair });
    await flush();

    // Underscores → spaces, first letter capitalized. The raw DB enum is a
    // second vocabulary the allocator never agreed to read.
    expect(screen.getByTestId("browse-dedup-s-st-review").textContent).toBe(
      "Created Aug 4, 2026 · Pending review",
    );
    expect(document.body.textContent ?? "").not.toContain("pending_review");
    // No status → no dangling separator (the sibling codename line's
    // conditional-separator idiom).
    expect(screen.getByTestId("browse-dedup-s-st-none").textContent).toBe(
      "Created Jul 20, 2026",
    );
  });

  it("keeps the dedup line OUT of the browse-add-* automation namespace (PR #620 contract)", async () => {
    renderDrawer({ fetchStrategies: async () => COLLIDING_OWN });
    await flush();

    const dedupNodes = document.querySelectorAll('[data-testid^="browse-dedup-"]');
    expect(dedupNodes).toHaveLength(2);
    for (const el of dedupNodes) {
      expect(el.getAttribute("data-testid") ?? "").not.toMatch(/^browse-add-/);
    }
    // The strategy-add first-match selector still resolves ONLY to Add buttons.
    const addNodes = document.querySelectorAll('[data-testid^="browse-add-"]');
    expect(addNodes).toHaveLength(2);
    for (const el of addNodes) {
      expect(el.tagName).toBe("BUTTON");
    }
  });
});

/**
 * Phase 152 / SCEN-02 (D-4) — the "Yours" chip on own browse rows.
 *
 * Parity with the composer row (152-05) through the SAME `YoursChip` component,
 * not a second recipe — one place to change the anatomy, one place to get it
 * wrong. The chip is NOT a substitute for the SCEN-05 dedup line: both rows of
 * the founder's duplicate are own rows, so a chip on each disambiguates nothing.
 *
 * The className assertions are LOCKED honesty tokens, not styling trivia. The
 * `rounded-md` family is the persistent-fact family (Phase-150: identity is
 * carried by ink, not shape); the uppercase `rounded-sm` family means DERIVED
 * state that can change on its own, which ownership never does. And the ink is
 * the muted `bg-badge-other/10` — accent would read as "verified / action",
 * dressing a mere ownership fact as the mark that unlocks the money action.
 */
describe("StrategyBrowseDrawer — SCEN-02 'Yours' chip on own rows (Phase 152, D-4)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const OWN_AND_THIRD_PARTY: StrategyBrowseRow[] = [
    {
      id: "s-chip-own",
      name: "My Own Strat",
      codename: null,
      markets: ["binance"],
      strategy_types: ["momentum"],
      isOwn: true,
    },
    {
      id: "s-chip-tp",
      name: "Someone Elses Strat",
      codename: "TP-9",
      markets: ["okx"],
      strategy_types: ["momentum"],
      isOwn: false,
    },
  ];

  it("an own row renders the chip with the locked anatomy and muted ink; a third-party row does not", async () => {
    renderDrawer({ fetchStrategies: async () => OWN_AND_THIRD_PARTY });
    await flush();

    const chip = screen.getByTestId("browse-yours-s-chip-own");
    expect(chip.textContent).toBe("Yours");
    // Persistent-fact badge family.
    expect(chip.className).toContain("rounded-md");
    expect(chip.className).toContain("bg-badge-other/10");
    expect(chip.className).toContain("text-text-muted");
    // NOT the derived-state family, NOT the accent "verified/action" ink.
    expect(chip.className).not.toContain("rounded-sm");
    expect(chip.className).not.toContain("uppercase");
    expect(chip.className).not.toContain("bg-accent");
    expect(chip.className).not.toContain("text-accent");

    // Discriminating: gates on isOwn, not on every row.
    expect(screen.queryByTestId("browse-yours-s-chip-tp")).toBeNull();
  });

  it("a row with isOwn ABSENT renders no chip — the gate is `=== true`, never `!== false`", async () => {
    // The pre-152 wire shape. Absence is UNKNOWN, and an unknown ownership
    // claim rendered as "Yours" is a fabrication; a `!== false` gate would
    // make exactly that mistake and pass every other test in this block.
    const legacy: StrategyBrowseRow[] = [
      {
        id: "s-chip-legacy",
        name: "Legacy Strat",
        codename: "LEG-2",
        markets: ["okx"],
        strategy_types: ["momentum"],
      },
    ];
    renderDrawer({ fetchStrategies: async () => legacy });
    await flush();

    expect(screen.getByText("Legacy Strat")).toBeInTheDocument();
    expect(screen.queryByTestId("browse-yours-s-chip-legacy")).toBeNull();
    expect(document.querySelectorAll('[data-testid^="browse-yours-"]')).toHaveLength(0);
  });

  it("keeps the chip OUT of the browse-add-* automation namespace", async () => {
    renderDrawer({ fetchStrategies: async () => OWN_AND_THIRD_PARTY });
    await flush();
    const chip = screen.getByTestId("browse-yours-s-chip-own");
    expect(chip.getAttribute("data-testid") ?? "").not.toMatch(/^browse-add-/);
    // A chip is not an action — the strategy-add selector still resolves only
    // to the two Add buttons.
    expect(document.querySelectorAll('[data-testid^="browse-add-"]')).toHaveLength(2);
  });
});
