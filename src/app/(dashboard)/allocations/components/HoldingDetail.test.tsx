import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { HoldingDetail } from "./HoldingDetail";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

// ---------------------------------------------------------------------------
// H-0091 — HoldingDetail.tsx shipped with no dedicated test. It is the 3-tab
// sub-row body (Metrics / Record outcome / Notes). These tests pin:
//   - Metrics tab is the default and renders the per-holding stats.
//   - Tab switching toggles aria-selected + the visible tabpanel.
//   - Record-outcome gating: no candidate → guidance copy; candidate →
//     OutcomeForm mounts (mocked) with the candidate strategy id.
//   - Notes tab lazily GETs /api/notes ONCE on first activation and seeds the
//     editor with the fetched content.
//
// Note primitives + OutcomeForm are mocked so the test focuses on
// HoldingDetail's own tab routing + lazy-fetch wiring.
// ---------------------------------------------------------------------------

vi.mock("@/components/notes/NoteRender", () => ({
  NoteRender: ({ content }: { content: string }) => (
    <div data-testid="note-render">{content}</div>
  ),
}));
vi.mock("@/components/notes/NoteSaveStatus", () => ({
  NoteSaveStatus: () => <div data-testid="note-save-status" />,
}));
// `save` is a module-level spy so the loud-fail tests can assert that a
// failed/errored note load NEVER triggers a destructive PUT on blur.
const saveSpy = vi.fn();
vi.mock("@/components/notes/useNoteAutoSave", () => ({
  useNoteAutoSave: () => ({
    saveState: "idle",
    lastSavedAt: null,
    save: saveSpy,
  }),
}));
vi.mock("./OutcomeForm", () => ({
  OutcomeForm: (props: { strategyId: string }) => (
    <div data-testid="outcome-form" data-strategy-id={props.strategyId}>
      mock outcome form
    </div>
  ),
}));

function makeRow(overrides: Partial<DesignHoldingRow> = {}): DesignHoldingRow {
  return {
    id: "holding:okx:BTC:spot",
    venue: "okx",
    symbol: "BTC",
    holding_type: "spot",
    strategy: "Test Strategy",
    manager: "MGR-1",
    tag: "trend",
    alloc: 250_000,
    weight: 0.42,
    mtd: 0.031,
    sharpe: 1.7,
    dd: -0.12,
    age: 64,
    status: "ok",
    bridgeCandidate: false,
    ...overrides,
  };
}

describe("HoldingDetail — H-0091", () => {
  beforeEach(() => {
    saveSpy.mockClear();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: "Seeded note body",
            updated_at: "2026-04-01T00:00:00Z",
          }),
      }),
    ) as unknown as typeof fetch;
  });

  it("renders the Metrics tab selected by default with per-holding stats", () => {
    render(<HoldingDetail row={makeRow()} />);
    const region = screen.getByRole("region", {
      name: /Holding detail for BTC/,
    });
    const metricsTab = within(region).getByRole("tab", { name: "Metrics" });
    expect(metricsTab).toHaveAttribute("aria-selected", "true");
    const panel = within(region).getByRole("tabpanel", { name: "Metrics" });
    // Allocation $250,000 formatted as USD with no fraction digits.
    expect(within(panel).getByText("$250,000")).toBeInTheDocument();
    // Age renders with the "d" suffix.
    expect(within(panel).getByText("64d")).toBeInTheDocument();
    // Metric labels present.
    expect(within(panel).getByText("Allocation")).toBeInTheDocument();
    expect(within(panel).getByText("Sharpe")).toBeInTheDocument();
  });

  it("clicking the 'Record outcome' tab switches aria-selected and shows that tabpanel", () => {
    render(<HoldingDetail row={makeRow()} />);
    const outcomeTab = screen.getByRole("tab", { name: "Record outcome" });
    fireEvent.click(outcomeTab);
    expect(outcomeTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Metrics" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.getByRole("tabpanel", { name: "Record outcome" }),
    ).toBeInTheDocument();
  });

  it("Record-outcome tab with no candidate → renders the no-candidate guidance, not the form", () => {
    render(<HoldingDetail row={makeRow()} topCandidateStrategyId={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Record outcome" }));
    expect(
      screen.getByText(/not flagged for Bridge action/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("outcome-form")).not.toBeInTheDocument();
  });

  it("Record-outcome tab WITH a candidate → mounts OutcomeForm threaded the candidate strategy id", () => {
    render(
      <HoldingDetail row={makeRow()} topCandidateStrategyId="strat-cand-9" />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Record outcome" }));
    const form = screen.getByTestId("outcome-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-strategy-id", "strat-cand-9");
  });

  it("Notes tab lazily GETs /api/notes once on first activation and seeds the editor", async () => {
    render(<HoldingDetail row={makeRow()} />);
    // No fetch before the Notes tab is opened (Metrics is default).
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as unknown as [string];
    expect(url).toContain("/api/notes");
    expect(url).toContain("scope_kind=holding");
    // Fetched content seeds the editor; with content present the view is the
    // rendered note (not edit mode).
    await waitFor(() =>
      expect(screen.getByTestId("note-render")).toHaveTextContent(
        "Seeded note body",
      ),
    );
  });

  it("Notes tab fetch fires only once even after switching tabs away and back", async () => {
    render(<HoldingDetail row={makeRow()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    // noteLoaded guard prevents a second GET.
    await waitFor(() =>
      expect(screen.getByTestId("note-render")).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // F1 loud-fail discipline — H-0092 / H-0093 / H-1216 / M-0075.
  //
  // A non-OK /api/notes GET (401/403/429/5xx) or a thrown network error must
  // NOT be conflated with a genuine 404 "no note yet". The pre-fix code routed
  // EVERY non-OK into edit mode with an empty draft, and onNoteBlur then PUT
  // that empty draft over the unread server note — silent data loss. These
  // tests pin: (1) a 404 still opens the empty editor (happy empty-state),
  // (2) a 500 / network error renders a distinct error+retry state, NOT the
  // editor, and (3) the destructive save() is never invoked on the error path.
  // -------------------------------------------------------------------------

  function mockNotesGet(opts: { ok: boolean; status: number }) {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: opts.ok,
        status: opts.status,
        json: () => Promise.resolve({}),
      }),
    ) as unknown as typeof fetch;
  }

  it("404 → genuine empty: opens the editor (no note yet), not the error state", async () => {
    mockNotesGet({ ok: false, status: 404 });
    render(<HoldingDetail row={makeRow()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    // Editor (textarea) is shown for the legitimately-empty case.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/No note yet/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("500 → distinct error+retry state; never the empty editor", async () => {
    mockNotesGet({ ok: false, status: 500 });
    render(<HoldingDetail row={makeRow()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't load your note/i);
    expect(
      within(alert).getByRole("button", { name: /Retry/i }),
    ).toBeInTheDocument();
    // The misleading empty editor must NOT render on a transport failure.
    expect(
      screen.queryByPlaceholderText(/No note yet/i),
    ).not.toBeInTheDocument();
  });

  it("403 → error state, and a blur on the error path NEVER calls save() (data-loss fence)", async () => {
    mockNotesGet({ ok: false, status: 403 });
    render(<HoldingDetail row={makeRow()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    await screen.findByRole("alert");
    // No editor → no blur path is reachable, and save() was never wired to run.
    expect(saveSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByPlaceholderText(/No note yet/i),
    ).not.toBeInTheDocument();
  });

  it("network error (thrown fetch) → error state, save() not called", async () => {
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as unknown as typeof fetch;
    render(<HoldingDetail row={makeRow()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't load your note/i);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("Retry after an error refetches and recovers to the loaded note", async () => {
    mockNotesGet({ ok: false, status: 500 });
    render(<HoldingDetail row={makeRow()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    await screen.findByRole("alert");

    // Repoint fetch at a successful response, then hit Retry.
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            content: "Recovered note",
            updated_at: "2026-04-01T00:00:00Z",
          }),
      }),
    ) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    await waitFor(() =>
      expect(screen.getByTestId("note-render")).toHaveTextContent(
        "Recovered note",
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
