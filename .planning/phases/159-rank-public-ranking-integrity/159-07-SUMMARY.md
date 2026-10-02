---
phase: 159-rank-public-ranking-integrity
plan: 07
subsystem: security
tags: [postgrest, supabase, react-hooks, fingerprint, input-validation, csv-wizard]

requires:
  - phase: 146.2-csv-classification-conflict
    provides: the classification-conflict 409 whose remedy this plan makes reachable
  - phase: 110-contrib
    provides: withPublishedOrOwner and its only production consumers
provides:
  - "csvSubmissionSignature/Fingerprint widened with categoryId + assetClass (NUL-separated, pinned null sentinel)"
  - "WizardClient passes classification at both fingerprint call sites and lists it in both dependency arrays"
  - "withPublishedOrOwner shape-validates the uid with the house isUuid before PostgREST .or() interpolation, failing closed to published-only"
affects: [csv-wizard, strategies-browse, factsheet-owner-lane, strategies-returns]

actuals:
  tokens: 46800
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Shape-validate any value spliced into a PostgREST filter STRING; fail closed through the existing single-source predicate helper, never a second literal"
    - "Source-level dependency-array pins when a behavioural test cannot discriminate a stale React dep"

key-files:
  created: []
  modified:
    - src/lib/wizard/localStorage.ts
    - src/lib/wizard/localStorage.test.ts
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.csv-durable-mint.test.tsx
    - src/lib/visibility.ts
    - src/lib/visibility.test.ts

key-decisions:
  - "D-05 evidence gate returned NOTHING: no source anywhere states an intent to dedupe across classifications, so the DEFAULT arm (include classification in the fingerprint) was taken, not the documented-exclusion fallback"
  - "Classification is read off csvMetadataDraft, not the API branch's metadataDraft — the plan's line refs (:272/:294) pointed at the API-branch draft, which never reaches csv-finalize"
  - "A null classification serialises to a SOH (\\u0001) sentinel, pinned by an exact-string test, so 'not yet chosen' cannot collide with '' or with the literal text 'null'"
  - "The fail-closed visibility arm routes through withPublishedOnly rather than authoring a second published-only predicate, so the two arms cannot drift (B10)"
  - "MEASURED: the plan's prescribed dep-array neuter drill cannot go RED behaviourally, because every classification edit reachable in today's UI also moves `step` (already a dep). A source-level dep-array pin was added to supply the missing teeth."

patterns-established:
  - "Filter-string injection defence: validate shape at the helper, fail CLOSED to the narrower predicate, log LOUD under a greppable prefix, and keep the raw value out of the message template"
  - "When a behavioural test provably cannot discriminate a wiring detail, say so and add a structural pin rather than claiming a drill that does not fail"

requirements-completed: [RANK-08, RANK-09]

coverage:
  - id: D1
    description: "The CSV re-mint fingerprint accounts for classification: a category or asset-class change moves it, an identical resubmit does not"
    requirement: "RANK-08"
    verification:
      - kind: unit
        ref: "src/lib/wizard/localStorage.test.ts#csvSubmissionSignature/Fingerprint — classification (RANK-08)"
        status: pass
    human_judgment: false
  - id: D2
    description: "In the component, a classification change on a burned session mints a fresh wizard_session_id while a true duplicate still fences"
    requirement: "RANK-08"
    verification:
      - kind: integration
        ref: "src/app/(dashboard)/strategies/new/wizard/WizardClient.csv-durable-mint.test.tsx#WizardClient — RANK-08 classification re-mint"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/new/wizard/WizardClient.csv-durable-mint.test.tsx#WizardClient — RANK-08 dep-array wiring"
        status: pass
    human_judgment: false
  - id: D3
    description: "A non-UUID uid never reaches the PostgREST .or() filter string; it fails closed to published-only and fails loud"
    requirement: "RANK-09"
    verification:
      - kind: unit
        ref: "src/lib/visibility.test.ts#uid shape validation (RANK-09 / D-06)"
        status: pass
      - kind: integration
        ref: "src/app/api/strategies/browse/route.test.ts + src/app/api/strategies/[id]/returns/route.test.ts + src/app/factsheet/[id]/v2/page.owner-lane.test.tsx (happy path unchanged)"
        status: pass
    human_judgment: false
  - id: D4
    description: "End-to-end 409 remedy against a real csv-finalize: a user who re-classifies after the classification-conflict refusal actually gets a fresh strategy"
    verification: []
    human_judgment: true
    rationale: "The client fence and the server refusal are pinned separately; nobody has driven the two together against a live route. The composed behaviour is what the requirement promises the user."

duration: 44min
completed: 2026-08-21
status: complete
---

# Phase 159 Plan 07: Client-lib integrity gaps Summary

**Classification joins the CSV re-mint fingerprint so the 146.2 conflict-409's own remedy can mint a fresh session, and `withPublishedOrOwner` now gates the uid through the house `isUuid` before it can become PostgREST filter grammar.**

## Performance

- **Duration:** 44 min
- **Started:** 2026-08-21T11:00:00Z
- **Completed:** 2026-08-21T11:43:39Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- **RANK-08 (signature).** `csvSubmissionSignature` / `csvSubmissionFingerprint` gained `categoryId` and `assetClass` as two further NUL-separated fields with an explicit SOH null sentinel. The FNV-1a mechanism and exact-length prefix are byte-unchanged — the digest stays non-cryptographic by design; the widening only enlarges what it is taken over.
- **RANK-08 (docblock).** The falsified premise ("`date` and `daily_return` are the only fields that reach `csv-finalize`") is corrected at the site, naming `CsvSubmitStep.tsx:442,459` as the counter-evidence and the 146.2 409 as the consequence.
- **RANK-08 (wiring).** Both `WizardClient` fingerprint call sites pass classification and both dependency arrays carry it, each with a one-line comment naming the stale-dep failure mode.
- **RANK-09.** `withPublishedOrOwner` validates `authUserId` with `isUuid` before interpolation; a non-conforming uid takes the published-only arm via `withPublishedOnly`, logs under `[visibility.withPublishedOrOwner]`, and never reaches `.or()`.

## D-05 evidence gate — outcome: DEFAULT ARM

The plan required an evidence gate before choosing between D-05's two arms. Three greps, all at HEAD:

| Grep | Result |
|---|---|
| `-i "dedupe\|dedup\|deliberately excludes\|classification"` over `src/lib/wizard/localStorage.ts` | 1 hit — an unrelated `WIZARD_STEP_KEYS` comment noting that `csv_metadata` collects classification. No dedupe intent. |
| `-i "fingerprint"` over `src/app/api/strategies/csv-finalize/route.ts` | **zero hits** — the route says nothing about the client fingerprint at all. |
| `-i "dedupe\|dedup\|cross-classification"` over `WizardClient.tsx` | 7 hits, all the connect-key `dedupedExisting` notice on the **API** branch. Nothing fingerprint-related. |

**No source evidence of intentional cross-classification dedupe exists.** The D-05 default arm (include classification) was taken; the documented-exclusion fallback was not.

## Caller inventory (the compile-breaking widening)

Repo-wide grep over `src/` and `e2e/` for both functions:

| Caller | Action |
|---|---|
| `csvSubmissionSignature` — `csvSubmissionFingerprint` (same module) | passes the two new params through |
| `csvSubmissionSignature` — production callers outside the module | **none exist** |
| `csvSubmissionFingerprint` — `WizardClient.tsx` re-mint effect | updated (4 args) |
| `csvSubmissionFingerprint` — `WizardClient.tsx` `handleCsvSubmitFailed` | updated (4 args) |
| `csvSubmissionFingerprint` — `localStorage.test.ts` (6 existing cases) | updated; classification held CONSTANT so each case still isolates the field it names |

No optional-parameter soft edge was left: both new params are required, so `npx tsc --noEmit` is the enforcement.

## utils.ts purity verification (RANK-09 constraint)

`src/lib/visibility.ts` is deliberately isomorphic. Before importing `isUuid`:

- `src/lib/utils.ts` imports exactly two things — `import type { StrategyAnalytics } from "./types"` (type-only, erased) and `./closed-sets`.
- `src/lib/closed-sets.ts` imports exactly one thing — `zod`.
- No `next/headers`, no `@/lib/supabase/server`, no Sentry server SDK anywhere on that chain.

`isUuid` is therefore importable without tainting the module. `console.error` was kept as the logging floor for the same reason — `captureToSentry` was not verified client-pure, so it was not used. Post-change grep of `^import` in `visibility.ts` returns exactly one line: `import { isUuid } from "@/lib/utils";`. No new regex was authored (`UUID_RE` does not appear in the file).

## Observed REDs (every pin proven able to fail)

| # | Drill | Observed |
|---|---|---|
| 1 | Task 1 tests against the **pre-widening** implementation | 4 of 5 RED. Both categories produced the identical fingerprint `12.6e6c7c340fdf5f74` — the defect verbatim. The true-duplicate control passed both before and after, as a control must. |
| 2 | Neuter: drop `categoryId` from the signature body | "changes when ONLY the category changes" RED (`1g.7c590c22ce33b002` on both sides). Restored. |
| 3 | Neuter: both `WizardClient` call sites pass `null` instead of the classification | Both component-level re-mint tests RED; the negative control and the dep pin stayed green. Restored. |
| 4 | Neuter: remove `csvCategoryId` from the re-mint effect's dep array | **Behavioural tests stayed GREEN** (see deviation 2); the **dep-array wiring pin went RED**. Restored. |
| 5 | Task 3 tests against the **pre-fix** implementation | 3 RED, capturing the interpolated payload `status.eq.published,user_id.eq.x) or (user_id.neq.z` reaching `.or()`. |
| 6 | Neuter: bypass the `isUuid` gate (`if (false && ...)`) | Same 3 RED, same captured payload. Restored. |

## Task Commits

1. **Tasks 1 + 2: fingerprint widening + WizardClient wiring** — `bdafcd39` (feat)
2. **Task 3: uid shape validation** — `d056d625` (fix)
3. **Comment re-wrap left by task 2's edit** — `bf481a04` (style)

Tasks 1 and 2 share one commit by the plan's own instruction: the widening is compile-breaking, so `WizardClient.tsx` does not typecheck until both land.

## Files Created/Modified

- `src/lib/wizard/localStorage.ts` — widened signature + fingerprint, corrected docblock, `CLASSIFICATION_ABSENT` sentinel
- `src/lib/wizard/localStorage.test.ts` — 5 new classification pins; 6 existing cases updated to the 4-arg shape
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — `csvCategoryId` / `csvAssetClass` derived locals, both call sites, both dep arrays
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.csv-durable-mint.test.tsx` — classification knob on the metadata stub, `review-edit-metadata` route, 3 behavioural pins + 1 dep-array pin
- `src/lib/visibility.ts` — `isUuid` gate, fail-closed arm through `withPublishedOnly`, D-06 rationale, purity note extended
- `src/lib/visibility.test.ts` — 4 new RANK-09 pins; 3 existing cases moved to real UUIDs

## Verification

| Gate | Result |
|---|---|
| `npx vitest run src/lib/wizard/localStorage.test.ts --no-file-parallelism` | 57 passed |
| `npx vitest run WizardClient.csv-durable-mint + WizardClient.csv-burn-persistence --no-file-parallelism` | 12 passed |
| All 39 wizard-directory test files | 961 passed |
| `npx vitest run src/lib/visibility.test.ts` + all 5 consumer suites (browse, returns, factsheet owner-lane, factsheet smoothed-wiring, contracts-registry) | 146 passed |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors (2 pre-existing warnings in unrelated files — out of scope, not touched) |
| **Full suite** `npx vitest run --no-file-parallelism` | **exit 0 — 786 files passed / 19 skipped; 12,015 tests passed / 281 skipped** |

The 281 skips are the by-design live-DB skips: this worktree carries no `.env.test.local`, which is exactly the configuration under which the local suite is a valid gate.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: the plan's line references for the classification state (`:272` / `:294`) point at `metadataDraft`, the **API** branch's draft. The CSV branch keeps its own `csvMetadataDraft` (`:369`), and that is what `CsvSubmitStep` posts as `metadata.category_id` / `metadata.asset_class` — so it is what the 409 refuses on and what the fingerprint must read. The plan anticipated this ("re-grep, refs drift").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wired `csvMetadataDraft`, not the API branch's `metadataDraft`**
- **Found during:** Task 2
- **Issue:** The plan's cited refs (`categoryId ~:272`, `assetClass ~:294`) resolve to `metadataDraft`, the API-branch state. It never reaches `csv-finalize`; reading it would have produced a fingerprint that ignores every CSV-branch classification edit — the defect intact, with tests that look wired.
- **Fix:** Derived `csvCategoryId` / `csvAssetClass` from `csvMetadataDraft` (`:369`), traced to `CsvSubmitStep.tsx:442,459` where those exact fields are posted.
- **Verification:** Neuter drill 3 — component-level re-mint tests RED without the wiring.
- **Committed in:** `bdafcd39`

**2. [Rule 2 - Missing critical / anti-vacuity] The prescribed dep-array drill cannot go RED; a structural pin was added**
- **Found during:** Task 2
- **Issue:** The plan required "scratch-remove `categoryId` from the `:624` dep array → Test 1 RED". **Measured: it does not go RED.** Every classification edit reachable in today's UI runs through `MetadataStep.onComplete`, which also calls `setStep("csv_review")` — and `step` is already a dependency of both hooks, so the effect and the callback refresh anyway. The behavioural test is masked by that co-variance. Claiming the drill without measuring it would have been exactly the vacuity the house rule forbids.
- **Fix:** Kept the dep additions (correct by construction, not by accident — a future in-place classification control would resurrect the failure mode) and added `WizardClient — RANK-08 dep-array wiring`: a source-level pin that extracts each `csvSubmissionFingerprint` call's dependency array and asserts both names are present, with anchors (`toHaveLength(2)`, `deps.length < 400`, pre-existing dep names) so it cannot pass vacuously.
- **Verification:** Neuter drill 4 — with `csvCategoryId` removed from the effect's array, the three behavioural tests pass and the structural pin fails. Precisely the intended division of labour.
- **Committed in:** `bdafcd39`

**3. [Rule 1 - Bug] Existing `visibility.test.ts` fixtures were not UUIDs**
- **Found during:** Task 3
- **Issue:** Three pre-existing cases used `"uid-123"` / `"session-owner"`. After the gate those take the fail-closed arm, so the tests would have failed for a reason unrelated to what they pin.
- **Fix:** Moved them to real UUIDs (`00000000-0000-0000-0000-000000000001`, `22222222-2222-4222-8222-222222222222`), matching the fixtures the browse / returns / owner-lane suites already use. No production behaviour change; the assertions are otherwise byte-identical.
- **Verification:** Updated fixtures pass both before and against the fix (no false RED); all 5 consumer suites green.
- **Committed in:** `d056d625`

**4. [Rule 3 - Blocking] Worktree had no `node_modules`**
- **Found during:** Task 1 precondition
- **Issue:** GSD worktrees ship none, so `npx vitest` / `npx tsc` cannot resolve.
- **Fix:** Read-only symlink to the main checkout's `node_modules` (never `npm install`), per the documented worktree procedure. Not committed (gitignored).

---

**Total deviations:** 4 auto-fixed (2 bugs, 1 missing-critical/anti-vacuity, 1 blocking)
**Impact on plan:** No scope creep. Deviations 1 and 2 are the difference between a fix that works and a fix that only looks wired; the plan itself flagged the drift risk behind deviation 1.

## Prohibitions — verified

| Prohibition | Verification |
|---|---|
| Fingerprint NOT upgraded to a cryptographic hash | `git diff` of `localStorage.ts`: no crypto/hash import added; the FNV-1a loop and the base36 length prefix are untouched. Only the input to the digest changed. |
| `visibility.ts` stays pure and client-safe | Post-change `^import` grep returns one line (`@/lib/utils`); the chain `utils → types (type-only) + closed-sets → zod` contains nothing server-only. `console.error` used, not Sentry. The module-header purity note was extended to state and justify the one import. |
| The malformed-uid arm never interpolates the input | Source read: `.or` is unreachable on that path (early `return withPublishedOnly(query)`); the raw uid appears only as a second `console.error` argument. Pinned by a test asserting the message template does NOT contain the injection payload. |

## TDD Gate Compliance

The plan's own `<verification>` mandates a single commit for Tasks 1+2 (the widening is compile-breaking across two files), so the RED/GREEN gates are **not** split into `test(...)` → `feat(...)` commits for that pair. Every RED was observed first-hand and is tabulated above; Task 3 landed as `fix(...)` with its REDs likewise observed. No gate was skipped — only their commit granularity differs from the default.

## Issues Encountered

- Writing `NUL` / `SOH` escape sequences through the editing tool produced **raw control bytes** in the file, which silently turned it into a binary file for `grep`. Caught by a control-byte scan and repaired with an explicit `perl` substitution; every subsequent NUL/SOH edit was routed through `perl` rather than typed. The RESEARCH/PATTERNS files carried the same warning about this transcription hazard.

## Known Stubs

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- RANK-08 and RANK-09 are closed at the client-lib layer. ROADMAP 159 SC-5's second and third arms hold.
- **Open for phase UAT (coverage D4):** nobody has driven the client re-mint and the server's classification-conflict 409 together against a live `csv-finalize`. The two halves are pinned separately.
- **Note for the phase verifier:** the `WizardClient — RANK-08 dep-array wiring` test is a source-scanning pin. If a future refactor renames the derived locals or changes the number of `csvSubmissionFingerprint` call sites, it fails by design and must be updated deliberately, not deleted.

## Self-Check: PASSED

- All 6 modified source files present on disk.
- All 3 commits resolve: `bdafcd39`, `d056d625`, `bf481a04`.
- Full vitest suite exit 0 (12,015 passed / 281 by-design live-DB skips); `tsc --noEmit` exit 0; `npm run lint` 0 errors.

---
*Phase: 159-rank-public-ranking-integrity*
*Completed: 2026-08-21*
