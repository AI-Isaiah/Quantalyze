---
phase: 84-blend-allocation-asset-class-annualization
plan: 07
subsystem: api
tags: [csv-finalize, wizard, asset-class, annualization, validation, react, nextjs]

# Dependency graph
requires:
  - phase: 84 (#597 single-strategy half, shipped v0.39.0.0)
    provides: strategies.asset_class column + annualizationPeriods(assetClass) (√365 crypto / √252 traditional)
provides:
  - CSV wizard asset_class picker value persists end-to-end (CsvSubmitStep → csv-finalize → strategies.asset_class)
  - Closed-set ('crypto' | 'traditional') boundary validation on the CSV finalize path (fail-loud, NEW-C14-03 pattern)
  - buildMetadataUpdatePayload exported for direct unit testing
affects: [blend annualization, scenario-composer, allocator-portfolio, any surface reading strategies.asset_class for CSV strategies]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CSV-path asset_class keeps the user's picker choice VERBATIM — no API-key-style force-derive to 'crypto'"
    - "Absent metadata field omitted from UPDATE → column default (byte-identical back-compat)"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.test.tsx
    - src/app/api/strategies/csv-finalize/route.ts
    - src/__tests__/csv-finalize-rpc.test.ts

key-decisions:
  - "CSV strategies keep the user's asset_class picker choice (crypto OR traditional) — the finalize-wizard apiKeyId force-derive is API-key-only and was NOT copied onto the CSV path"
  - "Present-but-invalid asset_class 400s (CSV_INVALID_FORMAT); absent field omitted from UPDATE → column stays null → 252 default downstream (back-compat)"
  - "asset_class rides the existing @audit-skipped owner-scoped strategies UPDATE in applyCsvMetadataUpdate — no new mutation, no new pragma needed"
  - "Exported buildMetadataUpdatePayload (mirroring the existing parseCsvMetadata export-for-testing precedent) to pin the absent→omitted UPDATE contract directly"

patterns-established:
  - "No case-folding on the closed set — 'CRYPTO' is a rejected value, not silently coerced (DB set is lowercase)"

requirements-completed: [BLEND-04]

# Metrics
duration: 8min
completed: 2026-07-10
---

# Phase 84 Plan 07: CSV-finalize asset_class forwarding + persistence Summary

**The wizard's CSV branch now persists the user's asset_class picker choice end-to-end (CsvSubmitStep POST body → closed-set route validation → strategies.asset_class), keeping 'traditional' as 'traditional' with no force-derive — closing the deferred #597 upload-picker gap.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-09T23:57:18Z
- **Completed:** 2026-07-10T00:02:30Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4

## Accomplishments
- CsvSubmitStep forwards `metadata.asset_class` (snake_case) verbatim on every CSV finalize — the picker value no longer dropped on the floor.
- csv-finalize route validates the closed set `'crypto' | 'traditional'` at the boundary: present-but-invalid → 400 CSV_INVALID_FORMAT (NEW-C14-03 fail-loud); absent → omitted from the UPDATE (column stays null → 252 default).
- CSV path keeps the user's choice — NO `apiKeyId ? "crypto"` force-derive copied (locked #597 decision); a genuinely traditional CSV track record is the phase's one real √252 blend leg.
- Full TDD RED→GREEN on both tasks; 51 tests pass (6 live-DB skipped), tsc + eslint clean.

## Task Commits

Each task was committed atomically (TDD: RED assertions + GREEN impl folded into one commit per task since the failing test and fix touch a shared pair):

1. **Task 1: Forward asset_class from CsvSubmitStep** — `2536fc85` (feat)
2. **Task 2: Validate + persist asset_class in csv-finalize** — `d347b691` (feat)

## Files Created/Modified
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx` — adds `asset_class: metadata.assetClass` to the finalize POST metadata body with a #597-part-2 comment.
- `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.test.tsx` — pins the picker value leaves the client for BOTH crypto and traditional (no force-crypto).
- `src/app/api/strategies/csv-finalize/route.ts` — `CsvMetadataPayload.asset_class` closed set; `parseCsvMetadata` fail-loud validation; `buildMetadataUpdatePayload` verbatim write + export.
- `src/__tests__/csv-finalize-rpc.test.ts` — 7 parseCsvMetadata + 4 buildMetadataUpdatePayload pure-function cases; added `@vitest-environment node` + `server-only` stub so the route's pure functions import.

## Decisions Made
- Kept the CSV path free of the API-key force-derive (locked #597 decision, restated in code comments at both the client and the route).
- Exported `buildMetadataUpdatePayload` to pin "absent → no asset_class key in the update payload" directly, rather than inferring it through parseCsvMetadata's payload shape — mirrors the existing `export function parseCsvMetadata` "for direct unit testing" precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added node-env + server-only stub to csv-finalize-rpc.test.ts to import the route's pure functions**
- **Found during:** Task 2 (test RED step)
- **Issue:** The plan designates `csv-finalize-rpc.test.ts` (a live-DB integration file) as the home for the new asset_class tests, but importing the csv-finalize route pulls in `server-only`, which throws outside a node environment — the whole suite errored with "This module cannot be imported from a Client Component module."
- **Fix:** Added `// @vitest-environment node` and `vi.mock("server-only", () => ({}))` at the top of the file (mirroring the sibling `csv-finalize-c14-regression.test.ts` harness). The existing live-DB tests are node-oriented (supabase client, no DOM) and unaffected — all 6 still skip cleanly without live DB.
- **Files modified:** src/__tests__/csv-finalize-rpc.test.ts
- **Verification:** Suite imports and runs; 46 pass / 6 skip in that file; RED assertions failed for the right reason (asset_class undefined / buildMetadataUpdatePayload not exported) before GREEN.
- **Committed in:** d347b691 (Task 2 commit)

**2. [Rule 3 - Test enablement] Exported buildMetadataUpdatePayload**
- **Found during:** Task 2
- **Issue:** The acceptance criterion "absent → no asset_class key in the update payload" targets `buildMetadataUpdatePayload`'s output, but the function was module-private.
- **Fix:** Added `export` (mirrors the existing `export function parseCsvMetadata` "Exported for direct unit testing" precedent). No behavior change.
- **Files modified:** src/app/api/strategies/csv-finalize/route.ts
- **Verification:** Direct unit tests pin verbatim-write + absent-omission; tsc clean.
- **Committed in:** d347b691 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking/test-enablement)
**Impact on plan:** Both are test-harness enablement for the file the plan designated; zero production-behavior change beyond the planned asset_class thread. No scope creep.

## Issues Encountered
- A transient `tsc` error (`lastRemoveAdded` in `ScenarioComposer.test.tsx`) surfaced on one run — that file belongs to the parallel 84-05 executor on this shared branch, not this plan. A re-run showed tsc fully clean; my four files were never implicated. Out of scope per the scope boundary; not touched.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CSV strategies can now carry a `traditional` asset_class, enabling the phase's real √252 blend leg. Blend-annualization plans (84-05 scenario-composer, allocator-portfolio) that derive `blendPeriodsPerYear` from constituent legs' `asset_class` can rely on CSV legs now having a correct, user-attested value instead of a silent null.

## Verification Evidence

```
$ npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.test.tsx" \
    src/__tests__/csv-finalize-rpc.test.ts src/__tests__/csv-finalize-c14-regression.test.ts --no-file-parallelism
 Test Files  3 passed (3)
      Tests  51 passed | 6 skipped (57)

$ npx tsc --noEmit         → no errors (my four files clean)
$ npx eslint <4 files>     → exit 0, no warnings

Acceptance greps:
  grep -c "asset_class: metadata.assetClass" CsvSubmitStep.tsx          → 1  (forwarded)
  grep -c '"crypto" | "traditional"' csv-finalize/route.ts             → 1  (typed closed set, ≥1)
  grep -v '^\s*//' route.ts | grep -c 'apiKeyId ? "crypto"'            → 0  (no force-derive copied)
```

## Self-Check: PASSED

- All 4 modified files present + SUMMARY written.
- Task commits `2536fc85`, `d347b691` confirmed in git log.

---
*Phase: 84-blend-allocation-asset-class-annualization*
*Completed: 2026-07-10*
