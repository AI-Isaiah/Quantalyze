# Phase 214: FRESHTRUTH - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-14
**Phase:** 214-freshtruth
**Areas discussed:** SC-2 fan-out cap, SC-8 uncorrelated senders, SC-5 chip label

---

## SC-2 fan-out cap

| Option | Description | Selected |
|--------|-------------|----------|
| A: weekly cap | After a completed derive+compute leaves last_return_date unmoved 3+ days, cooldown 20 h -> 7 days in the fan-out; skips counted per tick with reason in cron_runs (Recommended) | ✓ |
| B: exclude | Exclude until a key event (resync/reconnect); saves all work but a revived account waits for a manual action | |

**User's choice:** A
**Notes:** Trigger on the generic signal, never in the view; skip tag cannot collide with candidate_enqueue_failed.

---

## SC-8 uncorrelated senders

| Option | Description | Selected |
|--------|-------------|----------|
| A: senders | Both routes send their request correlation_id; TS test RED on revert + SQL arm pinning both payloads (Recommended) | ✓ |
| B: widen | Widen _record_enqueue_dedup to fire for source finalize-wizard / csv-finalize; SQL arm RED on Phase 211 | |
| C: both | A and B | |

**User's choice:** A
**Notes:** No SQL widening.

---

## SC-5 chip label

| Option | Description | Selected |
|--------|-------------|----------|
| a: wrap | Let the label row wrap; keep the full sentence | ✓ |
| b: shorten | `Track record · future`; loses the check-data cue | |
| c: other short wording | e.g. `Track record · future date`; needs measuring | |

**User's choice:** a
**Notes:** Measure at 1485px in a real browser, per DESIGN.md.

---

## Decided autonomously

[auto] [SC-3] — Q: "When does a composite read as closed?" → Selected: "all members window_end set and last_return_date reaches max(window_end)-1; excuses only series_behind" (reversible technical — decided autonomously: fails toward stale, revisable by a forward migration)
[auto] [SC-3] — Q: "How is closed exposed?" → Selected: "new view columns appended last; grants and security_invoker restated; static gates still pass" (reversible technical — decided autonomously: view-only)
[auto] [SC-4] — Q: "When is the PROD drain measured?" → Selected: "after merge, via MCP with marker first" (reversible technical — decided autonomously: measurement only)
[auto] [SC-1] — Q: "How far does the diagnosis go?" → Selected: "diagnose and record; route any derive money-math defect" (reversible technical — decided autonomously: diagnosis only)

## Claude's Discretion

Closed-verdict column names; cron_runs skip tag/metadata shape; migration timestamp.

## Deferred Ideas

None.
