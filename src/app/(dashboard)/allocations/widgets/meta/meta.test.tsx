import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomKpiStrip } from "./CustomKpiStrip";
import { NotesWidget } from "./NotesWidget";
import { QuickActions } from "./QuickActions";

const baseProps = { timeframe: "YTD", width: 6, height: 3 };

// ---------------------------------------------------------------------------
// CustomKpiStrip
// ---------------------------------------------------------------------------

describe("CustomKpiStrip", () => {
  it("renders all four KPI labels", () => {
    render(<CustomKpiStrip data={{}} {...baseProps} />);
    expect(screen.getByText("TWR")).toBeInTheDocument();
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
    expect(screen.getByText("CAGR")).toBeInTheDocument();
  });

  it("renders formatted values from analytics", () => {
    render(
      <CustomKpiStrip
        data={{
          analytics: { twr: 0.15, sharpe: 1.2, max_drawdown: -0.08, cagr: 0.12 },
        }}
        {...baseProps}
      />,
    );
    // TWR = +15.00%
    expect(screen.getByText("+15.00%")).toBeInTheDocument();
  });

  it("renders dash for null values", () => {
    render(<CustomKpiStrip data={{}} {...baseProps} />);
    const dashes = screen.getAllByText("\u2014"); // em dash
    expect(dashes.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// NotesWidget — Phase 08 Plan 03 upgrade
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("NotesWidget (Phase 08 Plan 03 upgrade)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches with new scope_kind=portfolio&scope_ref=… shape", async () => {
    fetchSpy.mockResolvedValueOnce(makeResponse(404, { error: "not found" }));
    render(<NotesWidget data={{ portfolio: { id: "p1" } }} {...baseProps} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe("/api/notes?scope_kind=portfolio&scope_ref=p1");
  });

  it("renders markdown in read mode after initial GET (no textarea yet)", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, {
        content: "**hi**",
        updated_at: "2026-04-21T00:00:00Z",
      }),
    );
    const { container } = render(
      <NotesWidget data={{ portfolio: { id: "p1" } }} {...baseProps} />,
    );

    await waitFor(() => {
      expect(container.querySelector("strong")?.textContent).toBe("hi");
    });
    // Read mode — textarea NOT mounted yet.
    expect(container.querySelector("textarea")).toBeNull();
    // Edit affordance visible.
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("clicking Edit reveals the textarea seeded with the current content", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, {
        content: "**hi**",
        updated_at: "2026-04-21T00:00:00Z",
      }),
    );
    const { container } = render(
      <NotesWidget data={{ portfolio: { id: "p1" } }} {...baseProps} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Edit"));
    });
    const ta = container.querySelector("textarea");
    expect(ta).not.toBeNull();
    expect((ta as HTMLTextAreaElement).value).toBe("**hi**");
  });

  it("saves on textarea blur with new PATCH body shape (not on keystroke)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeResponse(200, { content: "", updated_at: null }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { updated_at: "2026-04-21T00:00:00Z" }),
      );

    const { container } = render(
      <NotesWidget data={{ portfolio: { id: "p1" } }} {...baseProps} />,
    );
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    // Enter edit mode
    await act(async () => {
      fireEvent.click(screen.getByText("Edit"));
    });
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).not.toBeNull();

    // Type — should NOT fire a PATCH per keystroke.
    await act(async () => {
      fireEvent.change(ta, { target: { value: "Hello" } });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still just the initial GET

    // Blur — exactly one PATCH fires with the new body shape.
    await act(async () => {
      fireEvent.blur(ta);
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    const [patchUrl, patchInit] = fetchSpy.mock.calls[1];
    expect(patchUrl).toBe("/api/notes");
    expect((patchInit as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((patchInit as RequestInit).body as string);
    expect(body).toEqual({
      scope_kind: "portfolio",
      scope_ref: "p1",
      content: "Hello",
    });
  });

  it("after successful save, NoteSaveStatus is present (shared primitive)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeResponse(200, { content: "", updated_at: null }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { updated_at: "2026-04-21T00:00:00Z" }),
      );

    const { container } = render(
      <NotesWidget data={{ portfolio: { id: "p1" } }} {...baseProps} />,
    );
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // NoteSaveStatus wrapper present from mount.
    expect(screen.getByTestId("note-save-status")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Edit"));
    });
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "x" } });
    });
    await act(async () => {
      fireEvent.blur(ta);
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("note-save-status").textContent).toContain(
        "Note saved",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// QuickActions
// ---------------------------------------------------------------------------

describe("QuickActions", () => {
  it("renders three action buttons/links", () => {
    render(
      <QuickActions
        data={{ portfolio: { id: "test-123" } }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("Recompute")).toBeInTheDocument();
    expect(screen.getByText("Export PDF")).toBeInTheDocument();
    expect(screen.getByText("Share")).toBeInTheDocument();
  });

  it("has Recompute button disabled", () => {
    render(
      <QuickActions data={{ portfolio: { id: "p1" } }} {...baseProps} />,
    );
    const btn = screen.getByText("Recompute").closest("button");
    expect(btn).toBeDisabled();
  });

  it("links Export PDF to correct URL", () => {
    render(
      <QuickActions data={{ portfolio: { id: "abc" } }} {...baseProps} />,
    );
    const link = screen.getByText("Export PDF").closest("a");
    expect(link).toHaveAttribute("href", "/api/portfolio-pdf/abc");
  });

  // M-0182 — handleShare clipboard write + "Copied!" transition + 2s revert.
  // The prior coverage only asserted the static "Share" label at mount.
  describe("M-0182 — Share clipboard interaction", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("writes window.location.href to the clipboard and flips the label to 'Copied!'", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(
        <QuickActions data={{ portfolio: { id: "p1" } }} {...baseProps} />,
      );
      const shareBtn = screen.getByText("Share").closest("button")!;
      await act(async () => {
        fireEvent.click(shareBtn);
      });

      expect(writeText).toHaveBeenCalledTimes(1);
      expect((writeText.mock.calls[0] as unknown[])[0]).toBe(
        window.location.href,
      );
      expect(await screen.findByText("Copied!")).toBeInTheDocument();
      expect(screen.queryByText("Share")).toBeNull();
    });

    it("reverts the label back to 'Share' after the 2s timeout", async () => {
      vi.useFakeTimers();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(
        <QuickActions data={{ portfolio: { id: "p1" } }} {...baseProps} />,
      );
      const shareBtn = screen.getByText("Share").closest("button")!;
      // The click handler awaits writeText, so flush the resolved promise
      // microtask before advancing the timer.
      await act(async () => {
        fireEvent.click(shareBtn);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Copied!")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText("Share")).toBeInTheDocument();
      expect(screen.queryByText("Copied!")).toBeNull();
    });

    it("on clipboard rejection, the catch swallows the error and 'Copied!' never appears", async () => {
      const writeText = vi
        .fn()
        .mockRejectedValue(new Error("clipboard blocked"));
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(
        <QuickActions data={{ portfolio: { id: "p1" } }} {...baseProps} />,
      );
      const shareBtn = screen.getByText("Share").closest("button")!;
      await act(async () => {
        fireEvent.click(shareBtn);
      });

      expect(writeText).toHaveBeenCalledTimes(1);
      // Rejection path: state never flips, label stays "Share".
      expect(screen.getByText("Share")).toBeInTheDocument();
      expect(screen.queryByText("Copied!")).toBeNull();
    });

    it("disabled Recompute button carries cursor:not-allowed", () => {
      render(
        <QuickActions data={{ portfolio: { id: "p1" } }} {...baseProps} />,
      );
      const btn = screen.getByText("Recompute").closest("button")!;
      expect(btn).toBeDisabled();
      expect(btn.style.cursor).toBe("not-allowed");
    });
  });
});
