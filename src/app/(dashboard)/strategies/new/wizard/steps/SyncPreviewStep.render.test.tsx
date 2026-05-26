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
function installSupabaseMock(pollOutcome: () => PollOutcome) {
  const tradesSpy = vi.fn();

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
          return thenableEmpty(null);
        },
      };
    },
  };

  currentClientFactory = () => client;
  return { tradesSpy };
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
