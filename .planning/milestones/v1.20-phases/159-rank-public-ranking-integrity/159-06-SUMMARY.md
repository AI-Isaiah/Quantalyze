---
phase: 159-rank-public-ranking-integrity
plan: 06
subsystem: api
tags: [postgrest, supabase-js, compare-and-set, toctou, csv-finalize, vitest]

requires:
  - phase: 146.2-02
    provides: "the BL-01 result union on applyCsvMetadataUpdate (`applied` / `noop` / `invalid` / `update_failed`) and the FILL arm's `!== \"applied\"` refusal — the `raced` kind extends the first and rides the second"
  - phase: 146.2-01
    provides: "the FILL discriminator (`category_id IS NULL`) and the already-classified refuse/echo arm that gives the raced-out loser its remedy"
provides:
  - "csv-finalize's FILL UPDATE is a compare-and-set on `category_id IS NULL` with the row count observed via `.select(\"id\")` — SQL, not route interleaving, picks the winner"
  - "a `raced` result kind on CsvMetadataUpdateResult, routed into the existing not-applied refusal so a raced-out writer never receives an applied receipt"
  - "a two-writer race test driving the REAL POST handler, plus a wiring pin on the CAS filter, both proven able to fail via neuter drills"
  - "the csv-finalize test surface (6 suites, 175 cases) agrees with one-winner semantics"
affects: [csv-finalize, wizard-resubmit, rank-integrity, phase-160]

actuals:
  tokens: 101000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "CAS-with-observed-row-count on a supabase-js update chain (`.eq().eq().is().select(\"id\")`), matching the deletion-request approve/reject precedent"
    - "a mocked PostgREST builder that answers BOTH the pre- and post-CAS chain shapes, so a neuter drill reds on the assertion instead of a TypeError"

key-files:
  created: []
  modified:
    - src/app/api/strategies/csv-finalize/route.ts
    - src/__tests__/csv-finalize-cross-submission-merge.test.ts
    - src/__tests__/csv-finalize-c14-regression.test.ts
    - src/__tests__/csv-validate-route.test.ts

key-decisions:
  - "`raced` rides the EXISTING CSV_PERSIST_FAIL 503 refusal rather than a new status or copy — the sentence 'that write did not land, so nothing was changed' is true of the raced request, and its 'submit the same file again' remedy is the real one: the resubmit reads a now-non-NULL category_id and lands on the already-classified arm (200 when the two agree, 409 naming both values when they diverge)"
  - "`raced` deliberately does NOT console.error or capture to Sentry — contention is the system working, and paging on it would erode NEW-C14-04's alertability for genuine RLS/SQL faults. The two causes stay distinguishable for operators via the kind interpolated into the FILL warn line; the user, who can act on neither distinction, gets one sentence and one working next step"
  - "the dual-chain-shape tolerance in the mocked update builder lives ONLY in the primary race suite, where the neuter drills need it; the two sibling scaffolds learned the new shape only (surgical)"

patterns-established:
  - "Compare-and-set on a PostgREST update: the predicate that a read established earlier is re-asserted IN the writing statement, and `.select()` is mandatory because PostgREST reports no error on a zero-row UPDATE"
  - "Race tests drive the real route handler twice through Promise.all against a mock that models the ROW as SQL holds it, so the mock arbitrates the way the database would"

requirements-completed: [RANK-07]

coverage:
  - id: D1
    description: "Two concurrent same-session resubmits cannot both take the FILL arm — the UPDATE is a CAS on `category_id IS NULL`, so exactly one reports the repair"
    requirement: "RANK-07"
    verification:
      - kind: unit
        ref: "src/__tests__/csv-finalize-cross-submission-merge.test.ts#🔴 THE RACE: two concurrent FILLs on one never-classified row — exactly ONE may report the repair"
        status: pass
      - kind: unit
        ref: "src/__tests__/csv-finalize-cross-submission-merge.test.ts#WIRING PIN: the FILL's UPDATE carries the CAS predicate the route — not the mock — decided"
        status: pass
    human_judgment: false
  - id: D2
    description: "A raced-out writer never receives an applied receipt — a 0-row CAS UPDATE maps to `raced` and is routed into the existing not-applied refusal"
    requirement: "RANK-07"
    verification:
      - kind: unit
        ref: "src/__tests__/csv-finalize-cross-submission-merge.test.ts#🔴 NO FALSE RECEIPT: the raced-out writer gets the refusal, never the FILL's success copy"
        status: pass
    human_judgment: false
  - id: D3
    description: "A genuine UPDATE error stays `update_failed` — logged, captured to Sentry, and diagnosed distinctly from a lost race, though both end at the same honest 503"
    requirement: "RANK-07"
    verification:
      - kind: unit
        ref: "src/__tests__/csv-finalize-cross-submission-merge.test.ts#CONTROL: a genuine UPDATE error is still update_failed — an error is not a race"
        status: pass
    human_judgment: false
  - id: D4
    description: "The CAS does not refuse a fresh create — a fresh row's category_id is NULL too, so the predicate matches by construction (T-159-20)"
    requirement: "RANK-07"
    verification:
      - kind: unit
        ref: "src/__tests__/csv-finalize-cross-submission-merge.test.ts#ANTI-REGRESSION: the CAS does not refuse a FRESH create — a fresh row's category_id is NULL too"
        status: pass
      - kind: unit
        ref: "src/__tests__/csv-finalize-cross-submission-merge.test.ts#ANTI-REGRESSION: a FAILED UPDATE on a FRESH CREATE is still non-fatal — the persisted row is not rolled back"
        status: pass
    human_judgment: false
  - id: D5
    description: "The whole csv-finalize test surface agrees with the new one-winner semantics — 6 suites, 175 cases, no assertion rewritten"
    verification:
      - kind: unit
        ref: "npx vitest run src/__tests__/csv-finalize-cross-submission-merge.test.ts src/__tests__/csv-finalize-rpc.test.ts src/__tests__/csv-finalize-c14-regression.test.ts src/__tests__/csv-finalize-after-failloud.test.ts src/__tests__/csv-validate-route.test.ts src/__tests__/no-store-coverage.test.ts --no-file-parallelism"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit && npx eslint <touched files> && npx tsx scripts/check-route-contract.ts && npx tsx scripts/check-admin-route-manifest.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "The CAS behaves against a REAL PostgREST/Postgres the way the mock models it: `.is(\"category_id\", null).select(\"id\")` returns an empty array (not an error) when the predicate no longer matches"
    requirement: "RANK-07"
    verification: []
    human_judgment: true
    rationale: "Every case here runs against a mocked builder. The mock's fidelity rests on the RESEARCH finding (VERIFIED against the deletion-request approve/reject routes, which use the identical construction in production) plus PostgREST's documented no-error-on-zero-rows behavior — but no test in this plan executes real SQL. The house rule against local workers touching prod (and the absence of a TEST-DB harness for this route) means the end-to-end confirmation belongs in phase UAT, not here."

duration: 18min
completed: 2026-08-21
status: complete
---

# Phase 159 Plan 06: FILL-arm compare-and-set Summary

**The csv-finalize FILL UPDATE is now a compare-and-set on `category_id IS NULL` with the row count observed via `.select("id")`, so two concurrent same-session resubmits resolve to exactly one winner — and the loser is refused honestly instead of handed a fabricated "applied" receipt.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-08-21T10:55:00Z (approx — first tool call; the plan carried no recorded start stamp)
- **Completed:** 2026-08-21T11:13:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- **The TOCTOU is closed in SQL.** The FILL discriminator read (`category_id IS NULL`) happens a whole request before the write — two more reads, the clock-safety guard and the metadata parse sit in between. `.is("category_id", null)` on the UPDATE chain makes the check and the set one statement, so the interleaving no longer decides who wins.
- **The false-receipt class is closed with it.** PostgREST returns no error on a zero-row UPDATE, so a raced-out writer was byte-identical to the winner. `.select("id")` + a zero-row mapping to a new `raced` kind is what makes them distinguishable; `raced` flows into the existing `!== "applied"` refusal, so the loser gets a non-2xx and a working remedy.
- **The loser's remedy is real, not copy.** Resubmitting after losing reads a now-non-NULL `category_id` and lands on the already-classified arm: 200 when the two submissions agree (the double-click case), 409 naming BOTH values when they diverge. Divergence is adjudicated out loud where last-writer-wins used to bury it.
- **Both pins were proven able to fail.** Removing `.is` from the chain reds 3 tests; removing the row-count mapping reds 2 — and the wiring pin correctly stays green under the second drill, because it pins a different fact.

## Task Commits

1. **Task 1 (RED): failing two-writer race test** — `537bd5bf` (test)
2. **Task 1 (GREEN): CAS + `raced` kind on the route** — `b9e1f333` (feat)
3. **Task 2: sibling scaffolds learn the CAS chain tail** — `e566aa18` (test)

_No REFACTOR commit: the GREEN implementation is five lines of chain plus one row-count branch — there was nothing to clean up without inventing abstraction._

## Files Created/Modified

- `src/app/api/strategies/csv-finalize/route.ts` — `applyCsvMetadataUpdate`'s UPDATE gains `.is("category_id", null).select("id")`; `CsvMetadataUpdateResult` gains `{ kind: "raced" }`; the call-site comment documents why `raced` rides the existing refusal and what the resubmit does differently.
- `src/__tests__/csv-finalize-cross-submission-merge.test.ts` — the mocked update builder now models the row as SQL holds it (honors the CAS filter, answers a loser with `data: []` and `error: null`) and records the filters the route built the chain with; new `[159-06 / RANK-07]` describe block with 5 cases.
- `src/__tests__/csv-finalize-c14-regression.test.ts` — scaffold only: the update mock learned the CAS tail.
- `src/__tests__/csv-validate-route.test.ts` — scaffold only: same.

## Decisions Made

**1. `raced` reuses the CSV_PERSIST_FAIL 503 refusal instead of getting its own status and copy.**
The plan left this to discretion ("the existing refusal envelope or the distinct raced copy chosen"). The existing sentence — "that write did not land, so nothing was changed. Submit the same file again shortly" — is true *of the raced request*, and its remedy is the genuinely correct one. Adding a second envelope would have meant a new branch at the call site and a second copy to keep honest, for a distinction the user cannot act on differently. The distinction that *does* matter (contention vs. infrastructure fault) is preserved where it is actionable: the operator-facing warn line and the Sentry decision.

**2. `raced` does not log-and-page.** `update_failed` keeps its `console.error` + `captureToSentry` (NEW-C14-04's alertability). A lost race is the system working as designed; capturing it would train the alert away. This is pinned in both directions — the raced test asserts *no* metadata-update capture, the control test asserts exactly one.

**3. Dual chain-shape tolerance is confined to the race suite.** The mocked builder there answers `.eq().eq()` (awaited directly) *and* the full CAS tail, because otherwise the neuter drill dies with "is is not a function" — a RED for the wrong reason, which proves nothing. The two sibling scaffolds got the new shape only, per house Rule 3.

**4. Two anchor comments were narrowed, one extended — only where this change made a sentence false.**
The BL-01 rationale claimed "the resubmit is idempotent — the fill discriminator still reads NULL, so the next attempt takes the same arm", which is now false for `raced`; it is scoped to `update_failed` with a pointer to the RANK-07 note. The ⭐ discriminator anchor gained the fact that its read no longer decides the fill alone. The `:423` anchor was checked and left byte-unchanged — nothing there became false.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The worktree ships no `node_modules`, so the task's precondition was unmet**
- **Found during:** Task 1 (precondition check)
- **Issue:** `npx vitest` / `npx tsc` cannot resolve in a GSD worktree; `npx tsc` in particular resolves an unrelated package from the registry.
- **Fix:** Symlinked the main checkout's `node_modules` (read-only reuse, per the orchestrator's own instruction). No `npm install` / `npm ci` was run. `npx tsc --version` → 6.0.3 confirms the local toolchain resolved, not a registry download.
- **Verification:** Baseline suite run green (51 tests) before any edit.
- **Committed in:** n/a (the symlink is gitignored and never staged)

**2. [Rule 3 - Blocking] Two test scaffolds outside the plan's `files_modified` broke on the new chain shape**
- **Found during:** Task 2 (sibling sweep)
- **Issue:** `csv-finalize-c14-regression.test.ts` and `csv-validate-route.test.ts` mocked the update chain only as far as `.eq().eq()`. Five cases died with `TypeError: ....is is not a function`. The plan anticipated sibling adjudication but listed only the primary test file as modifiable.
- **Adjudication:** Scaffold gaps, **not** pinned behavior. Neither suite asserted anything about a second writer, so neither was pinning the defect. Every assertion is byte-unchanged — `updateMock` is still invoked exactly once per UPDATE with the same table/payload/eq-filters. **No sibling assertion was rewritten**, so the plan's "a sibling that pinned 'second writer also applies'" case did not arise.
- **Fix:** Both mocks learned `.is()` → self and `.select()` → `{ data: [{ id }], error }`, with a comment at each site naming 159-06 and stating that the race semantics are pinned elsewhere.
- **Verification:** 6 suites / 175 cases green; `tsc --noEmit` clean; eslint clean on all four touched files.
- **Committed in:** `e566aa18`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking).
**Impact on plan:** Neither changed the plan's shape. The second widened `files_modified` by two test files, all four of which are scaffold-only edits. No scope creep — no production file outside the plan was touched.

## Neuter Drills (anti-vacuity)

House law: a test that cannot fail is worse than none. Both pins were neutered against the committed implementation, the RED observed first-hand, and the tree restored with `git checkout --` from the committed state (never from memory), then re-confirmed green.

| Drill | What was removed | Observed RED | Failing tests |
|---|---|---|---|
| Pre-fix baseline (RED-first) | the entire fix (test written before implementation) | 3 failed / 53 passed | THE RACE (`expected 2 to be 1` — both writers reported success), NO FALSE RECEIPT (`expected undefined to be defined` — no loser existed), WIRING PIN (`expected {} to deeply equal { category_id: null }`) |
| Drill 1 | `.is("category_id", null)` from the route's chain | 3 failed / 53 passed | THE RACE, NO FALSE RECEIPT, WIRING PIN |
| Drill 2 | the `data.length === 0` → `raced` mapping (always return `applied`) | 2 failed / 54 passed | THE RACE, NO FALSE RECEIPT — **WIRING PIN correctly stayed green**, since the `.is` filter was still on the chain. The two pins fail for different reasons, which is what makes them two pins rather than one restated twice. |

Restored tree verified clean (`git status --short` empty) after each drill.

## Verification Results

| Gate | Command | Result |
|---|---|---|
| Task 1 — race suite | `npx vitest run src/__tests__/csv-finalize-cross-submission-merge.test.ts --no-file-parallelism` | PASS (56/56) |
| Task 1 — region grep (CAS) | `awk '/^async function applyCsvMetadataUpdate/…' route.ts \| grep 'category_id.*null'` | PASS (`.is("category_id", null)`) |
| Task 1 — region grep (row count) | same region, `grep 'select("id")'` | PASS (`.select("id")`) |
| Task 2 — three-suite sweep | `npx vitest run …cross-submission-merge …rpc …c14-regression --no-file-parallelism` | PASS (113/113) |
| Task 2 — extended sweep | + `…after-failloud …csv-validate-route …no-store-coverage` | PASS (175/175 across 6 files) |
| Task 2 — typecheck | `npx tsc --noEmit` | PASS (exit 0) |
| Phase — lint | `npx eslint` on all 4 touched files | PASS (no output) |
| Phase — lint (remaining arms) | `npx tsx scripts/check-route-contract.ts`, `check-admin-route-manifest.ts` | PASS (57 page routes, 20 admin routes) |

**Prohibitions (from the plan's `must_haves`), both now verified rather than `unverified`:**

- *No advisory lock, SELECT-FOR-UPDATE RPC, or new migration.* `git diff <base>..HEAD --name-only` returns exactly two production-relevant paths (the route and the primary test); zero paths under `supabase/migrations/`. `git diff -G'pg_advisory|FOR UPDATE' --name-only` returns nothing.
- *An applied receipt is never returned when the UPDATE matched zero rows.* The race test asserts exactly one of the two interleaved POSTs reports the applied outcome, and Drill 2 (dropping the row-count mapping) was observed RED.

## Issues Encountered

- **`159-PATTERNS.md` does not exist.** Both the plan's `<context>` block and the dispatch prompt's required reading name `.planning/phases/159-rank-public-ranking-integrity/159-PATTERNS.md`; the phase directory contains no such file. Nothing was lost — `159-RESEARCH.md` carries the deletion-requests CAS excerpt (§RANK-07 and the "CAS with observed row count" sketch), and the actual precedent source (`src/app/api/admin/deletion-requests/[id]/approve/route.ts:341-358`) was read directly. Flagging it because a missing required-reading artifact is exactly the kind of thing that gets silently skipped.

## Known Stubs

None. No placeholder values, no skipped tests, no unrun `<verify>` commands.

## Threat Flags

None — no new network endpoint, auth path, file access pattern, or schema change. The three threats the plan registered (T-159-18 TOCTOU, T-159-19 false receipt, T-159-20 fresh-arm DoS) are each mitigated and pinned by a named test above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- RANK-07 is closed; ROADMAP 159 SC-5's first arm holds under test.
- **One item for phase UAT (D6):** the CAS is proven against a mocked PostgREST builder, not real SQL. The mock's fidelity rests on a VERIFIED in-repo precedent using the identical construction in production, but an end-to-end confirmation against a real database belongs in the phase's UAT pass.
- No blockers for sibling plans in wave 1 — this plan touched one production file (`csv-finalize/route.ts`) and three test files, none of which are listed in another 159 plan's `files_modified`.

## Self-Check: PASSED

- `159-06-SUMMARY.md` present on disk (19,057 bytes, 234 lines, closing footer intact — no truncation).
- All 4 commits present in `git log`: `537bd5bf` (test/RED), `b9e1f333` (feat/GREEN), `e566aa18` (test/scaffolds), `02d356e1` (docs).
- Every file named in `key-files.modified` exists and is committed; `git status --short` is empty (nothing left uncommitted in the worktree).
- No modifications to STATE.md or ROADMAP.md — the orchestrator owns those writes.

---
*Phase: 159-rank-public-ranking-integrity*
*Completed: 2026-08-21*
