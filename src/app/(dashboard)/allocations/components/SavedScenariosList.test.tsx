/**
 * Phase 23 Plan 05 / Task 1 — RED tests for SavedScenariosList.
 *
 * The saved-scenarios surface on the Scenario tab (PERSIST-03): list rows with
 * Open / Rename / Delete + selection checkboxes + a "Live book" pseudo-row + a
 * "Compare selected" CTA, and an honest EmptyStateCard when none exist.
 *
 * Honesty + UI-SPEC invariants pinned here:
 *   - Empty list → EmptyStateCard heading "No saved scenarios yet" matches the
 *     UI-SPEC body (the #509 heading-matches-body lesson).
 *   - Rename → inline edit input (NOT a modal) → PATCH with the TRIMMED name;
 *     empty / >120 shows the validation copy and does NOT PATCH.
 *   - Delete → small inline "Delete "{name}"?" confirm (NOT a modal) → DELETE →
 *     row removed from the list.
 *   - Selection checkboxes are keyboard-focusable + name-labeled; a "Live book"
 *     pseudo-row participates in selection.
 *   - "Compare selected" disabled until >= 2 selections, enabled at >= 2; on
 *     click it raises the selected rows + includeLiveBook to the parent.
 *
 * Rows do NOT stamp N/overlap (only name + timestamp) — N is a per-COLUMN stamp
 * in the compare table, not cheaply available on the list metadata.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { SavedScenariosList } from "./SavedScenariosList";
import type { SavedScenarioListRow } from "./SavedScenariosList";

// fetch is the wire to the Plan-02 CRUD routes (PATCH rename / DELETE).
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ROWS: SavedScenarioListRow[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Conservative blend",
    schema_version: 2,
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
    draft: { schema_version: 2 },
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Aggressive tilt",
    schema_version: 2,
    created_at: "2026-06-03T10:00:00Z",
    updated_at: "2026-06-03T12:00:00Z",
    draft: { schema_version: 2 },
  },
];

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe("SavedScenariosList (Plan 23-05 Task 1)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okJson({}));
  });

  // -------------------------------------------------------------------------
  // T_SL1 — Empty state: heading matches body (EmptyStateCard, #509 lesson).
  // -------------------------------------------------------------------------
  it("T_SL1 empty list renders the EmptyStateCard with the UI-SPEC heading + body", () => {
    render(
      <SavedScenariosList rows={[]} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    expect(screen.getByText("No saved scenarios yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Compose a draft above, then choose/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reopen into the composer and can be compared/i),
    ).toBeInTheDocument();
    // No rows, no compare CTA usable.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_SL2 — One row per scenario: name + timestamp; right-side affordances.
  // -------------------------------------------------------------------------
  it("T_SL2 renders one row per scenario with name + Open/Rename/Delete", () => {
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    expect(screen.getByText("Conservative blend")).toBeInTheDocument();
    expect(screen.getByText("Aggressive tilt")).toBeInTheDocument();
    // Two real rows each carry Open / Rename / Delete affordances.
    expect(screen.getAllByRole("button", { name: /^Open$/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Rename$/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Delete$/ })).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // T_SL3 — Open delegates the row to the parent (composer Open handler).
  // -------------------------------------------------------------------------
  it("T_SL3 Open raises the row to onOpen (delegates to the composer Open handler)", () => {
    const onOpen = vi.fn();
    render(
      <SavedScenariosList rows={ROWS} onOpen={onOpen} onCompare={vi.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Open$/ })[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: ROWS[0].id, name: ROWS[0].name }),
    );
  });

  // -------------------------------------------------------------------------
  // T_SL4 — Rename: inline edit (NOT a modal) → PATCH with the TRIMMED name.
  // -------------------------------------------------------------------------
  it("T_SL4 Rename reveals an inline input and PATCHes the trimmed name", async () => {
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Rename$/ })[0]);
    // Inline input, NOT a modal.
    expect(screen.queryByRole("dialog")).toBeNull();
    const input = screen.getByLabelText(/rename scenario/i);
    fireEvent.change(input, { target: { value: "  Renamed blend  " } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(`/api/allocator/scenario/saved/${ROWS[0].id}`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "Renamed blend",
    });
    // The new name is reflected in the row.
    await screen.findByText("Renamed blend");
  });

  // -------------------------------------------------------------------------
  // T_SL5 — Rename validation: empty / >120 shows copy and does NOT PATCH.
  // -------------------------------------------------------------------------
  it("T_SL5 empty or over-long rename shows the validation copy and does not PATCH", () => {
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Rename$/ })[0]);
    const input = screen.getByLabelText(/rename scenario/i);

    // Empty (whitespace) → validation copy, no PATCH.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(
      screen.getByText("Enter a name to save this scenario."),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();

    // Too long → validation copy, no PATCH.
    fireEvent.change(input, { target: { value: "x".repeat(121) } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(
      screen.getByText("Scenario names are limited to 120 characters."),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T_SL6 — Delete: small inline danger confirm (NOT a modal) → DELETE →
  //         row removed.
  // -------------------------------------------------------------------------
  it("T_SL6 Delete shows an inline confirm (no modal) then DELETEs and removes the row", async () => {
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    const firstRow = screen
      .getByText("Conservative blend")
      .closest("[data-testid='saved-scenario-row']") as HTMLElement;
    fireEvent.click(within(firstRow).getByRole("button", { name: /^Delete$/ }));
    // Inline confirm, NOT a modal.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText('Delete "Conservative blend"?')).toBeInTheDocument();
    // Confirm + Cancel are both reachable within the targeted row.
    expect(
      within(firstRow).getByRole("button", { name: /^Cancel$/ }),
    ).toBeInTheDocument();
    // Confirm the delete (the destructive button within the confirm region).
    const confirm = within(firstRow).getByRole("button", { name: /^Delete$/ });
    fireEvent.click(confirm);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(`/api/allocator/scenario/saved/${ROWS[0].id}`);
    expect((init as RequestInit).method).toBe("DELETE");
    // Row removed from the list.
    await waitFor(() =>
      expect(screen.queryByText("Conservative blend")).toBeNull(),
    );
    expect(screen.getByText("Aggressive tilt")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SL7 — Delete Cancel dismisses the confirm without DELETE.
  // -------------------------------------------------------------------------
  it("T_SL7 Cancel dismisses the delete confirm without DELETE", () => {
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(
      screen.queryByText('Delete "Conservative blend"?'),
    ).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText("Conservative blend")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SL7b — Rename FAILURE is loud: an honest alert, no false success signal,
  //          and the row is NOT optimistically renamed (fail-loud honesty).
  // -------------------------------------------------------------------------
  it("T_SL7b Rename failure shows an honest alert and does not signal success", async () => {
    // The PATCH route returns non-ok — the only fetch this test makes.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    const onMutated = vi.fn();
    render(
      <SavedScenariosList
        rows={ROWS}
        onOpen={vi.fn()}
        onCompare={vi.fn()}
        onMutated={onMutated}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Rename$/ })[0]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Renamed blend" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    // Honest, visible failure (role=alert), with the rename-specific copy.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't rename this scenario");
    // onMutated fires ONLY on success — it must NOT fire on a failed rename
    // (proves the optimistic setLocalRows after the !ok return never ran).
    expect(onMutated).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T_SL7c — Delete FAILURE is loud: honest alert, the row is NOT optimistically
  //          removed, and no false success signal.
  // -------------------------------------------------------------------------
  it("T_SL7c Delete failure shows an honest alert and keeps the row", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    const onMutated = vi.fn();
    render(
      <SavedScenariosList
        rows={ROWS}
        onOpen={vi.fn()}
        onCompare={vi.fn()}
        onMutated={onMutated}
      />,
    );
    const firstRow = screen
      .getByText("Conservative blend")
      .closest("[data-testid='saved-scenario-row']") as HTMLElement;
    fireEvent.click(within(firstRow).getByRole("button", { name: /^Delete$/ }));
    fireEvent.click(within(firstRow).getByRole("button", { name: /^Delete$/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't delete this scenario");
    // Row NOT optimistically removed on failure.
    expect(screen.getByText("Conservative blend")).toBeInTheDocument();
    expect(onMutated).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T_SL8 — Selection checkboxes are keyboard-focusable + name-labeled; a
  //         Live book pseudo-row participates.
  // -------------------------------------------------------------------------
  it("T_SL8 selection checkboxes are name-labeled + focusable; Live book pseudo-row participates", () => {
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    // Each real row's checkbox is labeled by its scenario name.
    const cb1 = screen.getByRole("checkbox", { name: /Conservative blend/i });
    const cb2 = screen.getByRole("checkbox", { name: /Aggressive tilt/i });
    expect(cb1).toBeInTheDocument();
    expect(cb2).toBeInTheDocument();
    // Keyboard-focusable (not disabled, focusable element).
    cb1.focus();
    expect(cb1).toHaveFocus();
    // A Live book pseudo-row participates in selection.
    expect(
      screen.getByRole("checkbox", { name: /Live book/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Live book")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // T_SL9 — Compare selected: disabled <2, enabled >=2; raises selection.
  // -------------------------------------------------------------------------
  it("T_SL9 Compare selected disabled <2, enabled >=2, raises the selection to onCompare", () => {
    const onCompare = vi.fn();
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={onCompare} />,
    );
    const compareCta = screen.getByRole("button", {
      name: /Compare selected/i,
    });
    // 0 selected → disabled.
    expect(compareCta).toBeDisabled();
    expect(
      screen.getByText(
        "Select 2 or more scenarios (or the live book) to compare.",
      ),
    ).toBeInTheDocument();

    // 1 selected → still disabled.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Conservative blend/i }),
    );
    expect(compareCta).toBeDisabled();

    // 2 selected → enabled.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Aggressive tilt/i }),
    );
    expect(compareCta).toBeEnabled();

    fireEvent.click(compareCta);
    expect(onCompare).toHaveBeenCalledTimes(1);
    const arg = onCompare.mock.calls[0][0];
    expect(arg.rows.map((r: SavedScenarioListRow) => r.id)).toEqual([
      ROWS[0].id,
      ROWS[1].id,
    ]);
    expect(arg.includeLiveBook).toBe(false);
  });

  // -------------------------------------------------------------------------
  // T_SL10 — Live book + one real row counts as 2 (pseudo-row participates).
  // -------------------------------------------------------------------------
  it("T_SL10 Live book + one scenario enables compare and reports includeLiveBook=true", () => {
    const onCompare = vi.fn();
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={onCompare} />,
    );
    const compareCta = screen.getByRole("button", {
      name: /Compare selected/i,
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Live book/i }));
    expect(compareCta).toBeDisabled(); // only 1 (live book)
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Conservative blend/i }),
    );
    expect(compareCta).toBeEnabled(); // live book + 1 real = 2

    fireEvent.click(compareCta);
    const arg = onCompare.mock.calls[0][0];
    expect(arg.includeLiveBook).toBe(true);
    expect(arg.rows.map((r: SavedScenarioListRow) => r.id)).toEqual([
      ROWS[0].id,
    ]);
  });

  // -------------------------------------------------------------------------
  // T_SL11 — Delete confirm scoped to ONE row (no cross-row confirm bleed).
  // -------------------------------------------------------------------------
  it("T_SL11 delete confirm is scoped to the targeted row only", () => {
    render(
      <SavedScenariosList rows={ROWS} onOpen={vi.fn()} onCompare={vi.fn()} />,
    );
    const firstRow = screen
      .getByText("Conservative blend")
      .closest("[data-testid='saved-scenario-row']") as HTMLElement;
    fireEvent.click(
      within(firstRow).getByRole("button", { name: /^Delete$/ }),
    );
    expect(screen.getByText('Delete "Conservative blend"?')).toBeInTheDocument();
    // The second row has NOT entered a confirm state.
    expect(screen.queryByText('Delete "Aggressive tilt"?')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_SL12 — A hard list-load failure (listLoadError + empty rows) renders an
  //          honest ERROR state, NOT the "No saved scenarios yet" empty card.
  //          An unloaded list must never masquerade as an empty list (#509).
  // -------------------------------------------------------------------------
  it("T_SL12 listLoadError with empty rows shows an honest error alert, NOT the empty card", () => {
    render(
      <SavedScenariosList
        rows={[]}
        listLoadError
        onOpen={vi.fn()}
        onCompare={vi.fn()}
      />,
    );
    // Distinct error copy via the canonical role="alert" path.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't load your saved scenarios. Try again.",
    );
    // The fabricated "no scenarios" empty state must NOT appear.
    expect(screen.queryByText("No saved scenarios yet")).toBeNull();
    expect(
      screen.queryByText(/Compose a draft above, then choose/i),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T_SL13 — listLoadError is IGNORED when prior rows are cached: a transient
  //          refetch failure must not blow away an already-loaded list.
  // -------------------------------------------------------------------------
  it("T_SL13 listLoadError with cached rows keeps the rows rendered (no error state)", () => {
    render(
      <SavedScenariosList
        rows={ROWS}
        listLoadError
        onOpen={vi.fn()}
        onCompare={vi.fn()}
      />,
    );
    // The cached rows still render; no error alert displaces them.
    expect(screen.getByText("Conservative blend")).toBeInTheDocument();
    expect(screen.getByText("Aggressive tilt")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
