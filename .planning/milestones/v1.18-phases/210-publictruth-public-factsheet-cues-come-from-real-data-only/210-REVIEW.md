---
phase: 210-publictruth-public-factsheet-cues-come-from-real-data-only
reviewed: 2026-11-14T12:30:00Z
depth: standard
files_reviewed: 88
files_reviewed_list:
  - supabase/migrations/20261114120000_get_published_trade_venues_open_windows.sql
  - supabase/migrations/down/20261114120000-rollback.sql
  - supabase/schema/functions/get_published_trade_venues.sql
  - supabase/tests/test_get_published_trade_venues.sql
  - scripts/mutation-floors.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/__tests__/figure-parity-pages.test.tsx
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/types.ts
  - src/lib/factsheet/peer-cohort.ts (deleted)
  - src/lib/factsheet/allocator.ts (deleted)
  - src/lib/factsheet/allocator-portfolio-payload.ts
  - src/lib/factsheet/trade-fetch-provenance.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/factsheet/[id]/trade-fetch-lines.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/components/strategy/SyncBadge.venue.test.tsx
  - src/lib/queries.trade-venues.test.ts
  - src/lib/factsheet/build-payload.test.ts
  - src/lib/factsheet/fetch-and-build-payload.test.ts
  - src/lib/factsheet/trade-fetch-provenance.test.ts
  - src/app/factsheet/[id]/v2/FactsheetView.unrecovered-gap.test.tsx
  - src/app/factsheet/[id]/tearsheet/page.trade-fetch.test.tsx
  - src/lib/return-stats.single-source.test.ts
  - src/lib/factsheet/return-stats.sites.test.ts
  - src/lib/factsheet/return-stats.sites-joint.test.ts
  - src/lib/factsheet/audit-c20.test.ts
  - docs/architecture/adr-0025-scenario-peer-carveout.md
  - tools/eslint-plugin-quantalyze/rules/no-rem-less-clamp.mjs
  - vitest.node-env.ts
  - "(plus the remaining fixture-only test edits in `git diff 8fc78b69a...HEAD -- . ':!.planning'`, which drop the removed prop or payload fields)"
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
  necessity: 1
status: issues_found
---

# Phase 210: Code Review Report

**Reviewed:** 2026-11-14T12:30:00Z
**Depth:** standard
**Files Reviewed:** 88 (scope: `git diff 8fc78b69a...HEAD -- . ':!.planning'`)
**Status:** issues_found (no MEDIUM or higher)

## Summary

I checked the three fixes against D-01..D-20. **I found no BLOCKER and no MEDIUM-or-higher defect.** The one Warning is a necessity finding, LOW on the project's scale and not user-facing. The five Info items are LOW or INFO.

What I measured at HEAD `a9d2bf09e` in this worktree, beyond reading the code:

- **SQL gate bites.** `node scripts/mutation-runner/run.mjs --subset-from <list holding test_get_published_trade_venues.sql>`, exit 0: baseline exit 0, all 12 arms `RED (identity ok)`, including the re-pointed TV-1, TV-unpublished, TV-unpublished-composite, TV-strategy-keys and TV-distinct-lower and the new TV-closed-window and TV-window-end-today. Output: `arms: 12/12/0`, `biting: 12`, `lane-invocations: 12`, restore exit 0.
- **`find` strings are not repeated in comments.** `--parse-only` reports `No static defects. Every prose marker has a twin and every needle still matches`, `arms: 0/832/0`, `coverage: files 81/108`. By hand: `sk.window_end > current_date` occurs twice in the new migration (the body, then the self-verify literal), and the runner replaces the first occurrence (`applyFileStep`, `indexOfNth`). So TV-closed-window and TV-window-end-today mutate the body first, and TV-window-end-today's second step re-baselines the self-verify literal, as the annotation says.
- **Census moved together.** `ARMS_FLOOR` 830 → 832 in `scripts/mutation-floors.mjs`. The `gate-family-meta` registry key, `armsSeen`, `stepsSeen`/`needles.length` (943 → 951) and every `830` splice in `mutation-runner-floors.test.ts` moved with it. `FILES_FLOOR` stays 81 and `WAIVED_CEILING` stays 0. `origin/main` still carries 830/81, so nothing conflicts today.
- **Migration hardening.** SECURITY DEFINER, `SET search_path = public, pg_temp`, `RETURNS TABLE (strategy_id uuid, exchange text)`, `REVOKE ALL ... FROM PUBLIC` and an explicit `GRANT EXECUTE TO anon, authenticated, service_role` are all restated. The self-verify reads only `pg_proc`, `has_function_privilege` and `aclexplode(proacl)`, and never a table (D-04). The rollback restores the 20261019120000 body with `CREATE OR REPLACE` and has no DROP (D-05). `npm run schema:functions:check`: `snapshot is current (132 functions)`. `check-baseline-currency.mjs --replay-set`: `replay=1 ... defects=0`, naming exactly the new migration.
- **Removed-field readers.** No production reader of `peerPercentile`, `allocatorPortfolios`, `AllocatorPortfolioPayload`, `computePeerPercentile`, `alignBlend` or `hideAllocatorSection` is left. Every remaining hit is an absence assertion in a test or prose. The csv arm keeps `PeerPercentilePayload` and `scenarioPeer` (`types.ts`, `BatchDPanels.tsx:133`, `MetricsColumn.tsx:598/751`, `scenario/peer-rank/route.ts`, `ScenarioComposer.tsx`, `scenario-factsheet-payload.ts`). `SPX_DAILY`/`IEF_DAILY`/`GLD_DAILY`/`ETH_DAILY` are still read by the comparator correlations (`build-payload.ts:188-191`), so keeping them was correct.
- **Sentry payload.** The error message is a constant. Tags are `stage`, `reason` and `strategy_id`, a uuid. `extra.detail` is one of six fixed reason literals from `malformedGaps(...)`. Neither the provenance nor any date goes in, and `T-210-11` pins that dates are absent.
- **Cache key.** One key stores the factsheet payload (`unstable_cache` in `v2/page.tsx`; no other factsheet `unstable_cache` exists under `src/`). It moves `v24` → `v25`, and `origin/main` is still at `v24`.
- **Tests and static checks.** `npx tsc --noEmit -p .` is clean. `eslint` over every added or modified `src/` file is clean. 10 phase-touched vitest files: 493/493 pass.
- **New tests fail on revert.** The api-payload absence test (`"peerPercentile" in payload`, serialized-name scan), the reader verdict test, the fetch-and-build Sentry-and-flag test and the render tests fail on today's code without the phase's changes. Exceptions are listed as IN-02 and IN-03.

Necessity was assessed using `~/.claude/gsd-core/references/necessity-review.md`.

## Warnings

### WR-01: `parseUnrecoveredGaps` is a production export with no production caller, and it drops the malformed verdict

**File:** `src/lib/factsheet/trade-fetch-provenance.ts:100-107`
**Category:** necessity
**Severity on the project scale:** LOW (not user-facing, no data-integrity effect today)
**Issue:** After D-16 the only production reader is `readUnrecoveredGaps`, called from `fetch-and-build-payload.ts:989`. `grep -rn parseUnrecoveredGaps src scripts` shows the wrapper is imported only by `trade-fetch-provenance.test.ts` and `FactsheetView.unrecovered-gap.test.tsx`. That makes it generality without instantiation. It is also the exact silent-`[]` contract that SC-3 removes. A future surface that picks the shorter-named function gets the 167.1.2.2.2-GAP-RECORD-SILENT-PARSE defect back with no review signal. D-16 allowed keeping the name, so this is not a decision violation.
**Fix:** Delete the wrapper and point the two test files at `readUnrecoveredGaps(x).gaps`. If the name has to stay, at least un-export it from the production module.

## Info

- **IN-01 (LOW):** `supabase/tests/test_get_published_trade_venues.sql`: no annotated arm targets the `sk.window_end IS NULL OR` disjunct. The new migration's self-verify (`:139`) checks only `sk.window_end > current_date`. Dropping the NULL arm is still caught by behaviour, because TV-strategy-keys (strat_sk, `window_end NULL`) and TV-closed-window (the open okx member) both go red, but no arm names it. No fixture has an open window with a FUTURE non-NULL end, so rewriting the predicate to `window_end IS NULL` alone (keeping the literal elsewhere) would pass every arm. Consider a `TV-open-null` arm and a fixture member ending `current_date + 30`.
- **IN-02 (LOW):** `src/app/factsheet/[id]/tearsheet/page.trade-fetch.test.tsx` (the new D-18 case): it mocks `fetchAndBuildPayloadWithReason` to return a payload that already carries `unrecoveredGapsUnavailable: true`, then asserts the page passes it through. Reverting D-16/D-17/D-18 cannot turn it red. It pins only the pre-existing pass-through, despite commit `64a13c548`'s "each go RED when reverted". The real tear-sheet coverage is the `printView` render case in `FactsheetView.unrecovered-gap.test.tsx`.
- **IN-03 (INFO):** `SyncBadge.venue.test.tsx` (D-09 case) and `queries.trade-venues.test.ts` (D-06 case) pin behaviour that existed before the phase (badge and reader contracts). They cannot fail when the migration is reverted. The plan says so, and SC-4's RED-on-revert for the venue fix is carried by the SQL gate arms, measured above.
- **IN-04 (INFO):** `supabase/schema/functions/get_published_trade_venues.sql:11-15`: the regenerated snapshot copies the migration's `prod-body-ack: 1dd7db89…` pragma and its VAC-04 note. The hash is bound to the pre-migration PROD body, so it can never match again and is inert, but the snapshot now carries a stale acknowledgement comment.
- **IN-05 (INFO):** `fetch-and-build-payload.ts:992-997`: the gap report fires on every UNCACHED build (the tear sheet and the factsheet-share page call the builder directly; the v2 page also calls it outside the cache on some branches), not only "once per cache miss" as the comment says. It is the same posture as the existing reconstructed-ranges report, and Sentry groups by the constant message, so the result is noise, not a defect.

---

_Reviewed: 2026-11-14T12:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
