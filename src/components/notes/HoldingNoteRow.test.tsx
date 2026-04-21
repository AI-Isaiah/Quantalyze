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
});
