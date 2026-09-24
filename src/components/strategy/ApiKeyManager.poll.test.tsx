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

// 167.2-REVIEW-SFH M-6: bound expiries are captured at warning level.
const captureToSentryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));

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
  /**
   * Phase 167.2 / KCS-03: what the link update (`strategies.update(...).eq(...)`)
   * answers. Null answers `{ error: null }` at once, as before.
   */
  linkResult: null as Promise<{ error: unknown }> | null,
  /** 167.2-REVIEW CR-01: how many link updates were sent. */
  linkCount: 0,
  /** 167.2-REVIEW WR-04: the key the last link update wrote (read back before the enqueue). */
  linkedKeyId: "key-h" as string | null,
  /**
   * 167.2-REVIEW-R2 WR-02: what the Delete's composite-membership read
   * (`strategy_keys.select(...).eq("api_key_id", …)`) answers. Null answers
   * "a member of nothing" at once.
   */
  membershipResult: null as Promise<{ data: unknown; error: unknown }> | null,
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
        eq: () =>
          table === "strategy_keys"
            ? (mockState.membershipResult ?? Promise.resolve({ data: [], error: null }))
            : ({
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
            // 167.2-REVIEW WR-04: the link read-back before the enqueue.
            if (table === "strategies") {
              return Promise.resolve({ data: { api_key_id: mockState.linkedKeyId }, error: null });
            }
            if (table !== "strategy_analytics") {
              throw new Error(`unexpected maybeSingle on ${table}`);
            }
            mockState.baselineReadCount += 1;
            return Promise.resolve(mockState.baselineResult);
          },
        }),
      }),
      update: (vals: { api_key_id?: string }) => ({
        eq: () => {
          mockState.linkCount += 1;
          mockState.linkedKeyId = vals.api_key_id ?? null;
          return mockState.linkResult ?? Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

// --- Helpers ---------------------------------------------------------------

const POLL_MS = 3000;
// Hand-typed, never imported: the copy `handleSyncStatusChange` fills in when
// the poller escalates without a message of its own.
const TIMEOUT_COPY = "Analytics computation timed out. Please retry or contact support.";
// Phase 167.2 / KCS-22: hand-typed from 167.2-UI-SPEC.md § KCS-22, never
// imported from key-card-copy.ts (the house rule for locked copy).
const NO_RESULT_LABEL = "No result yet";
const KCS22_CAP =
  "This panel stopped checking after 2 minutes. The sync may still be running: reload this page later to see its result.";
const KCS22_NOROW =
  "This panel stopped checking after 30 seconds with nothing recorded yet. The sync may still be running: reload this page later to see its result.";
// Phase 167.2 / KCS-03: hand-typed from 167.2-UI-SPEC.md § KCS-03, never
// imported from key-card-copy.ts.
const KCS03_ENQUEUE_LABEL = "Sync not confirmed";
const KCS03_ENQUEUE =
  "We could not confirm this sync started: the request did not answer within 3 minutes, so it may still be running. Reload this page to see the latest status before you sync again.";
/** 180 s, hand-typed: the enqueue bound the KCS03-ENQUEUE sentence states. */
const ENQUEUE_BOUND = 180_000;
// 167.2-REVIEW-SFH M-1: hand-typed from the UI-SPEC review-fix row
// KCS-LATE-STARTED, never imported.
const KCS_LATE_STARTED_LABEL = "Sync started";
const KCS_LATE_STARTED =
  "The sync request was accepted after this panel stopped waiting for it. Reload this page later to see its result.";
const KCS03_LINK_LABEL = "Sync not started";
const KCS03_LINK =
  "This sync did not start: linking the key to this strategy did not answer within 15 seconds. Reload this page to check which key is linked before you sync again.";
/** 15 s, hand-typed: the link bound the KCS03-LINK sentence states. */
const LINK_BOUND = 15_000;

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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
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

/**
 * Did the attempt end on a give-up or a failure? Moved by Phase 167.2 / KCS-22:
 * a give-up now renders "No result yet" instead of the timeout copy, so the
 * absences below would pass vacuously unless that label counts too. Lineage:
 * this checked "Sync failed" and TIMEOUT_COPY only.
 */
function panelShowsTimeout() {
  return (
    screen.queryByText("Sync failed") !== null ||
    screen.queryByText(TIMEOUT_COPY) !== null ||
    screen.queryByText(NO_RESULT_LABEL) !== null
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
  mockState.linkResult = null;
  mockState.membershipResult = null;
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

  it("NOROW-GIVEUP (CONTROL): the fresh post-enqueue budget still escalates at its OWN grace boundary (so the absence above can fail)", async () => {
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

    // Poll 11 after the enqueue escalates, and the attempt ends (Resync is
    // usable again). Moved by Phase 167.2 / KCS-22: the give-up renders
    // "No result yet" with the KCS22-NOROW sentence (no row was ever read, and
    // every read was clean), not "Sync failed" with the timeout copy. Lineage:
    // this asserted both of those, under the name "CONTROL: …".
    await tick(POLL_MS);
    expect(screen.getByText(NO_RESULT_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS22_NOROW)).toBeInTheDocument();
    expect(screen.queryByText(KCS22_CAP)).not.toBeInTheDocument();
    expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
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
    // 167.2-REVIEW CR-01 (lineage): the Retry now reads the job state before
    // it links or enqueues, and refuses on an unreadable answer. This double
    // used to answer 404 to everything but the enqueue; the job-state read now
    // answers "failed_final" (the first attempt's chain has finished).
    fetchMock.mockImplementation((url: string) =>
      url === "/api/keys/sync"
        ? retryEnqueue.promise
        : /^\/api\/strategies\/[^/]+\/sync-progress$/.test(url)
          ? Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({ jobStatus: "failed_final", stalled: false, memberProgress: [] }),
            })
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
    // 167.2-REVIEW CR-01 (lineage): the first read is now the pre-attempt
    // gate's ("done": nothing in flight when the owner clicks), so the panel's
    // KCS-18 reads are the 2nd to 4th and each count below is one higher.
    mockState.jobStatuses = ["done", "pending", "pending", "done"];
    const enqueue = await startResyncWithHeldEnqueue();
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    await tick(POLL_MS * 2);
    expect(mockState.jobReadCount).toBe(3);
    expect(
      screen.queryByText("Synced with warnings"),
      "a mid-chain warned row was shown as this attempt's result",
    ).not.toBeInTheDocument();
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    // The job is done: the next evidenced read ends the attempt with the warning.
    await tick(POLL_MS);
    await tick(0);
    expect(mockState.jobReadCount).toBe(4);
    expect(screen.getByText("Synced with warnings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });
});

describe("ApiKeyManager + the REAL poller: a give-up is not a failure (Phase 167.2 / KCS-22)", () => {
  it("CAP-GIVEUP: a job still computing after 40 polls ends as No result yet with the KCS22-CAP sentence, no Sync failed and no Retry", async () => {
    mockState.analyticsResult = analyticsRow("computing");
    const enqueue = await startResyncWithHeldEnqueue();
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    // Polls 1..40 read the healthy computing row: still computing.
    await tick(POLL_MS * 40);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    // Poll 41 is the cap: the panel stops checking, and says so.
    await tick(POLL_MS);
    expect(screen.getByText(NO_RESULT_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS22_CAP)).toBeInTheDocument();
    expect(
      screen.queryByText("Sync failed"),
      "the panel's own give-up was rendered as a failure",
    ).not.toBeInTheDocument();
    expect(screen.queryByText(TIMEOUT_COPY)).not.toBeInTheDocument();
    // No Retry: a re-POST while the job may still be live can insert a second job.
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    // The attempt ended, so the key's Resync is usable again.
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });

  it("NOROW-NOT-ON-ERROR: computing rows, then a failed read on every tick from tick 4: no nothing-recorded claim at tick 15, KCS22-CAP after tick 41", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.analyticsResult = analyticsRow("computing");
    const enqueue = await startResyncWithHeldEnqueue();
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);

    await tick(POLL_MS * 3);
    expect(mockState.analyticsSelectCount).toBe(3);
    mockState.analyticsResult = { data: null, error: { code: "500", message: "boom" } };

    // Tick 15 is an erroring read past the grace boundary: still computing.
    await tick(POLL_MS * 12);
    expect(mockState.analyticsSelectCount).toBe(15);
    expect(screen.getByText("Computing analytics...")).toBeInTheDocument();
    expect(
      screen.queryByText(KCS22_NOROW),
      "a failed read was rendered as nothing recorded yet",
    ).not.toBeInTheDocument();
    expect(screen.queryByText(NO_RESULT_LABEL)).not.toBeInTheDocument();

    // The cap still ends it: after tick 41 the KCS22-CAP sentence renders.
    await tick(POLL_MS * 26);
    expect(screen.getByText(NO_RESULT_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS22_CAP)).toBeInTheDocument();
    expect(screen.queryByText(KCS22_NOROW)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("ApiKeyManager + the REAL poller: an enqueue that never answers is bounded (Phase 167.2 / KCS-03)", () => {
  it("ENQUEUE-HANG: at 180 s the attempt ends as Sync not confirmed with the KCS03-ENQUEUE sentence, never Sync failed, with no Retry", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.analyticsResult = analyticsRow("computing");
    await startResyncWithHeldEnqueue();

    // Just inside the bound: the attempt is still live.
    await tick(ENQUEUE_BOUND - 1_000);
    expect(screen.queryByText(KCS03_ENQUEUE_LABEL)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    // At the bound: the card says it could not confirm the sync, and why.
    await tick(1_000);
    expect(screen.getByText(KCS03_ENQUEUE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS03_ENQUEUE)).toBeInTheDocument();
    expect(
      screen.queryByText("Sync failed"),
      "a bound expiry was rendered as a failure the card cannot know",
    ).not.toBeInTheDocument();
    // No Retry: a re-POST while the first enqueue may still land can insert a
    // second job. The attempt ended, so the key's Resync is usable again.
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
    // UI-SPEC § Color: the DESIGN.md opaque amber trio, not the amber-500 pair.
    const label = screen.getByText(KCS03_ENQUEUE_LABEL);
    expect(label.className).toContain("text-warning");
    expect(label.closest(".rounded-lg")?.className).toContain("bg-warning-bg");
    // Nothing was polled: no job is known to exist.
    expect(mockState.analyticsSelectCount).toBe(0);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("180000 ms"));
    // 167.2-REVIEW-SFH M-6: a wedged enqueue reaches Sentry, not only the console.
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      level: "warning",
      tags: { component: "ApiKeyManager", stage: "enqueue-bound" },
    });
  });

  // Moved by the 167.2 review fix round (167.2-REVIEW-SFH M-1, lineage): this
  // pin said the late 202 "leaves Sync not confirmed on the panel". But a late
  // answer is the one piece of evidence `unconfirmed` was waiting for, and it
  // was discarded to a console.warn. It still starts NO poll and resurrects
  // nothing (KCS-03 / RESEARCH P5 hold); when this attempt's panel is still the
  // one on screen, it now says the sync started (KCS-LATE-STARTED).
  it("LATE-202: a 202 that lands at 200 s, after the bound, starts no poll and says the sync started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockState.analyticsResult = analyticsRow("computing");
    const enqueue = await startResyncWithHeldEnqueue();

    await tick(ENQUEUE_BOUND);
    expect(screen.getByText(KCS03_ENQUEUE_LABEL)).toBeInTheDocument();

    // The request answers 20 s after its bound expired.
    await tick(20_000);
    await act(async () => {
      enqueue.resolve(accepted());
    });
    await tick(0);
    await tick(POLL_MS * 3);

    expect(
      mockState.analyticsSelectCount,
      "a late 202 resurrected an attempt the card had already ended",
    ).toBe(0);
    expect(screen.queryByText("Computing analytics...")).not.toBeInTheDocument();
    expect(screen.getByText(KCS_LATE_STARTED_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS_LATE_STARTED)).toBeInTheDocument();
    expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("answered after its"));
  });

  it("LATE-REJECTION (167.2-REVIEW-SFH M-1): a 503 that lands after the bound replaces \"may still be running\" with the route's own failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const enqueue = await startResyncWithHeldEnqueue();

    await tick(ENQUEUE_BOUND);
    expect(screen.getByText(KCS03_ENQUEUE_LABEL)).toBeInTheDocument();

    await tick(20_000);
    await act(async () => {
      enqueue.resolve({
        ok: false,
        status: 503,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "Synthetic breaker message." }),
      } as unknown as Response);
    });
    await tick(0);

    expect(screen.getByText("Sync failed")).toBeInTheDocument();
    expect(screen.getByText("Synthetic breaker message.")).toBeInTheDocument();
    expect(screen.queryByText(KCS03_ENQUEUE)).not.toBeInTheDocument();
    expect(mockState.analyticsSelectCount).toBe(0);
  });
});

describe("ApiKeyManager + the REAL poller: a late TRANSPORT failure is not a verdict (167.2-REVIEW-SFH-R2 R2-M1)", () => {
  // A late answer arrives between the 180 s bound and the route's 300 s
  // maxDuration. A platform 504 (non-JSON) or a rejected fetch says nothing
  // about whether the upstream enqueue committed, so the honest
  // "may still be running" panel must stay. Only a JSON error body the route
  // itself produced is a verdict (LATE-REJECTION above).
  it.each([
    {
      arm: "a non-JSON 504 (the platform's function timeout)",
      answer: () => ({
        ok: false,
        status: 504,
        headers: new Headers({ "content-type": "text/html" }),
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      }),
      reject: false,
    },
    { arm: "a rejected fetch (network dropped, laptop slept)", answer: null, reject: true },
  ])("R2-M1-TRANSPORT: $arm after the bound keeps the enqueue_bound panel and is captured as transport", async ({ answer, reject }) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    captureToSentryMock.mockClear();
    const enqueue = await startResyncWithHeldEnqueue();

    await tick(ENQUEUE_BOUND);
    expect(screen.getByText(KCS03_ENQUEUE_LABEL)).toBeInTheDocument();

    await tick(20_000);
    await act(async () => {
      if (reject) {
        enqueue.reject(new TypeError("Failed to fetch"));
      } else {
        enqueue.resolve(answer!() as unknown as Response);
      }
    });
    await tick(0);

    expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
    expect(screen.getByText(KCS03_ENQUEUE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS03_ENQUEUE)).toBeInTheDocument();
    expect(captureToSentryMock).toHaveBeenCalledWith(expect.any(Error), {
      level: "warning",
      tags: { component: "ApiKeyManager", stage: "late-enqueue-answer", kind: "transport" },
    });
  });
});

describe("ApiKeyManager + the REAL poller: a link update that never answers is bounded, and nothing is enqueued (Phase 167.2 / KCS-03)", () => {
  /** How many `/api/keys/sync` requests this test's fetch mock has seen. */
  function enqueueRequests() {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls.filter(([url]) => url === "/api/keys/sync").length;
  }

  it("LINK-HANG: at 15 s the attempt ends as Sync not started with the KCS03-LINK sentence, and no enqueue was ever sent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.linkResult = new Promise(() => {});
    await startResyncWithHeldEnqueue();

    await tick(LINK_BOUND - 1_000);
    expect(screen.queryByText(KCS03_LINK_LABEL)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    await tick(1_000);
    expect(screen.getByText(KCS03_LINK_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS03_LINK)).toBeInTheDocument();
    expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
    expect(screen.getByText(KCS03_LINK_LABEL).className).toContain("text-warning");
    // "Sync not started" is true only because nothing was sent: no baseline
    // read and no enqueue for this attempt.
    expect(enqueueRequests(), "an enqueue was sent after the link bound expired").toBe(0);
    expect(mockState.baselineReadCount).toBe(0);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("15000 ms"));
  });

  it("LINK-LATE: a link update that answers after its bound writes nothing and sends no enqueue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const link = deferred<{ error: unknown }>();
    mockState.linkResult = link.promise;
    await startResyncWithHeldEnqueue();

    await tick(LINK_BOUND);
    expect(screen.getByText(KCS03_LINK_LABEL)).toBeInTheDocument();

    // The link answers 5 s late, successfully.
    await tick(5_000);
    await act(async () => {
      link.resolve({ error: null });
    });
    await tick(0);
    await tick(POLL_MS * 3);

    expect(enqueueRequests(), "a late link answer resumed an ended attempt").toBe(0);
    expect(mockState.baselineReadCount).toBe(0);
    expect(screen.getByText(KCS03_LINK_LABEL)).toBeInTheDocument();
    expect(screen.getByText(KCS03_LINK)).toBeInTheDocument();
    expect(screen.queryByText("Fetching trades from Binance...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });
});

describe("ApiKeyManager + the REAL job-state read: no attempt starts while a chain job is in flight (167.2-REVIEW CR-01 / WR-06)", () => {
  // Hand-typed from the UI-SPEC review-fix row KCS-GATE-INFLIGHT.
  const GATE_INFLIGHT =
    "This sync did not start: this strategy still has a sync or computation in progress. Try again once it has finished.";

  it("GATE-E2E: a Resync while the projection says running writes no link, sends no enqueue, and says why on the panel", async () => {
    mockState.jobStatuses = ["running"];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (/^\/api\/strategies\/[^/]+\/sync-progress$/.test(url)) {
        mockState.jobReadCount += 1;
        const jobStatus = mockState.jobStatuses.shift() ?? "done";
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ jobStatus, stalled: false, memberProgress: [] }),
        });
      }
      return Promise.resolve(accepted());
    });
    vi.stubGlobal("fetch", fetchMock);
    mockState.linkCount = 0;

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-h" />);
    });
    await tick(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resync" }));
    });
    await tick(0);

    expect(mockState.jobReadCount).toBe(1);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/keys/sync")).toBe(false);
    expect(mockState.linkCount).toBe(0);
    expect(screen.getByText("Sync not started")).toBeInTheDocument();
    expect(screen.getByText(GATE_INFLIGHT)).toBeInTheDocument();
    expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });
});

describe("ApiKeyManager + the REAL job-state read: the pre-attempt gate cannot hang the card (167.2-REVIEW-R2 WR-03)", () => {
  // Hand-typed from the UI-SPEC review-fix row KCS-GATE-UNREADABLE.
  const GATE_UNREADABLE =
    "This sync did not start: we could not check whether a sync for this strategy is still running. Try again in a moment.";
  /** 15 s, hand-typed: `CHAIN_JOB_READ_BOUND_MS`. */
  const CHAIN_JOB_BOUND = 15_000;

  it("GATE-BOUND: a sync-progress read that never settles ends the attempt at 15 s as Sync not started; no link, no enqueue, and Resync comes back", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (/^\/api\/strategies\/[^/]+\/sync-progress$/.test(url)) {
        mockState.jobReadCount += 1;
        return new Promise(() => {});
      }
      return Promise.resolve(accepted());
    });
    vi.stubGlobal("fetch", fetchMock);
    mockState.linkCount = 0;

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-h" />);
    });
    await tick(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resync" }));
    });
    await tick(0);
    expect(mockState.jobReadCount).toBe(1);

    await tick(CHAIN_JOB_BOUND - 1_000);
    // Still held: the attempt is registered and the card is locked.
    expect(screen.queryByText(GATE_UNREADABLE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();

    await tick(1_000);
    expect(screen.getByText("Sync not started")).toBeInTheDocument();
    expect(screen.getByText(GATE_UNREADABLE)).toBeInTheDocument();
    expect(mockState.linkCount).toBe(0);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/keys/sync")).toBe(false);
    expect(screen.getByRole("button", { name: "Resync" })).toBeEnabled();
  });
});

describe("ApiKeyManager: the Delete's membership read is bounded (167.2-REVIEW-R2 WR-02, founder decision)", () => {
  // Hand-typed from the UI-SPEC round-2 founder-decision row.
  const WARN_UNCHECKED =
    "We could not check whether this key is part of a composite strategy. If it is, deleting it also removes it from that composite, and a composite with no other key left becomes unlinked.";

  // jsdom has no HTMLDialogElement.showModal / close; the confirm renders
  // through <Modal>, which calls them (ApiKeyManager.test.tsx polyfills the same).
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

  function confirmDialog() {
    const dialog = Array.from(document.querySelectorAll("dialog")).find((d) =>
      d.textContent?.includes("Delete API Key"),
    );
    expect(dialog).toBeTruthy();
    return dialog!;
  }

  it("DELETE-MEMBERSHIP-BOUND: a membership read that never settles holds the confirm's Delete for 15 s, then warns it could not check and lets the owner choose", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.membershipResult = new Promise(() => {});
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(accepted())));

    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-h" />);
    });
    await tick(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    await tick(0);
    expect(confirmDialog()).toHaveAttribute("open");
    // Held while the read is open: the owner decides with the answer, not before it.
    expect(within(confirmDialog()).getByRole("button", { name: "Delete" })).toBeDisabled();

    await tick(14_000);
    expect(screen.queryByText(WARN_UNCHECKED)).not.toBeInTheDocument();

    await tick(1_000);
    expect(within(confirmDialog()).getByText(WARN_UNCHECKED)).toBeInTheDocument();
    expect(within(confirmDialog()).getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});

describe("ApiKeyManager + the REAL job-state read: a deterministic DEGRADED answer does not promise a retry (167.2-REVIEW-R2 IN-04 / SFH-R2 R2-L1)", () => {
  // Hand-typed from the UI-SPEC round-2 rows.
  const GATE_UNREADABLE =
    "This sync did not start: we could not check whether a sync for this strategy is still running. Try again in a moment.";
  const GATE_PERSISTENT =
    "This sync did not start: we cannot check whether this strategy has a sync in progress, and trying again will not change that. Contact support@quantalyze.com to start a sync.";

  async function resyncAgainst(body: Record<string, unknown>) {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (/^\/api\/strategies\/[^/]+\/sync-progress$/.test(url)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => body,
        });
      }
      return Promise.resolve(accepted());
    });
    vi.stubGlobal("fetch", fetchMock);
    mockState.linkCount = 0;
    await act(async () => {
      render(<ApiKeyManager strategyId="strat-1" currentKeyId="key-h" />);
    });
    await tick(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resync" }));
    });
    await tick(0);
    return fetchMock;
  }

  it.each(["window_full", "bad_status"])(
    "GATE-PERSISTENT: a DEGRADED body with degradedReason %s refuses with copy that names support and never says \"in a moment\"",
    async (degradedReason) => {
      const fetchMock = await resyncAgainst({
        jobStatus: null,
        stalled: false,
        memberProgress: [],
        degraded: true,
        degradedReason,
      });
      expect(screen.getByText("Sync not started")).toBeInTheDocument();
      expect(screen.getByText(GATE_PERSISTENT)).toBeInTheDocument();
      expect(screen.queryByText(GATE_UNREADABLE)).not.toBeInTheDocument();
      expect(mockState.linkCount).toBe(0);
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/keys/sync")).toBe(false);
    },
  );

  it("GATE-TRANSIENT (CONTROL): a DEGRADED body with no reason (a failed read) keeps the \"in a moment\" copy", async () => {
    await resyncAgainst({ jobStatus: null, stalled: false, memberProgress: [], degraded: true });
    expect(screen.getByText(GATE_UNREADABLE)).toBeInTheDocument();
    expect(screen.queryByText(GATE_PERSISTENT)).not.toBeInTheDocument();
  });
});
