---
phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit
plan: 03
subsystem: seam
tags: [seam-retry, idempotency-audit, allowlist, leaf-purity, mutation-testing, SEAM-05]

# Dependency graph
requires:
  - phase: 141-01
    provides: "resync draft-SV dedup (sequential-retry class closed) — the precondition for resync's YES allowlist entry"
  - phase: 140.1
    provides: "onboard WIZARD_DUPLICATE dedup (SV + compute_jobs unique indexes) cited as onboard's YES evidence"
provides:
  - "src/lib/seam-retry-registry.ts — the SC1 committed audit artifact AND the runtime retry allowlist in ONE dependency-free leaf (13 evidenced verdicts, absence ⇒ no-retry)"
  - "RETRY_SAFE_FLOW_TYPES / RETRY_SAFE_ANALYTICS (YES maps) + RETRY_AUDIT_NO_FLOW_TYPES / RETRY_AUDIT_NO_ANALYTICS (NO maps) + RetrySafeEntry"
  - "_get_recompute_lock PROCESS-LOCAL resolution recorded in-artifact (SEAM-05 explicit ask)"
affects: [141-04, seam-retry-registry, retriesOverride-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Audit-and-allowlist-are-one-artifact: the traced retry-safety evidence IS the runtime gate entry, so the documented audit and enforcement cannot drift (SC1 anti-drift)"
    - "Absence-semantics allowlist (Partial<Record>): unproven ⇒ no-retry by construction, no separate default rule; exhaustiveness pin forces a verdict before a new flow/wrapper can ship"
    - "Two-grain keying: process-key seam by flow_type (budgetKeyFor is many-to-one — keying on budgetKey would retry teaser), analytics seam by 1:1 budgetKey"

key-files:
  created:
    - "src/lib/seam-retry-registry.ts"
    - "src/lib/seam-retry-registry.test.ts"
  modified:
    - ".planning/phases/141-seam-retry-with-backoff-gated-on-the-idempotency-audit/141-VALIDATION.md"

key-decisions:
  - "13 verdicts across two grains: 2 YES + 2 NO flow_types, 4 YES + 5 NO analytics — every flow_type and every one of the nine analytics wrappers carries a verdict (exhaustiveness pin)"
  - "resync allowlisted YES only because plan-01's draft-SV dedup landed in wave 1; its evidence says so and names the residual concurrent-tab race"
  - "teaser + csv proven NO with evidence (teaser cites process_key.py:936-938 fresh-uuid4 mint; csv cites the teaser-shared process-key-sync budget row)"
  - "match-recompute NO evidence records _get_recompute_lock PROCESS-LOCAL + no match_batches unique constraint + H-0562 open ⇒ unproven ⇒ no-retry"
  - "leaf purity: 2 import-type-only lines, browser-bundle-safe + survives wholesale seam mocks; guarded by a source-read purity test"

requirements-completed: [SEAM-05]

# Metrics
duration: ~30min
completed: 2026-07-31
---

# Phase 141 Plan 03: SC1 seam retry-safety registry Summary

**Created `src/lib/seam-retry-registry.ts` — the single artifact that is simultaneously the committed SEAM-05 idempotency audit AND the runtime retry allowlist: 13 evidenced yes/no verdicts across both seam grains, where absence means no-retry by construction, and where the `_get_recompute_lock` PROCESS-LOCAL resolution lives inline so the documented audit and the enforcement cannot drift.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-31
- **Tasks:** 2 (both `type=auto`)
- **Files created:** 2 · **Files modified:** 1 (planning ledger)

## Accomplishments

- The SC1 deliverable exists: `seam-retry-registry.ts`, a dependency-free leaf (2 `import type` lines only) carrying 13 verdicts — `RETRY_SAFE_FLOW_TYPES` (onboard, resync), `RETRY_AUDIT_NO_FLOW_TYPES` (teaser, csv), `RETRY_SAFE_ANALYTICS` (bridge, simulator, portfolio-optimizer, optimize-weights), `RETRY_AUDIT_NO_ANALYTICS` (validate-key, encrypt-key, match-recompute, portfolio-analytics, match-eval).
- Every YES verdict carries traced server-side evidence inline (migrations, `process_key.py` line refs); every NO verdict is itself an evidence string. Audit and allowlist are one artifact → cannot drift.
- Absence ⇒ no-retry falls out of `Partial<Record>`; the exhaustiveness pin reddens if a future flow_type or wrapper is added without a verdict.
- SC-1 falsifiability ledger row flipped to Observed with first-hand RED evidence.

## Task Commits

1. **Task 1: the registry leaf** — `879c5c9a` (feat)
2. **Task 2: registry test + SC-1 ledger Observed** — `18f9268a` (test)

## Files Created/Modified

- `src/lib/seam-retry-registry.ts` (created, 193 lines) — the audit+allowlist leaf. Header docblock copies the `process-key-onboard-contract.ts` leaf-purity rationale and adds: (a) audit-and-allowlist-are-one rationale, (b) the two-grain note (process-key by flow_type because `budgetKeyFor` is many-to-one; analytics by 1:1 budgetKey), (c) the `keys-permissions` / `process-key-*` exclusion-by-grain note.
- `src/lib/seam-retry-registry.test.ts` (created, ~210 lines) — 14 tests, hand-typed literal oracles. SC3 absence belt, YES-map contents (`retries===1` + non-empty evidence), exhaustiveness at both grains, disjointness, PROCESS-LOCAL lock-resolution pin, and a source-read VALUE-import purity guard (mirrors `seam-discriminator.purity.test.ts`).
- `.planning/.../141-VALIDATION.md` — SC-1 ledger row → Observed ✅ (141-03).

## Observed RED output (verbatim, SC-1 ledger)

Mutation: added `teaser: { retries: 1, evidence: "MUTANT" }` to `RETRY_SAFE_FLOW_TYPES` in production source. **4 assertions reddened:**

```
FAIL … SC3 belt … RETRY_SAFE_FLOW_TYPES.teaser is strictly undefined
  AssertionError: expected { retries: 1, evidence: 'MUTANT' } to be undefined   (:65)
FAIL … YES maps … RETRY_SAFE_FLOW_TYPES keys equal the hand-typed safe set
  AssertionError: expected [ 'onboard', 'resync', 'teaser' ] to deeply equal [ 'onboard', 'resync' ]
FAIL … exhaustiveness … YES∪NO flow keys cover ALL four flow_types
  AssertionError: expected [ 'csv', 'onboard', 'resync', …(2) ] to deeply equal [ Array(4) ]   (duplicate 'teaser')
FAIL … disjointness … YES ∩ NO = ∅ at flow grain
  AssertionError: expected [ 'teaser' ] to deeply equal []   (:124)
```

Reverted from an in-context edit; `grep -rn MUTANT src/` → **0**; re-run **14/14 green**. Registry source `git diff` after revert = empty (byte-identical to the committed leaf).

## Decisions Made

- **13 verdicts, both grains, exhaustive.** All four flow_types and all nine analytics wrappers carry a verdict (YES with evidence, or NO as an evidence string). The plan's "maps EVERY" clause is made red-able by the exhaustiveness union pins.
- **resync is YES only because wave-1 landed first.** Its evidence names the phase-141 plan-01 draft-SV pre-check `(strategy_id, flow_type='resync', status='draft')`, states the sequential-retry class is closed, and records the concurrent-tab race as a documented residual.
- **teaser/csv NO with cited evidence, not mere absence.** teaser cites `process_key.py:936-938` (fresh uuid4 mint) + `:1033`; csv cites the teaser-shared `process-key-sync` budget row (SC3 blast-radius reasoning, RESEARCH A5). Their presence in the NO map (not just absence from YES) is what the exhaustiveness pin checks.
- **match-recompute records the SEAM-05 lock resolution in-artifact.** `_get_recompute_lock` is PROCESS-LOCAL (`dict[str, asyncio.Lock]`), no `match_batches` unique constraint, H-0562 open ⇒ unproven ⇒ no-retry. Pinned by `/process-local/i`.
- **portfolio-analytics is a recorded dead path** (zero callers, `resilient-fetch.ts:502`) — recorded per SC1, never allowlisted.

## Deviations from Plan

None — plan executed exactly as written. (Both auto tasks completed with the specified exports, evidence, pins, and the SC-1 mutation observed as directed.)

## Issues Encountered

- The worktree was based at `43d119bf` (pre-plan-creation) and the initial compound safety-check command was refused by the sandbox; re-run as plain separate commands. HEAD was on the `worktree-agent-*` allow-list, so `git reset --hard c1166efd` (the plan base) was the sanctioned correction — it brought in the plan file and the wave-1 `141-01-SUMMARY.md` dependency.

## User Setup Required

None — no external service configuration; the leaf is inert (unwired until plan 04) and cannot change production behavior.

## Next Phase Readiness

- Plan 04 wires the registry: `postProcessKey` reads `RETRY_SAFE_FLOW_TYPES[flow_type]` and threads a `retriesOverride` into `resilientFetch`; `analyticsRequest` reads `RETRY_SAFE_ANALYTICS[budgetKey]`. `resilientFetch` must NOT read the registry directly (it only has `budgetKey`, which cannot distinguish teaser from csv — the SC3 landmine).
- `keys-permissions` stays `retries: 0` in `SEAM_BUDGETS` (plan 04 pins it); the registry deliberately does not list the route-budget keys.
- Verification: `grep -rn "seam-retry-registry" src/lib/analytics-client.ts src/lib/process-key-client.ts` → 0 (unwired, confirmed).

## Self-Check: PASSED

- Files: `src/lib/seam-retry-registry.ts`, `src/lib/seam-retry-registry.test.ts`, and this SUMMARY all present.
- Commits: `879c5c9a` (feat) and `18f9268a` (test) both in git log.
- Gates: `npx tsc --noEmit` 0 errors · `npx eslint` on both files 0 · `vitest run seam-retry-registry.test.ts` 14/14 green · import-line grep pair `^import type`=2 / `^import `=2 · `grep -rn MUTANT src/` = 0 · registry unwired (0 references in the two clients).

---
*Phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit*
*Completed: 2026-07-31*
