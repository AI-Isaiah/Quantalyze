import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OutcomeForm } from "./OutcomeForm";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

// ---------------------------------------------------------------------------
// H-0098 — OutcomeForm shipped without a dedicated test file. It owns the
// Allocated/Rejected segmented control, client-side Zod validation
// (ALLOCATED_FIELDS / REJECTED_FIELDS), the postBridgeOutcome submit, the
// success ("Outcome recorded") state, and the inline error region.
//
// postBridgeOutcome is mocked (no network) but the REAL Zod field schemas
// run, so validation assertions exercise the genuine rules — a submit that
// the schema rejects must surface an error WITHOUT calling postBridgeOutcome.
// ---------------------------------------------------------------------------

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
    id: "holding:okx:BTC:spot",
    venue: "okx",
    symbol: "BTC",
    holding_type: "spot",
    strategy: "Test Strategy",
    manager: "MGR-1",
    tag: "trend",
    alloc: 100_000,
    weight: 0.4,
    mtd: 0.02,
    sharpe: 1.4,
    dd: -0.1,
    age: 40,
    status: "ok",
    bridgeCandidate: true,
    ...overrides,
  };
}

function okResult(id = "outcome-1") {
  return {
    ok: true as const,
    outcome: {
      id,
      kind: "allocated" as const,
      percent_allocated: 5,
      allocated_at: "2026-04-24",
      rejection_reason: null,
      note: null,
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: "2026-04-24T00:00:00Z",
    },
  };
}

const TODAY = new Date().toISOString().slice(0, 10);

describe("OutcomeForm — H-0098", () => {
  beforeEach(() => {
    postBridgeOutcome.mockReset();
    postBridgeOutcome.mockResolvedValue(okResult());
  });

  it("defaults to the Allocated mode with percent + date fields", () => {
    render(<OutcomeForm strategyId="strat-1" row={makeRow()} />);
    expect(screen.getByRole("button", { name: "Allocated" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Percent allocated")).toBeInTheDocument();
    expect(screen.getByLabelText("Allocated on")).toBeInTheDocument();
  });

  it("the 'Modified (coming soon)' option is disabled and clicking it does not change mode", () => {
    render(<OutcomeForm strategyId="strat-1" row={makeRow()} />);
    const modified = screen.getByRole("button", {
      name: /Modified \(coming soon\)/i,
    });
    expect(modified).toBeDisabled();
    expect(modified).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(modified);
    expect(screen.getByRole("button", { name: "Allocated" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("valid allocated submit → calls postBridgeOutcome and renders the recorded success state", async () => {
    const onRecorded = vi.fn();
    postBridgeOutcome.mockResolvedValueOnce(okResult("outcome-77"));
    render(
      <OutcomeForm strategyId="strat-1" row={makeRow()} onRecorded={onRecorded} />,
    );
    fireEvent.change(screen.getByLabelText("Percent allocated"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Allocated on"), {
      target: { value: TODAY },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record allocation/i }));

    await waitFor(() =>
      expect(screen.getByTestId("outcome-form-recorded")).toBeInTheDocument(),
    );
    expect(postBridgeOutcome).toHaveBeenCalledTimes(1);
    const arg = postBridgeOutcome.mock.calls[0][0] as unknown as {
      strategyId: string;
      kind: string;
      values: { percent_allocated: number };
    };
    expect(arg.strategyId).toBe("strat-1");
    expect(arg.kind).toBe("allocated");
    expect(arg.values.percent_allocated).toBe(5);
    expect(onRecorded).toHaveBeenCalledWith("outcome-77");
  });

  it("allocated submit with an out-of-range percent → Zod rejects, error shown, postBridgeOutcome NOT called", async () => {
    render(<OutcomeForm strategyId="strat-1" row={makeRow()} />);
    // 99 exceeds the max(50) rule in ALLOCATED_FIELDS.
    fireEvent.change(screen.getByLabelText("Percent allocated"), {
      target: { value: "99" },
    });
    fireEvent.change(screen.getByLabelText("Allocated on"), {
      target: { value: TODAY },
    });
    // Submit the form element directly — jsdom would otherwise block the
    // submit on the input's HTML max=50 constraint before handleSubmit (and
    // its Zod check) runs; dispatching `submit` exercises the component's
    // own validation path, which is what this finding targets.
    fireEvent.submit(screen.getByTestId("outcome-form"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(postBridgeOutcome).not.toHaveBeenCalled();
  });

  it("switching to Rejected swaps the form to a reason select + danger submit button", () => {
    render(<OutcomeForm strategyId="strat-1" row={makeRow()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    expect(screen.getByLabelText("Why not?")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Record rejection/i }),
    ).toBeInTheDocument();
    // Allocated-only fields gone.
    expect(screen.queryByLabelText("Percent allocated")).not.toBeInTheDocument();
  });

  it("rejected with reason 'other' but no note → Zod requires a note, error shown, no POST", async () => {
    render(<OutcomeForm strategyId="strat-1" row={makeRow()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    fireEvent.change(screen.getByLabelText("Why not?"), {
      target: { value: "other" },
    });
    // Leave the note empty — REJECTED_FIELDS.superRefine requires it. The
    // note input becomes `required` in this state, so submit the form
    // directly to reach the component's Zod check rather than being blocked
    // by jsdom's native required-field validation.
    fireEvent.submit(screen.getByTestId("outcome-form"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Add a note when reason is Other/i,
      ),
    );
    expect(postBridgeOutcome).not.toHaveBeenCalled();
  });

  it("rejected with reason 'other' + a note → valid, posts kind='rejected'", async () => {
    postBridgeOutcome.mockResolvedValueOnce({
      ...okResult("outcome-rej"),
      outcome: { ...okResult().outcome, id: "outcome-rej", kind: "rejected" },
    });
    render(<OutcomeForm strategyId="strat-1" row={makeRow()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    fireEvent.change(screen.getByLabelText("Why not?"), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText("Note (required)"), {
      target: { value: "Conflicts with the income mandate." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record rejection/i }));

    await waitFor(() =>
      expect(screen.getByTestId("outcome-form-recorded")).toBeInTheDocument(),
    );
    const arg = postBridgeOutcome.mock.calls[0][0] as unknown as {
      kind: string;
      values: { rejection_reason: string };
    };
    expect(arg.kind).toBe("rejected");
    expect(arg.values.rejection_reason).toBe("other");
  });

  it("server failure → surfaces the returned error and does NOT show the recorded state", async () => {
    postBridgeOutcome.mockResolvedValueOnce({
      ok: false,
      error: "Too many submissions — try again in a moment",
    });
    render(<OutcomeForm strategyId="strat-1" row={makeRow()} />);
    fireEvent.change(screen.getByLabelText("Percent allocated"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Allocated on"), {
      target: { value: TODAY },
    });
    fireEvent.click(screen.getByRole("button", { name: /Record allocation/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Too many submissions/i,
      ),
    );
    expect(screen.queryByTestId("outcome-form-recorded")).not.toBeInTheDocument();
  });
});
