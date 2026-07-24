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
// F6 (SFOX-09): capture the api_keys insert payload so a test can assert the
// exchange reaches the DB canonicalized (lowercase). Returns the queued result
// for the `.insert(...).select("id").single()` chain.
const apiKeyInsertMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-a" } }, error: null }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        order: (_col: string, _opts?: unknown) =>
          Promise.resolve(selectResultMock()),
      }),
      // handleAddKey does api_keys.insert({...}).select("id").single().
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
      update: (_vals: unknown) => ({
        eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

// Capture SyncProgress's onStatusChange so a test can drive the terminal
// callback directly (mig 20260707120000 regression: complete_with_warnings must
// be treated as a terminal SUCCESS, clearing syncingKeyId + refreshing).
let capturedOnStatusChange: ((s: string) => void) | null = null;
vi.mock("./SyncProgress", () => ({
  SyncProgress: (props: { onStatusChange?: (s: string) => void }) => {
    capturedOnStatusChange = props.onStatusChange ?? null;
    return null;
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

// F6 (phase-119 fold-in) — the CLIENT composes the api_keys INSERT directly, so
// a mixed-case exchange from the form ("sFOX") passes the server validate route
// (burning a live probe) then 23514s on the DB lowercase-only CHECK. handleAddKey
// must canonicalize to lowercase and use that value for BOTH the
// validate-and-encrypt fetch body AND the insert. Tests drive the REAL ApiKeyForm
// (defaultExchange seeds the exchange state) and assert the wiring at the call
// site — a helper-only test would not prove the insert receives the canonical
// value (test-the-wiring rule). Neuter `data.exchange.trim().toLowerCase()` back
// to `data.exchange` and the sFOX case fails on both the fetch body and insert.
describe("ApiKeyManager — F6 canonical-lowercase exchange at the add-key insert", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
    apiKeyInsertMock.mockReset();
    // Empty key list on mount so the Add-Key form is the whole surface.
    selectResultMock.mockReturnValue({ data: [], error: null });
    apiKeyInsertMock.mockReturnValue({ data: { id: "new-key" }, error: null });
    fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/keys/validate-and-encrypt") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            api_key_encrypted: "enc",
            api_secret_encrypted: "sec",
            passphrase_encrypted: null,
            dek_encrypted: "dek",
            nonce: "nonce",
            kek_version: 1,
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
    return JSON.parse(call![1].body as string) as { exchange: string };
  }

  it("canonicalizes a mixed-case 'sFOX' to 'sfox' in BOTH the validate body and the insert", async () => {
    render(
      <ApiKeyManager
        strategyId="strat-1"
        currentKeyId={null}
        defaultExchange="sFOX"
      />,
    );
    await submitAddKeyForm();

    // (a) validate-and-encrypt fetch body carries the canonical lowercase value.
    await waitFor(() => {
      expect(validateBody().exchange).toBe("sfox");
    });
    // (b) the api_keys insert payload carries the canonical lowercase value —
    // the call-site wiring, not a helper. This is the row that hits the DB CHECK.
    expect(apiKeyInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ exchange: "sfox" }),
    );
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
    expect(apiKeyInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ exchange: "binance" }),
    );
  });
});
