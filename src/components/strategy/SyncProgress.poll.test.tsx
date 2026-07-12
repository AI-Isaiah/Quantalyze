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
import { SyncProgress, type SyncStatus } from "./SyncProgress";

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
}));

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
function analyticsRow(status: string) {
  return {
    data: {
      computation_status: status,
      computation_error: null,
      computed_at: null,
    },
    error: null,
  };
}

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
function renderPoller(syncStatus: SyncStatus) {
  const onStatusChange = vi.fn();
  const { rerender } = render(
    <SyncProgress {...baseProps} syncStatus={syncStatus} onStatusChange={onStatusChange} />,
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
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
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
    // PGRST116 = 0 rows via .single() (the expected 'row not yet created' case).
    mockState.analyticsResult = { data: null, error: { code: "PGRST116" } };
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    // Polls 1..10 (SyncProgress.tsx:244 — attempts > 10 is false): silent.
    await tick(POLL_MS * 10);
    expect(callsWith(onStatusChange, "error")).toBe(0);

    // Poll 11 (attempts = 11 > MISSING_ROW_GRACE_POLLS): escalates exactly once.
    await tick(POLL_MS);
    expect(callsWith(onStatusChange, "error")).toBe(1);
  });

  it("PIN 3 — 120s CAP: 40 polls with a present row never error, 41st does", async () => {
    // A present, non-terminal row so the grace path (:243) never fires and the
    // ONLY escalation source is the outer cap (:216).
    mockState.analyticsResult = analyticsRow("computing");
    const { onStatusChange } = renderPoller("computing");
    await tick(0);

    // Polls 1..40 forward "computing" but never "error" (attempts !> 40).
    await tick(POLL_MS * 40);
    expect(callsWith(onStatusChange, "error")).toBe(0);
    expect(callsWith(onStatusChange, "computing")).toBe(40);

    // Poll 41 (attempts = 41 > POLL_MAX_ATTEMPTS): escalates before the query,
    // so the select counter does NOT advance on this tick.
    const beforeCount = mockState.analyticsSelectCount;
    await tick(POLL_MS);
    expect(callsWith(onStatusChange, "error")).toBe(1);
    expect(mockState.analyticsSelectCount).toBe(beforeCount);
  });

  it("PIN 4 — COUNTER RESET: re-activation restarts the attempt counter (:272)", async () => {
    mockState.analyticsResult = { data: null, error: { code: "PGRST116" } };
    const { onStatusChange, rerenderStatus } = renderPoller("computing");
    await tick(0);

    // Drive 5 missing-row polls (attempts 1..5 — below the grace boundary).
    await tick(POLL_MS * 5);
    expect(callsWith(onStatusChange, "error")).toBe(0);

    // Go inactive (interval cleared), then active again (pollAttemptsRef = 0).
    rerenderStatus("complete");
    await tick(0);
    rerenderStatus("computing");
    await tick(0);

    // 10 more missing-row polls. If the counter had NOT reset, attempts would
    // run 6..15 and escalate at the 6th tick; a fresh 1..10 stays silent.
    await tick(POLL_MS * 10);
    expect(callsWith(onStatusChange, "error")).toBe(0);
  });
});

// ===========================================================================
// Task 2 — semantic pins (forwarding contract, asymmetry, inactivity)
// ===========================================================================
describe("SyncProgress poll loop — forwarding contract (characterization)", () => {
  it.each([
    ["computing", "computing"],
    ["complete", "complete"],
    ["complete_with_warnings", "complete_with_warnings"],
    ["failed", "error"],
  ])(
    "PIN 5 — FORWARDED: DB %s maps to onStatusChange(%s)",
    async (dbStatus, uiStatus) => {
      mockState.analyticsResult = analyticsRow(dbStatus);
      const { onStatusChange } = renderPoller("computing");
      await tick(0);
      await tick(POLL_MS);
      expect(callsWith(onStatusChange, uiStatus)).toBe(1);
    },
  );

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
    expect(callsWith(onStatusChange, "error")).toBe(0);

    // Escalation happens ONLY at the missing-row grace boundary (poll 11).
    await tick(POLL_MS);
    expect(callsWith(onStatusChange, "error")).toBe(1);
    errSpy.mockRestore();
  });

  it("PIN 8 — INACTIVE = NO POLLING: a terminal status never selects analytics", async () => {
    renderPoller("complete");
    await tick(0);
    await tick(30_000);
    expect(mockState.analyticsSelectCount).toBe(0);
  });
});
