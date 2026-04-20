import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { AllocatorExchangeManager } from "./AllocatorExchangeManager";

/**
 * Phase 06 Plan 04 Task 2 — AllocatorExchangeManager extension tests.
 *
 * Verifies:
 *   - Sync now button replaces the disabled "Auto-synced" button and POSTs
 *     to /api/allocator/holdings/sync with { api_key_id } (INGEST-06 / D-10).
 *   - Optimistic sync_status='syncing' on click (pill flips immediately).
 *   - 4xx response surfaces "Sync request failed" in aria-live helper line
 *     via helperOverride propagation to AllocatorSyncStatus.
 *   - f8: 200 { already_inflight: true, next_attempt_at } captures the
 *     timestamp into row state and renders "Queued — exchange cooldown,
 *     retry in {N}s" via AllocatorSyncStatus.
 *   - f4 LOCKED TEST: handleAddKey_shows_error_when_first_run_sync_fails_with_403
 *     — awaited first-run POST on 403 closes modal, reverts pill to idle,
 *     surfaces "Sync request failed" helper.
 *   - f4 happy path: handleAddKey on 200 success leaves pill at syncing
 *     without helperOverride set.
 *   - D-11 polling: setInterval(router.refresh, 5000) only active while any
 *     row is syncing.
 *   - Landmine 8: initialKeys prop changes propagate to local state via
 *     useEffect but client-only fields (queued_next_attempt_at,
 *     helper_override) carry over for matching ids.
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

// Supabase client mock. Tests override `insertMock` to simulate success vs.
// error on the `api_keys` table insert. `.select(...).single()` returns the
// inserted row by default.
const insertMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => getUserMock(),
    },
    from: (_table: string) => ({
      insert: (row: unknown) => {
        const result = insertMock(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                result ?? { data: null, error: { message: "no insertMock" } },
              ),
          }),
        };
      },
    }),
  }),
}));

// Polyfill jsdom's missing HTMLDialogElement methods so the <Modal> component
// can open/close without throwing. Native <dialog> isn't implemented in jsdom.
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

// Shared fixture row — deliberately includes ALL ExchangeConnection fields the
// manager can read (sync_error / queued_next_attempt_at / helper_override are
// optional in the initial prop but the manager's merge effect defaults them).
function makeKey(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "key-binance-1",
    exchange: "binance",
    label: "Primary Binance",
    is_active: true,
    sync_status: "complete" as string | null,
    last_sync_at: new Date("2026-04-19T11:58:00Z").toISOString(),
    account_balance_usdt: 12_345,
    created_at: "2026-04-01T00:00:00Z",
    sync_error: null,
    last_429_at: null as string | null,
    ...overrides,
  };
}

describe("AllocatorExchangeManager — Sync now button wires POST to /api/allocator/holdings/sync", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerRefreshMock.mockReset();
    insertMock.mockReset();
    getUserMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders AllocatorSyncStatus pill + Sync now button per row (not the stale Auto-synced button)", () => {
    render(<AllocatorExchangeManager initialKeys={[makeKey()]} />);
    expect(screen.getByTestId("allocator-sync-pill")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sync binance now/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Auto-synced")).not.toBeInTheDocument();
  });

  it("clicking Sync now POSTs to /api/allocator/holdings/sync with { api_key_id }", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, job_id: "job-1" }),
    });
    render(<AllocatorExchangeManager initialKeys={[makeKey()]} />);
    const btn = screen.getByRole("button", { name: /Sync binance now/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/allocator/holdings/sync",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key_id: "key-binance-1" }),
      }),
    );
  });

  it("Sync now button is disabled while sync_status === 'syncing'", () => {
    render(
      <AllocatorExchangeManager
        initialKeys={[makeKey({ sync_status: "syncing" })]}
      />,
    );
    const btn = screen.getByRole("button", { name: /Sync binance now/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Sync in progress");
  });

  it("handleSync optimistically flips pill to Syncing before the fetch resolves", async () => {
    let resolveFetch!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolveFetch = r;
    });
    fetchMock.mockReturnValueOnce(pending);
    render(<AllocatorExchangeManager initialKeys={[makeKey()]} />);
    // Initially 'complete' pill.
    expect(screen.getByTestId("allocator-sync-pill").textContent).toContain(
      "Synced",
    );
    const btn = screen.getByRole("button", { name: /Sync binance now/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    // Before fetch resolves, the pill must already read Syncing…
    expect(screen.getByTestId("allocator-sync-pill").textContent).toContain(
      "Syncing\u2026",
    );
    // Clean up the pending promise so React doesn't warn.
    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, job_id: "job-1" }),
      });
    });
  });

  it("handleSync surfaces 'Sync request failed' helper_override on 4xx response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    render(<AllocatorExchangeManager initialKeys={[makeKey()]} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Sync binance now/i }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("allocator-sync-helper").textContent,
      ).toContain("Sync request failed");
    });
  });

  it("handleSync on network error (rejected fetch) surfaces 'Sync request failed' helper_override", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<AllocatorExchangeManager initialKeys={[makeKey()]} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Sync binance now/i }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("allocator-sync-helper").textContent,
      ).toContain("Sync request failed");
    });
  });

  it("f8: handleSync captures next_attempt_at from 200 already_inflight and renders Queued helper", async () => {
    // Anchor wall-clock for deterministic seconds-until math — but DON'T fake
    // setTimeout here because the manager awaits fetch() + AllocatorSyncStatus
    // reads Date.now() directly on render. Faking setTimeout would block
    // waitFor's polling.
    const nextAttemptAt = new Date(Date.now() + 90_000).toISOString();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        already_inflight: true,
        next_attempt_at: nextAttemptAt,
      }),
    });
    render(<AllocatorExchangeManager initialKeys={[makeKey()]} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Sync binance now/i }),
      );
    });
    // Pill stays at syncing (the server confirms already in-flight).
    expect(screen.getByTestId("allocator-sync-pill").textContent).toContain(
      "Syncing\u2026",
    );
    // Queued helper surfaces with the U+2014 em-dash. Allow ±3s drift for
    // the microtask latency between fetch resolve and the next render.
    await waitFor(() => {
      const helper = screen.getByTestId("allocator-sync-helper").textContent;
      expect(helper).toMatch(
        /Queued \u2014 exchange cooldown, retry in (86|87|88|89|90|91|92)s/,
      );
    });
  });
});

describe("AllocatorExchangeManager — handleAddKey first-run awaited sync (f4)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerRefreshMock.mockReset();
    insertMock.mockReset();
    getUserMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    getUserMock.mockResolvedValue({
      data: { user: { id: "user-a" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function submitAddKeyForm() {
    // Click "+ Connect exchange" to open the modal.
    fireEvent.click(
      screen.getByRole("button", { name: /\+ Connect exchange/i }),
    );
    // Fill out required form fields. The ApiKeyForm is shared with strategy
    // side; it calls onSubmit when the user clicks "Connect".
    const labelInput = screen.getByLabelText(/Label/i);
    const keyInput = screen.getByLabelText(/API Key$/i);
    const secretInput = screen.getByLabelText(/API Secret/i);
    fireEvent.change(labelInput, { target: { value: "Test Key" } });
    fireEvent.change(keyInput, { target: { value: "test-key" } });
    fireEvent.change(secretInput, { target: { value: "test-secret" } });
    // Submit the form. ApiKeyForm's submit button text may vary — find by type.
    const form = labelInput.closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });
  }

  it("handleAddKey awaits POST and on 200 success leaves new row at sync_status='syncing' with no error helper", async () => {
    // First fetch: validate-and-encrypt → 200. Second fetch: first-run sync → 200.
    fetchMock.mockImplementation((url: string) => {
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
      if (url === "/api/allocator/holdings/sync") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, job_id: "job-1" }),
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    insertMock.mockReturnValue({
      data: makeKey({ id: "new-key", sync_status: "idle" }),
      error: null,
    });

    render(<AllocatorExchangeManager initialKeys={[]} />);
    await submitAddKeyForm();

    // Row appears with syncing pill.
    await waitFor(() => {
      expect(
        screen.getByTestId("allocator-sync-pill").textContent,
      ).toContain("Syncing\u2026");
    });
    // No error helper surfaced on the happy path.
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).not.toContain("Sync request failed");
  });

  it("handleAddKey_shows_error_when_first_run_sync_fails_with_403", async () => {
    // First fetch: validate-and-encrypt → 200. Second fetch: first-run sync → 403.
    fetchMock.mockImplementation((url: string) => {
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
      if (url === "/api/allocator/holdings/sync") {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({
            error: "API key not found or not owned by you",
          }),
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    insertMock.mockReturnValue({
      data: makeKey({ id: "new-key-403", sync_status: "idle" }),
      error: null,
    });

    render(<AllocatorExchangeManager initialKeys={[]} />);
    await submitAddKeyForm();

    // (a) Modal is closed — "Connect Exchange API Key" form heading gone.
    await waitFor(() => {
      expect(
        screen.queryByText("Connect Exchange API Key"),
      ).not.toBeInTheDocument();
    });
    // (b) New row's pill reverted to 'Idle' — NOT stuck at Syncing…
    await waitFor(() => {
      const pill = screen.getByTestId("allocator-sync-pill");
      expect(pill.textContent).toBe("Idle");
    });
    // (c) Row's helper line contains 'Sync request failed'.
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).toContain("Sync request failed");
  });
});

describe("AllocatorExchangeManager — 5s polling (D-11)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    routerRefreshMock.mockReset();
    insertMock.mockReset();
    getUserMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("setInterval fires router.refresh every 5s when any row is syncing", () => {
    render(
      <AllocatorExchangeManager
        initialKeys={[makeKey({ sync_status: "syncing" })]}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(2);
  });

  // ISSUE-005 regression: the poll used to be gated on hasSyncing, so a
  // server-side transition (complete → revoked / rate_limited / error /
  // complete_with_warnings) was invisible until the user reloaded the tab.
  // These assertions prove the interval ticks for each of those states so
  // SC3's "≤5s flip" contract holds for the common case (worker silently
  // invalidates a key while the user is looking at /exchanges).
  it.each([
    ["complete"],
    ["revoked"],
    ["rate_limited"],
    ["error"],
    ["complete_with_warnings"],
    ["idle"],
  ])(
    "ISSUE-005: polling ticks every 5s even when sync_status is %s (non-syncing)",
    (syncStatus) => {
      render(
        <AllocatorExchangeManager
          initialKeys={[makeKey({ sync_status: syncStatus })]}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(routerRefreshMock).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(routerRefreshMock).toHaveBeenCalledTimes(2);
    },
  );

  it("interval is cleared on unmount", () => {
    const { unmount } = render(
      <AllocatorExchangeManager
        initialKeys={[makeKey({ sync_status: "syncing" })]}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Should still be 1 — no extra ticks after unmount.
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });
});

// ISSUE-006 regression: rate_limited pill used to render "retry in 0s"
// because the client had no way to compute the cooldown countdown.
// Migration 068 grants SELECT (last_429_at); constants.ts adds it to
// API_KEY_USER_COLUMNS_ARR; allocator-cooldowns.ts holds the per-exchange
// EXCHANGE_COOLDOWN_SECONDS map. These tests exercise the wiring.
describe("AllocatorExchangeManager — rate_limited retry countdown (ISSUE-006)", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    insertMock.mockReset();
    getUserMock.mockReset();
  });

  it("okx + last_429_at 35s ago renders pill 'retry in ~265s' (cooldown 300s)", () => {
    const last429At = new Date(Date.now() - 35_000).toISOString();
    render(
      <AllocatorExchangeManager
        initialKeys={[
          makeKey({
            id: "key-okx-rate",
            exchange: "okx",
            sync_status: "rate_limited",
            last_429_at: last429At,
          }),
        ]}
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill").textContent ?? "";
    // Tolerate ±3s for render-latency drift.
    expect(pill).toMatch(
      /Rate limited \u2014 retry in (262|263|264|265|266|267|268)s/,
    );
    // Pre-fix, the pill rendered "retry in 0s" regardless of last_429_at.
    expect(pill).not.toMatch(/retry in 0s/);
  });

  it("binance + last_429_at 10s ago renders pill 'retry in ~110s' (cooldown 120s)", () => {
    const last429At = new Date(Date.now() - 10_000).toISOString();
    render(
      <AllocatorExchangeManager
        initialKeys={[
          makeKey({
            id: "key-binance-rate",
            exchange: "binance",
            sync_status: "rate_limited",
            last_429_at: last429At,
          }),
        ]}
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill").textContent ?? "";
    expect(pill).toMatch(
      /Rate limited \u2014 retry in (107|108|109|110|111|112|113)s/,
    );
  });

  it("rate_limited with no last_429_at falls back to 'retry in 0s' (no data)", () => {
    render(
      <AllocatorExchangeManager
        initialKeys={[
          makeKey({
            id: "key-null-429",
            exchange: "okx",
            sync_status: "rate_limited",
            last_429_at: null,
          }),
        ]}
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill").textContent ?? "";
    expect(pill).toContain("retry in 0s");
  });

  it("elapsed cooldown (last_429_at >300s ago for okx) clamps to 0s", () => {
    const last429At = new Date(Date.now() - 400_000).toISOString();
    render(
      <AllocatorExchangeManager
        initialKeys={[
          makeKey({
            id: "key-expired",
            exchange: "okx",
            sync_status: "rate_limited",
            last_429_at: last429At,
          }),
        ]}
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill").textContent ?? "";
    expect(pill).toContain("retry in 0s");
  });
});

describe("AllocatorExchangeManager — initialKeys prop→state merge (Landmine 8)", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    insertMock.mockReset();
    getUserMock.mockReset();
  });

  it("re-rendering with new initialKeys propagates updated sync_status to the pill", () => {
    const { rerender } = render(
      <AllocatorExchangeManager
        initialKeys={[makeKey({ sync_status: "syncing" })]}
      />,
    );
    expect(screen.getByTestId("allocator-sync-pill").textContent).toContain(
      "Syncing\u2026",
    );
    rerender(
      <AllocatorExchangeManager
        initialKeys={[makeKey({ sync_status: "complete" })]}
      />,
    );
    // Landmine 8: without the initialKeys useEffect, this would stay stuck at "Syncing…".
    expect(screen.getByTestId("allocator-sync-pill").textContent).toContain(
      "Synced",
    );
  });
});
