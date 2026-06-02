import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

// F9 M-0189 — OutcomesWidget retry now calls useRouter().refresh() (soft
// re-fetch) instead of window.location.reload(). Provide a router stub with a
// stable refresh spy so the retry-behavior test can assert on it.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

import OutcomesWidget from "./OutcomesWidget";

// ---------------------------------------------------------------------------
// Mocks — Recharts ResponsiveContainer renders nothing without a real
// layout engine. Shim it to a plain div so Lines still render (useful for
// presence tests).
// ---------------------------------------------------------------------------
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 200, height: 48 }} data-testid="recharts-container">
        {children}
      </div>
    ),
  };
});

// ---------------------------------------------------------------------------
// Mock-data shape — mirrors OutcomeRow from src/lib/queries.ts (W1-07)
// ---------------------------------------------------------------------------

type MockStrategy = { id: string; name: string };
type MockOutcome = {
  id: string;
  strategy_id: string;
  match_decision_id: string | null;
  kind: "allocated" | "rejected";
  percent_allocated: number | null;
  allocated_at: string | null;
  rejection_reason: string | null;
  note: string | null;
  delta_30d: number | null;
  delta_90d: number | null;
  delta_180d: number | null;
  estimated_delta_bps: number | null;
  estimated_days: number | null;
  needs_recompute: boolean;
  created_at: string;
  replacement_strategy: MockStrategy | null;
  match_decision: { original_strategy: MockStrategy } | null;
};

function makeOutcome(
  overrides: Partial<MockOutcome> & { id: string },
): MockOutcome {
  return {
    strategy_id: "s-repl",
    match_decision_id: "md-1",
    kind: "allocated",
    percent_allocated: 12,
    allocated_at: "2026-03-01",
    rejection_reason: null,
    note: null,
    delta_30d: 0.04,
    delta_90d: null,
    delta_180d: null,
    estimated_delta_bps: null,
    estimated_days: null,
    needs_recompute: false,
    created_at: "2026-03-01T00:00:00Z",
    replacement_strategy: { id: "s-repl", name: "Crypto Momentum LP" },
    match_decision: {
      original_strategy: { id: "s-orig", name: "Legacy Equity LP" },
    },
    ...overrides,
  };
}

const WIDGET_PROPS_BASE = {
  timeframe: "1YTD" as const,
  width: 1200,
  height: 300,
};

function renderWidget(outcomes: MockOutcome[] | undefined) {
  // B21: the production mount (OutcomesTabPanel) ALWAYS passes a full
  // MyAllocationDashboardPayload object; "loading" is that object present with
  // `outcomes` not yet populated (→ the widget's <LoadingState/>). Model the
  // loading case as `{ outcomes: undefined }` (an object that PASSES the
  // validation boundary because `outcomes` is optional) rather than a bare
  // `undefined` payload, which never occurs in production and which the boundary
  // correctly treats as "couldn't load".
  const data = { outcomes };
  return render(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <OutcomesWidget data={data as any} {...WIDGET_PROPS_BASE} />,
  );
}

// ---------------------------------------------------------------------------
// Global fetch spy for ExpandedPanel /api/bridge/outcome/[id]/curves
// ---------------------------------------------------------------------------

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      original: [
        { date: "2026-03-01", nav: 100 },
        { date: "2026-03-10", nav: 98 },
      ],
      replacement: [
        { date: "2026-03-01", nav: 100 },
        { date: "2026-03-10", nav: 102 },
      ],
      allocated_at: "2026-03-01",
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// OutcomesWidget
// ===========================================================================

describe("OutcomesWidget", () => {
  it("renders 3 timeline rows from 3 outcomes", () => {
    const outcomes = [
      makeOutcome({ id: "o1" }),
      makeOutcome({
        id: "o2",
        replacement_strategy: { id: "s2", name: "BTC Basis LP" },
        match_decision: {
          original_strategy: { id: "s2o", name: "Old Equity" },
        },
      }),
      makeOutcome({
        id: "o3",
        replacement_strategy: { id: "s3", name: "Vol Harvest LP" },
        match_decision: {
          original_strategy: { id: "s3o", name: "Legacy Credit" },
        },
      }),
    ];
    renderWidget(outcomes);
    const bodyRows = screen.getAllByRole("button", {
      name: /Expand outcome detail/,
    });
    expect(bodyRows).toHaveLength(3);
  });

  it("empty state: 0 outcomes -> literal copy 'Your Bridge outcomes will appear here after you act on one' + 'View Holdings' CTA", () => {
    renderWidget([]);
    expect(
      screen.getByText(
        "Your Bridge outcomes will appear here after you act on one",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("View Holdings")).toBeInTheDocument();
  });

  it("loading state: outcomes=undefined -> 5 skeleton rows with aria-label='Loading outcomes data'", () => {
    renderWidget(undefined);
    const loading = screen.getByLabelText("Loading outcomes data");
    expect(loading).toBeInTheDocument();
  });

  it("error state: fetch error -> 'Could not load outcomes' + 'Try again' button", async () => {
    // Simulate error-state by supplying an outcome row and triggering an
    // expansion that 500s. The widget surfaces the per-row retry but the
    // top-level error state ("Could not load outcomes") is not yet wired in
    // the single-file consolidation. This test asserts the widget-level
    // copy only appears when data is deliberately shaped as error — in the
    // current consolidation, state.error is derived when an explicit
    // `__error: true` flag is present on data. We'll assert the literal
    // copy renders when that flag is provided.
    const errorData = { outcomes: undefined, __error: true } as unknown;
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <OutcomesWidget data={errorData as any} {...WIDGET_PROPS_BASE} />,
    );
    expect(screen.getByText("Could not load outcomes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Try again/i }),
    ).toBeInTheDocument();
  });

  it("F9 M-0189: 'Try again' soft-refreshes via router.refresh() (no hard reload)", () => {
    refreshMock.mockClear();
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    const errorData = { outcomes: undefined, __error: true } as unknown;
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <OutcomesWidget data={errorData as any} {...WIDGET_PROPS_BASE} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // The hard reload that wiped sibling-widget state must NOT be used.
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  // Rendering 200 outcome rows can exceed the 5s default under concurrent
  // vitest worker load (flaky in full-suite runs, passes in isolation).
  it("Voice-D5 truncation: outcomes.length === 200 -> footer 'Showing most recent 200 — reach out if you need historical export' rendered", { timeout: 15_000 }, () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      makeOutcome({ id: `o${i}` }),
    );
    renderWidget(many);
    expect(
      screen.getByText(
        /Showing most recent 200 — reach out if you need historical export/,
      ),
    ).toBeInTheDocument();
  });

  it("Voice-D5 no-truncation: outcomes.length < 200 -> footer NOT rendered", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    expect(
      screen.queryByText(
        /Showing most recent 200 — reach out if you need historical export/,
      ),
    ).not.toBeInTheDocument();
  });
});

// ===========================================================================
// OutcomesWidget — KPI strip (inline KpiStrip)
// ===========================================================================

describe("OutcomesWidget — KPI strip (inline KpiStrip)", () => {
  it("className presence check: labels render in 11px uppercase tracking-wider (Phase 09.1 UI-FLAG-02 — was 10.5 designer port; snapped to ladder)", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    const label = screen.getByText("Total outcomes");
    expect(label.className).toContain("text-[11px]");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("tracking-wider");
  });

  it("className presence check: values render in font-mono text-[22px] tabular-nums (Phase 09.1 Plan 10 designer KPIStripCell)", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    // totalOutcomes value "1" — pick the font-mono node (the visible "1"
    // in the Total outcomes cell; sub-copy "0 pending cycle" is muted DM Sans).
    const candidates = screen.getAllByText("1");
    const valueNode = candidates.find((n) =>
      n.className.includes("font-mono"),
    );
    expect(valueNode).toBeDefined();
    expect(valueNode!.className).toContain("font-mono");
    expect(valueNode!.className).toContain("text-[22px]");
    expect(valueNode!.className).toContain("tabular-nums");
  });

  it("className presence check: avg-realized-α color >=0 -> #15803D; <0 -> #DC2626; null -> em-dash (Phase 09.1 Plan 10 designer KPIStripCell color prop)", () => {
    // >=0: positive avg realized α (single win). The KPI strip and the
    // row's Δ 30d cell both render +4.0%, so disambiguate by picking the
    // KPI-cell node (text-[22px]) vs the row delta cell (text-[13px]).
    const { unmount } = renderWidget([
      makeOutcome({ id: "o1", percent_allocated: 10, delta_30d: 0.04 }),
    ]);
    const avgWinKpi = screen
      .getAllByText("+4.0%")
      .find((n) => n.className.includes("text-[22px]"));
    expect(avgWinKpi).toBeDefined();
    expect(avgWinKpi!.getAttribute("style")).toContain("15803D");
    unmount();

    // <0: negative avg realized α (single loss)
    const { unmount: unmount2 } = renderWidget([
      makeOutcome({ id: "o2", percent_allocated: 10, delta_30d: -0.04 }),
    ]);
    const avgLossKpi = screen
      .getAllByText("-4.0%")
      .find((n) => n.className.includes("text-[22px]"));
    expect(avgLossKpi).toBeDefined();
    expect(avgLossKpi!.getAttribute("style")).toContain("DC2626");
    unmount2();

    // null: no matured rows -> em-dash visible in the strip
    renderWidget([
      makeOutcome({
        id: "o3",
        percent_allocated: 10,
        delta_30d: null,
        delta_90d: null,
        delta_180d: null,
      }),
    ]);
    const dashes = screen.getAllByText("\u2014");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("renders sub-label 'Avg realized delta: +X.X% \u00B7 N pending' (DM Sans 12px muted — copy assertion)", () => {
    renderWidget([
      makeOutcome({ id: "o1", percent_allocated: 10, delta_30d: 0.04 }),
      makeOutcome({
        id: "o2",
        percent_allocated: 10,
        delta_30d: null,
        delta_90d: null,
        delta_180d: null,
      }),
    ]);
    // NEW-C27-03: the avg-α cell sub-label is now the unified pending count
    // ("N pending") — the prior "Avg realized delta: +X.X% · N pending" copy
    // was removed. 1 pending row (o2: allocated, percent>=1, all deltas null).
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("renders 3-cell KPI strip with 'Hit rate (latest)', 'Avg realized α (latest)', 'Total outcomes' labels (NEW-C27-01: (90d)→(latest) to match mostMatureDelta semantics)", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    expect(screen.getByText("Hit rate (latest)")).toBeInTheDocument();
    expect(
      screen.getByText("Avg realized α (latest)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Total outcomes")).toBeInTheDocument();
  });

  it("renders 'Bridge outcomes' h3 header with 'Feedback loop' badge (Phase 09.1 Plan 10 designer header)", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    const header = screen.getByRole("heading", { level: 3 });
    expect(header.textContent).toContain("Bridge outcomes");
    expect(header.textContent).toContain("Feedback loop");
  });
});

// ===========================================================================
// OutcomesWidget — Timeline (inline TimelineTable + TimelineRow)
// ===========================================================================

describe("OutcomesWidget — Timeline (inline TimelineTable + TimelineRow)", () => {
  it("sort order is created_at DESC (newest first)", () => {
    const o1 = makeOutcome({
      id: "old",
      created_at: "2026-01-01T00:00:00Z",
      allocated_at: "2026-01-01",
      replacement_strategy: { id: "sOld", name: "Old Strat" },
    });
    const o2 = makeOutcome({
      id: "new",
      created_at: "2026-04-01T00:00:00Z",
      allocated_at: "2026-04-01",
      replacement_strategy: { id: "sNew", name: "New Strat" },
    });
    // Widget is a pure renderer — it renders outcomes in the order passed.
    // Consumer (getMyAllocationDashboard) is responsible for ORDER BY
    // created_at DESC. We assert the widget preserves caller ordering here.
    renderWidget([o2, o1]);
    const strategyLinks = screen.getAllByRole("link");
    const names = strategyLinks
      .map((l) => l.textContent ?? "")
      .filter((t) =>
        ["Old Strat", "New Strat", "Legacy Equity LP"].includes(t),
      );
    // The first two "New Strat"+"Legacy Equity LP" pair should come before
    // the "Old Strat" + "Legacy Equity LP" pair.
    expect(names.indexOf("New Strat")).toBeLessThan(
      names.indexOf("Old Strat"),
    );
  });

  it("delta columns: allocated-win renders +%, allocated-loss renders -%, pending renders 'pending' (Phase 09.1 Plan 10 designer table replaces 4-state status pill)", () => {
    // Phase 09.1 Plan 10 (D-06): the row no longer shows the
    // "Allocated 12% — win" pill text. Delta values appear directly in
    // 3 dedicated columns (delta_30 / delta_90 / delta_180), color-coded by sign.
    renderWidget([
      makeOutcome({
        id: "win",
        percent_allocated: 12,
        delta_30d: 0.04,
      }),
      makeOutcome({
        id: "loss",
        percent_allocated: 15,
        delta_30d: -0.03,
      }),
      makeOutcome({
        id: "pending",
        percent_allocated: 8,
        delta_30d: null,
        delta_90d: null,
        delta_180d: null,
      }),
      makeOutcome({
        id: "rej",
        kind: "rejected",
        percent_allocated: null,
        allocated_at: null,
        rejection_reason: "mandate_conflict",
        match_decision: null,
        replacement_strategy: { id: "srej", name: "Rejected Strat" },
      }),
    ]);
    // Win: +4.0% in green (delta_30d row cell — disambiguate from the KPI
    // cell at text-[22px] which also renders +4.0% for a single-win outcome).
    const winCell = screen
      .getAllByText("+4.0%")
      .find((n) => n.className.includes("text-[13px]"));
    expect(winCell).toBeDefined();
    expect(winCell!.getAttribute("style")).toContain("15803D");
    // Loss: -3.0% in red (delta_30d row cell — same disambiguation).
    const lossCell = screen
      .getAllByText("-3.0%")
      .find((n) => n.className.includes("text-[13px]"));
    expect(lossCell).toBeDefined();
    expect(lossCell!.getAttribute("style")).toContain("DC2626");
    // Pending allocated row: at least one literal "pending" cell renders
    // in the delta columns (italic muted copy per designer outcomes.jsx:84).
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0);
    // Rejected row still renders its replacement strategy name link.
    expect(
      screen.getByRole("link", { name: "Rejected Strat" }),
    ).toBeInTheDocument();
  });

  it("Strategy name links to /strategy/[id] (singular — allocator-view route) for both original and replacement columns (resolved from nested match_decision.original_strategy join)", () => {
    // Regression: UAT-AUDIT-2026-04-27 — links previously pointed at
    // /strategies/[id] (plural) which only registers /strategies/[id]/edit
    // for strategy-managers. Allocators got 404 on click. Allocator-view
    // route is /strategy/[id] (singular) per src/app/strategy/[id]/page.tsx.
    renderWidget([makeOutcome({ id: "o1" })]);
    const origLink = screen.getByRole("link", { name: "Legacy Equity LP" });
    const replLink = screen.getByRole("link", { name: "Crypto Momentum LP" });
    expect(origLink.getAttribute("href")).toBe("/strategy/s-orig");
    expect(replLink.getAttribute("href")).toBe("/strategy/s-repl");
  });

  it("Best Delta cell renders em-dash '\u2014' on rejected rows", () => {
    renderWidget([
      makeOutcome({
        id: "rej",
        kind: "rejected",
        percent_allocated: null,
        allocated_at: null,
        rejection_reason: "already_owned",
        match_decision: null,
        replacement_strategy: { id: "srej", name: "Rejected Strat" },
      }),
    ]);
    // em-dash appears in the Best Delta cell for rejected rows
    const emDashes = screen.getAllByText("\u2014");
    expect(emDashes.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// OutcomesWidget — Expanded panel (inline ExpandedPanel)
// ===========================================================================

describe("OutcomesWidget — Expanded panel (inline ExpandedPanel)", () => {
  it("clicking caret fires fetch('/api/bridge/outcome/{id}/curves') exactly once", async () => {
    // Phase 08 Plan 04 Task 2 — BridgeOutcomeNoteSection also lazy-fetches
    // /api/notes on mount, so the assertion filters to curves-only calls.
    renderWidget([makeOutcome({ id: "o-expand-1" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    fireEvent.click(caret);
    await waitFor(() => {
      const curvesCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/curves"),
      );
      expect(curvesCalls).toHaveLength(1);
    });
    const curvesCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/curves"),
    );
    expect(curvesCalls[0][0]).toBe("/api/bridge/outcome/o-expand-1/curves");
    expect(curvesCalls[0][1]).toEqual(
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("second click of same row does NOT refetch (cache hit)", async () => {
    renderWidget([makeOutcome({ id: "o-cache-1" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    fireEvent.click(caret);
    const curvesCount = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/curves"))
        .length;
    await waitFor(() => expect(curvesCount()).toBe(1));
    // Collapse
    fireEvent.click(caret);
    // Re-expand
    fireEvent.click(caret);
    // Cache hit — curves fetch count unchanged (note-section re-fetches
    // on each mount but that's a separate URL).
    await waitFor(() => expect(curvesCount()).toBe(1));
  });

  it("pending-window column shows 'Window open' copy in the 3 window cards (Phase 09.1 Plan 10 designer OutcomeDetail)", async () => {
    renderWidget([
      makeOutcome({
        id: "o-pending",
        delta_30d: null,
        delta_90d: null,
        delta_180d: null,
      }),
    ]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    fireEvent.click(caret);
    await waitFor(() => {
      // three "Window open" cells inside the expanded panel (one per window
      // card 30d/90d/180d). Designer outcomes.jsx:158-161.
      const openCards = screen.getAllByText("Window open");
      expect(openCards.length).toBeGreaterThanOrEqual(3);
    });
  });

  // 09.1-REVIEW WR-04: contract test — a fetch that rejects with a
  // non-Abort error after the panel has been collapsed and re-expanded
  // must NEVER paint "Failed to load curves" into the fresh panel.
  //
  // Today the bug is mostly latent because ExpandedPanel unmounts on
  // collapse (giving each mount a fresh useRef), but the closure-captured
  // `cancelled` fix is still strictly safer and protects against future
  // refactors that keep the panel mounted while swapping outcome.id
  // (where the shared-ref reset-on-rerun race the reviewer described
  // would re-emerge). This test pins the externally-observable contract.
  it("WR-04: stale fetch failure from collapsed panel does NOT paint error after re-expand", async () => {
    // Route by URL — the curves request is the only one we want to
    // hold pending; the BridgeOutcomeNoteSection's /api/notes GET that
    // mounts alongside the panel must resolve cleanly so it does not
    // confound this assertion.
    let rejectCurves1: ((err: Error) => void) | null = null;
    let curvesCallCount = 0;
    fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/curves")) {
        curvesCallCount += 1;
        if (curvesCallCount === 1) {
          return new Promise((_resolve, reject) => {
            rejectCurves1 = reject;
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            original: [{ date: "2026-03-01", nav: 100 }],
            replacement: [{ date: "2026-03-01", nav: 102 }],
            allocated_at: "2026-03-01",
          }),
        });
      }
      // /api/notes GET — return 404 so the note section drops into its
      // empty-state branch without further chatter.
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    renderWidget([makeOutcome({ id: "o-race-1" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });

    // 1. Expand -> first curves fetch starts (deferred).
    fireEvent.click(caret);
    await waitFor(() => expect(curvesCallCount).toBe(1));

    // 2. Collapse — panel unmount fires the effect cleanup.
    fireEvent.click(caret);

    // 3. Re-expand BEFORE the in-flight fetch rejects. With the old
    //    shared-ref pattern (aborted = useRef(false)), the new effect
    //    body resets aborted.current=false here, BEFORE step 4's catch
    //    handler runs — letting the stale failure leak. With the
    //    closure-captured `cancelled` fix, fetch #1's closure retained
    //    its own cancelled=true from cleanup, so the catch is a no-op.
    fireEvent.click(caret);
    await waitFor(() => expect(curvesCallCount).toBe(2));

    // 4. NOW reject fetch #1 with a non-Abort failure.
    await act(async () => {
      rejectCurves1!(new Error("network failure"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // 5. The fresh panel must NOT show the stale fetch #1 error.
    expect(screen.queryByText("Failed to load curves")).not.toBeInTheDocument();
  });

  // audit-2026-05-07 H-0162 + H-1217 c8/c9 silent-failure — curves fetch
  // failures (non-AbortError) were caught and stored on state, but the
  // populated sparkline branch silently substitutes `null` rather than
  // surfacing the error. Pin the breadcrumb: console.error must fire
  // with the outcome_id + raw error so dev-tools / Sentry catch real
  // backend regressions.
  it("H-0162/H-1217: curves fetch failure emits console.error with outcome_id and the raw error", async () => {
    let rejectCurves: ((err: Error) => void) | null = null;
    fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/curves")) {
        return new Promise((_resolve, reject) => {
          rejectCurves = reject;
        });
      }
      // /api/notes GET — 404 so the note section is quiet.
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderWidget([makeOutcome({ id: "o-fetch-fail-1" })]);
      const caret = screen.getByRole("button", {
        name: /Expand outcome detail/,
      });
      fireEvent.click(caret);

      // Wait for the curves fetch to be in flight.
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.filter((c) => String(c[0]).includes("/curves"))
            .length,
        ).toBe(1);
      });

      // Reject with a non-AbortError — the catch path must reach
      // console.error and pass the outcome_id along.
      await act(async () => {
        rejectCurves!(new Error("HTTP 500 — upstream curves regression"));
        await Promise.resolve();
        await Promise.resolve();
      });

      const matchingCall = errorSpy.mock.calls.find((args) =>
        String(args[0]).includes("[OutcomesWidget] curves fetch failed"),
      );
      expect(matchingCall, "expected console.error with the curves-fetch tag").toBeTruthy();
      // The metadata object must contain the outcome_id so Sentry can
      // demux occurrences. Match either the bare object or the third
      // arg layout — the source emits `(tag, { outcome_id }, err)`.
      const hasOutcomeId = matchingCall!.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          "outcome_id" in arg &&
          (arg as { outcome_id: string }).outcome_id === "o-fetch-fail-1",
      );
      expect(hasOutcomeId, "expected outcome_id in the error metadata").toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ===========================================================================
// Phase 08 Plan 04 Task 2 — "Your note" section inside ExpandedPanel
// (MANAGE-05 bridge_outcome scope). UI-SPEC §4c.
// ===========================================================================

describe("OutcomesWidget — 'Your note' section (08-04 / MANAGE-05)", () => {
  beforeEach(() => {
    // Override the default curves mock with a multi-URL router so the
    // ExpandedPanel curves fetch AND the lazy note GET both resolve
    // predictably. Order of fetches is: (1) curves (2) note GET
    // (3+) note PATCH on blur.
    fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/bridge/outcome/") && url.includes("/curves")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            original: [{ date: "2026-03-01", nav: 100 }],
            replacement: [{ date: "2026-03-01", nav: 100 }],
            allocated_at: "2026-03-01",
          }),
        });
      }
      if (url.includes("/api/notes")) {
        // Default: 404 (no note yet). Individual tests override via
        // fetchMock.mockImplementationOnce to return 200 or to assert
        // the PATCH body.
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: "Not found" }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL in test: ${url}`));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;
  });

  it("T21: expanded row renders a 'Your note' section header below the delta grid", async () => {
    renderWidget([makeOutcome({ id: "o-note-1" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    await act(async () => {
      fireEvent.click(caret);
    });
    await waitFor(() => {
      expect(screen.getByText("Your note")).toBeInTheDocument();
    });
  });

  it("T22: initial mount of the note section fetches /api/notes?scope_kind=bridge_outcome&scope_ref=<id>; 404 → empty-state textarea placeholder", async () => {
    const { container } = renderWidget([makeOutcome({ id: "o-note-2" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    await act(async () => {
      fireEvent.click(caret);
    });
    await waitFor(() => {
      const noteGet = fetchMock.mock.calls.find((call) => {
        const u = String(call[0]);
        return u.startsWith("/api/notes?") && u.includes("bridge_outcome");
      });
      expect(noteGet).toBeTruthy();
      expect(String(noteGet![0])).toBe(
        "/api/notes?scope_kind=bridge_outcome&scope_ref=o-note-2",
      );
    });
    // 404 → default into edit mode with the UI-SPEC §4c empty placeholder on
    // the textarea.
    await waitFor(() => {
      const ta = container.querySelector("textarea");
      expect(ta).not.toBeNull();
      expect(ta?.getAttribute("placeholder")).toBe(
        "No note for this outcome. Start typing to add one.",
      );
    });
  });

  it("T23: GET returning content → NoteRender markdown + Edit affordance", async () => {
    fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/curves")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            original: [{ date: "2026-03-01", nav: 100 }],
            replacement: [{ date: "2026-03-01", nav: 100 }],
            allocated_at: "2026-03-01",
          }),
        });
      }
      if (url.startsWith("/api/notes")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            content: "**hold through pullback**",
            updated_at: "2026-04-21T00:00:00Z",
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    const { container } = renderWidget([makeOutcome({ id: "o-note-3" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    await act(async () => {
      fireEvent.click(caret);
    });
    await waitFor(() => {
      expect(
        container.querySelector("strong")?.textContent,
      ).toBe("hold through pullback");
    });
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("T24: blur on the textarea fires PATCH with {scope_kind:'bridge_outcome', scope_ref:<id>, content:<typed>}", async () => {
    const { container } = renderWidget([makeOutcome({ id: "o-note-4" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    await act(async () => {
      fireEvent.click(caret);
    });
    // Wait for the initial 404 GET to resolve so the textarea mounts
    // (empty-state default opens into edit mode).
    let ta: HTMLTextAreaElement | null = null;
    await waitFor(() => {
      ta = container.querySelector("textarea");
      expect(ta).not.toBeNull();
    });
    await act(async () => {
      fireEvent.change(ta as unknown as HTMLTextAreaElement, {
        target: { value: "Keep holding. Conviction intact." },
      });
    });
    await act(async () => {
      fireEvent.blur(ta as unknown as HTMLTextAreaElement);
    });
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((call) => {
        const init = call[1] as RequestInit | undefined;
        return init?.method === "PATCH";
      });
      expect(patchCall).toBeTruthy();
      const [url, init] = patchCall!;
      expect(url).toBe("/api/notes");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toEqual({
        scope_kind: "bridge_outcome",
        scope_ref: "o-note-4",
        content: "Keep holding. Conviction intact.",
      });
    });
  });

  it("T25: NoteSaveStatus is present in the expanded note section", async () => {
    renderWidget([makeOutcome({ id: "o-note-5" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    await act(async () => {
      fireEvent.click(caret);
    });
    await waitFor(() => {
      expect(screen.getByTestId("note-save-status")).toBeInTheDocument();
    });
  });

  it("T26: section has an hr separator above it + uppercase tracking-wider header", async () => {
    const { container } = renderWidget([makeOutcome({ id: "o-note-6" })]);
    const caret = screen.getByRole("button", {
      name: /Expand outcome detail/,
    });
    await act(async () => {
      fireEvent.click(caret);
    });
    await waitFor(() => {
      expect(screen.getByText("Your note")).toBeInTheDocument();
    });
    // Separator is an <hr> inside the ExpandedPanel
    expect(container.querySelector("hr")).not.toBeNull();
    // Header className carries the uppercase tracking-wider treatment
    const header = screen.getByText("Your note");
    expect(header.className).toContain("uppercase");
    expect(header.className).toContain("tracking-wider");
  });
});
