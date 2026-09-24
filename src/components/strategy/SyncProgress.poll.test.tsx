/** @vitest-environment jsdom */
/**
 * CHARACTERIZATION — pins the pre-#46 poll-loop behavior.
 * Plan 95-05 (useStrategySyncPoller extraction) must keep this file GREEN WITH
 * ZERO EDITS. Do not update these pins to match new behavior; new behavior is a
 * regression.
 *
 * Scope: the `SyncProgress` status poll loop that `SyncProgress.test.ts` does
 * NOT cover. That sibling pins ONLY the pure `toSyncStatus` mapping; the loop
 * itself — 3s cadence (`setInterval(pollStatus, 3000)`), the 120s cap
 * (`POLL_MAX_ATTEMPTS = 40`), the 30s missing-row grace
 * (`MISSING_ROW_GRACE_POLLS = 10`), the counter reset on re-activation
 * (`pollAttemptsRef.current = 0`), the `onStatusChange` forwarding filter, and
 * the NO-consecutive-error-escalation asymmetry — had ZERO coverage. This file
 * is the Wave-0 blocker that makes 95-05's zero-edit green-diff parity provable.
 *
 * These assertions characterize what the code CURRENTLY does (SyncProgress.tsx),
 * not what it ideally should. They must pass against the UNMODIFIED component.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { SyncProgress, type EvidenceBaseline, type SyncStatus } from "./SyncProgress";

// ---------------------------------------------------------------------------
// Supabase client mock.
//
// `SyncProgress` issues three distinct `.from(table).select(...).eq(...).single()`
// chains: `strategies` and `api_keys` (the exchange-name fetch effect,
// SyncProgress.tsx:148-186) and `strategy_analytics` (the poll, :213-267). The
// mock dispatches on table name. `strategy_analytics` reads a MUTABLE
// `analyticsResult` the test drives per-poll and bumps a select counter so the
// cadence pins can count poll ticks precisely.
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => ({
  analyticsResult: { data: null, error: null } as {
    data: unknown;
    error: unknown;
  },
  analyticsSelectCount: 0,
  /**
   * Phase 167.2 / KCS-18: the answers `/api/strategies/[id]/sync-progress`
   * gives, one per request, in order. An empty queue answers a real read with
   * jobStatus `done`, so a success case that does not care about the job state
   * (PIN 5, PIN 5c) sees "nothing in flight".
   */
  jobAnswers: [] as Array<() => Promise<unknown>>,
  jobReadCount: 0,
}));

/** Phase 167.2 / KCS-18: a sync-progress answer with this body and HTTP status. */
function jobRead(body: unknown, status = 200) {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
}

/** A real (not degraded) projection read naming this factsheet-chain job status. */
function jobState(jobStatus: string | null) {
  return jobRead({ jobStatus, stalled: false, memberProgress: [] });
}

const fetchMock = vi.fn((url: string) => {
  if (/^\/api\/strategies\/[^/]+\/sync-progress$/.test(url)) {
    mockState.jobReadCount += 1;
    const next = mockState.jobAnswers.shift() ?? jobState("done");
    return next();
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`));
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => {
            if (table === "strategies") {
              return Promise.resolve({
                data: { api_key_id: "key-1" },
                error: null,
              });
            }
            if (table === "api_keys") {
              return Promise.resolve({
                data: { exchange: "deribit" },
                error: null,
              });
            }
            // strategy_analytics — the poll under characterization.
            mockState.analyticsSelectCount += 1;
            return Promise.resolve(mockState.analyticsResult);
          },
        }),
      }),
    }),
  }),
}));

// --- Helpers ---------------------------------------------------------------

/** A present, non-terminal-or-terminal analytics row keyed by DB status. */
function analyticsRow(status: string, computedAt: string | null = null) {
  return {
    data: {
      computation_status: status,
      computation_error: null,
      computed_at: computedAt,
    },
    error: null,
  };
}

// Phase 167.2 / KCS-02: a synthetic server-written computed_at for a row this
// attempt's job wrote (it differs from a `{ computedAt: null }` baseline).
const T1 = "2026-04-19T12:03:00.000000+00:00";

const baseProps = {
  strategyId: "strat-1",
  lastSyncAt: null,
  syncError: null,
  onRetry: vi.fn(),
};

/**
 * Render the real `SyncProgress`. Returns the RTL `rerender` plus the
 * `onStatusChange` spy so pins can assert forwarded transitions.
 */
function renderPoller(syncStatus: SyncStatus, evidenceBaseline?: EvidenceBaseline) {
  const onStatusChange = vi.fn();
  const { rerender } = render(
    <SyncProgress
      {...baseProps}
      syncStatus={syncStatus}
      onStatusChange={onStatusChange}
      evidenceBaseline={evidenceBaseline}
    />,
  );
  const rerenderStatus = (next: SyncStatus) =>
    rerender(
      <SyncProgress {...baseProps} syncStatus={next} onStatusChange={onStatusChange} />,
    );
  return { onStatusChange, rerenderStatus };
}

/** Advance fake timers inside act so poll promises + setState settle. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** How many times `onStatusChange` was called with a specific value. */
function callsWith(spy: ReturnType<typeof vi.fn>, value: string) {
  return spy.mock.calls.filter(([v]) => v === value).length;
}

const POLL_MS = 3000;

beforeEach(() => {
  vi.useFakeTimers();
  mockState.analyticsResult = { data: null, error: null };
  mockState.analyticsSelectCount = 0;
  mockState.jobAnswers = [];
  mockState.jobReadCount = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ===========================================================================
// Task 1 — timing pins (cadence, grace, cap, counter reset)
// ===========================================================================
describe("SyncProgress poll loop — timing (characterization)", () => {
  it("PIN 1 — CADENCE: one strategy_analytics select per 3s tick", async () => {
    renderPoller("computing");
    // Flush mount effects (exchange fetch); the poll interval has not fired yet.
    await tick(0);
    expect(mockState.analyticsSelectCount).toBe(0);

    await tick(POLL_MS);
    expect(mockState.analyticsSelectCount).toBe(1);

    await tick(POLL_MS * 2);
    expect(mockState.analyticsSelectCount).toBe(3);
  });

  it("PIN 2 — MISSING-ROW GRACE: 10 polls tolerated, 11th escalates once", async () => {
    // Moved by Phase 167.2 / KCS-22: a give-up ends the attempt as "no_result", not "error" (the timing is unchanged).
    // PGRST116 = 0 rows via .single() (the expected 'row not yet created' case).
    mockState.analyticsResult = { data: null, error: { code: "PGRST116" } };
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    // Polls 1..10 (SyncProgress.tsx:244 — attempts > 10 is false): silent.
    await tick(POLL_MS * 10);
    expect(callsWith(onStatusChange, "no_result")).toBe(0);

    // Poll 11 (attempts = 11 > MISSING_ROW_GRACE_POLLS): escalates exactly once.
    await tick(POLL_MS);
    expect(callsWith(onStatusChange, "no_result")).toBe(1);
  });

  it("PIN 3 — 120s CAP: 40 polls with a present row never error, 41st does", async () => {
    // Moved by Phase 167.2 / KCS-22: a give-up ends the attempt as "no_result", not "error" (the timing is unchanged).
    // A present, non-terminal row so the grace path (:243) never fires and the
    // ONLY escalation source is the outer cap (:216).
    mockState.analyticsResult = analyticsRow("computing");
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    // Polls 1..40 forward "computing" but never escalate (attempts !> 40).
    await tick(POLL_MS * 40);
    expect(callsWith(onStatusChange, "no_result")).toBe(0);
    expect(callsWith(onStatusChange, "computing")).toBe(40);

    // Poll 41 (attempts = 41 > POLL_MAX_ATTEMPTS): escalates before the query,
    // so the select counter does NOT advance on this tick.
    const beforeCount = mockState.analyticsSelectCount;
    await tick(POLL_MS);
    expect(callsWith(onStatusChange, "no_result")).toBe(1);
    expect(onStatusChange.mock.calls.at(-1)).toEqual(["no_result", { stopReason: "poll_cap" }]);
    expect(callsWith(onStatusChange, "error")).toBe(0);
    expect(mockState.analyticsSelectCount).toBe(beforeCount);
  });

  it("PIN 4 — COUNTER RESET: re-activation restarts the attempt counter (:272)", async () => {
    // Moved by Phase 167.2 / KCS-22: a give-up ends the attempt as "no_result", not "error" (the timing is unchanged).
    mockState.analyticsResult = { data: null, error: { code: "PGRST116" } };
    const { onStatusChange, rerenderStatus } = renderPoller("computing");
    await tick(0);

    // Drive 5 missing-row polls (attempts 1..5 — below the grace boundary).
    await tick(POLL_MS * 5);
    expect(callsWith(onStatusChange, "no_result")).toBe(0);

    // Go inactive (interval cleared), then active again (pollAttemptsRef = 0).
    rerenderStatus("complete");
    await tick(0);
    rerenderStatus("computing");
    await tick(0);

    // 10 more missing-row polls. If the counter had NOT reset, attempts would
    // run 6..15 and escalate at the 6th tick; a fresh 1..10 stays silent.
    await tick(POLL_MS * 10);
    expect(callsWith(onStatusChange, "no_result")).toBe(0);
  });
});

// ===========================================================================
// Task 2 — semantic pins (forwarding contract, asymmetry, inactivity)
// ===========================================================================
describe("SyncProgress poll loop — forwarding contract (characterization)", () => {
  // Moved by Phase 167.2 / KCS-02: a terminal is forwarded only with this
  // attempt's evidence. Lineage: this pin rendered with no baseline and a row
  // carrying computed_at null, and asserted every DB terminal was forwarded on
  // the first read. That is exactly the previous run's row the gate now drops
  // (PIN 5b). Each row now carries this attempt's evidence (b): a computed_at
  // that differs from a known `{ computedAt: null }` baseline. The mapping it
  // characterizes (toSyncStatus through the forward filter) is unchanged.
  it.each([
    ["computing", "computing"],
    ["complete", "complete"],
    ["complete_with_warnings", "complete_with_warnings"],
    ["failed", "error"],
  ])(
    "PIN 5 — FORWARDED: DB %s maps to onStatusChange(%s)",
    async (dbStatus, uiStatus) => {
      mockState.analyticsResult = analyticsRow(dbStatus, T1);
      const { onStatusChange } = renderPoller("computing", { computedAt: null });
      await tick(0);
      await tick(POLL_MS);
      expect(callsWith(onStatusChange, uiStatus)).toBe(1);
    },
  );

  it("PIN 5b — NO-EVIDENCE: with an unknown baseline and no computing read, a terminal is never forwarded (KCS-02)", async () => {
    // The previous run's `complete` row, as the poll reads it for the whole first
    // hop of a resync. Neither piece of evidence exists, so nothing is forwarded
    // and the loop keeps reading.
    mockState.analyticsResult = analyticsRow("complete", T1);
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    await tick(POLL_MS * 5);
    expect(mockState.analyticsSelectCount).toBe(5);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("PIN 5c — COMPUTING-ADMITS: one computing read, then complete: computing forwarded, then complete forwarded once (KCS-02)", async () => {
    mockState.analyticsResult = analyticsRow("computing");
    const { onStatusChange } = renderPoller("computing");
    await tick(0);
    await tick(POLL_MS);
    expect(onStatusChange.mock.calls).toEqual([["computing"]]);

    mockState.analyticsResult = analyticsRow("complete");
    await tick(POLL_MS);
    expect(onStatusChange.mock.calls).toEqual([["computing"], ["complete"]]);
  });

  it("PIN 6 — NON-PROPAGATION: DB 'pending' (UI 'idle') is never forwarded", async () => {
    // toSyncStatus('pending') === 'idle', which is NOT in the forward filter
    // (SyncProgress.tsx:259-266) — the caller already primed 'computing'.
    mockState.analyticsResult = analyticsRow("pending");
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    await tick(POLL_MS * 5);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("PIN 7 — NO CONSECUTIVE-ERROR ESCALATION: a non-PGRST116 error consumes grace like a missing row", async () => {
    // Moved by Phase 167.2 / KCS-22: a give-up ends the attempt as "no_result", not "error" (the timing is unchanged).
    // Load-bearing asymmetry vs the wizard's MAX_CONSECUTIVE_POLL_ERRORS=3
    // (95-RESEARCH Pitfall 6): SyncProgress has NO consecutive-error counter.
    // A Supabase error with data:null falls through the same `if (!data)` grace
    // gate — no immediate escalation, no throw.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.analyticsResult = {
      data: null,
      error: { code: "500", message: "boom" },
    };
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    // 3 consecutive errors — where a =3 consecutive-error rule would trip.
    await tick(POLL_MS * 3);
    expect(onStatusChange).not.toHaveBeenCalled();

    // Still silent right up to the grace boundary (polls 4..10).
    await tick(POLL_MS * 7);
    expect(callsWith(onStatusChange, "no_result")).toBe(0);

    // Escalation happens ONLY at the missing-row grace boundary (poll 11).
    await tick(POLL_MS);
    expect(callsWith(onStatusChange, "no_result")).toBe(1);
    errSpy.mockRestore();
  });

  it("PIN 8 — INACTIVE = NO POLLING: a terminal status never selects analytics", async () => {
    renderPoller("complete");
    await tick(0);
    await tick(30_000);
    expect(mockState.analyticsSelectCount).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PIN 9 (154-04) — SIBLING REGRESSION for the shared-hook edit.
  //
  // Plan 154-04 changes `useStrategySyncPoller`'s LADDER arm so a clean
  // `{data:null,error:null}` read stops becoming the fabricated status
  // "pending". That hook is shared: this component is its OTHER consumer
  // (interval arm), so the edit reaches here whether or not anyone looked.
  //
  // The shape matters. PIN 2 above drives the missing row as PGRST116 — an
  // error-as-value. This case drives the EXACT shape the ladder fix is about:
  // a SUCCESSFUL read (`error: null`) that found nothing. The interval arm has
  // always folded that into the same `if (!data)` grace gate, and it must still
  // do so: nothing forwarded through the grace window, escalation exactly once
  // at the boundary, and NO consecutive-error escalation on the way (the
  // asymmetry vs the wizard that PIN 7 pins for the error-valued shape).
  // ═══════════════════════════════════════════════════════════════════════
  it("PIN 9 — CLEAN ZERO-ROWS: {data:null,error:null} consumes grace unchanged (interval arm, 154-04)", async () => {
    // Moved by Phase 167.2 / KCS-22: a give-up ends the attempt as "no_result", not "error" (the timing is unchanged).
    // PostgREST's zero-rows answer with NO error — not PGRST116, not a throw.
    mockState.analyticsResult = { data: null, error: null };
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    // Polls 1..3 — where the wizard's =3 consecutive-error rule would trip if
    // the two facts (absent row vs failed read) were ever conflated.
    await tick(POLL_MS * 3);
    expect(onStatusChange).not.toHaveBeenCalled();

    // Polls 4..10 — still inside the grace window: no status, no escalation.
    await tick(POLL_MS * 7);
    expect(callsWith(onStatusChange, "no_result")).toBe(0);
    expect(onStatusChange).not.toHaveBeenCalled();

    // Poll 11 — the grace boundary, and the ONLY escalation source here.
    await tick(POLL_MS);
    expect(callsWith(onStatusChange, "no_result")).toBe(1);

    // The read DID happen on every tick — otherwise the absences above would be
    // satisfied by a loop that never ran.
    expect(mockState.analyticsSelectCount).toBe(11);
  });
});

// ===========================================================================
// Phase 167.2 / KCS-18 — the job-state check before a terminal SUCCESS.
//
// RESEARCH P1: the SQL status bridge keeps a `complete_with_warnings` row at
// that status while the chain's jobs run, and still moves `computed_at` on
// every hop. So a warned strategy's resync reads `complete_with_warnings` with
// a NEW computed_at (KCS-02 evidence b) while the next hop is still `pending`.
// The analytics row cannot tell that apart from the finished run; the job
// queue can. A success is forwarded only on a readable "nothing in flight".
// ===========================================================================
describe("SyncProgress — a terminal success waits for the job queue (Phase 167.2 / KCS-18)", () => {
  const T0 = "2026-04-19T11:58:00.000000+00:00";

  it("WARNED-ROW-MID-CHAIN: a warned row re-stamped mid-chain is not forwarded while the chain job is pending, then forwarded once it is done", async () => {
    // Baseline: the previous run ended complete_with_warnings at T0. The poll
    // reads the same status at T1 (evidence b holds) with the job still pending.
    mockState.analyticsResult = analyticsRow("complete_with_warnings", T1);
    mockState.jobAnswers = [jobState("pending"), jobState("done")];
    const { onStatusChange } = renderPoller("computing", { computedAt: T0 });
    await tick(0);

    await tick(POLL_MS);
    expect(mockState.jobReadCount).toBe(1);
    expect(
      onStatusChange,
      "a mid-chain warned row was shown as this attempt's finished result",
    ).not.toHaveBeenCalled();

    // The poll keeps reading, and the next evidenced tick asks the queue again.
    await tick(POLL_MS);
    expect(mockState.analyticsSelectCount).toBe(2);
    expect(mockState.jobReadCount).toBe(2);
    expect(onStatusChange.mock.calls).toEqual([["complete_with_warnings"]]);
  });
});

// ===========================================================================
// Phase 167.2 / KCS-18 — the job-state check fails closed on the claim. Every
// answer that is not a readable "nothing in flight" keeps the panel computing
// (plan 04's poll cap still applies); none of them throws or piles up reads.
// ===========================================================================
describe("SyncProgress — the job-state check fails closed (Phase 167.2 / KCS-18)", () => {
  const T0 = "2026-04-19T11:58:00.000000+00:00";

  /** An evidenced `complete` (computed_at moved from the T0 baseline) under the poll. */
  function renderEvidencedComplete() {
    mockState.analyticsResult = analyticsRow("complete", T1);
    return renderPoller("computing", { computedAt: T0 });
  }

  function deferredAnswer() {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((r) => {
      resolve = r;
    });
    return { answer: () => promise, resolve };
  }

  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("DEGRADED-HOLDS: the route's degraded body (jobStatus null, degraded true) is not a success", async () => {
    // The DEGRADED body carries jobStatus null, which a real read would let
    // through; only `degraded: true` says the queue could not be read.
    const degraded = jobRead({ jobStatus: null, stalled: false, memberProgress: [], degraded: true });
    mockState.jobAnswers = [degraded, degraded, degraded];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS * 3);
    expect(mockState.analyticsSelectCount).toBe(3);
    expect(mockState.jobReadCount).toBe(3);
    expect(onStatusChange, "a degraded read was taken as nothing in flight").not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP-429-HOLDS", 429],
    ["HTTP-500-HOLDS", 500],
  ])("%s: a %i answer is not a success, and the poll continues", async (_name, status) => {
    // A limiter or server answer can carry a JSON body shaped like a real read.
    const refused = jobRead({ jobStatus: "done", stalled: false, memberProgress: [] }, status);
    mockState.jobAnswers = [refused, refused];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS * 2);
    expect(mockState.jobReadCount).toBe(2);
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[SyncProgress]"),
      `HTTP ${status}`,
    );
  });

  it("NON-JSON-HOLDS: a body that fails to parse is not a success, and no throw escapes", async () => {
    const htmlPage = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });
    mockState.jobAnswers = [htmlPage, htmlPage];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS * 2);
    expect(mockState.jobReadCount).toBe(2);
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an array", []],
    ["null", null],
    ["an object without jobStatus", { stalled: false, memberProgress: [] }],
  ])("NON-OBJECT-HOLDS: %s is not the projection, so it is not a success", async (_name, body) => {
    mockState.jobAnswers = [jobRead(body)];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS);
    expect(mockState.jobReadCount).toBe(1);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("FETCH-REJECTS-HOLDS: a rejected fetch is not a success, no throw escapes, and it is logged once for the attempt", async () => {
    const rejects = () => Promise.reject(new TypeError("Failed to fetch"));
    mockState.jobAnswers = [rejects, rejects, rejects, rejects];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS * 4);
    expect(mockState.jobReadCount).toBe(4);
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("strat-1"),
      "Failed to fetch",
    );

    // CONTROL: the check was holding the success, not dead. A readable answer
    // on the next tick forwards it.
    await tick(POLL_MS);
    expect(onStatusChange.mock.calls).toEqual([["complete"]]);
  });

  it("NULL-JOB-FORWARDS: jobStatus null (no factsheet-chain job visible) forwards the success", async () => {
    mockState.jobAnswers = [jobState(null)];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS);
    expect(onStatusChange.mock.calls).toEqual([["complete"]]);
  });

  it("FINAL-FAILED-FORWARDS: jobStatus failed_final (the chain has finished) forwards the success", async () => {
    mockState.jobAnswers = [jobState("failed_final")];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS);
    expect(onStatusChange.mock.calls).toEqual([["complete"]]);
  });

  // `pending` is WARNED-ROW-MID-CHAIN's.
  it.each(["running", "failed_retry", "done_pending_children"])(
    "IN-FLIGHT-STATES: jobStatus %s holds the success",
    async (jobStatus) => {
      mockState.jobAnswers = [jobState(jobStatus), jobState(jobStatus)];
      const { onStatusChange } = renderEvidencedComplete();
      await tick(0);

      await tick(POLL_MS * 2);
      expect(mockState.jobReadCount).toBe(2);
      expect(onStatusChange).not.toHaveBeenCalled();
      // A job in flight is a readable answer, not a failure: nothing is logged.
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  it("FAILED-NO-READ: an evidenced failed terminal is forwarded with no sync-progress request", async () => {
    mockState.analyticsResult = analyticsRow("failed", T1);
    const { onStatusChange } = renderPoller("computing", { computedAt: T0 });
    await tick(0);

    await tick(POLL_MS);
    expect(onStatusChange.mock.calls).toEqual([["error"]]);
    expect(mockState.jobReadCount).toBe(0);
  });

  it("ONE-IN-FLIGHT: while a sync-progress request has not answered, the next evidenced ticks make no second request", async () => {
    const held = deferredAnswer();
    mockState.jobAnswers = [held.answer];
    const { onStatusChange } = renderEvidencedComplete();
    await tick(0);

    await tick(POLL_MS * 3);
    expect(mockState.analyticsSelectCount).toBe(3);
    expect(mockState.jobReadCount).toBe(1);
    expect(onStatusChange).not.toHaveBeenCalled();

    // The one request answers "nothing in flight": the success goes out once.
    await act(async () => {
      held.resolve({
        ok: true,
        status: 200,
        json: async () => ({ jobStatus: "done", stalled: false, memberProgress: [] }),
      });
    });
    expect(onStatusChange.mock.calls).toEqual([["complete"]]);
  });

  it.each(["unmounts", "leaves computing"])(
    "LATE-RESULT: the panel %s before the request answers, and the answer forwards nothing",
    async (how) => {
      const held = deferredAnswer();
      mockState.jobAnswers = [held.answer];
      const { onStatusChange, rerenderStatus } = renderEvidencedComplete();
      await tick(0);
      await tick(POLL_MS);
      expect(mockState.jobReadCount).toBe(1);

      if (how === "unmounts") cleanup();
      else rerenderStatus("error");

      await act(async () => {
        held.resolve({
          ok: true,
          status: 200,
          json: async () => ({ jobStatus: "done", stalled: false, memberProgress: [] }),
        });
      });
      await tick(0);
      expect(callsWith(onStatusChange, "complete")).toBe(0);
    },
  );
});
