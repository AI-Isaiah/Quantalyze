/** @vitest-environment jsdom */
/**
 * Phase 167 / 167-06 fix round 2 — `ApiKeyManager` driven by the REAL
 * `SyncProgress` and the REAL `useStrategySyncPoller`, on fake timers.
 *
 * WHY THIS FILE EXISTS. `ApiKeyManager.test.tsx` mocks `./SyncProgress` for the
 * whole file and drives `onStatusChange` by hand. That harness cannot see the
 * poller's attempt budget, and 167-REVIEW-06-R2 CR-01 (and the silent-failure
 * round's SFH2-HIGH-1) lived exactly there: the budget was local to the poll
 * effect, the effect spanned `syncing` and `computing`, so a slow enqueue spent
 * it before its job existed, and the first tick after a SUCCESSFUL enqueue ended
 * the attempt with the timeout copy having read the new job zero times.
 *
 * What these cases pin, against the real poll loop:
 *   - no analytics read happens before the attempt's own enqueue has answered;
 *   - after a slow-but-successful enqueue (longer than the 30 s missing-row
 *     grace, and longer than the 120 s cap) the poll reads the new job at least
 *     once and the panel does NOT show the timeout copy;
 *   - CONTROLS, so the absences above can fail: the fresh post-enqueue budget
 *     still escalates at its own grace boundary, and a post-enqueue terminal
 *     read still ends the attempt;
 *   - a terminal re-read that never settles is bounded (SFH2-MED-1 / IN-01).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, cleanup, within } from "@testing-library/react";
import { ApiKeyManager } from "./ApiKeyManager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Supabase client mock, dispatched on table and chain shape.
//   api_keys.select(...).order(...)        → the key list (`loadKeys`)
//   api_keys.select(...).eq(...).single()  → the exchange name (SyncProgress)
//   strategies.select(...).eq(...).single()→ the linked key id (SyncProgress)
//   strategies.update(...).eq(...)         → the link write (`handleLinkKey`)
//   strategy_analytics.select(...).eq(...).single() → THE POLL, counted
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  analyticsResult: { data: null, error: null } as { data: unknown; error: unknown },
  analyticsSelectCount: 0,
  keysRows: [] as unknown[],
  /** When true, the NEXT key-list read never settles (one-shot). */
  hangNextKeysRead: false,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        order: () => {
          if (mockState.hangNextKeysRead) {
            mockState.hangNextKeysRead = false;
            return new Promise(() => {});
          }
          return Promise.resolve({ data: mockState.keysRows, error: null });
        },
        eq: () => ({
          single: () => {
            if (table === "strategies") {
              return Promise.resolve({ data: { api_key_id: "key-h" }, error: null });
            }
            if (table === "api_keys") {
              return Promise.resolve({ data: { exchange: "binance" }, error: null });
            }
            mockState.analyticsSelectCount += 1;
            return Promise.resolve(mockState.analyticsResult);
          },
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  }),
}));

// --- Helpers ---------------------------------------------------------------

const POLL_MS = 3000;
// Hand-typed, never imported: the copy `handleSyncStatusChange` fills in when
// the poller escalates without a message of its own.
const TIMEOUT_COPY = "Analytics computation timed out. Please retry or contact support.";

function healthyRow() {
  return {
    id: "key-h",
    user_id: "user-a",
    exchange: "binance",
    label: "Healthy Binance",
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

function analyticsRow(status: string) {
  return {
    data: { computation_status: status, computation_error: null, computed_at: null },
    error: null,
  };
}

/**
 * The route's 202, as a plain object. A real `Response` body is read through
 * streams, which is not something a fake-timer case should depend on; the
 * component reads only `ok` and `json()` on this path.
 */
function accepted() {
  return {
    ok: true,
    status: 202,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ ok: true, accepted: true, status: "syncing", queued: true }),
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Advance fake timers inside act so poll promises and state updates settle. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Render one healthy current key, click its Resync, and hold the enqueue open. */
async function startResyncWithHeldEnqueue() {
  const enqueue = deferred<Response>();
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/keys/sync") return enqueue.promise;
    return Promise.resolve({
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({}),
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await act(async () => {
    render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-h" />);
  });
  await tick(0);
  expect(screen.getByText("Healthy Binance")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Resync" }));
  });
  await tick(0);
  return enqueue;
}

function panelShowsTimeout() {
  return (
    screen.queryByText("Sync failed") !== null ||
    screen.queryByText(TIMEOUT_COPY) !== null
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mockState.analyticsResult = { data: null, error: null };
  mockState.analyticsSelectCount = 0;
  mockState.keysRows = [healthyRow()];
  mockState.hangNextKeysRead = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ApiKeyManager + the REAL poller: the budget starts at the enqueue (167-REVIEW-06-R2 CR-01)", () => {
  it("no analytics row and a 36 s enqueue (past the 30 s grace): the poll reads the new job and does NOT time out", async () => {
    mockState.analyticsResult = { data: null, error: { code: "PGRST116" } };
    const enqueue = await startResyncWithHeldEnqueue();

    await tick(36_000);
    const readsBeforeEnqueue = mockState.analyticsSelectCount;

    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();

    // One poll interval after the 202.
    await tick(POLL_MS);
    expect(
      panelShowsTimeout(),
      "a successful enqueue was ended by a budget its pre-enqueue polls spent",
    ).toBe(false);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    // The new job WAS read after its enqueue ...
    expect(mockState.analyticsSelectCount - readsBeforeEnqueue).toBeGreaterThanOrEqual(1);
    // ... and nothing was read before it: such a read is the previous run's.
    expect(readsBeforeEnqueue).toBe(0);
    // The attempt still holds its marker.
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  });

  it("the previous run's computing row and a 126 s enqueue (past the 120 s cap): the poll reads the new job and does NOT time out", async () => {
    mockState.analyticsResult = analyticsRow("computing");
    const enqueue = await startResyncWithHeldEnqueue();

    await tick(126_000);
    const readsBeforeEnqueue = mockState.analyticsSelectCount;

    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    await tick(POLL_MS);
    expect(
      panelShowsTimeout(),
      "a successful enqueue was ended by a cap its pre-enqueue polls spent",
    ).toBe(false);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    expect(mockState.analyticsSelectCount - readsBeforeEnqueue).toBeGreaterThanOrEqual(1);
    expect(readsBeforeEnqueue).toBe(0);
  });

  it("CONTROL: the fresh post-enqueue budget still escalates at its OWN grace boundary (so the absence above can fail)", async () => {
    mockState.analyticsResult = { data: null, error: { code: "PGRST116" } };
    const enqueue = await startResyncWithHeldEnqueue();
    await tick(36_000);
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    // Polls 1..10 after the enqueue sit inside the grace window.
    await tick(POLL_MS * 10);
    expect(panelShowsTimeout()).toBe(false);

    // Poll 11 after the enqueue escalates: the panel shows the timeout copy,
    // and the attempt ends (Resync is usable again).
    await tick(POLL_MS);
    expect(screen.getByText("Sync failed")).toBeInTheDocument();
    expect(screen.getByText(TIMEOUT_COPY)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });

  it("CONTROL: a terminal read AFTER the enqueue still ends the attempt with its success", async () => {
    mockState.analyticsResult = analyticsRow("computing");
    const enqueue = await startResyncWithHeldEnqueue();
    await tick(36_000);
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    mockState.analyticsResult = analyticsRow("complete");
    await tick(POLL_MS);
    await tick(0);
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });
});

describe("ApiKeyManager + the REAL poller: a terminal re-read that never settles is bounded (SFH2-MED-1 / IN-01)", () => {
  it("after 15 s the attempt ends, the success stays withheld and the load error is shown", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.analyticsResult = analyticsRow("computing");
    const enqueue = await startResyncWithHeldEnqueue();
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    // The terminal arm's re-read is the next key-list read, and it hangs.
    mockState.hangNextKeysRead = true;
    mockState.analyticsResult = analyticsRow("complete");
    await tick(POLL_MS);

    // Settling: no success yet, the marker still held.
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    // Just inside the bound: still settling.
    await tick(14_000);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();

    // Past the bound: the attempt ends WITHOUT the success, and the list is
    // reported as unverified instead.
    await tick(1_000);
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
    expect(screen.queryByText("Computing analytics...")).not.toBeInTheDocument();
    expect(screen.getByText(/Couldn't load your API keys/i)).toBeInTheDocument();
    const keyCard = screen.getByTestId("api-key-card-key-h");
    expect(within(keyCard).getByRole("button", { name: "Resync" })).toBeEnabled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[ApiKeyManager]"),
      expect.anything(),
    );
  });
});
