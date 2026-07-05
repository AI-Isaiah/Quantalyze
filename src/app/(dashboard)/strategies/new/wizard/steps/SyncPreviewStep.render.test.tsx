/** @vitest-environment jsdom */
/**
 * H-0194 — SyncPreviewStep render-state machine (renderable branches).
 *
 * The pure `deriveDetectedMarkets` helper is already covered in
 * SyncPreviewStep.test.ts. The polling/Promise.all terminal path and the
 * module-private formatMetric/formatCagr helpers are not exported, so they
 * cannot be unit-tested without a production extraction (FLAGGED below).
 *
 * What IS testable end-to-end via render + mocks: the kickoff branch. When
 * the freshness probe finds no fresh row and POST /api/keys/sync returns a
 * non-2xx, the step transitions to phase="gate_failed" with
 * errorCode="SYNC_FAILED" and renders the scripted wizardErrors copy plus
 * the "Try another key" affordance. These pin branch (a) of the audit.
 *
 * The second + third describe blocks (added 2026-05-26, audit batch1 hi-fix)
 * pin the polling-loop disposition for H-0195 / H-0197 / H-0198 — the
 * terminal-failed short-circuit, the swallowed-throw escalation, and the
 * ignored-Supabase-error escalation. These drive the setTimeout backoff loop
 * with fake timers so they stay fast and deterministic.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncPreviewStep } from "./SyncPreviewStep";

// Supabase mock. `createClient()` delegates to a mutable module-level
// factory so individual tests can swap in a richer client (the polling
// suites do this via `installSupabaseMock`). The default — used by the
// kickoff suite — is the freshness probe shape
//   supabase.from(t).select(c).eq(k,v).maybeSingle()
// resolving with no existing row so the kickoff path runs the
// /api/keys/sync POST (which the test then forces to fail).
let currentClientFactory: () => unknown = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  }),
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

// KeyPermissionBadge fires its own fetch on mount; it only renders on the
// "passed" branch which these tests do not reach, but stub it to keep the
// render tree inert if a future change mounts it earlier.
vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

const baseProps = {
  strategyId: "strat-1",
  apiKeyId: "key-1",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

describe("[H-0194] SyncPreviewStep — kickoff render states", () => {
  beforeEach(() => {
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the computing/kicking-off state on first paint", async () => {
    // Keep the sync POST pending so the component stays in kicking_off.
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    render(<SyncPreviewStep {...baseProps} />);
    expect(
      screen.getByRole("heading", { name: /computing your verified factsheet/i }),
    ).toBeInTheDocument();
  });

  it("transitions to gate_failed with SYNC_FAILED copy when /api/keys/sync returns non-2xx", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "compute failed" }), { status: 500 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    // SYNC_FAILED scripted title from wizardErrors.ts.
    expect(
      await screen.findByText(/We could not verify this strategy/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("wizard-try-another-key")).toBeInTheDocument(),
    );
    errSpy.mockRestore();
  });

  it("transitions to gate_failed with a network-timeout when the sync POST throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    render(<SyncPreviewStep {...baseProps} />);

    await waitFor(() =>
      expect(screen.getByTestId("wizard-try-another-key")).toBeInTheDocument(),
    );
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Polling-loop dispositions (H-0195 / H-0197 / H-0198), added with the
// audit batch1 hi-fix on 2026-05-26.
//
// These mock the Supabase client at a finer grain than the kickoff suite:
// the freshness probe must report a stale-but-not-fresh row so the kickoff
// POST fires and the component enters `waiting_for_complete`, and then the
// status poll's behaviour is what each test varies. The mock is built fresh
// per test via `installSupabaseMock` so each spec controls exactly what the
// status read returns.
// ---------------------------------------------------------------------------

type PollOutcome =
  | { kind: "row"; status: string | null; error?: string | null }
  | { kind: "supabaseError" }
  | { kind: "throw" };

/**
 * Install a chainable Supabase mock for the polling suites.
 *
 * - The freshness probe (`select("computation_status, computed_at")`)
 *   resolves to a STALE complete row so the kickoff POST fires and the
 *   component enters `waiting_for_complete` (a fresh row would skip the POST,
 *   but either way it lands in the same polling phase).
 * - The status poll (`select("computation_status, computation_error")`)
 *   resolves according to the per-test `pollOutcome` supplier.
 * - The heavy terminal fetch (any other `select`) resolves empty/zero so the
 *   gate fails on INSUFFICIENT_TRADES if it is ever reached — that lets the
 *   H-0195 test assert the failed-status path NEVER touches `trades`.
 */
function installSupabaseMock(
  pollOutcome: () => PollOutcome,
  // When "throw", the heavy terminal fetch (the analytics-column select that
  // leads the Promise.all) rejects on every call. Lets a test reproduce the
  // FIX-1 fault: narrow status read keeps succeeding (status="complete") but
  // the heavy fan-out persistently throws. Default "empty" preserves the
  // existing behaviour for all other callers.
  heavyOutcome: "empty" | "throw" = "empty",
) {
  const tradesSpy = vi.fn();
  // Counts every status-poll `maybeSingle()` (one per poll tick). The
  // unmount specs assert this freezes after teardown — a regression that
  // dropped `clearTimeout`/`stopped=true` from the effect cleanup would keep
  // incrementing it as queued timers fire post-unmount.
  const statusPollSpy = vi.fn();

  const thenableEmpty = (data: unknown) => ({
    eq: () => thenableEmpty(data),
    neq: () => thenableEmpty(data),
    order: () => thenableEmpty(data),
    limit: () => thenableEmpty(data),
    maybeSingle: () => Promise.resolve({ data, error: null }),
    // Awaited directly (trades earliest/latest/sample): act as a thenable.
    then: (resolve: (v: { data: unknown; count: number; error: null }) => void) =>
      resolve({ data, count: 0, error: null }),
  });

  const client = {
    from: (table: string) => {
      if (table === "trades") tradesSpy(table);
      return {
        select: (cols: string) => {
          const isFreshnessProbe = cols === "computation_status, computed_at";
          const isStatusPoll = cols === "computation_status, computation_error";

          if (isFreshnessProbe) {
            // Stale (old computed_at) complete row → kickoff POST still fires.
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      computation_status: "complete",
                      computed_at: "2000-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
              }),
            };
          }

          if (isStatusPoll) {
            return {
              eq: () => ({
                maybeSingle: () => {
                  statusPollSpy();
                  const outcome = pollOutcome();
                  if (outcome.kind === "throw") {
                    return Promise.reject(new Error("poll exploded"));
                  }
                  if (outcome.kind === "supabaseError") {
                    return Promise.resolve({
                      data: null,
                      error: { message: "permission denied for table" },
                    });
                  }
                  return Promise.resolve({
                    data: {
                      computation_status: outcome.status,
                      computation_error: outcome.error ?? null,
                    },
                    error: null,
                  });
                },
              }),
            };
          }

          // Heavy terminal fetch (analytics columns / trades / api_keys).
          if (heavyOutcome === "throw") {
            // Reject the analytics-column maybeSingle() so the leading
            // Promise.all element rejects and the whole terminal fetch throws.
            // `trades`/`api_keys` still get a benign thenable in case ordering
            // changes, but the rejection above is what fails the Promise.all.
            const rejecting = {
              eq: () => rejecting,
              neq: () => rejecting,
              order: () => rejecting,
              limit: () => rejecting,
              maybeSingle: () =>
                Promise.reject(new Error("heavy fetch denied (RLS on trades)")),
              then: (
                resolve: (v: { data: unknown; count: number; error: null }) => void,
              ) => resolve({ data: null, count: 0, error: null }),
            };
            return rejecting;
          }
          return thenableEmpty(null);
        },
      };
    },
  };

  currentClientFactory = () => client;
  return { tradesSpy, statusPollSpy };
}

describe("[H-0195/H-0197/H-0198] SyncPreviewStep — polling loop dispositions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    // Kickoff POST succeeds → component enters waiting_for_complete.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    // Drop (do NOT execute) any timer still queued by this test so a
    // pending poll cannot fire under the next test's swapped client.
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Restore the default freshness-probe client for any later suite.
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  // H-0195: a terminal `failed` status must route to the analytics-failed
  // envelope WITHOUT firing the heavy trades/api_keys Promise.all (those
  // queries are pure waste on a hard-failed computation) and must STOP
  // polling. Before the fix, `failed` fell through into the heavy fetch.
  it("[H-0195] terminal 'failed' short-circuits before the trades fetch and stops polling", async () => {
    const { tradesSpy } = installSupabaseMock(() => ({
      kind: "row",
      status: "failed",
      error: "worker OOM",
    }));

    render(<SyncPreviewStep {...baseProps} />);

    // Flush the mount kickoff (freshness probe + POST) so the component
    // enters waiting_for_complete and the poll effect schedules its first
    // setTimeout. fake timers + RTL findBy do not compose, so we advance
    // deterministically and then assert synchronously.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Now walk the poll-backoff ladder so the status poll fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(
      screen.getByText(/We could not verify this strategy/i),
    ).toBeInTheDocument();
    // GATE_ANALYTICS_FAILED scripted title.
    expect(screen.getByText(/Analytics computation failed/i)).toBeInTheDocument();

    // The smoking gun: the heavy fetch hits `trades` three times. On the
    // failed path it must never be queried.
    expect(tradesSpy).not.toHaveBeenCalled();

    // Polling has stopped: further time advances issue no more status reads
    // (the failed branch set the internal stop flag). Trades stays untouched.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(tradesSpy).not.toHaveBeenCalled();
  });

  // H-0197: repeated thrown polls must escalate to a recoverable SYNC_FAILED
  // envelope instead of swallowing the error and spinning forever. Before the
  // fix the catch was `console.error` only — the wizard hung on the spinner.
  it("[H-0197] escalates to SYNC_FAILED after repeated thrown polls", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installSupabaseMock(() => ({ kind: "throw" }));

    render(<SyncPreviewStep {...baseProps} />);

    // Flush mount kickoff → waiting_for_complete, then walk the backoff
    // ladder. Three consecutive throws cross MAX_CONSECUTIVE_POLL_ERRORS.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(
      screen.getByText(/We could not verify this strategy/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wizard-try-another-key")).toBeInTheDocument();
    errSpy.mockRestore();
  });

  // H-0198: a Supabase `error` (RLS denial) on the status read must NOT
  // collapse to "pending" and spin forever. It is treated as a poll failure
  // and escalates to SYNC_FAILED after the consecutive-error threshold.
  it("[H-0198] escalates to SYNC_FAILED when the status read returns a Supabase error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installSupabaseMock(() => ({ kind: "supabaseError" }));

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(
      screen.getByText(/We could not verify this strategy/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wizard-try-another-key")).toBeInTheDocument();
    errSpy.mockRestore();
  });

  // Negative control: a single transient throw must NOT fail the wizard —
  // it backs off and retries, then succeeds-to-complete is reached. This
  // pins that the escalation is CONSECUTIVE, not first-failure. (Pairs with
  // H-0197 so the threshold can't silently drop to 1.)
  it("[H-0197] tolerates a single transient throw then continues polling", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    installSupabaseMock(() => {
      calls += 1;
      // First status poll throws; subsequent polls report still-computing.
      if (calls === 1) return { kind: "throw" };
      return { kind: "row", status: "computing" };
    });

    render(<SyncPreviewStep {...baseProps} />);

    // One throw + a couple of clean "computing" reads — below the threshold.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    // Still on the spinner (computing), NOT the error envelope.
    expect(
      screen.queryByText(/We could not verify this strategy/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /computing your verified factsheet/i }),
    ).toBeInTheDocument();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Effect-cleanup / unmount safety (H-0195 core mechanism) + FIX-1 heavy-fetch
// escalation, added 2026-05-26 (audit batch1 hi-fix).
//
// H-0195's fix is the poll effect's cleanup: `return () => { stopped = true;
// clearTimeout(timerId) }`. Nothing previously unmounted mid-poll, so a
// regression that dropped either statement from cleanup would still pass the
// whole suite. These specs unmount mid-poll and assert the poll timer is dead.
//
// React 19 NOTE: React removed the "Can't perform a React state update on an
// unmounted component" console.error in React 18, so asserting that warning's
// ABSENCE cannot, by itself, catch a dropped cleanup (it never fires either
// way). The load-bearing assertion is therefore the status-poll spy's FROZEN
// call count: if `clearTimeout(timerId)` were removed, the queued setTimeout
// would still fire after unmount and the spy would keep incrementing. The
// no-console.error assertion is a secondary guard against any *other* fault
// surfacing on the post-unmount tick.
// ---------------------------------------------------------------------------
describe("[H-0195] SyncPreviewStep — poll effect cleanup on unmount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  // FIX 2(a): enter a non-terminal polling state (status="computing" forever),
  // let a few polls fire, UNMOUNT, then advance timers well past the backoff
  // ladder. The status-poll spy's call count must FREEZE at its pre-unmount
  // value and no console.error must be emitted. Fails if `clearTimeout` is
  // dropped from the effect cleanup: the queued setTimeout keeps firing and
  // the spy keeps incrementing past the frozen count.
  it("[H-0195] freezes the status poll after unmount (no further reads, no warning)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { statusPollSpy } = installSupabaseMock(() => ({
      kind: "row",
      status: "computing",
    }));

    const { unmount } = render(<SyncPreviewStep {...baseProps} />);

    // Flush mount kickoff → waiting_for_complete, then fire a few poll ticks
    // (3000 + 3000 + 5000 = the first three backoff steps).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    const callsBeforeUnmount = statusPollSpy.mock.calls.length;
    // Sanity: the loop actually polled while mounted, otherwise the freeze
    // assertion below would be vacuously true.
    expect(callsBeforeUnmount).toBeGreaterThan(0);

    await act(async () => {
      unmount();
    });

    // Advance far past the whole backoff ladder (it caps at 10s/tick). A live
    // timer would fire several more polls in this window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(statusPollSpy.mock.calls.length).toBe(callsBeforeUnmount);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // FIX 2(b): unmount WHILE a poll promise is in flight, then resolve it.
  // The post-await `if (stopped) return` guard (set by cleanup) must drop the
  // resolution on the floor: no further state update, no reschedule, no
  // warning. We hold the status read pending across the unmount, then release
  // it and confirm the loop did not advance.
  it("[H-0195] drops an in-flight poll resolution after unmount", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let releaseStatusRead: (() => void) | null = null;
    const statusReadStarted = vi.fn();
    let statusReadCount = 0;

    const pendingClient = {
      from: () => ({
        select: (cols: string) => {
          const isFreshnessProbe = cols === "computation_status, computed_at";
          if (isFreshnessProbe) {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      computation_status: "complete",
                      computed_at: "2000-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
              }),
            };
          }
          // Status poll: hand back a promise we resolve manually so we can
          // unmount while it is still pending.
          return {
            eq: () => ({
              maybeSingle: () => {
                statusReadCount += 1;
                statusReadStarted();
                return new Promise((resolve) => {
                  releaseStatusRead = () =>
                    resolve({
                      data: {
                        computation_status: "computing",
                        computation_error: null,
                      },
                      error: null,
                    });
                });
              },
            }),
          };
        },
      }),
    };
    currentClientFactory = () => pendingClient;

    const { unmount } = render(<SyncPreviewStep {...baseProps} />);

    // Flush kickoff, then fire the first poll tick so the status read starts
    // and parks on our unresolved promise.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(statusReadStarted).toHaveBeenCalledTimes(1);
    expect(releaseStatusRead).not.toBeNull();

    // Unmount with the poll promise still pending, THEN resolve it.
    await act(async () => {
      unmount();
    });
    await act(async () => {
      releaseStatusRead?.();
      await Promise.resolve();
      // Advance past the next backoff step: a live loop would have scheduled
      // another poll off the resolved read. The guard must prevent that.
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // The in-flight read resolved post-unmount but must NOT have rescheduled:
    // still exactly one status read, ever.
    expect(statusReadCount).toBe(1);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// FIX 1 (silent-failure, MED): the narrow status read resets the shared
// consecutive-error counter, so a persistently-throwing HEAVY fetch (status
// read keeps returning "complete" but the trades/api_keys Promise.all throws
// every tick) could oscillate 0→1→0 and never escalate — an infinite spinner,
// the exact H-0197 failure narrowed to heavy-fetch-only faults. The fix gives
// the heavy fetch its own consecutive counter that escalates to SYNC_FAILED.
//
// NOTE on the spec name vs the audit prose: the audit said "status read
// succeeds (pending) every tick", but a "pending" status short-circuits
// BEFORE the heavy fetch (`nextStatus !== "complete"` → reschedule), so the
// heavy fan-out would never run. The real reproduction is status="complete"
// (narrow read OK) + heavy fetch throwing — that is what exercises the bug.
// ---------------------------------------------------------------------------
describe("[H-0197] SyncPreviewStep — persistent heavy-fetch fault escalates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  it("escalates to SYNC_FAILED when status reads succeed but the heavy fetch throws every tick", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Narrow status read: always "complete" → the heavy Promise.all fires
    // every tick. Heavy fetch: always throws.
    const { statusPollSpy } = installSupabaseMock(
      () => ({ kind: "row", status: "complete" }),
      "throw",
    );

    render(<SyncPreviewStep {...baseProps} />);

    // Flush kickoff, then walk the backoff ladder far enough for three
    // consecutive heavy-fetch throws to cross MAX_CONSECUTIVE_POLL_ERRORS.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // Recoverable SYNC_FAILED envelope (NOT the GATE_ANALYTICS_FAILED title),
    // proving the heavy-fetch fault escalated instead of spinning forever.
    expect(
      screen.getByText(/We could not verify this strategy/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Sync failed\./i)).toBeInTheDocument();
    expect(screen.getByTestId("wizard-try-another-key")).toBeInTheDocument();

    // The status read genuinely kept succeeding each tick (the precondition
    // that defeats a shared counter) — so this is the heavy-fetch path, not
    // the status-read path.
    expect(statusPollSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// P72 (Test E) — ledger-backed (Deribit) success path. A keyed strategy whose
// returns live in csv_daily_returns (tradeCount 0, csvRowCount >= 7) must reach
// the "passed" branch and render the FactsheetPreview + a days-of-returns line
// (NOT "0 trades detected"). Pre-P72 the terminal Promise.all had no
// csv_daily_returns query, so the gate saw csvRowCount 0 and false-failed
// INSUFFICIENT_TRADES for a keyed Deribit strategy.
// ---------------------------------------------------------------------------
describe("[P72] SyncPreviewStep — ledger-backed (Deribit) success path", () => {
  /**
   * Install a mock whose terminal fetch reports 0 trades but `csvCount`
   * csv_daily_returns rows, complete analytics, and a deribit key — the exact
   * shape of a verified Deribit onboarding.
   */
  function installDeribitPassMock(csvCount: number) {
    const thenable = (data: unknown, count: number) => ({
      eq: () => thenable(data, count),
      neq: () => thenable(data, count),
      order: () => thenable(data, count),
      limit: () => thenable(data, count),
      maybeSingle: () => Promise.resolve({ data, error: null }),
      then: (
        resolve: (v: { data: unknown; count: number; error: null }) => void,
      ) => resolve({ data, count, error: null }),
    });

    const client = {
      from: (table: string) => ({
        select: (cols: string) => {
          if (cols === "computation_status, computed_at") {
            // Stale complete freshness probe → kickoff POST still fires.
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      computation_status: "complete",
                      computed_at: "2000-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
              }),
            };
          }
          if (cols === "computation_status, computation_error") {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      computation_status: "complete",
                      computation_error: null,
                    },
                    error: null,
                  }),
              }),
            };
          }
          if (table === "csv_daily_returns") return thenable(null, csvCount);
          if (table === "trades") return thenable(null, 0);
          if (table === "api_keys") return thenable({ exchange: "deribit" }, 0);
          // Heavy analytics-column row.
          return thenable(
            {
              cagr: 0.12,
              sharpe: 1.1,
              sortino: 1.4,
              max_drawdown: -0.08,
              volatility: 0.2,
              cumulative_return: 0.3,
              sparkline_returns: [0.01, -0.02, 0.03],
              computed_at: "2026-07-01T00:00:00.000Z",
            },
            0,
          );
        },
      }),
    };
    currentClientFactory = () => client;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  it("keyed Deribit with 0 trades + >=7 csv rows + complete reaches the factsheet preview", async () => {
    installDeribitPassMock(30);

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    // Reached the "passed" branch (FactsheetPreview header).
    expect(
      screen.getByRole("heading", { name: /your verified factsheet is ready/i }),
    ).toBeInTheDocument();
    // Days-of-returns copy, NOT a "0 trades detected" line.
    expect(screen.getByText(/30 days of returns detected/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 trades detected/i)).not.toBeInTheDocument();
    // The "use this key" affordance is present on the passed branch.
    expect(screen.getByTestId("wizard-use-this-key")).toBeInTheDocument();
  });
});
