---
phase: 15
review_path: .planning/phases/15-csv-unblock/15-REVIEW.md
gathered: 2026-04-30
fixes_applied: { count: 5, fixed_findings: [WR-01, WR-02, WR-03, WR-04, WR-05] }
fixes_skipped: { count: 7, reason: "INFO findings out of scope per fix_scope: critical_warning. Reviewer flagged them as Phase 17/18 follow-ups; none block the Phase 15 goal." }
auto_mode: true
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-05-01T06:44:00Z
**Source review:** .planning/phases/15-csv-unblock/15-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (CR + WR): 5 (0 Critical + 5 Warning)
- Fixed: 5
- Skipped: 0 (in scope) / 7 (out of scope INFO)

## Fixed Issues

### WR-01: Python multipart route reads entire upload before size check (DoS surface)

**Files modified:** `analytics-service/routers/csv.py`
**Commit:** `0f674d8`
**Verification:** `python3 -c "import ast; ast.parse(open('analytics-service/routers/csv.py').read())"` → SYNTAX OK
**Applied fix:** Replaced unbounded `await file.read()` with `_read_capped()` helper that streams 64 KiB chunks and aborts at the first chunk pushing the running total past `MAX_BYTES`. Worst-case heap is now `cap + chunk_size` regardless of caller payload. Same `CSV_FILE_TOO_LARGE` envelope shape as before — no contract change.

### WR-02: csv-validate route shares `userActionLimiter` budget with sensitive POSTs (5/min total)

**Files modified:** `src/lib/ratelimit.ts`, `src/app/api/strategies/csv-validate/route.ts`, `src/app/api/strategies/csv-finalize/route.ts`, `src/__tests__/csv-validate-route.test.ts`
**Commit:** `ae1712a`
**Verification:** `npx tsc --noEmit` (exit 0) + `npx vitest run src/__tests__/csv-validate-route.test.ts` (11/11 pass at this commit)
**Applied fix:** Added `csvValidateLimiter = makeLimiter(20, "60 s")` to `src/lib/ratelimit.ts`. Both csv-validate and csv-finalize routes now use the dedicated limiter instead of the shared `userActionLimiter`. Test mock updated. Aligns with end-user iteration cadence (3-5 validations/min realistic) AND the upstream Python `30/hour` cap.

### WR-03: csv-validate route does not validate `wizard_session_id` UUID shape before forwarding to Python

**Files modified:** `src/app/api/strategies/csv-validate/route.ts`, `src/__tests__/csv-validate-route.test.ts`
**Commit:** `8139dcd`
**Verification:** `npx tsc --noEmit` (exit 0) + `npx vitest run src/__tests__/csv-validate-route.test.ts` (13/13 pass — added 2 regression tests)
**Applied fix:** Added `isUuid(sessionId)` gate alongside the existing fmt+file checks; mirrors the defense-in-depth pattern already in csv-finalize. Two new regression tests pin: (a) missing wizard_session_id → 400 CSV_INVALID_FORMAT, (b) malformed wizard_session_id → 400 CSV_INVALID_FORMAT. Both verify `validateCsv` is NOT called (the upstream Python service is never reached).

### WR-04: queries.ts left-join on `strategy_verifications` is unbounded

**Files modified:** `src/lib/queries.ts`
**Commit:** `e170aa5`
**Verification:** `npx tsc --noEmit` (exit 0)
**Applied fix:** Added PostgREST `referencedTable` order+limit modifiers to BOTH `getStrategiesByCategory` (line 191-195) and `getStrategyDetail` (line 327-331). The embed now explicitly fetches `ORDER BY created_at DESC LIMIT 1` per strategy on the DB side. JS-side `.sort()+[0]` pick remains as a defensive no-op for Phase 15 (still exactly one row per strategy_id) but becomes a redundant safety net once Phase 19 adds `flow_type='resync'` rows. Used the supabase-js v2 `referencedTable` option (verified against `node_modules/@supabase/postgrest-js/src/PostgrestTransformBuilder.ts`).

### WR-05: RLS subquery `strategy_id IN (SELECT ...)` does not key off the embedding context

**Files modified:** `supabase/migrations/094_strategy_verifications_rls_polish.sql` (new file — does NOT modify migration 093)
**Commit:** `c442853`
**Verification:** SQL well-formed (BEGIN/COMMIT wrap + DO block self-verify). Runtime invariant pinned by existing `src/__tests__/strategy-verifications-rls.test.ts` (anti-leak SELECT contract).
**Applied fix:** New forward migration drops the IN-subquery form of `strategy_verifications_owner_select` and recreates it with the equivalent `EXISTS (SELECT 1 FROM strategies s WHERE s.id = strategy_verifications.strategy_id AND s.user_id = auth.uid())` form. Migration 093 is preserved untouched (already applied to test Supabase project qmnijlgmdhviwzwfyzlc). The DO block at the tail of 094 asserts the policy was rebuilt correctly.

## Skipped Issues

All 7 INFO findings (IN-01 through IN-07) are out of scope for this iteration per `fix_scope: critical_warning`. The reviewer classified all of them as Phase 17 / Phase 18 follow-ups; none block the Phase 15 goal of unblocking the 10 onboarding teams.

For reference, the deferred items are:
- IN-01: `analytics-client.ts:17` localhost fallback for non-CSV path (intentional split per cross-AI revision; documentation-only suggestion).
- IN-02: `_redact_preview` masks numeric columns matching PII regex (acknowledged in docstring; full Python `redact.py` ships in Phase 18 / FIX-04).
- IN-03: Pandera `is_monotonic_increasing` allows duplicate dates (Phase 17 follow-up).
- IN-04: `csv-finalize/route.ts:123` length check on un-trimmed `strategy_name` (defense-in-depth tweak; UI's `maxLength={80}` makes the gap practically unreachable).
- IN-05: `WizardClient.tsx:88-89` SSR-safe lazy ref-init lacks comment (cosmetic).
- IN-06: `loadWizardState` accepts 80 chars of whitespace (rejected by route+RPC at finalize; defense-in-depth tweak).
- IN-07: `TODO(phase-17)` markers not centrally enumerated (Phase 17 plan task, not a Phase 15 change).

## Final Verification

After all 5 fixes:
- `npx tsc --noEmit` → exit 0 (clean, project-wide)
- `npx vitest run src/__tests__/csv-validate-route.test.ts` → 13/13 pass (was 11; +2 WR-03 regression tests)
- `python3 -c "import ast; ast.parse('analytics-service/routers/csv.py')"` → SYNTAX OK
- Branch unchanged: `v1.0.0-api-key-rewrite-15-16`
- Migration 093 untouched; new migration 094 added at the next slot

## Commit Sequence

```
c442853 fix(15): WR-05 rebuild owner_select RLS with EXISTS form
e170aa5 fix(15): WR-04 scope strategy_verifications embed to latest row
8139dcd fix(15): WR-03 validate wizard_session_id UUID at csv-validate edge
ae1712a fix(15): WR-02 add dedicated csvValidateLimiter (20/min)
0f674d8 fix(15): WR-01 stream-cap CSV upload reads at 10 MB
```

---

_Fixed: 2026-05-01T06:44:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
