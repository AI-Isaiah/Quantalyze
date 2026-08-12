---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 07
subsystem: analytics-service
tags: [stale-01, contingent, no-op, disposition, backend-arm]

# Dependency graph
requires:
  - phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
    plan: "01"
    provides: "154-INVESTIGATION.md — the PROD mechanism verdict this plan is entirely contingent on"
provides:
  - "ARM C / backend-arm disposition on the record: NO-OP, with the verdict quoted"
requirements-completed: []
---

# 154-07 — Backend arm (contingent): **ARM C: NO-OP — verdict was M2(ii)**

## Disposition

**No Python change. No SQL change. No new file.** This is the plan's own NO-OP arm, taken because
154-01's PROD evidence excludes every mechanism this plan exists to fix.

> **Mechanism verdict: M2(ii)** — the DB was terminal and the client was reading nothing. The
> zero-rows/absent read was coerced to the domain value `"pending"` by the ladder arm's
> `statusRow?.computation_status ?? "pending"` (`src/hooks/useStrategySyncPoller.ts:228-229`).
> **M3 — RULED OUT by evidence. M4 — RULED OUT by evidence. M2(i) — RULED OUT by evidence.**
>
> — `154-INVESTIGATION.md`

Executed by the orchestrator inline rather than by a subagent: a plan whose correct outcome is
"change nothing and record why" does not need an executor, and spawning one invites a fabricated
change.

## Arm-by-arm

| Arm | Fires when | Verdict evidence | Disposition |
|---|---|---|---|
| **ARM A** (M3 / H-a) — swallowed tail-enqueue returning `DONE`, parent parked at `done_pending_children` | verdict implicates M3 | Q2 returned **22 rows, every one `status='done'`, `attempts=1`, `last_error=null`**. Zero rows in `done_pending_children` or any non-terminal status; every declared child job exists. | **NO-OP** |
| **ARM B** (M4 / H-b) — `queued: False` emitted when work did exist | verdict implicates M4 | Q2 returned rows (not zero), so jobs *were* enqueued — branch (d) is excluded. The client half (ignoring `queued:false`) is 154-08's T2b regardless of arm. | **NO-OP** |
| **ARM C** (M2(i)) — bridge never invoked / zero-rows RETURN left `'pending'` standing | verdict implicates M2(i) | `analytics_row_exists = true`, and `compute_analytics_from_csv` — the job that *writes* the analytics row — reached `done` at **11:39:35.342759**. The bridge ran. | **NO-OP** (Task 2 creates nothing) |

## Which plans close the implicated mechanism

M2(ii) and its M1 compounder are **frontend-side**, and are owned by:

- **154-04** — the `?? "pending"` fabrication at `useStrategySyncPoller.ts:228-229` (TWIN-3), plus the
  `sync-progress` route filter.
- **154-08** — the three `isComposite` gates (`route.ts:185` is 154-04's; `SyncPreviewStep.tsx:2290`
  render gate and `:910` client fetch gate are 154-08's) that left a single-key user with zero exits.

⚠️ This is **not** frontend-only containment of a backend cause, which CONTEXT.md forbids. The root
cause *is* in the client: the server was correct and terminal at 11:39:35, and the client fabricated
a domain value from a read that returned nothing. Fixing it in Python would be the bandaid.

## Verification

Baseline confirmed unbroken rather than assumed — run from `analytics-service/` (a repo-root pytest
misses the VCR cassettes and fires live broker calls):

```
cd analytics-service && python3 -m pytest tests/test_long_fetch_follow_on_guard.py -x -q
2 passed in 4.12s      (exit 0)
```

`mypy --strict` not run: no Python file was touched, so there is nothing new to type-check. Stated
rather than silently skipped.

## Files modified

None. `files_modified` in the plan frontmatter lists four candidate paths; all four are untouched:

- `analytics-service/services/ingestion/long_fetch.py`
- `analytics-service/routers/process_key.py`
- `analytics-service/tests/test_long_fetch_follow_on_guard.py`
- `supabase/tests/test_sync_status_bridge_branches.sql` (deliberately **not created** — the plan says
  "If ARM C is NOT implicated: create nothing; do not commit an empty file")

## Note on the Task 2 verify shell

Task 2's `<automated>` was hardened before execution because its original form
(`test -f F && grep -c … || echo "NO-OP arm…"`) could never exit non-zero: a file present with
**zero** `RAISE EXCEPTION` assertions fell through to the echo and reported NO-OP. It now fails loud
on that hollow-gate state. On this run the file legitimately does not exist, so the NO-OP branch is
the correct and honest result.

## Self-Check: PASSED

- [x] Verdict quoted and mapped to arms (acceptance criterion 1)
- [x] No Python change, no new SQL gate, no empty file committed
- [x] pytest run from `analytics-service/`, green
- [x] Closing plans named (154-04, 154-08)
- [x] STATE.md / ROADMAP.md untouched
