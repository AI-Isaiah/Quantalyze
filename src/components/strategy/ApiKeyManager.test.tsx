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
// 167-06 fix round 2 (WR-05): after a delete that removed no row,
// `handleDeleteKey` asks whether the row is still there with
// `from("api_keys").select("id").eq("id", …)`. The spy receives the table and
// the id; its default answer is "still present", the conservative reading, so
// a case that means "already gone" has to say so.
const apiKeyLookupMock = vi.fn();
// Phase 167.2 / KCS-02: `handleSyncTrades` reads the strategy's pre-enqueue
// `computed_at` with `from("strategy_analytics").select("computed_at")
// .eq("strategy_id", …).maybeSingle()`. Extended deliberately (not a catch-all):
// only that table answers `maybeSingle`, so a baseline read aimed at any other
// table would throw here and the case asserting the read would go red. The spy
// receives the table and the strategy id; default answer is a row with no
// computed_at. The real evidence gate lives in `SyncProgress`, which this file
// mocks; it is exercised in ApiKeyManager.poll.test.tsx.
const analyticsBaselineMock = vi.fn();
// 167.2-REVIEW WR-05: before a Delete, `handleDeleteKey` asks whether the key
// is a composite member with `from("strategy_keys").select("strategy_id")
// .eq("api_key_id", …)`. The spy receives the key id; its default answer is
// "a member of nothing", so every Delete case that predates the guard is
// unchanged, and a case that means "member" has to say so.
const strategyKeysMemberMock = vi.fn();
// 167.2-REVIEW WR-04: after the link update and before the enqueue,
// `handleSyncTrades` reads the strategy's `api_key_id` back with
// `from("strategies").select("api_key_id").eq("id", …).maybeSingle()`. The spy
// receives the strategy id; its default answer is the key the last link update
// wrote (what the server would say), so every case that predates the read is
// unchanged, and a case that means "someone else re-linked it" has to say so.
const linkedReadMock = vi.fn();
let lastLinkedKeyId: string | null = null;

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
          eq: (_col: string, val: unknown) =>
            table === "strategies"
              ? {
                  maybeSingle: () =>
                    Promise.resolve(
                      linkedReadMock(val) ?? {
                        data: { api_key_id: lastLinkedKeyId },
                        error: null,
                      },
                    ),
                }
              : table === "strategy_analytics"
              ? {
                  maybeSingle: () =>
                    Promise.resolve(
                      analyticsBaselineMock(table, val) ?? {
                        data: { computed_at: null },
                        error: null,
                      },
                    ),
                }
              : table === "strategy_keys"
                ? Promise.resolve(strategyKeysMemberMock(val) ?? { data: [], error: null })
                : Promise.resolve(
                    apiKeyLookupMock(table, val) ?? { data: [{ id: val }], error: null },
                  ),
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
          if (!queued || !(queued as { error?: unknown }).error) {
            lastLinkedKeyId = (vals as { api_key_id?: string }).api_key_id ?? null;
          }
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

// 167.2-REVIEW CR-01 / WR-06: before any attempt links or enqueues, the card
// reads whether a factsheet-chain job is in flight (`readChainJobState`, the
// read the real panel's KCS-18 gate shares). Replaced here so every case that
// stubs `fetch` for its own requests is untouched; the default answer is
// "settled, nothing in flight", the world every case before the gate assumed.
// The module's own fetch-level behaviour is exercised against the real panel
// in ApiKeyManager.poll.test.tsx and SyncProgress.poll.test.tsx.
const chainJobStateMock = vi.fn();
// 167.2-REVIEW-SFH M-6: the card's bound expiries and read failures are
// captured, not only logged. Captures carry tags only: no key id, no strategy id.
const captureToSentryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));
vi.mock("./chain-job-state", () => ({
  readChainJobState: (strategyId: string) =>
    Promise.resolve(chainJobStateMock(strategyId) ?? { kind: "settled", jobStatus: null }),
}));

// Capture SyncProgress's onStatusChange so a test can drive the terminal
// callback directly (mig 20260707120000 regression: complete_with_warnings must
// be treated as a terminal SUCCESS, clearing syncingKeyId + refreshing).
// Phase 167.2 / KCS-22: the second argument is the panel's `SyncStatusInfo`.
let capturedOnStatusChange:
  | ((s: string, info?: { stopReason?: string; computationError?: string | null }) => void)
  | null = null;
// 167-06 fix round 2 (WR-01): the panel's Retry, captured the same way, so a
// case can press it and read which key the strategy is re-linked to.
let capturedOnRetry: (() => void) | null = null;
vi.mock("./SyncProgress", () => ({
  SyncProgress: (props: {
    syncStatus?: string;
    stopReason?: string | null;
    syncError?: string | null;
    onStatusChange?: (
      s: string,
      info?: { stopReason?: string; computationError?: string | null },
    ) => void;
    onRetry?: () => void;
  }) => {
    capturedOnStatusChange = props.onStatusChange ?? null;
    capturedOnRetry = props.onRetry ?? null;
    // 140.3-08 / SEAMUX-05: render the two props ApiKeyManager drives on a sync
    // failure. The real SyncProgress renders both (a status label and the
    // syncError detail line), and without them in the DOM a test cannot tell
    // "the failure reached THIS component's surface" from "the failure reached
    // console.warn and nothing else" — which is exactly the B-06 defect.
    return (
      <div
        data-testid="sync-progress"
        data-sync-status={props.syncStatus}
        data-stop-reason={props.stopReason ?? ""}
      >
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

    // KCS-01: the link is now made inside the tracked attempt the add starts,
    // so its failure is that attempt's `Sync failed`, with the same message,
    // on the panel. The NEW-C37-03 guarantee below is unchanged.
    await waitFor(() => {
      expect(
        screen.getByText(
          "Failed to link key to strategy: permission denied for table strategies",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("sync-progress")).toHaveAttribute(
      "data-sync-status",
      "error",
    );
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

  // Phase 167.2 / KCS-02 (RESEARCH P3): the panel can only tell this attempt's
  // terminal from the previous run's if a baseline `computed_at` was read, and
  // read BEFORE the enqueue (a read after it could already be this job's own).
  it("KCS-02: a Resync reads the strategy_analytics baseline for THIS strategy, before the enqueue", async () => {
    analyticsBaselineMock.mockReset();
    const fetchMock = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal("fetch", fetchMock);

    await clickResync();

    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
    });
    expect(analyticsBaselineMock).toHaveBeenCalledTimes(1);
    expect(analyticsBaselineMock).toHaveBeenCalledWith("strategy_analytics", "strat-1");
    const enqueueCall = fetchMock.mock.calls.findIndex(([url]) => url === "/api/keys/sync");
    expect(enqueueCall).toBeGreaterThanOrEqual(0);
    expect(analyticsBaselineMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[enqueueCall],
    );
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
  //
  // 167.2 KCS-01 moved these three cases. The post-add sync is no longer an
  // untracked background `fetch`: it RUNS AS the card's one tracked attempt
  // (`handleSyncTrades(newKeyId)`). The B-06 reason stands unchanged: a sync
  // that did not start must reach this component's own surface, never only
  // the console. What KCS-01 adds is that the attempt holds the in-flight
  // marker while it runs, and that a well-formed enqueue is POLLED.

  /**
   * Mount with an empty list, then add a key through the real form. The list
   * read after the add returns the new key, so its card (and its in-flight
   * marker) can be observed.
   */
  async function addKeyThroughForm() {
    await act(async () => {
      render(
        <ApiKeyManager
          strategyId="strat-1"
          currentKeyId={null}
          defaultExchange="binance"
        />,
      );
    });
    selectResultMock.mockReturnValue({
      data: [{ ...keyRow(), id: "new-key", label: "Test Key" }],
      error: null,
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
  }

  /** A promise the case settles by hand, to hold the sync request open. */
  function heldSync() {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("observes a 503 on the BACKGROUND sync after an add (B-06)", async () => {
    // KCS-01: the post-add sync is the tracked attempt. Same B-06 assertion
    // (the failure reaches the panel with the route's sentence), plus: the new
    // key's Resync marker is held for the whole attempt and released by it.
    selectResultMock.mockReturnValue({ data: [], error: null });
    apiKeyInsertMock.mockReturnValue({ data: { id: "new-key" }, error: null });
    const sync = heldSync();

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
      // The post-add sync is held open, then answers a breaker trip.
      // `.catch()` alone NEVER sees this — the promise RESOLVES.
      return sync.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await addKeyThroughForm();

    // The sync POST did fire …
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync"),
      ).toBe(true);
    });
    // … as the tracked attempt: the new key holds the in-flight marker.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("api-key-card-new-key")).getByRole("button", {
          name: "Syncing…",
        }),
      ).toBeDisabled();
    });
    expect(screen.getByTestId("sync-progress")).toHaveAttribute(
      "data-sync-status",
      "syncing",
    );

    await act(async () => {
      sync.resolve(
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

    // … and THE assertion: its failure reached this component's own surface.
    // Before the fix nothing but `console.warn` observed it.
    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
    });
    expect(screen.getByText(BREAKER_SENTENCE)).toBeInTheDocument();
    // The attempt ended itself, so the marker is released.
    expect(
      within(screen.getByTestId("api-key-card-new-key")).getByRole("button", {
        name: "Use & Sync",
      }),
    ).toBeEnabled();
  });

  it("observes an unrecognised 200 on the BACKGROUND sync too (same shape, both members)", async () => {
    // KCS-01: the post-add sync is the tracked attempt, so its unrecognised
    // 200 fails through `isSyncEnqueued` exactly as a Resync's does, and the
    // new key's Resync marker is held until that answer lands.
    selectResultMock.mockReturnValue({ data: [], error: null });
    apiKeyInsertMock.mockReturnValue({ data: { id: "new-key" }, error: null });
    const sync = heldSync();

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
      return sync.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await addKeyThroughForm();

    await waitFor(() => {
      expect(
        within(screen.getByTestId("api-key-card-new-key")).getByRole("button", {
          name: "Syncing…",
        }),
      ).toBeDisabled();
    });
    await act(async () => {
      sync.resolve(
        new Response(JSON.stringify({ verification_id: "v-2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
    });
    expect(screen.getByText(SYNC_UNAVAILABLE_SENTENCE)).toBeInTheDocument();
  });

  it("a well-formed post-add 202 enters computing, is polled, and names the new key as the panel subject", async () => {
    // KCS-01 INVERTED this case. It was "ANTI-REGRESSION: a well-formed
    // background sync leaves the panel idle", whose reason was that a sync
    // that SUCCEEDED must not manufacture an error surface. That reason is
    // kept, and KCS-01 adds its other half: a successful enqueue must be
    // POLLED. Before KCS-01 the post-add 202 was fire-and-forget, so the
    // owner never saw its outcome at all.
    strategiesUpdateMock.mockReset();
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

    await addKeyThroughForm();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync"),
      ).toBe(true);
    });
    // Polled: the panel is mounted in `computing`, the one state it polls in.
    await waitFor(() => {
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
    });
    // No error surface was manufactured by a successful enqueue.
    expect(screen.getByTestId("sync-progress").textContent).toBe("");
    // The attempt is the new key's: it holds the marker ...
    expect(
      within(screen.getByTestId("api-key-card-new-key")).getByRole("button", {
        name: "Syncing…",
      }),
    ).toBeDisabled();

    // ... and the panel's subject is the new key. Its poll can end the
    // attempt, and the panel's Retry then re-links the NEW key.
    await act(async () => {
      capturedOnStatusChange!("error");
    });
    expect(
      within(screen.getByTestId("api-key-card-new-key")).getByRole("button", {
        name: "Use & Sync",
      }),
    ).toBeEnabled();
    const linksBefore = strategiesUpdateMock.mock.calls.length;
    await act(async () => {
      capturedOnRetry!();
    });
    await waitFor(() => {
      expect(strategiesUpdateMock.mock.calls.length).toBeGreaterThan(linksBefore);
    });
    expect(strategiesUpdateMock.mock.calls.at(-1)![0]).toEqual({
      table: "strategies",
      vals: { api_key_id: "new-key" },
    });
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
    capturedOnRetry = null;
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
        validate?: () => Response | Promise<Response>;
      } = {},
    ) {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === "/api/keys/sync") {
          return Promise.resolve((opts.sync ?? syncAccepted)());
        }
        if (url === "/api/keys/validate-and-encrypt") {
          if (opts.validate) return Promise.resolve(opts.validate());
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

    /** The form's submit button (its label never changes while blocked). */
    function connectKey() {
      return screen.getByRole("button", { name: "Connect Key" });
    }

    /** The line Connect Key's aria-describedby points at, or null. */
    function blockedLine() {
      const id = connectKey().getAttribute("aria-describedby");
      return id ? document.getElementById(id) : null;
    }

    beforeEach(() => {
      apiKeyDeleteMock.mockReset();
      apiKeyLookupMock.mockReset();
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
      // ... THEN: the withheld success did not re-appear. KCS-01 moved this
      // assertion: the add now starts the new key's tracked attempt, so the
      // panel is mounted again, showing that attempt in flight. What R5 pins is
      // unchanged: the retired success is never re-shown.
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "computing",
        );
      });
      expect(cardButton("key-new", "Syncing…")).toBeDisabled();
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

    it("CONTROL (R5 on Add Key), moved by KCS-01: an Add Key replaces a shown success with the new key's attempt", async () => {
      // Lineage: this was "a success that was never withheld survives an Add
      // Key", the control proving R5's retirement is guarded by the withhold.
      // KCS-01 makes the add START the new key's tracked attempt, and that
      // attempt, not a retirement, is what replaces the panel. The guard itself
      // is still controlled by "CONTROL (R5 on Delete)" above.
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

      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "computing",
        );
      });
      expect(cardButton("key-new", "Syncing…")).toBeDisabled();
      expect(cardButton("key-h", "Resync")).toBeDisabled();
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

    it("R6 superseded by KCS-01: Connect Key is blocked while another key's attempt is computing, and the attempt ends itself", async () => {
      // Lineage: "R6 (corrected): a post-add sync that fails while another
      // key's attempt is computing leaves that attempt alone, its own terminal
      // ends it, and its success is judged against its own key". R6's post-add
      // clause is replaced by KCS-01 (KCS-05): the post-add sync is the tracked
      // attempt, and an add cannot start while an attempt is live, so a post-add
      // failure during another key's attempt cannot happen. The rest is kept:
      // the live attempt is untouched, its own terminal ends it, and its success
      // is judged against its own key.
      const fetchMock = routeFetch();
      const current = row({ id: "key-j" });
      await renderRows([current], "key-j", "binance");

      await resync("key-j");
      expect(cardButton("key-j", "Update password")).toBeDisabled();
      expect(cardButton("key-j", "Delete")).toBeDisabled();

      selectResultMock.mockReturnValue({ data: [newRow(), current], error: null });
      await addKey();

      // Connect Key is blocked, and says why, naming the attempt's key.
      expect(connectKey()).toBeDisabled();
      expect(connectKey()).toHaveAccessibleDescription(
        'Wait for the sync of "Manager MT5" to finish before connecting another key.',
      );
      // The add never started: no validate request was sent.
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/keys/validate-and-encrypt"),
      ).toBe(false);
      // The live attempt is untouched. It is still polling, and its key still
      // carries the in-flight marker and its disables.
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
      // The form is still open; its reason line unmounted and it submits again.
      expect(blockedLine()).toBeNull();
      expect(connectKey()).toBeEnabled();
      // And its success is judged against J, the key it synced: J is
      // untrusted, so R2 withholds it and J's pill returns.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
      expect(
        within(card("key-j")).getByTestId("allocator-sync-pill"),
      ).toHaveAttribute("data-sync-status", "sign_in_failed");
    });

    // ── KCS-01 locked copy (167.2-UI-SPEC § KCS-01, S1) ─────────────────────
    //
    // Hand-typed, never imported: an oracle that reads its subject cannot
    // detect its subject changing. The quotes are ASCII U+0022.

    it("KCS01-BLOCKED: with an attempt live on a labelled key, the open form names that key, verbatim", async () => {
      const fetchMock = routeFetch();
      await renderRows(
        [
          row({
            id: "key-b",
            exchange: "bybit",
            label: "Example Bybit",
            sync_status: null,
            venue_account_id: null,
          }),
        ],
        "key-b",
        "binance",
      );
      await resync("key-b");

      // The header Add Key stays enabled: opening the form is harmless.
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
      });
      expect(connectKey()).toBeDisabled();
      expect(blockedLine()?.textContent).toBe(
        'Wait for the sync of "Example Bybit" to finish before connecting another key.',
      );
      expect(connectKey()).toHaveAccessibleDescription(
        'Wait for the sync of "Example Bybit" to finish before connecting another key.',
      );
      await act(async () => {
        fireEvent.click(connectKey());
      });
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/keys/validate-and-encrypt"),
      ).toBe(false);
    });

    it.each([
      { shape: "empty", label: "" },
      { shape: "whitespace-only", label: "   " },
    ])(
      "KCS01-BLOCKED-NOLABEL: an attempt on a key with an $shape label reads the no-label sentence, verbatim",
      async ({ label }) => {
        routeFetch();
        await renderRows(
          [
            row({ id: "key-a", exchange: "binance", label: "Key A", sync_status: null, venue_account_id: null }),
            row({ id: "key-w", exchange: "binance", label, sync_status: null, venue_account_id: null }),
          ],
          "key-w",
          "binance",
        );
        await resync("key-w");
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
        });
        expect(connectKey()).toBeDisabled();
        expect(blockedLine()?.textContent).toBe(
          "Wait for the current sync to finish before connecting another key.",
        );
      },
    );

    it("long-text: a 200-character label renders the whole sentence as escaped text, instruction intact", async () => {
      // Synthetic, and carrying markup and a replacement pattern: the label is
      // user text, so it must render as text and must not be rewritten.
      const longLabel = `<b>$&</b>${"x".repeat(191)}`;
      expect(longLabel).toHaveLength(200);
      routeFetch();
      await renderRows(
        [row({ id: "key-l", exchange: "binance", label: longLabel, sync_status: null, venue_account_id: null })],
        "key-l",
        "binance",
      );
      await resync("key-l");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Add Key/i }));
      });
      const line = blockedLine()!;
      expect(line.textContent).toBe(
        `Wait for the sync of "${longLabel}" to finish before connecting another key.`,
      );
      expect(line.textContent!.endsWith("before connecting another key.")).toBe(true);
      expect(line.querySelector("b")).toBeNull();
      expect(line.className).not.toMatch(/truncate|line-clamp|overflow-hidden/);
    });

    // ── ATTEMPT SCOPE (167-06 fix round) ────────────────────────────────────

    it("an add cannot start while an attempt awaits its own enqueue (Connect Key disabled, Enter blocked) (KCS-01)", async () => {
      // Lineage: "ATTEMPT SCOPE, post-add route: a post-add sync that fails
      // while another key's attempt still awaits its own enqueue does not end
      // that attempt (167-REVIEW-06 CR-01)". KCS-01 removed the premise: an add
      // cannot start while an attempt is live, so this pins the prevention in
      // the same window, an attempt still awaiting its own enqueue, and keeps
      // CR-01's assertion that the attempt owns its marker for its whole life.
      const ownEnqueue = deferred<Response>();
      const fetchMock = routeFetch({ sync: () => ownEnqueue.promise });
      const current = row({ id: "key-j" });
      await renderRows([current], "key-j", "binance");

      // 1. Resync J: its enqueue is held open.
      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
      });
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "syncing",
      );

      // 2. An add submitted now (the Enter-key path) sends nothing, and the
      //    click path is closed too: Connect Key is disabled.
      selectResultMock.mockReturnValue({ data: [newRow(), current], error: null });
      await addKey();
      expect(connectKey()).toBeDisabled();
      await act(async () => {
        fireEvent.click(connectKey());
      });
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/keys/validate-and-encrypt"),
      ).toBe(false);

      // 3. J's own enqueue lands.
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
      // Exactly one sync request: J's.
      expect(
        fetchMock.mock.calls.filter((c) => c[0] === "/api/keys/sync"),
      ).toHaveLength(1);
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
        // the strategy's EXISTING analytics row. Since 167-06 fix round 2 the
        // real panel no longer polls before the enqueue at all (pinned against
        // the real poller in ApiKeyManager.poll.test.tsx); this case keeps the
        // component's OWN rule pinned, the `enqueued` check that stays as a
        // second line whatever the panel does.
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

    // ── 167.2-REVIEW IN-02: an unmount drops the live attempt's continuations ──
    it("IN02-UNMOUNT: after an unmount mid-attempt, a late enqueue answer reads nothing and refreshes nothing", async () => {
      let answer!: (r: Response) => void;
      const held = new Promise<Response>((r) => {
        answer = r;
      });
      const fetchMock = routeFetch({ sync: () => held });
      const view = await (async () => {
        selectResultMock.mockReturnValue({ data: [row({ id: "key-j" })], error: null });
        let rendered!: ReturnType<typeof render>;
        await act(async () => {
          rendered = render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-j" />);
        });
        await waitFor(() => {
          expect(screen.getByTestId("api-key-card-key-j")).toBeInTheDocument();
        });
        return rendered;
      })();
      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
      });
      await waitFor(() => {
        expect(fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync")).toBe(true);
      });

      view.unmount();
      const refreshes = routerRefreshMock.mock.calls.length;
      const reads = selectResultMock.mock.calls.length;
      await act(async () => {
        answer(syncAccepted());
      });
      await act(async () => {
        await Promise.resolve();
      });

      // The route the owner navigated to is not refreshed by a card that is gone.
      expect(routerRefreshMock.mock.calls.length).toBe(refreshes);
      expect(selectResultMock.mock.calls.length).toBe(reads);
    });

    // ── 167.2-REVIEW-SFH L-1 / L-2: a withheld success leaves a trace ─────
    // Hand-typed from the UI-SPEC review-fix row KCS-FINISH-UNVERIFIED.
    const FINISH_UNVERIFIED =
      "This sync finished, but the key list could not be re-read to confirm the key's status. Reload this page to see it.";

    it("L1-NOTE-SURVIVES: a success withheld for an unverified list leaves a note that the late clean re-read does not clear, and the next attempt does", async () => {
      routeFetch();
      await renderRows([row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })], "key-h");
      await resync("key-h");

      selectResultMock.mockReturnValue({ data: null, error: { message: "network error" } });
      await finish("complete");
      await waitFor(() => {
        expect(screen.getByText(FINISH_UNVERIFIED)).toBeInTheDocument();
      });

      // The load-error Retry reads cleanly and clears the banner, NOT the note.
      selectResultMock.mockReturnValue({
        data: [row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })],
        error: null,
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      });
      await waitFor(() => {
        expect(screen.queryByText(/Couldn't load your API keys/i)).not.toBeInTheDocument();
      });
      expect(screen.getByText(FINISH_UNVERIFIED)).toBeInTheDocument();

      // A new attempt replaces it.
      await resync("key-h");
      expect(screen.queryByText(FINISH_UNVERIFIED)).not.toBeInTheDocument();
    });

    it("L1-CONTROL: a success withheld beside an UNTRUSTED subject leaves no such note (the pill is the signal)", async () => {
      routeFetch();
      await renderRows([row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })], "key-h");
      await resync("key-h");
      selectResultMock.mockReturnValue({
        data: [row({ id: "key-h", label: "Healthy MT5", sync_status: "sign_in_failed" })],
        error: null,
      });
      await finish("complete");
      expect(screen.queryByText(FINISH_UNVERIFIED)).not.toBeInTheDocument();
    });

    it("L2-NULL-DATA: a re-read answering neither rows nor an error is not a clean read: the success is withheld and the load error shows", async () => {
      routeFetch();
      await renderRows([row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })], "key-h");
      await resync("key-h");
      selectResultMock.mockReturnValue({ data: null, error: null });
      await finish("complete");
      await waitFor(() => {
        expect(screen.getByText(/Couldn't load your API keys/i)).toBeInTheDocument();
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("L2-SUBJECT-ABSENT: a clean re-read that no longer holds the subject key shows no success for it", async () => {
      routeFetch();
      await renderRows(
        [
          row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" }),
          row({ id: "key-o", label: "Other", sync_status: "complete" }),
        ],
        "key-h",
      );
      await resync("key-h");
      // Deleted in another tab: the re-read holds only the other key.
      selectResultMock.mockReturnValue({
        data: [row({ id: "key-o", label: "Other", sync_status: "complete" })],
        error: null,
      });
      await finish("complete");
      await waitFor(() => {
        expect(screen.queryByTestId("api-key-card-key-h")).not.toBeInTheDocument();
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
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

      // RLS filtered the DELETE to zero rows: no error, nothing removed. The
      // follow-up lookup (167-06 fix round 2, WR-05) finds the row still there.
      apiKeyDeleteMock.mockReturnValue({ data: [], error: null });
      apiKeyLookupMock.mockReturnValue({ data: [{ id: "key-r" }], error: null });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await deleteKey("key-r");
        await waitFor(() => {
          expect(
            screen.getByText(
              "Failed to delete key: the key is still connected. Try again, and contact support if it keeps failing.",
            ),
          ).toBeInTheDocument();
        });
      } finally {
        consoleError.mockRestore();
      }
      expect(apiKeyDeleteMock).toHaveBeenCalledWith("api_keys");
      expect(apiKeyLookupMock).toHaveBeenCalledWith("api_keys", "key-r");
      expect(screen.getByTestId("api-key-card-key-r")).toBeInTheDocument();
    });

    it.each([
      { arm: "the DELETE itself errored", del: { data: null, error: { message: "RAW-PG-DETAIL-sentinel" } }, lookup: undefined },
      { arm: "the zero-row follow-up lookup errored", del: { data: [], error: null }, lookup: { data: null, error: { message: "RAW-PG-DETAIL-sentinel" } } },
    ])("a failed Delete renders authored copy, never the raw database message, when $arm (167-06 security delta UF-1)", async ({ del, lookup }) => {
      routeFetch();
      const keyA = row({ id: "key-a", exchange: "binance", label: "Key A", sync_status: null, venue_account_id: null });
      await renderRows([keyA]);
      apiKeyDeleteMock.mockReturnValue(del);
      if (lookup) apiKeyLookupMock.mockReturnValue(lookup);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await deleteKey("key-a");
        await waitFor(() => {
          expect(
            screen.getByText("Failed to delete key. Try again, and contact support if it keeps failing."),
          ).toBeInTheDocument();
        });
        expect(screen.queryByText(/RAW-PG-DETAIL-sentinel/)).not.toBeInTheDocument();
        expect(consoleError).toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
      expect(screen.getByTestId("api-key-card-key-a")).toBeInTheDocument();
    });

    it("a Delete that removed NO row because the key was ALREADY gone (deleted in another tab) removes the card and reports no failure (167-REVIEW-06-R2 WR-05)", async () => {
      routeFetch();
      const keyA = row({
        id: "key-a",
        exchange: "binance",
        label: "Key A",
        sync_status: null,
        venue_account_id: null,
      });
      const keyB = row({
        id: "key-b",
        exchange: "binance",
        label: "Key B",
        sync_status: null,
        venue_account_id: null,
      });
      await renderRows([keyA, keyB]);

      // The DELETE removed nothing, and the follow-up lookup finds no row.
      apiKeyDeleteMock.mockReturnValue({ data: [], error: null });
      apiKeyLookupMock.mockReturnValue({ data: [], error: null });
      await deleteKey("key-a");

      await waitFor(() => {
        expect(screen.queryByTestId("api-key-card-key-a")).not.toBeInTheDocument();
      });
      expect(apiKeyLookupMock).toHaveBeenCalledWith("api_keys", "key-a");
      expect(screen.queryByText(/Failed to delete key/)).not.toBeInTheDocument();
      expect(screen.getByTestId("api-key-card-key-b")).toBeInTheDocument();
    });

    // ── 167.2-REVIEW WR-05 → R2 WR-02: a composite member's Delete WARNS, by name ──
    //
    // `strategy_keys.api_key_id` cascades on an api_keys DELETE, and the DB
    // guard refuses only for a PUBLISHED composite, so deleting a member of a
    // draft or pending composite shrinks it (its last member makes it
    // "unlinked"). Round 1 REFUSED such a Delete on every card. FOUNDER
    // DECISION 2026-09-24 (round 2): do not refuse. Inside the existing
    // "permanently remove" confirm, a bounded (15 s) membership read names the
    // affected composites and says what deleting does; the owner may then
    // confirm and delete. A failed read says it could not check, and still
    // lets the owner choose (warn, don't block). Hand-typed from the UI-SPEC
    // round-2 founder-decision rows; composite names are synthetic.
    function membership(name: string | null, status = "draft") {
      return { strategy_id: `strat-composite-${name ?? "x"}`, strategies: name === null ? null : { name, status } };
    }
    const WARN_ONE_ORACLE =
      'This key is part of 1 composite strategy: "Synthetic Composite A". Deleting it removes the key from every composite listed, and a composite with no other key left becomes unlinked.';
    const WARN_TWO_PUBLISHED_ORACLE =
      'This key is part of 2 composite strategies: "Synthetic Composite A", "Synthetic Composite P". Deleting it removes the key from every composite listed, and a composite with no other key left becomes unlinked. A key used by a published composite cannot be deleted: contact support@quantalyze.com to change that composite\'s keys.';
    const WARN_UNCHECKED_ORACLE =
      "We could not check whether this key is part of a composite strategy. If it is, deleting it also removes it from that composite, and a composite with no other key left becomes unlinked.";

    function confirmDialog() {
      return dialogTitled("Delete API Key");
    }

    it("R2-WR02-WARNING-NAMES: a composite member's confirm names the composite in amber, and the Delete still proceeds after confirm (founder decision)", async () => {
      routeFetch();
      const keyA = row({ id: "key-a", exchange: "binance", label: "Key A", sync_status: null, venue_account_id: null });
      await renderRows([keyA]);
      strategyKeysMemberMock.mockReturnValue({ data: [membership("Synthetic Composite A")], error: null });
      try {
        await act(async () => {
          fireEvent.click(cardButton("key-a", "Delete"));
        });
        await waitFor(() => {
          expect(within(confirmDialog()).getByTestId("delete-composite-warning")).toHaveTextContent(WARN_ONE_ORACLE);
        });
        expect(strategyKeysMemberMock).toHaveBeenCalledWith("key-a");
        const warning = within(confirmDialog()).getByTestId("delete-composite-warning");
        // DESIGN.md: a recoverable consequence is amber, never red.
        expect(warning.className).toContain("text-warning");
        expect(warning.className).not.toContain("text-negative");
        await act(async () => {
          fireEvent.click(within(confirmDialog()).getByRole("button", { name: "Delete" }));
        });
        await waitFor(() => {
          expect(screen.queryByTestId("api-key-card-key-a")).not.toBeInTheDocument();
        });
        expect(apiKeyDeleteMock).toHaveBeenCalledWith("api_keys");
      } finally {
        strategyKeysMemberMock.mockReset();
      }
    });

    it("R2-WR02-TWO-PUBLISHED: every composite is named, and a published one says its key cannot be deleted (the DB guard refuses it)", async () => {
      routeFetch();
      const keyA = row({ id: "key-a", exchange: "binance", label: "Key A", sync_status: null, venue_account_id: null });
      await renderRows([keyA]);
      strategyKeysMemberMock.mockReturnValue({
        data: [membership("Synthetic Composite A", "archived"), membership("Synthetic Composite P", "published")],
        error: null,
      });
      try {
        await act(async () => {
          fireEvent.click(cardButton("key-a", "Delete"));
        });
        await waitFor(() => {
          expect(within(confirmDialog()).getByTestId("delete-composite-warning")).toHaveTextContent(
            WARN_TWO_PUBLISHED_ORACLE,
          );
        });
        expect(within(confirmDialog()).getByRole("button", { name: "Delete" })).toBeEnabled();
      } finally {
        strategyKeysMemberMock.mockReset();
      }
    });

    it("R2-WR02-UNREADABLE: a failed membership read says so in the confirm, is captured (tags only), and still lets the owner delete", async () => {
      routeFetch();
      const keyA = row({ id: "key-a", exchange: "binance", label: "Key A", sync_status: null, venue_account_id: null });
      await renderRows([keyA]);
      strategyKeysMemberMock.mockReturnValue({ data: null, error: { message: "RAW-PG-DETAIL-sentinel" } });
      captureToSentryMock.mockClear();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await act(async () => {
          fireEvent.click(cardButton("key-a", "Delete"));
        });
        await waitFor(() => {
          expect(within(confirmDialog()).getByTestId("delete-composite-warning")).toHaveTextContent(
            WARN_UNCHECKED_ORACLE,
          );
        });
        expect(screen.queryByText(/RAW-PG-DETAIL-sentinel/)).not.toBeInTheDocument();
        expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
          level: "warning",
          tags: { component: "ApiKeyManager", stage: "delete-membership-read" },
        });
        expect(JSON.stringify(captureToSentryMock.mock.calls)).not.toContain("key-a");
        await act(async () => {
          fireEvent.click(within(confirmDialog()).getByRole("button", { name: "Delete" }));
        });
        await waitFor(() => {
          expect(screen.queryByTestId("api-key-card-key-a")).not.toBeInTheDocument();
        });
        expect(apiKeyDeleteMock).toHaveBeenCalledWith("api_keys");
      } finally {
        consoleError.mockRestore();
        strategyKeysMemberMock.mockReset();
      }
    });

    it("R2-WR02-NO-MEMBERSHIP: a key in no composite shows no warning in the confirm", async () => {
      routeFetch();
      const keyA = row({ id: "key-a", exchange: "binance", label: "Key A", sync_status: null, venue_account_id: null });
      await renderRows([keyA]);
      await act(async () => {
        fireEvent.click(cardButton("key-a", "Delete"));
      });
      expect(confirmDialog()).toHaveAttribute("open");
      expect(within(confirmDialog()).queryByTestId("delete-composite-warning")).not.toBeInTheDocument();
      expect(within(confirmDialog()).getByRole("button", { name: "Delete" })).toBeEnabled();
    });

    it("R2-WR02-UNNAMED: a membership whose composite cannot be read is still listed, never dropped", async () => {
      routeFetch();
      const keyA = row({ id: "key-a", exchange: "binance", label: "Key A", sync_status: null, venue_account_id: null });
      await renderRows([keyA]);
      strategyKeysMemberMock.mockReturnValue({ data: [membership(null)], error: null });
      try {
        await act(async () => {
          fireEvent.click(cardButton("key-a", "Delete"));
        });
        await waitFor(() => {
          expect(within(confirmDialog()).getByTestId("delete-composite-warning")).toHaveTextContent(
            "This key is part of 1 composite strategy: a composite whose name could not be read.",
          );
        });
      } finally {
        strategyKeysMemberMock.mockReset();
      }
    });

    // ── Retry after a post-add failure targets the key that failed (WR-01) ──
    //
    // Moved by KCS-01. The two orderings this pinned both needed an attempt on
    // J to overlap the add, and KCS-01 prevents that overlap in both
    // directions. WR-01's reason stands: the failure shown is the NEW key's, so
    // the panel's Retry must re-link the new key and never undo the add's link.
    // Each row now pins that J's sync is REFUSED in its ordering's window.

    it.each([
      {
        ordering: "J's Resync is refused while the add's validate is pending (P7)",
        refusedDuringValidate: true,
      },
      {
        ordering: "no attempt was live at the add; J's Resync is refused while the new key's attempt holds the slot",
        refusedDuringValidate: false,
      },
    ])(
      "Retry after a post-add failure re-links the NEW key, never J ($ordering) (167-REVIEW-06-R2 WR-01)",
      async ({ refusedDuringValidate }) => {
        // KCS-01: both orderings now pin J's refusal; see the note above.
        const postAdd = deferred<Response>();
        const validate = deferred<Response>();
        const syncQueue: Array<() => Response | Promise<Response>> = [
          () => postAdd.promise,
        ];
        const fetchMock = routeFetch({
          sync: () => (syncQueue.shift() ?? syncAccepted)(),
          validate: refusedDuringValidate
            ? () => validate.promise
            : undefined,
        });
        const current = row({
          id: "key-j",
          exchange: "binance",
          label: "Key J",
          sync_status: null,
          venue_account_id: null,
        });
        await renderRows([current], "key-j", "binance");
        selectResultMock.mockReturnValue({ data: [newRow(), current], error: null });

        await addKey();
        if (refusedDuringValidate) {
          // P7: the add's validate is pending, and J's Resync is refused.
          expect(cardButton("key-j", "Resync")).toBeDisabled();
          await act(async () => {
            fireEvent.click(cardButton("key-j", "Resync"));
          });
          expect(strategiesUpdateMock).not.toHaveBeenCalled();
          expect(fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync")).toBe(false);
          await act(async () => {
            validate.resolve(
              new Response(
                JSON.stringify({ api_key_id: "key-new", valid: true, read_only: true }),
                { status: 200, headers: JSON_HEADERS },
              ),
            );
          });
        }
        await waitFor(() => {
          expect(screen.getByTestId("api-key-card-key-new")).toBeInTheDocument();
        });

        // J's Resync is refused while the post-add attempt is live.
        const linksDuring = strategiesUpdateMock.mock.calls.length;
        expect(cardButton("key-j", "Resync")).toBeDisabled();
        await act(async () => {
          fireEvent.click(cardButton("key-j", "Resync"));
        });
        expect(strategiesUpdateMock.mock.calls.length).toBe(linksDuring);

        // The post-add sync fails: it is the tracked attempt, so it is shown.
        await act(async () => {
          postAdd.resolve(syncRefused("Post-add sync failed"));
        });
        await waitFor(() => {
          expect(screen.getByTestId("sync-progress")).toHaveAttribute(
            "data-sync-status",
            "error",
          );
        });
        expect(screen.getByTestId("sync-progress").textContent).toBe("Post-add sync failed");

        // Retry is the NEW key's: it must re-link the new key, not J.
        const linksBefore = strategiesUpdateMock.mock.calls.length;
        await act(async () => {
          capturedOnRetry!();
        });
        await waitFor(() => {
          expect(strategiesUpdateMock.mock.calls.length).toBeGreaterThan(linksBefore);
        });
        const lastLink = strategiesUpdateMock.mock.calls.at(-1)![0] as {
          table: string;
          vals: { api_key_id: string };
        };
        expect(lastLink.table).toBe("strategies");
        expect(lastLink.vals.api_key_id).toBe("key-new");
      },
    );

    // ── A poll error ends the attempt (WR-02) ───────────────────────────────

    // Moved by Phase 167.2 / KCS-22. Lineage: this case drove
    // `("error")` as the poller's escalation and asserted the timeout sentence
    // as the panel's detail. A give-up is now `no_result`, which is not a
    // failure, so it carries no error detail; the controls it frees are the
    // same ones.
    // Moved again by the 167.2 review fix round (167.2-REVIEW WR-06, lineage):
    // "usable again" pinned a hole as intended behaviour. KCS-22 hides Retry
    // on `no_result` because a re-POST during `failed_retry` inserts a second
    // job (F-3), and Resync on the same key IS that re-POST. The buttons are
    // still ENABLED here (a give-up is not a failure, and the job may well be
    // done), but a click now passes the pre-attempt job-state gate first, so a
    // Resync while the job is live is refused (WR06-RESYNC-REFUSED below).
    it("a poll give-up ends the attempt as no_result: no failure detail, and Resync, Update password and Delete are enabled again (167-REVIEW-06-R2 WR-02, KCS-22; gated since WR-06)", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");
      await resync("key-j");
      expect(cardButton("key-j", "Update password")).toBeDisabled();
      expect(cardButton("key-j", "Delete")).toBeDisabled();

      // The poller gives up (its cap or its missing-row grace).
      await act(async () => {
        capturedOnStatusChange!("no_result", { stopReason: "poll_cap" });
      });

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "no_result",
      );
      // No error detail reaches the panel: a give-up claims no failure.
      expect(screen.getByTestId("sync-progress").textContent).toBe("");
      expect(screen.queryByText(/Sync failed/)).not.toBeInTheDocument();
      expect(cardButton("key-j", "Resync")).toBeEnabled();
      expect(cardButton("key-j", "Update password")).toBeEnabled();
      expect(cardButton("key-j", "Delete")).toBeEnabled();
    });

    // ── 167.2-REVIEW CR-01 / WR-06: no attempt starts while a chain job is live ──
    //
    // `no_result` and `unconfirmed` end the attempt while its job may still be
    // running (the copy says so). The analytics enqueue dedupes on
    // (strategy, kind) and returns the EXISTING job, and every piece of
    // evidence the panel reads is scoped to the STRATEGY, never the key. So a
    // `Use & Sync` on another key was served by the previous key's job, and the
    // panel then said "Up to date" under the new key (CR-01); a `Resync` on the
    // same key during `failed_retry` inserted a second job (WR-06). Every
    // attempt now reads the job state first and refuses, before the link and
    // before the enqueue, while a chain job is in flight or the read cannot
    // answer (fail closed). The refusal is the amber `unconfirmed` panel with
    // its own authored reason (`chain_in_flight` / `chain_unreadable`).

    /** Drive the live attempt to a KCS-22 give-up. */
    async function giveUp() {
      await act(async () => {
        capturedOnStatusChange!("no_result", { stopReason: "poll_cap" });
      });
      expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-sync-status", "no_result");
    }

    function syncPosts(fetchMock: ReturnType<typeof vi.fn>) {
      return fetchMock.mock.calls.filter((c) => c[0] === "/api/keys/sync").length;
    }

    it("CR01-OTHER-KEY-REFUSED: after a give-up on K1, Use & Sync on K2 while K1's chain job runs links nothing, enqueues nothing, and says why", async () => {
      const fetchMock = routeFetch();
      try {
        await renderRows([row({ id: "key-j" }), row({ id: "key-k", label: "Key K" })], "key-j");
        await resync("key-j");
        await giveUp();
        const linksBefore = strategiesUpdateMock.mock.calls.length;
        const postsBefore = syncPosts(fetchMock);

        chainJobStateMock.mockReturnValue({ kind: "in_flight", jobStatus: "running" });
        await act(async () => {
          fireEvent.click(cardButton("key-k", "Use & Sync"));
        });

        await waitFor(() => {
          expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-sync-status", "unconfirmed");
        });
        expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-stop-reason", "chain_in_flight");
        expect(strategiesUpdateMock.mock.calls.length).toBe(linksBefore);
        expect(syncPosts(fetchMock)).toBe(postsBefore);
        expect(chainJobStateMock).toHaveBeenCalledWith("strat-1");
        // The refusal ends the attempt: nothing stays disabled behind it.
        expect(cardButton("key-k", "Use & Sync")).toBeEnabled();
      } finally {
        chainJobStateMock.mockReset();
      }
    });

    it("WR06-RESYNC-REFUSED: after a give-up, Resync on the same key while its job is in failed_retry is refused before any re-POST", async () => {
      const fetchMock = routeFetch();
      try {
        await renderRows([row({ id: "key-j" })], "key-j");
        await resync("key-j");
        await giveUp();
        const postsBefore = syncPosts(fetchMock);

        chainJobStateMock.mockReturnValue({ kind: "in_flight", jobStatus: "failed_retry" });
        await act(async () => {
          fireEvent.click(cardButton("key-j", "Resync"));
        });

        await waitFor(() => {
          expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-stop-reason", "chain_in_flight");
        });
        expect(syncPosts(fetchMock)).toBe(postsBefore);
      } finally {
        chainJobStateMock.mockReset();
      }
    });

    it("GATE-UNREADABLE: a job-state read that cannot answer refuses the attempt (fail closed), with its own reason", async () => {
      const fetchMock = routeFetch();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await renderRows([row({ id: "key-j" })], "key-j");
        chainJobStateMock.mockReturnValue({ kind: "unreadable", reason: "HTTP 429" });
        await act(async () => {
          fireEvent.click(cardButton("key-j", "Resync"));
        });

        await waitFor(() => {
          expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-stop-reason", "chain_unreadable");
        });
        expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-sync-status", "unconfirmed");
        expect(strategiesUpdateMock).not.toHaveBeenCalled();
        expect(syncPosts(fetchMock)).toBe(0);
      } finally {
        warn.mockRestore();
        chainJobStateMock.mockReset();
      }
    });

    // ── 167.2-REVIEW WR-04: the link is read back before the enqueue ──────
    //
    // A link update that answers after LINK_UPDATE_BOUND_MS is not aborted (by
    // design), so it can land AFTER a newer attempt's link and re-link the
    // strategy to the older key, and the newer attempt's job then syncs a key
    // that is not its subject. Before the enqueue the card now reads
    // `strategies.api_key_id` back from the server; anything but this
    // attempt's key refuses the attempt as `unconfirmed` / `link_unverified`.

    it("WR04-LINK-MISMATCH: a strategy linked to another key when read back sends no enqueue and says why", async () => {
      const fetchMock = routeFetch();
      try {
        await renderRows([row({ id: "key-j" })], "key-j");
        linkedReadMock.mockReturnValue({ data: { api_key_id: "key-other" }, error: null });
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await act(async () => {
          fireEvent.click(cardButton("key-j", "Resync"));
        });
        await waitFor(() => {
          expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-stop-reason", "link_unverified");
        });
        errSpy.mockRestore();
        expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-sync-status", "unconfirmed");
        expect(syncPosts(fetchMock)).toBe(0);
        expect(linkedReadMock).toHaveBeenCalledWith("strat-1");
      } finally {
        linkedReadMock.mockReset();
      }
    });

    it("WR04-LINK-UNREADABLE: a read-back that fails refuses the enqueue too (fail closed)", async () => {
      const fetchMock = routeFetch();
      try {
        await renderRows([row({ id: "key-j" })], "key-j");
        linkedReadMock.mockReturnValue({ data: null, error: { message: "synthetic read failure" } });
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        await act(async () => {
          fireEvent.click(cardButton("key-j", "Resync"));
        });
        await waitFor(() => {
          expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-stop-reason", "link_unverified");
        });
        errSpy.mockRestore();
        expect(syncPosts(fetchMock)).toBe(0);
      } finally {
        linkedReadMock.mockReset();
      }
    });

    it("L4-POST-ENQUEUE-THROW: a throw from the key-list re-read AFTER the enqueue never reports Sync failed for the enqueued sync", async () => {
      // 167.2-REVIEW-SFH L-4: the re-read sat inside the enqueue's try, so a
      // throw there (a network-layer failure) ended a live, ENQUEUED attempt
      // as "Sync failed" and stopped its poll.
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        selectResultMock.mockImplementationOnce(() => {
          throw new Error("synthetic network failure");
        });
        await act(async () => {
          fireEvent.click(cardButton("key-j", "Resync"));
        });
        await waitFor(() => {
          expect(err).toHaveBeenCalledWith(
            "[ApiKeyManager] the post-enqueue key-list re-read threw; the attempt keeps running:",
            expect.any(Error),
          );
        });
        expect(screen.getByTestId("sync-progress")).toHaveAttribute("data-sync-status", "computing");
        expect(screen.queryByText(/Sync failed/)).not.toBeInTheDocument();
        expect(cardButton("key-j", "Syncing…")).toBeDisabled();
      } finally {
        err.mockRestore();
      }
    });

    it("M6-BASELINE-CAPTURED (167.2-REVIEW-SFH M-6 / M-3): a failed baseline read is captured at warning level, since it silently disables evidence (b)", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");
      captureToSentryMock.mockClear();
      analyticsBaselineMock.mockReturnValue({ data: null, error: { message: "synthetic baseline failure" } });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await resync("key-j");
        expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
          level: "warning",
          tags: { component: "ApiKeyManager", stage: "evidence-baseline" },
        });
        // No key id and no strategy id leave in a capture.
        for (const call of captureToSentryMock.mock.calls) {
          expect(JSON.stringify(call[1])).not.toMatch(/key-j|strat-1/);
          expect(String((call[0] as Error).message)).not.toMatch(/key-j|strat-1/);
        }
      } finally {
        errSpy.mockRestore();
        analyticsBaselineMock.mockReset();
      }
    });

    it("GATE-SETTLED (CONTROL): a settled read lets the attempt through to the link and the enqueue", async () => {
      const fetchMock = routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");
      chainJobStateMock.mockReturnValue({ kind: "settled", jobStatus: "failed_final" });
      try {
        await resync("key-j");
        expect(strategiesUpdateMock).toHaveBeenCalled();
        expect(syncPosts(fetchMock)).toBe(1);
      } finally {
        chainJobStateMock.mockReset();
      }
    });

    // ── An evidenced failure carries the server's own reason (KCS-22) ──────

    it("FAILED-DETAIL: an evidenced failed status shows the row's computation_error as the panel's detail", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");
      await resync("key-j");

      await act(async () => {
        capturedOnStatusChange!("error", { computationError: "Example curated reason." });
      });

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
      expect(screen.getByTestId("sync-progress").textContent).toBe(
        "Example curated reason.",
      );
      expect(cardButton("key-j", "Resync")).toBeEnabled();
    });

    it("FAILED-NO-DETAIL: an evidenced failed status with no computation_error shows no detail, and never the retired timeout sentence", async () => {
      routeFetch();
      await renderRows([row({ id: "key-j" })], "key-j");
      await resync("key-j");

      await act(async () => {
        capturedOnStatusChange!("error");
      });

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );
      expect(screen.getByTestId("sync-progress").textContent).toBe("");
      // Hand-typed: the sentence KCS-22 retired. No element may carry it.
      expect(
        screen.queryByText(/Analytics computation timed out/),
        "a failure with no reason was given a timeout claim no timeout stood behind",
      ).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain("Analytics computation timed out");
    });

    // ── One terminal is handled once (WR-03) ────────────────────────────────

    it("one terminal is handled once: reads landing while its re-read settles start no second re-read and cannot end the attempt (167-REVIEW-06-R2 WR-03)", async () => {
      routeFetch();
      const healthy = row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" });
      await renderRows([healthy], "key-h");
      await resync("key-h");

      const reread = deferred<unknown>();
      selectResultMock.mockReturnValueOnce(reread.promise);
      const reads = selectResultMock.mock.calls.length;
      const refreshes = routerRefreshMock.mock.calls.length;
      await act(async () => {
        capturedOnStatusChange!("complete");
      });
      // While the re-read is outstanding: a second read of the same terminal,
      // then the capped poller's escalation, which it sends on every tick.
      await act(async () => {
        capturedOnStatusChange!("complete");
        capturedOnStatusChange!("error");
      });

      expect(selectResultMock.mock.calls.length).toBe(reads + 1);
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
      expect(cardButton("key-h", "Update password")).toBeDisabled();

      await act(async () => {
        reread.resolve({ data: [healthy], error: null });
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "complete",
        );
      });
      // The success, not the escalation's timeout copy.
      expect(screen.getByTestId("sync-progress").textContent).toBe("");
      expect(routerRefreshMock.mock.calls.length).toBe(refreshes + 1);
      expect(cardButton("key-h", "Resync")).toBeEnabled();
    });

    // ── Key-list reads are ordered (WR-04) ──────────────────────────────────

    it("reads are ordered: the attempt's own post-enqueue read resolving AFTER the terminal re-read cannot lift the withhold (167-REVIEW-06-R2 WR-04)", async () => {
      routeFetch();
      const beforeTheJob = row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" });
      await renderRows([beforeTheJob], "key-h");

      // The post-enqueue read is held open ...
      const postEnqueueRead = deferred<unknown>();
      selectResultMock.mockReturnValueOnce(postEnqueueRead.promise);
      await resync("key-h");

      // ... while the terminal arrives and its re-read shows the sign-in failed.
      selectResultMock.mockReturnValueOnce({
        data: [row({ id: "key-h", label: "Healthy MT5", sync_status: "sign_in_failed" })],
        error: null,
      });
      await finish("complete");
      await waitFor(() => {
        expect(
          within(card("key-h")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "sign_in_failed");
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      // NOW the older snapshot, taken before the job ran, lands.
      await act(async () => {
        postEnqueueRead.resolve({ data: [beforeTheJob], error: null });
      });
      await act(async () => {});

      expect(
        within(card("key-h")).getByTestId("allocator-sync-pill"),
      ).toHaveAttribute("data-sync-status", "sign_in_failed");
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    // ── KCS-04: a withheld success is RETIRED when it is withheld ───────────
    //
    // 167.2 KCS-04 (replacing R2's "withheld" with "retired", KCS-05): R2 only
    // hid the terminal success in render, so any later re-read that lifted the
    // withhold (the load-error Retry, a router refresh that re-runs the list
    // read, another tab's `Update password` or `Delete`) re-showed "Up to date"
    // for an attempt judged beside an untrusted key. The retirement now happens
    // at the moment of judgement: the terminal arm lands on idle when its
    // re-read's APPLIED rows show the subject untrusted, and every applied read
    // retires a shown success whose subject it finds untrusted. The re-reads
    // below are the ones that run NO event-handler retirement (R3 / R5 already
    // cover Update password, Delete and Add Key on this tab): the load-error
    // Retry and the list read the component re-runs when the page re-renders
    // it with a new `currentKeyId` (router.refresh after another tab re-links).

    /** Re-render the card as a router refresh would, which re-runs its list read. */
    function refreshWith(
      utils: ReturnType<typeof render>,
      currentKeyId: string | null,
    ) {
      utils.rerender(
        <ApiKeyManager strategyId="strat-1" currentKeyId={currentKeyId} />,
      );
    }

    it("CROSS-TAB-HEAL: a success retired beside a failed sign-in is not re-shown when a Retry re-read finds the key fixed in another tab", async () => {
      routeFetch();
      const healthy = row({ id: "key-k", label: "Key K", sync_status: "complete" });
      const utils = await renderRows([healthy], "key-k");
      await resync("key-k");

      // The terminal re-read shows K's sign-in failed: the success is retired.
      selectResultMock.mockReturnValueOnce({
        data: [row({ id: "key-k", label: "Key K", sync_status: "sign_in_failed" })],
        error: null,
      });
      await finish("complete");
      await waitFor(() => {
        expect(
          within(card("key-k")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "sign_in_failed");
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
      expect(cardButton("key-k", "Resync")).toBeEnabled();

      // A refresh's list read fails, which is what puts a Retry on screen.
      selectResultMock.mockReturnValueOnce({
        data: null,
        error: { message: "network error" },
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await act(async () => {
          refreshWith(utils, null);
        });
        await waitFor(() => {
          expect(screen.getByText(/Couldn't load your API keys/i)).toBeInTheDocument();
        });
      } finally {
        consoleError.mockRestore();
      }

      // Another tab fixed K's password: the Retry reads K as idle.
      selectResultMock.mockReturnValue({
        data: [row({ id: "key-k", label: "Key K", sync_status: "idle" })],
        error: null,
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      });
      // FIRST: the heal landed (K's pill cleared, the banner went) ...
      await waitFor(() => {
        expect(
          within(card("key-k")).queryByTestId("allocator-sync-pill"),
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByText(/Couldn't load your API keys/i)).not.toBeInTheDocument();
      // ... THEN: the retired success is not resurrected.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("CROSS-TAB-DELETE: a success retired beside a revoked key is not re-shown when a later re-read no longer contains the key", async () => {
      routeFetch();
      const k = row({
        id: "key-k",
        exchange: "binance",
        label: "Key K",
        sync_status: "complete",
        venue_account_id: null,
      });
      const other = row({ id: "key-o", label: "Other MT5", sync_status: "complete" });
      const utils = await renderRows([k, other], "key-k");
      await resync("key-k");

      selectResultMock.mockReturnValueOnce({
        data: [{ ...k, sync_status: "revoked" }, other],
        error: null,
      });
      await finish("complete");
      await waitFor(() => {
        expect(
          within(card("key-k")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "revoked");
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      // Another tab deleted K; the refresh's list read no longer holds it.
      selectResultMock.mockReturnValue({ data: [other], error: null });
      await act(async () => {
        refreshWith(utils, null);
      });
      // FIRST: the row left ...
      await waitFor(() => {
        expect(screen.queryByTestId("api-key-card-key-k")).not.toBeInTheDocument();
      });
      // ... THEN: a missing subject row does not re-show the retired success.
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("LATER-UNTRUST: a success shown for a healthy key is retired when a later re-read shows the key revoked, and a heal after that does not re-show it", async () => {
      routeFetch();
      const k = row({
        id: "key-k",
        exchange: "binance",
        label: "Key K",
        sync_status: "complete",
        venue_account_id: null,
      });
      const utils = await renderRows([k], "key-k");
      await resync("key-k");
      await finish("complete");
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "complete",
      );

      // A later applied read shows K revoked: the success is retired then.
      selectResultMock.mockReturnValue({
        data: [{ ...k, sync_status: "revoked" }],
        error: null,
      });
      await act(async () => {
        refreshWith(utils, null);
      });
      await waitFor(() => {
        expect(
          within(card("key-k")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "revoked");
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      // A further read shows K healthy again: nothing brings the success back.
      selectResultMock.mockReturnValue({ data: [k], error: null });
      await act(async () => {
        refreshWith(utils, "key-k");
      });
      await waitFor(() => {
        expect(
          within(card("key-k")).queryByTestId("allocator-sync-pill"),
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("DROPPED-READ-SUBJECT: a terminal re-read dropped as out of date (WR-04) is judged by the NEWER applied read's subject status", async () => {
      routeFetch();
      const healthy = row({ id: "key-k", label: "Key K", sync_status: "complete" });
      const utils = await renderRows([healthy], "key-k");
      await resync("key-k");

      // The terminal re-read is held open ...
      const reread = deferred<unknown>();
      selectResultMock.mockReturnValueOnce(reread.promise);
      await act(async () => {
        capturedOnStatusChange!("complete");
      });
      // ... while a NEWER read (a refresh) applies, showing K's sign-in failed.
      selectResultMock.mockReturnValueOnce({
        data: [row({ id: "key-k", label: "Key K", sync_status: "sign_in_failed" })],
        error: null,
      });
      const reads = selectResultMock.mock.calls.length;
      await act(async () => {
        refreshWith(utils, "key-k-relinked");
      });
      await waitFor(() => {
        expect(selectResultMock.mock.calls.length).toBeGreaterThan(reads);
      });
      // The newer read applied while the attempt still holds its marker, so
      // the card shows R1's neutral in-flight pill over K's stored status.
      await waitFor(() => {
        expect(
          within(card("key-k")).getByTestId("allocator-sync-pill"),
        ).toHaveAttribute("data-sync-status", "syncing");
      });

      // The stale terminal re-read lands with the healthy snapshot and is
      // dropped; the arm must answer with the APPLIED read's subject status.
      await act(async () => {
        reread.resolve({ data: [healthy], error: null });
      });
      await waitFor(() => {
        expect(cardButton("key-k", "Use & Sync")).toBeEnabled();
      });
      expect(
        within(card("key-k")).getByTestId("allocator-sync-pill"),
      ).toHaveAttribute("data-sync-status", "sign_in_failed");
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      // A heal read afterwards cannot bring the success back.
      selectResultMock.mockReturnValue({ data: [healthy], error: null });
      await act(async () => {
        refreshWith(utils, "key-k");
      });
      await waitFor(() => {
        expect(
          within(card("key-k")).queryByTestId("allocator-sync-pill"),
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
    });

    it("IN-FLIGHT-UNTOUCHED: an applied read showing the subject untrusted while the panel is computing leaves computing and the marker alone", async () => {
      routeFetch();
      const k = row({ id: "key-k", label: "Key K", sync_status: "complete" });
      const utils = await renderRows([k], "key-k");
      await resync("key-k");

      selectResultMock.mockReturnValue({
        data: [{ ...k, sync_status: "sign_in_failed" }],
        error: null,
      });
      const reads = selectResultMock.mock.calls.length;
      await act(async () => {
        refreshWith(utils, "key-k-relinked");
      });
      await waitFor(() => {
        expect(selectResultMock.mock.calls.length).toBeGreaterThan(reads);
      });
      await act(async () => {});

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
      // The marker holds: K's own controls stay in flight.
      expect(cardButton("key-k", "Syncing…")).toBeDisabled();
      expect(cardButton("key-k", "Update password")).toBeDisabled();
    });

    // ── A throwing terminal re-read (SFH2-LOW-1 / IN-04) ────────────────────

    it("a terminal re-read that THROWS ends the attempt with the success withheld and the load error shown, and is logged with context (SFH2-LOW-1)", async () => {
      routeFetch();
      await renderRows(
        [row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })],
        "key-h",
      );
      await resync("key-h");

      selectResultMock.mockImplementationOnce(() => {
        throw new Error("socket hang up");
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await act(async () => {
          capturedOnStatusChange!("complete");
        });
        await waitFor(() => {
          expect(
            screen.getByText(/Couldn't load your API keys/i),
          ).toBeInTheDocument();
        });
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining("[ApiKeyManager] the terminal re-read threw"),
          expect.any(Error),
        );
        // 167.2-REVIEW-SFH M-6: captured too, tags only.
        expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
          tags: { component: "ApiKeyManager", stage: "terminal-reread" },
        });
      } finally {
        consoleError.mockRestore();
      }
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();
      expect(cardButton("key-h", "Resync")).toBeEnabled();
      expect(cardButton("key-h", "Update password")).toBeEnabled();
    });

    // ── Ended attempts, and registration before any await (IN-02) ───────────

    it("an ENDED attempt's late failure never writes the panel or the marker of the NEWER attempt that followed it (IN-02)", async () => {
      routeFetch();
      await renderRows(
        [row({ id: "key-h", label: "Healthy MT5", sync_status: "complete" })],
        "key-h",
      );

      // Attempt A: its post-enqueue re-read is held open and will THROW.
      let failLateRead!: (err: Error) => void;
      const lateRead = new Promise((_resolve, reject) => {
        failLateRead = reject;
      });
      selectResultMock.mockReturnValueOnce(lateRead);
      await resync("key-h");
      // A's terminal arrives and ends A.
      await finish("complete");
      expect(cardButton("key-h", "Resync")).toBeEnabled();

      // Attempt B starts on the same key.
      await resync("key-h");
      expect(cardButton("key-h", "Syncing…")).toBeDisabled();

      // A's late re-read now throws. Moved by the 167.2 review fix round
      // (167.2-REVIEW-SFH L-4, lineage): the post-enqueue re-read has its own
      // catch now, so the throw is logged there instead of reaching the
      // attempt's catch as "sync failed after its attempt ended". What this
      // case pins is unchanged: B is untouched.
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await act(async () => {
          failLateRead(new Error("late read failed"));
        });
        await waitFor(() => {
          expect(err).toHaveBeenCalledWith(
            "[ApiKeyManager] the post-enqueue key-list re-read threw; the attempt keeps running:",
            expect.any(Error),
          );
        });
      } finally {
        err.mockRestore();
      }

      // B is untouched: still computing, still marked, no error written.
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "computing",
      );
      expect(screen.getByTestId("sync-progress").textContent).toBe("");
      expect(cardButton("key-h", "Syncing…")).toBeDisabled();
      expect(cardButton("key-h", "Update password")).toBeDisabled();
      expect(screen.queryByText("late read failed")).not.toBeInTheDocument();
    });

    it("a Resync cannot start while an add's validate is pending (P7), and the post-add attempt is live from the CLICK (IN-02, moved by KCS-01)", async () => {
      // Lineage: "the attempt is live from the CLICK: a post-add failure
      // landing while the attempt's own link write is pending does not touch
      // its panel (IN-02)". KCS-01 made the post-add sync the tracked attempt,
      // so its premise (an untracked post-add failure beside a live attempt)
      // cannot occur. It now pins both halves of the prevention: (1) P7, while
      // the add's validate is pending every Resync and Use & Sync is disabled
      // and a click links nothing and sends nothing; (2) IN-02's rule from the
      // other side, the add's own attempt holds the slot from the moment it is
      // registered, with its link write still pending.
      const validate = deferred<Response>();
      const fetchMock = routeFetch({ validate: () => validate.promise });
      const current = row({ id: "key-j", label: "Key J" });
      const other = row({ id: "key-k", label: "Key K" });
      await renderRows([current, other], "key-j", "binance");

      selectResultMock.mockReturnValue({ data: [newRow(), current, other], error: null });
      await addKey();
      expect(screen.getByRole("button", { name: "Validating..." })).toBeDisabled();

      // (1) P7: every key's sync control is disabled while the add is in flight.
      expect(cardButton("key-j", "Resync")).toBeDisabled();
      expect(cardButton("key-k", "Use & Sync")).toBeDisabled();
      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
        fireEvent.click(cardButton("key-k", "Use & Sync"));
      });
      expect(strategiesUpdateMock).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync")).toBe(false);
      expect(screen.queryByTestId("sync-progress")).not.toBeInTheDocument();

      // (2) The validate answers; the new key's LINK write is held.
      const newLink = deferred<{ error: null }>();
      strategiesUpdateMock.mockReturnValueOnce(newLink.promise);
      await act(async () => {
        validate.resolve(
          new Response(
            JSON.stringify({ api_key_id: "key-new", valid: true, read_only: true }),
            { status: 200, headers: JSON_HEADERS },
          ),
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId("api-key-card-key-new")).toBeInTheDocument();
      });

      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "syncing",
      );
      expect(cardButton("key-new", "Syncing…")).toBeDisabled();
      expect(cardButton("key-j", "Resync")).toBeDisabled();
      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
      });
      // Only the add's own link was attempted; J was never linked.
      expect(strategiesUpdateMock).toHaveBeenCalledTimes(1);
      expect(strategiesUpdateMock.mock.calls[0][0]).toEqual({
        table: "strategies",
        vals: { api_key_id: "key-new" },
      });
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/keys/sync")).toBe(false);

      await act(async () => {
        newLink.resolve({ error: null });
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "computing",
        );
      });
      expect(
        fetchMock.mock.calls.filter((c) => c[0] === "/api/keys/sync"),
      ).toHaveLength(1);
      expect(cardButton("key-new", "Syncing…")).toBeDisabled();
    });

    it("P7 handler guard: the panel's Retry starts no attempt while an add's validate is pending", async () => {
      // The disabled Resync / Use & Sync buttons are the first line. The
      // panel's Retry reaches `handleSyncTrades` through no card button, so
      // this pins the handler guard behind them (a ref, because `loading` is
      // async state: the NEW-C37-02 lesson).
      const validate = deferred<Response>();
      let syncCalls = 0;
      const fetchMock = routeFetch({
        validate: () => validate.promise,
        sync: () => {
          syncCalls += 1;
          return syncCalls === 1 ? syncRefused("Sync could not start") : syncAccepted();
        },
      });
      const current = row({ id: "key-j", label: "Key J" });
      await renderRows([current], "key-j", "binance");

      // J's own sync fails, so the panel shows its error and its Retry.
      await act(async () => {
        fireEvent.click(cardButton("key-j", "Resync"));
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "error",
        );
      });
      const linksBefore = strategiesUpdateMock.mock.calls.length;
      const syncsBefore = syncCalls;

      selectResultMock.mockReturnValue({ data: [newRow(), current], error: null });
      await addKey();
      expect(screen.getByRole("button", { name: "Validating..." })).toBeDisabled();

      await act(async () => {
        capturedOnRetry!();
      });
      // No attempt registered: nothing linked, nothing sent, panel unchanged.
      expect(strategiesUpdateMock.mock.calls.length).toBe(linksBefore);
      expect(syncCalls).toBe(syncsBefore);
      expect(screen.getByTestId("sync-progress")).toHaveAttribute(
        "data-sync-status",
        "error",
      );

      // The add then runs its own attempt, for the new key.
      await act(async () => {
        validate.resolve(
          new Response(
            JSON.stringify({ api_key_id: "key-new", valid: true, read_only: true }),
            { status: 200, headers: JSON_HEADERS },
          ),
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId("sync-progress")).toHaveAttribute(
          "data-sync-status",
          "computing",
        );
      });
      expect(strategiesUpdateMock.mock.calls.at(-1)![0]).toEqual({
        table: "strategies",
        vals: { api_key_id: "key-new" },
      });
      expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/keys/sync")).toHaveLength(2);
    });
  });
});

/**
 * Phase 167.2 / KCS-23 — a COMPOSITE strategy's key card offers no control that
 * rewrites `strategies.api_key_id`.
 *
 * WHY. `handleLinkKey` writes `strategies.api_key_id` unconditionally, and both
 * `Use & Sync` / `Resync` (through `handleSyncTrades`) and `Add Key` (through
 * the post-add tracked attempt) reach it. On a composite that write silently
 * re-links the strategy to ONE key, turning it into a single-key strategy: a
 * data-integrity defect with nothing on screen to say it happened. The oracle
 * is `strategiesUpdateMock`, which records every `strategies.update` payload;
 * a composite card must never make it fire.
 *
 * An "unknown" shape (the page could not read the member count) fails closed on
 * the same link controls, but NOT on the remedy controls: the /strategies
 * "Sign-in failed" pill links to this page for `Update password` and `Delete`.
 *
 * Oracles are hand-typed, never imported from key-card-copy.ts.
 */
describe("ApiKeyManager — KCS-23 composite key card", () => {
  const COMPOSITE_NOTE_ORACLE =
    "This composite strategy reads from every key below. Keys are not linked or synced from this card: contact support@quantalyze.com to change which keys it uses or to re-run its computation.";
  const EMPTY_COPY_ORACLE =
    "No API keys connected. Add a read-only exchange key to import your trading data.";
  // 167.2-REVIEW-SFH H-2: hand-typed from the UI-SPEC review-fix rows.
  const EMPTY_NOLINK_ORACLE = "No API keys connected.";
  const SHAPE_UNKNOWN_ORACLE =
    "We could not confirm whether this strategy is a composite, so keys are not linked or synced from this card. Contact support@quantalyze.com to link a key or start a sync.";

  function keyRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "key-synthetic-a",
      user_id: "user-a",
      exchange: "binance",
      label: "Synthetic Key A",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-04-19T11:58:00Z",
      account_balance_usdt: 1000,
      created_at: "2026-01-01T00:00:00Z",
      sync_error: null,
      last_429_at: null,
      disconnected_at: null,
      venue_account_id: null,
      ...overrides,
    };
  }

  const threeKeys = () => [
    keyRow({ id: "key-synthetic-a", label: "Synthetic Key A" }),
    keyRow({ id: "key-synthetic-b", label: "Synthetic Key B", exchange: "okx" }),
    keyRow({
      id: "key-synthetic-m",
      label: "Synthetic MT5",
      exchange: "mt5",
      venue_account_id: "synth5678",
    }),
  ];

  async function renderCard(
    rows: ReturnType<typeof keyRow>[],
    keyShape?: "single" | "composite" | "unknown",
    currentKeyId: string | null = null,
    // 167.2-REVIEW CR-02: the composite's member key ids, as the edit page
    // reads them. Defaults to every row, so the cases below that predate the
    // member filter keep rendering the keys they assert on.
    compositeMemberKeyIds: string[] = rows.map((r) => r.id as string),
  ) {
    selectResultMock.mockReturnValue({ data: rows, error: null });
    await act(async () => {
      render(
        <ApiKeyManager
          strategyId="strat-composite-1"
          currentKeyId={currentKeyId}
          {...(keyShape ? { keyShape } : {})}
          {...(keyShape === "composite" ? { compositeMemberKeyIds } : {})}
        />,
      );
    });
    if (rows.length > 0) {
      await waitFor(() => {
        expect(screen.getByText(rows[0].label as string)).toBeInTheDocument();
      });
    } else {
      await waitFor(() => {
        // Either empty copy (H-2: a card with no Add Key says the first
        // sentence only); each case asserts which one it expects.
        expect(screen.getByText(/^No API keys connected\./)).toBeInTheDocument();
      });
    }
  }

  const LINK_BUTTON_NAMES = [/^Resync$/, /^Use & Sync$/, /Add Key/];

  function expectNoLinkControls() {
    for (const name of LINK_BUTTON_NAMES) {
      expect(screen.queryAllByRole("button", { name })).toHaveLength(0);
    }
    // No Add Key form either (its submit is Connect Key).
    expect(screen.queryByRole("button", { name: "Connect Key" })).not.toBeInTheDocument();
  }

  beforeEach(() => {
    routerRefreshMock.mockReset();
    selectResultMock.mockReset();
    strategiesUpdateMock.mockReset();
    capturedOnStatusChange = null;
    capturedOnRetry = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("COMPOSITE-NO-LINK: a composite card with three keys shows no Resync, Use & Sync or Add Key, keeps Update password and Delete, and never writes api_key_id", async () => {
    // Even with one key matching currentKeyId (a composite whose legacy
    // api_key_id still points at a member), no Resync is offered.
    await renderCard(threeKeys(), "composite", "key-synthetic-a");

    expectNoLinkControls();
    for (const id of ["key-synthetic-a", "key-synthetic-b", "key-synthetic-m"]) {
      const card = screen.getByTestId(`api-key-card-${id}`);
      expect(within(card).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    }
    expect(
      within(screen.getByTestId("api-key-card-key-synthetic-m")).getByRole("button", {
        name: "Update password",
      }),
    ).toBeInTheDocument();
    // The MT5 account line and the key's own identity are unchanged.
    expect(screen.getByText("MT5 account synth5678")).toBeInTheDocument();
    expect(strategiesUpdateMock).not.toHaveBeenCalled();
  });

  it("COMPOSITE-NOTE: the one line under the header is KCS23-COMPOSITE, character for character", async () => {
    await renderCard(threeKeys(), "composite");

    const note = screen.getByText(/^This composite strategy reads from every key below\./);
    expect(note.tagName).toBe("P");
    expect(note.textContent).toBe(COMPOSITE_NOTE_ORACLE);
    expect(note).toHaveClass("text-xs", "text-text-muted");
    // Directly under the header row, above every key card.
    const header = screen.getByRole("heading", { name: "Exchange API Keys" });
    expect(header.parentElement!.nextElementSibling).toBe(note);
    expect(screen.getAllByText(COMPOSITE_NOTE_ORACLE)).toHaveLength(1);
  });

  it("COMPOSITE-MEMBERS-ONLY (167.2-REVIEW CR-02): a composite card lists its member keys only, so KCS23-COMPOSITE is true of the list", async () => {
    // The owner has two keys; the composite reads from one of them. The note
    // says the composite "reads from every key below", so a non-member key
    // below it (with its own pill) would be a false claim about the composite.
    selectResultMock.mockReturnValue({
      data: [
        keyRow({ id: "key-synthetic-a", label: "Synthetic Member" }),
        keyRow({
          id: "key-synthetic-x",
          label: "Synthetic Other",
          sync_status: "sign_in_failed",
        }),
      ],
      error: null,
    });
    await act(async () => {
      render(
        <ApiKeyManager
          strategyId="strat-composite-1"
          currentKeyId={null}
          keyShape="composite"
          compositeMemberKeyIds={["key-synthetic-a"]}
        />,
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Synthetic Member")).toBeInTheDocument();
    });

    expect(screen.getByText(COMPOSITE_NOTE_ORACLE)).toBeInTheDocument();
    expect(screen.queryByText("Synthetic Other")).not.toBeInTheDocument();
    expect(screen.queryByTestId("api-key-card-key-synthetic-x")).not.toBeInTheDocument();
  });

  // Moved by 167.2-REVIEW-SFH H-2 (lineage): this pin expected the full empty
  // copy, whose second sentence ("Add a read-only exchange key …") invites an
  // action the card does not offer on a composite. A card with no link
  // controls now says only the first sentence.
  it("COMPOSITE-EMPTY: a composite with zero readable keys shows the no-link empty copy plus the note, and no Add Key", async () => {
    await renderCard([], "composite");

    expect(screen.getByText(EMPTY_NOLINK_ORACLE)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_COPY_ORACLE)).not.toBeInTheDocument();
    expect(screen.getByText(COMPOSITE_NOTE_ORACLE)).toBeInTheDocument();
    expectNoLinkControls();
    expect(strategiesUpdateMock).not.toHaveBeenCalled();
  });

  it("SHAPE-UNKNOWN-REMEDY: an unknown shape offers no link control and no composite note, but keeps the Sign-in failed pill, Update password and Delete", async () => {
    await renderCard(
      [
        keyRow({
          id: "key-synthetic-m",
          label: "Synthetic MT5",
          exchange: "mt5",
          sync_status: "sign_in_failed",
          venue_account_id: "synth5678",
        }),
      ],
      "unknown",
      "key-synthetic-m",
    );

    expectNoLinkControls();
    expect(screen.queryByText(/composite strategy/i)).not.toBeInTheDocument();

    const card = screen.getByTestId("api-key-card-key-synthetic-m");
    expect(within(card).getByTestId("allocator-sync-pill").textContent).toBe("Sign-in failed");
    expect(within(card).getByRole("button", { name: "Delete" })).toBeEnabled();
    const updatePassword = within(card).getByRole("button", { name: "Update password" });
    expect(updatePassword).toBeEnabled();

    // The remedy is reachable: Update password opens its form.
    await act(async () => {
      fireEvent.click(updatePassword);
    });
    const dialog = Array.from(document.querySelectorAll("dialog")).find((d) =>
      d.textContent?.includes("New password"),
    );
    expect(dialog).toBeTruthy();
    expect(dialog).toHaveAttribute("open");
    expect(strategiesUpdateMock).not.toHaveBeenCalled();
  });

  it("SHAPE-UNKNOWN-NOTE (167.2-REVIEW-SFH H-2): an unknown shape says why the sync controls are missing, directly under the header", async () => {
    await renderCard([keyRow({ id: "key-synthetic-a", label: "Synthetic Key A" })], "unknown");

    const note = screen.getByText(SHAPE_UNKNOWN_ORACLE);
    expect(note.tagName).toBe("P");
    expect(note).toHaveClass("text-xs", "text-text-muted");
    const header = screen.getByRole("heading", { name: "Exchange API Keys" });
    expect(header.parentElement!.nextElementSibling).toBe(note);
  });

  it("SHAPE-UNKNOWN-EMPTY (167.2-REVIEW-SFH H-2): with zero keys, an unknown shape never invites an Add Key it does not offer", async () => {
    selectResultMock.mockReturnValue({ data: [], error: null });
    await act(async () => {
      render(<ApiKeyManager strategyId="strat-composite-1" currentKeyId={null} keyShape="unknown" />);
    });
    await waitFor(() => {
      expect(screen.getByText(EMPTY_NOLINK_ORACLE)).toBeInTheDocument();
    });
    expect(screen.queryByText(EMPTY_COPY_ORACLE)).not.toBeInTheDocument();
    expect(screen.getByText(SHAPE_UNKNOWN_ORACLE)).toBeInTheDocument();
  });

  it.each([
    { label: "keyShape omitted", keyShape: undefined },
    { label: "keyShape \"single\"", keyShape: "single" as const },
  ])(
    "SINGLE-UNCHANGED ($label): Resync, Use & Sync and Add Key render as before, with no composite note",
    async ({ keyShape }) => {
      await renderCard(
        [
          keyRow({ id: "key-synthetic-a", label: "Synthetic Key A" }),
          keyRow({ id: "key-synthetic-b", label: "Synthetic Key B", exchange: "okx" }),
        ],
        keyShape,
        "key-synthetic-a",
      );

      expect(
        within(screen.getByTestId("api-key-card-key-synthetic-a")).getByRole("button", {
          name: "Resync",
        }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("api-key-card-key-synthetic-b")).getByRole("button", {
          name: "Use & Sync",
        }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add Key" })).toBeInTheDocument();
      expect(screen.queryByText(/composite strategy/i)).not.toBeInTheDocument();
      expect(screen.queryByText(SHAPE_UNKNOWN_ORACLE)).not.toBeInTheDocument();
    },
  );
});
