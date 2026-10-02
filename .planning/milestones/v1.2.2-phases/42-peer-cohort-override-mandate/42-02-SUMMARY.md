---
phase: 42-peer-cohort-override-mandate
plan: 02
subsystem: api
tags: [nextjs, route-handler, supabase, rpc, rate-limit, csrf, security, peer-percentile, vitest, tdd]

# Dependency graph
requires:
  - phase: 42-peer-cohort-override-mandate (plan 01)
    provides: get_verified_cohort_rank SECURITY DEFINER RPC (aggregate-only rank vs the verified+published cohort; min-N=20; identity-stripped; decile-quantized)
  - phase: 42-peer-cohort-override-mandate (ADR-0025 / 42-RESEARCH)
    provides: flow (a) decision (POST blend metrics, server returns the rank; distribution never crosses the wire) + the preferences-route auth/approval/rate-limit/no-store/CSRF pattern
provides:
  - POST /api/scenario/peer-rank route handler — auth+approval+CSRF+rate-limit+no-store gated; returns ONLY { peer: PeerPercentilePayload | null }
  - scenarioPeerLimiter (60/60s per user) — a load-bearing probe-resistance rate-limit control
  - the route<->RPC wiring (supabase.rpc("get_verified_cohort_rank", {p_sharpe,p_sortino,p_max_dd=abs(maxDD)})) → PeerPercentilePayload mapping
affects: [42-03+ (composer plumbing — calls this route to populate scenarioPeer), scenario-peer-percentile, factsheet-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Flow (a) rank-only route: the route returns the RPC's 4 aggregate scalars verbatim ({ peer }); the cohort distribution is structurally unreachable from the client (the route never SELECTs it)."
    - "Rate-limit-as-security-control: scenarioPeerLimiter is documented (route + ratelimit.ts) as a LOAD-BEARING probe-resistance control paired with the RPC's decile-quantization, not merely UX throttling."
    - "cast-through-unknown RPC call (csv-finalize / scenario-share precedent): a typed-function cast lets the route call a SECDEF RPC whose database.types.ts entry has not regenerated yet, fully typed at the call boundary, marked for deletion on regen."

key-files:
  created:
    - src/app/api/scenario/peer-rank/route.ts
    - src/app/api/scenario/peer-rank/route.test.ts
  modified:
    - src/lib/ratelimit.ts
    - src/lib/api/limiter-ordering.test.ts

key-decisions:
  - "The 200 response is EXACTLY { peer: PeerPercentilePayload | null } — top-level has only the `peer` key; the peer object has only the 4 fields (cohortSize/sharpe/sortino/max_dd). A test asserts no extra keys (no distribution, no identity)."
  - "p_max_dd = Math.abs(maxDD) — the magnitude convention; max_drawdown is stored negative and the RPC compares on magnitude (queries.ts getPercentiles convention)."
  - "Suppression maps to { peer: null } when: no row, cohort_n < 20, OR any pct column is NULL — belt-and-suspenders on the RPC's NULL-rank row (the NULL pct is the authoritative suppressed signal)."
  - "Body validated (finite sharpe/sortino/maxDD/n) BEFORE checkLimit (B15 validate-then-limit) so a 400 never burns a rate-limit token."
  - "Misconfigured limiter fails CLOSED → 503 (not 429) in production so a missing-Upstash outage surfaces to canary/health rather than masquerading as throttling."
  - "RPC error → structured 500 with a constant message; the raw DB error code is console.error'd, never forwarded (preferences/optimize no-leak discipline)."

patterns-established:
  - "Pattern: the route owns auth+approval+CSRF+rate-limit+no-store; the RPC (plan 01) owns the aggregate + min-N + identity-strip. Together cross-tenant leakage is structurally impossible — only the caller's own rank crosses the wire."
  - "Pattern: every rate-limited route must be classified in the B15 limiter-ordering registry (CANONICAL = validates-then-limits); the closed-by-construction meta-test fails any new unclassified limiter route."

requirements-completed: [PEER-03]

# Metrics
duration: ~25min
completed: 2026-06-26
---

# Phase 42 Plan 02: scenario/peer-rank route Summary

**`POST /api/scenario/peer-rank` (flow a) — ranks the composer's hypothetical blend via the `get_verified_cohort_rank` RPC and returns ONLY `{ peer: PeerPercentilePayload | null }`; auth+approval+CSRF+rate-limit+no-store gated, the cohort distribution never crosses the wire, plus a new load-bearing `scenarioPeerLimiter` (60/60s) probe-resistance control.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-26 (this session)
- **Completed:** 2026-06-26
- **Tasks:** 2 (Task 1 limiter; Task 2 route + test, TDD)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- **`POST /api/scenario/peer-rank` route** — mirrors the preferences/optimize boundary exactly: `assertSameOrigin` (CSRF) → `auth.getUser()` (401) → `assertProfileApproved` (403) → finite-body validation (400, no raw DB error) → `checkLimit(scenarioPeerLimiter)` (429 / 503 fail-CLOSED) → RPC → structured 500. Calls `supabase.rpc("get_verified_cohort_rank", { p_sharpe, p_sortino, p_max_dd: Math.abs(maxDD) })` and returns ONLY `{ peer: PeerPercentilePayload | null }`. NO_STORE_HEADERS on every response path.
- **`scenarioPeerLimiter = makeLimiter(60, "60 s")`** — documented (route + ratelimit.ts) as a LOAD-BEARING probe-resistance security control: it caps an authed allocator scripting unbounded rank calls (egress amplification + a per-peer metric inference oracle), paired with the RPC's decile-quantization.
- **Route test (18 cases)** — 401 unauth, approval-gate denial, non-object/array/non-finite/missing-field/invalid-JSON 400, 429+Retry-After, 503 misconfigured, min-N `{ peer: null }`, empty-rows `{ peer: null }`, full-rank 200 with EXACTLY the 4 fields (no distribution/identity), `p_max_dd=Math.abs` convention, structured 500 (no raw DB), CSRF short-circuit, limiter-after-validate, limiter-wiring. All mock `supabase.rpc`.
- **B15 classification** — registered the route as CANONICAL in `limiter-ordering.test.ts`; the closed-by-construction meta-test confirms it validates-then-limits.

## Task Commits

Each task was committed atomically:

1. **Task 1: add scenarioPeerLimiter** - `ed29c358` (feat)
2. **Task 2 (TDD RED): failing route test** - `298964ac` (test)
3. **Task 2 (TDD GREEN): implement the route** - `bac8a644` (feat)
4. **Task 2 (Rule 3 fix): classify in B15 registry** - `c649b03f` (test)

_(No REFACTOR commit — the GREEN implementation was already clean. The B15 classification is a Rule 3 blocking-fix commit, see Deviations.)_

## Files Created/Modified
- `src/app/api/scenario/peer-rank/route.ts` - The POST handler (flow a, rank-only).
- `src/app/api/scenario/peer-rank/route.test.ts` - The 18-case behavior matrix (mocks supabase rpc; asserts status, headers, body, no-RPC on rejected paths, no-extra-keys on the 200).
- `src/lib/ratelimit.ts` - Added `scenarioPeerLimiter` (60/60s) with a probe-resistance security rationale comment.
- `src/lib/api/limiter-ordering.test.ts` - Classified `scenario/peer-rank/route.ts` as CANONICAL (Rule 3 blocking fix).

## Decisions Made
See frontmatter `key-decisions`. Highlights: the 200 response is exactly `{ peer }` with no extra keys (pinned by a test); `p_max_dd = Math.abs(maxDD)`; suppression to `{ peer: null }` on no-row / cohort_n<20 / any-NULL-pct; validate-then-limit (B15); fail-CLOSED 503; structured 500 (no raw DB).

One implementation decision worth recording: the RPC is **applied to TEST but `database.types.ts` has not regenerated** (type regen is orchestrator-owned, post-apply — see 42-01-SUMMARY). A typed `.rpc("get_verified_cohort_rank", ...)` literal call therefore fails compilation (the function name is absent from the generated `Functions` union). Adopted the established **cast-through-unknown** pattern (`csv-finalize/route.ts` + `allocator/scenario/share/route.ts` precedent): a scoped, documented `supabase.rpc as unknown as (fn, args) => Promise<{data,error}>` cast that types the call boundary fully (no `any`, no `never`), with a "delete when types regenerate" note. This is a codebase-conventional handling of an un-regenerated RPC, not a deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Classify the new route in the B15 limiter-ordering registry**
- **Found during:** Task 2 (the `npm run test:coverage` gate)
- **Issue:** `src/lib/api/limiter-ordering.test.ts` is a closed-by-construction backstop: every rate-limited route MUST be classified in exactly one bucket. The new `scenario/peer-rank/route.ts` consumed a limiter without a classification, failing the "no unclassified limiter route" meta-test. This failure is directly caused by this task's new route.
- **Fix:** Added `"scenario/peer-rank/route.ts"` to the `CANONICAL` set (next to its sibling `scenario/optimize/route.ts`). The route validates the finite body BEFORE `checkLimit`, so it is correctly CANONICAL — the per-method ordering check (test 4) and the helper-extraction guard (test 5) both pass, confirming validate-then-limit by construction.
- **Files modified:** src/lib/api/limiter-ordering.test.ts
- **Verification:** `npx vitest run src/lib/api/limiter-ordering.test.ts` → 6/6 pass.
- **Committed in:** `c649b03f`

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The B15 classification is mandatory plumbing for any new rate-limited route (the meta-test enforces it). It also independently verifies the route's validate-then-limit ordering. No scope creep.

## Issues Encountered
- **vitest parallel-contention flake (out of scope, NOT my files).** The full `npm run test:coverage` run is non-deterministic on a loaded box: across two runs, the only failures were (run 1) the B15 meta-test (real — fixed above) and (run 2) two UNRELATED files (`AllocationsTabs.scenario-state-preservation`, `factsheet-context.provider`) failing with `TypeError: Failed to parse URL from /api/allocator/scenario/saved` — a relative-URL fetch flake under CPU contention, in files my change does not touch (they hit `/api/allocator/scenario/saved`, not `/api/scenario/peer-rank`). Confirmed: both pass in isolation with `--no-file-parallelism` (8/8). This is the documented `vitest --no-file-parallelism restores green` contention pattern (MEMORY: it does NOT reproduce in CI's sharded `frontend-test`). Per the scope boundary, these pre-existing flaky tests are NOT modified.

## User Setup Required
None - no external service configuration required. (The RPC apply-to-TEST and the production auto-apply are handled by plan 01 / the orchestrator / Supabase Migrate at /ship.)

## Next Phase Readiness
- The server boundary for PEER-03 is complete. A downstream composer plan can now `POST /api/scenario/peer-rank` with the blend's sample-basis `{ sharpe, sortino, maxDD, n }` and plumb the returned `PeerPercentilePayload` into `scenarioPeer` on the synth csv payload.
- **Note for the next plan:** the route's `cast-through-unknown` RPC call should be replaced with a typed literal `.rpc(...)` once `database.types.ts` is regenerated post-apply (the cast carries a "delete when types regenerate" marker).
- The live arm of `verified-cohort-rank-rls.test.ts` (plan 01) and any future route-level integration test will exercise the real RPC once TEST has the migration applied.

## Verification Evidence
- `test -f` both created files → present; route exports `POST`; test file present.
- `grep` confirms: `scenarioPeerLimiter` exported in ratelimit.ts; `rpc(...get_verified_cohort_rank` + `p_max_dd: Math.abs` + `cohortSize`/`PeerPercentilePayload` in route.ts.
- `npx vitest run src/app/api/scenario/peer-rank/route.test.ts` → **18 passed**.
- `npx vitest run "src/app/api/scenario/"` → **18 passed**.
- `npx vitest run src/lib/api/limiter-ordering.test.ts` → **6 passed**.
- `npx tsc --noEmit` → clean (exit 0).
- `npx eslint` route.ts + route.test.ts + ratelimit.ts → clean (exit 0).
- `npm run test:coverage` → coverage thresholds satisfied: lines 84.42 (gate 82), statements 82.28 (gate 80), functions 77.99 (gate 74), branches 74.75 (gate 72). The only run failures were the B15 meta-test (fixed) and 2 unrelated contention flakes (green in isolation — see Issues).

## Self-Check: PASSED
- FOUND: `src/app/api/scenario/peer-rank/route.ts` (on disk + in commit bac8a644)
- FOUND: `src/app/api/scenario/peer-rank/route.test.ts` (on disk + in commit 298964ac)
- FOUND: `src/lib/ratelimit.ts` scenarioPeerLimiter (in commit ed29c358)
- FOUND: `src/lib/api/limiter-ordering.test.ts` classification (in commit c649b03f)
- FOUND: commits ed29c358, 298964ac, bac8a644, c649b03f in git log
- 0 `.planning/` files committed (gitignored ledger correctly excluded); the untracked `docs/architecture/adr-0025-scenario-peer-carveout.md` was NOT committed (pre-existing, not this plan's artifact)

---
*Phase: 42-peer-cohort-override-mandate*
*Completed: 2026-06-26*
