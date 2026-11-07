---
phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo
plan: 08
subsystem: infra
tags: [prod-read-only, book-b3, founder-deviation, contingency-gate, attribution-of-record]

requires:
  - phase: 202-residchurn
    provides: plan 07's gc-c-b3-d12 line and 202-REPORT.md
provides:
  - the D-12 contingency gate read from plan 07's line, fired=yes, and the founder's answer mapped to no-fix-override (D-17)
  - 202-REPORT.md updated to the attribution of record a 0, b 1142, c 0, d 72 (D-15), with the pinned reading kept as lineage
  - the b6 finding closed as intended (D-14 closed)
affects: [203-b3trunc, 202 verification]

plan_head_before: a3e7f47adb1a7d07f3fcbb7f477f52067b4cf63e
plan_head_after: c261449839b42903d6461efdd70703bd79a59f32
actuals:
  tokens: 6500
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "a contingency gate that reads a measured line, then records the founder's answer instead of choosing"

key-files:
  created: []
  modified:
    - .planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-REPORT.md

key-decisions:
  - "D-17 (founder 2026-11-07): no reopen of b3 inside 202; b3's window_truncated stays unexplained; the investigation is Phase 203 B3TRUNC."
  - "D-15 (founder deviation 2026-11-07): the attribution of record for the 1214 is a 0, b 1142, c 0, d 72; the pinned script's reading is lineage and the script is untouched."
  - "D-16 (founder 2026-11-07): bucket (c) is not widened; the MT5 server-clock setting is the measured lead, booked as TODOS 202-MT5-CLOCK-LEAD-01."
  - "D-14 closed (founder 2026-11-07): b6's omission of a departed unknown-account key is intended; no flag, no follow-up."

requirements-completed: [RESID-02]

coverage:
  - id: D1
    description: "The contingency gate follows plan 07's measured gc-c-b3-d12 line and records the founder's answer as no-fix-override with no file under analytics-service changed"
    requirement: RESID-02
    verification:
      - kind: other
        ref: "plan 08 Task 1 and Task 3 automated verify commands (exit 0), git status --porcelain -- analytics-service empty"
        status: pass
    human_judgment: false
  - id: D2
    description: "202-REPORT.md carries the attribution of record (D-15), the decided note, and the answered founder questions, and plan 07's Task 3 verify still passes"
    requirement: RESID-01
    verification:
      - kind: other
        ref: "plan 07 Task 3 automated verify command (exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Whether b3 should be called a defect or correct behaviour on window_truncated is not settled in 202"
    requirement: RESID-02
    verification: []
    human_judgment: true
    rationale: "Founder D-17 moved the investigation of why b3 carries window_truncated to Phase 203, so 202 leaves RESID-02's 'explained' half open for that reason."

duration: 15min
completed: 2026-11-07
status: complete
---

# Phase 202 Plan 08: The b3 contingency gate and the founder's answers Summary

**The D-12 contingency fired on `component_disagrees`; the founder chose no fix inside 202 (D-17), so no file under `analytics-service/` changed, the b3 investigation moved to Phase 203 B3TRUNC, and the 202 report now carries the D-15 attribution of record (a 0, b 1142, c 0, d 72).**

## Performance

- **Duration:** 15 min
- **Completed:** 2026-11-07T07:25Z
- **Tasks:** 3 (Task 1 run, Task 2 answered by the founder in advance, Task 3 not run)
- **Files modified:** 1 (`202-REPORT.md`) plus this SUMMARY

## Task 1: the gate

`node scripts/verify-plan-anchors.mjs` on this plan exited 0 (2 claims checked, no stale claim). Plan 07's line, copied: `gc-c-b3-d12: reopened=yes reason=component_disagrees`, beside `gc-c-b3-verdict: capture=c1 window_truncated=unexplained out_of_window_flow=correct other_blocking=none trust=false d13=open`. The `reopened=yes` branch therefore applies, and the gate line is:

gc-c-contingency: fired=yes reason=component_disagrees

The measured fact behind it: `window_truncated` is `unexplained` only because book b6's own line disagrees (`predicted=yes stored=no`), the same on b0, b1 and c1, while b3's own line agrees on every capture. `out_of_window_flow` is correct behaviour on b3 (k15, a Bybit key off the pinned full-history venue list; the replay reproduces the stored count). The k15 implied-start share, 0.0082, is outside the band 0.0001, so widening the venue list would not green the book either.

## Task 2: the founder's answer, mapped

The founder answered before this plan ran (2026-11-07), and the answer is recorded in `202-CONTEXT.md` as D-17: "book the investigation as a phase". D-17 states that b3 is not re-opened inside 202, that plan 08 records the b6 finding, that b3's `window_truncated` stays `unexplained`, that no file under `analytics-service/` changes, that the investigation runs in a new follow-up phase taking 202's evidence as input, and that "Plan 08's contingency choice maps to its `no-fix-override` option (no fix in 202, recorded as a founder deviation), with the investigation moved to that phase." The phase was booked as Phase 203 B3TRUNC (`/gsd-phase`, commit `a3e7f47ad`, ROADMAP Phase 203 section).

The mapping holds: of the plan's four options, the answer changes no code (so not `stored-verdict` or `widen-venues`), it is not a request to re-plan inside 202 (so not `replan`), and it records no fix with the investigation moved elsewhere, which is the definition of `no-fix-override` given in D-17 itself. No options were presented again and nothing was chosen beyond this mapping.

gc-c-contingency-choice: option=no-fix-override decided_by=founder

The founder deviation (no fix in 202 although plan 07 re-opened D-12) is already written in `202-CONTEXT.md` D-17 and the ROADMAP Phase 202 section by the orchestrator.

## Task 3: not run

Task 3 (RED test, fix, neuter, mypy) is conditional on a code option (`stored-verdict` or `widen-venues`). The recorded option is `no-fix-override`, so it did not run. There is no `gc-c-fix:` line by design, no test was added, and `git status --porcelain -- analytics-service` is empty. The D-12 post-fix trust read (`gc-c-b3-after-fix`) does not apply, because no fix shipped.

## The b6 finding, closed as intended

Plan 07 found that book b6's stored returns equal k18's on 195 of 195 days and leave out k20's days, and that b5 does the same for k34 (D-14). D-14 closed (founder 2026-11-07, "Intended, no flag"): the orchestrator's read-only PROD read, marker first and PRODUCTION, showed that k20 (omitted from b6) and k34 (omitted from b5) are both Bybit keys with `sync_status=revoked` and `is_active=true`, and with `history_inclusion`, `account_share_kind`, `venue_account_id` and `disconnected_at` all NULL, which is an unknown account. `job_worker.py:departed_history_inclusion` excludes an unknown-account departed key by default (founder-confirmed 2025-09-25), so the omission follows that rule. Intended behaviour; no flag and no follow-up are booked. Labels only; no ids appear here.

## The report edit (orchestrator-directed addition, founder D-15)

`202-REPORT.md` was updated in its own commit (`c26144983`):

- The attribution of record for the 1214 is a 0, b 1142, c 0, d 72 (`gc-c-alt-total`), with the one-day stretch (cv undefined) not scored as a fail (D-15, "Use the plan's wording").
- The pinned script's reading, `gc-c-total: rows=1214 a=0 b=36 c=0 d=1178`, stays printed beside it as lineage; `final_attribution.py` was not edited. The table's last two columns were swapped so the record comes first.
- The reading note became "Decided note on the pinned rule", citing D-15.
- "Open founder questions" became "Founder questions, answered 2026-11-07", each answer quoted with its D-number: D-14 closed "Intended, no flag", D-15 "Use the plan's wording", D-16 "Don't widen; book it" (TODOS `202-MT5-CLOCK-LEAD-01`), D-17 "book the investigation as a phase" (Phase 203).
- The (d) list and totals agree with the record: s6, s9 and s10 are the 72 unexplained values, the MT5 server-clock setting is the measured lead, and s2, s5, s8 and s13 (87 values, outside the 1214) stay (d) under the rule as fixed.
- The b3 verdict and the D-14 finding bullets now state the founder's outcome instead of "not decided".

Plan 07's Task 3 `<automated>` verify re-run after the edit: exit 0.

## Task Commits

1. **Task 1 and Task 2 records, Task 3 not run:** carried by this SUMMARY (no code or planning-file change beyond it).
2. **Report edit (orchestrator-directed addition):** `c26144983` (docs)

**Plan metadata:** the commit that adds this SUMMARY follows `c26144983` (docs: complete plan).

## Files Created/Modified

- `.planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-REPORT.md` - D-15 attribution of record, decided note, answered founder questions, b3 and b6 outcomes
- `.planning/phases/202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo/202-08-SUMMARY.md` - this file

## Decisions Made

See key-decisions: D-17, D-15, D-16 and D-14 closed are the founder's, recorded in `202-CONTEXT.md`. Nothing in this plan was decided by the executor beyond the mapping of D-17 to `no-fix-override`.

## Deviations from Plan

### Founder deviations (not executor deviations)

**1. [Founder D-17] Contingency fired, no fix built.** Plan 07 re-opened D-12 (`component_disagrees`); the founder chose no fix inside 202 and a follow-up phase. This is the plan's `no-fix-override` option, a recorded founder deviation, with the investigation moved to Phase 203.

**2. [Founder D-15] Attribution of record differs from the pinned script's output.** The plan's wording governs; the pinned reading stays as lineage.

### Auto-fixed Issues

None. The task order differs slightly from the plan: the founder's Task 2 answer was supplied before execution, so the checkpoint was not raised, and Task 2's gate was recorded directly.

**Total deviations:** 0 auto-fixed, 2 founder-directed.

## Issues Encountered

None. The scratch directory for the report-edit script did not exist at first; it was created under the phase scratchpad and the edit re-run, with no repository change in between.

## Known Stubs

None.

## Threat Flags

None. No file under `analytics-service/` or `supabase/` changed, no PROD read was made by this plan, and no tracked text carries a PROD id, amount, account number or home path.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 202's plans are all executed. Phase 203 B3TRUNC owns why b3 carries `window_truncated`; TODOS `202-MT5-CLOCK-LEAD-01` owns the clock lead for the (d) values.
- `requirements-completed: [RESID-02]` is copied from the plan frontmatter, but the requirement's text ("explained, and fixed where they are a defect") is only half met by 202: `out_of_window_flow` is explained as correct behaviour, `window_truncated` stays `unexplained` under D-17. Whether RESID-02 is marked complete in `REQUIREMENTS.md` is left to the orchestrator and the phase verification (D3 above is `human_judgment: true` for that reason). The handler `requirements.mark-complete` was not run by this plan.

---
*Phase: 202-residchurn-the-value-churn-left-by-188-is-attributed-and-boo*
*Completed: 2026-11-07*
