/**
 * Phase 08 Plan 04 Task 3 — StrategyNoteCard tests (MANAGE-05 strategy scope).
 *
 * Covers UI-SPEC §4d: full-width card with "Your note" header, edit/read
 * toggle, placeholder copy, and PATCH body shape using scope_kind="strategy"
 * + scope_ref=<strategies.id UUID>.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** Fetch calls whose init method is PATCH (D-10: count writes, never fetch as a whole). */
function patches(spy: ReturnType<typeof vi.fn>): unknown[][] {
  return spy.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
  );
}

describe("StrategyNoteCard — opening writes nothing (D-09, D-10)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderCard = (initialContent: string) =>
    render(
      <StrategyNoteCard
        strategyId="strat-quiet"
        initialContent={initialContent}
        initialLastSavedAt={null}
      />,
    );

  it("open with no saved note: focus is not moved, and leaving writes nothing", async () => {
    const user = userEvent.setup();
    const { container } = renderCard("");
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(ta);
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
  });

  it("focus then blur with no typing writes nothing; the empty textarea stays with its placeholder", async () => {
    const user = userEvent.setup();
    const { container } = renderCard("");
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.click(ta);
    expect(document.activeElement).toBe(ta);
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
    const after = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(after).not.toBeNull();
    expect(after.value).toBe("");
    expect(after.getAttribute("placeholder")).toBe(
      "Private note about this strategy — markdown supported.",
    );
  });

  it("a whitespace-only draft blurred writes nothing and the textarea is back to empty", async () => {
    const user = userEvent.setup();
    const { container } = renderCard("");
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "   ");
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("typing real text then blur sends exactly one PATCH with that content (positive arm)", async () => {
    const user = userEvent.setup();
    const { container } = renderCard("");
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "Conviction: high.");
    await user.click(document.body);
    await waitFor(() => expect(patches(fetchSpy)).toHaveLength(1));
    const body = JSON.parse((patches(fetchSpy)[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      scope_kind: "strategy",
      scope_ref: "strat-quiet",
      content: "Conviction: high.",
    });
  });

  it("saved note: Edit focuses the textarea; blur with no change writes nothing and returns to read mode", async () => {
    const user = userEvent.setup();
    const { container } = renderCard("# heading");
    await user.click(screen.getByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("heading");
  });

  it("Q-1 (founder override 2026-11-07, Allow clearing): clearing a saved note and blurring sends one PATCH with empty content", async () => {
    const user = userEvent.setup();
    const { container } = renderCard("abc");
    await user.click(screen.getByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta);
    await user.click(document.body);
    await waitFor(() => expect(patches(fetchSpy)).toHaveLength(1));
    const body = JSON.parse((patches(fetchSpy)[0][1] as RequestInit).body as string);
    expect(body.content).toBe("");
  });
});

describe("StrategyNoteCard — a blur while a save is in flight compares against the value last sent (WR-01)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let releaseFirst: (r: Response) => void;

  beforeEach(() => {
    // The first PATCH is held open; every later PATCH answers 200.
    fetchSpy = vi.fn((_url: string, _init?: RequestInit) =>
      patches(fetchSpy).length === 1
        ? new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" })),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const bodies = () =>
    patches(fetchSpy).map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).content as string,
    );

  it("edit y then back to the original x while the y save is open: the second blur sends x", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StrategyNoteCard strategyId="strat-wr01" initialContent="x" initialLastSavedAt={null} />,
    );
    await user.click(screen.getByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, "y");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y"]));

    // The y save has not answered. Edit back to x and leave.
    await user.click(screen.getByText("Edit"));
    const ta2 = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta2);
    await user.type(ta2, "x");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y", "x"]));

    await act(async () => {
      releaseFirst(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }));
    });
  });

  it("type abc, then clear the note while the abc save is open: the second blur sends the clear", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StrategyNoteCard strategyId="strat-wr01" initialContent="" initialLastSavedAt={null} />,
    );
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "abc");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["abc"]));

    await user.click(screen.getByText("Edit"));
    await user.clear(container.querySelector("textarea") as HTMLTextAreaElement);
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["abc", ""]));

    await act(async () => {
      releaseFirst(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }));
    });
  });
});

describe("StrategyNoteCard — Save failed — retry really retries after a superseded save committed (WR-01 round 2)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let releaseFirst: (r: Response) => void;

  beforeEach(() => {
    // PATCH 1 (y) is held open, PATCH 2 (x) answers 429, later PATCHes answer 200.
    fetchSpy = vi.fn((_url: string, _init?: RequestInit) => {
      const n = patches(fetchSpy).length;
      if (n === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve(
        n === 2 ? makeResponse(429) : makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }),
      );
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const bodies = () =>
    patches(fetchSpy).map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).content as string,
    );

  it("after the newer save fails, Edit and leave with the draft equal to the last confirmed value still sends it", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StrategyNoteCard strategyId="strat-wr01-err" initialContent="x" initialLastSavedAt={null} />,
    );
    await user.click(screen.getByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, "y");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y"]));

    // Edit back to x while y is open: x goes out and fails (429).
    await user.click(screen.getByText("Edit"));
    const ta2 = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta2);
    await user.type(ta2, "x");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y", "x"]));
    expect(await screen.findByText("Save failed — retry")).toBeInTheDocument();

    // The superseded y save now commits server-side; its response is dropped.
    await act(async () => {
      releaseFirst(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }));
    });
    expect(screen.getByText("Save failed — retry")).toBeInTheDocument();

    // "Save failed — retry": Edit and leave unchanged. The draft equals the last
    // confirmed value (x) but the server may hold y, so it must send.
    await user.click(screen.getByText("Edit"));
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y", "x", "x"]));
    await waitFor(() => expect(screen.queryByText("Save failed — retry")).toBeNull());
  });
});
