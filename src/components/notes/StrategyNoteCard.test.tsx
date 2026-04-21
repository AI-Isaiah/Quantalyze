/**
 * Phase 08 Plan 04 Task 3 — StrategyNoteCard tests (MANAGE-05 strategy scope).
 *
 * Covers UI-SPEC §4d: full-width card with "Your note" header, edit/read
 * toggle, placeholder copy, and PATCH body shape using scope_kind="strategy"
 * + scope_ref=<strategies.id UUID>.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrategyNoteCard } from "./StrategyNoteCard";

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("StrategyNoteCard (UI-SPEC §4d — strategy note card)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("T27: empty initialContent → textarea in edit mode with UI-SPEC §4d placeholder", () => {
    const { container } = render(
      <StrategyNoteCard
        strategyId="s-uuid-1"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    const ta = container.querySelector("textarea");
    expect(ta).not.toBeNull();
    expect(ta?.getAttribute("placeholder")).toBe(
      "Private note about this strategy — markdown supported.",
    );
  });

  it("T28: initialContent='# heading' → NoteRender renders <h1>heading</h1>", () => {
    const { container } = render(
      <StrategyNoteCard
        strategyId="s-uuid-2"
        initialContent="# heading"
        initialLastSavedAt={null}
      />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("heading");
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("T29: blur on textarea with typed content fires PATCH with scope_kind='strategy', scope_ref=<strategyId>, content=<typed>", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { updated_at: "2026-04-21T00:00:00Z" }),
    );
    const { container } = render(
      <StrategyNoteCard
        strategyId="strat-uuid-3"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "Conviction: high." } });
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
      scope_kind: "strategy",
      scope_ref: "strat-uuid-3",
      content: "Conviction: high.",
    });
  });

  it("T30: scope_ref equals strategyId verbatim (no transformation)", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { updated_at: "2026-04-21T00:00:00Z" }),
    );
    const STRAT_ID = "aa111111-bbbb-2222-cccc-333333333333";
    const { container } = render(
      <StrategyNoteCard
        strategyId={STRAT_ID}
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "x" } });
    });
    await act(async () => {
      fireEvent.blur(ta);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.scope_ref).toBe(STRAT_ID);
  });

  it("renders 'Your note' uppercase tracking-wider header", () => {
    render(
      <StrategyNoteCard
        strategyId="s-uuid-header"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    const header = screen.getByText("Your note");
    expect(header.className).toContain("uppercase");
    expect(header.className).toContain("tracking-wider");
  });

  it("NoteSaveStatus testid present below editor", () => {
    render(
      <StrategyNoteCard
        strategyId="s-uuid-status"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    expect(screen.getByTestId("note-save-status")).toBeInTheDocument();
  });
});
