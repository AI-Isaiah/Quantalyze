---
phase: 68-boundary-wiring-key-validation
plan: 01
subsystem: api
tags: [deribit, closed-sets, zod, pydantic, sql-check, migration, exchange-allowlist]

# Dependency graph
requires:
  - phase: 67-deribit-live-harness-exchange-ground-truth
    provides: deribit scope-gate semantics + EXCHANGE_CLASSES deribit construction
provides:
  - "4-value SUPPORTED_EXCHANGES (deribit) at the TS key-save boundary + Deribit display label"
  - "Decoupled 3-value UI_EXCHANGE_CODES + FUNDING_EXCHANGES consts (OQ4 gate + Pitfall 2)"
  - "Three pydantic Literals (VerifyStrategyRequest.exchange / Broker / Source) admit deribit"
  - "ONE self-verifying migration widening api_keys/compute_jobs/strategies.source/strategy_verifications.source CHECKs"
  - "STRATEGY_SOURCES + SOURCE_BADGE_LABEL gain deribit (parity-pinned to the migration)"
affects: [69-wizard-ux, 70-ingestion-funding, 72-verification, 68-03-parity-contract]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Boundary widening with DECOUPLED sibling consts so a base widen never auto-propagates to gated surfaces"
    - "Self-verifying DROP/ADD CHECK migration with per-table pg_get_constraintdef DO-block (fail-loud at apply)"
    - "Funding-scoped z.enum(FUNDING_EXCHANGES) keeps a discriminated-union transform exhaustive under a widened base"

key-files:
  created:
    - supabase/migrations/20260704200446_deribit_exchange_boundary_checks.sql
  modified:
    - src/lib/closed-sets.ts
    - src/lib/utils.ts
    - src/lib/types.ts
    - src/app/api/cron/sync-funding/route.ts
    - src/app/api/cron/reconcile-strategies/route.ts
    - analytics-service/models/schemas.py
    - src/lib/strategy-sources.ts

key-decisions:
  - "UI_EXCHANGE_CODES + FUNDING_EXCHANGES are explicit 3-value consts, NOT derived from SUPPORTED_EXCHANGES (OQ4 gate + Pitfall 2)"
  - "FundingFee read schema validates against a 3-value fundingExchangeEnum so the discriminated-union transform stays exhaustive (Rule 3 fix)"
  - "strategy_verifications_source_check WIDENED (OQ3 lockstep-bias) — Phase 72 verification needs it"
  - "compute_jobs CHECK preserves its `exchange IS NULL OR` nullable form"

patterns-established:
  - "Decoupled-const boundary widening: base allowlist widens, gated surfaces stay pinned by their own const + a leak-failing assertion"
  - "Per-table self-verify DO-block asserting pg_get_constraintdef contains every intended value"

requirements-completed: [DRB-02]

# Metrics
duration: 15min
completed: 2026-07-04
---

# Phase 68 Plan 01: Boundary Wiring — deribit Key-Save Allowlist Summary

**"deribit" now clears the TS `SUPPORTED_EXCHANGES` allowlist, the three pydantic Literals, and four SQL CHECK constraints — while the marketing count, public verify dropdown, and funding/reconcile crons stay 3-exchange via decoupled `UI_EXCHANGE_CODES` / `FUNDING_EXCHANGES` consts.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-04T17:53:49Z
- **Completed:** 2026-07-04T18:09:34Z
- **Tasks:** 3
- **Files modified:** 16 (15 modified + 1 migration created)

## Accomplishments
- Widened the TS single-source-of-truth allowlist (`SUPPORTED_EXCHANGES` + `EXCHANGE_DISPLAY`) to admit deribit at the key-save boundary.
- Introduced two decoupled 3-value consts (`UI_EXCHANGE_CODES`, `FUNDING_EXCHANGES`) that pin the public UI and the sync-funding/reconcile crons to 3 exchanges, each guarded by a leak-failing assertion (OQ4 gate + Pitfall 2).
- Widened all three pydantic Literals (`VerifyStrategyRequest.exchange`, `debug_key_flow.Broker`, `adapter.Source`) while leaving the ingestion registry (`SUPPORTED_SOURCES`) and `process_key` flow sets untouched (OQ2).
- Wrote ONE self-verifying migration re-basing the four OQ3-WIDEN CHECK constraints, each with a per-table `pg_get_constraintdef` fail-loud DO-block; funding/position/legacy constraints untouched.
- Kept `STRATEGY_SOURCES` ↔ migration set-equality green atomically.

## Task Commits

Each task was committed atomically:

1. **Task 1: Widen TS SoT + decouple UI + funding/reconcile surfaces** - `7c94bba6` (feat)
2. **Task 2: Widen the three pydantic Literals + flip stale audit test** - `86214117` (feat)
3. **Task 3: ONE self-verifying SQL migration + paired STRATEGY_SOURCES** - `fb91658e` (feat)

## Files Created/Modified
- `src/lib/closed-sets.ts` - Added deribit to SUPPORTED_EXCHANGES + EXCHANGE_DISPLAY; new UI_EXCHANGE_CODES / FUNDING_EXCHANGES consts; EXCHANGES now derives from UI_EXCHANGE_CODES.
- `src/lib/closed-sets.test.ts` - Flipped SUPPORTED_EXCHANGES/isSupportedExchange assertions; added UI/FUNDING exclusion pins; EXCHANGES stays 3-value (OQ4 pin).
- `src/lib/constants.ts` - Updated the EXCHANGES re-export comment (type now includes "Deribit", runtime array stays 3-value).
- `src/lib/utils.ts` - Re-exports UI_EXCHANGE_CODES + FUNDING_EXCHANGES (deviation — see below).
- `src/lib/types.ts` - fundingExchangeEnum keeps the FundingFee union transform exhaustive (deviation — see below).
- `src/components/landing/VerificationForm.tsx` - Public verify dropdown + default repointed to UI_EXCHANGE_CODES.
- `src/app/api/cron/sync-funding/route.ts` - PERP_EXCHANGES from FUNDING_EXCHANGES.
- `src/app/api/cron/sync-funding/route.test.ts` - Exact-set assertion (not arrayContaining) so a deribit leak fails.
- `src/app/api/cron/reconcile-strategies/route.ts` - RECONCILABLE_EXCHANGES from FUNDING_EXCHANGES.
- `analytics-service/models/schemas.py` - VerifyStrategyRequest.exchange Literal admits deribit; H-0530 comment reworded to use kraken as the out-of-domain example.
- `analytics-service/routers/debug_key_flow.py` - Broker Literal admits deribit.
- `analytics-service/services/ingestion/adapter.py` - Source Literal admits deribit (registry/flow sets deferred to Phase 70).
- `analytics-service/tests/test_portfolio_router_audit_2026_05_07.py` - test_deribit_exchange_rejected → test_deribit_exchange_accepted; kraken still proves the closed-set gate.
- `supabase/migrations/20260704200446_deribit_exchange_boundary_checks.sql` - ONE migration, four DROP/ADD CHECK + self-verify DO-blocks.
- `src/lib/strategy-sources.ts` - STRATEGY_SOURCES gains deribit (paired with the migration).
- `src/components/admin/AdminTabs.tsx` - SOURCE_BADGE_LABEL gains deribit (compile-forced, admin-only).

## Decisions Made
- Decoupled UI/funding consts declared as explicit literals (`as const satisfies readonly SupportedExchange[]`) so they retain narrowing yet never auto-widen with the base.
- The funding_fees read schema was switched to a 3-value `fundingExchangeEnum` rather than adding a deribit arm to the FundingFee discriminated union — funding stays a 3-exchange surface (SQL CHECK unchanged), so a deribit funding row can never exist.
- `strategy_verifications_source_check` widened per OQ3 lockstep-bias (Phase 72 verification needs it).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] fundingExchangeEnum to keep the FundingFee transform exhaustive**
- **Found during:** Task 1 (tsc verification)
- **Issue:** Adding deribit to `SUPPORTED_EXCHANGES` widened `exchangeEnum`, which the `FundingFee` Zod schema (`src/lib/types.ts:955`) used for its `exchange` field. The schema's `.transform()` switch (a discriminated union over binance/okx/bybit only) became non-exhaustive → `TS2366: Function lacks ending return statement`. `types.ts` was NOT in the plan's `files_modified`.
- **Fix:** Introduced `const fundingExchangeEnum = z.enum(FUNDING_EXCHANGES)` and pointed the funding schema's `exchange` field at it. This keeps funding a 3-exchange surface (consistent with the plan's funding-decoupling intent + `funding_fees_exchange_check` staying 3-value) and the union transform exhaustive.
- **Files modified:** src/lib/types.ts
- **Verification:** `npx tsc --noEmit` exits 0; funding-fee-runtime-guard + types-design tests pass (20/20).
- **Committed in:** 7c94bba6 (Task 1 commit)

**2. [Rule 3 - Blocking] utils.ts re-exports for the decoupled consts**
- **Found during:** Task 1 (repointing VerificationForm + crons)
- **Issue:** VerificationForm and both cron routes import their exchange set from `@/lib/utils` (not directly from closed-sets). Repointing them to `UI_EXCHANGE_CODES` / `FUNDING_EXCHANGES` required those consts to be reachable on the established `@/lib/utils` path. `utils.ts` was NOT in the plan's `files_modified`.
- **Fix:** Extended the existing closed-sets re-export block in `utils.ts` to also re-export `UI_EXCHANGE_CODES` and `FUNDING_EXCHANGES`, matching the pre-existing `SUPPORTED_EXCHANGES` re-export convention.
- **Files modified:** src/lib/utils.ts
- **Verification:** tsc + lint clean; both cron routes and VerificationForm resolve their imports.
- **Committed in:** 7c94bba6 (Task 1 commit)

**3. [Rule 1 - Bug] RAISE EXCEPTION format placeholders in the migration**
- **Found during:** Task 3 (writing the migration)
- **Issue:** Initial self-verify DO-blocks used `%%` in `RAISE EXCEPTION` format strings. In PL/pgSQL `RAISE`, `%` is the substitution placeholder and `%%` is an escaped literal percent that consumes no argument — supplying args with zero `%` placeholders raises "too many parameters" on the fail path, corrupting the intended diagnostic.
- **Fix:** Replaced all `%%` with `%` so the offending value + constraint def substitute correctly.
- **Files modified:** supabase/migrations/20260704200446_deribit_exchange_boundary_checks.sql
- **Verification:** grep confirms zero `%%` remain; each RAISE has matching `%` count for its args.
- **Committed in:** fb91658e (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All three were necessary for correctness/compile — the two blocking fixes are the natural fan-out of widening a base const consumed by a discriminated union and by downstream import paths; the migration RAISE fix is a fail-loud-path correctness bug. No scope creep; funding/UI stay 3-exchange as designed.

## Issues Encountered
- Local Python 3.14 venv segfaults at pytest collection (pandas tslibs ABI, known). Task 2 verified via the plan's fallback: direct `model_fields` annotation inspection + live construction of `VerifyStrategyRequest(exchange="deribit")` (accepts) and `"kraken"` (raises). CI is the pytest authority.

## Known Stubs
None.

## Threat Flags
None — no new network endpoints, auth paths, or trust-boundary surface beyond the planned allowlist widening.

## Expected-RED note (checker W1, handled by 68-03)
`src/__tests__/contracts/check-zod-db-check-parity.test.ts` — the `funding_fees.exchange` spec is deterministically RED (15/16 pass): it pins `ts: SUPPORTED_EXCHANGES` (now 4-value) against the 3-value `funding_fees_exchange_check` that intentionally stays 3-exchange. This is the single expected failure; Plan 68-03 decouples that spec. `compute_jobs.exchange` went GREEN once this plan's migration widened its CHECK.

## User Setup Required
None — the orchestrator handles migration review (migration-reviewer agent) + applying the migration to the test project before any future deribit-inserting e2e (none exist this phase).

## Next Phase Readiness
- Boundary now admits deribit end-to-end (TS + pydantic + SQL) — Phase 69 (wizard UX) and Phase 72 (verification) can build on it.
- Plan 68-02 (scope validation, DRB-03) and Plan 68-03 (parity contract tests, incl. the funding_fees decouple) follow in this phase.

---
*Phase: 68-boundary-wiring-key-validation*
*Completed: 2026-07-04*

## Self-Check: PASSED
- All created/modified files exist on disk (migration, SUMMARY, closed-sets.ts, types.ts, utils.ts verified).
- All three task commits present in git history (7c94bba6, 86214117, fb91658e).
