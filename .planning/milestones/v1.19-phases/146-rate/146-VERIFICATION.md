---
phase: 146-rate
verified: 2026-08-18T05:05:00Z
status: passed
score: 5/5 success criteria verified
behavior_unverified: 0
overrides_applied: 0
verifier_head: 5d4a57c6cad67aa149cec6321966da73640bdd1b
merge_base: 8432a0b6e29ef563fef4479b9d77415704557c3e
---

# Phase 146: RATE Verification Report

**Phase Goal:** Every authed route hitting the Python service has the RIGHT rate limit — and a newly-added route can't silently ship with none.
**Verified:** 2026-08-18, worktree `quantalyze-145`, branch `feat/v1.19-phase-146`, HEAD `5d4a57c6`.
**Depth:** LIGHT (founder ruling v1.16 2026-08-03 — blockers = user-facing or data-integrity only).
**Re-verification:** No — initial.

Every load-bearing gate was RE-RUN by the verifier in this worktree; no SUMMARY claim was
accepted without a fresh measurement (falsified-ledger-claims discipline).

## Success Criteria

| SC | Verdict | Evidence (fresh, verifier-run) |
|---|---|---|
| SC1 — committed kickoff re-grep census replacing stale TODOS route list | **ACHIEVED** | `146-AUDIT.md` §1: twice-derived census (living invariant + independent comment-stripped grep), 14 routes / 15 sites, `NO_LIMITER_QUARANTINE = []`. Stale TODOS bullet struck-through CLOSED 2026-08-18 at `TODOS.md:872`, citing the AUDIT §1. |
| SC2 — burst `admin/match/eval` → 429 + Retry-After per `user.id` | **ACHIEVED** | `src/app/api/admin/match/eval/route.ts:157` — `checkLimit(adminActionLimiter, \`match-eval:${user.id}\`)` directly after the `isAdminUser` gate; deny via `rateLimitDenyJson` (429/503 owned by the chokepoint, `RATE_LIMITED` / `SEAM_MISCONFIGURED` codes). `route.test.ts` carries 10 `Retry-After` assertions. **Verifier re-ran** the vitest trio (posture invariant + limiter-ordering + route.test): **3 files / 62 tests passed** (matches AUDIT §1 receipt exactly). Rosters moved same-commit: eval pinned in `seam-ratelimit-posture.invariant.test.ts:186` (EXPECTED_LIMITER_ROUTES) and `limiter-ordering.test.ts:138` (NO_INPUT bucket). |
| SC3 — direct-to-Railway `match.py` `/recompute` + `/eval` → 429 via slowapi | **ACHIEVED** | `analytics-service/routers/match.py:1626` and `:1856` — `@limiter.limit("30/minute", key_func=partial(tenant_or_platform_key, scope="match_recompute"/"match_eval"))`, both handlers carry `request: Request`; `/cron-recompute` deliberately unlimited (recorded decision). Tripwire `test_match_routes_still_have_no_limiter` gone; literal set now pins `routers.match.eval_metrics` (`test_limiter_identity.py:570`) and a behavioral throttle test (`test_match_recompute_actually_throttles`, drives to a real 429 within 31 calls) exists. **Verifier re-ran** `python3 -m pytest tests/test_limiter_identity.py tests/test_tenant_claim_parity.py tests/test_status_contract_match_sim_portfolio.py` from `analytics-service/`: **88 passed**. |
| SC4 — committed limiter-VALUE audit with adjustments where wrong | **ACHIEVED** (per locked D-146-4 disposition: audit RECORDS, founder retunes) | `146-AUDIT.md` §3 fresh at HEAD: Table A (Vercel values re-read from `ratelimit.ts`), Table B (Python decorators), per-flow parity over 13 flows (4 MISMATCH / 9 CONSISTENT), all 5 pre-identified hypotheses explicitly CONFIRMED/REFUTED (H-1 confirmed 30×, Vercel side wrong; H-5 retry double-spend RECORD-ACCEPT). Exactly **5** TODOS bullets filed under "Phase 146 — RATE-04 value-parity candidates" with measured numbers. **Verifier confirmed zero live values changed:** `git diff 8432a0b6 HEAD -- src/lib/ratelimit.ts` is EMPTY. |
| SC5 — `withRateLimit` HOF | **ACHIEVED** (per locked D-146-1 disposition: VERIFIED-EXISTING, no second wrapper) | `146-AUDIT.md` §2 receipts (a)–(e) incl. honest residual. **Verifier re-ran the zero-count:** `grep -rn withRateLimit src/ analytics-service/` = **0** — no wrapper was minted. Structural successor = `withAuthLimited` + `withAdminAuth({rateLimitKey})` + the two living CI gates (which the verifier just ran green and which fail on any new limiterless seam route). |

## Requirement / Ledger Ticks (recommendations)

| ID | Recommendation | Basis |
|---|---|---|
| RATE-01 | **TICK** | SC1 achieved; census committed, stale list retired |
| RATE-02 | **TICK** | SC2 achieved, behaviorally proven (route.test.ts, re-run green) |
| RATE-03 | **TICK** | SC3 achieved (decorators + behavioral throttle + identity gates, re-run green) |
| RATE-04 | **TICK** | SC4 achieved under locked D-146-4 (ROADMAP SC4 annotated with the disposition; reversal = ship gate) |
| RATE-05 | **TICK** | SC5 achieved under locked D-146-1 (reversal = ship gate) |
| TS-21 | **TICK** | = RATE-03 |
| TS-22 | **TICK** | = RATE-04 audit artifact, committed |
| TS-23 (146 half) | **TICK the 146 half** | The 4 bare-scalar 429 raise sites migrated onto `service_error` with Retry-After PRESERVED (`match.py:1762` `service_error(429, …, retry_after=wait_s)` with `max(1,…)` clamp; `simulator.py:256` `retry_after=_SIMULATOR_USER_RATE_WINDOW_SEC`; `portfolio.py:2257` + sibling via `RETRY_AFTER_SECONDS`). Which-shape-wins documented in code ("the ONE winning 429 raise-site shape"). **Verifier zero-count:** non-test `status_code=429` in `analytics-service/` = 1, and that one is `main.py:517` — the central slowapi `RateLimitExceeded` handler (an exception handler, not a raise site; sends `Retry-After` header). No bare `HTTPException(429)` remains. |
| TS-36 | **TICK** | `test_tenant_claim_parity.py` reads the repo-root `tests/fixtures/tenant-claim-parity.json` — the SAME file `src/lib/tenant-claim.test.ts:59` reads (no fork); pytest re-run green. |

## Constraint checks (verifier-run)

- **Zero-migration:** `git diff 8432a0b6 HEAD --stat -- supabase/migrations` = **0 files**. PASS.
- **Merge-base confirmed:** `git merge-base HEAD origin/main` = `8432a0b6` (matches AUDIT §4). PASS.
- **REQUIREMENTS.md RATE-01..05 still `- [ ]`** at verification time — execution correctly left ticks to verification. PASS.
- **No Vercel limiter value drift:** empty diff on `src/lib/ratelimit.ts` vs merge-base. PASS.

## Gaps Summary

None blocking. Non-blocking notes (LIGHT-depth, logged not gating):

1. **`/eval`'s Python-side 429 proof is structural, not behavioral** — the dedicated
   drive-to-429 pytest covers `/recompute`; `/eval` is proven by the pinned literal
   decorator set + shared `key_func` + distinct-scope gates (identical decorator pattern).
   Acceptable under LIGHT depth; a dedicated eval throttle test would be a nicety.
2. **Not re-run by verifier:** full pytest suite (SUMMARY/AUDIT §4 claim 5178 passed EXIT=0
   at close-HEAD) and `mypy --strict` (claimed clean, 91 files). Targeted limiter/parity/
   status-contract suites were re-run green. Standing rule: run `mypy --strict` before
   `/ship` regardless.
3. **Standing ship-gate reversal points** (already surfaced in AUDIT §4, not new):
   D-146-1 (no second wrapper) and D-146-4 (zero retunes; 5 founder-queued TODOS
   candidates, incl. the H-1 30× bridge/portfolio-optimizer mismatch and the H-5
   retry-double-spend RECORD-ACCEPT). The ship human gate is the designed checkpoint.

**Verdict: ACHIEVED (all 5 SCs). Recommend ticking RATE-01..05, TS-21, TS-22, TS-36, and TS-23's 146 half.**

---
_Verified: 2026-08-18_
_Verifier: Claude (gsd-verifier), read-only in quantalyze-145 worktree_
