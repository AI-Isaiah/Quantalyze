import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

// next/navigation mock — HoldingsTable calls useRouter() for the banner
// dismiss handler.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// H-0094 — sub-row expanded-state ERROR paths uncovered:
//   (a) postBridgeOutcome failure → inline error, row stays expanded.
//   (b) /api/notes 5xx → Notes tab degrades to the empty-note edit affordance
//       (placeholder) rather than crashing or hanging on "Loading…".
//   (c) OutcomeForm validation reject → inline error, NO postBridgeOutcome,
//       row stays expanded.
//
// The existing HoldingsTable.sub-row.test.tsx only exercises the happy path
// (postBridgeOutcome resolves ok:true, /api/notes returns 200). This file
// captures the failure branches with controllable mocks.
// ---------------------------------------------------------------------------

vi.mock("@/components/notes/NoteRender", () => ({
  NoteRender: ({ content }: { content: string }) => (
    <div data-testid="note-render">{content}</div>
  ),
}));
vi.mock("@/components/notes/NoteSaveStatus", () => ({
  NoteSaveStatus: () => <div data-testid="note-save-status" />,
}));
vi.mock("@/components/notes/useNoteAutoSave", () => ({
  useNoteAutoSave: () => ({
    saveState: "idle",
    lastSavedAt: null,
    save: vi.fn(),
  }),
}));
vi.mock("./BridgeOutcomeBanner", () => ({
  BridgeOutcomeBanner: (props: { strategyId: string }) => (
    <div data-testid="bridge-outcome-banner" data-strategy-id={props.strategyId}>
      mock banner
    </div>
  ),
}));

// Controllable postBridgeOutcome mock (captured so each test can set the
// resolved/rejected result). The real Zod field schemas are preserved so the
// validation-reject case exercises the genuine rules.
const postBridgeOutcome = vi.fn();
vi.mock("@/lib/bridge-outcome-schema", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bridge-outcome-schema")>(
      "@/lib/bridge-outcome-schema",
    );
  return {
    ...actual,
    postBridgeOutcome: (args: unknown) => postBridgeOutcome(args),
  };
});

function makeRow(overrides: Partial<DesignHoldingRow> = {}): DesignHoldingRow {
  return {
    id: "holding:binance:BTC:spot",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    strategy: "Test Strategy",
    manager: "TST-001",
    tag: "trend",
    alloc: 100_000,
    weight: 0.5,
    mtd: 0.02,
    sharpe: 1.5,
    dd: -0.08,
    age: 90,
    status: "ok",
    bridgeCandidate: true,
    ...overrides,
  };
}

const FLAGGED_BY_REF = {
  "holding:binance:BTC:spot": { top_candidate_strategy_id: "strat-123" },
};

const TODAY = new Date().toISOString().slice(0, 10);

function expandAndOpenOutcomeTab() {
  fireEvent.click(screen.getByText("Test Strategy"));
  fireEvent.click(screen.getByRole("tab", { name: "Record outcome" }));
}

describe("HoldingsTable sub-row error paths — H-0094", () => {
  beforeEach(() => {
    postBridgeOutcome.mockReset();
    // Default: /api/notes returns 200 ok with an empty note.
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: "", updated_at: null }),
      }),
    ) as unknown as typeof fetch;
  });

  it("(a) postBridgeOutcome failure → inline error rendered + row stays expanded (not collapsed)", async () => {
    postBridgeOutcome.mockResolvedValue({
      ok: false,
      error: "Couldn't record outcome — try again",
    });
    render(<HoldingsTable rows={[makeRow()]} flaggedHoldingsByRef={FLAGGED_BY_REF} />);
    expandAndOpenOutcomeTab();

    fireEvent.change(screen.getByLabelText("Percent allocated"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Allocated on"), {
      target: { value: TODAY },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record allocation/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Couldn't record outcome/i,
      ),
    );
    expect(postBridgeOutcome).toHaveBeenCalledTimes(1);
    // onRecorded collapses the row; on failure it must NOT fire, so the
    // sub-row region stays mounted.
    expect(
      screen.getByRole("region", { name: /Holding detail for BTC/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("outcome-form")).toBeInTheDocument();
  });

  it("(b) /api/notes 5xx → Notes tab shows a load-error (not the empty-note textarea), so blur-save can't overwrite the unread note (H-0092/H-0093/H-1216)", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    ) as unknown as typeof fetch;

    render(<HoldingsTable rows={[makeRow()]} flaggedHoldingsByRef={FLAGGED_BY_REF} />);
    fireEvent.click(screen.getByText("Test Strategy"));
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    // After a non-404 failed GET, the component MUST distinguish "couldn't
    // load" from "no note yet": it renders a load-error alert + Retry, NOT the
    // empty editor. Showing the placeholder textarea here was the data-loss
    // bug (blur then PUTs an empty draft over the unread server note).
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Couldn't load your note/i,
      ),
    );
    expect(
      screen.getByRole("button", { name: /Retry/i }),
    ).toBeInTheDocument();
    // The empty-note editor must NOT be presented on a load failure.
    expect(
      screen.queryByPlaceholderText("No note yet. Start typing to add one."),
    ).not.toBeInTheDocument();
    // And it must not be stuck on "Loading…".
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("(c) OutcomeForm validation reject (out-of-range percent) → inline error, NO postBridgeOutcome, row stays expanded", async () => {
    render(<HoldingsTable rows={[makeRow()]} flaggedHoldingsByRef={FLAGGED_BY_REF} />);
    expandAndOpenOutcomeTab();

    fireEvent.change(screen.getByLabelText("Percent allocated"), {
      target: { value: "99" }, // exceeds max(50)
    });
    fireEvent.change(screen.getByLabelText("Allocated on"), {
      target: { value: TODAY },
    });
    // Submit the form directly so jsdom's native max-constraint doesn't block
    // the component's own Zod validation path.
    fireEvent.submit(screen.getByTestId("outcome-form"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(postBridgeOutcome).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: /Holding detail for BTC/ }),
    ).toBeInTheDocument();
  });
});
