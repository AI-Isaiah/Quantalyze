---
phase: 94-wizard-resumability
plan: 05
subsystem: testing
tags: [e2e, playwright, wizard, composite, rls, seed, WIZ-03, WIZ-05]

# Dependency graph
requires:
  - phase: 94-01
    provides: WIZ-01 composite members GET (browser-RLS read the resume walk rehydrates from)
  - phase: 94-02
    provides: WIZ-02 MultiKeyConnectStep rehydration + WIZ-03 non-destructive "Review your keys" (component-covered)
  - phase: 94-03
    provides: WIZ-05 SyncPreviewStep durability skip (COMPLETE composite short-circuits /api/keys/sync regardless of freshness) + cachedSnapshot
provides:
  - Owner-seeded TRUE-e2e corroboration of WIZ-03 (non-destructive review round-trip, keys intact) + WIZ-05 (a completed crawl never re-kicks) against REAL routes + REAL browser RLS
  - seedCompositeStrategy "resumable" variant (draft + wizard, COMPLETE analytics, owner-matchable) — the fixture the resume walk consumes
  - countStrategyKeys(strategyId) admin-read helper (direct member-survival assertion, GUI-independent)
affects: [wizard-resumability, composite-onboarding, e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-matched seed (ownerUserId = the logged-in allocator) upgrades a stubbed e2e to real proof: the WIZ-01 GET, set-members POST, and RLS-bound browser reads all resolve unstubbed — a non-owner seed false-REDs (Ph91 lesson)"
    - "Route SPIES (passthrough counters via route.continue()) instead of stubs — a call COUNT of 0 is the behavioral proof (WIZ-05 no re-kick / WIZ-03 no DELETE), not a mocked response"

key-files:
  created: []
  modified:
    - e2e/helpers/seed-test-project.ts
    - e2e/composite-onboarding.spec.ts

key-decisions:
  - "resumable variant = status 'draft' + source 'wizard' — the EXACT OPPOSITE of the failed variant's source='legacy' escape hatch; restructured the status ternary from (failed?draft:published) to (published?published:draft) so a non-failed variant no longer wrongly yields 'published' (plan-checker Note 4)"
  - "Extended the EXISTING composite-onboarding.spec.ts rather than a new file, so ci.yml place-2 gate (ci.yml:1452) is inherited with zero ci.yml edit; the spec's HAS_SEED_ENV self-skip is place 1"
  - "WIZ-05 durability is proved by a STALE seeded computed_at (2026-07-01) + a keys/sync spy count of 0 — only the COMPLETE-composite skip (not the 5-minute freshness skip) can explain zero on a stale row"
  - "Member survival asserted BOTH in-band (3 rehydrated panels via the real GET) AND out-of-band (countStrategyKeys admin read === 3) so WIZ-03 non-destructivity does not rely on the GUI alone"

patterns-established:
  - "For a resume-eligibility fixture, the (status, source) pair is the whole contract — encode the full matrix in a comment because either column alone is ambiguous"

requirements-completed: [WIZ-03, WIZ-05]

# Metrics
duration: 18min
completed: 2026-07-11
---

# Phase 94 Plan 05: Owner-Seeded Playwright e2e (WIZ-03 / WIZ-05) Summary

**An owner-seeded resumable composite draft now round-trips through the REAL app — resume at sync_preview, "Review your keys", rehydrated panels via the real WIZ-01 GET, secretless Continue via the real set-members — proving WIZ-03 (review leaves the draft + 3 members intact, zero DELETEs) and WIZ-05 (a completed crawl never re-kicks /api/keys/sync, zero calls across the whole walk) against real routes and real browser RLS, not stubs.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-07-11
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- Added a `"resumable"` variant to `seedCompositeStrategy` — `status "draft"` + `source "wizard"` (so the wizard's `.eq("source","wizard").eq("status","draft")` resume query hydrates `initialDraft`), a COMPLETE `strategy_analytics` row with `data_quality_flags.composite:true` and a deliberately STALE `computed_at`, owner-matchable via `ownerUserId`. Restructured the status ternary so no non-`failed` variant silently lands on `"published"` (plan-checker Note 4).
- Added a seed-gated `Phase 94 — wizard resumability (WIZ-03 / WIZ-05)` describe to the existing `composite-onboarding.spec.ts` (inherits ci.yml:1452 with no ci.yml edit), owner-matched so the WIZ-01 members GET, the set-members POST, and the RLS-bound wizard reads all run **unstubbed** — the Ph91 owner-match lesson that separates real proof from stub-theater.
- Used route **spies** (passthrough counters) not stubs: `/api/keys/sync` call count === 0 across resume + review + resubmit (WIZ-05 durability), and DELETE `/api/strategies/draft/*` count === 0 (WIZ-03 non-destructive), plus a `countStrategyKeys()` admin read proving the 3 members survive.

## Task Commits

Each task was committed atomically:

1. **Task 1: seedCompositeStrategy "resumable" variant** - `853439d8` (feat)
2. **Task 2: WIZ-03 round-trip + WIZ-05 no-re-kick e2e block (+ countStrategyKeys helper)** - `a4a9feba` (feat)

## Files Created/Modified
- `e2e/helpers/seed-test-project.ts` - Extended `variant` union to `"published" | "failed" | "resumable"`; restructured the strategies-insert status ternary to `variant === "published" ? "published" : "draft"` (was `variant === "failed" ? "draft" : "published"`, which mis-assigned `resumable`); documented the full `(status, source)` resume-eligibility matrix; extended the JSDoc `@param variant`. Added the `countStrategyKeys(strategyId)` service-role admin-read helper (member-survival assertion for the WIZ-03 spec).
- `e2e/composite-onboarding.spec.ts` - Imported `countStrategyKeys`; added a seed-gated `Phase 94` describe with a single owner-seeded resume walk: seed resumable+owner-matched → route spies → login → resume lands on sync_preview showing "Use this composite and continue" with 0 keys/sync calls (WIZ-05) → "Review your keys" → 3 rehydrated validated panels bearing the seeded member labels (real WIZ-01 GET through RLS) → 0 DELETEs + `countStrategyKeys === 3` (WIZ-03) → Continue → real set-members → back at sync_preview, keys/sync STILL 0.

## Deviations from Plan

None — plan executed as written. Minor scope note (not a deviation): `countStrategyKeys` lives in the helper file, which the plan's top-level `files_modified` already lists; it was added under Task 2 because it exists solely to serve Task 2's member-survival assertion.

## Environment / Execution Note (fail-loud, NOT a silent skip)

Per the plan's resolved decision 2 and this executor's `<critical_constraints>`: the seeded **live** walk was **NOT executed in this executor's environment** — there is no `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` here and no live Next server + test DB + browser. The automated verification performed was therefore the **compile/load check** (`npx playwright test … --list` lists the new Phase 94 test) plus `npx tsc --noEmit` and `npm run lint`, which is the acceptable-and-explicit fallback named in the plan.

The block is NOT `test.fixme` — the walk is deterministic (a completed, owner-matched fixture with stale `computed_at`; no timing race), so it runs live in CI's `e2e-seeded` batch (ci.yml:1452) where the seed env vars ARE wired, under the standard `HAS_SEED_ENV` gate. The two behaviors are ALSO component-covered in plans 94-02 (WIZ-02/03 rehydration + non-destructive review) and 94-03 (WIZ-05 durability skip); this e2e is corroboration of the real unmount/remount + RLS resolution those component tests cannot exercise. **The live green is attributable to CI, not to this executor run.**

## Threat Model Coverage
- **T-94-19 (Information Disclosure / seeded api_keys):** mitigated — the resumable variant reuses the existing `"e2e-placeholder-ciphertext"` idiom (no real credential seeded; gitleaks-safe by precedent).
- **T-94-20 (Spoofing / test-validity via owner mismatch):** mitigated — `ownerUserId = allocator.userId`, so the RLS reads under test are the REAL tenant gate (not stubs); the spec header documents the false-RED failure mode a non-owner seed would produce.
- **T-94-21 (Tampering / supply chain):** accepted per plan — zero new packages.

## Verification
- `npx tsc --noEmit` → clean.
- `npx playwright test e2e/composite-onboarding.spec.ts --list` → 3 tests listed (the new `Phase 94 — wizard resumability (WIZ-03 / WIZ-05)` block compiles + loads).
- `npm run lint -- e2e` → 0 errors (1 pre-existing, unrelated warning in `EquityChart.tsx`, out of scope).
- `git diff --quiet .github/workflows/ci.yml` → unchanged; `composite-onboarding.spec.ts` present at ci.yml:1452 (place-2 gate inherited by extension).
- No migration.

## Known Stubs
None. The new block deliberately uses NO route stubs (real routes, owner-matched) — that is the point of the plan. The pre-existing Phase 91 blocks in the same file still stub add-key/set-members/keys-sync because their seeds are non-owner; those are unchanged.

## Self-Check: PASSED
- Both modified files present (`e2e/helpers/seed-test-project.ts`, `e2e/composite-onboarding.spec.ts`).
- Both task commits present (853439d8, a4a9feba).
- New Phase 94 test lists via `playwright --list`; `resumable` variant + `countStrategyKeys` + `ownerUserId` present in the diff.
- SUMMARY.md present.
