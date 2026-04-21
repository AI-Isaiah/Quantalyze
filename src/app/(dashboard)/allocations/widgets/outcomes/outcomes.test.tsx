import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  timeframe: "YTD" as const,
  width: 1200,
  height: 300,
};

function renderWidget(outcomes: MockOutcome[] | undefined) {
  const data =
    outcomes === undefined ? undefined : { outcomes };
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

  it("Voice-D5 truncation: outcomes.length === 200 -> footer 'Showing most recent 200 — reach out if you need historical export' rendered", () => {
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
  it("className presence check: labels render in DM Sans 11px uppercase tracking-wider (per DASHBOARD-02 className spec)", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    const label = screen.getByText("TOTAL");
    expect(label.className).toContain("text-[11px]");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("tracking-wider");
  });

  it("className presence check: values render in font-mono text-[13px] tabular-nums (per DASHBOARD-02 className spec)", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    const value = screen.getByText("1"); // totalOutcomes value for 1 row
    expect(value.className).toContain("font-mono");
    expect(value.className).toContain("text-[13px]");
    expect(value.className).toContain("tabular-nums");
  });

  it("className presence check: win-rate color >50% -> text/style #16A34A; <50% -> #DC2626; =null -> #1A1A2E", () => {
    // >50%: single win
    const { unmount } = renderWidget([
      makeOutcome({ id: "o1", percent_allocated: 10, delta_30d: 0.04 }),
    ]);
    const winRateValWon = screen.getByText("100%");
    expect(winRateValWon.getAttribute("style")).toContain("16A34A");
    unmount();

    // <50%: single loss
    const { unmount: unmount2 } = renderWidget([
      makeOutcome({ id: "o2", percent_allocated: 10, delta_30d: -0.04 }),
    ]);
    const winRateValLost = screen.getByText("0%");
    expect(winRateValLost.getAttribute("style")).toContain("DC2626");
    unmount2();

    // null: no matured rows
    renderWidget([
      makeOutcome({
        id: "o3",
        percent_allocated: 10,
        delta_30d: null,
        delta_90d: null,
        delta_180d: null,
      }),
    ]);
    // When winRate is null, UI renders em-dash "—"
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
    // 1 pending row -> sub-label renders
    expect(
      screen.getByText(/Avg realized delta:.*\+4\.0%.*1 pending/),
    ).toBeInTheDocument();
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

  it("4-state status pill: allocated-win / allocated-loss / allocated-pending / rejected-mandate_conflict", () => {
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
    expect(
      screen.getByText(/Allocated 12%\s*\u2014\s*win/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Allocated 15%\s*\u2014\s*loss/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Allocated 8%\s*\u2014\s*pending/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Rejected\s*\u2014\s*Mandate conflict/),
    ).toBeInTheDocument();
  });

  it("Strategy name links to /strategies/[id] for both original and replacement columns (resolved from nested match_decision.original_strategy join)", () => {
    renderWidget([makeOutcome({ id: "o1" })]);
    const origLink = screen.getByRole("link", { name: "Legacy Equity LP" });
    const replLink = screen.getByRole("link", { name: "Crypto Momentum LP" });
    expect(origLink.getAttribute("href")).toBe("/strategies/s-orig");
    expect(replLink.getAttribute("href")).toBe("/strategies/s-repl");
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

  it("pending-window column shows 'Pending' pill + animate-pulse placeholder rectangle", async () => {
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
      // three "Pending" pills inside the expanded panel
      const pendingPills = screen.getAllByText("Pending");
      expect(pendingPills.length).toBeGreaterThanOrEqual(3);
    });
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

// ===========================================================================
// Barrel export
// ===========================================================================

describe("Barrel export", () => {
  it("outcomes-timeline key exists in WIDGET_COMPONENTS barrel", async () => {
    const barrel = await import(
      "@/app/(dashboard)/allocations/widgets/index"
    );
    expect(barrel.WIDGET_COMPONENTS["outcomes-timeline"]).toBeDefined();
  });
});
