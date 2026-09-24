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
 *   - a terminal re-read that never settles is bounded (SFH2-MED-1 / IN-01);
 *   - Phase 167.2 / KCS-02: a terminal ends the attempt only with evidence that
 *     it is THIS attempt's (a `computing` read, or a `computed_at` that moved
 *     from the baseline read just before the enqueue), never on the previous
 *     run's row (STALE-TERMINAL, FAST-FAIL, COMPUTING-THEN-SUCCESS,
 *     UNKNOWN-BASELINE);
 *   - Phase 167.2 / KCS-18: a terminal SUCCESS ends the attempt only once the
 *     job queue says no factsheet-chain job is in flight (WARNED-ROW-KEYCARD).
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
//   strategy_analytics.select(...).eq(...).maybeSingle() → THE KCS-02 BASELINE,
//     counted SEPARATELY from the poll (RESEARCH P4), so "no poll before the
//     enqueue" stays measurable beside "exactly one baseline read before it".
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  analyticsResult: { data: null, error: null } as { data: unknown; error: unknown },
  analyticsSelectCount: 0,
  /** KCS-02: what the pre-enqueue baseline read answers. Default: no row. */
  baselineResult: { data: null, error: null } as { data: unknown; error: unknown },
  baselineReadCount: 0,
  keysRows: [] as unknown[],
  /** When true, the NEXT key-list read never settles (one-shot). */
  hangNextKeysRead: false,
  /**
   * Phase 167.2 / KCS-18: the jobStatus each `/api/strategies/[id]/sync-progress`
   * read answers, in order. Empty answers `done` (nothing in flight), which is
   * what every case before KCS-18 assumed.
   */
  jobStatuses: [] as Array<string | null>,
  jobReadCount: 0,
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
          maybeSingle: () => {
            if (table !== "strategy_analytics") {
              throw new Error(`unexpected maybeSingle on ${table}`);
            }
            mockState.baselineReadCount += 1;
            return Promise.resolve(mockState.baselineResult);
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

function analyticsRow(status: string, computedAt: string | null = null) {
  return {
    data: { computation_status: status, computation_error: null, computed_at: computedAt },
    error: null,
  };
}

// KCS-02: synthetic server timestamps. T0 is the previous run's, T1 a later write.
const T0 = "2026-04-19T11:58:00.000000+00:00";
const T1 = "2026-04-19T12:03:00.000000+00:00";

/** The pre-enqueue baseline read answering a row whose computed_at is `computedAt`. */
function baselineRow(computedAt: string | null) {
  return { data: { computed_at: computedAt }, error: null };
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
    // A real read of the job-state projection. Phase 167.2 / KCS-18: the panel
    // reads it before it forwards a terminal success (plan 167.2-10). Lineage:
    // plan 167.2-03 added this arm answering `done` for every read; it now
    // answers from `mockState.jobStatuses`, still `done` when the queue is empty.
    if (/^\/api\/strategies\/[^/]+\/sync-progress$/.test(url)) {
      mockState.jobReadCount += 1;
      const jobStatus = mockState.jobStatuses.length > 0 ? mockState.jobStatuses.shift() : "done";
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ jobStatus, stalled: false, memberProgress: [] }),
      });
    }
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
  mockState.baselineResult = { data: null, error: null };
  mockState.baselineReadCount = 0;
  mockState.keysRows = [healthyRow()];
  mockState.hangNextKeysRead = false;
  mockState.jobStatuses = [];
  mockState.jobReadCount = 0;
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
    // ... and nothing was POLLED before it: such a poll is the previous run's.
    // Moved by Phase 167.2 / KCS-02 (RESEARCH P4): the one analytics read that
    // does happen before the enqueue is the baseline, counted apart from polls.
    // Lineage: this pin was `expect(readsBeforeEnqueue).toBe(0)` alone.
    expect(readsBeforeEnqueue).toBe(0);
    expect(mockState.baselineReadCount).toBe(1);
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
    // Moved by KCS-02 (see the case above): zero polls and exactly one
    // baseline read before the enqueue. Lineage: `readsBeforeEnqueue` alone.
    expect(readsBeforeEnqueue).toBe(0);
    expect(mockState.baselineReadCount).toBe(1);
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

    // Moved by Phase 167.2 / KCS-02: the terminal row carries a computed_at
    // (T1) different from the baseline read before the enqueue (no row, null),
    // which is this attempt's evidence. Lineage: it was `analyticsRow("complete")`
    // with computed_at null and no computing read, which the gate now drops as
    // indistinguishable from the previous run's row (see STALE-TERMINAL).
    mockState.analyticsResult = analyticsRow("complete", T1);
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
    // Moved by Phase 167.2 / KCS-02: computed_at T1 differs from the baseline
    // (no row), so the terminal is this attempt's. Lineage: `analyticsRow("complete")`.
    mockState.analyticsResult = analyticsRow("complete", T1);
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

describe("ApiKeyManager + the REAL poller: a terminal ends the attempt only with THIS attempt's evidence (Phase 167.2 / KCS-02)", () => {
  /** Resolve the held enqueue with a 202 and settle the move to `computing`. */
  async function enqueueAccepted(enqueue: ReturnType<typeof deferred<Response>>) {
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
  }

  it("STALE-TERMINAL: the previous run's complete row (computed_at unchanged, no computing read) never ends the attempt", async () => {
    mockState.baselineResult = baselineRow(T0);
    mockState.analyticsResult = analyticsRow("complete", T0);
    const enqueue = await startResyncWithHeldEnqueue();
    await enqueueAccepted(enqueue);

    await tick(POLL_MS * 5);
    expect(mockState.analyticsSelectCount).toBe(5);
    expect(
      screen.queryByText("Up to date"),
      "the previous run's complete row was shown as this attempt's result",
    ).not.toBeInTheDocument();
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  });

  it("FAST-FAIL: a job that fails before any computing write ends the attempt as Sync failed, through the moved computed_at", async () => {
    // RESEARCH Q1: previous run failed at T0; this job fails fast, the bridge
    // rewrites `failed` with computed_at = now() (T1), and `computing` is never
    // observable. Evidence (b) alone must end the attempt truthfully.
    mockState.baselineResult = baselineRow(T0);
    mockState.analyticsResult = analyticsRow("failed", T1);
    const enqueue = await startResyncWithHeldEnqueue();
    await enqueueAccepted(enqueue);

    await tick(POLL_MS);
    expect(mockState.analyticsSelectCount).toBe(1);
    expect(screen.getByText("Sync failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });

  it("COMPUTING-THEN-SUCCESS: a computing read admits the terminal even when computed_at equals the baseline", async () => {
    mockState.baselineResult = baselineRow(T0);
    mockState.analyticsResult = analyticsRow("computing", T0);
    const enqueue = await startResyncWithHeldEnqueue();
    await enqueueAccepted(enqueue);

    await tick(POLL_MS);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();

    mockState.analyticsResult = analyticsRow("complete", T0);
    await tick(POLL_MS);
    await tick(0);
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });

  it("UNKNOWN-BASELINE: a failed baseline read leaves only a computing read able to admit the terminal, and is logged", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.baselineResult = { data: null, error: { message: "network down" } };
    // A moved computed_at is NOT evidence without a baseline to compare it with.
    mockState.analyticsResult = analyticsRow("complete", T1);
    const enqueue = await startResyncWithHeldEnqueue();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("evidence baseline read failed"),
      "network down",
    );
    await enqueueAccepted(enqueue);

    await tick(POLL_MS * 3);
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();

    mockState.analyticsResult = analyticsRow("computing", T1);
    await tick(POLL_MS);
    mockState.analyticsResult = analyticsRow("complete", T1);
    await tick(POLL_MS);
    await tick(0);
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("KEYED-PER-ATTEMPT: a Retry does not inherit the previous attempt's computing read", async () => {
    // Attempt 1 reads computing, then fails at T1. The panel stays mounted in
    // `error`, so without `key={attemptSeq}` its computing evidence would carry
    // into the Retry and admit attempt 2's stale read of that same failure.
    mockState.baselineResult = baselineRow(T0);
    mockState.analyticsResult = analyticsRow("computing", T0);
    const enqueue = await startResyncWithHeldEnqueue();
    await enqueueAccepted(enqueue);
    await tick(POLL_MS);
    mockState.analyticsResult = analyticsRow("failed", T1);
    await tick(POLL_MS);
    expect(screen.getByText("Sync failed")).toBeInTheDocument();

    // Retry: the baseline is now T1, and the row still says the old failure.
    mockState.baselineResult = baselineRow(T1);
    const retryEnqueue = deferred<Response>();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) =>
      url === "/api/keys/sync"
        ? retryEnqueue.promise
        : Promise.resolve({ ok: false, status: 404, headers: new Headers(), json: async () => ({}) }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await tick(0);
    await enqueueAccepted(retryEnqueue);

    await tick(POLL_MS * 3);
    expect(
      screen.queryByText("Sync failed"),
      "the Retry ended on the previous attempt's failure",
    ).not.toBeInTheDocument();
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
  });

  it("the baseline read that never answers is bounded: the enqueue still goes out after 15 s, with an unknown baseline", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.baselineResult = new Promise(() => {}) as unknown as { data: unknown; error: unknown };
    const enqueue = await startResyncWithHeldEnqueue();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const enqueued = () => fetchMock.mock.calls.some(([url]) => url === "/api/keys/sync");

    await tick(14_000);
    expect(enqueued()).toBe(false);
    await tick(1_000);
    expect(enqueued()).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("15000 ms"));

    // Unknown baseline: a moved computed_at alone does not end the attempt.
    mockState.analyticsResult = analyticsRow("complete", T1);
    await enqueueAccepted(enqueue);
    await tick(POLL_MS * 2);
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
  });
});

describe("ApiKeyManager + the REAL poller: a success waits for the job queue (Phase 167.2 / KCS-18)", () => {
  it("WARNED-ROW-KEYCARD: a warned strategy's resync does not say Synced with warnings while its chain job is pending", async () => {
    // RESEARCH P1: the previous run ended complete_with_warnings at T0. The
    // bridge keeps that status mid-chain and moves computed_at to T1, so the
    // row alone carries this attempt's evidence (b) while the next hop is
    // still pending. Only the job queue can say the run has not finished.
    mockState.baselineResult = baselineRow(T0);
    mockState.analyticsResult = analyticsRow("complete_with_warnings", T1);
    mockState.jobStatuses = ["pending", "pending", "done"];
    const enqueue = await startResyncWithHeldEnqueue();
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    await tick(POLL_MS * 2);
    expect(mockState.jobReadCount).toBe(2);
    expect(
      screen.queryByText("Synced with warnings"),
      "a mid-chain warned row was shown as this attempt's result",
    ).not.toBeInTheDocument();
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    // The job is done: the next evidenced read ends the attempt with the warning.
    await tick(POLL_MS);
    await tick(0);
    expect(mockState.jobReadCount).toBe(3);
    expect(screen.getByText("Synced with warnings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });
});
