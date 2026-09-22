import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { ApiKeyManager } from "./ApiKeyManager";
import { TRUSTED_OR_NEUTRAL_KEY_SYNC_STATUSES } from "@/lib/closed-sets";

/**
 * H-0395 (F1 loud-fail discipline) — ApiKeyManager.loadKeys must discriminate
 * a failed api_keys SELECT (network / RLS regression / expired session) from a
 * genuine "no keys yet" empty result.
 *
 * Pre-fix the effect destructured `{ data, error }` and logged the error, but
 * still fell through to the render showing "No API keys connected" whenever
 * `data` was null — so a load FAILURE was disguised as the all-clear empty
 * state. A user who actually has keys would think they had vanished and could
 * re-add a duplicate. The fix surfaces a distinct, retryable error banner and
 * gates the empty state on `!loadError`.
 *
 * These tests assert:
 *   - SELECT error → error banner ("Couldn't load your API keys") + Retry,
 *     and NOT the misleading "No API keys connected" copy. (FAILS without fix)
 *   - genuine empty result (no error, [] rows) → still shows the empty state
 *     (happy path / "no keys yet" UX preserved).
 *   - clicking Retry re-runs loadKeys and, on a now-successful response,
 *     replaces the error banner with the loaded key list.
 */

// --- Mocks wiring -----------------------------------------------------------

const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Supabase client mock. `selectResultMock` controls what the
// `.from("api_keys").select(...).order(...)` chain resolves to. Each test
// queues the result(s) the component's loadKeys() effect should observe.
const selectResultMock = vi.fn();
// 160-02 / RANK-03: this spy USED to capture the api_keys insert payload the
// component composed itself. The component no longer inserts — the route's
// persist arm writes the row server-side, stamping the venue IT validated. The
// spy is KEPT, and its role is now inverted: it is the NEGATIVE oracle. Any
// future edit that reintroduces a browser-composed api_keys INSERT (the exact
// regression this phase exists to remove, and which plan 160-05's `REVOKE
// INSERT` will turn into a hard 42501) makes it fire, and the assertions below
// go red. Deleting this mock would delete the alarm.
const apiKeyInsertMock = vi.fn();
// Captures `strategies.update({ api_key_id })` payloads, so a test can assert
// the link is made with the id the ROUTE returned rather than a client-minted
// one.
const strategiesUpdateMock = vi.fn();
// Records which table each chain targeted — an assertion that "the update went
// to strategies" is worthless if the mock would accept any table name.
const fromTableMock = vi.fn();
// 167-06 (R5): `handleDeleteKey` does
// `from("api_keys").delete().eq("id", …).select("id")`. The mock had no
// `delete`, so every Delete case threw. The spy receives the TABLE name, so a
// case can assert the delete went to `api_keys` (same reason as
// `fromTableMock`). It returns the queued result, defaulting to success: ONE
// removed row carrying the id (167-06 fix round, a delete that removed no row
// is a failure, not a success).
const apiKeyDeleteMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-a" } }, error: null }),
    },
    from: (table: string) => {
      fromTableMock(table);
      return {
        select: (_cols: string) => ({
          order: (_col: string, _opts?: unknown) =>
            Promise.resolve(selectResultMock()),
        }),
        // Retained as the negative oracle — see apiKeyInsertMock above.
        insert: (row: unknown) => {
          const result = apiKeyInsertMock(row);
          return {
            select: (_cols?: string) => ({
              single: () =>
                Promise.resolve(
                  result ?? { data: { id: "new-key" }, error: null },
                ),
            }),
          };
        },
        // handleLinkKey does strategies.update({api_key_id}).eq('id', ...).
        update: (vals: unknown) => {
          const queued = strategiesUpdateMock({ table, vals });
          return {
            eq: (_col: string, _val: unknown) =>
              Promise.resolve(queued ?? { error: null }),
          };
        },
        // handleDeleteKey does api_keys.delete().eq('id', ...). See
        // apiKeyDeleteMock above.
        delete: () => ({
          eq: (_col: string, val: unknown) => ({
            select: (_cols?: string) =>
              Promise.resolve(
                apiKeyDeleteMock(table) ?? { data: [{ id: val }], error: null },
              ),
          }),
        }),
      };
    },
  }),
}));

// Capture SyncProgress's onStatusChange so a test can drive the terminal
// callback directly (mig 20260707120000 regression: complete_with_warnings must
// be treated as a terminal SUCCESS, clearing syncingKeyId + refreshing).
let capturedOnStatusChange: ((s: string) => void) | null = null;
vi.mock("./SyncProgress", () => ({
  SyncProgress: (props: {
    syncStatus?: string;
    syncError?: string | null;
    onStatusChange?: (s: string) => void;
  }) => {
    capturedOnStatusChange = props.onStatusChange ?? null;
    // 140.3-08 / SEAMUX-05: render the two props ApiKeyManager drives on a sync
    // failure. The real SyncProgress renders both (a status label and the
    // syncError detail line), and without them in the DOM a test cannot tell
    // "the failure reached THIS component's surface" from "the failure reached
    // console.warn and nothing else" — which is exactly the B-06 defect.
    return (
      <div data-testid="sync-progress" data-sync-status={props.syncStatus}>
        {props.syncError}
      </div>
    );
  },
}));

// Polyfill jsdom's missing HTMLDialogElement methods so the <Modal> the
// component renders doesn't throw on mount.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

describe("ApiKeyManager — H-0395 loud-fail on api_keys load failure", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a retryable error banner (NOT the empty state) when the api_keys SELECT errors", async () => {
    // Simulate an RLS/session/network failure: data null + error present.
    selectResultMock.mockReturnValue({
      data: null,
      error: { message: "permission denied for table api_keys" },
    });

    await act(async () => {
      render(
        <ApiKeyManager strategyId="strat-1" currentKeyId={null} />,
      );
    });

    // Loud-fail banner is shown.
    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't load your API keys/i),
      ).toBeInTheDocument();
    });
    // Retry affordance present.
    expect(
      screen.getByRole("button", { name: /Retry/i }),
    ).toBeInTheDocument();
    // CRITICAL: the misleading "No API keys connected" all-clear copy must NOT
    // be shown — that is the regression this finding closes.
    expect(
      screen.queryByText(/No API keys connected/i),
    ).not.toBeInTheDocument();
  });

  it("shows the genuine empty state (not an error) when the SELECT succeeds with zero rows", async () => {
    selectResultMock.mockReturnValue({ data: [], error: null });

    await act(async () => {
      render(
        <ApiKeyManager strategyId="strat-1" currentKeyId={null} />,
      );
    });

    // Happy path preserved: genuine "no keys yet" empty state renders.
    await waitFor(() => {
      expect(
        screen.getByText(/No API keys connected/i),
      ).toBeInTheDocument();
    });
    // And NO error banner.
    expect(
      screen.queryByText(/Couldn't load your API keys/i),
    ).not.toBeInTheDocument();
  });

  it("clicking Retry re-runs loadKeys and replaces the error banner with the loaded keys", async () => {
    // First load fails, retry succeeds and returns a key row.
    selectResultMock
      .mockReturnValueOnce({
        data: null,
        error: { message: "network error" },
      })
      .mockReturnValueOnce({
        data: [
          {
            id: "key-1",
            exchange: "binance",
            label: "My Binance",
            last_sync_at: null,
          },
        ],
        error: null,
      });

    await act(async () => {
      render(
        <ApiKeyManager strategyId="strat-1" currentKeyId={null} />,
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't load your API keys/i),
      ).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    });

    // After a successful retry: key list renders, error banner gone.
    await waitFor(() => {
      expect(screen.getByText("My Binance")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/Couldn't load your API keys/i),
    ).not.toBeInTheDocument();
  });
});

/**
 * M-0456 (audit-2026-05-07) — ApiKeyManager swapped its api_keys read from a
 * broad projection to the `API_KEY_USER_COLUMNS` allowlist. The static
 * sec-005-api-keys-projection regex test catches a `.select("*")` regression,
 * but the RENDER side was untested: the only prior row-column assertion is the
 * label ("My Binance" in the H-0395 retry test above).
 *
 * This pins the RENDER CONTRACT — given a row, ApiKeyManager reads `key.exchange`
 * (capitalized exchange name) and `key.last_sync_at` (the "· Last synced …"
 * line) and surfaces BOTH. (The supabase mock here ignores the projection
 * argument, so this guards the render path, not the literal projection string;
 * the static sec-005 test owns the projection-string axis.) Together they cover
 * the degraded-card risk: if the manager stops reading a column — or that column
 * arrives null/absent from a runtime allowlist drop — the card degrades ("?"
 * icon, missing name, no "Last synced" line) and this test fails.
 *
 * NB the finding's `sync_status` / `is_active` worry is a MISREAD for THIS
 * component: ApiKeyManager derives SyncProgress.syncStatus from component state,
 * not from `key.sync_status`, and never reads `key.is_active`. Those columns are
 * consumed + already discriminatingly tested by the sibling
 * AllocatorExchangeManager (pill text / Disconnected section). So for
 * ApiKeyManager the genuine residual is exactly exchange + last_sync_at.
 *
 * CORRECTED 2026-09-22 (167-06): the paragraph above is kept as lineage and is
 * no longer true in one respect. ApiKeyManager now READS `key.sync_status`, for
 * the untrusted partition only (`isUntrustedKeySyncStatus`), and mounts the
 * existing `AllocatorSyncStatus` pill on that key's card. `SyncProgress`'s
 * status is still component state, never the column. The healthy `complete`
 * fixtures in this block render nothing new, which the `[167-06]` describe
 * pins with its healthy control over every trusted-or-neutral status.
 */
describe("ApiKeyManager — M-0456 projection allowlist columns reach the UI", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the exchange-derived name and the last-synced line from a full row", async () => {
    // A full api_keys row (every API_KEY_USER_COLUMNS field present).
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-1",
          user_id: "user-a",
          exchange: "binance",
          label: "My Binance",
          is_active: true,
          sync_status: "complete",
          last_sync_at: "2026-04-19T11:58:00Z",
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: null,
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    // Label column.
    await waitFor(() => {
      expect(screen.getByText("My Binance")).toBeInTheDocument();
    });
    // exchange (→ "Binance") AND last_sync_at (→ "· Last synced …") render in a
    // single <p>; anchoring on `^Binance` disambiguates from the "My Binance"
    // label node. If the manager stops reading `exchange`/`last_sync_at`, or
    // either arrives null/absent on the row, this assertion fails — the
    // render-contract guard for the degraded-card regression.
    expect(
      screen.getByText(/^Binance\s*·\s*Last synced/),
    ).toBeInTheDocument();
  });

  // UX-01 (#30) — Deribit went live in v1.7 but the local exchangeIcon map was
  // missing the `deribit` case, so the badge fell through to the "?" fallback,
  // making a live-and-correct key look broken. The canonical 3-letter tag is
  // "DRB" (AllocatorExchangeManager EXCHANGE_TAGS, DESIGN.md no-emoji convention).
  // Pins the badge render: a deribit row must show "DRB", never "?". FAILS
  // without the map entry.
  it("renders the DRB badge (not '?') for a deribit key row", async () => {
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-drb",
          user_id: "user-a",
          exchange: "deribit",
          label: "My Deribit",
          is_active: true,
          sync_status: "complete",
          last_sync_at: "2026-04-19T11:58:00Z",
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: null,
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    await waitFor(() => {
      expect(screen.getByText("My Deribit")).toBeInTheDocument();
    });
    // Canonical badge text renders …
    expect(screen.getByText("DRB")).toBeInTheDocument();
    // … and the degraded "?" fallback does NOT.
    expect(screen.queryByText("?")).not.toBeInTheDocument();
  });

  // SFOX-09 — sfox ships UNCONDITIONALLY (a founder-connected sfox key exists
  // before the public offer flag flips). Without the exchangeIcon `sfox` entry
  // the avatar falls through to "?", making a live-and-correct key look broken.
  // Pins the mono tag: a sfox row must show "SFOX", never "?". FAILS without
  // the map entry.
  it("renders the SFOX badge (not '?') for a sfox key row (SFOX-09)", async () => {
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-sfox",
          user_id: "user-a",
          exchange: "sfox",
          label: "My sFOX",
          is_active: true,
          sync_status: "complete",
          last_sync_at: "2026-04-19T11:58:00Z",
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: null,
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    await waitFor(() => {
      expect(screen.getByText("My sFOX")).toBeInTheDocument();
    });
    // Canonical mono tag renders …
    expect(screen.getByText("SFOX")).toBeInTheDocument();
    // … and the degraded "?" fallback does NOT.
    expect(screen.queryByText("?")).not.toBeInTheDocument();
  });

  // 138-03 / MT5UI-02 — mt5 ships its provenance mono tag UNCONDITIONALLY (the
  // SFOX-09 precedent): a founder-connected mt5 key exists before the go-live
  // offer flag (NEXT_PUBLIC_MT5_ENABLED) flips, so the key card must render the
  // real "MT5" tag, never the "?" unknown-exchange fallback. Pins the mono tag:
  // an mt5 row must show "MT5", never "?". FAILS without the exchangeIcon entry.
  it("renders the MT5 badge (not '?') for an mt5 key row (138-03)", async () => {
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-mt5",
          user_id: "user-a",
          exchange: "mt5",
          label: "My MT5",
          is_active: true,
          sync_status: "complete",
          last_sync_at: "2026-04-19T11:58:00Z",
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: null,
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    await waitFor(() => {
      expect(screen.getByText("My MT5")).toBeInTheDocument();
    });
    // Canonical mono tag renders …
    expect(screen.getByText("MT5")).toBeInTheDocument();
    // … and the degraded "?" fallback does NOT.
    expect(screen.queryByText("?")).not.toBeInTheDocument();
  });

  // Phase 164.5.3 (MT5CREDS) — venue_account_id (migration 20260920120000)
  // renders on the MT5 card so a founder can tell which MT5 account a key
  // belongs to. Synthetic placeholder id per the phase's non-negotiable
  // (never a real-looking MT5 login/account number).
  it("renders the MT5 account identifier in .font-metric, un-separated, for an mt5 row with a value", async () => {
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-mt5-id",
          user_id: "user-a",
          exchange: "mt5",
          label: "My MT5",
          is_active: true,
          sync_status: "complete",
          last_sync_at: "2026-04-19T11:58:00Z",
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: "synth1234",
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    const identifier = await screen.findByText("MT5 account synth1234");
    expect(identifier).toBeInTheDocument();
    expect(identifier).toHaveClass("font-metric");
    // Never comma-grouped — this is an identifier, not a quantity (D-06).
    expect(identifier.textContent).not.toMatch(/,/);
  });

  it("renders an em-dash for an mt5 row with a NULL venue_account_id (never 0, never blank)", async () => {
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-mt5-null",
          user_id: "user-a",
          exchange: "mt5",
          label: "My MT5",
          is_active: true,
          sync_status: "complete",
          last_sync_at: "2026-04-19T11:58:00Z",
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: null,
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    expect(await screen.findByText("MT5 account —")).toBeInTheDocument();
    expect(screen.queryByText("MT5 account 0")).not.toBeInTheDocument();
  });

  it("renders NO account-identifier line for a non-MT5 row", async () => {
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-binance-2",
          user_id: "user-a",
          exchange: "binance",
          label: "My Binance",
          is_active: true,
          sync_status: "complete",
          last_sync_at: "2026-04-19T11:58:00Z",
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: null,
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    await waitFor(() => {
      expect(screen.getByText("My Binance")).toBeInTheDocument();
    });
    expect(screen.queryByText(/MT5 account/)).not.toBeInTheDocument();
  });
});

/**
 * Phase 164.5.3 / MT5CREDS Plan 05 — the "Update password" affordance on
 * ApiKeyManager's card. Distinct action from Delete: it opens
 * UpdateMt5SecretDialog rather than mutating anything directly, and is
 * gated to `exchange === "mt5"` rows only (this component has no
 * disconnected-state concept of its own, so it always renders for MT5).
 */
describe("ApiKeyManager — Update password affordance (Phase 164.5.3 Plan 05)", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mt5Row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "key-mt5-update",
      user_id: "user-a",
      exchange: "mt5",
      label: "My MT5",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-04-19T11:58:00Z",
      account_balance_usdt: 1000,
      created_at: "2026-01-01T00:00:00Z",
      sync_error: null,
      last_429_at: null,
      disconnected_at: null,
      venue_account_id: "synth1234",
      ...overrides,
    };
  }

  function binanceRow() {
    return {
      id: "key-binance-update",
      user_id: "user-a",
      exchange: "binance",
      label: "My Binance",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-04-19T11:58:00Z",
      account_balance_usdt: 1000,
      created_at: "2026-01-01T00:00:00Z",
      sync_error: null,
      last_429_at: null,
      disconnected_at: null,
      venue_account_id: null,
    };
  }

  it("shows Update password for an MT5 row and clicking it opens the dialog for that row's id", async () => {
    selectResultMock.mockReturnValue({ data: [mt5Row()], error: null });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    await waitFor(() => {
      expect(screen.getByText("My MT5")).toBeInTheDocument();
    });

    const updateButton = screen.getByRole("button", {
      name: /Update password/i,
    });
    expect(updateButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(updateButton);
    });

    // The dialog OPENED (its <dialog> now carries `open`) for THIS row's id
    // — not merely present in the DOM, which the Modal always renders.
    const updateDialog = Array.from(document.querySelectorAll("dialog")).find(
      (d) => d.textContent?.includes("New password"),
    );
    expect(updateDialog).toHaveAttribute("open");
    // Submitting reaches THIS row's id.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-investor-password" },
    });
    await act(async () => {
      const matches = screen.getAllByRole("button", {
        name: "Update password",
      });
      fireEvent.click(matches[matches.length - 1]);
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/keys/key-mt5-update/rotate-secret",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("shows NO Update password button for a non-MT5 row", async () => {
    selectResultMock.mockReturnValue({ data: [binanceRow()], error: null });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    await waitFor(() => {
      expect(screen.getByText("My Binance")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /Update password/i }),
    ).not.toBeInTheDocument();
  });

  it("a successful password update calls loadKeys() (re-fetches api_keys) and closes the dialog", async () => {
    selectResultMock.mockReturnValue({ data: [mt5Row()], error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId={null} />);
    });

    await waitFor(() => {
      expect(screen.getByText("My MT5")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Update password/i }));
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-investor-password" },
    });

    const callsBeforeSubmit = selectResultMock.mock.calls.length;

    // Two "Update password" buttons now match — the row's own ghost button
    // AND the now-open dialog's submit button. Scope to the dialog: it is
    // the LAST match in DOM order (rendered after the card list + delete
    // Modal).
    await act(async () => {
      const matches = screen.getAllByRole("button", {
        name: "Update password",
      });
      fireEvent.click(matches[matches.length - 1]);
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/keys/key-mt5-update/rotate-secret",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    // onUpdated -> loadKeys() re-ran the api_keys SELECT.
    await waitFor(() => {
      expect(selectResultMock.mock.calls.length).toBeGreaterThan(
        callsBeforeSubmit,
      );
    });

    // Dialog closed — the Modal's <dialog> element no longer carries `open`,
    // and the secret was scrubbed from state on the success path.
    await waitFor(() => {
      const dialogs = document.querySelectorAll("dialog");
      const updateDialog = Array.from(dialogs).find((d) =>
        d.textContent?.includes("New password"),
      );
      expect(updateDialog).not.toHaveAttribute("open");
    });
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });
});

// mig 20260707120000 — a warned sync (complete_with_warnings) is a terminal
// SUCCESS. If ApiKeyManager's status handler only matches "complete", a warned
// resync leaves syncingKeyId set forever: every Resync/Use button stays disabled
// ("Syncing…") while the panel says "Synced with warnings" — a dead-lock only a
// reload recovers. This drives SyncProgress's onStatusChange with the warned
// value and asserts the button re-enables.
describe("ApiKeyManager — complete_with_warnings is terminal (mig 20260707120000)", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
    capturedOnStatusChange = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the syncing lock on a complete_with_warnings terminal status", async () => {
    selectResultMock.mockReturnValue({
      data: [
        {
          id: "key-1",
          user_id: "user-a",
          exchange: "binance",
          label: "My Binance",
          is_active: true,
          sync_status: "complete",
          last_sync_at: null,
          account_balance_usdt: 1000,
          created_at: "2026-01-01T00:00:00Z",
          sync_error: null,
          last_429_at: null,
          disconnected_at: null,
          venue_account_id: null,
        },
      ],
      error: null,
    });

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-1" />);
    });
    await waitFor(() => expect(screen.getByText("My Binance")).toBeInTheDocument());

    // Kick off a sync → syncStatus becomes non-idle, button shows "Syncing…",
    // and the (mocked) SyncProgress captures onStatusChange.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Resync/i }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Syncing/i })).toBeInTheDocument();
      expect(capturedOnStatusChange).not.toBeNull();
    });

    // The warned terminal status arrives. The lock MUST clear (button → Resync).
    await act(async () => {
      capturedOnStatusChange!("complete_with_warnings");
    });
    expect(
      screen.getByRole("button", { name: /Resync/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Syncing/i }),
    ).not.toBeInTheDocument();
  });
});

/**
 * 160-02 / RANK-03 — THE CONVERSION: this component stops writing api_keys.
 *
 * WHAT CHANGED AND WHY IT MATTERS. `api_keys.exchange` decides the
 * annualization factor a strategy's Sharpe is computed with (√365 crypto vs
 * √252 traditional, ~1.20× apart). Composing that row in the BROWSER meant the
 * venue on it was a client assertion. handleAddKey now sends `persist: true`,
 * the route validates the credentials against the venue and writes the row
 * itself stamping both venue columns, and this component consumes the
 * `api_key_id` it gets back.
 *
 * F6 (phase-119 fold-in) is FOLDED IN rather than deleted: the canonical
 * lowercase exchange still has to leave this component, because it is what the
 * request body carries. What it no longer feeds is a client INSERT.
 *
 * Tests drive the REAL ApiKeyForm (defaultExchange seeds the exchange state)
 * and assert at the call site — a helper-only test would not prove the wiring.
 * Neuter `data.exchange.trim().toLowerCase()` back to `data.exchange` and the
 * sFOX case reddens; delete `persist: true` from the body and the discriminator
 * assertions redden; restore a client `.from("api_keys").insert(...)` and the
 * negative oracle reddens.
 */
describe("ApiKeyManager — 160-02 conversion: server persists, client consumes api_key_id", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
    apiKeyInsertMock.mockReset();
    strategiesUpdateMock.mockReset();
    fromTableMock.mockReset();
    // Empty key list on mount so the Add-Key form is the whole surface.
    selectResultMock.mockReturnValue({ data: [], error: null });
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/keys/validate-and-encrypt") {
        // The PERSIST-mode envelope: an id, the verdict, and no ciphertext.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            api_key_id: "server-minted-key-id",
            valid: true,
            read_only: true,
          }),
        });
      }
      // Background auto-sync (fire-and-forget).
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function submitAddKeyForm() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
    });
    const labelInput = screen.getByLabelText(/Label/i);
    const keyInput = screen.getByLabelText(/API Key$/i);
    const secretInput = screen.getByLabelText("API Secret");
    fireEvent.change(labelInput, { target: { value: "Test Key" } });
    fireEvent.change(keyInput, { target: { value: "test-key" } });
    fireEvent.change(secretInput, { target: { value: "test-secret" } });
    const form = labelInput.closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });
  }

  function validateBody() {
    const call = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/keys/validate-and-encrypt",
    );
    expect(call).toBeTruthy();
    return JSON.parse(call![1].body as string) as {
      exchange: string;
      persist?: unknown;
      label?: unknown;
    };
  }

  it("sends the persist discriminator as a STRICT boolean, with the label the server will write", async () => {
    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="binance"
      />,
    );
    await submitAddKeyForm();

    await waitFor(() => {
      expect(validateBody().persist).toBe(true);
    });
    // A truthy string would be silently ignored by the route's `=== true`
    // discriminator, which would leave the key unsaved with no error — so the
    // TYPE is the assertion, not merely the presence.
    expect(typeof validateBody().persist).toBe("boolean");
    // The label moves into the request because the SERVER composes the row now.
    expect(validateBody().label).toBe("Test Key");
  });

  it("canonicalizes a mixed-case 'sFOX' to 'sfox' in the validate body (F6, folded in)", async () => {
    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="sFOX"
      />,
    );
    await submitAddKeyForm();

    await waitFor(() => {
      expect(validateBody().exchange).toBe("sfox");
    });
  });

  it("leaves an already-lowercase 'binance' byte-identical (no regression)", async () => {
    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="binance"
      />,
    );
    await submitAddKeyForm();

    await waitFor(() => {
      expect(validateBody().exchange).toBe("binance");
    });
  });

  // ── THE NEGATIVE ORACLE ───────────────────────────────────────────────────
  it("performs NO api_keys INSERT from the browser", async () => {
    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="binance"
      />,
    );
    await submitAddKeyForm();

    // Wait for the flow to actually reach its end, so this is not a vacuous
    // "nothing happened yet" pass.
    await waitFor(() => {
      expect(strategiesUpdateMock).toHaveBeenCalled();
    });
    expect(apiKeyInsertMock).not.toHaveBeenCalled();
    // …and the api_keys table was touched for READS only (loadKeys' select).
    // After plan 160-05's REVOKE, a client INSERT here would be a hard 42501.
    expect(fromTableMock.mock.calls.map((c) => c[0])).toContain("strategies");
  });

  // ── THE LINK USES THE SERVER'S ID ─────────────────────────────────────────
  it("links the strategy to the api_key_id the ROUTE returned", async () => {
    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="binance"
      />,
    );
    await submitAddKeyForm();

    await waitFor(() => {
      expect(strategiesUpdateMock).toHaveBeenCalledWith({
        table: "strategies",
        vals: { api_key_id: "server-minted-key-id" },
      });
    });
  });

  it("surfaces the link failure instead of syncing against the wrong key (NEW-C37-03 preserved)", async () => {
    strategiesUpdateMock.mockReturnValue({
      error: { message: "permission denied for table strategies" },
    });

    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="binance"
      />,
    );
    await submitAddKeyForm();

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to link key to strategy/i),
      ).toBeInTheDocument();
    });
    // The sync must NOT have run: syncing after a failed link would present
    // the OLD key's data as this key's success.
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync"),
    ).toBe(false);
  });

  // ── A 2xx WITHOUT AN ID IS A FAILURE, NOT A SILENT SUCCESS ────────────────
  it("fails loud when the route returns 2xx but no api_key_id (no false success)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/keys/validate-and-encrypt") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ valid: true, read_only: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true }),
      });
    });

    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="binance"
      />,
    );
    await submitAddKeyForm();

    // The user is TOLD. Reporting success here would leave a key that is
    // unlinked and will never sync, with a UI that says it was added.
    await waitFor(() => {
      expect(screen.getByText(/verified but not saved/i)).toBeInTheDocument();
    });
    expect(strategiesUpdateMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync"),
    ).toBe(false);
  });
});

/**
 * Phase 140.3 plan 08 / SEAMUX-05 (+ SEAMUX-04's C-9 sub-finding) — both
 * `/api/keys/sync` call sites in this component must observe the HTTP OUTCOME,
 * not merely a transport rejection.
 *
 * Three defects, all live before this plan:
 *
 *  1. **B-06, the background sync.** `handleAddKey` fired
 *     `fetch("/api/keys/sync", …).catch(…)` with a comment claiming it handled
 *     failure. `.catch()` fires ONLY when the request never completed, so a 401,
 *     403, 500 or a breaker 503 was completely invisible — the user was told the
 *     key was added and nothing ever said the sync had not started.
 *  2. **B-15, the explicit sync.** `handleSyncTrades` checked `res.ok` but never
 *     read the body, so ANY 2xx set `syncStatus("computing")` and started the
 *     poll. `/api/keys/sync` deliberately answers an unrecognised upstream shape
 *     with an UN-stamped passthrough (route.ts: "marking an unrecognized shape
 *     ok:true would falsely signal success"), so the one response that means
 *     "no job was enqueued" was the one that started a 15-minute poll for it.
 *  3. **C-9, the copy.** The non-JSON `!res.ok` arm threw
 *     *"Analytics service unavailable. Ensure SUPABASE_SERVICE_ROLE_KEY is
 *     configured."* — user-facing copy naming an internal environment variable.
 *
 * Plus one found while rewriting that arm and fixed here rather than left for a
 * second pass: the JSON branch read `err.error` ALONE, and every failure envelope
 * `postProcessKey` builds carries its copy under `human_message`, not `error`
 * (`process-key-client.ts`, the `CircuitOpenError` arm). So a breaker 503 —
 * whose sentence `140.3-04` consolidated onto ONE production source precisely so
 * it reaches users — rendered as the generic "Trade sync failed" at this seam
 * consumer. Same class as `140.3-07`'s B-27 finding: a failure path that
 * swallows copy a route deliberately wrote.
 *
 * Every literal below is HAND-TYPED, never imported from the module under test
 * or from `src/lib/seam-copy.ts` (lesson C-1: an oracle that reads its subject
 * cannot detect its subject changing).
 */
describe("ApiKeyManager — SEAMUX-05: both sync call sites observe the HTTP outcome", () => {
  // Hand-typed. `src/lib/seam-copy.ts` holds the production declaration; a test
  // that imported it could not detect it changing.
  const BREAKER_SENTENCE =
    "The analytics service is temporarily unavailable. Please try again in a moment.";
  // Hand-typed. The component-owned sentence that REPLACED the env-var lie.
  const SYNC_UNAVAILABLE_SENTENCE =
    "We couldn't start the sync. Your key is saved — retry in a moment, and contact support if it keeps failing.";

  function keyRow() {
    return {
      id: "key-1",
      user_id: "user-a",
      exchange: "binance",
      label: "My Binance",
      is_active: true,
      sync_status: "complete",
      last_sync_at: null,
      account_balance_usdt: 1000,
      created_at: "2026-01-01T00:00:00Z",
      sync_error: null,
      last_429_at: null,
      disconnected_at: null,
      venue_account_id: null,
    };
  }

  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
    apiKeyInsertMock.mockReset();
    capturedOnStatusChange = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Render with one existing, currently-linked key and click "Resync". */
  async function clickResync() {
    selectResultMock.mockReturnValue({ data: [keyRow()], error: null });
    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-1" />);
    });
    await waitFor(() =>
      expect(screen.getByText("My Binance")).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Resync/i }));
    });
  }

  // ── B-15: the unrecognised 200 ─────────────────────────────────────────────

  it("does NOT enter 'computing' on a 200 that carries no enqueue evidence (B-15)", async () => {
    // The route's DRIFT fallback: a 2xx whose body it deliberately did NOT stamp
    // `ok: true` because the upstream shape was unrecognised. No job exists.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ verification_id: "v-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await clickResync();

    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toBeInTheDocument();
    });
    // THE assertion: the poll never starts for a job that was never enqueued.
    expect(screen.getByTestId("sync-progress")).toHaveAttribute(
      "data-sync-status",
      "error",
    );
    expect(
      screen.getByTestId("sync-progress").getAttribute("data-sync-status"),
    ).not.toBe("computing");
    expect(screen.getByText(SYNC_UNAVAILABLE_SENTENCE)).toBeInTheDocument();
  });

  it("ANTI-REGRESSION: a well-formed 202 DOES enter 'computing'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            strategy_id: "strat-1",
            status: "syncing",
            queued: true,
            composite: false,
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await clickResync();

    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
    });
  });

  // ── C-9: the env-var lie, and the non-JSON failure path ────────────────────

  it("renders no SUPABASE-naming copy and throws no parse error on a non-JSON !res.ok (C-9)", async () => {
    // A proxy or gateway answers the outage with an HTML error page. A JSON read
    // here throws a SyntaxError INSIDE the failure path, replacing the real
    // failure with a parse error — which is why the content-type branch exists.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    await clickResync();

    await waitFor(() => {
      expect(screen.getByText(SYNC_UNAVAILABLE_SENTENCE)).toBeInTheDocument();
    });
    // The env-var lie is gone from the rendered surface …
    expect(document.body.textContent).not.toMatch(/SUPABASE/);
    // … and no SyntaxError text leaked into the DOM in its place.
    expect(document.body.textContent).not.toMatch(/JSON|SyntaxError|Unexpected token/);
  });

  it("renders the route's breaker sentence rather than a generic fallback (human_message, not error)", async () => {
    // What `postProcessKey` actually builds on a CircuitOpenError: the copy is
    // under `human_message`. Reading `err.error` alone swallowed it.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            code: "CIRCUIT_OPEN",
            human_message: BREAKER_SENTENCE,
            correlation_id: "cid-1",
            recoverable: true,
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await clickResync();

    await waitFor(() => {
      expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument();
    });
    expect(screen.getByTestId("sync-progress")).toHaveAttribute(
      "data-sync-status",
      "error",
    );
  });

  it("ANTI-REGRESSION: a JSON failure carrying `error` still renders that message", async () => {
    // The route's OWN arms use `{ error }` (400 / 404 / 429 / the 503 composite
    // probe). Reading `human_message` must not displace them.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await clickResync();

    await waitFor(() => {
      expect(screen.getByText("Too many requests")).toBeInTheDocument();
    });
  });

  // ── B-06: the background sync ──────────────────────────────────────────────

  it("observes a 503 on the BACKGROUND sync after an add (B-06)", async () => {
    selectResultMock.mockReturnValue({ data: [], error: null });
    apiKeyInsertMock.mockReturnValue({ data: { id: "new-key" }, error: null });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/keys/validate-and-encrypt") {
        return Promise.resolve(
          new Response(
            // 160-02: the PERSIST envelope. The row is written server-side;
            // the component only needs the id to link and sync.
            JSON.stringify({
              api_key_id: "new-key",
              valid: true,
              read_only: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      // The background sync answers a breaker trip. `.catch()` alone NEVER sees
      // this — the promise RESOLVES.
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            code: "CIRCUIT_OPEN",
            human_message: BREAKER_SENTENCE,
            correlation_id: "cid-2",
            recoverable: true,
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      render(
        <ApiKeyManager
          strategyId="strat-1"
          currentKeyId={null}
          defaultExchange="binance"
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
    });
    const labelInput = screen.getByLabelText(/Label/i);
    fireEvent.change(labelInput, { target: { value: "Test Key" } });
    fireEvent.change(screen.getByLabelText(/API Key$/i), {
      target: { value: "test-key" },
    });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "test-secret" },
    });
    await act(async () => {
      fireEvent.submit(labelInput.closest("form")!);
    });

    // The sync POST did fire …
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync"),
      ).toBe(true);
    });
    // … and THE assertion: its failure reached this component's own surface.
    // Before the fix nothing but `console.warn` observed it.
    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
    });
    expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument();
  });

  it("observes an unrecognised 200 on the BACKGROUND sync too (same shape, both members)", async () => {
    selectResultMock.mockReturnValue({ data: [], error: null });
    apiKeyInsertMock.mockReturnValue({ data: { id: "new-key" }, error: null });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/keys/validate-and-encrypt") {
        return Promise.resolve(
          new Response(
            // 160-02: the PERSIST envelope. The row is written server-side;
            // the component only needs the id to link and sync.
            JSON.stringify({
              api_key_id: "new-key",
              valid: true,
              read_only: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ verification_id: "v-2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      render(
        <ApiKeyManager
          strategyId="strat-1"
          currentKeyId={null}
          defaultExchange="binance"
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
    });
    const labelInput = screen.getByLabelText(/Label/i);
    fireEvent.change(labelInput, { target: { value: "Test Key" } });
    fireEvent.change(screen.getByLabelText(/API Key$/i), {
      target: { value: "test-key" },
    });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "test-secret" },
    });
    await act(async () => {
      fireEvent.submit(labelInput.closest("form")!);
    });

    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
    });
    expect(screen.getByText(SYNC_UNAVAILABLE_SENTENCE)).toBeInTheDocument();
  });

  it("ANTI-REGRESSION: a well-formed background sync leaves the panel idle", async () => {
    selectResultMock.mockReturnValue({ data: [], error: null });
    apiKeyInsertMock.mockReturnValue({ data: { id: "new-key" }, error: null });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/keys/validate-and-encrypt") {
        return Promise.resolve(
          new Response(
            // 160-02: the PERSIST envelope. The row is written server-side;
            // the component only needs the id to link and sync.
            JSON.stringify({
              api_key_id: "new-key",
              valid: true,
              read_only: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, accepted: true, status: "syncing" }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      render(
        <ApiKeyManager
          strategyId="strat-1"
          currentKeyId={null}
          defaultExchange="binance"
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
    });
    const labelInput = screen.getByLabelText(/Label/i);
    fireEvent.change(labelInput, { target: { value: "Test Key" } });
    fireEvent.change(screen.getByLabelText(/API Key$/i), {
      target: { value: "test-key" },
    });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "test-secret" },
    });
    await act(async () => {
      fireEvent.submit(labelInput.closest("form")!);
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync"),
      ).toBe(true);
    });
    // A background sync that SUCCEEDED must not manufacture an error surface.
    // The panel only renders once syncStatus leaves "idle".
    expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
  });
});

/**
 * [167-06] Phase 167 CREDTRUST, gap 1 — the persisted credential state renders
 * on the MANAGER's own key card.
 *
 * THE GAP, MEASURED. `profiles.role` defaults to `manager`, and the daily
 * holdings poll stamps every active key regardless of role. Before this plan
 * the only component that rendered the stamped `api_keys.sync_status` was
 * `AllocatorSyncStatus`, mounted only on the allocator-only `/profile`
 * Exchanges tab. A manager's `sign_in_failed` key was therefore WRITTEN and
 * shown on no page they could reach. `ApiKeyManager` already selects
 * `sync_status` and `sync_error` through `API_KEY_USER_COLUMNS`; it rendered
 * neither.
 *
 * ⛔ ORACLE INDEPENDENCE. Every expected pill label and helper sentence below is
 * HAND-TYPED (the helper's U+2014 em-dash included). Importing them from the
 * component under test would let a reworded string pass its own pin. The
 * healthy-control iteration DOMAIN is imported on purpose: a future trusted
 * value is then covered automatically, while its expected output (nothing) is
 * still asserted here.
 *
 * Each status gets its OWN render (it.each). Testing-library cleans up only
 * between tests, so a loop of renders inside one test would stack components
 * and make every "zero nodes" assertion unreliable.
 */
describe("[167-06] the persisted credential state renders on the manager's key card", () => {
  // Hand-typed, never imported (see the oracle-independence note above).
  const SIGN_IN_FAILED_HELPER =
    "Update this account's credentials — they may have changed.";
  const REVOKED_HELPER_TEXT = "Re-add a read-only key from your exchange.";
  // A raw `sync_error` the pre-167 pipeline really wrote: a retry promise that
  // cannot be kept for a credential failure. It must never reach this surface.
  const RAW_SYNC_ERROR =
    "MT5 terminal unreachable — sync will retry automatically.";

  function row(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "key-mt5-sif",
      user_id: "user-a",
      exchange: "mt5",
      label: "Manager MT5",
      is_active: true,
      sync_status: "sign_in_failed",
      last_sync_at: "2026-04-19T11:58:00Z",
      account_balance_usdt: 1000,
      created_at: "2026-01-01T00:00:00Z",
      sync_error: null,
      last_429_at: null,
      disconnected_at: null,
      venue_account_id: "synth1234",
      ...overrides,
    };
  }

  async function renderRows(
    rows: ReturnType<typeof row>[],
    currentKeyId: string | null = null,
    defaultExchange?: string,
  ) {
    selectResultMock.mockReturnValue({ data: rows, error: null });
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(
        <ApiKeyManager
          strategyId="strat-1"
          currentKeyId={currentKeyId}
          defaultExchange={defaultExchange}
        />,
      );
    });
    await waitFor(() => {
      expect(screen.getByText(rows[0].label as string)).toBeInTheDocument();
    });
    return utils;
  }

  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
    capturedOnStatusChange = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      status: "sign_in_failed",
      exchange: "mt5",
      label: "Manager MT5",
      pillText: "Sign-in failed",
      pillClasses: ["bg-warning-bg", "text-warning"],
      helperText: SIGN_IN_FAILED_HELPER,
      remedy: "Update password",
    },
    {
      status: "revoked",
      exchange: "binance",
      label: "Manager Binance",
      pillText: "Key revoked",
      pillClasses: ["bg-negative/10", "text-negative"],
      helperText: REVOKED_HELPER_TEXT,
      remedy: "Delete",
    },
  ])(
    "an untrusted $status key shows the existing pill and authored helper inside ITS OWN card, beside the $remedy control",
    async ({ status, exchange, label, pillText, pillClasses, helperText, remedy }) => {
      await renderRows([
        row({
          id: `key-${status}`,
          exchange,
          label,
          sync_status: status,
          venue_account_id: exchange === "mt5" ? "synth1234" : null,
        }),
      ]);

      const card = screen.getByTestId(`api-key-card-key-${status}`);
      const pill = within(card).getByTestId("allocator-sync-pill");
      expect(pill).toHaveAttribute("data-sync-status", status);
      expect(pill.textContent).toBe(pillText);
      for (const cls of pillClasses) expect(pill).toHaveClass(cls);

      const helper = within(card).getByTestId("allocator-sync-helper");
      expect(helper).toHaveAttribute("role", "status");
      expect(helper.textContent).toBe(helperText);

      // The remedy the helper names is on the SAME card, not elsewhere.
      expect(
        within(card).getByRole("button", { name: remedy }),
      ).toBeInTheDocument();
    },
  );

  it.each([...TRUSTED_OR_NEUTRAL_KEY_SYNC_STATUSES, null])(
    "HEALTHY CONTROL: sync_status %s renders no pill, no helper and no added live region",
    async (status) => {
      await renderRows([
        row({ id: "key-mt5-ok", label: "Healthy MT5", sync_status: status }),
        row({
          id: "key-bin-ok",
          exchange: "binance",
          label: "Healthy Binance",
          sync_status: status,
          venue_account_id: null,
        }),
      ]);
      expect(screen.getByText("Healthy Binance")).toBeInTheDocument();

      expect(screen.queryAllByTestId("allocator-sync-pill")).toHaveLength(0);
      expect(screen.queryAllByTestId("allocator-sync-helper")).toHaveLength(0);

      // "No added live region", asserted rather than named (167-REVIEW-06
      // WR-01). The count case below measures its baseline from a healthy
      // render, so a region added to EVERY card would be absorbed by it; this
      // is the case that has to catch that. The card itself is checked as well
      // as its descendants, since a role on the card would not be a descendant.
      const LIVE = '[role="status"], [aria-live]';
      for (const id of ["key-mt5-ok", "key-bin-ok"]) {
        const healthyCard = screen.getByTestId(`api-key-card-${id}`);
        expect(within(healthyCard).queryAllByRole("status")).toHaveLength(0);
        expect(healthyCard.matches(LIVE)).toBe(false);
        expect(healthyCard.querySelectorAll(LIVE)).toHaveLength(0);
      }
    },
  );

  it.each(["revoked", "sign_in_failed"])(
    "the raw api_keys.sync_error of a %s key never reaches the DOM",
    async (status) => {
      await renderRows([
        row({ id: `key-leak-${status}`, sync_status: status, sync_error: RAW_SYNC_ERROR }),
      ]);

      const text = document.body.textContent ?? "";
      expect(text).not.toContain(RAW_SYNC_ERROR);
      expect(text).not.toContain("will retry automatically");
    },
  );

  it("adds EXACTLY ONE live region per untrusted card (no second live region)", async () => {
    // Baseline measured in THIS test, from a healthy-only render of the same
    // shape, so a live region some other part of the tree carries is counted on
    // both sides rather than hard-coded here.
    const healthy = await renderRows([
      row({ id: "key-a", label: "Key A", sync_status: "complete" }),
    ]);
    const baseline = healthy.container.querySelectorAll("[aria-live]").length;
    healthy.unmount();

    const untrusted = await renderRows([
      row({ id: "key-a", label: "Key A", sync_status: "sign_in_failed" }),
    ]);
    const card = screen.getByTestId("api-key-card-key-a");
    expect(within(card).getAllByRole("status")).toHaveLength(1);
    expect(
      untrusted.container.querySelectorAll("[aria-live]").length,
    ).toBe(baseline + 1);
  });

  /**
   * [167-06] Task 2 — the persisted state COEXISTS with the local SyncProgress
   * panel, rules R1–R6 of 167-CONTEXT D-18.
   *
   * `SyncProgress` is a LOCAL state machine fed from component state, never
   * from `api_keys.sync_status`, and an MT5 resync can finish as a terminal
   * success whether or not the password works (the MT5 branch of
   * `run_sync_trades_job` makes the daily-PnL fetch a no-op). So the two
   * regions can contradict each other unless the rules below hold:
   *   R1 no credential claim under a spinner; one stable live region;
   *   R2 no panel success beside a server-read sign-in failure;
   *   R3 a withheld success is retired, never re-shown, after Update password;
   *   R4 a key's password is never replaced during its OWN sync;
   *   R5 the same retirement on Delete and Add Key, and Delete takes R4's
   *      disable;
   *   R6 a failed post-add sync never ends, or dead-locks, a live tracked
   *      attempt (corrected in the 167-06 fix round: as first shipped it
   *      cleared that attempt's marker, 167-REVIEW-06 CR-01).
   * The ATTEMPT SCOPE cases pin the root cause of both routes by which
   * something outside an attempt could end it: only the attempt ends itself.
   *
   * ⛔ Every "the panel is NOT rendered" assertion that follows a remedy waits
   * for the remedy to LAND first (the pill leaving, the card leaving, the new
   * card appearing). The panel is still withheld until then, so an earlier
   * absence would pass without any retirement at all.
   */
  describe("coexistence with the local sync panel (R1-R6, D-18)", () => {
    const JSON_HEADERS = { "content-type": "application/json" };

    function syncAccepted() {
      return new Response(
        JSON.stringify({ ok: true, accepted: true, status: "syncing", queued: true }),
        { status: 202, headers: JSON_HEADERS },
      );
    }

    function rotationOk() {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    function syncRefused(message: string) {
      return new Response(JSON.stringify({ error: message }), {
        status: 503,
        headers: JSON_HEADERS,
      });
    }

    /** A promise the case settles by hand, to hold one request open. */
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    /**
     * Route `fetch` by URL, as the 160-02 conversion describe does. An
     * unexpected URL answers 404, so a request a case did not plan for (a
     * rotation of an empty key id, say) can never read as a success.
     */
    function routeFetch(
      opts: {
        sync?: () => Response | Promise<Response>;
        rotate?: () => Response | Promise<Response>;
      } = {},
    ) {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === "/api/keys/sync") {
          return Promise.resolve((opts.sync ?? syncAccepted)());
        }
        if (url === "/api/keys/validate-and-encrypt") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ api_key_id: "key-new", valid: true, read_only: true }),
              { status: 200, headers: JSON_HEADERS },
            ),
          );
        }
        if (/^\/api\/keys\/[^/]+\/rotate-secret$/.test(url)) {
          return Promise.resolve((opts.rotate ?? rotationOk)());
        }
        return Promise.resolve(
          new Response(JSON.stringify({ error: "unexpected request" }), {
            status: 404,
            headers: JSON_HEADERS,
          }),
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    function card(id: string) {
      return screen.getByTestId(`api-key-card-${id}`);
    }

    function cardButton(id: string, name: string) {
      return within(card(id)).getByRole("button", { name });
    }

    function dialogTitled(text: string) {
      const found = Array.from(document.querySelectorAll("dialog")).find((d) =>
        d.textContent?.includes(text),
      );
      expect(found, `no dialog containing "${text}"`).toBeTruthy();
      return found!;
    }

    /** Click the current key's Resync and wait for flight AND its mid-flight re-read. */
    async function resync(id: string) {
      const reads = selectResultMock.mock.calls.length;
      await act(async () => {
        fireEvent.click(cardButton(id, "Resync"));
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "computing",
        );
        expect(selectResultMock.mock.calls.length).toBeGreaterThan(reads);
      });
    }

    /** Drive the panel's terminal success and wait for the terminal arm's re-read. */
    async function finish(status: "complete" | "complete_with_warnings") {
      const reads = selectResultMock.mock.calls.length;
      await act(async () => {
        capturedOnStatusChange!(status);
      });
      await waitFor(() => {
        expect(selectResultMock.mock.calls.length).toBeGreaterThan(reads);
      });
    }

    /** Open THIS card's Update password, submit a new password, wait for the dialog to close. */
    async function rotate(id: string) {
      await act(async () => {
        fireEvent.click(cardButton(id, "Update password"));
      });
      expect(dialogTitled("New password")).toHaveAttribute("open");
      fireEvent.change(screen.getByLabelText("New password"), {
        target: { value: "new-investor-password" },
      });
      await act(async () => {
        fireEvent.click(
          within(dialogTitled("New password")).getByRole("button", {
            name: "Update password",
          }),
        );
      });
      await waitFor(() => {
        expect(dialogTitled("New password")).not.toHaveAttribute("open");
      });
    }

    /** Click THIS card's Delete, then Delete inside the confirm. */
    async function deleteKey(id: string) {
      await act(async () => {
        fireEvent.click(cardButton(id, "Delete"));
      });
      expect(dialogTitled("Delete API Key")).toHaveAttribute("open");
      await act(async () => {
        fireEvent.click(
          within(dialogTitled("Delete API Key")).getByRole("button", {
            name: "Delete",
          }),
        );
      });
    }

    /** Add a key through the real form, as the SEAMUX-05 background-sync case does. */
    async function addKey() {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
      });
      const labelInput = screen.getByLabelText(/Label/i);
      fireEvent.change(labelInput, { target: { value: "Added Key" } });
      fireEvent.change(screen.getByLabelText(/API Key$/i), {
        target: { value: "test-key" },
      });
      fireEvent.change(screen.getByLabelText("API Secret"), {
        target: { value: "test-secret" },
      });
      await act(async () => {
        fireEvent.submit(labelInput.closest("form")!);
      });
    }

    const newRow = () =>
      row({
        id: "key-new",
        exchange: "binance",
        label: "Added Key",
        sync_status: null,
        venue_account_id: null,
      });

    beforeEach(() => {
      apiKeyDeleteMock.mockReset();
      strategiesUpdateMock.mockReset();
    });

    // ── R1 ─────────────────────────────────────────────────────────────────

    it("R1 in flight: the card shows the neutral Syncing… pill with a silent helper and no credential claim, and the panel shows progress", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");

      await resync("key-j");

      expect(
        within(card("key-j")).getByTestId("allocator-sync-pill"),
      ).toHaveAttribute("data-sync-status", "syncing");
      expect(
        within(card("key-j")).getByTestId("allocator-sync-helper").textContent,
      ).toBe("");
      const text = document.body.textContent ?? "";
      expect(text).not.toContain("Sign-in failed");
      expect(text).not.toContain(SIGN_IN_FAILED_HELPER);
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
    });

    it("R1 stable live region: the card's helper is the SAME node before, during and after the attempt", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");
      const before = within(card("key-j")).getByTestId("allocator-sync-helper");

      await resync("key-j");
      const during = within(card("key-j")).getByTestId("allocator-sync-helper");
      await finish("complete");
      const after = within(card("key-j")).getByTestId("allocator-sync-helper");

      expect(during).toBe(before);
      expect(after).toBe(before);
      expect(after.textContent).toBe(SIGN_IN_FAILED_HELPER);
    });

    // ── R2 ─────────────────────────────────────────────────────────────────

    it.each(["complete", "complete_with_warnings"] as const)(
      "R2 terminal %s beside a server-read sign-in failure: the panel's success is withheld and the pill returns",
      async (status) => {
        routeFetch();
        await renderRows([row({ id: "key-j" })], "key-j");

        await resync("key-j");
        await finish(status);

        expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
        expect(
          within(card("key-j")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "sign_in_failed");
        expect(
          within(card("key-j")).getByTestId("allocator-sync-helper").textContent,
        ).toBe(SIGN_IN_FAILED_HELPER);
      },
    );

    it("R2 terminal error: BOTH the panel's error and the card's untrusted pill render", async () => {
      routeFetch({
        sync: () =>
          new Response(JSON.stringify({ error: "Sync could not start" }), {
            status: 503,
            headers: JSON_HEADERS,
          }),
      });
      await renderRows([row({ id: "key-j" })], "key-j");

      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "error",
        );
      });
      expect(
        within(card("key-j")).getByTestId("allocator-sync-pill"),
      ).toHaveAttribute("data-sync-status", "sign_in_failed");
    });

    // ── R3 ─────────────────────────────────────────────────────────────────

    it("CONTROL (R3's guard): a healthy key's success is shown as before, and survives an Update password", async () => {
      routeFetch();
      await renderRows(
        [row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })],
        "key-h",
      );

      await resync("key-h");
      await finish("complete");
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "complete",
      );

      const reads = selectResultMock.mock.calls.length;
      await rotate("key-h");
      await waitFor(() => {
        expect(selectResultMock.mock.calls.length).toBeGreaterThan(reads);
      });

      // A success that was never withheld is not retired.
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "complete",
      );
    });

    it("R3 remedy after a withheld success: a successful Update password retires it, and it is not re-shown when the re-read lifts the withhold", async () => {
      const fetchMock = routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");

      await resync("key-j");
      await finish("complete");
      // R2's withhold: the precondition this case exists for.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      // rotate-secret's validated write sets the status to idle.
      selectResultMock.mockReturnValue({
        data: [row({ id: "key-j", sync_status: "idle" })],
        error: null,
      });
      await rotate("key-j");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/keys/key-j/rotate-secret",
        expect.objectContaining({ method: "PATCH" }),
      );

      // FIRST: the re-read landed (the pill left) ...
      await waitFor(() => {
        expect(
          within(card("key-j")).queryByTestId("allocator-sync-pill"),
        ).not.toBeInTheDocument();
      });
      // ... THEN: the success from the replaced password is not re-shown.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("R3 remedy during flight: rotating ANOTHER key while the current key syncs leaves that sync running and its panel mounted", async () => {
      const fetchMock = routeFetch();
      await renderRows(
        [
          row({ id: "key-j", label: "Key J" }),
          row({ id: "key-k", label: "Key K" }),
        ],
        "key-j",
      );

      await resync("key-j");

      selectResultMock.mockReturnValue({
        data: [
          row({ id: "key-j", label: "Key J" }),
          row({ id: "key-k", label: "Key K", sync_status: "idle" }),
        ],
        error: null,
      });
      await rotate("key-k");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/keys/key-k/rotate-secret",
        expect.objectContaining({ method: "PATCH" }),
      );
      await waitFor(() => {
        expect(
          within(card("key-k")).queryByTestId("allocator-sync-pill"),
        ).not.toBeInTheDocument();
      });

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
      expect(cardButton("key-j", "Syncing…")).toBeInTheDocument();
    });

    // ── R4 ─────────────────────────────────────────────────────────────────

    it("R4 rotation blocked in flight: a key's own Update password is disabled for exactly its attempt, another key's stays usable, and the dialog opens modally", async () => {
      routeFetch();
      await renderRows(
        [
          row({ id: "key-j", label: "Key J" }),
          row({ id: "key-k", label: "Key K" }),
        ],
        "key-j",
      );

      expect(cardButton("key-j", "Update password")).toBeEnabled();

      await resync("key-j");
      expect(cardButton("key-j", "Update password")).toBeDisabled();
      expect(cardButton("key-k", "Update password")).toBeEnabled();

      await finish("complete");
      expect(cardButton("key-j", "Update password")).toBeEnabled();

      // Spied AFTER the file's polyfill has run. jsdom does not model the
      // inertness showModal() gives a real browser; this pins that the dialog
      // opens MODALLY, which is what makes the reverse order impossible.
      const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
      try {
        await act(async () => {
          fireEvent.click(cardButton("key-j", "Update password"));
        });
        expect(showModalSpy.mock.contexts).toContain(dialogTitled("New password"));
        expect(dialogTitled("New password")).toHaveAttribute("open");
      } finally {
        showModalSpy.mockRestore();
      }
    });

    // ── R5 ─────────────────────────────────────────────────────────────────

    it("R5 remedy by Delete: deleting the key a success was withheld beside retires it, and it is not re-shown once the row leaves", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");

      await resync("key-j");
      await finish("complete");
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      await deleteKey("key-j");
      expect(apiKeyDeleteMock).toHaveBeenCalledWith("api_keys");

      // FIRST: the row left ...
      await waitFor(() => {
        expect(screen.queryByTestId("api-key-card-key-j")).not.toBeInTheDocument();
      });
      // ... THEN: the withheld success did not re-appear.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("R5 remedy by Add Key: adding a key after a withheld success retires it, and it is not re-shown once the subject moves", async () => {
      routeFetch();
      const revoked = row({
        id: "key-r",
        exchange: "binance",
        label: "Revoked Binance",
        sync_status: "revoked",
        venue_account_id: null,
      });
      await renderRows([revoked], "key-r", "binance");

      await resync("key-r");
      await finish("complete");
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      selectResultMock.mockReturnValue({ data: [newRow(), revoked], error: null });
      await addKey();

      // FIRST: the new key's card appeared ...
      await waitFor(() => {
        expect(screen.getByTestId("api-key-card-key-new")).toBeInTheDocument();
      });
      // ... THEN: the withheld success did not re-appear.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("CONTROL (R5 on Delete): a success that was never withheld survives deleting ANOTHER key", async () => {
      routeFetch();
      await renderRows(
        [
          row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" }),
          row({ id: "key-h2", label: "Other MT5", sync_status: "complete" }),
        ],
        "key-h",
      );

      await resync("key-h");
      await finish("complete");
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "complete",
      );

      await deleteKey("key-h2");
      await waitFor(() => {
        expect(screen.queryByTestId("api-key-card-key-h2")).not.toBeInTheDocument();
      });

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "complete",
      );
    });

    it("CONTROL (R5 on Add Key): a success that was never withheld survives an Add Key", async () => {
      routeFetch();
      const healthy = row({
        id: "key-h",
        exchange: "binance",
        label: "Healthy Binance",
        sync_status: "complete",
        venue_account_id: null,
      });
      await renderRows([healthy], "key-h", "binance");

      await resync("key-h");
      await finish("complete");
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "complete",
      );

      selectResultMock.mockReturnValue({ data: [newRow(), healthy], error: null });
      await addKey();
      await waitFor(() => {
        expect(screen.getByTestId("api-key-card-key-new")).toBeInTheDocument();
      });

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "complete",
      );
    });

    it("R5 Delete blocked in flight: a key's own Delete is disabled for exactly its attempt, and another key's stays usable", async () => {
      routeFetch();
      await renderRows(
        [
          row({ id: "key-j", label: "Key J" }),
          row({ id: "key-k", label: "Key K" }),
        ],
        "key-j",
      );

      expect(cardButton("key-j", "Delete")).toBeEnabled();

      await resync("key-j");
      expect(cardButton("key-j", "Delete")).toBeDisabled();
      expect(cardButton("key-k", "Delete")).toBeEnabled();

      await finish("complete");
      expect(cardButton("key-j", "Delete")).toBeEnabled();
    });

    // ── R6 ─────────────────────────────────────────────────────────────────

    it("R6 (corrected): a post-add sync that fails while another key's attempt is computing leaves that attempt alone, its own terminal ends it, and its success is judged against its own key", async () => {
      let syncCalls = 0;
      routeFetch({
        sync: () => {
          syncCalls += 1;
          // First: the Resync. Second: the post-add background sync.
          return syncCalls === 1 ? syncAccepted() : syncRefused("Post-add sync failed");
        },
      });
      const current = row({ id: "key-j" });
      await renderRows([current], "key-j", "binance");

      await resync("key-j");
      expect(cardButton("key-j", "Update password")).toBeDisabled();
      expect(cardButton("key-j", "Delete")).toBeDisabled();

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        selectResultMock.mockReturnValue({ data: [newRow(), current], error: null });
        await addKey();

        // FIRST: the post-add sync really failed (it reached the operator log) ...
        await waitFor(() => {
          expect(warn).toHaveBeenCalledWith(
            "[ApiKeyManager] background sync after key add failed:",
            expect.anything(),
          );
        });
        expect(syncCalls).toBe(2);
      } finally {
        warn.mockRestore();
      }
      // ... THEN: the live attempt is untouched. It is still polling, and its
      // key still carries the in-flight marker and its disables.
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
      expect(cardButton("key-j", "Syncing…")).toBeDisabled();
      expect(cardButton("key-j", "Update password")).toBeDisabled();
      expect(cardButton("key-j", "Delete")).toBeDisabled();

      // No dead-lock: the attempt's own terminal ends it.
      await finish("complete");
      expect(cardButton("key-j", "Resync")).toBeEnabled();
      expect(cardButton("key-j", "Update password")).toBeEnabled();
      expect(cardButton("key-j", "Delete")).toBeEnabled();
      // And its success is judged against J, the key it synced, not the added
      // key: J is untrusted, so R2 withholds it and J's pill returns.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
      expect(
        within(card("key-j")).getByTestId("allocator-sync-pill"),
      ).toHaveAttribute("data-sync-status", "sign_in_failed");
    });

    // ── ATTEMPT SCOPE (167-06 fix round) ────────────────────────────────────

    it("ATTEMPT SCOPE, post-add route: a post-add sync that fails while another key's attempt still awaits its own enqueue does not end that attempt (167-REVIEW-06 CR-01)", async () => {
      const postAdd = deferred<Response>();
      const ownEnqueue = deferred<Response>();
      const pending = [postAdd, ownEnqueue];
      routeFetch({ sync: () => pending.shift()!.promise });
      const current = row({ id: "key-j" });
      await renderRows([current], "key-j", "binance");

      // 1. Add Key: the form closes while its post-add sync is still pending.
      selectResultMock.mockReturnValue({ data: [newRow(), current], error: null });
      await addKey();
      await waitFor(() => {
        expect(screen.getByTestId("api-key-card-key-new")).toBeInTheDocument();
      });

      // 2. Resync J: allowed, because the post-add sync never takes the slot.
      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
      });
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "syncing",
      );

      // 3. The post-add sync fails while J is still in its request phase.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await act(async () => {
          postAdd.resolve(syncRefused("Post-add sync failed"));
        });
        await waitFor(() => expect(warn).toHaveBeenCalled());
      } finally {
        warn.mockRestore();
      }

      // 4. J's own enqueue lands.
      await act(async () => {
        ownEnqueue.resolve(syncAccepted());
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "computing",
        );
      });

      // J's attempt still owns its marker for the rest of its life.
      expect(
        within(card("key-j")).getByTestId("allocator-sync-pill"),
      ).toHaveAttribute("data-sync-status", "syncing");
      expect(cardButton("key-j", "Update password")).toBeDisabled();
      expect(cardButton("key-j", "Delete")).toBeDisabled();
      expect(cardButton("key-j", "Syncing…")).toBeDisabled();
      // The one slot is still held, so no second sync can overwrite it.
      expect(cardButton("key-new", "Use & Sync")).toBeDisabled();
      expect(screen.getByTestId("sync-progress").textContent).not.toContain(
        "Post-add sync failed",
      );
    });

    it.each(["complete", "complete_with_warnings", "error"] as const)(
      "ATTEMPT SCOPE, stale-read route: a %s the poll reads BEFORE the attempt's own enqueue answered is the previous run's row, and does not end the attempt",
      async (staleStatus) => {
        const ownEnqueue = deferred<Response>();
        routeFetch({ sync: () => ownEnqueue.promise });
        await renderRows([row({ id: "key-j" })], "key-j");

        await act(async () => {
          fireEvent.click(cardButton("key-j", "Resync"));
        });
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "syncing",
        );

        // A cold-start enqueue outlasts the 3 s poll: its first read returns
        // the strategy's EXISTING analytics row.
        await act(async () => {
          capturedOnStatusChange!(staleStatus);
        });
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "syncing",
        );

        await act(async () => {
          ownEnqueue.resolve(syncAccepted());
        });
        await waitFor(() => {
          expect(screen.getByTestId("sync-progress")).toHaveAttribute(
            "data-sync-status",
            "computing",
          );
        });
        // R1: no credential claim under the spinner. R4, R5: J's remedy
        // controls stay disabled for its whole attempt.
        expect(
          within(card("key-j")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "syncing");
        expect(cardButton("key-j", "Update password")).toBeDisabled();
        expect(cardButton("key-j", "Delete")).toBeDisabled();

        // The attempt's OWN terminal, after its enqueue, still ends it.
        await finish("complete");
        expect(cardButton("key-j", "Update password")).toBeEnabled();
        expect(
          within(card("key-j")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "sign_in_failed");
      },
    );

    // ── Terminal success waits for its re-read (SFH LOW-1) ──────────────────

    it("a terminal success is not shown until the terminal arm's re-read resolves, and that re-read can withhold it", async () => {
      routeFetch();
      await renderRows(
        [row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })],
        "key-h",
      );
      await resync("key-h");

      const reread = deferred<unknown>();
      selectResultMock.mockReturnValueOnce(reread.promise);
      await act(async () => {
        capturedOnStatusChange!("complete");
      });
      // THE assertion: no "Up to date" while the re-read is outstanding, and
      // the attempt still holds its marker across the gap.
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
      expect(cardButton("key-h", "Update password")).toBeDisabled();

      // The re-read returns the key's sign-in as failed (the daily poll
      // stamped it while the sync ran).
      await act(async () => {
        reread.resolve({
          data: [row({ id: "key-h", label: "Healthy MT5", sync_status: "sign_in_failed" })],
          error: null,
        });
      });
      await waitFor(() => {
        expect(
          within(card("key-h")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "sign_in_failed");
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
      expect(cardButton("key-h", "Update password")).toBeEnabled();
    });

    it("a terminal success whose re-read FAILS stays withheld, the load error is surfaced, and no control stays locked", async () => {
      routeFetch();
      await renderRows(
        [row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })],
        "key-h",
      );
      await resync("key-h");

      selectResultMock.mockReturnValue({
        data: null,
        error: { message: "network error" },
      });
      await finish("complete");

      await waitFor(() => {
        expect(
          screen.getByText(/Couldn't load your API keys/i),
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
      expect(cardButton("key-h", "Resync")).toBeEnabled();
    });

    // ── R3's retirement leaves `error` alone (SFH MEDIUM-1, MEDIUM-2) ───────

    it("R3 keeps an error: after J's own sync fails, a successful Update password leaves the panel's error and its message in place", async () => {
      routeFetch({ sync: () => syncRefused("Sync could not start") });
      await renderRows([row({ id: "key-j" })], "key-j");

      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "error",
        );
      });

      selectResultMock.mockReturnValue({
        data: [row({ id: "key-j", sync_status: "idle" })],
        error: null,
      });
      await rotate("key-j");
      // FIRST: the remedy landed (the pill left) ...
      await waitFor(() => {
        expect(
          within(card("key-j")).queryByTestId("allocator-sync-pill"),
        ).not.toBeInTheDocument();
      });
      // ... THEN: the attempt's error is still there, with its own message.
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
      expect(screen.getByTestId("sync-progress").textContent).toBe(
        "Sync could not start",
      );
    });

    it("R3's updater is FUNCTIONAL: an error the panel reaches during ANOTHER key's rotation survives that rotation's retirement", async () => {
      const rotation = deferred<Response>();
      routeFetch({ rotate: () => rotation.promise });
      await renderRows(
        [
          row({ id: "key-j", label: "Key J" }),
          row({ id: "key-k", label: "Key K" }),
        ],
        "key-j",
      );
      // The subject J is untrusted and in flight, so the retirement's guard
      // is TRUE in the render K's rotation is submitted from.
      await resync("key-j");

      await act(async () => {
        fireEvent.click(cardButton("key-k", "Update password"));
      });
      fireEvent.change(screen.getByLabelText("New password"), {
        target: { value: "new-investor-password" },
      });
      await act(async () => {
        fireEvent.click(
          within(dialogTitled("New password")).getByRole("button", {
            name: "Update password",
          }),
        );
      });

      // J's attempt fails while rotate-secret is still awaited.
      await act(async () => {
        capturedOnStatusChange!("error");
      });
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );

      selectResultMock.mockReturnValue({
        data: [
          row({ id: "key-j", label: "Key J" }),
          row({ id: "key-k", label: "Key K", sync_status: "idle" }),
        ],
        error: null,
      });
      await act(async () => {
        rotation.resolve(rotationOk());
      });
      await waitFor(() => {
        expect(dialogTitled("New password")).not.toHaveAttribute("open");
      });
      await waitFor(() => {
        expect(
          within(card("key-k")).queryByTestId("allocator-sync-pill"),
        ).not.toBeInTheDocument();
      });

      // The retirement ran AFTER the error landed. It must read the
      // committed `error`, not the `computing` its click-time closure holds.
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
    });

    // ── A failed remedy re-read is visible (SFH LOW-2) ──────────────────────

    it("a failed re-read after Update password is reported even while the Add Key form is open", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j", "binance");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
      });
      expect(screen.getByLabelText(/Label/i)).toBeInTheDocument();

      selectResultMock.mockReturnValue({
        data: null,
        error: { message: "network error" },
      });
      await rotate("key-j");

      await waitFor(() => {
        expect(
          screen.getByText(/Couldn't load your API keys/i),
        ).toBeInTheDocument();
      });
      // The form is still open: the banner did not need it closed.
      expect(screen.getByLabelText(/Label/i)).toBeInTheDocument();
    });

    // ── Delete requires one removed row (pre-existing, fixed in this round) ─

    it("a Delete that removed NO row keeps the key and says so, even while the panel shows that key's sync error", async () => {
      routeFetch({ sync: () => syncRefused("Sync could not start") });
      const revoked = row({
        id: "key-r",
        exchange: "binance",
        label: "Revoked Binance",
        sync_status: "revoked",
        venue_account_id: null,
      });
      await renderRows([revoked], "key-r");

      await act(async () => {
        fireEvent.click(cardButton("key-r", "Resync"));
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "error",
        );
      });

      // RLS filtered the DELETE to zero rows: no error, nothing removed.
      apiKeyDeleteMock.mockReturnValue({ data: [], error: null });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await deleteKey("key-r");
        await waitFor(() => {
          expect(
            screen.getByText("Failed to delete key: no key was removed."),
          ).toBeInTheDocument();
        });
      } finally {
        consoleError.mockRestore();
      }
      expect(apiKeyDeleteMock).toHaveBeenCalledWith("api_keys");
      expect(screen.getByTestId("api-key-card-key-r")).toBeInTheDocument();
    });
  });
});
