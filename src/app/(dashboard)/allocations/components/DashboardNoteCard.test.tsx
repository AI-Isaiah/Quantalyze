/**
 * Phase 100 Plan 01 Task 2 — DashboardNoteCard tests (PI-04 dashboard scope).
 *
 * Covers UI-SPEC W1: full-width "Notes" card with the "Private — visible only
 * to you." sub-caption, an ALWAYS-EDITABLE textarea (no edit-mode toggle),
 * honest-empty placeholder, below-fold sanitized preview only when content is
 * non-empty, and a PATCH body of {scope_kind:'dashboard', scope_ref:'allocations',
 * content}. scope_ref is the fixed literal 'allocations' — asserted verbatim.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardNoteCard } from "./DashboardNoteCard";

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DashboardNoteCard (UI-SPEC W1 — dashboard note card)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders 'Notes' heading + 'Private — visible only to you.' sub-caption + save status", () => {
    render(<DashboardNoteCard initialContent="" initialLastSavedAt={null} />);
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(
      screen.getByText("Private — visible only to you."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("note-save-status")).toBeInTheDocument();
  });

  it("empty initialContent → always-editable textarea with the honest UI-SPEC placeholder and NO preview", () => {
    const { container } = render(
      <DashboardNoteCard initialContent="" initialLastSavedAt={null} />,
    );
    const ta = container.querySelector("textarea");
    expect(ta).not.toBeNull();
    expect(ta?.getAttribute("placeholder")).toBe(
      "Add a private note about your allocation book — markdown supported. Visible only to you.",
    );
    // Honest-empty: no rendered markdown preview, no sample text.
    expect(container.querySelector("h1")).toBeNull();
  });

  it("non-empty content → textarea stays editable AND a sanitized markdown preview renders below", () => {
    const { container } = render(
      <DashboardNoteCard
        initialContent="# heading"
        initialLastSavedAt={null}
      />,
    );
    // Always-editable: textarea present even with prior content (no edit toggle).
    expect(container.querySelector("textarea")).not.toBeNull();
    // NoteRender preview present for non-empty content.
    expect(container.querySelector("h1")?.textContent).toBe("heading");
  });

  it("typing then blur fires EXACTLY ONE PATCH /api/notes with {scope_kind:'dashboard', scope_ref:'allocations', content}", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { updated_at: "2026-07-15T00:00:00Z" }),
    );
    const { container } = render(
      <DashboardNoteCard initialContent="" initialLastSavedAt={null} />,
    );
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "Rebalance BTC next week." } });
    });
    await act(async () => {
      fireEvent.blur(ta);
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/notes");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      scope_kind: "dashboard",
      scope_ref: "allocations",
      content: "Rebalance BTC next week.",
    });
  });

  // Red-team F-1: the card is always-editable, so a focus→blur with NO typing
  // must NOT fire a PATCH — otherwise save(staleContent) last-write-wins clobbers
  // another tab's concurrent edit (and burns an audit/rate-limit slot for nothing).
  it("focus→blur with UNCHANGED content fires NO PATCH (dirty check)", async () => {
    render(
      <DashboardNoteCard
        initialContent="Existing book note."
        initialLastSavedAt={new Date("2026-07-15T00:00:00Z")}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.focus(ta);
      fireEvent.blur(ta);
    });
    // No edit happened → no network write.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("edit then blur DOES fire exactly one PATCH from a non-empty initial note", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { updated_at: "2026-07-16T00:00:00Z" }),
    );
    render(
      <DashboardNoteCard
        initialContent="Existing book note."
        initialLastSavedAt={new Date("2026-07-15T00:00:00Z")}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "Existing book note. Trim BTC." } });
    });
    await act(async () => {
      fireEvent.blur(ta);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.content).toBe("Existing book note. Trim BTC.");
  });
});
