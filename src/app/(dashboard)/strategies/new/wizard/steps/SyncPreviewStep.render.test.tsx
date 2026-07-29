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
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SyncPreviewStep,
  type SyncPreviewSnapshot,
  type SyncPreviewStepProps,
} from "./SyncPreviewStep";

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
    // ⚠️ 140.4-11 RE-POINTED. This used to assert `wizard-try-another-key`,
    // using the DESTRUCTIVE control as a proxy for "the terminal state
    // rendered". SYNC_FAILED's actions are clear_and_retry + request_call, so
    // it no longer earns that control. Re-pointed at the machine-readable code
    // plus the exit affordance, which is strictly stronger: the old line passed
    // for ANY error code, this one names the state and still proves it is not a
    // dead end.
    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toHaveAttribute(
        "data-error-code",
        "SYNC_FAILED",
      ),
    );
    expect(
      screen.getByTestId("wizard-back-to-strategies"),
    ).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("transitions to gate_failed with SERVICE_UNREACHABLE when the sync POST throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    render(<SyncPreviewStep {...baseProps} />);

    // ⚠️ 140.4-11 RE-POINTED, same reason — and this one gains a real
    // discrimination it never had: the old assertion could not tell a
    // network-timeout apart from the generic SYNC_FAILED fallback.
    //
    // ⚠️ 140.5-03 / SEAMPROSE-03 RE-POINTED AGAIN, and the code itself changed.
    // This was the FIFTH and last of the transport catches asserting a VENUE
    // fault for a fault on our own hop: the kickoff POST to `/api/keys/sync`
    // never completed, so the exchange may never have been contacted, while
    // KEY_NETWORK_TIMEOUT's copy reads "We could not reach the exchange".
    await waitFor(() =>
      expect(screen.getByTestId("error-envelope")).toHaveAttribute(
        "data-error-code",
        "SERVICE_UNREACHABLE",
      ),
    );
    // The negative half: a partial rename would satisfy the positive alone.
    expect(screen.getByTestId("error-envelope")).not.toHaveTextContent(
      "We could not reach the exchange.",
    );
    expect(screen.getByTestId("error-envelope")).toHaveTextContent(
      "We could not reach our own service.",
    );
    expect(
      screen.getByTestId("wizard-back-to-strategies"),
    ).toBeInTheDocument();
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

          // WIZ-05: the mount effect now reads data_quality_flags for ANY
          // complete row (fresh or stale) to decide composite-ness. The
          // freshness probe here reports a STALE complete row, so model the
          // marker as present-but-non-composite → the stale single-key path
          // falls through to the kickoff POST exactly as before (and never hits
          // the throwing heavy branch below, which would abort the mount effect).
          if (cols === "data_quality_flags") {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { data_quality_flags: null },
                    error: null,
                  }),
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
    // ⚠️ 140.4-11 RE-POINTED off the destructive control (SYNC_FAILED does not
    // earn it) onto the code + the exit affordance. Strictly stronger: it now
    // names WHICH state the escalation produced.
    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "SYNC_FAILED",
    );
    expect(screen.getByTestId("wizard-back-to-strategies")).toBeInTheDocument();
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
    // ⚠️ 140.4-11 RE-POINTED, same reason as H-0197 above.
    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "SYNC_FAILED",
    );
    expect(screen.getByTestId("wizard-back-to-strategies")).toBeInTheDocument();
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
          // WIZ-05: model the composite-marker read as present-but-non-composite
          // so the stale-complete path falls through to the kickoff POST and the
          // in-flight assertion below still exercises the STATUS poll (not the
          // marker read).
          if (cols === "data_quality_flags") {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { data_quality_flags: null },
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
    // ⚠️ 140.4-11 RE-POINTED off the destructive control onto the exit
    // affordance. The point of the line is "the wizard is not a dead end after
    // the escalation", and a way out that does not delete the draft makes it
    // better, not weaker.
    expect(screen.getByTestId("wizard-back-to-strategies")).toBeInTheDocument();

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
  function installDeribitPassMock(csvCount: number, pollStatus = "complete") {
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
                      computation_status: pollStatus,
                      computation_error: null,
                    },
                    error: null,
                  }),
              }),
            };
          }
          if (table === "csv_daily_returns") return thenable(null, csvCount);
          if (table === "trades") {
            // DOUBLE FIDELITY (140.4-02). `trades` is read three different ways
            // in the single-key terminal arm and they do NOT share a resolved
            // shape: the `head: true` exact count (`select("id")`) resolves
            // `data: null` WITH a count, while the earliest / latest / sample
            // reads are LIST selects, and postgrest-js never resolves
            // `data: null` on a successful list select — it resolves `[]`.
            //
            // This double answered `null` for all three. That went unnoticed
            // only because the production code carried a `?? []` whose sole
            // purpose was to absorb a shape the real client cannot produce; the
            // checked-read conversion made that coercion provably dead and
            // removed it, at which point the double's infidelity surfaced.
            // Fixed here rather than by restoring the coercion: a fake must be
            // pinned to the contract it stands in for, or it silently licenses
            // production code to handle cases that do not exist while missing
            // ones that do.
            return cols === "id" ? thenable(null, 0) : thenable([], 0);
          }
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

  it("[mig-20260707120000] complete_with_warnings is terminal — reaches the factsheet preview, does NOT poll forever", async () => {
    // Regression: a warned first compute (e.g. Deribit onboarding tripping a DQ
    // guard) now PERSISTS 'complete_with_warnings' instead of being laundered to
    // 'complete'. The poll must treat it as a terminal success (isComputedAnalytics)
    // or the wizard spins forever. Same harness as the 'complete' case, warned poll.
    installDeribitPassMock(30, "complete_with_warnings");

    render(<SyncPreviewStep {...baseProps} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(
      screen.getByRole("heading", { name: /your verified factsheet is ready/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/30 days of returns detected/i)).toBeInTheDocument();
    expect(screen.getByTestId("wizard-use-this-key")).toBeInTheDocument();
  });
});

// mig 20260707120000 — the `isFresh` resume check must treat a fresh
// complete_with_warnings row as fresh (isComputedAnalytics), else a warned-but-
// fresh strategy re-fires the /api/keys/sync POST + queue on every wizard
// revisit (churn / rate-limit exposure). Guards the second changed line in this
// file (the poll terminal-check is guarded above).
describe("[mig-20260707120000] SyncPreviewStep — fresh complete_with_warnings skips the resync POST", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:00:00.000Z"));
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
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

  it("a fresh warned row is treated as fresh → no /api/keys/sync POST fires", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    currentClientFactory = () => ({
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: () =>
              cols === "computation_status, computed_at"
                ? Promise.resolve({
                    data: {
                      computation_status: "complete_with_warnings",
                      // 1s before the fake clock → fresh under any sane window.
                      computed_at: "2026-07-07T11:59:59.000Z",
                    },
                    error: null,
                  })
                : Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });

    render(<SyncPreviewStep {...baseProps} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Pre-fix (`=== "complete"`) this warned row is NOT fresh → the kickoff POST
    // fires. With isComputedAnalytics it short-circuits, so no sync POST occurs.
    const syncPosts = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/keys/sync"),
    );
    expect(syncPosts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// [UAT] Data-heavy slow-path copy + 15-minute retry threshold.
// A composite stitch over multi-year, multi-key history can legitimately run
// up to ~15 minutes. The WARN copy (60s+) now says so, and RETRY_THRESHOLD_MS
// moved 180_000 → 900_000 so the "taking much longer than expected" alarm no
// longer contradicts that promise at 3 minutes. This pins both.
// ---------------------------------------------------------------------------
describe("[UAT] SyncPreviewStep — data-heavy warn copy + 15-min retry threshold", () => {
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

  it("shows the data-heavy 15-min copy at 60s and holds the retry alarm past the old 3-min mark", async () => {
    // status="computing" forever → stays in the polling phase that renders the
    // slow-path copy while the elapsed clock advances.
    installSupabaseMock(() => ({ kind: "row", status: "computing" }));
    render(<SyncPreviewStep {...baseProps} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // WARN threshold (60s): the data-heavy 15-minute copy appears; no retry alarm.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(
      screen.getByText(/data-heavy operation and can take up to 15 minutes/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/taking much longer than expected/i),
    ).not.toBeInTheDocument();

    // Advance past the OLD 180s retry threshold (total ~205s) but well before
    // 15 min: the retry alarm STILL must not appear — proves RETRY_THRESHOLD_MS
    // moved 180_000 → 900_000 (with the old value this assertion would fail).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(144_000);
    });
    expect(
      screen.queryByText(/taking much longer than expected/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/up to 15 minutes/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// [94-03 / WIZ-05] Cached crawl snapshot + COMPLETE-composite durability skip.
//
// Pin 1 — a held cachedSnapshot short-circuits the mount effect BEFORE any
//   createClient()/strategy_analytics read or /api/keys/sync POST: back-nav to
//   sync_preview renders the cached result with zero re-crawl.
// Pin 2 — durability: a COMPLETE composite whose computed_at is older than the
//   5-min freshness window still SKIPS the kickoff (a finished stitch never
//   needs re-running merely to display — the hard-reload case).
// Pin 3 — byte-neutral: a COMPLETE-but-stale SINGLE-KEY row still POSTs
//   /api/keys/sync (the incremental re-sync stays desirable for single keys).
//
// RED before Task 2: (1) cachedSnapshot did not exist → the mount effect ran
// and POSTed; (2) the dq-flags read only ran on the FRESH path, so a stale
// complete composite fell through to the POST.
// ---------------------------------------------------------------------------
describe("[94-03/WIZ-05] SyncPreviewStep — cached snapshot + durability skip", () => {
  // A minimal single-key snapshot: enough to render the "passed" factsheet card
  // without any composite payload. The short-circuit is snapshot-shape-agnostic;
  // composite-ness on the cached path is exercised by the durability pin below.
  const CACHED_SNAPSHOT: SyncPreviewSnapshot = {
    tradeCount: 42,
    csvRowCount: 0,
    earliestTradeAt: "2025-01-01T00:00:00.000Z",
    latestTradeAt: "2025-02-01T00:00:00.000Z",
    detectedMarkets: ["BTC"],
    exchange: "binance",
    metrics: [],
    sparkline: [0.01, -0.02, 0.03],
    computedAt: "2025-02-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
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

  it("Pin 1 — cachedSnapshot renders the passed factsheet with no createClient read and no /api/keys/sync POST", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    // If the short-circuit fires, createClient() is never invoked, so the
    // factory (and therefore `from`) is never touched.
    const fromSpy = vi.fn();
    currentClientFactory = () => {
      fromSpy();
      return {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      };
    };

    render(<SyncPreviewStep {...baseProps} cachedSnapshot={CACHED_SNAPSHOT} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Reached "passed" directly from the cached snapshot.
    expect(
      screen.getByRole("heading", { name: /your verified factsheet is ready/i }),
    ).toBeInTheDocument();
    // No strategy_analytics read: createClient was never called.
    expect(fromSpy).not.toHaveBeenCalled();
    // No kickoff.
    const syncPosts = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/keys/sync"),
    );
    expect(syncPosts).toHaveLength(0);
  });

  it("Pin 2 — a COMPLETE composite 10 minutes old skips the kickoff (durability, no POST)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    // computed_at is 10 min old → STALE (window is 5 min). The dq marker says
    // composite → the finished stitch must NOT be re-kicked just to display.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    currentClientFactory = () => ({
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: () => {
              if (cols === "computation_status, computed_at") {
                return Promise.resolve({
                  data: { computation_status: "complete", computed_at: tenMinAgo },
                  error: null,
                });
              }
              if (cols === "data_quality_flags") {
                return Promise.resolve({
                  data: { data_quality_flags: { composite: true } },
                  error: null,
                });
              }
              // Status poll: stay computing so it holds in waiting_for_complete.
              return Promise.resolve({
                data: { computation_status: "computing", computation_error: null },
                error: null,
              });
            },
          }),
        }),
      }),
    });

    render(<SyncPreviewStep {...baseProps} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Walk a couple of poll ticks to be sure nothing re-posts later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    const syncPosts = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/keys/sync"),
    );
    expect(syncPosts).toHaveLength(0);
  });

  it("Pin 3 — a COMPLETE-but-stale SINGLE-KEY row still POSTs /api/keys/sync (byte-neutral)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    currentClientFactory = () => ({
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: () => {
              if (cols === "computation_status, computed_at") {
                return Promise.resolve({
                  data: { computation_status: "complete", computed_at: tenMinAgo },
                  error: null,
                });
              }
              if (cols === "data_quality_flags") {
                // Present row, NO composite marker → single-key: fall through.
                return Promise.resolve({
                  data: { data_quality_flags: {} },
                  error: null,
                });
              }
              return Promise.resolve({
                data: { computation_status: "computing", computation_error: null },
                error: null,
              });
            },
          }),
        }),
      }),
    });

    render(<SyncPreviewStep {...baseProps} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const syncPosts = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/keys/sync"),
    );
    expect(syncPosts).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 140.3-10 / SEAMUX-03 + SEAMUX-06 + TRAP-4.
//
// Before this plan EVERY non-2xx kickoff collapsed onto `SYNC_FAILED`, whose
// scripted cause is "We fetched your trades but the analytics computation did
// not complete." For a 429 that sentence is simply false — nothing was fetched
// and nothing ran. The route now names the fact on the wire; this step reads
// the name.
//
// It also closes B-22: `<WizardErrorEnvelope>` received no `onRetry`, so the
// shared renderer's `showRetry = recoverable && Boolean(onRetry)` was
// STRUCTURALLY false and a recoverable seam error rendered with no retry
// control at all.
// ══════════════════════════════════════════════════════════════════════════
describe("[140.3-10] SyncPreviewStep reads the kickoff's machine code", () => {
  beforeEach(() => {
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // This repo's known CI-only failure mode (CI Node 22 vs local Node 25) is a
    // leaked global stub; unstub unconditionally.
    vi.unstubAllGlobals();
  });

  it("a 429 renders the THROTTLE state, not SYNC_FAILED's 'we fetched your trades'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Too many requests", code: "RATE_LIMITED" }),
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(
      envelope,
      "The envelope's data-error-code is the machine-readable half of the " +
        "render — a copy rewrite in 140.3-12 must not be able to satisfy this.",
    ).toHaveAttribute("data-error-code", "RATE_LIMITED");

    // ⚠️ RE-POINTED by 140.3-12. This line used to read
    // `expect(screen.queryByText(/We fetched your trades/i)).toBeNull()`.
    // 140.3-12 deleted that sentence from the copy table entirely, so the
    // assertion became VACUOUS — a negative on a string that no longer exists
    // anywhere passes forever and can never falsify anything. (Same shape as
    // 140.3-11's M77c: an oracle asserting an absence cannot detect the
    // mechanism that produces absences.)
    //
    // Re-pointed at SYNC_FAILED's CURRENT distinctive phrase, so the guard
    // still fails if a 429 falls back to the generic sync failure, plus a
    // POSITIVE assertion that the throttle's own copy actually rendered.
    expect(screen.queryByText(/which step failed/i)).toBeNull();
    expect(
      screen.getByText(/we cap how often this action can run/i),
      "The positive half. Without it, a state rendering NEITHER copy would " +
        "satisfy every negative assertion in this case.",
    ).toBeInTheDocument();
  });

  it("a 429's advertised wait reaches the envelope — and is never fabricated when absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "RATE_LIMITED" }), {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    // 140.3-09 plumbed the slot; this is the first wizard surface to fill it.
    const wait = await screen.findByTestId("error-envelope-wait");
    expect(wait.textContent).toContain("60");
  });

  it("TRAP-3 — a 429 with NO Retry-After names no duration at all", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "RATE_LIMITED" }), { status: 429 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    await screen.findByTestId("error-envelope");
    expect(
      screen.queryByTestId("error-envelope-wait"),
      "No header in ⇒ no wait rendered. Not '0s', not 'shortly'. Inventing a " +
        "duration nobody stated is how a vague error becomes a specific lie.",
    ).toBeNull();
  });

  it("an unknowable composite membership renders its OWN state, not SYNC_FAILED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Could not start sync. Try again in a moment.",
          code: "COMPOSITE_MEMBERSHIP_UNKNOWN",
        }),
        { status: 503 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute(
      "data-error-code",
      "COMPOSITE_MEMBERSHIP_UNKNOWN",
    );
  });

  // ---------------------------------------------------------------------
  // Phase 140.3-15 / TS-20 — THE SECOND CONSUMER THAT HOLDS A SEAM BODY.
  //
  // `/api/keys/sync` does `if (!result.ok) return result.response`, so
  // `process-key-client`'s envelope — including its `correlation_id`, the id
  // that appears in OUR server logs — reaches this component verbatim. Until
  // now the envelope rendered only `getWizardCorrelationId()`, a value minted
  // in the browser and memoized per PAGE LOAD, which appears in no log
  // anywhere.
  //
  // \u26a0\ufe0f WIRED AT BOTH CONSUMERS, NOT ONE. SubmitStep is the obvious member
  // and it is the one a plan reading "the render slot" would fix; this file is
  // the SECOND, and it is where the mutation is aimed for exactly that reason.
  // POSITIVE identity assertions, per 140.3-11's M77c: a deleted carry and a
  // correctly-absent value both produce the local id, so each case names the
  // exact id that must appear AND the local id it must have displaced.
  // ---------------------------------------------------------------------

  it("[140.3-15 / TS-20] the kickoff failure renders the SERVER's correlation id, not the browser's", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "UPSTREAM_NETWORK_ERROR",
          human_message: "Could not reach the ingestion service.",
          correlation_id: "srv-5c2e91a4-70bd-4d33-9a18-6e0f2b7c8d55",
          recoverable: true,
        }),
        { status: 502 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    await screen.findByTestId("error-envelope");
    // POSITIVE: the server's own id is on screen.
    expect(
      screen.getByText("srv-5c2e91a4-70bd-4d33-9a18-6e0f2b7c8d55"),
    ).toBeInTheDocument();
    // ...and the browser's per-page-load id has been displaced. Without this
    // half a deleted carry passes: some id would still render.
    expect(
      screen.queryByText(/^wizard:[0-9a-f-]{36}$/),
      "The browser's own correlation id is still on screen. It appears in NO " +
        "server log, so a user quoting it gives support nothing to search.",
    ).toBeNull();
  });

  it("[140.3-15 / TS-20] a NESTED service_error envelope's id renders here too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "SCORING_FAILED",
            dependency: null,
            retryable: false,
            detail: "Scoring failed.",
            correlation_id: "srv-nested-1d9f4c07-2b56-4e8a-b311-90ac5d6e7f22",
          },
        }),
        { status: 500 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    await screen.findByTestId("error-envelope");
    expect(
      screen.getByText("srv-nested-1d9f4c07-2b56-4e8a-b311-90ac5d6e7f22"),
    ).toBeInTheDocument();
  });

  it("[140.3-15 / TS-20] FALLBACK: no id on the wire \u21d2 the browser's id still renders", async () => {
    // The fallback is what makes the change additive. A body with no
    // `correlation_id` must render exactly what it rendered before.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "compute failed" }), { status: 500 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    await screen.findByTestId("error-envelope");
    expect(
      screen.getByText(/^wizard:[0-9a-f-]{36}$/),
      "The fallback broke: a failure carrying no upstream id now renders no id " +
        "at all, which is strictly worse than before.",
    ).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("[140.3-15 / TS-20] a HOSTILE id is refused and the browser's id renders instead", async () => {
    // On the app-global handlers `correlation_id` is the caller-supplied
    // `x-correlation-id` header echoed back, and this value is rendered verbatim
    // into the DOM and copied to the clipboard by "Copy diagnostics".
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "RATE_LIMITED",
          correlation_id: "evil\r\nX-Forwarded-For: 10.0.0.1",
        }),
        { status: 429 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    await screen.findByTestId("error-envelope");
    expect(screen.getByText(/^wizard:[0-9a-f-]{36}$/)).toBeInTheDocument();
    expect(screen.queryByText(/X-Forwarded-For/)).toBeNull();
  });

  it("ANTI-REGRESSION — an UNCODED non-2xx still falls back to SYNC_FAILED", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "compute failed" }), { status: 500 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(
      envelope,
      "The map is deliberately PARTIAL. An unfamiliar or absent code must " +
        "reach the fallback, never a silent undefined error state.",
    ).toHaveAttribute("data-error-code", "SYNC_FAILED");
    errSpy.mockRestore();
  });

  it("ANTI-REGRESSION — an unrecognised code ALSO falls back to SYNC_FAILED", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "SOME_FUTURE_ARM" }), { status: 500 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "SYNC_FAILED");
    errSpy.mockRestore();
  });

  it("B-22 — a RECOVERABLE state now renders an actual Retry control", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "compute failed" }), { status: 500 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    await screen.findByTestId("error-envelope");
    expect(
      screen.getByRole("button", { name: "Retry" }),
      "SEAMUX-06: a recoverable seam error always offers a retry. This step " +
        "passed no onRetry, so the shared renderer's showRetry was " +
        "structurally false and the control could never appear.",
    ).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("B-22 — the Retry control actually RE-POSTS the kickoff", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "compute failed" }), {
          status: 500,
        }),
      );

    render(<SyncPreviewStep {...baseProps} />);
    await screen.findByTestId("error-envelope");

    const postsBefore = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/keys/sync"),
    ).length;

    await act(async () => {
      screen.getByRole("button", { name: "Retry" }).click();
    });

    await waitFor(() => {
      const postsAfter = fetchSpy.mock.calls.filter((c) =>
        String(c[0]).includes("/api/keys/sync"),
      ).length;
      expect(
        postsAfter,
        "A Retry button that renders and does nothing is worse than none — " +
          "it tells the user the outcome can change and it cannot.",
      ).toBe(postsBefore + 1);
    });
    errSpy.mockRestore();
  });

  it("a NON-recoverable state renders NO Retry — waiting cannot change the outcome", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Strategy not found", code: "GATE_DRAFT_GONE" }),
        { status: 404 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "GATE_DRAFT_GONE");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  // ⚠️ THE TRAP-4 FALSIFIER AT THIS RENDER. Deleting `errorStateIsDraftGone`
  // from SyncPreviewStep must redden this. Observed as M66c.
  it("TRAP-4 — the draft-gone state does NOT render the destructive control", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Strategy not found", code: "GATE_DRAFT_GONE" }),
        { status: 404 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);
    await screen.findByTestId("error-envelope");

    expect(
      screen.queryByTestId("wizard-try-another-key"),
      "'Try another key' fires WizardClient's handleDeleteDraft — it DESTROYS " +
        "the draft and every strategy_keys member under it. That is right for " +
        "a rejected key. It is not right as the ONLY thing on screen when we " +
        "have just told the user their draft is gone, because the 404 is " +
        "deliberately uniform across 'no such draft' and 'not yours' (P458) " +
        "and the draft may be perfectly intact.",
    ).toBeNull();
    // ...and the state is not a dead end either: a non-destructive way out is
    // present, which is the other half of the property.
    expect(
      screen.getByTestId("wizard-back-to-strategies"),
    ).toBeInTheDocument();
  });

  // ════════════════════════════════════════════════════════════════════
  // Phase 140.3-12 — the two 400 arms 140.3-10 left without wizard copy.
  // ════════════════════════════════════════════════════════════════════

  it.each([
    ["MISSING_STRATEGY_ID", "Missing strategy_id"],
    ["INVALID_STRATEGY_ID", "Invalid strategy_id"],
  ])(
    "a 400 %s renders VALIDATION_FAILED, not the generic SYNC_FAILED",
    async (code, error) => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error, code }), { status: 400 }),
      );

      render(<SyncPreviewStep {...baseProps} />);
      const envelope = await screen.findByTestId("error-envelope");

      // BOTH 400 arms are asserted separately rather than in one case: they are
      // two distinct wire codes on the same route, and the "5 of 8" signature
      // this programme keeps finding is exactly one of a pair being wired.
      expect(envelope).toHaveAttribute("data-error-code", "VALIDATION_FAILED");
      // The copy must NOT blame the analytics service — this rejection is made
      // by our own route before that service is ever called.
      expect(screen.queryByText(/analytics service rejected/i)).toBeNull();
      errSpy.mockRestore();
    },
  );

  it("TRAP-4 — the request-shape state does NOT render the destructive control", async () => {
    // ⚠️ THE GUARD THE 400 WIRING FORCED. VALIDATION_FAILED is non-recoverable,
    // so no Retry renders; without widening the destructive-control set the
    // SOLE button on screen would be "Try another key", which fires
    // handleDeleteDraft(). Telling a user our software sent an unreadable
    // request and offering them one button that destroys their draft is the
    // trap 140.3-10 closed for GATE_DRAFT_GONE, re-created one code over.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Invalid strategy_id",
          code: "INVALID_STRATEGY_ID",
        }),
        { status: 400 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);
    await screen.findByTestId("error-envelope");

    expect(
      screen.queryByTestId("wizard-try-another-key"),
      "Swapping the user's key cannot fix a bug in our own page, and this " +
        "control deletes the draft on its way.",
    ).toBeNull();
    expect(
      screen.getByTestId("wizard-back-to-strategies"),
      "A state with no way out at all is worse than a destructive one.",
    ).toBeInTheDocument();
    errSpy.mockRestore();
  });

  // ⚠️ 140.4-11 REPLACED "ANTI-REGRESSION — every OTHER error state keeps 'Try
  // another key'", whose CLAIM this plan inverts. That case asserted the
  // destructive control renders for SYNC_FAILED and that no exit link renders
  // beside it — i.e. it PINNED the [Retry, destructive] pairing TRAP-4 forbids.
  // Its legitimate half (the state is not a dead end, and the roster is not
  // applied blanket-wide) survives here, strictly stronger: it names the
  // machine-readable code, keeps the Retry pin, and additionally proves the
  // remaining way out destroys nothing.
  it("ANTI-REGRESSION — a transient state keeps its Retry and gains a NON-destructive exit", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "compute failed" }), { status: 500 }),
    );

    render(<SyncPreviewStep {...baseProps} />);
    const envelope = await screen.findByTestId("error-envelope");

    expect(envelope).toHaveAttribute("data-error-code", "SYNC_FAILED");
    // SYNC_FAILED asks for `clear_and_retry`, so the Retry is genuine and MUST
    // survive the inversion. A change that dropped every control from every
    // state would satisfy the two negatives below on their own.
    expect(
      screen.getByRole("button", { name: "Retry" }),
      "SEAMUX-06 still holds: a transient seam failure offers a retry.",
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("wizard-back-to-strategies"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("wizard-try-another-key"),
      "SYNC_FAILED's actions are clear_and_retry + request_call. Swapping the " +
        "key is not this state's remedy, and the control that would do it " +
        "deletes the draft on the way.",
    ).toBeNull();
    errSpy.mockRestore();
  });

  // ════════════════════════════════════════════════════════════════════
  // Phase 140.4-12 / SEAMRIM-08 — THIS ARM HAD NO TRANSLATION HOP AT ALL.
  //
  // `KNOWN_KICKOFF_CODES` indexes the RAW WIRE STRING. Its intersection with
  // the four seam wire codes — CIRCUIT_OPEN, UPSTREAM_TIMEOUT,
  // UPSTREAM_NETWORK_ERROR, SEAM_MISCONFIGURED — is EMPTY, so a breaker trip or
  // a dead upstream during the kickoff rendered SYNC_FAILED, whose sentence
  // asks the user "which step failed" about a computation that never started.
  // `SubmitStep` had the translation hop and this sibling never did.
  //
  // The remedy is the same structure as `SubmitStep`'s: translate through the
  // ONE table FIRST, fall back to `KNOWN_KICKOFF_CODES` for the wizard codes
  // OUR OWN route mints, then SYNC_FAILED. No member is added to either list.
  //
  // ⚠️ ORACLE INDEPENDENCE: `data-error-code` is the machine-readable half, and
  // every expected sentence below is a LITERAL typed here.
  // ════════════════════════════════════════════════════════════════════

  it("[140.4-12] a breaker trip (CIRCUIT_OPEN) renders the breaker's own state, not SYNC_FAILED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: "CIRCUIT_OPEN",
          human_message: "The analytics service is temporarily unavailable.",
          correlation_id: "corr-co-1",
        }),
        { status: 503 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(
      envelope,
      "CIRCUIT_OPEN is a WIRE code with no entry in KNOWN_KICKOFF_CODES, so " +
        "it fell to SYNC_FAILED — a sentence that claims we fetched trades " +
        "and the computation did not complete. The breaker declined to send " +
        "the request; nothing was fetched and nothing ran.",
    ).toHaveAttribute("data-error-code", "SERVICE_UNAVAILABLE_RETRY");

    expect(
      screen.getByText("Our service is temporarily unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/which step failed/i)).toBeNull();
  });

  it.each([
    ["UPSTREAM_TIMEOUT", 504],
    ["UPSTREAM_NETWORK_ERROR", 502],
  ])(
    "[140.4-12] a seam transport failure (%s) renders SERVICE_UNREACHABLE, not SYNC_FAILED",
    async (wireCode, status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: false, code: wireCode }), { status }),
      );

      render(<SyncPreviewStep {...baseProps} />);

      const envelope = await screen.findByTestId("error-envelope");
      expect(envelope).toHaveAttribute(
        "data-error-code",
        "SERVICE_UNREACHABLE",
      );
      expect(
        screen.getByText("We could not reach our own service."),
      ).toBeInTheDocument();
    },
  );

  it("[140.4-12] our own configuration fault (SEAM_MISCONFIGURED) reaches its own state", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, code: "SEAM_MISCONFIGURED" }),
        { status: 500 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "SEAM_MISCONFIGURED");
    expect(
      screen.getByText(
        "We could not send this request — our own configuration is wrong.",
      ),
    ).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("[140.4-12] the NESTED python envelope's code is read at this arm too", async () => {
    // `body.detail.code` is the shape every `service_error()` answer carries.
    // A top-level-only reader answers `undefined` here — byte-identical to a
    // body that carried no code at all, which is how 21 codes stay invisible.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "CIRCUIT_OPEN",
            dependency: null,
            retryable: true,
            detail: "Breaker open.",
            correlation_id: "srv-nested-co-8b2d1f40-6c93-4a55-b027-1e5f9a3c7d64",
          },
        }),
        { status: 503 },
      ),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(
      envelope,
      "The nested envelope carried CIRCUIT_OPEN and this arm did not see it. " +
        "The flat and nested shapes must produce the SAME state.",
    ).toHaveAttribute("data-error-code", "SERVICE_UNAVAILABLE_RETRY");
  });

  it.each([
    ["RATE_LIMITED", 429, "RATE_LIMITED"],
    ["GATE_DRAFT_GONE", 404, "GATE_DRAFT_GONE"],
    ["COMPOSITE_MEMBERSHIP_UNKNOWN", 503, "COMPOSITE_MEMBERSHIP_UNKNOWN"],
    ["MISSING_STRATEGY_ID", 400, "VALIDATION_FAILED"],
    ["INVALID_STRATEGY_ID", 400, "VALIDATION_FAILED"],
  ])(
    "[140.4-12] ANTI-REGRESSION: the pre-existing kickoff member %s still renders %s",
    async (wireCode, status, expected) => {
      // ⚠️ ALL FIVE MEMBERS OF `KNOWN_KICKOFF_CODES`, IN ONE PLACE. Putting the
      // translation hop AHEAD of this roster changes which lookup answers
      // first, so every pre-existing member is a candidate for being silently
      // re-pointed — `RATE_LIMITED` in particular is in BOTH tables and is now
      // answered by the translation rather than by the roster, with the same
      // outcome. Individually pinned above too; this case is the set-level
      // statement, so a sweep that re-pointed one member cannot hide behind the
      // four that still pass.
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ code: wireCode }), { status }),
      );

      render(<SyncPreviewStep {...baseProps} />);

      const envelope = await screen.findByTestId("error-envelope");
      expect(envelope).toHaveAttribute("data-error-code", expected);
      errSpy.mockRestore();
    },
  );

  it("[140.4-12] NEGATIVE CONTROL — a real seam wire code with no wizard member still falls back to SYNC_FAILED", async () => {
    // `SEAM_DEGRADED` is named in `SEAM_CODE_TO_WIZARD_CODE`'s own docblock as
    // the code an IDENTITY rule would silently admit. It is a genuine wire
    // code, not a garbled one — which is what makes it the sharp control. If
    // this ever renders `SEAM_DEGRADED`, the explicit table has been replaced
    // by a cast and both membership checks have been deleted rather than
    // re-scoped.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "SEAM_DEGRADED" }), { status: 503 }),
    );

    render(<SyncPreviewStep {...baseProps} />);

    const envelope = await screen.findByTestId("error-envelope");
    expect(envelope).toHaveAttribute("data-error-code", "SYNC_FAILED");
    errSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 140.4-11 / SEAMRIM-07 — TRAP-4 restated as a PROPERTY.
//
// The gate-sourced codes (`GATE_NO_DATA_SOURCE`, `GATE_INSUFFICIENT_TRADES`,
// `GATE_INSUFFICIENT_DAYS`) are NOT reachable from the kickoff arm the suite
// above drives: they are minted by `checkStrategyGate` at the END of the poll
// loop's heavy terminal fetch. Reaching them needs a client that serves the
// whole fan-out, which is what `installGateSupabaseMock` below is for. The
// mount effect takes the WIZ-05 fresh-complete skip (no kickoff POST at all),
// then one poll tick lands on the terminal branch.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Serve the ENTIRE single-key terminal fan-out so `checkStrategyGate` runs on
 * caller-chosen inputs. Every read resolves with `error: null` — this suite is
 * about which CONTROL renders for a gate verdict, not about read failures
 * (those are `SyncPreviewStep.readfailure.runtime.test.tsx`'s subject).
 */
function installGateSupabaseMock(opts: {
  tradeCount?: number;
  csvRowCount?: number;
  earliestTradeAt?: string | null;
  latestTradeAt?: string | null;
  status?: string;
  computationError?: string | null;
}) {
  const {
    tradeCount = 0,
    csvRowCount = 0,
    earliestTradeAt = null,
    latestTradeAt = null,
    status = "complete",
    computationError = null,
  } = opts;

  type Resolved = { data: unknown; count: number | null; error: null };

  const client = {
    from: (table: string) => ({
      select: (cols: string) => {
        // Mount effect — freshness probe. A COMPLETE + FRESH row takes the
        // WIZ-05 skip, so no /api/keys/sync POST fires and the component lands
        // straight in `waiting_for_complete`.
        if (cols === "computation_status, computed_at") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: "complete",
                    computed_at: new Date().toISOString(),
                  },
                  error: null,
                }),
            }),
          };
        }
        // Mount effect — composite marker. Present and NOT composite, so the
        // fresh-skip resolves to the single-key arm rather than failing closed.
        if (cols === "data_quality_flags") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { data_quality_flags: {} },
                  error: null,
                }),
            }),
          };
        }
        // Poll tick — terminal on a computed status.
        if (cols === "computation_status, computation_error") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: status,
                    computation_error: computationError,
                  },
                  error: null,
                }),
            }),
          };
        }

        // Heavy terminal fan-out. `ascending` is captured off the real
        // `.order()` call so the earliest/latest pair is discriminated the same
        // way production discriminates it, not by call ordering.
        let ascending = true;
        const resolve = (): Resolved => {
          if (table === "csv_daily_returns") {
            return { data: null, count: csvRowCount, error: null };
          }
          if (table === "trades" && cols === "id") {
            return { data: null, count: tradeCount, error: null };
          }
          if (table === "trades" && cols === "timestamp") {
            const ts = ascending ? earliestTradeAt : latestTradeAt;
            return {
              data: ts === null ? [] : [{ timestamp: ts }],
              count: null,
              error: null,
            };
          }
          // trade-symbol sample.
          return { data: [], count: null, error: null };
        };

        const node = {
          eq: () => node,
          neq: () => node,
          limit: () => node,
          order: (_col: string, o?: { ascending?: boolean }) => {
            ascending = o?.ascending !== false;
            return node;
          },
          // strategy_analytics metric columns + api_keys.exchange.
          maybeSingle: () =>
            Promise.resolve(
              table === "api_keys"
                ? { data: { exchange: "binance" }, error: null }
                : { data: null, error: null },
            ),
          then: (r: (v: Resolved) => void) => r(resolve()),
        };
        return node;
      },
    }),
  };

  currentClientFactory = () => client;
}

/** Mount, take the fresh-skip, and walk one poll tick into the gate verdict. */
async function renderThroughTheGate(props: SyncPreviewStepProps) {
  render(<SyncPreviewStep {...props} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
}

/**
 * Per-scenario fetch behaviour, swapped inside the derived loop below. ONE
 * `vi.spyOn` wraps it for the whole describe — re-spying the same global
 * mid-test is how a leaked stub survives into the next file, which is this
 * repo's known CI-only (Node 22 vs Node 25) failure class. The global-stubbing
 * helper DEF-16-1 bans is deliberately NOT NAMED here: an acceptance receipt
 * counts occurrences of that identifier in this file, and reciting it inside a
 * comment that says "we did not use it" is exactly how a grep stops
 * discriminating (DEF-16-2, and the third occurrence of that trap in this
 * programme).
 */
let fetchImpl: () => Promise<Response> = async () =>
  new Response(JSON.stringify({}), { status: 200 });

describe("[140.4-11] SyncPreviewStep — the destructive control must be EARNED", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    fetchImpl = async () => new Response(JSON.stringify({}), { status: 200 });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => fetchImpl());
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  // ⚠️ THE ONE VERIFIED VIOLATION (140.4 CONTEXT §4 / C-4). `GATE_NO_DATA_SOURCE`
  // is non-recoverable, so `ErrorEnvelope` renders no Retry; `request_call` and
  // `start_fresh` render no control at all. Before the inversion the SOLE thing
  // on screen was "Try another key", which fires WizardClient's
  // `handleDeleteDraft()` and cascades away every `strategy_keys` member. Its
  // `actions` are byte-identical to `GATE_DRAFT_GONE`'s — the code the old
  // exemption roster was written for — which is exactly why a roster is the
  // wrong mechanism: it was forgotten for the member that needed it most.
  it("[C-4] GATE_NO_DATA_SOURCE never offers the draft-deleting control as its sole way out", async () => {
    installGateSupabaseMock({ tradeCount: 0, csvRowCount: 0 });

    await renderThroughTheGate({ ...baseProps, apiKeyId: null });

    const envelope = screen.getByTestId("error-envelope");
    expect(
      envelope,
      "Drive check: this case is worthless unless the gate actually minted " +
        "GATE_NO_DATA_SOURCE. A fixture that silently produced some other " +
        "code would assert the property about the wrong state.",
    ).toHaveAttribute("data-error-code", "GATE_NO_DATA_SOURCE");

    expect(
      screen.queryByTestId("wizard-try-another-key"),
      "'Try another key' fires handleDeleteDraft() — it DESTROYS the draft " +
        "and every strategy_keys member under it. This state's own actions " +
        "are start_fresh + request_call: it never earned a control that " +
        "deletes anything, and it is the one code in the reachable set whose " +
        "ONLY control this was.",
    ).toBeNull();
    expect(
      screen.getByTestId("wizard-back-to-strategies"),
      "A state with no way out at all is worse than a destructive one.",
    ).toBeInTheDocument();
  });

  // ── The POSITIVE counterpart ────────────────────────────────────────────
  // A negative-only oracle is what M-9 measured going vacuous: a render that
  // dropped EVERY control from EVERY state would satisfy every "…is not the
  // sole affordance" assertion in this file. Some code must still EARN the
  // key-replacement route, and "this account has too little history, bring a
  // different one" is precisely the case where replacing the key IS the remedy.
  it("POSITIVE — GATE_INSUFFICIENT_TRADES DOES earn the key-replacement control", async () => {
    installGateSupabaseMock({ tradeCount: 0, csvRowCount: 0 });

    await renderThroughTheGate({ ...baseProps, apiKeyId: "key-1" });

    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "GATE_INSUFFICIENT_TRADES",
    );
    expect(
      screen.getByTestId("wizard-try-another-key"),
      "`try_another_key` is in this code's actions. If the inversion removed " +
        "the control everywhere it would satisfy every negative in this file " +
        "while destroying the wizard's primary recovery route.",
    ).toBeInTheDocument();
    // ...and it is still not the SOLE affordance.
    expect(screen.getByTestId("wizard-back-to-strategies")).toBeInTheDocument();
  });

  // ── The mislabelled `recoverable` ───────────────────────────────────────
  it("GATE_INSUFFICIENT_TRADES renders NO Retry — handleKickoffRetry re-evaluates an IDENTICAL gate", async () => {
    installGateSupabaseMock({ tradeCount: 0, csvRowCount: 0 });

    await renderThroughTheGate({ ...baseProps, apiKeyId: "key-1" });

    expect(screen.getByTestId("error-envelope")).toHaveAttribute(
      "data-error-code",
      "GATE_INSUFFICIENT_TRADES",
    );
    expect(
      screen.queryByRole("button", { name: "Retry" }),
      "This state IS `recoverable` — but it earns that flag through " +
        "`try_another_key`, a remedy `handleKickoffRetry` cannot perform. " +
        "That handler re-runs the kickoff and re-evaluates the SAME gate " +
        "against the SAME account, so the outcome is fixed before the click. " +
        "`recoverable` is MISLABELLED here, not spurious.",
    ).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════════
  // THE DERIVED PIN — the property, across every code this render can reach.
  //
  // HOW THE POPULATION IS DERIVED, and why it is not a roster in test
  // clothing: every row below is a production INPUT — an HTTP arm, a thrown
  // fetch, or a `checkStrategyGate` fixture — and the code under test is READ
  // BACK off the rendered envelope's `data-error-code`. The table never states
  // which code a scenario produces; production decides, and the pin follows.
  // Re-point `KNOWN_KICKOFF_CODES` or `gateFailureToWizardError` at a
  // different member and the population moves with it, silently and
  // correctly. A hand-typed list of eleven code strings is the roster problem
  // this plan just deleted from production, and it is how a twelfth code
  // ships unexamined.
  //
  // ⚠️ RESIDUAL, RECORDED NOT FIXED — `isComposite` is provably `false` on
  // every non-2xx kickoff (it is set only from a 2xx body's `composite: true`
  // or the WIZ-05 marker read), so `onReviewKeys` — the NON-destructive escape
  // hatch — was structurally unreachable on exactly the arms where the
  // destructive button appeared. `COMPOSITE_MEMBERSHIP_UNKNOWN`, a code ABOUT
  // composites, therefore rendered the SINGLE-KEY destructive control. This
  // plan did NOT change `isComposite`'s derivation: doing so changes what the
  // wizard believes about a draft mid-computation, which is a different
  // finding with a different blast radius. The residual after this plan is the
  // strictly smaller one — "a code about composites renders the single-key
  // affordance" — and that affordance is now NON-DESTRUCTIVE.
  // ══════════════════════════════════════════════════════════════════════

  /** Restore the client that does NOT take the WIZ-05 fresh-skip, so the mount effect POSTs. */
  function installKickoffClient() {
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  }

  /**
   * ⚠️ HAND-TYPED ON PURPOSE, and it is an ORACLE, not the population. These
   * are the codes a reader of `wizardErrors.ts` would say have asked to
   * replace the key. Deriving it (`actions.includes("try_another_key")`)
   * would compare production's answer to production's answer and could never
   * fail — Oracle Independence hazard #6 in its classic form.
   */
  const CODES_THAT_EARN_KEY_REPLACEMENT = [
    "GATE_INSUFFICIENT_TRADES",
    "GATE_INSUFFICIENT_DAYS",
  ];

  it("PROPERTY — no reachable terminal code renders the destructive control as its SOLE affordance", async () => {
    const scenarios: { input: string; drive: () => Promise<void> }[] = [
      {
        input: "kickoff 429 carrying a throttle code",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(JSON.stringify({ code: "RATE_LIMITED" }), {
              status: 429,
            });
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "kickoff 404 (uniform across 'no such draft' and 'not yours')",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(JSON.stringify({ code: "GATE_DRAFT_GONE" }), {
              status: 404,
            });
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "kickoff 503 on an unknowable composite membership",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(
              JSON.stringify({ code: "COMPOSITE_MEMBERSHIP_UNKNOWN" }),
              { status: 503 },
            );
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "kickoff 400 on a request shape our own route refused",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(JSON.stringify({ code: "INVALID_STRATEGY_ID" }), {
              status: 400,
            });
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "kickoff 500 with no machine code at all",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(JSON.stringify({ error: "compute failed" }), {
              status: 500,
            });
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "kickoff POST throws (offline)",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () => {
            throw new Error("offline");
          };
          await renderThroughTheGate({ ...baseProps });
        },
      },
      // ── 140.4-12 / SEAMRIM-08 — THE ENLARGED REACHABLE SET ──────────────
      // Making the kickoff arm translate before it membership-checks turns
      // four seam WIRE codes into codes that can reach `gate_failed`, so the
      // population this property is stated over grows. That is exactly the
      // interaction 140.4-11's pin has to absorb: a newly renderable code must
      // not arrive with a destructive sole affordance. The rows are INPUTS
      // (an HTTP arm and its body), never the code they produce — the code is
      // still read back off `data-error-code` below.
      {
        input: "kickoff 503 with the breaker's own wire code",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(JSON.stringify({ code: "CIRCUIT_OPEN" }), {
              status: 503,
            });
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "kickoff 504 on a seam transport deadline",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(JSON.stringify({ code: "UPSTREAM_TIMEOUT" }), {
              status: 504,
            });
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "kickoff 500 naming a configuration fault on our own side",
        drive: async () => {
          installKickoffClient();
          fetchImpl = async () =>
            new Response(JSON.stringify({ code: "SEAM_MISCONFIGURED" }), {
              status: 500,
            });
          await renderThroughTheGate({ ...baseProps });
        },
      },
      {
        input: "gate: keyless draft, no trades, no daily returns",
        drive: async () => {
          installGateSupabaseMock({ tradeCount: 0, csvRowCount: 0 });
          await renderThroughTheGate({ ...baseProps, apiKeyId: null });
        },
      },
      {
        input: "gate: keyless draft with a too-short daily-returns series",
        drive: async () => {
          installGateSupabaseMock({ tradeCount: 0, csvRowCount: 3 });
          await renderThroughTheGate({ ...baseProps, apiKeyId: null });
        },
      },
      {
        input: "gate: keyed account below the trade-count floor",
        drive: async () => {
          installGateSupabaseMock({ tradeCount: 0, csvRowCount: 0 });
          await renderThroughTheGate({ ...baseProps, apiKeyId: "key-1" });
        },
      },
      {
        input: "gate: keyed account with trades spanning under a week",
        drive: async () => {
          installGateSupabaseMock({
            tradeCount: 40,
            csvRowCount: 0,
            earliestTradeAt: "2026-01-01T00:00:00.000Z",
            latestTradeAt: "2026-01-03T00:00:00.000Z",
          });
          await renderThroughTheGate({ ...baseProps, apiKeyId: "key-1" });
        },
      },
      {
        input: "gate: a hard-failed analytics computation",
        drive: async () => {
          installGateSupabaseMock({
            status: "failed",
            computationError: "worker OOM",
          });
          await renderThroughTheGate({ ...baseProps, apiKeyId: "key-1" });
        },
      },
    ];

    const observed = new Map<string, string[]>();
    // 140.5-03 — counted SEPARATELY from `observed.size`. Two scenarios can
    // legitimately share a code (they do, since the kickoff catch and the
    // transport deadline both answer SERVICE_UNREACHABLE), and conflating
    // "rows that ran" with "codes seen" makes a shrinking reachable set
    // indistinguishable from a loop that stopped driving.
    let driven = 0;

    for (const scenario of scenarios) {
      await scenario.drive();

      const envelope = screen.getByTestId("error-envelope");
      driven += 1;
      const code = envelope.getAttribute("data-error-code");
      expect(
        code,
        `The scenario "${scenario.input}" rendered an envelope with no code. ` +
          "A row that cannot name its state cannot pin a property about it.",
      ).toBeTruthy();

      const controls: string[] = [];
      if (screen.queryByRole("button", { name: "Retry" })) controls.push("retry");
      if (screen.queryByTestId("wizard-try-another-key")) {
        controls.push("key-replacement");
      }
      if (screen.queryByTestId("wizard-back-to-strategies")) {
        controls.push("back-to-strategies");
      }

      // THE PROPERTY. Not "has ≥2 controls" — a state may legitimately offer
      // only the non-destructive exit. The forbidden shape is the FORCED
      // CHOICE: the one thing on screen deletes the draft and every
      // strategy_keys member under it.
      expect(
        controls,
        `${code} (via "${scenario.input}") offers the draft-deleting control ` +
          "as its SOLE affordance. That is a forced choice, not a remedy: " +
          "the only way forward destroys the user's work.",
      ).not.toEqual(["key-replacement"]);

      // ...and the destructive control appears ONLY where the code earned it.
      if (controls.includes("key-replacement")) {
        expect(
          CODES_THAT_EARN_KEY_REPLACEMENT,
          `${code} rendered the key-replacement control. That control fires ` +
            "handleDeleteDraft(). Only a code whose own remedy is 'bring a " +
            "different key' has asked for it.",
        ).toContain(code);
      }

      observed.set(code as string, controls);
      cleanup();
      vi.clearAllTimers();
    }

    // ── VACUITY FENCE ───────────────────────────────────────────────────
    // A scanner that drove nothing would report agreement forever. ELEVEN
    // distinct codes reached this render when 140.4-11 wrote this pin (140.4
    // CONTEXT §4, independently re-derived by the pattern-mapper); 140.4-12
    // raised it to FOURTEEN by making the kickoff arm translate before it
    // membership-checks, which admits SERVICE_UNAVAILABLE_RETRY,
    // SERVICE_UNREACHABLE and SEAM_MISCONFIGURED. The literals are hand-typed —
    // never `scenarios.length`, which would measure the loop against itself.
    //
    // ⚠️ 140.5-03 — THE DISTINCT-CODE FLOOR CAME DOWN TO THIRTEEN, AND THAT IS
    // NOT A LOOSENING. Read this before "restoring" 14.
    //
    // The kickoff CATCH used to render `KEY_NETWORK_TIMEOUT` — "We could not
    // reach the exchange" — for a POST to OUR OWN route that never completed.
    // 140.5-03 replaced it with `SERVICE_UNREACHABLE`, which the "kickoff 504
    // on a seam transport deadline" row ALREADY produces. Two scenarios now
    // land on ONE code, so the DISTINCT count is honestly 13 while the number
    // of scenarios driven is unchanged at 14. `KEY_NETWORK_TIMEOUT` is no
    // longer a reachable terminal code at this surface at all — that is the
    // point of the change, and a floor of 14 would pin this pin to a false
    // attribution.
    //
    // ⭐ THE FENCE IS STRICTLY STRONGER FOR IT. A collapsing distinct-code
    // count is exactly what a loop going blind ALSO looks like, so the two are
    // now separated: `driven` counts scenarios that actually rendered an
    // envelope and is pinned at the full 14, which no code-level collapse can
    // satisfy. Lower `driven` only when a scenario is genuinely deleted.
    expect(
      driven,
      "Fewer than fourteen scenarios actually rendered an envelope. A loop " +
        "that renders nothing satisfies every assertion inside it and reports " +
        "agreement forever — which is worse than having no guard at all.",
    ).toBeGreaterThanOrEqual(14);
    expect(
      observed.size,
      "Fewer than thirteen DISTINCT codes were driven. Two scenarios share " +
        "SERVICE_UNREACHABLE since 140.5-03 (the transport deadline and the " +
        "kickoff catch), so 13 is the honest distinct-code floor; anything " +
        "below it means rows stopped reaching the codes they name.",
    ).toBeGreaterThanOrEqual(13);

    // The forced choice must be absent from the WHOLE observed set, stated
    // once more as a set-level claim so a per-row `continue` cannot hide it.
    const forced = [...observed.entries()].filter(
      ([, controls]) =>
        controls.length === 1 && controls[0] === "key-replacement",
    );
    expect(forced.map(([code]) => code)).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 140.4-12 / SEAMRIM-11 (C-3) — THE RESUME FRESHNESS PROBE.
//
// The LAST unchecked PostgREST read in this file, and the one 140.4-02's
// seven-member conversion never reached: it sits ~530 lines ABOVE that
// `Promise.all`, in the mount effect. 140.4-14's `no-unchecked-supabase-read`
// rule reports it as its single true positive, which is why that rule's glob
// could not admit this file.
//
// ⚠️ A READ FAILURE AND AN ABSENT ROW ARE DIFFERENT FACTS, AND THAT IS THE
// WHOLE POINT. `.maybeSingle()` answers a genuinely missing row with
// `{ data: null, error: null }` — the normal first-time-draft case this probe
// EXISTS to detect. An RLS denial or a statement timeout answers
// `{ data: null, error: <PostgrestError> }`. Unchecked, the two were
// byte-identical here: both silently produced `isComplete === false` and
// nothing anywhere recorded that a read had failed.
//
// Both polarities are pinned. Asserting only the failure half would be
// satisfied by an implementation that logged unconditionally — which would
// re-label every legitimate absence as a fault and is the over-refusal
// 140.4-01 carved PGRST116 out to avoid.
// ══════════════════════════════════════════════════════════════════════════

describe("[140.4-12 / SEAMRIM-11] SyncPreviewStep — the resume freshness probe binds error", () => {
  /**
   * The needle, HAND-TYPED here and never imported from the component. It
   * names the READ, so a log that fired from some other site cannot satisfy
   * it.
   */
  const READ_FAILURE_NEEDLE = "resume freshness probe read failed";

  /** Freshness probe answers `outcome`; everything else is inert. */
  function installProbeClient(outcome: { data: unknown; error: unknown }) {
    currentClientFactory = () => ({
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve(
                cols === "computation_status, computed_at"
                  ? outcome
                  : { data: null, error: null },
              ),
          }),
        }),
      }),
    });
  }

  function loggedReadFailures(spy: {
    mock: { calls: unknown[][] };
  }): unknown[][] {
    return spy.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes(READ_FAILURE_NEEDLE),
    );
  }

  beforeEach(() => {
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installProbeClient({ data: null, error: null });
  });

  it("a FAILED freshness probe is REPORTED — not silently read as 'this draft has no analytics row'", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installProbeClient({
      data: null,
      error: {
        message: "canceling statement due to statement timeout",
        code: "57014",
        details: "",
        hint: "",
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "compute failed" }), {
          status: 500,
        }),
      );

    render(<SyncPreviewStep {...baseProps} />);
    await screen.findByTestId("error-envelope");

    expect(
      loggedReadFailures(errSpy).length,
      "The freshness probe read FAILED and nothing recorded it. supabase-js " +
        "resolves a failed read AS A VALUE, so an unbound `error` makes a " +
        "statement timeout indistinguishable from a draft that simply has no " +
        "analytics row yet — the C-3 shape, at the last unchecked read in " +
        "this file.",
    ).toBe(1);

    // ...and the resume degrades to a COLD START rather than to a terminal
    // state. This half is the anti-over-refusal guard: the probe is an
    // OPTIMISATION (skip the kickoff when the row is complete and fresh), so a
    // transient blip on it must not end the wizard. A fix that threw here
    // would pass the assertion above and fail this one.
    expect(
      fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/keys/sync"))
        .length,
      "A failed freshness probe must fall through to the kickoff POST — the " +
        "same thing a cold start does. Refusing instead would be a " +
        "self-inflicted outage on a read that only ever saves a round-trip.",
    ).toBe(1);
    errSpy.mockRestore();
  });

  it("an ABSENT analytics row stays SILENT — an absence is not a failure", async () => {
    // `.maybeSingle()` on zero rows: `data: null, error: null`. This is the
    // ordinary first-time-draft path. It must produce no fault signal at all,
    // or the log becomes noise and the distinction the fix exists to draw is
    // erased from the other side.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installProbeClient({ data: null, error: null });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "compute failed" }), {
          status: 500,
        }),
      );

    render(<SyncPreviewStep {...baseProps} />);
    await screen.findByTestId("error-envelope");

    expect(
      loggedReadFailures(errSpy),
      "A genuinely absent analytics row was reported as a read failure. " +
        "`maybeSingle()` answers no-rows with `error: null`; treating that as " +
        "a fault re-labels every first-time draft as broken.",
    ).toEqual([]);
    expect(
      fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/keys/sync"))
        .length,
    ).toBe(1);
    errSpy.mockRestore();
  });

  it("a COMPLETE + FRESH row still takes the WIZ-05 skip — the probe's success path is untouched", async () => {
    // The positive counterpart. Both assertions above are about what happens
    // when the probe returns nothing usable; without this case an
    // implementation that ignored `data` entirely would satisfy both.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    installProbeClient({
      data: {
        computation_status: "complete",
        computed_at: new Date().toISOString(),
      },
      error: null,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    render(<SyncPreviewStep {...baseProps} />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: /computing your verified factsheet/i,
        }),
      ).toBeInTheDocument(),
    );

    expect(
      fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/keys/sync"))
        .length,
      "A COMPLETE + FRESH row must still skip the kickoff. If the freshness " +
        "derivation moved behind the new error branch, this is what notices.",
    ).toBe(0);
    expect(loggedReadFailures(errSpy)).toEqual([]);
    errSpy.mockRestore();
  });
});
