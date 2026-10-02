---
phase: 140-seam-shared-resilience-core-circuit-breaker
plan: 01
subsystem: infra
tags: [upstash, redis, ratelimit, circuit-breaker, abortsignal, vercel-functions, vitest, seam]

# Dependency graph
requires:
  - phase: (none — wave 1, no depends_on)
    provides: pre-installed @upstash/redis 1.38.0 + @upstash/ratelimit 2.0.8 behind src/lib/ratelimit.ts
provides:
  - "src/lib/seam-errors.ts — dependency-free CircuitOpenError leaf (zero imports, zero env reads, zero side effects)"
  - "src/lib/resilient-fetch.ts — SEAM_BUDGETS (13), SEAM_ROUTE_BUDGETS (15), SEAM_EXCLUSIONS (3), breaker constants, isBreakerOpen(), recordSeamFailure(), resilientFetch()"
  - "ANALYTICS_URL is now homed in the core (the only legal base-URL owner, feeds the Wave-4 no-raw-analytics-fetch ESLint rule)"
  - "src/test/helpers/upstash-breaker.ts — importable fake Redis/Ratelimit doubles + seedBreakerOpen for 140-03/140-06"
  - "Verified platform fact: Vercel project default functionDefaultTimeout = 300s (fluid: true)"
affects: [140-02 maxDuration pins + invariant test, 140-03 client adaptation, 140-04 wizardErrors CIRCUIT_OPEN, 140-05 route error mapping, 140-06 third seam, 140-07 ESLint rule, 141 retry]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies — locked constraint honoured
  patterns:
    - "Dependency-free error leaf: error classes shared across the client/server bundle boundary live in a module with zero imports so neither @upstash/* nor server-only side effects can be dragged into the browser bundle, and instanceof survives wholesale vi.mock of the owning client"
    - "Fail-OPEN breaker: every store failure mode (unconfigured client, throwing get, malformed value) resolves to 'proceed' in ALL environments — a deliberate inversion of ratelimit.ts's fail-CLOSED-in-prod matrix, with no environment branch anywhere in the module"
    - "TTL expiry IS the half-open transition — no state machine, no probe scheduler"
    - "Route budget tables declare expectedMaxDurationS; the route files are verified against the table rather than the table assuming a platform default"

key-files:
  created:
    - src/lib/seam-errors.ts
    - src/lib/resilient-fetch.ts
    - src/lib/resilient-fetch.test.ts
    - src/test/helpers/upstash-breaker.ts
  modified: []

key-decisions:
  - "Breaker trips when the sliding-window allowance is EXHAUSTED (!success || remaining <= 0), so the 5th failure opens the circuit rather than the 6th — reconciles Ratelimit.slidingWindow(5) semantics with the plan's 'after 5 failures' truth"
  - "4xx NEVER records a breaker failure (A4, accepted): a user's bad API key returning 400 is Railway working correctly; counting it would let fat-fingered credentials become an outage"
  - "Timeout/network errors are rethrown UNWRAPPED so both clients' existing err.name mapping keeps working in Wave 2"
  - "expectedMaxDurationS = 300 for all 15 seam routes, VERIFIED equal to the live Vercel default (not assumed) — pinning therefore cannot raise worst-case lambda hold"
  - "vi.mock factories do NOT re-run on vi.resetModules() in vitest 4.1.10 (measured); the per-module-context hook is Redis.fromEnv(), not the factory body"

patterns-established:
  - "Test doubles for cross-instance stores are published as an importable helper (src/test/helpers/upstash-breaker.ts) while the vi.hoisted + vi.mock wiring stays per-file"
  - "Negative control + mutation check: a shared-state test must be shown to FAIL when the state is made per-instance"

requirements-completed: [SEAM-02, SEAM-03]

# Metrics
duration: 33min
completed: 2026-07-25
---

# Phase 140 Plan 01: Seam Shared Resilience Core + Circuit Breaker Summary

**Upstash-backed `breaker:railway` circuit breaker that fails OPEN on every store failure mode, plus a 13-entry exported timeout-budget table and a dependency-free `CircuitOpenError` leaf — 24 unit tests green on both Node 25 and CI's Node 22.**

## Performance

- **Duration:** ~33 min
- **Started:** 2026-07-25T16:03Z (approx.)
- **Completed:** 2026-07-25T16:36Z
- **Tasks:** 3/3
- **Files created:** 4 · **Files modified:** 0

## Accomplishments

- **SEAM-02 data layer.** One exported budget table replaces five divergent constants that lived in three different ownership layers (client default 30s, client-hardcoded 15s ×2, route-level `OPTIMIZER_TIMEOUT_MS`, client-hardcoded 60s, and a 15s constant duplicated verbatim across two files). 13 `SEAM_BUDGETS` keys, 15 `SEAM_ROUTE_BUDGETS` routes, 3 reasoned `SEAM_EXCLUSIONS`.
- **SEAM-03 breaker.** `isBreakerOpen()` / `recordSeamFailure()` on a dedicated `Redis.fromEnv()` singleton (not imported from `ratelimit.ts`) with a `prefix: "breaker"` sliding-window counter. Every failure mode of the breaker's own store resolves to "proceed", in production too.
- **`resilientFetch()` engine.** Breaker check → `AbortSignal.timeout(SEAM_BUDGETS[key])` → classified failure recording → original error rethrown unwrapped. Headers, body and `cache` pass through byte-for-byte.
- **The bundle-boundary defence actually holds.** `CircuitOpenError` lives in a leaf with `grep -cE "^import"` = 0, so `wizardErrors.ts` (value-imported by 10 `"use client"` components) can branch on it, and `instanceof` survives the 16 route tests that mock the seam clients wholesale.
- **SC-2 is mutation-verified**, not merely green — see Issues Encountered.

## Task Commits

1. **Task 1: seam-errors leaf + budget table + breaker constants** — `d1f742c9` (feat)
2. **Task 2 (TDD): breaker state functions + shared fake-Upstash helper** — `c3926a45` (test, RED) → `25e5ca30` (feat, GREEN)
3. **Task 3 (TDD): resilientFetch engine** — `0791516d` (test, RED) → `5a6e11a1` (feat, GREEN)

**Plan metadata:** not committed — `.planning/**` is gitignored (`.gitignore:52`); this SUMMARY lives in the working tree only, per the main-tree execution mode for this run.

## Files Created

- `src/lib/seam-errors.ts` — `CircuitOpenError` with `retryAfterS` and a static message. Zero imports, zero `process.env`, zero side effects; the header documents both forcing constraints (browser bundle reachability via `wizardErrors`, and `instanceof` survival under wholesale `vi.mock`).
- `src/lib/resilient-fetch.ts` — the core. Module docstring cites the in-repo precedent `analytics-service/services/job_worker.py:731 _check_circuit_breaker` and lists the five locked decisions so a reviewer does not re-open "missing half-open".
- `src/lib/resilient-fetch.test.ts` — 24 tests: SC-2, SC-2-neg, SC-3a/b/c, SC-4c, plus TTL/`nx`-idempotency/class-identity/header-passthrough coverage.
- `src/test/helpers/upstash-breaker.ts` — `createFakeUpstashStore`, `fakeRedisFor`, `fakeRatelimitFor`, `seedBreakerOpen`, `FAKE_BREAKER_KEY`. Header documents the per-file wiring contract with a worked example.

## Platform-Default Verification (W-2 record — REQUIRED by the plan)

**Observed effective default max duration: `300` seconds.**

Read at 2026-07-25 with Vercel CLI 54.4.1, non-interactively, from the linked project
(`.vercel/project.json` → `prj_hP55l1HOWYv9c9GSs1XF7ZNLpqxZ`, team `team_eujrXl2VWycA9wGJabHk1rcb`):

```
vercel api "/v9/projects/prj_hP55l1HOWYv9c9GSs1XF7ZNLpqxZ?teamId=team_eujrXl2VWycA9wGJabHk1rcb"
```

Relevant response fragment, verbatim:

```json
"defaultResourceConfig": {
  "fluid": true,
  "functionDefaultRegions": ["iad1"],
  "functionDefaultTimeout": 300,
  "functionDefaultMemoryType": "standard",
  "functionZeroConfigFailover": false,
  "elasticConcurrencyEnabled": true
}
```

**Consequence:** the observed default (300) EQUALS the value the plan specified, so
`expectedMaxDurationS: 300` was applied to all 15 routes as written. No route's worst-case
lambda hold is increased by the Wave-2 pins (threat T-140-29 does not fire); `keys/sync`
already exported 300. No operator escalation required.

**SC-4b headroom, computed against the observed default** (`timeoutMs × calls × (1 + SEAM_RETRIES)`,
`SEAM_RETRIES = 0`), worst case first:

| Route | Summed budget | Ceiling | Headroom |
|---|---|---|---|
| `keys/validate-and-encrypt` | 120 000 ms | 300 000 ms | 2.5× |
| `create-with-key`, `composite/add-key` | 60 000 ms | 300 000 ms | 5× |
| `verify-strategy`, `csv-validate`, `csv-finalize` | 60 000 ms | 300 000 ms | 5× |
| `scenario/optimize`, `admin/match/*`, `finalize-wizard` | 30 000 ms | 300 000 ms | 10× |
| `bridge`, `simulator`, `portfolio-optimizer`, `keys/sync`, `keys/[id]/permissions` | 15 000 ms | 300 000 ms | 20× |

All 15 satisfy the invariant. (The assertion itself is 140-02's `seam-budgets.invariant.test.ts`;
the numbers above were computed from the exported tables during Task 1 verification.)

## Decisions Made

1. **Trip on allowance exhaustion, not on denial alone.** `Ratelimit.slidingWindow(5, "30 s")` ALLOWS the 5th call (leaving `remaining === 0`) and denies the 6th, so the plan's literal `success === false` rule would have opened the circuit on the **6th** failure while the plan's own must-have truth says "after 5 seam failures … gets CircuitOpenError". Implemented as `if (success && remaining > 0) return;` — the limiter is still constructed with `slidingWindow(BREAKER_FAILURE_THRESHOLD, BREAKER_WINDOW)` exactly as specified, and denial still trips. Rationale is comment-documented at the call site.
2. **The failure-classification branch differentiates the LOG, not the action.** Both timeout and network throws record and rethrow, so an `if/else` with identical bodies would be noise. The broader `AbortError || TimeoutError` name test is retained (and commented) because it is the check Wave 2's clients must inherit — `analytics-client`'s narrower DOMException-only test misses a plain `AbortError`.
3. **Only `budgetKey` is logged on failure, never `path`.** `match/eval` builds its path with a `partner_tag` query string; keeping the path out of the log line removes any question about the core leaking caller data, at no diagnostic cost.
4. **The test helper duplicates the `"breaker:railway"` literal** rather than importing `BREAKER_KEY` — importing the core from inside a `vi.mock` factory would execute the very module the factory is mocking dependencies for. A dedicated test pins `BREAKER_KEY === FAKE_BREAKER_KEY` so the duplication cannot drift.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Breaker tripped one failure later than the plan's stated behaviour**
- **Found during:** Task 2 (breaker state functions)
- **Issue:** The plan's action says trip "when `success === false`", but `slidingWindow(N)` denies only the (N+1)-th call. Implemented literally, five failures would leave the circuit CLOSED, contradicting the plan's must-have truth and the `BREAKER_FAILURE_THRESHOLD` docstring.
- **Fix:** Trip on `!success || remaining <= 0`. The limiter construction is unchanged from the plan's spec.
- **Files modified:** `src/lib/resilient-fetch.ts`
- **Verification:** `recordSeamFailure trips the breaker once the failure allowance is exhausted` asserts CLOSED after `THRESHOLD - 1` and OPEN after `THRESHOLD`.
- **Committed in:** `25e5ca30`

**2. [Rule 1 - Bug] Test-harness design in 140-RESEARCH.md §10.2 produces a FALSE GREEN negative control**
- **Found during:** Task 3 (making SC-2/SC-2-neg green)
- **Issue:** Research §10.2 states "`vi.mock` factories **re-run** when the registry is reset" and the negative control is built on that. **Measured on vitest 4.1.10: they do not.** A factory incrementing a hoisted counter reports 1 execution both before and after `vi.resetModules()`. The negative control as specified therefore keeps the cached (already-tripped) store in context B, short-circuits, and never fires.
- **Fix:** Bound the per-context store to `Redis.fromEnv()` — which IS invoked once per module-body execution — via a `beginContext()` hook on the hoisted object. The ratelimit double binds to the store `beginContext()` just selected (the core constructs `redis` before `breakerLimiter`, so ordering is deterministic). Both mechanics are documented at the top of the test file so 140-03/140-06 do not re-inherit the wrong model.
- **Files modified:** `src/lib/resilient-fetch.test.ts`
- **Verification:** the negative control now genuinely inverts (context B resolves and fetch IS called); the shared-mode cross-context test stays green.
- **Committed in:** `5a6e11a1`

**3. [Rule 1 - Bug] `instanceof` against a statically imported class fails after `vi.resetModules()`**
- **Found during:** Task 3
- **Issue:** `rejects.toBeInstanceOf(CircuitOpenError)` using the file's top-level import failed even though the correct error was thrown — the reset registry re-evaluated `seam-errors`, minting a second class object. This is a harness artifact (production has one registry), but silently mis-asserting it would have masked a real regression later.
- **Fix:** Assert against the same-registry namespace (`b.CircuitOpenError`), and add a dedicated test pinning the invariant that actually ships: `mod.CircuitOpenError === leaf.CircuitOpenError` (the core's re-export is an alias, not a second definition).
- **Files modified:** `src/lib/resilient-fetch.test.ts`
- **Verification:** `re-exports the leaf's CircuitOpenError class identity` green.
- **Committed in:** `5a6e11a1`

**4. [Rule 1 - Bug] Leaked `throwOnLimit` flag silently disabled the failure counter for every later test**
- **Found during:** Task 3
- **Issue:** `beforeEach` reset `sharedStore` and `throwOnGet` but not `throwOnLimit`. The `swallows store errors` test set it, so every subsequent test ran with a permanently-rejecting limiter — which made the 4xx "does not trip" assertion pass for entirely the wrong reason.
- **Fix:** Reset all three flags in `beforeEach`, with a comment naming the failure mode.
- **Files modified:** `src/lib/resilient-fetch.test.ts`
- **Verification:** with the reset in place, the 5xx / timeout / network tests correctly trip while the 4xx test still does not.
- **Committed in:** `5a6e11a1`

**5. [Rule 3 - Blocking issue] Vacuous assertion in the store-error test**
- **Found during:** Task 2
- **Issue:** The first draft asserted `errorSpy.mock.calls.length).toBeGreaterThanOrEqual(0)` — unfalsifiable, and its `throwOnGet` setup did not even reach `recordSeamFailure`'s code path.
- **Fix:** Added a `throwOnLimit` failure mode to the double and asserted the real contract: resolves undefined, logs, and leaves no open-lock.
- **Files modified:** `src/lib/resilient-fetch.test.ts`, committed as part of the RED gate `c3926a45` and exercised by `25e5ca30`.

---

**Total deviations:** 5 auto-fixed (1× Rule 2, 3× Rule 1, 1× Rule 3).
**Impact on plan:** No scope creep — all five are correctness fixes inside the plan's own files. Deviation 2 is the material one: it invalidates a stated technique in `140-RESEARCH.md` §10.2 that plans 140-03 and 140-06 are expected to reuse. **The corrected model is documented in `src/lib/resilient-fetch.test.ts`'s header and should be treated as superseding §10.2.**

## Issues Encountered

- **SC-2 was mutation-verified before being accepted.** Passing tests are not evidence that a shared-state invariant is enforced, so the core was temporarily mutated to keep breaker state in a module-scope `let` (with the Redis write neutralised). The cross-context test failed under the mutant and passes against the real implementation; the mutation was reverted from a pre-mutation copy and `grep -c MUTANT` confirms zero residue.
- **CI-parity run performed.** The suite was re-run under `PATH=/opt/homebrew/opt/node@22/bin` (Node v22.22.1, the CI version): 24/24 green, matching local Node 25. `vi.unstubAllGlobals()` runs in `afterEach`, addressing the repo's known CI-only failure cause.
- **`npm run lint`** reports 0 errors (the one pre-existing `EquityChart.tsx` `react-hooks/exhaustive-deps` warning is untouched and out of scope). `npm run typecheck` exits 0.

## Threat Flags

None. All security-relevant surface introduced by this plan is already enumerated in the plan's `<threat_model>` (T-140-01 constant breaker key, T-140-02 fail-OPEN, T-140-03 4xx exclusion, T-140-04 no body/header logging, T-140-05 static error message, T-140-28 leaf with zero imports, T-140-29 maxDuration verification). No new endpoint, auth path, file access pattern, or schema change was introduced — this plan adds two library modules and one test helper, with zero call sites wired.

## Known Stubs

None. Every export in this plan is fully implemented and unit-proven. `SEAM_RETRIES = 0` is a deliberate, documented constant (Phase 141 owns retry), not a stub, and the SC-4b invariant is written to tighten automatically when it changes.

Two exports have no production caller **yet**, by plan design — Wave 2 (140-03/140-05/140-06) wires them:
`resilientFetch()` and the `SEAM_ROUTE_BUDGETS` / `SEAM_EXCLUSIONS` tables (140-02 consumes the latter in the invariant test). This is the plan's stated output ("No client or route is adapted yet"), not deferred work.

## User Setup Required

None — zero new dependencies, zero new environment variables. The breaker is inert wherever Upstash is unconfigured (it logs one notice at module load and passes all traffic through), which is exactly the state of local dev and CI today.

## Next Phase Readiness

**Ready for Wave 2.**

- `140-02` (maxDuration pins + `seam-budgets.invariant.test.ts`): the observed platform default is recorded above and `expectedMaxDurationS` is 300 across all 15 routes. Only `keys/sync` currently exports `maxDuration`; the other 14 need the pin.
- `140-03` / `140-06` (client + third-seam adaptation): import the doubles from `src/test/helpers/upstash-breaker.ts`. **Read the header of `src/lib/resilient-fetch.test.ts` first** — the `vi.mock`-factory model in `140-RESEARCH.md` §10.2 is wrong for vitest 4.1.10 and will produce a false green if copied.
- `140-04` (wizardErrors): import `CircuitOpenError` from `@/lib/seam-errors` — **never** from `@/lib/resilient-fetch`, or `@upstash/*` enters the client bundle.
- **Concern for Wave 2:** `resilientFetch` returns non-2xx responses rather than throwing. `analyticsRequest()` currently throws `AnalyticsUpstreamError` on `!res.ok`, so the adaptation must keep that translation in the client, not expect it from the core.

---
*Phase: 140-seam-shared-resilience-core-circuit-breaker*
*Completed: 2026-07-25*

## Self-Check: PASSED

- All 4 source artifacts exist on disk (`seam-errors.ts`, `resilient-fetch.ts`, `resilient-fetch.test.ts`, `test/helpers/upstash-breaker.ts`).
- All 5 task commits exist in git (`d1f742c9`, `c3926a45`, `25e5ca30`, `0791516d`, `5a6e11a1`) on `feat/v1.16-production-resilience`.
- Working tree clean apart from one pre-existing untracked file (`analytics-service/scripts/nautilus_factsheet.py`) that predates this plan and was not touched.
- `npx vitest run src/lib/resilient-fetch.test.ts --no-file-parallelism` → 24/24 green on Node 25 AND Node 22.
- `npm run typecheck` → exit 0. `npm run lint` → 0 errors.
- Seam-adjacent regression (`analytics-client.test.ts`, `process-key-client.test.ts`, `ratelimit.test.ts`) → 54/54 green.
