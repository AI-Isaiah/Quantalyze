---
phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit
verified: 2026-07-31T14:00:00Z
status: passed
score: 4/4 must-haves verified
human_verification_resolved: 2026-07-31 — both CI-only lanes executed locally and PASSED (see 141-HUMAN-UAT.md). SQL gate ran against TEST qmnijlgmdhviwzwfyzlc with a negative-control falsifiability proof and zero pollution; real-Redis lane 7/7 green.
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
human_verification:
  - test: "CI `sql-tests` lane executes supabase/tests/test_resync_retry_single_job.sql against the TEST project (qmnijlgmdhviwzwfyzlc)"
    expected: "double enqueue → 1 non-terminal compute_jobs row; distinct-session SV rows admitted (2); same-session reinsert 23505s. Exit 0 under psql -v ON_ERROR_STOP=1"
    why_human: "No local TEST-DB credentials in the sandbox; the file must never be run against PROD. Structure is grep-verified (5 RAISE EXCEPTION, process_key_long ×2, SET LOCAL ROLE service_role, ROLLBACK, 23505). The idempotency behavior it re-proves at the REAL index is already proven at the app level by the local pytest (5 passed)."
  - test: "CI real-Redis lane `npm run test:redis` (docker-compose.redis-test.yml) re-runs the SC-4 breaker cases under a real Upstash-compatible Redis"
    expected: "SC-4a (open at entry → zero fetch) and SC-4b (opens between attempts → CircuitOpenError, one fetch) green under real Redis"
    why_human: "Requires a Docker Redis container unavailable in the execution sandbox. SC-4 is already proven at the unit level (mocked Upstash) — 288 seam tests pass locally, both breaker gates present in source and mutation-observed."
---

# Phase 141: SEAM — Retry-with-backoff, gated on the idempotency audit — Verification Report

**Phase Goal:** Transient Railway blips self-heal — but ONLY for calls with a traced idempotency proof, so a retry can never double-execute a side effect.
**Verified:** 2026-07-31
**Status:** human_needed (all 4 truths VERIFIED in code; 2 CI-only re-proof lanes surfaced for confirmation)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria — the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | A committed in-repo audit artifact maps every seam function + `/process-key` flow_type to retry-safe yes/no with traced server-side evidence (incl. recomputeMatch/computePortfolioAnalytics/optimizer/simulator/bridge), resolves `_get_recompute_lock` distributed-vs-process-local, everything unproven defaults to no-retry | ✓ VERIFIED | `src/lib/seam-retry-registry.ts` — 13 evidenced verdicts across 2 grains (2 YES + 2 NO flow_types; 4 YES + 5 NO analytics = all 9 wrappers). `RETRY_AUDIT_NO_ANALYTICS["match-recompute"]` records `_get_recompute_lock` **PROCESS-LOCAL** (`dict[str, asyncio.Lock]`, in-memory per worker) → no-retry. YES maps are `Partial<Record>` so absence ⇒ no-retry by construction (wrapper reads `[key]?.retries ?? 0`). Exactly 2 `import type` lines, zero value imports — dependency-free leaf. Test 288-suite green; exhaustiveness union pins present. |
| SC2 | Under an injected single transient failure, an allowlisted call (resync) succeeds on retry with exactly ONE server-side effect — proven against the real `compute_jobs` partial-unique index + `WIZARD_DUPLICATE` contract | ✓ VERIFIED (unit+wiring locally; real-index re-proof in CI) | Retry loop in `resilient-fetch.ts:2010-2177` (bounded `1+retries`). Python resync dedup pre-check `process_key.py:1432-1460` scoped `(strategy_id, flow_type='resync', status='draft')` → `_resume_duplicate_job` + `_wizard_duplicate_reply` before the draft INSERT. Local pytest `test_resync_draft_dedup.py` + `test_teaser_non_idempotent.py` → **5 passed**. Wiring test resync→2 fetches (SC-2 ledger mutation observed RED). SQL gate `test_resync_retry_single_job.sql` re-proves the real index in CI (grep-verified). |
| SC3 | `flow_type: teaser` is provably never retried; a regression test pins two identical teaser calls → TWO `strategy_verifications` rows | ✓ VERIFIED | `teaser`/`csv` strictly absent from `RETRY_SAFE_FLOW_TYPES` (registry test `toBeUndefined` pins, green). Client belt: `process-key-client.ts:453` `RETRY_SAFE_FLOW_TYPES[args.flow_type]?.retries ?? 0` — explicit `?? 0` so a future `process-key-sync` row flip cannot retry teaser/csv. `process-key-sync` row pinned `retries: 0` (EXPECTED_RETRIES literal). Python `test_teaser_non_idempotent.py` pins two-rows-distinct-session (passes locally). SC-3 mutation observed RED in TWO independent files. |
| SC4 | With the breaker open, zero retry attempts fire — no bypass path exists | ✓ VERIFIED (unit locally; real-Redis re-proof in CI) | Entry gate `resilient-fetch.ts:1953-1956` (zero attempts when open). Pre-attempt-2 re-check `:2025-2030` throws `CircuitOpenError` above the fetch `try` — loop cannot swallow it. Both positions mutation-observed RED (SC-4 ledger). 288 seam tests green locally on mocked Upstash. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/seam-retry-registry.ts` | dependency-free leaf; audit == allowlist; absence ⇒ no-retry | ✓ VERIFIED | 194 lines, 2 `import type` only, 13 verdicts, process-local recorded. Wired by both clients. |
| `src/lib/resilient-fetch.ts` | bounded retry loop, both breaker gates, `retriesOverride`, backoff+jitter constants, 5 rows flipped | ✓ VERIFIED | Loop `:2010`, gates `:1953`+`:2025`, `SEAM_RETRY_BACKOFF_MS=250`/`SEAM_RETRY_JITTER_MAX_MS=250` `:334/:347`, 5 rows `retries: 1`, `SEAM_RETRIES=0` unchanged `:252`. |
| `src/lib/process-key-client.ts` | flow_type-keyed `retriesOverride` with `?? 0` belt | ✓ VERIFIED | `:453` `RETRY_SAFE_FLOW_TYPES[args.flow_type]?.retries ?? 0`. |
| `src/lib/analytics-client.ts` | budgetKey-keyed `retriesOverride` with `?? 0` belt | ✓ VERIFIED | `:434` `RETRY_SAFE_ANALYTICS[options.budgetKey]?.retries ?? 0` at the one chokepoint. |
| `src/lib/seam-constants.pin.test.ts` | per-row retries pins (5 at 1, rest 0) + registry↔rows consistency pin | ✓ VERIFIED | Hand-typed `EXPECTED_RETRIES` literal; consistency pin iterates `RETRY_SAFE_ANALYTICS`; negative pins for process-key-sync + keys-permissions. |
| `analytics-service/routers/process_key.py` | resync draft-SV dedup pre-check | ✓ VERIFIED | `:1432-1460` additive pre-check; teaser mint `:936-938`, `idempotent_by_session :1033`, 23505 arm unchanged. |
| `analytics-service/tests/test_resync_draft_dedup.py` | full-app pytest, 2→1 draft rows | ✓ VERIFIED | 360 lines; passes locally. |
| `analytics-service/tests/test_teaser_non_idempotent.py` | two teaser → two distinct-session SV rows | ✓ VERIFIED | 83 lines; passes locally. |
| `supabase/tests/test_resync_retry_single_job.sql` | real-index SC2 proof | ✓ VERIFIED (structure); ⚠️ CI-runs | 214 lines; 5 RAISE EXCEPTION, process_key_long, service_role, ROLLBACK, 23505 all present. Executed in CI sql-tests (no local TEST-DB). |
| `src/lib/resilient-fetch.retry.test.ts` | SC2 mechanics + SC4 breaker + latch + wiring | ✓ VERIFIED | 721 lines; part of 288 green. |
| `src/lib/seam-retry-registry.test.ts` | absence pins, exhaustiveness, disjointness, purity | ✓ VERIFIED | 176 lines; green. |
| `src/lib/seam-budgets.invariant.test.ts` | SC-4b charges backoff+jitterMax | ✓ VERIFIED | Imports both retry constants; worst-case `timeoutMs × calls × (1+retries)` + backoff; green. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| process-key-client | seam-retry-registry | `RETRY_SAFE_FLOW_TYPES[args.flow_type]` | ✓ WIRED | value import `:18`, use `:453` |
| analytics-client | seam-retry-registry | `RETRY_SAFE_ANALYTICS[options.budgetKey]` | ✓ WIRED | value import `:35`, use `:434` |
| resilient-fetch retry loop | isBreakerOpen | pre-attempt-2 re-check | ✓ WIRED | `:2025-2030` throws above fetch try |
| resilient-fetch retry loop | seamBreakerVerdict counting classes | retry-eligibility branch | ✓ WIRED | transport catch `:2116`, status verdict `:2154-2162` |
| process_key.py resync pre-check | _resume_duplicate_job + _wizard_duplicate_reply | duplicate-hit branch before draft insert | ✓ WIRED | `:1448-1460` |
| SQL gate | compute_jobs_one_inflight_per_kind_strategy | enqueue_compute_job ×2, p_kind process_key_long | ✓ WIRED | grep-verified |

### Data-Flow Trace (Level 4)

Not applicable — this phase produces transport/registry infrastructure and idempotency proofs, not dynamic-data-rendering UI. Retry eligibility flows registry → client `retriesOverride` → loop bound (traced above under Key Links).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Seam retry TS suites green | `vitest run seam-retry-registry / resilient-fetch.retry / seam-constants.pin / seam-budgets.invariant / resilient-fetch` | 5 files, 288 passed | ✓ PASS |
| tsc clean | `npx tsc --noEmit` | exit 0, 0 errors | ✓ PASS |
| Python idempotency proofs | `python3 -m pytest test_resync_draft_dedup.py test_teaser_non_idempotent.py` | 5 passed | ✓ PASS |
| No mutants left in tree | `grep -rn MUTANT src/ analytics-service/` | 0 | ✓ PASS |
| Exactly 5 rows flipped | `grep -c "retries: 1," resilient-fetch.ts` | 5 | ✓ PASS |
| Row flip + both pins in ONE commit | `git show --stat f2d47275` | resilient-fetch.ts + seam-constants.pin.test.ts + seam-budgets.invariant.test.ts in one commit | ✓ PASS |
| SQL gate against real DB | (CI sql-tests) | not runnable in sandbox | ? SKIP → human/CI |
| Real-Redis SC-4 lane | `npm run test:redis` | needs Docker Redis | ? SKIP → human/CI |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared or implied for this phase. Falsifiability-ledger mutations serve the probe role and were re-verified: all four SC rows in `141-VALIDATION.md` marked `Observed ✅` with pasted evidence; `grep -rn MUTANT` → 0 confirms tree restored.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEAM-05 | 141-03, 141-04 | Committed retry-safety audit mapping every seam fn + flow_type with traced evidence; resolves `_get_recompute_lock` | ✓ SATISFIED | `seam-retry-registry.ts` (13 verdicts, process-local recorded); registry↔rows consistency pin |
| SEAM-06 | 141-01, 141-02, 141-04 | Bounded retry + backoff + jitter, respects open breaker no bypass, provably never retries teaser | ✓ SATISFIED | retry loop + dual breaker gates + flow_type belt + 5 flipped rows |

Both requirement IDs from PLAN frontmatter map to Phase 141 in REQUIREMENTS.md (lines 46-47, 266-267). No orphaned requirements — REQUIREMENTS.md assigns only SEAM-05/SEAM-06 to Phase 141, both claimed and satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | none | — | No unreferenced TBD/FIXME/XXX debt markers in phase-modified files. Documented residuals (concurrent two-tab resync race; SQL/Redis CI lanes) are recorded design decisions, not debt markers. `?? 0` / registry-absence defaults are the intended belt, not stubs (data-fetching paths verified). |

### Human Verification Required

Two verification lanes cannot run in this sandbox and are surfaced for CI confirmation. Neither indicates code deficiency — both are re-proofs of behavior already proven at the unit/app level locally.

#### 1. SQL gate against the real compute_jobs index

**Test:** CI `sql-tests` executes `supabase/tests/test_resync_retry_single_job.sql` against the TEST project (qmnijlgmdhviwzwfyzlc).
**Expected:** double enqueue → 1 non-terminal compute_jobs row; distinct-session SV rows admitted (2); same-session reinsert raises 23505. Exit 0.
**Why human/CI:** No local TEST-DB creds; must never run against PROD. Structure grep-verified; the app-level idempotency it re-proves already passes in local pytest (5 passed).

#### 2. Real-Redis SC-4 breaker lane

**Test:** `npm run test:redis` (docker-compose.redis-test.yml) re-runs SC-4a/SC-4b under real Redis.
**Expected:** open-at-entry → zero fetch; opens-between-attempts → CircuitOpenError + one fetch.
**Why human/CI:** Requires a Docker Redis container unavailable in sandbox. SC-4 proven at unit level (mocked Upstash), both gates present and mutation-observed.

### Gaps Summary

No gaps. All four ROADMAP success criteria are VERIFIED against the merged code, not just the SUMMARYs:

- The registry is a genuine dependency-free leaf (2 `import type` lines, verified by reading the file) that is simultaneously the SEAM-05 audit and the runtime allowlist; `_get_recompute_lock` process-local resolution is inline; absence ⇒ no-retry via `Partial<Record>` + explicit `?? 0` at both clients.
- The retry loop is bounded (`1 + retries`), retries only counting/transient classes, returns 2xx/4xx immediately, and enforces the breaker at BOTH positions (entry + pre-attempt-2 re-check thrown above the fetch try).
- Exactly five SEAM_BUDGETS rows are flipped to `retries: 1` (bridge, simulator, portfolio-optimizer, optimize-weights, process-key-enqueue); process-key-sync and keys-permissions stay 0 and are pinned as hand-typed literals; the flip + both negative pins + SC-4b backoff term landed in ONE commit (f2d47275).
- The teaser no-retry belt is real: teaser/csv absent from the YES map, pinned strictly-undefined, and the Python two-distinct-rows non-idempotency pin passes locally.
- All four falsifiability-ledger rows are `Observed ✅` in 141-VALIDATION.md; tree is clean of mutants.

Status is `human_needed` solely to surface the two CI-only re-proof lanes (SQL gate, real-Redis) per the decision tree — these are environment limitations, NOT failures, and do not reduce the 4/4 truth score.

---

_Verified: 2026-07-31_
_Verifier: Claude (gsd-verifier)_
