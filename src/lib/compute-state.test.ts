import { describe, it, expect } from "vitest";
import {
  COMPUTE_STATE_READ_LIMIT,
  deriveComputeState,
  FACTSHEET_CHAIN_KINDS,
  isFactsheetJobInFlight,
  isStitchStalled,
  jobPhaseOf,
  memberProgressOf,
  recipientArm,
  selectFactsheetJob,
  type ComputeJobRow,
  type ComputeState,
  type RecipientArm,
} from "./compute-state";

/**
 * Phase 167.2 / KCS-07, KCS-20 — the one job-selection rule and the stitch-only
 * stall rule, lifted from /api/strategies/[id]/sync-progress.
 *
 * ORACLE INDEPENDENCE (the closed-sets.untrusted-key-status.test.ts house rule):
 * every expected kind set, status and state below is typed as a literal in THIS
 * file, never imported from the module under test, so a wrong entry in the
 * module cannot also be the expectation that passes it.
 *
 * Synthetic ids only. The clock is pinned (`NOW_MS`) and passed in, exactly as
 * the route passes its server clock.
 */

const NOW_ISO = "2026-07-12T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
/** ISO string `ms` milliseconds before the pinned now. */
const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();
const MIN = 60_000;

function row(kind: string, over: Partial<ComputeJobRow> = {}): ComputeJobRow {
  return {
    kind,
    status: "running",
    error_kind: null,
    claimed_at: ago(30_000),
    created_at: "2026-07-12T11:50:00.000Z",
    metadata: {},
    ...over,
  };
}

function stitch(over: Partial<ComputeJobRow> = {}): ComputeJobRow {
  return row("stitch_composite", {
    metadata: { member_progress: [], member_progress_at: ago(30_000) },
    ...over,
  });
}

/** Typed independently of the source. See ORACLE INDEPENDENCE above. */
const EXPECTED_CHAIN_KINDS = [
  "process_key_long",
  "sync_trades",
  "derive_broker_dailies",
  "compute_analytics_from_csv",
  "compute_analytics",
];

/** Strategy-scoped kinds that are NOT factsheet-chain jobs (RESEARCH § Q3). */
const NON_CHAIN_STRATEGY_KINDS = [
  "reconcile_strategy",
  "sync_funding",
  "compute_intro_snapshot",
  "poll_positions",
];

describe("FACTSHEET_CHAIN_KINDS / COMPUTE_STATE_READ_LIMIT", () => {
  it("is exactly the five factsheet-chain kinds, stitch_composite excluded", () => {
    expect([...FACTSHEET_CHAIN_KINDS]).toEqual(EXPECTED_CHAIN_KINDS);
    expect(FACTSHEET_CHAIN_KINDS as readonly string[]).not.toContain("stitch_composite");
  });

  it("asks for the RPC's default window, 100 rows", () => {
    expect(COMPUTE_STATE_READ_LIMIT).toBe(100);
  });
});

describe("selectFactsheetJob", () => {
  it("prefers the stitch_composite over a NEWER chain row", () => {
    const s = stitch({ created_at: "2026-07-12T11:40:00.000Z", status: "failed_final" });
    const chain = row("compute_analytics_from_csv", {
      created_at: "2026-07-12T11:59:00.000Z",
      status: "done",
    });
    expect(selectFactsheetJob([chain, s])).toBe(s);
  });

  it("167.2-REVIEW IN-03: with preferStitch false (no members now), a NEWER chain row answers over an old stitch", () => {
    // A strategy converted from a composite to a single key before KCS-23
    // keeps its stitch rows (30/90-day retention). Stitch-preferring selection
    // made that stale stitch answer for the single-key chain running now.
    const oldStitch = stitch({ created_at: "2026-07-12T11:00:00.000Z", status: "done" });
    const chain = row("process_key_long", { created_at: "2026-07-12T11:59:00.000Z", status: "running" });
    expect(selectFactsheetJob([oldStitch, chain], { preferStitch: false })).toBe(chain);
    // Default (members, or a count that could not be read): stitch-preferring, unchanged.
    expect(selectFactsheetJob([oldStitch, chain])).toBe(oldStitch);
  });

  it("167.2-REVIEW IN-03: with preferStitch false, a stitch at least as new as the newest chain row still answers", () => {
    const s = stitch({ created_at: "2026-07-12T11:59:00.000Z", status: "failed_final" });
    const chain = row("process_key_long", { created_at: "2026-07-12T11:00:00.000Z", status: "done" });
    expect(selectFactsheetJob([chain, s], { preferStitch: false })).toBe(s);
    expect(selectFactsheetJob([s], { preferStitch: false })).toBe(s);
  });

  it("167.2-REVIEW IN-03: deriveComputeState passes preferStitch through to the selection", () => {
    const oldStitch = stitch({ created_at: "2026-07-12T11:00:00.000Z", status: "done" });
    const chain = row("process_key_long", { created_at: "2026-07-12T11:59:00.000Z", status: "running" });
    expect(
      deriveComputeState({ rows: [oldStitch, chain], readExhaustive: true, nowMs: 0, preferStitch: false }).state,
    ).toBe("running");
  });

  it("picks the LATEST stitch by created_at, whatever the array order", () => {
    const older = stitch({ created_at: "2026-07-12T11:40:00.000Z", status: "done" });
    const newer = stitch({ created_at: "2026-07-12T11:55:00.000Z", status: "running" });
    expect(selectFactsheetJob([older, newer])).toBe(newer);
    expect(selectFactsheetJob([newer, older])).toBe(newer);
  });

  it("KCS-20: a NEWER non-chain row never displaces the latest chain row", () => {
    const chain = row("process_key_long", {
      created_at: "2026-07-12T11:30:00.000Z",
      status: "failed_final",
    });
    for (const kind of NON_CHAIN_STRATEGY_KINDS) {
      const cron = row(kind, { created_at: "2026-07-12T11:59:00.000Z", status: "done" });
      expect(selectFactsheetJob([cron, chain])).toBe(chain);
    }
  });

  it("KCS-20: only non-chain rows select nothing", () => {
    const rows = NON_CHAIN_STRATEGY_KINDS.map((k) => row(k));
    expect(selectFactsheetJob(rows)).toBeNull();
  });

  it("selects every chain kind when it is the only row", () => {
    for (const kind of EXPECTED_CHAIN_KINDS) {
      const r = row(kind);
      expect(selectFactsheetJob([r])).toBe(r);
    }
  });

  it("picks the newest chain row across chain kinds", () => {
    const a = row("process_key_long", { created_at: "2026-07-12T11:37:43.000Z", status: "done" });
    const b = row("derive_broker_dailies", { created_at: "2026-07-12T11:38:05.000Z", status: "done" });
    const c = row("compute_analytics_from_csv", { created_at: "2026-07-12T11:39:02.000Z" });
    expect(selectFactsheetJob([a, c, b])).toBe(c);
  });

  it("skips null and undefined rows, and an empty list selects nothing", () => {
    const r = row("sync_trades");
    expect(selectFactsheetJob([null, undefined, r, null])).toBe(r);
    expect(selectFactsheetJob([])).toBeNull();
    expect(selectFactsheetJob([null, undefined])).toBeNull();
  });
});

describe("isStitchStalled (stitch-only, caller-supplied clock)", () => {
  it("a NON-stitch running job with a year-old claimed_at is never stalled", () => {
    const r = row("process_key_long", { status: "running", claimed_at: ago(365 * 24 * 60 * MIN) });
    expect(isStitchStalled(r, NOW_MS)).toBe(false);
  });

  it("a non-stitch row with a stale member_progress_at is still never stalled", () => {
    const r = row("sync_trades", {
      status: "running",
      claimed_at: ago(60 * MIN),
      metadata: { member_progress_at: ago(60 * MIN) },
    });
    expect(isStitchStalled(r, NOW_MS)).toBe(false);
  });

  it("a running stitch whose heartbeat is older than 12 minutes is stalled", () => {
    const r = stitch({ metadata: { member_progress: [], member_progress_at: ago(13 * MIN) } });
    expect(isStitchStalled(r, NOW_MS)).toBe(true);
  });

  it("an 11-minute heartbeat is not stalled (the threshold is 12 minutes, 720000 ms)", () => {
    const r = stitch({ metadata: { member_progress: [], member_progress_at: ago(11 * MIN) } });
    expect(isStitchStalled(r, NOW_MS)).toBe(false);
  });

  it("the stall is measured on the caller's clock, not the wall clock", () => {
    const r = stitch({ metadata: { member_progress: [], member_progress_at: ago(30_000) } });
    expect(isStitchStalled(r, NOW_MS)).toBe(false);
    expect(isStitchStalled(r, NOW_MS + 13 * MIN)).toBe(true);
  });

  it("falls back to claimed_at when there is no heartbeat yet", () => {
    const stale = stitch({ claimed_at: ago(13 * MIN), metadata: { member_progress: [] } });
    const fresh = stitch({ claimed_at: ago(30_000), metadata: { member_progress: [] } });
    expect(isStitchStalled(stale, NOW_MS)).toBe(true);
    expect(isStitchStalled(fresh, NOW_MS)).toBe(false);
  });

  it("a garbage heartbeat is never stalled (NaN property)", () => {
    const r = stitch({ metadata: { member_progress: [], member_progress_at: "not-a-date" } });
    expect(isStitchStalled(r, NOW_MS)).toBe(false);
  });

  it("only a RUNNING stitch can be stalled", () => {
    for (const status of ["pending", "done", "done_pending_children", "failed_retry", "failed_final"]) {
      const r = stitch({ status, metadata: { member_progress: [], member_progress_at: ago(60 * MIN) } });
      expect(isStitchStalled(r, NOW_MS)).toBe(false);
    }
  });
});

describe("memberProgressOf", () => {
  it("projects each stitch member field by field, coercing an unknown status to waiting", () => {
    const r = stitch({
      metadata: {
        member_progress_at: ago(30_000),
        member_progress: [
          { seq: 1, exchange: "deribit", label: "Example A", status: "successful", extra: "junk" },
          { seq: "2", status: "exploded" },
          { seq: 3, exchange: { nested: "obj" }, label: 42, status: "in_process" },
          null,
        ],
      },
    });
    expect(memberProgressOf(r)).toEqual([
      { seq: 1, exchange: "deribit", label: "Example A", status: "successful" },
      { seq: 2, exchange: null, label: null, status: "waiting" },
      { seq: 3, exchange: null, label: null, status: "in_process" },
      { seq: NaN, exchange: null, label: null, status: "waiting" },
    ]);
    expect(JSON.stringify(memberProgressOf(r))).not.toContain("junk");
  });

  it("returns [] for a non-stitch row even when it carries member_progress", () => {
    const r = row("process_key_long", {
      metadata: { member_progress: [{ seq: 1, exchange: "okx", label: "L", status: "in_process" }] },
    });
    expect(memberProgressOf(r)).toEqual([]);
  });

  it("returns [] for a stitch with no member_progress array", () => {
    expect(memberProgressOf(stitch({ metadata: null }))).toEqual([]);
    expect(memberProgressOf(stitch({ metadata: { member_progress: "nope" } }))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Task 2 — deriveComputeState, recipientArm, jobPhaseOf, isFactsheetJobInFlight.
// Every expected state below is a literal (ORACLE INDEPENDENCE).
// ═══════════════════════════════════════════════════════════════════════════

/** Derive from rows with an exhaustive read on the pinned clock. */
function derive(rows: (ComputeJobRow | null | undefined)[], readExhaustive = true): ComputeState {
  return deriveComputeState({ rows, readExhaustive, nowMs: NOW_MS });
}

describe("deriveComputeState — status to state (KCS-07, KCS-19)", () => {
  const cases: Array<[string, ComputeState]> = [
    ["pending", { state: "queued" }],
    ["done_pending_children", { state: "queued" }],
    ["failed_retry", { state: "retrying" }],
    ["done", { state: "finished" }],
    ["failed_final", { state: "failed", errorKind: null }],
  ];
  for (const [status, expected] of cases) {
    it(`${status} -> ${expected.state}`, () => {
      expect(derive([row("compute_analytics_from_csv", { status })])).toEqual(expected);
    });
  }

  it("KCS-19: done_pending_children is in flight (queued), never finished", () => {
    const s = derive([row("derive_broker_dailies", { status: "done_pending_children" })]);
    expect(s).toEqual({ state: "queued" });
    expect(s.state).not.toBe("finished");
  });

  it("KCS-19 on a stitch too: done_pending_children -> queued", () => {
    expect(derive([stitch({ status: "done_pending_children" })])).toEqual({ state: "queued" });
  });

  it("running -> running", () => {
    expect(derive([row("process_key_long", { status: "running" })]).state).toBe("running");
  });

  it("a selected row whose status is outside the six-value domain -> unreadable", () => {
    for (const status of ["exploded", "", "DONE", "cancelled"]) {
      expect(derive([row("sync_trades", { status })])).toEqual({ state: "unreadable" });
    }
    expect(derive([row("sync_trades", { status: undefined })])).toEqual({ state: "unreadable" });
  });
});

describe("deriveComputeState — failed carries a coerced error_kind", () => {
  const cases: Array<[string | null | undefined, ComputeState]> = [
    ["permanent", { state: "failed", errorKind: "permanent" }],
    ["transient", { state: "failed", errorKind: "transient" }],
    ["unknown", { state: "failed", errorKind: "unknown" }],
    ["orphaned", { state: "failed", errorKind: "orphaned" }],
    [null, { state: "failed", errorKind: null }],
    [undefined, { state: "failed", errorKind: null }],
    ["PERMANENT", { state: "failed", errorKind: null }],
    ["timeout", { state: "failed", errorKind: null }],
  ];
  for (const [errorKind, expected] of cases) {
    it(`error_kind ${String(errorKind)} -> ${JSON.stringify(expected)}`, () => {
      expect(
        derive([row("process_key_long", { status: "failed_final", error_kind: errorKind })]),
      ).toEqual(expected);
    });
  }
});

describe("deriveComputeState — stall is stitch-only (KCS-07)", () => {
  it("a running stitch whose heartbeat is older than 12 minutes -> stalled", () => {
    const r = stitch({ metadata: { member_progress: [], member_progress_at: ago(13 * MIN) } });
    expect(derive([r])).toEqual({ state: "stalled" });
  });

  it("a running process_key_long whose claimed_at is a year old -> running, never stalled", () => {
    const r = row("process_key_long", {
      status: "running",
      claimed_at: ago(365 * 24 * 60 * MIN),
      metadata: { member_progress_at: ago(365 * 24 * 60 * MIN) },
    });
    expect(derive([r])).toEqual({ state: "running", phase: "fetch" });
  });
});

describe("deriveComputeState — running phase by kind (KCS-08)", () => {
  const cases: Array<[string, "fetch" | "compute"]> = [
    ["process_key_long", "fetch"],
    ["sync_trades", "fetch"],
    ["derive_broker_dailies", "fetch"],
    ["compute_analytics_from_csv", "compute"],
    ["compute_analytics", "compute"],
  ];
  for (const [kind, phase] of cases) {
    it(`running ${kind} -> phase ${phase}, no memberOf`, () => {
      expect(derive([row(kind, { status: "running" })])).toEqual({ state: "running", phase });
    });
  }
});

describe("jobPhaseOf (KCS-08)", () => {
  it("classifies the chain kinds, and any other kind string is unknown", () => {
    expect(jobPhaseOf("process_key_long")).toBe("fetch");
    expect(jobPhaseOf("sync_trades")).toBe("fetch");
    expect(jobPhaseOf("derive_broker_dailies")).toBe("fetch");
    expect(jobPhaseOf("compute_analytics_from_csv")).toBe("compute");
    expect(jobPhaseOf("compute_analytics")).toBe("compute");
    for (const kind of ["reconcile_strategy", "sync_funding", "rescore_allocator", "future_kind", "", null, undefined]) {
      expect(jobPhaseOf(kind)).toBe("unknown");
    }
  });

  it("stitch_composite is a compute kind (its fetch phase comes from member progress)", () => {
    expect(jobPhaseOf("stitch_composite")).toBe("compute");
  });
});

describe("deriveComputeState — composite member progress, key N of M (UI-SPEC KCS-09)", () => {
  const members = (...statuses: string[]) =>
    statuses.map((status, i) => ({ seq: i + 1, exchange: "okx", label: null, status }));
  const running = (memberStatuses: string[]) =>
    stitch({
      metadata: { member_progress_at: ago(30_000), member_progress: members(...memberStatuses) },
    });

  it("two successful and one in_process reads key 3 of 3 (CONTEXT Specifics)", () => {
    expect(derive([running(["successful", "successful", "in_process"])])).toEqual({
      state: "running",
      phase: "fetch",
      memberOf: { n: 3, m: 3 },
    });
  });

  it("members all successful -> phase compute, no memberOf", () => {
    expect(derive([running(["successful", "successful", "successful"])])).toEqual({
      state: "running",
      phase: "compute",
    });
  });

  it("a single member not yet successful -> key 1 of 1", () => {
    expect(derive([running(["in_process"])])).toEqual({
      state: "running",
      phase: "fetch",
      memberOf: { n: 1, m: 1 },
    });
  });

  it("n is successful + 1 and never above m", () => {
    expect(derive([running(["waiting", "waiting", "waiting"])])).toEqual({
      state: "running",
      phase: "fetch",
      memberOf: { n: 1, m: 3 },
    });
    expect(derive([running(["successful", "degraded"])])).toEqual({
      state: "running",
      phase: "fetch",
      memberOf: { n: 2, m: 2 },
    });
  });

  it("empty member_progress -> phase fetch with no memberOf", () => {
    expect(derive([running([])])).toEqual({ state: "running", phase: "fetch" });
  });
});

describe("deriveComputeState — absence, exhaustiveness and read errors (KCS-20)", () => {
  it("no chain row and an exhaustive read -> never_started", () => {
    expect(derive([], true)).toEqual({ state: "never_started" });
    expect(derive([row("reconcile_strategy", { status: "done" })], true)).toEqual({
      state: "never_started",
    });
  });

  it("no chain row and a NON-exhaustive read -> unreadable, never never_started", () => {
    expect(derive([], false)).toEqual({ state: "unreadable" });
    const window = Array.from({ length: 100 }, () => row("sync_funding", { status: "done" }));
    expect(derive(window, false)).toEqual({ state: "unreadable" });
  });

  it("a non-exhaustive read that DOES hold a chain row still derives from it", () => {
    expect(derive([row("sync_trades", { status: "failed_retry" })], false)).toEqual({
      state: "retrying",
    });
  });

  it("{ readError: true } -> unreadable", () => {
    expect(deriveComputeState({ readError: true })).toEqual({ state: "unreadable" });
  });

  it("KCS-20: a newer done reconcile_strategy does not turn a failed chain job into finished", () => {
    expect(
      derive([
        row("reconcile_strategy", { status: "done", created_at: "2026-07-12T11:59:00.000Z" }),
        row("process_key_long", {
          status: "failed_final",
          error_kind: "transient",
          created_at: "2026-07-12T11:30:00.000Z",
        }),
      ]),
    ).toEqual({ state: "failed", errorKind: "transient" });
  });
});

describe("TRIGGER SHAPE (CONTEXT Specifics): a three-member composite whose stitch is failed_final / permanent", () => {
  it("derives failed { errorKind: permanent } and recipient arm not_available", () => {
    const rows: ComputeJobRow[] = [
      stitch({
        status: "failed_final",
        error_kind: "permanent",
        created_at: "2026-07-12T11:45:00.000Z",
        metadata: {
          member_progress_at: ago(20 * MIN),
          member_progress: [
            { seq: 1, exchange: "deribit", label: "Example A", status: "successful" },
            { seq: 2, exchange: "bybit", label: "Example B", status: "successful" },
            { seq: 3, exchange: "okx", label: "Example C", status: "in_process" },
          ],
        },
      }),
      // Older chain rows are present and must not answer.
      row("process_key_long", { status: "done", created_at: "2026-07-12T11:20:00.000Z" }),
      row("derive_broker_dailies", { status: "done", created_at: "2026-07-12T11:25:00.000Z" }),
      // A newer non-chain cron row must not answer either.
      row("reconcile_strategy", { status: "done", created_at: "2026-07-12T11:59:00.000Z" }),
    ];
    const state = derive(rows);
    expect(state).toEqual({ state: "failed", errorKind: "permanent" });
    expect(recipientArm(state)).toBe("not_available");
  });
});

describe("recipientArm (UI-SPEC § C, one mapping for S5, S7 and S9)", () => {
  const cases: Array<[ComputeState, RecipientArm]> = [
    [{ state: "queued" }, "in_progress"],
    [{ state: "retrying" }, "in_progress"],
    [{ state: "running", phase: "fetch" }, "in_progress"],
    [{ state: "running", phase: "compute" }, "in_progress"],
    [{ state: "running", phase: "unknown" }, "in_progress"],
    [{ state: "running", phase: "fetch", memberOf: { n: 2, m: 3 } }, "in_progress"],
    [{ state: "stalled" }, "not_available"],
    [{ state: "failed", errorKind: "permanent" }, "not_available"],
    [{ state: "failed", errorKind: "orphaned" }, "not_available"],
    [{ state: "failed", errorKind: null }, "not_available"],
    [{ state: "finished" }, "not_available"],
    [{ state: "never_started" }, "not_available"],
    [{ state: "unreadable" }, "unreadable"],
  ];
  for (const [state, arm] of cases) {
    it(`${JSON.stringify(state)} -> ${arm}`, () => {
      expect(recipientArm(state)).toBe(arm);
    });
  }
});

describe("isFactsheetJobInFlight (the KCS-18 success gate)", () => {
  it("is true for pending, running, failed_retry and done_pending_children", () => {
    for (const status of ["pending", "running", "failed_retry", "done_pending_children"]) {
      expect(isFactsheetJobInFlight(status)).toBe(true);
    }
  });

  it("is false for done, failed_final, null, undefined and garbage", () => {
    for (const status of ["done", "failed_final", null, undefined, "", "exploded"]) {
      expect(isFactsheetJobInFlight(status)).toBe(false);
    }
  });
});
