import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HoldingsTable, type HoldingRow as HoldingRowType } from "./HoldingsTable";

/**
 * Phase 08 Plan 02 Task 2 — HoldingsTable tests (MANAGE-02).
 *
 * Covers the revoked-key visual treatment + allocator-scoped toggle
 * per 08-UI-SPEC.md §2 and 08-CONTEXT.md D-04 / D-05:
 *
 *   - Strikethrough + amber "Key revoked" chip for rows whose source
 *     key has sync_status='revoked'.
 *   - Toggle "Show revoked-key holdings" default ON at render time
 *     (the default comes from the caller; the component itself honours
 *     `showRevoked` verbatim).
 *   - Toggle OFF filters revoked rows from the table ONLY (caller's
 *     responsibility to NOT filter KPI / chart inputs).
 *   - Hidden-footer "{N} holding(s) hidden from revoked keys · Show all"
 *     with the Show-all button firing onShowRevokedChange(true).
 *   - Plural/singular rules for the hidden-footer count.
 */

type HoldingRow = HoldingRowType;

function makeHolding(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "holding-default",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    quantity: 1.5,
    value_usd: 90_000,
    entry_price: 60_000,
    unrealized_pnl_usd: 1_200,
    api_key_id: "key-1",
    source_key_sync_status: "complete",
    ...overrides,
  } as HoldingRow;
}

describe("HoldingsTable — revoked-key strikethrough + amber chip + toggle (08-02 / MANAGE-02)", () => {
  it("T1: 3 non-revoked holdings → no strikethrough, no amber chip anywhere", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({ id: "h2", symbol: "ETH", api_key_id: "key-2" }),
      makeHolding({ id: "h3", symbol: "SOL", api_key_id: "key-3" }),
    ];
    const { container } = render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.queryByText("Key revoked")).not.toBeInTheDocument();
    expect(container.querySelector(".line-through")).toBeNull();
  });

  it("T2: 1 of 3 revoked → that row has line-through on numeric cells + amber chip visible", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        api_key_id: "key-revoked",
        source_key_sync_status: "revoked",
      }),
      makeHolding({ id: "h3", symbol: "SOL", api_key_id: "key-3" }),
    ];
    const { container } = render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.getByText("Key revoked")).toBeInTheDocument();
    // At least one line-through descendant (on numeric cells of the revoked row).
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(0);
  });

  it("T3: showRevoked=false → revoked row NOT in DOM; visible-count is 2", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
      makeHolding({ id: "h3", symbol: "SOL" }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={false}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.queryByText("Key revoked")).not.toBeInTheDocument();
    // Symbols are concatenated with venue inside a single span (e.g.
    // "Binance · ETH"). Substring-match via regex.
    expect(screen.queryByText(/ETH/)).not.toBeInTheDocument();
    expect(screen.getByText(/BTC/)).toBeInTheDocument();
    expect(screen.getByText(/SOL/)).toBeInTheDocument();
  });

  it("T4: showRevoked=false + 1 hidden → footer reads '1 holding hidden from revoked keys · Show all'; clicking Show all fires onShowRevokedChange(true)", () => {
    const onChange = vi.fn();
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={false}
        onShowRevokedChange={onChange}
      />,
    );
    expect(
      screen.getByText(/1 holding hidden from revoked keys/),
    ).toBeInTheDocument();
    const showAll = screen.getByRole("button", { name: /Show all/i });
    fireEvent.click(showAll);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("T5: showRevoked=false + 2 hidden → footer uses plural 'holdings'", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
      makeHolding({
        id: "h3",
        symbol: "SOL",
        source_key_sync_status: "revoked",
      }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={false}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/2 holdings hidden from revoked keys/),
    ).toBeInTheDocument();
  });

  it("T6: toggle label reads 'Show revoked-key holdings' exactly", () => {
    render(
      <HoldingsTable
        holdings={[makeHolding()]}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Show revoked-key holdings"),
    ).toBeInTheDocument();
  });

  it("T7: amber chip carries the --color-warning token via inline style (Phase 09.1 IN-01 fix)", () => {
    const holdings = [
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const chip = screen.getByText("Key revoked");
    // Phase 09.1 IN-01 (text) + UI-FLAG-01 (surface + border): chip routes
    // through the warning-family tokens declared in globals.css + DESIGN.md.
    // jsdom does NOT resolve var() — it preserves the literal — so the
    // assertion checks for the var() references for all three properties.
    const style = chip.getAttribute("style") ?? "";
    expect(style).toContain("var(--color-warning)");
    expect(style).toContain("var(--color-warning-bg)");
    expect(style).toContain("var(--color-warning-border)");
  });
});

// ===========================================================================
// Phase 08 Plan 04 Task 1 — HoldingsTable × HoldingNoteRow integration
// (MANAGE-05 holding scope). Covers UI-SPEC §3 trailing note icon + §4b
// inline expandable sub-row + one-open-at-a-time expand/collapse.
// ===========================================================================

describe("HoldingsTable — note icon column + expandable sub-row (08-04 / MANAGE-05)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ updated_at: "2026-04-21T00:00:00Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("T13: renders one HoldingNoteIconButton per holdings row", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({ id: "h2", symbol: "ETH", api_key_id: "key-2" }),
      makeHolding({ id: "h3", symbol: "SOL", api_key_id: "key-3" }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    // Three add-note buttons (no entries in notesByHoldingScopeRef → empty state)
    const addButtons = screen.getAllByRole("button", {
      name: /^Add note for /,
    });
    expect(addButtons).toHaveLength(3);
  });

  it("T14: aria-label flips from 'Add note for ...' to 'Edit note for ...' when the row has an entry in notesByHoldingScopeRef", () => {
    const holdings = [makeHolding({ id: "h1", symbol: "BTC" })];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
        notesByHoldingScopeRef={{
          "binance:BTC:spot": {
            content: "my thesis",
            updated_at: "2026-04-21T00:00:00Z",
          },
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Edit note for BTC spot" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add note for BTC spot" }),
    ).not.toBeInTheDocument();
  });

  it("T15: revoked row's note icon renders with the amber color class", () => {
    const holdings = [
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const icon = screen.getByRole("button", {
      name: "Add note for ETH spot",
    });
    expect(icon.className).toContain("#D97706");
  });

  it("T16: clicking the icon toggles the inline expandable sub-row open/closed", async () => {
    const holdings = [makeHolding({ id: "h1", symbol: "BTC" })];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const icon = screen.getByRole("button", { name: "Add note for BTC spot" });
    expect(screen.queryByRole("region", { name: /Note for BTC spot/ })).toBeNull();
    await act(async () => {
      fireEvent.click(icon);
    });
    expect(
      screen.getByRole("region", { name: "Note for BTC spot" }),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(icon);
    });
    expect(
      screen.queryByRole("region", { name: /Note for BTC spot/ }),
    ).toBeNull();
  });

  it("T17: one-open-at-a-time — clicking icon on row B while row A is open closes row A's sub-row", async () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({ id: "h2", symbol: "ETH", api_key_id: "key-2" }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const iconA = screen.getByRole("button", { name: "Add note for BTC spot" });
    const iconB = screen.getByRole("button", { name: "Add note for ETH spot" });

    await act(async () => {
      fireEvent.click(iconA);
    });
    expect(
      screen.getByRole("region", { name: "Note for BTC spot" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(iconB);
    });
    expect(
      screen.queryByRole("region", { name: /Note for BTC spot/ }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "Note for ETH spot" }),
    ).toBeInTheDocument();
  });

  it("T18+T19: sub-row textarea blur fires PATCH with scope_kind=holding + buildHoldingScopeRef scope_ref", async () => {
    // Phase 08 Plan 05: HoldingNoteRow now fires a mount GET before any PATCH.
    // Override the default 200 (from beforeEach) so the mount GET returns 404
    // (empty state → textarea renders), then the blur PATCH returns 200.
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 404, headers: { "Content-Type": "application/json" } }),
    ); // mount GET → empty edit mode
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ updated_at: "2026-04-21T00:00:00Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ); // blur PATCH → success

    const holdings = [makeHolding({ id: "h1", symbol: "BTC" })];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const icon = screen.getByRole("button", { name: "Add note for BTC spot" });
    await act(async () => {
      fireEvent.click(icon);
    });
    // Wait for the loading gate to resolve to the textarea.
    const region = await waitFor(() => {
      const r = screen.getByRole("region", { name: "Note for BTC spot" });
      expect(within(r).getByRole("textbox")).toBeInTheDocument();
      return r;
    });
    const ta = within(region).getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "core crypto thesis" } });
    });
    await act(async () => {
      fireEvent.blur(ta);
    });
    await waitFor(() => {
      // calls[0] = mount GET, calls[1] = blur PATCH
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    const [url, init] = fetchSpy.mock.calls[1];
    expect(url).toBe("/api/notes");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      scope_kind: "holding",
      scope_ref: "binance:BTC:spot",
      content: "core crypto thesis",
    });
  });

  it("T20: aria-expanded on the note icon mirrors the row's expansion state", async () => {
    const holdings = [makeHolding({ id: "h1", symbol: "BTC" })];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const icon = screen.getByRole("button", { name: "Add note for BTC spot" });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(icon);
    });
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      fireEvent.click(icon);
    });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
  });
});
