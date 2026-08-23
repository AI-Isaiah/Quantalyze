import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { ApiKeyManager } from "./ApiKeyManager";

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
