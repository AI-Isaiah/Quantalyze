import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HoldingsTable, type HoldingRow as HoldingRowType } from "./HoldingsTable";
import { UNTRUSTED_KEY_SET_NOUN } from "@/lib/closed-sets";

/**
 * Phase 08 Plan 02 Task 2 — HoldingsTable tests (MANAGE-02).
 *
 * Covers the revoked-key visual treatment + allocator-scoped toggle
 * per 08-UI-SPEC.md §2 and 08-CONTEXT.md D-04 / D-05:
 *
 *   - Strikethrough + amber "Key revoked" chip for rows whose source
 *     key has sync_status='revoked'.
 *   - Toggle "Show holdings from <the untrusted-key set noun>" default ON at
 *     render time (copy corrected 2026-09-22, D-16 follow-up — see T6)
 *     (the default comes from the caller; the component itself honours
 *     `showRevoked` verbatim).
 *   - Toggle OFF filters revoked rows from the table ONLY (caller's
 *     responsibility to NOT filter KPI / chart inputs).
 *   - Hidden-footer "{N} holding(s) hidden from <the untrusted-key set noun> ·
 *     Show all" (copy corrected 2026-09-22, D-16 follow-up — see T4/T5/T6)
 *     with the Show-all button firing onShowRevokedChange(true).
 *   - Plural/singular rules for the hidden-footer count.
 */

/**
 * 167 review round 1 / WR-06 — the noun is DATA, not a pattern. Fed into
 * `new RegExp` unescaped, a future noun carrying a metacharacter (`.`, `(`,
 * `+`, `?`) would silently change what T4/T5 match instead of failing.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const NOUN_PATTERN = escapeRegExp(UNTRUSTED_KEY_SET_NOUN);

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

  // ⚠️ T4/T5 copy re-argued 2026-09-22 with T6 (D-16 follow-up): the footer
  // said "hidden from revoked keys" while the filter also hid `sign_in_failed`,
  // so it NAMED A NARROWER SET THAN IT HID. Both pins are derived from the same
  // constant the component renders, so copy and pin cannot drift apart, and the
  // count/pluralisation half of each assertion is unchanged.
  it(`T4: showRevoked=false + 1 hidden → footer reads "1 holding hidden from ${UNTRUSTED_KEY_SET_NOUN} · Show all"; clicking Show all fires onShowRevokedChange(true)`, () => {
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
      screen.getByText(
        new RegExp(`1 holding hidden from\\s+${NOUN_PATTERN}`),
      ),
    ).toBeInTheDocument();
    // Anti-vacuity: the superseded string must be gone, not merely unmatched.
    expect(
      screen.queryByText(/hidden from revoked keys/),
    ).not.toBeInTheDocument();
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
      screen.getByText(
        new RegExp(`2 holdings hidden from\\s+${NOUN_PATTERN}`),
      ),
    ).toBeInTheDocument();
  });

  // ⚠️ CHANGED DELIBERATELY 2026-09-22 (Phase 167 CREDTRUST, D-16 follow-up).
  // This pin previously asserted the label read "Show revoked-key holdings"
  // exactly. That string became a LIE when `sign_in_failed` joined the hidden
  // set: the toggle hid two causes and named one of them, so the surface
  // NAMED A NARROWER SET THAN IT HID. The pin was doing its job — it went RED
  // the moment the copy was corrected, which is exactly what a locked-copy pin
  // is for. It is re-argued here for the string that is now true, never
  // deleted and never relaxed to a substring match.
  //
  // ⛔ It asserts the RENDERED text, and derives it from the same constant the
  // component renders, so the two cannot drift apart. It still fails if the
  // label is emptied, reworded at the call site, or unhooked from its input.
  // ⚠️ It does NOT fail on a rewording made IN THE CONSTANT — the only place
  // the wording now lives (167 review round 1 / WR-06). That is pinned once,
  // literally, in `src/lib/closed-sets.untrusted-key-status.test.ts`.
  it(`T6: toggle label reads "Show holdings from ${UNTRUSTED_KEY_SET_NOUN}" exactly`, () => {
    render(
      <HoldingsTable
        holdings={[makeHolding()]}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(
      screen.getByLabelText(`Show holdings from ${UNTRUSTED_KEY_SET_NOUN}`),
    ).toBeInTheDocument();
    // Anti-vacuity: the OLD string must be gone, or a stale label would satisfy
    // a getByLabelText that merely found *some* matching node.
    expect(
      screen.queryByLabelText("Show revoked-key holdings"),
    ).not.toBeInTheDocument();
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

  // M-0077 — the note sub-row (HoldingNoteRow) fires a GET /api/notes on
  // mount to hydrate existing content. T16 covers the open→close toggle, but
  // not the fetch-on-mount RACE: opening the row (mount → GET in flight) then
  // immediately closing it (unmount) BEFORE the GET resolves. HoldingNoteRow's
  // mount effect uses a `cancelled` flag in cleanup so a post-unmount resolve
  // is dropped. The correct behaviour is: no late state update / React act
  // warning, and no stale region left mounted after the deferred resolve.
  it("M-0077: opening then immediately closing the note row before its mount-GET resolves leaves no stale region and does not warn", async () => {
    // Defer the GET so it is still pending when we close the row.
    let resolveGet: ((r: Response) => void) | null = null;
    fetchSpy.mockReset();
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveGet = resolve;
        }),
    );

    // React logs act/state-after-unmount issues via console.error — capture
    // them so a regression that drops the `cancelled` guard surfaces here.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const holdings = [makeHolding({ id: "h1", symbol: "BTC" })];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const icon = screen.getByRole("button", { name: "Add note for BTC spot" });

    // Open (mounts the sub-row → GET starts) then close (unmounts) rapidly,
    // both while the GET is still pending.
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

    // Now resolve the orphaned GET — the cancelled-guard must swallow the
    // result without a post-unmount state update.
    await act(async () => {
      resolveGet?.(
        new Response(JSON.stringify({ content: "late", updated_at: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await Promise.resolve();
    });

    // Region stays closed; no React act/state-after-unmount warning fired.
    expect(
      screen.queryByRole("region", { name: /Note for BTC spot/ }),
    ).toBeNull();
    const offenders = errorSpy.mock.calls.filter((c) =>
      String(c[0] ?? "").match(/unmounted|not wrapped in act|state update/i),
    );
    expect(offenders).toHaveLength(0);
    errorSpy.mockRestore();
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

/**
 * Phase 169 D-50 (founder UAT 2026-09-27) — the legacy Holdings table rendered
 * its entry price through the whole-dollar amount formatter (so $0.42 read "$0")
 * and its P&L through a private formatter that picked the sign before rounding
 * to whole dollars (so +$0.37 read "+$0" and -0.0001 read "−$0"). Prices keep
 * their precision, P&L shows cents with the sign of the rounded value, and
 * value (an amount) stays whole dollars. Every expected string is a typed
 * literal.
 */
describe("[169 D-50] HoldingsTable money cells", () => {
  // Column order: Venue / Symbol, Type, Quantity, Entry price, Value (USD),
  // Unrealized P&L, Notes.
  const ENTRY = 3;
  const VALUE = 4;
  const PNL = 5;

  function rowCells(container: HTMLElement): HTMLTableCellElement[] {
    return Array.from(
      container.querySelector("tbody")!.querySelectorAll("tr")[0].querySelectorAll("td"),
    );
  }

  function renderOne(overrides: Partial<HoldingRow>) {
    return render(
      <HoldingsTable
        holdings={[makeHolding(overrides)]}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
  }

  it("a sub-dollar entry price renders at 4 significant digits; value stays whole-dollar", () => {
    const { container } = renderOne({ entry_price: 0.4213, value_usd: 1_234.56 });
    const cells = rowCells(container);
    expect(cells[ENTRY].textContent).toBe("$0.4213");
    expect(cells[VALUE].textContent).toBe("$1,235");
  });

  it("a sub-dollar P&L keeps its cents and its sign, and the cell stays uncoloured", () => {
    const { container } = renderOne({ unrealized_pnl_usd: 0.37 });
    const cell = rowCells(container)[PNL];
    expect(cell.textContent).toBe("+$0.37");
    expect(cell.getAttribute("style")).toBeNull();
  });

  it("a P&L that rounds to zero reads $0.00 with no sign — never −$0", () => {
    const { container } = renderOne({ unrealized_pnl_usd: -0.0001 });
    expect(rowCells(container)[PNL].textContent).toBe("$0.00");
  });

  it("a null entry price and a null P&L stay the em-dash", () => {
    const { container } = renderOne({ entry_price: null, unrealized_pnl_usd: null });
    const cells = rowCells(container);
    expect(cells[ENTRY].textContent).toBe("—");
    expect(cells[PNL].textContent).toBe("—");
  });
});

/**
 * Phase 164.6.6.2.1 plan 17 (D-01, D-17, D-21) — a native-unit account's
 * Holdings row shows its quantity in its stored unit and its USD value with
 * the conversion stated. The unit comes from the row's stored `quantity_unit`
 * only: never inferred from the symbol or from the mark.
 */
describe("HoldingsTable — native-unit account row (164.6.6.2.1 / D-01, D-17, D-21)", () => {
  const QTY = 2;
  const ENTRY = 3;
  const VALUE = 4;
  const TITLE =
    "0.4213 BTC × $61,950.00, converted from BTC at the stored daily BTC close";

  function cellsOf(container: HTMLElement): HTMLTableCellElement[] {
    return Array.from(
      container.querySelector("tbody")!.querySelectorAll("tr")[0].querySelectorAll("td"),
    );
  }

  // The worked input of the UI-SPEC (F): 0.4213 BTC x $61,950.00 = $26,099.54.
  function accountRow(overrides: Partial<HoldingRow> = {}): HoldingRow {
    return makeHolding({
      id: "holding-account",
      venue: "mt5",
      symbol: "ACCOUNT-1a2b3c4d",
      quantity: 0.4213,
      mark_price_usd: 61_950,
      value_usd: 26_099.54,
      entry_price: null,
      unrealized_pnl_usd: null,
      quantity_unit: "BTC",
      ...overrides,
    });
  }

  function renderRow(row: HoldingRow) {
    return render(
      <HoldingsTable holdings={[row]} showRevoked={true} onShowRevokedChange={() => {}} />,
    );
  }

  it("shows the quantity in its stored unit, the unchanged em-dash entry price, and the USD value with the conversion as title and sr-only text", () => {
    const { container } = renderRow(accountRow());
    const cells = cellsOf(container);
    expect(cells[QTY].textContent).toBe("0.4213 BTC");
    expect(cells[ENTRY].textContent).toBe("—");
    expect(cells[VALUE].getAttribute("title")).toBe(TITLE);
    const sr = cells[VALUE].querySelector("span.sr-only");
    expect(sr).not.toBeNull();
    expect(sr!.textContent).toBe(` (${TITLE})`);
    // The visible value is the whole-dollar USD figure; the sr-only span adds
    // the sentence after it, never in place of it.
    expect(cells[VALUE].textContent).toBe(`$26,100 (${TITLE})`);
  });

  it("a row with no stored unit renders today's cells exactly: no title, no sr-only span, the symbol never read for a unit", () => {
    const { container } = renderRow(accountRow({ quantity_unit: null }));
    const cells = cellsOf(container);
    expect(cells[QTY].textContent).toBe("0.4213");
    expect(cells[VALUE].textContent).toBe("$26,100");
    expect(cells[VALUE].hasAttribute("title")).toBe(false);
    expect(cells[VALUE].querySelector("span.sr-only")).toBeNull();
  });

  it("a row whose unit field is absent (a legacy fixture) is the same as null", () => {
    const row = accountRow();
    delete row.quantity_unit;
    const { container } = renderRow(row);
    const cells = cellsOf(container);
    expect(cells[QTY].textContent).toBe("0.4213");
    expect(cells[VALUE].hasAttribute("title")).toBe(false);
  });

  it.each(["btc", "<b>X</b>", "B", "TOOLONGUNITXX", "BTC "])(
    "a malformed stored unit %j is treated as absent (parsed, never printed)",
    (unit) => {
      const { container } = renderRow(accountRow({ quantity_unit: unit }));
      const cells = cellsOf(container);
      expect(cells[QTY].textContent).toBe("0.4213");
      expect(cells[VALUE].hasAttribute("title")).toBe(false);
      expect(cells[VALUE].querySelector("span.sr-only")).toBeNull();
      expect(container.innerHTML).not.toContain("<b>X</b>");
    },
  );

  it("a stored unit with no mark prints no invented price: the unit shows, the conversion sentence does not", () => {
    const { container } = renderRow(accountRow({ mark_price_usd: null }));
    const cells = cellsOf(container);
    expect(cells[QTY].textContent).toBe("0.4213 BTC");
    expect(cells[VALUE].hasAttribute("title")).toBe(false);
    expect(cells[VALUE].querySelector("span.sr-only")).toBeNull();
    expect(cells[VALUE].textContent).toBe("$26,100");
  });

  it("a USD-family row is untouched by the unit path", () => {
    const { container } = renderRow(
      makeHolding({ quantity: 1.5, value_usd: 90_000, entry_price: 60_000, quantity_unit: null }),
    );
    const cells = cellsOf(container);
    expect(cells[QTY].textContent).toBe("1.50");
    expect(cells[VALUE].textContent).toBe("$90,000");
    expect(cells[VALUE].hasAttribute("title")).toBe(false);
  });
});
