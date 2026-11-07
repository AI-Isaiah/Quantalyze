/**
 * Phase 08 Plan 04 Task 1 — HoldingNoteRow + HoldingNoteIconButton tests
 * (MANAGE-05 holding scope).
 *
 * Covers UI-SPEC §3 (three-state note icon + aria plumbing) and
 * UI-SPEC §4b (inline expandable sub-row DOM + read/edit toggle + blur-save
 * using the shared Plan 03 primitives).
 *
 * Phase 08 Plan 05 Task 1 — RED regression tests for holding-note read-back.
 * Adds 4 failing tests that will pass once HoldingNoteRow lazily fetches its
 * note on mount (Task 2 GREEN). Also updates existing tests to thread through
 * the loading gate via waitFor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HoldingNoteIconButton, HoldingNoteRow } from "./HoldingNoteRow";

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HoldingNoteIconButton (UI-SPEC §3 — three-state icon)", () => {
  it("aria-label reads 'Add note for {symbol} {holdingType}' when no note exists", () => {
    render(
      <HoldingNoteIconButton
        hasNote={false}
        revoked={false}
        isExpanded={false}
        onClick={() => {}}
        symbol="BTC"
        holdingType="spot"
        rowId="r1"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add note for BTC spot" }),
    ).toBeInTheDocument();
  });

  it("aria-label reads 'Edit note for {symbol} {holdingType}' when a note exists", () => {
    render(
      <HoldingNoteIconButton
        hasNote={true}
        revoked={false}
        isExpanded={false}
        onClick={() => {}}
        symbol="ETH"
        holdingType="derivative"
        rowId="r2"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Edit note for ETH derivative" }),
    ).toBeInTheDocument();
  });

  it("aria-expanded mirrors the isExpanded prop", () => {
    const { rerender } = render(
      <HoldingNoteIconButton
        hasNote={false}
        revoked={false}
        isExpanded={false}
        onClick={() => {}}
        symbol="BTC"
        holdingType="spot"
        rowId="r1"
      />,
    );
    expect(
      screen.getByRole("button").getAttribute("aria-expanded"),
    ).toBe("false");
    rerender(
      <HoldingNoteIconButton
        hasNote={false}
        revoked={false}
        isExpanded={true}
        onClick={() => {}}
        symbol="BTC"
        holdingType="spot"
        rowId="r1"
      />,
    );
    expect(
      screen.getByRole("button").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("aria-controls points to note-row-{rowId}", () => {
    render(
      <HoldingNoteIconButton
        hasNote={false}
        revoked={false}
        isExpanded={false}
        onClick={() => {}}
        symbol="BTC"
        holdingType="spot"
        rowId="abc-123"
      />,
    );
    expect(
      screen.getByRole("button").getAttribute("aria-controls"),
    ).toBe("note-row-abc-123");
  });

  it("color class differs between {empty,not-revoked}, {has-note,not-revoked}, {revoked}", () => {
    const { rerender } = render(
      <HoldingNoteIconButton
        hasNote={false}
        revoked={false}
        isExpanded={false}
        onClick={() => {}}
        symbol="BTC"
        holdingType="spot"
        rowId="r1"
      />,
    );
    const emptyClass = screen.getByRole("button").className;
    expect(emptyClass).toContain("text-text-muted");

    rerender(
      <HoldingNoteIconButton
        hasNote={true}
        revoked={false}
        isExpanded={false}
        onClick={() => {}}
        symbol="BTC"
        holdingType="spot"
        rowId="r1"
      />,
    );
    const hasNoteClass = screen.getByRole("button").className;
    expect(hasNoteClass).toContain("text-accent");

    rerender(
      <HoldingNoteIconButton
        hasNote={true}
        revoked={true}
        isExpanded={false}
        onClick={() => {}}
        symbol="BTC"
        holdingType="spot"
        rowId="r1"
      />,
    );
    const revokedClass = screen.getByRole("button").className;
    // amber warning hex — see UI-SPEC §3 revoked variants
    expect(revokedClass).toContain("#D97706");
  });

  it("click fires the onClick handler exactly once", () => {
    const onClick = vi.fn();
    render(
      <HoldingNoteIconButton
        hasNote={false}
        revoked={false}
        isExpanded={false}
        onClick={onClick}
        symbol="BTC"
        holdingType="spot"
        rowId="r1"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("HoldingNoteRow (UI-SPEC §4b — inline expandable sub-row)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    fetchSpy.mockResolvedValue(makeResponse(404));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderRowInTable(children: React.ReactNode) {
    return render(
      <table>
        <tbody>{children}</tbody>
      </table>,
    );
  }

  it("renders a tr with id=note-row-{rowId} and role=region", async () => {
    renderRowInTable(
      <HoldingNoteRow
        rowId="h-42"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    // Wait for loading gate to resolve before querying the region
    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });
    const region = screen.getByRole("region", {
      name: "Note for BTC spot",
    });
    expect(region).toBeInTheDocument();
    expect(region.getAttribute("id")).toBe("note-row-h-42");
  });

  it("with empty initialContent → textarea mounts in edit mode with the §4b placeholder", async () => {
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-1"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("textarea")).not.toBeNull();
    });
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.getAttribute("placeholder")).toBe(
      "No note yet. Start typing to add one.",
    );
  });

  it("with non-empty initialContent (served via GET) → NoteRender markdown in read mode; Edit button visible", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { content: "**hello**", updated_at: "2026-04-21T00:00:00Z" }),
    );
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-2"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("strong")?.textContent).toBe("hello");
    });
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("blur on the textarea fires PATCH with scope_kind=holding + buildHoldingScopeRef scope_ref + typed content", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(makeResponse(404)); // mount GET
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { updated_at: "2026-04-21T00:00:00Z" }),
    ); // blur PATCH
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-3"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("textarea")).not.toBeNull();
    });
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "BTC thesis — core hold" } });
    });
    await act(async () => {
      fireEvent.blur(ta);
    });
    await waitFor(() => {
      // First call = mount GET; second call = blur PATCH
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    const [url, init] = fetchSpy.mock.calls[1];
    expect(url).toBe("/api/notes");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      scope_kind: "holding",
      scope_ref: "binance:BTC:spot",
      content: "BTC thesis — core hold",
    });
  });

  it("NoteSaveStatus wrapper is present below the editor", async () => {
    renderRowInTable(
      <HoldingNoteRow
        rowId="h-4"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("note-save-status")).toBeInTheDocument();
    });
  });

  // ----------------------------------------------------------------
  // Phase 08 Plan 05 — RED regression tests for holding-note read-back
  // (IN-04 gap closure). These tests fail against the current
  // HoldingNoteRow that does not fetch on mount. They pass once Task 2
  // adds the lazy GET useEffect mirroring BridgeOutcomeNoteSection.
  // ----------------------------------------------------------------

  it("RED: fires lazy GET on mount with URL-encoded holding scope_ref", async () => {
    renderRowInTable(
      <HoldingNoteRow
        rowId="h-lazy-get"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "/api/notes?scope_kind=holding&scope_ref=binance%3ABTC%3Aspot",
    );
    expect((init as RequestInit).credentials).toBe("same-origin");
  });

  it("RED: 200 response seeds read-mode NoteRender with persisted content (IN-04 closure)", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, {
        content: "saved thesis",
        updated_at: "2026-04-21T10:00:00Z",
      }),
    );
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-readback"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    // Wait for NoteRender to replace the loading gate.
    await waitFor(() => {
      expect(screen.getByText("saved thesis")).toBeInTheDocument();
    });
    // Read mode, not edit mode.
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("RED: 404 response resolves loading gate to empty edit-mode textarea", async () => {
    // Default beforeEach already mocks 404.
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-404"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("textarea")).not.toBeNull();
    });
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.getAttribute("placeholder")).toBe(
      "No note yet. Start typing to add one.",
    );
    // Loading text gone.
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("RED: renders 'Loading…' gate before the mount fetch resolves", async () => {
    // Construct a deferred promise so the fetch never resolves during
    // this assertion window.
    let resolveFetch: (r: Response) => void = () => {};
    fetchSpy.mockReset();
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolveFetch = r;
        }),
    );
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-loading"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    // Before resolve: loading text visible, no textarea, no NoteRender.
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
    // Resolve so the test doesn't leak a pending promise.
    await act(async () => {
      resolveFetch(makeResponse(404));
    });
  });

  // ----------------------------------------------------------------
  // Phase 193 review WR-02: only a genuine 404 means "no note yet". Any other
  // failed load (401/403/429/5xx, a network or parse error) is a DISTINCT
  // error+retry state, never an empty editor, because anything typed there
  // would be PATCHed over a stored note the user never saw. Same fence and
  // copy as HoldingDetail's Notes tab.
  // ----------------------------------------------------------------

  it("500 response → error+retry state, never the empty editor; leaving writes nothing (WR-02)", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(makeResponse(500));
    const user = userEvent.setup();
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-500"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your note. Your saved note is safe.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
    await user.click(document.body);
    await act(async () => {});
    expect(
      fetchSpy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH"),
    ).toHaveLength(0);
  });

  it("network error (thrown fetch) → the same error+retry state (WR-02)", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockRejectedValue(new Error("network down"));
    const { container } = renderRowInTable(
      <HoldingNoteRow
        rowId="h-net"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your note");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("Retry after a failed load refetches and shows the saved note (WR-02)", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(makeResponse(500));
    const user = userEvent.setup();
    renderRowInTable(
      <HoldingNoteRow
        rowId="h-retry"
        colSpan={7}
        venue="binance"
        symbol="BTC"
        holding_type="spot"
        initialContent=""
        initialLastSavedAt={null}
      />,
    );
    await screen.findByRole("alert");
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { content: "recovered thesis", updated_at: "2026-04-21T10:00:00Z" }),
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("recovered thesis")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/** Fetch calls whose init method is PATCH (D-10: the GET on mount is by design). */
function patches(spy: ReturnType<typeof vi.fn>): unknown[][] {
  return spy.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
  );
}

describe("HoldingNoteRow — opening writes nothing (D-10)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  /** GET answers `getRes`; every PATCH answers 200. */
  function stubFetch(getRes: () => Response) {
    fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" })
        : getRes(),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderRow = () =>
    render(
      <table>
        <tbody>
          <HoldingNoteRow
            rowId="h-quiet"
            colSpan={7}
            venue="binance"
            symbol="BTC"
            holding_type="spot"
            initialContent=""
            initialLastSavedAt={null}
          />
        </tbody>
      </table>,
    );

  it("404: the textarea is not focused on open, and leaving writes nothing", async () => {
    stubFetch(() => makeResponse(404));
    const user = userEvent.setup();
    const { container } = renderRow();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    expect(document.activeElement).not.toBe(container.querySelector("textarea"));
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
  });

  it("404: focus then blur with no typing writes nothing", async () => {
    stubFetch(() => makeResponse(404));
    const user = userEvent.setup();
    const { container } = renderRow();
    await waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
    await user.click(container.querySelector("textarea") as HTMLTextAreaElement);
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("saved note: Edit focuses the textarea; blur with no change writes nothing and returns to read mode", async () => {
    stubFetch(() => makeResponse(200, { content: "saved thesis", updated_at: "2026-04-21T10:00:00Z" }));
    const user = userEvent.setup();
    const { container } = renderRow();
    await user.click(await screen.findByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    await user.click(document.body);
    await act(async () => {});
    expect(patches(fetchSpy)).toHaveLength(0);
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText("saved thesis")).toBeInTheDocument();
  });

  it("saved note cleared and blurred sends one PATCH with empty content (Q-1, founder override 2026-11-07)", async () => {
    stubFetch(() => makeResponse(200, { content: "saved thesis", updated_at: "2026-04-21T10:00:00Z" }));
    const user = userEvent.setup();
    const { container } = renderRow();
    await user.click(await screen.findByText("Edit"));
    await user.clear(container.querySelector("textarea") as HTMLTextAreaElement);
    await user.click(document.body);
    await waitFor(() => expect(patches(fetchSpy)).toHaveLength(1));
    expect(JSON.parse((patches(fetchSpy)[0][1] as RequestInit).body as string).content).toBe("");
  });
});

describe("HoldingNoteRow — a blur while a save is in flight compares against the value last sent (WR-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("edit y then back to the original x while the y save is open: the second blur sends x", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    // GET answers x. The first PATCH is held open; later PATCHes answer 200.
    const fetchSpy: ReturnType<typeof vi.fn> = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") {
        return Promise.resolve(makeResponse(200, { content: "x", updated_at: "2026-04-21T10:00:00Z" }));
      }
      return patches(fetchSpy).length === 1
        ? new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve(makeResponse(200, { updated_at: "2026-11-07T00:00:00Z" }));
    });
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const bodies = () =>
      patches(fetchSpy).map((c) => JSON.parse((c[1] as RequestInit).body as string).content as string);

    const user = userEvent.setup();
    const { container } = render(
      <table>
        <tbody>
          <HoldingNoteRow
            rowId="h-wr01"
            colSpan={7}
            venue="binance"
            symbol="BTC"
            holding_type="spot"
            initialContent=""
            initialLastSavedAt={null}
          />
        </tbody>
      </table>,
    );
    await user.click(await screen.findByText("Edit"));
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, "y");
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y"]));

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

  it("a failed save after a superseded save committed: the next blur retries even though the draft equals the last confirmed value", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    // GET answers x. PATCH 1 (y) is held open, PATCH 2 (x) answers 429, later ones 200.
    const fetchSpy: ReturnType<typeof vi.fn> = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") {
        return Promise.resolve(makeResponse(200, { content: "x", updated_at: "2026-04-21T10:00:00Z" }));
      }
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
    const bodies = () =>
      patches(fetchSpy).map((c) => JSON.parse((c[1] as RequestInit).body as string).content as string);

    const user = userEvent.setup();
    const { container } = render(
      <table>
        <tbody>
          <HoldingNoteRow
            rowId="h-wr01-err"
            colSpan={7}
            venue="binance"
            symbol="BTC"
            holding_type="spot"
            initialContent=""
            initialLastSavedAt={null}
          />
        </tbody>
      </table>,
    );
    await user.click(await screen.findByText("Edit"));
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

    // "Save failed — retry": Edit and leave with the draft unchanged. The draft
    // equals the last confirmed value (x), but the server may hold y, so it must send.
    await user.click(screen.getByText("Edit"));
    await user.click(document.body);
    await waitFor(() => expect(bodies()).toEqual(["y", "x", "x"]));
    await waitFor(() => expect(screen.queryByText("Save failed — retry")).toBeNull());
  });
});
