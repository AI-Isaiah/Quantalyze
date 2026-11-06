---
phase: 159-rank-public-ranking-integrity
plan: 01
subsystem: database
tags: [census, percentiles, ranking, prod, read-only, rank-01]

retrospective: "Written 2026-09-30, about six weeks after execution, by founder decision (2026-09-30: write the SUMMARY and close the phase). It overrides the 'No SUMMARY was retro-fitted' note in #790 (eab976bb2) for THIS plan only. Every fact below is quoted from the committed 159-CENSUS.md or measured from git history on 2026-09-30. None is re-derived from memory, and PROD was not re-queried."

requires: []
provides:
  - "159-CENSUS.md: the committed D-01 / C-D1 gate carrying real PROD counts against both floors, the fossil-row population, the per-strategy before/after percentile snapshot, and the floor-crossing analysis for phase UAT"
affects: [159-02]

actuals:
  tokens: 6122     # chars/4 of 159-CENSUS.md at 8b06831b (24,488 bytes), measured 2026-09-30
  tasks: 2
  commits: 2       # measured 2026-09-30: git rev-list --count 985d94121^..8b06831b
plan_head_before: 7430546d41c56c1948f808b6aaebfbe7c9adfe68
plan_head_after: 8b06831b241c961eff64ac2307a2735e4c52457d

tech-stack:
  added: []
  patterns:
    - "Census as a committed decision gate: the data that decides a visible change is on disk before the change exists on the branch"

key-files:
  created:
    - .planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md
  modified: []

key-decisions:
  - "D-01 applied as written: the filter proceeds regardless of the census. The census decides what phase UAT must be told to expect. It cannot veto the gate."
  - "Demo-data pollution (15 of 17 fossil rows are seeded examples) recorded as a data-repair question and kept OUT of phase-159 scope"

requirements-completed: [RANK-01]   # shared with 159-02, which ships the gate itself

duration: 5min   # 13:01:46 -> 13:07:15 between the two task commits; authoring time before the first commit is not recorded
completed: 2026-08-21
status: complete
---

# Phase 159 Plan 01: C-M1 PROD census Summary

> **Retrospective SUMMARY, written 2026-09-30 by founder decision.** The plan finished on
> 2026-08-21. Its deliverable, `159-CENSUS.md`, was committed with real PROD numbers, but no
> SUMMARY was written: the plan stopped at an orchestrator-discharged checkpoint
> (`159-VERIFICATION.md`, Additional Findings: "159-01 has no SUMMARY — expected"). #790
> (`eab976bb2`) recorded "No SUMMARY was retro-fitted" as a standing note. On 2026-09-30 the
> founder decided to write this SUMMARY and close Phase 159, which overrides that note for this
> plan only. Everything here is quoted from the census or measured from git. PROD was not
> queried again.

**Read-only PROD census against `khslejtfbuezsmvmtsdn`. The one category, `crypto-sma`, drops
from 18 rows to 1 under the two-value computed gate and crosses the `<5` badge floor. The RPC
cohort drops from 3 to 1 but was already below min-N 20. 17 published fossil rows (`failed` but
holding KPIs, 15 of them seeded examples) make up the whole population the gate removes.**

## Performance

- **Tasks:** 2 (Task 1 scaffold, Task 2 orchestrator checkpoint that runs the SQL against PROD)
- **Task commits:** 2026-08-21 13:01:46 → 13:07:15 (+0200)
- **Files:** 1 created (`159-CENSUS.md`)

## Task Commits

On the feature branch `feat/v1.20-phase-159`, merged to `main` as the squash `bf00ad0c1` (#702, v0.70.0.0):

1. **Task 1: census scaffold, read-only SQL** — `985d94121` `docs(159-01): author 159-CENSUS.md scaffold with read-only PROD census SQL`
2. **Task 2: PROD results (orchestrator checkpoint)** — `8b06831b` `docs(159-01): record C-M1 PROD census results — crypto-sma crosses the <5 badge floor`

## The PROD ref

Quoted from the census header: `khslejtfbuezsmvmtsdn` (name `quantalyze`, ACTIVE_HEALTHY),
"confirmed against the project list before any query ran". The census records that the TEST ref
`qmnijlgmdhviwzwfyzlc` was not used, and no TEST-derived number appears in it.

## Headline counts (quoted from 159-CENSUS.md)

| Measure | Before gate | After gate | Floor | Crossing? |
|---|---|---|---|---|
| `crypto-sma` published with analytics row (Query 1) | 18 | 1 | `< 5` badge floor | **Yes.** `badge_floor_before` true → `badge_floor_after` false |
| RPC cohort `get_verified_cohort_rank` (Query 2) | 3 | 1 | min-N 20 | **No.** Already below 20 before the gate |
| Fossil rows: published, non-computed, holding KPIs (Query 3) | 17 | 0 in cohort | — | 17 rows, all `failed`, all with `sharpe` and `cagr` |
| Per-strategy snapshot (Query 4) | 18 strategies × 7 KPIs = 126 rows | 17 NULL, 1 survivor | — | see C-D1 (c) |

- **One category exists in PROD** (`crypto-sma`), and there is no `(no category)` partition.
- **Fossil composition:** 15 are `is_example = true`, computed 2026-05-27 and `failed` since then.
  2 are real strategies that failed on 2026-08-21. The one gate survivor is a real `complete`
  strategy computed on 2026-08-21.

## C-D1 outcome list (quoted from the census's floor-crossing section)

- **(a) Categories crossing the `<5` badge floor:** `crypto-sma`, the only category. Every
  percentile badge on the public discovery surface stops rendering once the gate lands. The census
  calls this "the headline UAT expectation".
- **(b) RPC min-N 20:** `cohort_before` = 3, `cohort_after` = 1. **No crossing occurs**, because the
  RPC already returned NULL percentiles with an honest `cohort_n`. The gate is invisible on this
  surface.
- **(c) Strategies whose percentile disappears or moves:**
  - Disappears (`pct_after` NULL on all 7 KPIs): the 15 seeded example ids
    `51a111ed-0000-4000-8000-000000000001` … `-000000000015`, plus
    `8581f739-1a7b-42a4-a209-3acfa327e259` and `fc1b4014-da41-49d7-8592-138be5a6fa12`.
  - Moves: `13f7b07f-b792-41fc-bfef-6854adce2c4f`, the sole survivor: `cagr` 22→100, `calmar`
    33→100, `cumulative_return` 22→100, `sharpe` 33→100, `sortino` 33→100, `max_drawdown` 89→0,
    `volatility` 83→0. It rises on five KPIs and falls on two, so no test may assert that "ranks
    improve". None of these values render, because the `<5` floor suppresses the whole category.
- **(d) Root cause:** 88% of the pollution is seeded demo data. This is a data-repair question
  (recompute or unpublish the examples) and is out of phase-159 scope. The census states it was
  logged to TODOS.md. This SUMMARY does not cite an entry id, because that entry was not
  re-verified on 2026-09-30.
- **The D-01 decision:** "The filter proceeds regardless." A disappearing rank is the honest outcome
  decided in advance. The census only determines what UAT is told to expect.

## D-01 ordering evidence

`159-VERIFICATION.md` (§SC2, Census-before-filter, VERIFIED) records the order: census results commit `8b06831b`
(13:07:15) comes before migration commit `358fbbda` (14:27:48, `feat(159-02): gate
get_verified_cohort_rank cohort + add its first CI test`), and the verifier's re-run of
`git merge-base --is-ancestor` returned OK. **Re-measured 2026-09-30:**
`git merge-base --is-ancestor 8b06831b 358fbbda` exits 0. The census was on the branch before the
migration existed there.

## Prohibition checks (the plan's two `flagged: true` prohibitions, measured 2026-09-30)

- **No PII:** `grep -c '@' 159-CENSUS.md` → `0`. Every pasted table carries only strategy ids,
  counts, statuses, booleans, dates and percentiles. No email, uid or name column appears.
- **No mutations:** `grep -inE '^(insert|update|delete|alter|create|drop|truncate) ' 159-CENSUS.md` →
  no match (exit 1). All four query blocks are `SELECT`s or `WITH … SELECT`.

## Deviations from Plan

None in the work itself. The paperwork deviates in one way: this SUMMARY was written on
2026-09-30, not at plan completion, by founder decision. The override is recorded in
`159-CONTEXT.md` and in the ROADMAP Phase 159 progress row.

## Known Stubs

None. The plan's only artifact is a census document with real PROD results and zero
`RESULTS: PENDING` markers.

## Next Phase Readiness

159-02 used this artifact as its precondition and shipped the gate (see `159-02-SUMMARY.md`,
`requires: 159-01`). With this SUMMARY, Phase 159 is 7/7 summarised. `159-VERIFICATION.md`
frontmatter is `status: passed` (5/5).

## Self-Check: PASSED

- FOUND: `.planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md`
- FOUND: `985d94121`, `8b06831b`, `358fbbda`, `bf00ad0c1` (all resolved with `git rev-parse` on 2026-09-30)
- `8b06831b` is an ancestor of `358fbbda`: OK

---
*Phase: 159-rank-public-ranking-integrity*
*Plan 01 executed 2026-08-21. SUMMARY written retrospectively 2026-09-30 (founder decision).*
