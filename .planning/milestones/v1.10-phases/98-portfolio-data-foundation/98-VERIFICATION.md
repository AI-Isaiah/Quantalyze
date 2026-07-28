---
phase: 98-portfolio-data-foundation
verified: 2026-07-12T11:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification_discharged: "2026-07-15 — both items DISCHARGED. PI-07 partial-unique index CONFIRMED live in PROD via Supabase MCP: CREATE UNIQUE INDEX portfolio_analytics_one_computing_per_portfolio ON public.portfolio_analytics(portfolio_id) WHERE computation_status='computing' (exact 98 migration def) → prod-apply verified + the 23505 cross-process fence is structurally in place. The SQL fence test ran green in CI when v1.10 shipped (Stage A PR #615 merged green → prod). Inherent live-only assertion now observed against a schema carrying the index."
human_verification:
  - test: "Run the PI-07 real-PG concurrency SQL test against a caught-up test project (or confirm the CI sql-tests step goes GREEN post-merge-catchup)"
    expected: "supabase/tests/test_portfolio_recompute_inflight_unique.sql passes: Part 1 finds the UNIQUE partial index; Part 2's second `computing` INSERT raises 23505; complete + other-portfolio computing inserts do not raise"
    why_human: "TEST_SUPABASE_DB_URL is not available in the verifier environment; the migration must be applied to the test project (orchestrator MCP catch-up) before the index exists. The live cross-process 23505 fence behaviour can ONLY be proven against real Postgres — it is inherently not offline-verifiable. The summary honestly declares this CI-gated (never claims RED/GREEN observed)."
  - test: "Confirm migration 20260714090000 applies cleanly to PROD on merge (dedupe-first, auto-apply)"
    expected: "Migration applies without aborting even if a prod portfolio holds >=2 live `computing` rows; the self-verify DO block prints the PI-07 OK NOTICE; zero portfolios left with >1 computing row"
    why_human: "Auto-applies to prod on merge (supabase-migrate). The dedupe-before-build ordering is structurally correct, but the prod apply against live data is an operational step to watch (per project memory: verify objects post-merge)."
---

# Phase 98: Portfolio Data Foundation Verification Report

**Phase Goal:** Deliver the server-side read layer the Portfolio Intelligence widgets (Phase 99/100) stand on — owner-scoped, secretless position-level exposure / net-exposure-over-time / allocation-over-time reads — plus the cross-process portfolio-recompute UNIQUE INDEX (PI-07) so concurrent recompute processes cannot create duplicate `computing` rows. NO UI in this phase.
**Verified:** 2026-07-12T11:00:00Z
**Status:** passed (both human items DISCHARGED 2026-07-15 — PI-07 index confirmed live in prod via Supabase MCP; SQL fence ran green in CI on v1.10 ship. See `human_verification_discharged`.)
**Re-verification:** No — initial verification; human items discharged post-ship 2026-07-15

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | PI-07 partial UNIQUE index exists, dedupe-first, atomic, replaces `idx_portfolio_analytics_computing` | ✓ VERIFIED | `20260714090000_...sql`: single tx `lock_timeout=5s` → `LOCK TABLE ... ACCESS EXCLUSIVE` → ranked-CTE dedupe (losers→`failed`, lines 55-68) → `DROP INDEX ... idx_portfolio_analytics_computing` (71) → `CREATE UNIQUE INDEX portfolio_analytics_one_computing_per_portfolio (portfolio_id) WHERE computation_status='computing'` (74-76) → self-verify DO block (81-126). Dedupe textually + executionally precedes the build. Timestamp `20260714090000` > latest existing `20260713120000`. |
| 2 | Losing racer's 23505 caught at the `computing` INSERT → 409/`in_flight`, never a 500/failed | ✓ VERIFIED | `portfolio.py` `_compute_portfolio_analytics`: try/except wraps ONLY the computing INSERT; repo's own `getattr(exc,"code")`+msg-fallback 23505 detection → `HTTPException(409, "Analytics computation already in progress for this portfolio")` (byte-identical to pre-SELECT 409); non-23505 re-raises bare. `cron.py` `_guarded_recompute`: `if http_exc.status_code == 409: return (pid,"in_flight",None)` placed BEFORE the 400-skip. **Independently reproduced RED** (reverted both prod files → 3 failed) and GREEN (restored → 71 passed). |
| 3 | Real-PG concurrency test exists (RED pre-index / GREEN post — or honestly CI-gated) | ✓ VERIFIED | `test_portfolio_recompute_inflight_unique.sql`: Part 1 structural (pg_indexes: exists + UNIQUE + `computing` predicate — the RED signal pre-migration); Part 2 functional in BEGIN…ROLLBACK — FK seed chain, first computing INSERT succeeds, nested `EXCEPTION WHEN unique_violation` on the 2nd, negative controls (same-portfolio `complete`, other-portfolio `computing`), seeded-id-scoped count = 1. Wired into CI by glob (`files=(supabase/tests/test_*.sql)`, ci.yml:741,791). Summary honestly declares NOT locally observed (no `TEST_SUPABASE_DB_URL`) → human item below. |
| 4 | Read foundation: owner-scoped, secretless, honest-empty, coverage-mask gaps; Fable data-shapes implemented | ✓ VERIFIED | `portfolio-exposure.ts`: USER `createClient` (no admin), `.eq("allocator_id", userId)`, six-col allow-list `select("asof, venue, symbol, holding_type, side, value_usd")` (no raw_payload/api_key), 730-day `.gte` cap, throws on error. D-P1 holding_type-primary grain (byGrain key `holding_type|venue|symbol|side`), D-P2 signed net (`signed()`; snapshot totalNet 250 / gross 450, short slice −100 asserted), D-P3 per-venue gross weights + zero-gross skip, D-P7 null/[] honest-empty, `computeAsofGaps` marked gaps (no zero-fill). 17/17 vitest GREEN. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `supabase/migrations/20260714090000_portfolio_recompute_inflight_unique.sql` | Dedupe-first partial UNIQUE migration + self-verify | ✓ VERIFIED | 128 lines; dedupe(64) < CREATE UNIQUE(74); DO-block asserts unique + old-index-gone + zero dupes; no `CREATE FUNCTION` |
| `supabase/migrations/down/20260714090000-rollback.sql` | Restore prior non-unique index | ✓ VERIFIED | Drops unique fence, recreates `idx_portfolio_analytics_computing (portfolio_id, computed_at DESC) WHERE ...='computing'` |
| `supabase/tests/test_portfolio_recompute_inflight_unique.sql` | Wave-0 concurrency test | ✓ VERIFIED (CI-gated) | Structural + functional; ROLLBACK on all paths; scoped counts; glob-discovered by CI |
| `analytics-service/routers/portfolio.py` | 23505→409 at INSERT | ✓ VERIFIED | Narrow try/except on the sole computing INSERT; non-23505 bare re-raise |
| `analytics-service/routers/cron.py` | 409→in_flight branch | ✓ VERIFIED | 409 branch before 400-skip; reuses existing in_flight bucket, no new status |
| `analytics-service/tests/test_portfolio_compute_integration.py` | Failing-first 23505/in_flight tests | ✓ VERIFIED | 4 tests (A/B/C/D); RED (3 failed) independently reproduced, GREEN 71 passed |
| `src/lib/portfolio-exposure.ts` | Typed server-only read layer | ✓ VERIFIED | 285 lines; 4 exports; owner-scoped, secretless, honest-empty, UTC gap math |
| `src/lib/portfolio-exposure.test.ts` | Vitest read-layer coverage | ✓ VERIFIED | 17 tests across 7 behaviour clusters; strong numeric assertions (250/450/−100, 0.75/0.25, gap spans) |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| migration | `portfolio_analytics(portfolio_id) WHERE ='computing'` | partial UNIQUE index | ✓ WIRED |
| dedupe UPDATE (rn>1 → failed) | CREATE UNIQUE INDEX | same tx, dedupe precedes build | ✓ WIRED (line 64 < 74) |
| portfolio.py INSERT | HTTPException(409) | except code=='23505' single choke point | ✓ WIRED |
| cron.py except HTTPException | (pid,"in_flight",None) | status_code==409 branch before 400 | ✓ WIRED |
| portfolio-exposure.ts | `allocator_holdings` | USER createClient + .eq(allocator_id) | ✓ WIRED (no admin import — source-check test) |
| portfolio-exposure.ts gaps | factsheet missingSegments | `{start,end,kind:"gap",days}` | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Read-layer vitest GREEN | `npx vitest run src/lib/portfolio-exposure.test.ts` | 17 passed | ✓ PASS |
| PI-07 pytest GREEN | `pytest test_portfolio_compute_integration.py test_cron_router.py` | 71 passed | ✓ PASS |
| PI-07 pytest RED (fix reverted) | checkout be215b15 prod files → pytest PI-07 classes | 3 failed, 1 passed (Test C baseline) | ✓ PASS (RED confirmed) |
| SQL fence 23505 live | `psql -f test_portfolio_recompute_inflight_unique.sql` | not runnable (no TEST_SUPABASE_DB_URL) | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PI-07 | 98-01, 98-02 | Cross-process recompute deduped by UNIQUE INDEX + real-PG test | ✓ SATISFIED (SQL RED→GREEN CI-gated) | Migration + code + tests present; pytest RED→GREEN reproduced |
| PI-01 | 98-03 | Exposure-by-asset-class read foundation (not the widget — Phase 99) | ✓ SATISFIED | `getLatestExposureSnapshot`, holding_type-primary grain |
| PI-02 | 98-03 | Net-exposure-over-time read (signed, marked gaps) | ✓ SATISFIED | `getNetExposureSeries` |
| PI-03 | 98-03 | Allocation-over-time read (per-venue weights) | ✓ SATISFIED | `getAllocationSeries` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | No TODO/FIXME/XXX/HACK/PLACEHOLDER in any changed line | ℹ️ Info | Clean |

### Scope / No-Invented-Data Check

- No `.tsx`, component, page, or route added in the phase diff — widget rendering correctly deferred to Phase 99. ✓
- No fabricated/zero-filled series: honest-empty (`null`/`[]`) + marked gaps, pinned by vitest (`points===[]`, `gaps===[]`, explicit gap-span assertions, zero-gross skip). ✓
- SC-4 additive: portfolio.py change is a narrow try/except around one INSERT; non-23505 re-raises bare; cron reuses the existing in_flight bucket (no new status); 71 pre+new tests pass — existing metrics untouched. ✓

### Human Verification Required

1. **PI-07 live SQL fence (CI-gated)** — Apply migration `20260714090000` to the test project (orchestrator MCP catch-up) and confirm the CI `sql-tests` step runs `test_portfolio_recompute_inflight_unique.sql` GREEN. This is the ONLY offline-unprovable must-have; the plan explicitly permits "honestly CI-gated" and the summary never falsely claims RED/GREEN was observed. The test file + migration are both present and structurally correct.
2. **Prod migration apply** — On merge, `20260714090000` auto-applies to prod; watch the run and confirm the self-verify DO block's PI-07 OK NOTICE + zero remaining `computing` duplicates.

### Gaps Summary

No blocking gaps. All code-level deliverables exist, are substantive, wired, and (where offline-provable) behaviourally green:
- PI-07 DB fence migration + code side are co-requisite and both present; the losing-racer 23505→409/in_flight path RED→GREEN was **independently reproduced** by the verifier, not merely trusted from the summary.
- The read foundation implements the Fable-locked data shapes (holding_type-primary, signed net, per-venue weights, marked gaps, honest-empty, secretless, owner-scoped) — 17/17 vitest.
- No widget/UI, no invented data, additive-only.

Status is `human_needed` (not `passed`) solely because the load-bearing PI-07 real-PG concurrency assertion is inherently live-only and has not yet been observed against a schema carrying the index — it awaits the orchestrator's test-project catch-up + CI run. This is the honest state, consistent with the plan's "CI is the runtime gate" contract.

Note: ROADMAP.md line 42 still shows `[ ] 98-03-PLAN.md` unchecked and "2/3 plans executed", but the 98-03 code (portfolio-exposure.ts + test, commits 0d01ad69/e3969957) is present and green — a stale checkbox, not a missing deliverable.

---

_Verified: 2026-07-12T11:00:00Z_
_Verifier: Claude (gsd-verifier)_
