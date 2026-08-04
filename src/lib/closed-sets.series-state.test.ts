/**
 * Phase 147 / SCEN-01 — `deriveEmptySeriesState`, the ONE server-side
 * discriminator that decides what an EMPTY resolved series means.
 *
 * WHY THIS EXISTS: an empty series is ambiguous — it is either a strategy still
 * warming up (honest "Syncing") or a strategy that has no data and never will
 * (honest "No data"). Getting that wrong in the optimistic direction is the
 * permanent-spinner class Phase 142 killed: strategy creation does NOT create a
 * `strategy_analytics` row (no trigger; the finalize-wizard enqueue is
 * non-blocking and swallowed inside Promise.allSettled; no cron backstops a
 * MISSING row — the reaper only terminalizes rows already at 'computing'), so
 * an unbounded missing-row → "computing" spins forever on a never-enqueued
 * strategy. The age bound is what makes the optimistic reading terminate.
 *
 * ORACLE INDEPENDENCE (money/threshold-math rule): the 16h boundary is typed
 * here as the literal 57600000 and is deliberately NOT imported from
 * closed-sets. A test that imports the constant it is pinning cannot fail when
 * the constant drifts — it would only re-assert the implementation against
 * itself. If the shipped window ever stops agreeing with this literal, this
 * file must go red.
 *
 * `nowMs` is injected on every case so no assertion depends on wall-clock time.
 */
import { describe, it, expect } from "vitest";
import { deriveEmptySeriesState } from "./closed-sets";

/**
 * The reaper's STRATEGY_ANALYTICS_REAP_THRESHOLD ("16 hours",
 * analytics-service/job_worker.py, mirrored by pg_cron migration
 * 20260802120000) expressed in ms — typed independently, never imported.
 */
const SIXTEEN_HOURS_MS = 57600000;

/** A fixed "now" so every age is exact rather than clock-relative. */
const NOW = Date.parse("2026-08-04T12:00:00.000Z");
/** ISO timestamp for a strategy created `ageMs` before NOW. */
const createdAgo = (ageMs: number) => new Date(NOW - ageMs).toISOString();

describe("[SCEN-01] deriveEmptySeriesState — empty-series discriminator", () => {
  it("in-flight statuses → 'computing', regardless of strategy age", () => {
    // A live compute job is authoritative: the row says work is happening, so
    // age is irrelevant (the reaper, not this predicate, terminalizes a stuck row).
    expect(deriveEmptySeriesState("pending", createdAgo(0), NOW)).toBe(
      "computing",
    );
    expect(deriveEmptySeriesState("computing", createdAgo(0), NOW)).toBe(
      "computing",
    );
    // Same answer for a strategy far older than the 16h missing-row window.
    expect(
      deriveEmptySeriesState("pending", createdAgo(30 * 24 * 3600_000), NOW),
    ).toBe("computing");
    expect(
      deriveEmptySeriesState("computing", createdAgo(30 * 24 * 3600_000), NOW),
    ).toBe("computing");
  });

  it("missing analytics row on a YOUNG strategy → 'computing' (legitimate warm-up)", () => {
    // status null = no strategy_analytics row at all. Within the window this is
    // the normal 10–15 min post-finalize warm-up, so the optimistic read is honest.
    expect(deriveEmptySeriesState(null, createdAgo(3600_000), NOW)).toBe(
      "computing",
    );
  });

  it("missing analytics row PAST the 16h bound → 'empty' (permanent-spinner guard)", () => {
    // Exactly 1ms past the boundary must flip: this is the assertion that fails
    // if the window is widened, removed, or made unbounded.
    expect(
      deriveEmptySeriesState(null, createdAgo(SIXTEEN_HOURS_MS + 1), NOW),
    ).toBe("empty");
    // …and 1ms inside it must NOT flip (proves the pin is a boundary, not a
    // blanket "old rows are empty" rule).
    expect(
      deriveEmptySeriesState(null, createdAgo(SIXTEEN_HOURS_MS - 1), NOW),
    ).toBe("computing");
  });

  it("unknown age (null / unparseable created_at) → 'empty', never an unbounded spinner", () => {
    expect(deriveEmptySeriesState(null, null, NOW)).toBe("empty");
    expect(deriveEmptySeriesState(null, "not-a-date", NOW)).toBe("empty");
    expect(deriveEmptySeriesState(null, "", NOW)).toBe("empty");
  });

  it("terminal statuses with no series → 'empty' ('failed' is NOT special-cased)", () => {
    // UI-SPEC: a failed compute renders the muted "No data" chip, never red —
    // so `failed` must map to the same state as a clean terminal success.
    expect(deriveEmptySeriesState("complete", createdAgo(0), NOW)).toBe("empty");
    expect(
      deriveEmptySeriesState("complete_with_warnings", createdAgo(0), NOW),
    ).toBe("empty");
    expect(deriveEmptySeriesState("failed", createdAgo(0), NOW)).toBe("empty");
  });

  it("unknown junk status → 'empty' (conservative default)", () => {
    // A status this predicate does not recognise (stale deploy, DB drift) must
    // degrade to honest absence, not to an optimistic spinner.
    expect(deriveEmptySeriesState("garbage", createdAgo(0), NOW)).toBe("empty");
  });

  it("never returns 'available' — that axis is decided by series length at the call site", () => {
    const cases: Array<[string | null, string | null]> = [
      ["pending", createdAgo(0)],
      ["computing", createdAgo(0)],
      ["complete", createdAgo(0)],
      ["complete_with_warnings", createdAgo(0)],
      ["failed", createdAgo(0)],
      ["garbage", createdAgo(0)],
      [null, createdAgo(3600_000)],
      [null, createdAgo(SIXTEEN_HOURS_MS + 1)],
      [null, null],
    ];
    for (const [status, createdAt] of cases) {
      expect(deriveEmptySeriesState(status, createdAt, NOW)).not.toBe(
        "available",
      );
    }
  });
});
