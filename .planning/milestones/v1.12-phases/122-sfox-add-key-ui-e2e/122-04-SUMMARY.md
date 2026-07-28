---
phase: 122-sfox-add-key-ui-e2e
plan: 04
subsystem: e2e
tags: [sfox, e2e, playwright, provenance, seed, axe]

# Dependency graph
requires:
  - phase: 122-sfox-add-key-ui-e2e
    provides: "plan 122-01 SFOX mono tag (ApiKeyManager) + VerifiedBadge/TrustTierLabel api_verified dispatch — the surfaces this e2e asserts"
  - phase: 119-sfox-read-adapter-key-validation
    provides: "SFOX-04 constraint-widening migration (20260718182056) admitting 'sfox' at api_keys.exchange / strategies.source / strategy_verifications.source — the seed precondition"
provides:
  - "SFOX-09 e2e leg: a seed-gated Playwright spec asserting the SFOX tag + api_verified badge render on a connected sfox strategy across owner/allocator/admin surfaces"
  - "seedSfoxVerifiedStrategy helper — owner-owned sfox fixtures (strategy + strategy_verifications api_verified + sfox api_key), fail-loud on the missing SFOX-04 precondition"
  - "seedTestAllocator isAdmin opt (opt-in profiles.is_admin) for the admin leg"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seed-gated e2e (HAS_SEED_ENV test.skip) authored-not-blocking until the GH secrets are wired — wizard-axe precedent"
    - "Fail-loud DB-precondition translation: a 23514 boundary CHECK violation on 'sfox' throws naming the phase-119 SFOX-04 migration instead of a bare postgres error"
    - "Badge assertion OR-s the VerifiedBadge chip and the data-trust-tier pill (surface-discovered, not assumed)"

key-files:
  created:
    - "e2e/sfox-badge.spec.ts — role-sweep badge/tag assertions + axe pass, seed-env skip gate"
  modified:
    - "e2e/helpers/seed-test-project.ts — seedSfoxVerifiedStrategy + cleanupSfoxVerifiedStrategy + seedTestAllocator isAdmin opt"
    - ".github/workflows/ci.yml — register e2e/sfox-badge.spec.ts in the seeded playwright spec list (explicit list, not a glob)"

key-decisions:
  - "Owner+allocator are the SAME 'both' user (owns manager edit AND allocator/browse surfaces, no requireRolePage redirect); admin is a separate is_admin-elevated session — two sessions total"
  - "Badge-bearing 'strategy detail surface' = the public factsheet /strategy/[id] (VerifiedBadge unconditional at line 129) + the browse detail /browse/crypto-sma/[id] (VerifiedBadge gated on api_key_id, which the seed links)"
  - "Public-demo documented N/A — sentinel fixtures carry no sfox strategy (no-invented-data rule), not fabricated"
  - "seedSfoxVerifiedStrategy is self-contained (follows the seedCompositeStrategy precedent) rather than calling seedStrategyWithHistory — that helper takes no ownerUserId/source/api_key_id, which a connected-sfox fixture requires"

patterns-established:
  - "seed helpers that write a sfox-boundary column wrap the insert in isSfoxBoundaryViolation() → throwSfoxPreconditionError() naming the SFOX-04 migration"

requirements-completed: [SFOX-09]

# Metrics
duration: 5min
completed: 2026-07-19
---

# Phase 122 Plan 04: SFOX badge + tag e2e (SFOX-09) Summary

**A seed-gated Playwright spec proves a connected sFOX strategy renders the SFOX exchange tag and the api_verified provenance badge across owner/allocator/admin surfaces, on a new owner-owned seedSfoxVerifiedStrategy fixture that fails loud (naming the phase-119 SFOX-04 migration) if the constraint-widen is absent.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-19T06:00Z
- **Completed:** 2026-07-19T06:05Z
- **Tasks:** 2
- **Files:** 1 created, 2 modified

## Accomplishments
- `seedSfoxVerifiedStrategy` seeds an owner ("both") + a separate admin (is_admin) user, a `sfox` `api_keys` row, a `published` `source='sfox'` strategy linked to that key with complete analytics, and a `strategy_verifications` row `{ source:'sfox', trust_tier:'api_verified' }` — every fixture OWNED BY the seeded owner (project e2e RLS rule).
- The three sfox-bearing inserts (`api_keys.exchange`, `strategies.source`, `strategy_verifications.source`) are wrapped in a 23514-CHECK fail-loud translation that names `supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql` (SFOX-04) as the missing precondition — never a bare/confusing postgres error.
- `e2e/sfox-badge.spec.ts` sweeps: owner → SFOX tag on `/strategies/[id]/edit` (and asserts no `?` fallback); owner → api_verified badge on the `/strategy/[id]` factsheet + one `buildAxe()` zero-violations pass; allocator (same user) → badge on `/browse/crypto-sma/[id]`; admin → badge via the factsheet. Public-demo documented N/A.
- The spec is seed-env-gated (`HAS_SEED_ENV` `test.skip`): it skips cleanly with no secrets (CI green pre-secrets) and RUNS once the wired GH secrets are present. Registered in the seeded playwright spec list in `ci.yml` (which uses an explicit list, not a glob).

## Task Commits

1. **Task 1: seedSfoxVerifiedStrategy helper + isAdmin opt** — `5be11e52` (test)
2. **Task 2: sfox-badge e2e role sweep + axe + CI wiring** — `d04c852e` (test)

_Note: `.planning/**` is gitignored/local — no plan-metadata git commit; SUMMARY/STATE/ROADMAP updated on disk only._

## Files Created/Modified
- `e2e/sfox-badge.spec.ts` (created) — seed-gated role sweep + axe pass; badge locator OR-s the "Verified" chip and the `data-trust-tier="api_verified"` pill.
- `e2e/helpers/seed-test-project.ts` — `seedSfoxVerifiedStrategy` + `cleanupSfoxVerifiedStrategy` + `SeededSfoxVerifiedStrategy` type + `SFOX_BOUNDARY_MIGRATION` / `isSfoxBoundaryViolation` / `throwSfoxPreconditionError`; `seedTestAllocator` gains opt-in `isAdmin` (stamps `profiles.is_admin` only when true — every existing caller's upsert stays byte-identical).
- `.github/workflows/ci.yml` — `e2e/sfox-badge.spec.ts` added to the seeded playwright spec list.

## Decisions Made
- **Two sessions, not three.** The "both"-role owner owns BOTH the manager edit surface AND the allocator/browse surfaces (no requireRolePage redirect), so owner+allocator legs share one user; admin is a separate `is_admin` session. This matches the plan's role mapping.
- **Badge surface = public factsheet + browse detail.** `/strategy/[id]` renders `VerifiedBadge` unconditionally (queries.ts projects `trust_tier` from `strategy_verifications`); `/browse/crypto-sma/[id]` gates its badge on `strategy.api_key_id`, so the seed LINKS the sfox key (`strategies.api_key_id`). The browse direct-id route needs no category membership.
- **Self-contained seed** (seedCompositeStrategy precedent) — `seedStrategyWithHistory` takes no `ownerUserId`/`source`/`api_key_id`, all of which a connected-sfox fixture requires; composing its internals would mean forking it, so the helper inlines a compact analytics row instead.
- **Admin leg reads the factsheet.** No dedicated admin per-strategy trust-tier review page lists arbitrary strategies; the admin-elevated session reading the same api_verified tier on the factsheet (admin SELECT RLS, migration 093) is the honest proof that an admin sees the strategy with its tier.

## Deviations from Plan

**[Rule 3 — Blocking] CI seeded spec list is explicit, not a glob.** The plan's Task 2 action said to grep `.github/workflows` and, "if it uses an explicit list, add the spec there." The seeded playwright job (`ci.yml` ~line 1456) uses an explicit spec list, so `e2e/sfox-badge.spec.ts` was added to it — required for the spec to run in CI once secrets are wired. This is the plan's own directed contingency, not an unplanned change.

No other deviations.

## Selectors authored-not-yet-run (first live seeded run confirms)
Like the wizard-axe precedent, this seed-gated spec is authored against the documented DOM (VerifiedBadge "Verified" text, `data-trust-tier="api_verified"`, the "SFOX" tag text) and has not executed against a live seeded DB in this environment (no `TEST_SUPABASE_*` present). Verification here was `--list` (registers, 4 tests) + `tsc` + `lint` — all clean. The first seeded CI run (or a local run with `TEST_SUPABASE_*`) is where the badge/tag selectors are empirically confirmed; the OR-ed badge locator is deliberately surface-tolerant to absorb which of the two badge components a given surface renders.

## Issues Encountered
- None blocking. The badge assertion is intentionally an OR of the two badge components because the plan defers exact per-surface DOM to live discovery.

## User Setup Required
None for authoring. The spec RUNS in CI only once `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` (GH secrets, gated by `vars.E2E_TEST_DB_CONFIGURED`) are present, AND the phase-119 SFOX-04 migration is applied on the test project (qmnijlgmdhviwzwfyzlc — already MCP-applied per STATE; the helper fails loud if not).

## Next Phase Readiness
- SFOX-09 now has BOTH legs: the component-level api_verified/tag coverage (122-01) and this cross-role e2e proof. Phase 122 (SFOX Add-key UI + e2e) plan set is complete (122-01..04).
- No dependency introduced on the SFOX-08 offer flag — the asserted surfaces are unconditional, so the spec is valid against a default flag-OFF build.

## Self-Check: PASSED

- Files verified on disk: `e2e/sfox-badge.spec.ts` FOUND; `seedSfoxVerifiedStrategy` present in `e2e/helpers/seed-test-project.ts` FOUND.
- Task commits verified in git log: `5be11e52`, `d04c852e` — both FOUND.
- `npx playwright test e2e/sfox-badge.spec.ts --list` → 4 tests register; `tsc --noEmit` clean; `npm run lint` 0 errors (1 pre-existing EquityChart warning, out of scope).

---
*Phase: 122-sfox-add-key-ui-e2e*
*Completed: 2026-07-19*
