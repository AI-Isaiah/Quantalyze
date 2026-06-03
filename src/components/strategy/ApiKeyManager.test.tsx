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
    }),
  }),
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
});
