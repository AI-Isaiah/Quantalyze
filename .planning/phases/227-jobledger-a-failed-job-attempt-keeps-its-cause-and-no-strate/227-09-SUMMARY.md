---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 09
subsystem: analytics-worker
tags: [python, ops-alert, watchdog-loop, readmit-ceiling, heal-03, paging]
status: complete

requires:
  - phase: 227-04
    provides: "public.reconcile_readmit_exhaustions and the service_role-only detector record_reconcile_readmit_exhaustions()"
  - phase: 227-08
    provides: "main_worker changes this plan edits beside (renew fence, heartbeat, attempt-error record)"
provides:
  - "services.readmit_ceiling_alert.page_readmit_exhaustions() -> int, never raises"
  - "ops_alert source reconcile_readmit_ceiling in both OPS_ALERT_SOURCES sets"
  - "guarded call in main_worker.watchdog_loop"
affects: [227-10 (census pins, validation map), 227-11]

plan_head_before: 06f21b2e69a1dfc75cc65e5ccf479d9e8e305dc6
plan_head_after: 850bc57bb1a3f114005af3f35d559457f8f348b0
commits: 2

actuals:
  tokens: 16500
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "delivery-gated stamp: paged_at is written only after await_delivery returns True (mt5_outage_alert._finish_recovered shape)"
    - "rollout-window latch by structured code (42883, PGRST202, 42P01, PGRST205), logged once per process, reads as zero"

key-files:
  created:
    - analytics-service/services/readmit_ceiling_alert.py
    - analytics-service/tests/test_readmit_ceiling_alert.py
  modified:
    - analytics-service/services/ops_alert.py
    - src/lib/ops-alert-contract.ts
    - analytics-service/main_worker.py

key-decisions:
  - "DEC-09-A to DEC-09-C as recorded in the plan (cause carries the strategy id; delivery-gated, id-and-unpaged-guarded stamp; guarded call in watchdog_loop)"
  - "The throttle timestamp is taken before the work, like sweep_expired_trade_reads, so a failing database retries one interval later and not on every 60 s tick"
  - "paged_at is sent as a client UTC ISO timestamp, because PostgREST cannot send now(); the guard column filter (paged_at IS NULL) is what carries DEC-09-B"

requirements-completed: [HEAL-03]
completed: 2026-11-23
---

# Phase 227 Plan 09: Page a human when a reconcile readmit hits its ceiling Summary

**A strategy the reconcile sweep stopped readmitting now pages through ops_alert (source `reconcile_readmit_ceiling`, cause `readmit_ceiling:<strategy id>`) from plan 04's durable row, and the row is stamped `paged_at` only after a channel confirms delivery.**

## Accomplishments

- `page_readmit_exhaustions()` runs plan 04's detector RPC, reads at most 25 unpaged rows oldest first, pages each with `event="outage"` and a detail of our own tokens only (`marker_count`, `generation_key`, `detected_at`), and runs `UPDATE ... SET paged_at WHERE id = <row> AND paged_at IS NULL` only when `await_delivery` is True. It returns the delivered count.
- The whole body is one `try`. 42883, PGRST202, 42P01 and PGRST205 (on `.code` or `.details["code"]`) log `readmit_ceiling_objects_missing` once per process and read as zero; every other exception logs `readmit_ceiling_page_failed` with the exception class only and returns zero. `asyncio.CancelledError` passes through (pinned by a test). The predicate is private to the module (main_worker imports it, so the reverse import would be circular).
- One pass per `_READMIT_PAGE_INTERVAL_S` (300 s), clock is a seam (`_clock`), state is rebound module globals.
- `reconcile_readmit_ceiling` added to `OPS_ALERT_SOURCES` in `ops_alert.py` and `ops-alert-contract.ts` in the same position with the same comment. The route's `z.enum` reads the TypeScript set, so no route change.
- `watchdog_loop` awaits the reader after the trade-read sweep in its own `try/except`, logging `readmit_ceiling_loop_guard` with the class only.

## Task Commits

1. **Task 1 (tracer): reader, source in both sets, tests** - `edb2f7091` (feat)
2. **Task 2: wire into watchdog_loop** - `850bc57bb` (feat)

`commits: 2` is measured over the two task commits before this SUMMARY's own commit.

## Verification (verbatim)

GREEN, final tree, from `analytics-service/`:

```
pytest tests/test_readmit_ceiling_alert.py tests/test_main_worker.py tests/test_ops_alert.py  -> 173 passed
pytest tests/test_readmit_ceiling_alert.py tests/test_main_worker.py tests/test_trade_read_resume.py tests/test_ops_alert.py -> 175 passed
pytest tests/test_ops_alert.py tests/test_mt5_outage_alert.py -> 155 passed
mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
  -> Success: no issues found in 143 source files
npx vitest run src/__tests__/ops-alert-contract-parity.test.ts -> Tests 4 passed (4)
npx tsx scripts/check-planning-hygiene.ts -> OK (rules 6 and 7 shown OK)
node scripts/verify-plan-anchors.mjs <plan> -> OK: 1 plan file(s), no stale claims.
```

### PROOF-01 (RED first, byte restore via cp + cmp, then GREEN)

Task 1 tests written first, RED by collection (module absent):

```
E   ImportError: cannot import name 'readmit_ceiling_alert' from 'services'
```

Neuters of the shipped code, each restored from a byte backup (`cmp` exit 0) and followed by the green run above:

| Neuter | Named test that went RED |
|---|---|
| stamp regardless of delivery (`await_delivery` result ignored) | `test_an_undelivered_page_leaves_the_row_unpaged` |
| drop `.is_("paged_at", "null")` from the stamp | `test_a_delivered_page_stamps_exactly_that_row` |
| shared cause `"readmit_ceiling"` (strategy id dropped) | `test_two_strategies_page_under_two_distinct_causes`, `test_a_delivered_page_stamps_exactly_that_row`, `test_the_cause_for_a_real_uuid_satisfies_the_ops_alert_cause_pattern` |
| source removed from the Python set | `test_the_source_is_a_member_of_ops_alert_sources` and vitest `OPS_ALERT_SOURCES is identical` (`expected [ 'backfill', 'cron_sync', ...(8) ] to deeply equal [ ..., ...(9) ]`) |

Task 2 tests appended first, RED (`AttributeError: <module 'main_worker'> has no attribute 'page_readmit_exhaustions'`, both tests FAILED), then neuters after wiring:

| Neuter | Named test that went RED |
|---|---|
| reader call outside its `try` in `watchdog_loop` | `test_watchdog_loop_survives_readmit_reader_error` |
| reader call removed | `test_watchdog_loop_calls_readmit_reader` and `test_watchdog_loop_survives_readmit_reader_error` |

## Deviations from Plan

None. The plan executed as written. Two test files named in the plan's Task 2 verify line (`tests/test_main_worker.py`) were run and pass; the two watchdog tests live in `test_readmit_ceiling_alert.py` as the Task 2 files list says.

## Not run here (recorded, not skipped silently)

- Docker is unavailable on this host, so no live-DB suite ran. The reader's calls to the real detector RPC and the real `reconcile_readmit_exhaustions` table (grants: SELECT and `UPDATE (paged_at)` for service_role) are covered by plan 04's SQL gate on the pg-lane and are unproven end to end against a live PostgREST here. The Supabase client is faked in the unit tests.
- Census pins were not touched (plan 10 owns them). REQUIREMENTS.md was not edited; HEAL-03's durable-row half was ticked by plan 04's work, and this plan completes the page half, so the orchestrator can mark HEAL-03 complete.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. The page detail carries a count, a generation key (a job uuid) and a timestamp; the cause carries an internal strategy uuid, as the reconcile-sweep Sentry event already does (T-227-26). No new endpoint, auth path or schema.

## Self-Check: PASSED

- FOUND: analytics-service/services/readmit_ceiling_alert.py, analytics-service/tests/test_readmit_ceiling_alert.py
- FOUND commits edb2f7091 and 850bc57bb in HEAD's history
