---
phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to
plan: 03
subsystem: analytics-service (Deribit ingestion, production observation)
tags: [deribit, options, assignment, stitch_composite, production-observation, checkpoint]
status: complete

requires:
  - phase: 168-01
    provides: "`assignment` classified cash-bearing in the census shape on both twins; D-02 refusals; windowed-crawl backstop"
  - phase: 168-02
    provides: "per-site pins, mark_to_market and smoothed_mtm end to end with an assignment, D-09 expiry close"
provides:
  - "the production observation that closes DERIBIT-ASSIGNMENT-UNCLASSIFIED: a Deribit options composite ingests end to end after the 168 deploy (counts and classes only)"
affects: [TODOS DERIBIT-ASSIGNMENT-UNCLASSIFIED, 166.3.1 NAVBREACH]

actuals:
  tokens: 4500
  tasks: 1
  commits: 1
plan_head_before: 94bf89ef0718cf25e2e1e90f5d9b75d4f1d512af
# plan_head_after is the single docs(168-03) commit that carries this file. It cannot name its
# own sha, and a second commit to fill it in would make this SUMMARY newer than
# 168-VERIFICATION.md, which trips the legacy staleness check.
plan_head_after: null

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/168-drboptions-a-deribit-options-account-can-be-ingested-end-to/168-03-SUMMARY.md
  modified:
    - .planning/phases/168-drboptions-a-deribit-options-account-can-be-ingested-end-to/168-VERIFICATION.md

key-decisions:
  - "The close condition is taken as met on the re-created three-account Deribit composite, because the strategy that failed on 2026-09-23 no longer exists on PROD"
  - "The 2026-10-01 native_nav inception reconciliation breach on two other Deribit composites is out of 168's scope and stays with its existing owner, Phase 166.3.1 NAVBREACH; no new phase is inserted"

requirements-completed: [DERIBIT-ASSIGNMENT-UNCLASSIFIED]

duration: 10min
completed: 2026-10-02
---

# Phase 168 Plan 03: Founder post-deploy observation Summary

**After the 168 deploy, the re-created three-account Deribit options composite recomputed through
`stitch_composite` to terminal `done` twice, with 272 return points, no assignment refusal and no
other refusal. That closes the phase's production condition.**

## Performance

- **Duration:** about 10 min (recording only; the observation itself happened on 2026-09-27 and was read on 2026-10-02)
- **Completed:** 2026-10-02
- **Tasks:** 1 (a checkpoint, resolved)
- **Files modified:** 2 planning files, 0 source files

## Checkpoint resolution (counts and classes only, D-08)

The checkpoint was resolved on 2026-10-02. Each fact below is attributed to where it came from.

**Deploy (orchestrator):** Phase 168 merged as PR #867 (v0.97.0.0, merge commit `3b923498e`) on
2026-09-26 15:11Z, and the analytics service deployed it.

**Founder (chat, 2026-10-02):** the strategy whose stitch job failed on 2026-09-23 no longer exists
on PROD. The founder re-created it after 168 deployed, as a three-account Deribit composite created
on 2026-09-27.

**Orchestrator (read-only PROD queries, marker query first, 2026-10-02), for the re-created
three-account Deribit composite:**

| Report field (D-08) | Observed |
|---|---|
| Terminal status | `stitch_composite` ran twice on 2026-09-27; both ended `done` (verbatim status), with no error recorded |
| Return-point count | 272 (strategy_analytics row computed 2026-09-27 18:35Z) |
| Assignment refusal | no |
| Other refusal or error class | none |

**Verdict:** a terminal success with a nonzero return-point count and no refusal. Per the plan's
own rule, the close condition is met: a Deribit options account is observed to ingest end to end
in production.

### What was NOT measured

- **Whether the re-created composite's ledger holds an `assignment` row.** No one counted it. So
  this record shows the account ingests with no assignment refusal. It does not show `assignment`
  classified on a real production row. Do not cite it as that.
- **Whether the smoothed pass ran.** It is gated on `SMOOTHED_MTM_ENABLED`, whose production value
  this plan did not measure. So the D-09 expiry close may not have run on this ingest.

### Out of scope: observed, routed to the existing owner

Two OTHER Deribit composites failed `stitch_composite` on 2026-10-01 with the error class
`member ledger unrecoverable — native_nav inception reconciliation breached venue=deribit
currencies=[BTC] breach_ratio=26.1`, which is an inception reconciliation breach. One of them later
succeeded on 2026-10-02. `168-CONTEXT.md` fences this class out of the phase ("the native_nav
inception reconciliation breach on the older Deribit composite is a separate defect with its own
owner"). It is not a 168 failure. Its owner is **Phase 166.3.1 NAVBREACH**, which is already on the
ROADMAP. No phase was inserted, and no code was changed for it here.

## Task Commits

1. **Task 1: record the founder post-deploy observation** — the `docs(168-03)` commit that carries
   this file and the `168-VERIFICATION.md` update (one commit, so the verification is never older
   than this SUMMARY).

## Files Created/Modified

- `168-03-SUMMARY.md`: this record.
- `168-VERIFICATION.md`: status `human_needed` → `passed`, score 12/13 → 13/13. Truth 13 is
  VERIFIED with the dated evidence. Human item 1 gains a `result:` and a ✅. The requirement row
  reads SATISFIED. The prohibition row records the PROD read. `verified_at_sha` and
  `drift_subjects` are unchanged.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

**1. The observation is of a re-created strategy, not a retry of the 2026-09-23 one.**
- **Found during:** Task 1 resolution
- **Issue:** the plan asks the founder to retry the strategy whose stitch job failed on 2026-09-23.
  That strategy no longer exists on PROD.
- **Resolution:** the founder re-created it after the deploy, as a three-account Deribit composite
  created on 2026-09-27. Its `stitch_composite` runs are the observation.
- **Consequence:** see "What was NOT measured". Whether it carries an `assignment` row is unknown.

**2. An agent read PROD, against the plan's prohibition and D-06.**
- **Issue:** the plan's prohibition says no agent queries PROD, and that the SUMMARY attributes the
  report to the founder's resume message. The status, count and refusal fields were instead taken
  by the orchestrator, through read-only PROD queries with the marker query run first. Only the
  re-creation fact came from the founder.
- **Authority:** the founder's standing rule of 2026-10-01 says PROD questions are answered
  read-only through the linked CLI by the agent, provided the override is recorded in the phase
  `CONTEXT.md` and in the `ROADMAP.md`.
- **Owed, not done here:** this executor was told not to edit `ROADMAP.md`. It did not edit
  `168-CONTEXT.md` either, because a note there alone would record the override in only one of the
  two places the rule requires. The orchestrator owes both.
- **What did not happen:** no agent wrote to PROD, read Deribit or touched a Deribit credential.
  Neither did this executor read PROD; it only recorded the evidence it was given.

**Total deviations:** 2, both about how the observation was made. Neither changes code.

## Issues Encountered

None.

## Known Stubs

None. The plan changes no source file.

## Threat Flags

None. Only counts, statuses, dates and error classes are recorded (T-168-11). No job id,
correlation id, account, strategy name, instrument string or change value appears in this file.

## Next Phase Readiness

- The TODOS `[DERIBIT-ASSIGNMENT-UNCLASSIFIED]` close condition is observed. The orchestrator can
  tick that entry, with the caveat that assignment-row presence was not measured.
- The inception reconciliation breach stays with Phase 166.3.1 NAVBREACH.

---
*Phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to*
*Completed: 2026-10-02*
