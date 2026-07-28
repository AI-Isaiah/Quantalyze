---
phase: 93-composite-data-path-correctness
plan: 01
subsystem: analytics
tags: [composite, cumulative_method, data_quality_flags, factsheet, read-path, HARD-03, drift, parity]

# Dependency graph
requires:
  - phase: 92-composite-metric-blow-up-annualization-honesty
    provides: "insufficient_window additive-DQ + drop-stale idiom and the strict `=== true` server-truth coercion this plan copies"
  - phase: 86-composite-stitch
    provides: "run_stitch_composite_job ONE canonical compute (headline == metrics_json_by_basis.cash_settlement) whose cumulative_method this plan freezes"
provides:
  - "data_quality_flags.cumulative_method — the RAW worker method ('geometric'|'simple') frozen at stitch"
  - "readCompositeFactsheet prefer-persisted-with-live-fallback method resolution (chart↔headline drift kill)"
affects: [composite-factsheet, discovery-detail, HARD-04-selfheal-pattern]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Freeze-at-stitch + prefer-persisted-with-fallback: persist the RAW producer vocabulary into an additive JSONB DQ key; the consumer prefers it and falls back to a live re-derive when absent (self-heal on next re-derive, HARD-04 precedent)"
    - "One mapping rule, two consumers: the 'simple'→'arithmetic' translation lives only on the read side so persisted and live-fallback values cannot diverge"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_stitch_composite_job.py
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/composite-read-path.test.ts
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx

key-decisions:
  - "Persist the RAW worker string ('geometric'|'simple'), never the resolved 'arithmetic'/'geometric' read basis — the translation stays in exactly ONE place (the read side) so persisted and live-fallback share one rule (research Pitfall 1)"
  - "Read-path prefers persisted with a live-derive fallback so older composites (no persisted key) render byte-identically and self-heal on next re-stitch (research Pitfall 2)"
  - "Strict-literal coercion: only the exact strings 'simple'/'geometric' honored; any malformed persisted value falls back to the live derive (T-92-05 server-truth discipline)"
  - "SyncPreviewStep.tsx:1089 live re-derive left UNCHANGED — it runs on a fresh pre-publish stitch where drift cannot occur (deliberately out of scope, research §HARD-03)"

patterns-established:
  - "Additive JSONB DQ key, no migration — same shape as HARD-04 insufficient_window"

requirements-completed: [HARD-03]

# Metrics
duration: 18min
completed: 2026-07-11
---

# Phase 93 Plan 01: Persist cumulative_method at stitch, chart prefers persisted (HARD-03) Summary

**The composite's cumulation method is now frozen into `data_quality_flags.cumulative_method` at stitch (RAW 'geometric'|'simple') and the factsheet read-path prefers it over a live config re-derive — editing `returns_denominator_config` after publish without re-stitching can no longer make the chart disagree with the frozen headline (#69 / Phase-90 LOW-2).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-11T20:24Z
- **Completed:** 2026-07-11T20:29Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 6

## Accomplishments
- `run_stitch_composite_job` freezes the RAW worker method into `data_quality_flags.cumulative_method` with a single unconditional (drop-stale) set, mirroring the HARD-04 `insufficient_window` idiom — every re-stitch overwrites, no stale value survives.
- `readCompositeFactsheet` prefers the persisted method (matches the frozen headline compute by construction) and falls back to the live `attributionBasisFromConfig` derive only when the key is absent, so older composites stay byte-identical.
- Both drift directions are regression-pinned: persisted 'simple' beats a geometric-deriving config, persisted 'geometric' beats a simple-deriving config.
- No migration (additive JSONB key); full SC-4 parity set byte-identical.

## Task Commits

Each task was committed atomically (TDD test + fix folded into one commit per task):

1. **Task 1: Persist RAW cumulative_method into merged_flags at stitch (+ regression tests)** — `46655c6c` (feat)
2. **Task 2: readCompositeFactsheet prefers persisted method, falls back for older composites** — `f56df962` (feat)

## Files Created/Modified
- `analytics-service/services/job_worker.py` — one additive line `merged_flags["cumulative_method"] = cumulative_method` in the `run_stitch_composite_job` persist block (after the `insufficient_window` set/pop, before `benchmark_unavailable`), plus a descriptive HARD-03 comment.
- `analytics-service/tests/test_stitch_composite_job.py` — 3 offline regression tests (`_persisted_dqf` helper): geometric for null config, simple for allocated config, raw-vocabulary invariant (`in {geometric,simple}` and `!= "arithmetic"`).
- `src/lib/factsheet/composite-read-path.ts` — widened the `dqf` input type with `cumulative_method?: unknown`; replaced the single C-1 resolution line with prefer-persisted-with-fallback (strict-literal coercion, one mapping rule).
- `src/lib/factsheet/composite-read-path.test.ts` — 4 regression tests (drift-kill both directions, older-composite fallback, strict-literal coercion over `true/42/"arithmetic"/{}`).
- `src/app/factsheet/[id]/v2/page.tsx` — added `cumulative_method?: unknown` to the page-level `dqf` cast (enumerated fields, so the field was required).
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` — same page-level `dqf` cast field addition.

## RED-before / GREEN-after evidence

**Task 1 (Python):** With no persist line, `pytest tests/test_stitch_composite_job.py -k cumulative_method -q` → **3 failed** (`KeyError: 'cumulative_method'`). After adding the one line → **3 passed, 28 deselected**. Persist-site count `grep -v '^\s*#' … | grep -c 'merged_flags\["cumulative_method"\]'` == **1**.

**Task 2 (TS):** With the live-only re-derive, `vitest run … -t "HARD-03"` → the two drift-kill tests **FAILED** (`expected 'arithmetic' to be 'geometric'` / vice versa — current code ignores the persisted method); the fallback + strict-literal tests already passed (current behavior IS the fallback). After the fix → all HARD-03 tests pass; full read-path + attribution files **25 passed**.

## Page-cast finding (Task 2 step 3)
Both consumer surfaces cast `data_quality_flags` to an **enumerated** inline object type (not the imported input type), so each required the explicit `cumulative_method?: unknown` field addition. Both were edited. Recorded here per plan instruction.

## Deliberate non-change
`SyncPreviewStep.tsx:1089` still re-derives the method live from config. It runs on a fresh pre-publish stitch where the persisted headline and the config are produced in the same pass, so drift cannot occur there — left unchanged per research §HARD-03.

## Decisions Made
None beyond the plan — all four key decisions were pre-specified in the plan and followed exactly.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- **SC-4 parity set (Python):** `pytest tests/test_stitch_composite_job.py tests/test_composite_headline_parity.py tests/test_golden_parity.py tests/test_metrics_parity.py -q` → **80 passed** (headline/goldens/metrics byte-identical).
- **Frontend:** `vitest run src/lib/factsheet src/lib/composite` → **230 passed** (20 files; includes `compositeAttribution.test.ts`, unchanged).
- **Type/lint:** `tsc --noEmit` exit 0; `npm run lint` **0 errors** (1 pre-existing warning in `EquityChart.tsx`, unrelated — out of scope). `mypy services/job_worker.py` clean.
- **No migration:** `git status --porcelain supabase/migrations/` empty throughout. No persisted scalar moved.

## Known Stubs
None.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- HARD-03 closed. HARD-02 (first-key window) and HARD-05 (ccxt fail-loud) remain open for this phase — see 93-RESEARCH.md §HARD-02 / §HARD-05. Both are additive/independent of this change.
- Self-heal note for verification: the persisted `cumulative_method` key appears on a composite's NEXT re-stitch; existing published composites keep working via the live fallback until then (no backfill needed).

## Self-Check: PASSED
- Files verified present: job_worker.py, composite-read-path.ts, 93-01-SUMMARY.md
- Commits verified in git log: 46655c6c (Task 1), f56df962 (Task 2)

---
*Phase: 93-composite-data-path-correctness*
*Completed: 2026-07-11*
