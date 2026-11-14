---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
verified: 2026-11-14T20:45:00Z
status: gaps_found
score: 6/8 success criteria verified (SC-4 deferred-by-design post-merge; SC-5 not met as written, decision-gated)
verified_at_sha: 1d78c911b4233a54dc83532f95f9196a7dcaee59
drift_subjects:
  - supabase/migrations/20261114151700_ledger_staleness_closed_composites.sql
  - supabase/migrations/20261114152300_ledger_fanout_no_advance_weekly_cap.sql
  - supabase/migrations/down/20261114151700-rollback.sql
  - supabase/migrations/down/20261114152300-rollback.sql
  - supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
  - supabase/tests/test_ledger_refresh_staleness.sql
  - supabase/tests/test_ledger_refresh_composite_arm.sql
  - supabase/tests/test_ledger_refresh_fanout.sql
  - supabase/tests/test_enqueue_dedup_record_retract.sql
  - analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py
  - analytics-service/tests/test_ledger_refresh_gates.py
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/strategies/finalize-wizard/route.test.ts
  - src/__tests__/csv-validate-route.test.ts
  - scripts/mutation-floors.mjs
  - e2e/freshness-chip-width.spec.ts
behavior_unverified: 0
gaps:
  - truth: "SC-5: The freshness chip's 'future' label fits at 1485px, measured in a real browser."
    status: failed
    reason: >
      Not met as written. Plan 05 measured on the local stack at 1485px: the label is 295px on one
      line and the column takes its max-content, so the claimed overflow (297.9px in 204.2px) did not
      reproduce, nor at any width from 1485 to 360px. No class was changed (founder decision
      "wrap, keep the sentence" untouched). The only committed artifact is
      e2e/freshness-chip-width.spec.ts, whose test (a) fails BY DESIGN ("narrow-column condition not
      exercised") and is deliberately not in ci.yml's e2e-seeded list. So nothing pins "the label
      fits" in CI, there is no fix to have a RED-on-revert test (SC-7 for SC-5 is not applicable),
      and SC-5's premise is unconfirmed. TODOS 0.12 must not be deleted as "fixed" on this evidence.
    artifacts:
      - path: "e2e/freshness-chip-width.spec.ts"
        issue: "test (a) is red by design when the seed env is set; spec is dormant (self-skips without seed env, absent from the e2e-seeded list)"
    missing:
      - "Founder decision: amend SC-5 to 'recorded as not reproducible at HEAD, with the measurement', OR point it at a different surface, OR supply the state that squeezes the column"
      - "If amended to not-reproducible: delete the spec or drop test (a) (or flip it to a pass-by-fit assertion and add it to e2e-seeded); CHANGELOG wording for TODOS 0.12 must say 'does not reproduce', not 'fixed'"
deferred:
  - truth: "SC-4: after deploy, a PROD read through the Supabase MCP (marker query first) shows the stale count drained, or names each remaining row and why."
    addressed_in: "post-merge orchestrator step (not a later roadmap phase)"
    evidence: >
      The read needs the migrations applied on PROD. This agent does not merge, so it cannot be
      measured now. Expected remaining stale rows: (1) the MT5 strategy 81 days behind with a
      disconnected key (excluded from the candidate set by key eligibility; not a refresh problem),
      (2) the MT5 strategy 36 days behind, now held to a weekly attempt (214-DIAGNOSIS.md section 7: it
      stays stale until its ledger has activity or the routed design property is decided). The two
      Deribit composites must read is_stale = false, is_closed = true.
human_verification:
  - test: "SC-5 founder decision (see gaps)"
    expected: "A recorded decision that either closes SC-5 as not reproducible or supplies a reproducing state"
    why_human: "The criterion's premise did not reproduce; only the founder can amend a roadmap success criterion"
---

# Phase 214: FRESHTRUTH Verification Report

**Phase Goal:** Refresh work goes only where data can actually advance, and every freshness reading tells the truth about why a series has stopped (36-day MT5 case, closed Deribit composites, chip overflow, uncorrelated finalize senders).
**Verified:** 2026-11-14 at HEAD 1d78c911b4233a54dc83532f95f9196a7dcaee59
**Status:** gaps_found (one decision-gated criterion, SC-5; SC-4 deferred-by-design)
**Re-verification:** No, initial verification

## Orchestrator-owned facts (recorded as stated, not re-derived)

- SC-6: migration-reviewer CLEAN (0 findings) and rls-policy-auditor CLEAN (0 findings) on the current HEAD's two migrations. Recorded as VERIFIED on that basis.
- SC-4: deferred-by-design (post-merge, Supabase MCP, marker query first). Expected remaining rows named above.
- SC-5: plan 05 measurement as quoted in the gap; founder decision needed.

## Per-criterion table

| SC | Status | Evidence |
|----|--------|----------|
| SC-1 diagnosis recorded | VERIFIED | `214-DIAGNOSIS.md` exists: verdict H1 (a ledger-complete MT5 series ends on its last ledger-activity day; gap fill reindexes to [first, last] of the series, so an idle account's daily derive cannot move `last_return_date`), PROD evidence, the inferred (explicitly not proven) flag reconciliation, two open residuals each with its confirming read, and what SC-4 should find. Executable pin `analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py` (5 cases) PASSES at HEAD (pytest below). No production code changed. The attribution of the dust/tiny-base flags to the July-August window is honestly labelled inferred. |
| SC-2 cap plus skip count | VERIFIED | Migration `20261114152300` (read in full at the relevant regions): the candidate CASE gains an `OR (...)` after the marks-paused `EXISTS` close paren: `stale_reason = 'series_behind'`, age >= 8, a done `compute_analytics_from_csv` job AND a done `derive_broker_dailies` job created on/after `last_return_date + 5`, giving `INTERVAL '7 days'` instead of 20 hours. It is a cap, never an exclusion (keyed on the attempt; admitted again after 7 days), as SC-2 allows ("excludes or caps"). Skip count: a best-effort block after the last advisory unlock re-spells the cohort and writes ONE `cron_runs` row (`cron_name 'ledger_refresh_fanout'`, `status 'ok'`, `error NULL`, `metadata.cause 'no_advance_weekly_cap'`, `skipped_count`, `skipped_targets` with `days_unmoved`), inside its own `EXCEPTION WHEN OTHERS` (SQLSTATE only in the warning); a tick with no skip writes nothing. Matched-pair arms NA1-NA6 and SK1-SK4 each carry a `RED-UNDER-M` twin (counted in the file: 47 twins, `ALL 41 ARMS EXECUTED`). The signal matches the PROD reading (three daily chains `done`/`publish_warned`: `publish_warned` is job metadata, the job status is `done`). |
| SC-3 closed composites | VERIFIED | Migration `20261114151700`: `ledger_refresh_staleness` gains lateral `cl`; `is_closed` = members > 0 AND every member has a `window_end` AND `max(window_end) <= CURRENT_DATE` AND `last_return_date >= max(window_end) - 1`, `COALESCE`d so it is never NULL; `closed_through = max(window_end) - 1`. `AND NOT cl.is_closed` is added to exactly the `series_behind` disjunct and CASE branch, so `no_analytics_row`, `status_not_success`, `no_return_date` still read stale. Columns appended after the verdict END marker; `security_invoker`, REVOKE and GRANT restated and asserted by a catalogue-only apply block. The composite fan-out is untouched and unscheduled (no schedule verb in the migration, per SUMMARY greps; CONTEXT manifest reading). The composite arm reads `lrs.is_stale`, so a closed composite stops being a candidate (arm CL). Staleness arms I-N and composite arm CL each carry a twin (counted). The PROD reading in CONTEXT (series ending on the last day the windows allow) fits the predicate. Manual rollback restores the 11-column view. |
| SC-4 PROD drain read | DEFERRED-BY-DESIGN (post-merge) | Cannot be measured pre-merge. Expected remaining rows: the 81-day MT5 strategy with a disconnected key, and the capped 36-day MT5 strategy. Both Deribit composites should read `is_stale = false`, `is_closed = true`. |
| SC-5 chip label fits at 1485px | FAILED (decision-gated), NOT MET AS WRITTEN | See gaps. Literal measurement: the label fits (295px on one line, no overflow at 1485 to 360px), but the defect the criterion presupposes did not reproduce, no fix was made, the one committed artifact is a by-design-failing, dormant spec, and nothing in CI pins the fit. Needs a founder decision. |
| SC-6 migration-reviewer and rls-policy-auditor clean | VERIFIED (orchestrator fact) | Both CLEAN, 0 findings, on the current HEAD's two migrations. |
| SC-7 each fix RED when reverted | VERIFIED for SC-1, 2, 3, 8; N/A for SC-5 | See the SC-7 table. SC-5 has no fix, so there is nothing to revert, and that is part of the SC-5 gap. |
| SC-8 correlation_id on both senders | VERIFIED | See the SC-8 section. |

## SC-7 detail (fix, RED-on-revert evidence, what I checked)

| Fix | RED mechanism | Checked by me | Attested only by SUMMARY |
|-----|---------------|---------------|--------------------------|
| SC-1 pin (no code fix; characterization) | `gap_fill_daily_returns` reindex end set to today turns all 5 tests RED | Test file exists, 5 cases, PASSES at HEAD (46 passed across three files) | The neuter-to-RED drill (5 failed, then byte restore) |
| SC-2 cap | Twins NA1-NA6 (one per conjunct: age, status done, +5 cutoff, series_behind, done derive) and SK1-SK4 (skip row, ordinary window, ineligible key, exception handler); omitted-migration and rollback drills stop on NA1 | Twin presence and counts in the files; census tests agree (ARMS_FLOOR 867 = 864 + the three round-1 arms NA5, NA6, SK4; `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `drift-check-scripts`, `ci-anti-skip-gate.contract` all PASS at HEAD) | Lane runs (`ALL n ARMS EXECUTED`), subset mutation `RED (identity ok)` per arm, rollback drill. I could not and did not boot pg-lanes |
| SC-3 view | Arms I-N (staleness), CL (composite) with twins; omitted-migration drill (`column "is_closed" does not exist`) and rollback drill | Twin presence (6 + 6 + 1 counted), view text read | Lane and mutation runs |
| SC-8 TS | Exact `toEqual` on `p_metadata`, including `correlation_id` (finalize-wizard test, csv Test 9 which also ties it to `body.correlation_id`) | Assertions read in the diff; both test files PASS at HEAD. An exact `toEqual` on an object that lacks the key cannot pass, so removing the key from either route turns it RED by construction | Explicit neuter drills N1/N2 (byte backup, RED, `cmp` restore) |
| SC-8 SQL | `FINALIZE-WIZARD-SHAPE` and `CSV-FINALIZE-SHAPE` with source-keyed twins; the existing `NO-CORRELATION` arm keeps the uncorrelated case | Arms and twins present (18 twins, `ALL 18 ARMS EXECUTED`) | Lane and mutation runs |
| Census | Floors count the new arms: `ARMS_FLOOR` 867 in `scripts/mutation-floors.mjs`, ci.yml anti-skip table moved, drill N1 (floor back to 848 turns the ratchet RED) and N2 | Census tests PASS at HEAD (7 files, 1453 tests) | Drills N1/N2 |

## SC-8 detail

- `finalize-wizard/route.ts`: `p_metadata: { source: "finalize-wizard", correlation_id: correlationId }` on the `stitch_composite` enqueue (the `sync_trades` enqueue is untouched).
- `csv-finalize/route.ts`: `p_metadata: { source: "csv-finalize", fmt, correlation_id: opts.correlationId }`; the test asserts equality with the response envelope's `correlation_id`.
- No SQL widening of `_record_enqueue_dedup`; the founder's alternative is not needed.
- Nuance, recorded honestly: the SC text asks for "a SQL gate arm that is RED on the Phase 211 code". The Phase 211 SQL is unchanged by design, so the new SQL arms are GREEN on it; they bite through their twins (RED when the predicate is narrowed for that source), and the route-level RED on Phase 211 code lives in the TS exact-equality tests. The SQL arms' payload is a hand-copied fixture of each route's metadata, not mechanically tied to the route. Together the pair satisfies the intent (route sends id, SQL retracts for that exact shape, each half RED on its own regression); this is a LOW coupling note, not a gap.

## Behavioral spot-checks run by me

| Behavior | Command | Result |
|----------|---------|--------|
| MT5 series end, ledger gates, scoped updates | `cd analytics-service && python3 -m pytest tests/test_mt5_series_end_is_last_ledger_day.py tests/test_ledger_refresh_gates.py tests/test_sql_gate_scoped_updates.py -q` | 46 passed |
| SC-8 TS tests and census/floors | `npx vitest run` over finalize-wizard route test, csv-validate-route test, mutation-runner-floors, gate-family-meta, mutation-annotation-parser, drift-check-scripts, ci-anti-skip-gate.contract (Node 22) | 7 files, 1453 passed |
| Twin and arm counts | `grep -a -c RED-UNDER-M` per gate | staleness 17 / composite 30 / fan-out 47 / dedup 18 |

Not run (by instruction): pg-lanes, full mutation run, Supabase CLI, `schema:functions:check` (plan 07 and plans 03, 06 report it current; the fan-out snapshot is among the drift subjects).

## Anti-patterns

Added-lines scan of every non-planning file in `4c4fa1993..HEAD` for `TBD|FIXME|XXX`: 0 hits. No stub or hollow wiring found in the two routes or the two migrations. Review artifact: `214-REVIEW.md` status clean after round 2 (0 critical, 0 warning; the 2 MEDIUMs and the SFH findings of round 1 were fixed with arms NA5, NA6, SK4 and the check-8/12 scoping).

## Recorded limits (not gaps)

- The first CI run of the new SQL gates on the committed baseline (not the throwaway lane) and `sql-mutation` FULL on the PR head SHA are the authoritative confirmations; `ARMS_FLOOR` 867 is the static annotated-unwaived count, an upper bound until that run.
- Skip rows accrue at up to one per hourly tick while a capped strategy sits inside its week (review IN-03, LOW, recorded in REVIEW only).
- `is_closed` uses the composite series maximum, not per-member coverage (SFH-F4, LOW).
- If PROD's two composites' `last_return_date` is below `max(window_end) - 1`, the view will still read them stale; CONTEXT's PROD reading says they end on the last allowed day, so SC-4's post-merge read is the confirmation.

## Gaps Summary

One gap, decision-gated rather than code-gated: SC-5. Everything else that can be verified pre-merge is verified. SC-4 is a post-merge read by design. To close SC-5 the founder must amend the criterion (not reproducible at HEAD, measurement recorded), redirect it, or supply a state that squeezes the column; then the dormant by-design-red spec is either deleted, reduced, or made a passing fit assertion and wired into `e2e-seeded`, and TODOS 0.12 is deleted with "does not reproduce" wording rather than "fixed".

---

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_
