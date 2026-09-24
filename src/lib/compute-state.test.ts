import { describe, it, expect } from "vitest";
import {
  COMPUTE_STATE_READ_LIMIT,
  FACTSHEET_CHAIN_KINDS,
  isStitchStalled,
  memberProgressOf,
  selectFactsheetJob,
  type ComputeJobRow,
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
