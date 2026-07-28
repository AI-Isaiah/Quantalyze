---
phase: 140-seam-shared-resilience-core-circuit-breaker
plan: 02
subsystem: infra
tags: [seam, circuit-breaker, timeout-budgets, analytics-client, process-key-client, vitest, mutation-testing]

# Dependency graph
requires:
  - phase: 140-01
    provides: "resilientFetch(budgetKey, path, init), SEAM_BUDGETS, CircuitOpenError leaf, fake-Upstash test doubles"
provides:
  - "analyticsRequest() delegates every call to the ONE core with a REQUIRED per-call-site budgetKey (9 wrappers mapped)"
  - "postProcessKey() delegates to the core with the enqueue/sync budget split mirroring the server's _is_long_fetch"
  - "SEAM-04 client layer: the 503 CIRCUIT_OPEN envelope + Retry-After, inherited by all 5 Mechanism-B routes"
  - "analytics-client re-exports CircuitOpenError (back-compat convenience ONLY; canonical path stays @/lib/seam-errors)"
  - "src/lib/resilient-fetch.wiring.test.ts — SC-1c ONE-core proof + X-Service-Key/X-User-Id byte-for-byte guards"
  - "SD-CRITICAL-01 guard relocated to the core and hardened with a raw-fetch tripwire on both clients"
affects: [140-04 wizardErrors CIRCUIT_OPEN classification, 140-05 route error mapping + OPTIMIZER_TIMEOUT_MS removal, 140-06 third seam, 140-07 no-raw-analytics-fetch ESLint rule, 141 retry]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies — locked constraint honoured
  patterns:
    - "Spy-WRAPS-actual partial module mock: the core spy defaults to delegating to the real resilientFetch, so pre-existing full-path tests in the same file keep passing unmodified while new tests can read the budgetKey and inject failures"
    - "Raw-fetch tripwire: a rejecting global fetch stub plus an explicit not.toHaveBeenCalled() turns 'the client bypassed the core' from an invisible regression into a loud one"
    - "Guard tests follow the invariant, not the file: when a deadline moves modules, the file-scanning guard moves with it and gains a bypass check, rather than being deleted or pinned to the old literal"

key-files:
  created:
    - src/lib/resilient-fetch.wiring.test.ts
  modified:
    - src/lib/analytics-client.ts
    - src/lib/analytics-client.test.ts
    - src/lib/process-key-client.ts
    - src/lib/process-key-client.test.ts
    - src/__tests__/critical-regressions.test.ts

key-decisions:
  - "The abort-shape guard is (Error || DOMException), not the plan's literal `instanceof Error` — jsdom's DOMException does NOT extend Error, so the plan's check silently reclassified every timeout as 'not reachable' under vitest and broke the pre-existing :385 regression test"
  - "analyticsRequest's `options` parameter became REQUIRED (was optional) because budgetKey is required; the function is module-private, so no public signature moved"
  - "runPortfolioOptimizer keeps honouring its optional timeoutMs as timeoutMsOverride rather than dropping it — 140-05 owns deleting the route-side OPTIMIZER_TIMEOUT_MS"
  - "SD-CRITICAL-01's file-scanning guard was RELOCATED to resilient-fetch.ts and extended with a per-client raw-fetch check, preserving the audit invariant instead of deleting a now-false assertion"
  - "Both wiring directions mutation-verified: reverting either client to a raw fetch fails 3 of the 5 SC-1c tests"

patterns-established:
  - "Assert error passthrough by object IDENTITY (toBe), not instanceof — identity cannot be satisfied by a re-wrapped look-alike and is immune to the post-resetModules class-duplication artifact"
  - "Env-before-import discipline for module-scope-captured secrets: set env -> vi.resetModules() -> dynamic import, with the ordering hazard documented inline"

requirements-completed: [SEAM-01, SEAM-04]

# Metrics
duration: 22min
completed: 2026-07-25
---

# Phase 140 Plan 02: Seam Client Adaptation + CIRCUIT_OPEN Envelope Summary

**Both Vercel→Railway chokepoints now delegate transport to the ONE resilience core with per-call-site budget keys, `postProcessKey` gained the locked 503 `CIRCUIT_OPEN` envelope that all five Mechanism-B routes inherit for free, and SC-1c spy-proves the wiring in both directions — 8755 tests green with zero public-signature changes.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 3/3
- **Files created:** 1 · **Files modified:** 5

## Accomplishments

- **SEAM-01, Mechanism A.** `analyticsRequest()` lost its `ANALYTICS_URL` constant, its `AbortSignal.timeout` line and its `DEFAULT_TIMEOUT_MS`. All nine wrappers now name their row in `SEAM_BUDGETS`; the two hardcoded `timeoutMs: 15_000` literals are gone. What stayed in the client is exactly what is client policy: header construction, the API-version drift warning, and the `!ok` → `AnalyticsUpstreamError` translation the core deliberately does not perform.
- **SEAM-01, Mechanism B.** `postProcessKey()` delegates with a budget SPLIT rather than the blanket 60s: `{resync, onboard}` → `process-key-enqueue` (15s), `{teaser, csv}` → `process-key-sync` (60s), mirroring `analytics-service/routers/process_key.py:_is_long_fetch`. A sick Railway now stops holding a Vercel concurrency slot 45s longer than necessary on the two enqueue paths.
- **SEAM-04 client layer.** The 503 `CIRCUIT_OPEN` arm is FIRST in the catch, ahead of the timeout and network arms, with the locked five-field envelope and `Retry-After: String(err.retryAfterS)`. All five Mechanism-B routes (`keys/sync`, `verify-strategy`, `finalize-wizard`, `csv-validate`, `csv-finalize`) inherit it through their existing `result.response` passthrough — zero route edits required in this plan.
- **The error taxonomy got strictly broader, not different.** `CircuitOpenError` propagates unwrapped; the abort check now catches a plain `Error` named `AbortError` in addition to the `DOMException`/`TimeoutError` shape it always caught. The pre-existing `:385` DOMException regression test passes UNMODIFIED, which is what proves the change is a superset rather than a swap.
- **SC-1c is mutation-verified, not merely green.** Reverting `analytics-client` to a raw fetch fails 3 of 5 wiring tests; reverting `process-key-client` fails a different 3 of 5. `grep -c MUTANT` confirms zero residue in both files, and `git status` showed no modified tracked files after the reverts.
- **Zero regressions in the 16 mock-based route tests**, all untouched.

## Task Commits

1. **Task 1 (TDD): analyticsRequest → the core** — `51acdd6c` (test, RED) → `4239d2b2` (feat, GREEN)
2. **Task 2 (TDD): postProcessKey → the core + CIRCUIT_OPEN** — `c86d2b60` (test, RED) → `0082d535` (feat, GREEN)
3. **Task 3: SC-1c wiring proof** — `16871f2a` (test)

**Plan metadata:** not committed — `.planning/**` is gitignored (`.gitignore:52`); this SUMMARY lives in the working tree only, per the main-tree execution mode for this run.

## Files Created

- `src/lib/resilient-fetch.wiring.test.ts` — 5 tests. Header states WHY the file exists (grepping for `AbortSignal.timeout` proves a negative; this proves the positive), documents the env-before-import hazard, and names both header-forwarding threats it guards.

## Files Modified

- `src/lib/analytics-client.ts` — delegation, required `budgetKey`, three-arm catch, `CircuitOpenError` re-export with a comment stating it must never be relied on through a mock.
- `src/lib/process-key-client.ts` — delegation, `budgetKeyFor()` with a citation to the Python source of the split, `CIRCUIT_OPEN_HUMAN_MESSAGE` as a named static constant, timeout log line now reporting the resolved budget instead of a hardcoded "60s".
- `src/lib/analytics-client.test.ts` — 4 new tests; the two `__INTERNAL_analyticsRequest` helpers updated for the required `budgetKey`.
- `src/lib/process-key-client.test.ts` — 7 new tests; the 2 pre-existing header tests unmodified and still exercising the full path to `global.fetch`.
- `src/__tests__/critical-regressions.test.ts` — SD-CRITICAL-01 guard relocated and hardened (see Deviations).

## Acceptance Criteria

| Criterion | Result |
|---|---|
| `grep -c "AbortSignal.timeout" src/lib/analytics-client.ts` | 0 |
| `grep -c "ANALYTICS_SERVICE_URL" src/lib/analytics-client.ts` | 0 |
| `grep -c "timeoutMs: 15_000" src/lib/analytics-client.ts` | 0 |
| `grep -c "seam-errors" src/lib/analytics-client.ts` | 2 |
| `grep -c "CIRCUIT_OPEN" src/lib/process-key-client.ts` | 3 |
| `grep -c "AbortSignal.timeout" src/lib/process-key-client.ts` | 0 |
| `grep -c "ANALYTICS_SERVICE_URL" src/lib/process-key-client.ts` | 0 |
| `grep -c "seam-errors" src/lib/process-key-client.ts` | 1 |
| Exported wrapper signatures | `git diff \| grep "^[-+]export.*function"` → EMPTY |
| `PostProcessKeyArgs` / `PostProcessKeyResult` | byte-identical |
| `npm test` | 690 files, 8755 passed, 0 failed |
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors (1 pre-existing `EquityChart.tsx` warning, untouched) |
| Node 22 CI parity | 193/193 green on the 5 seam files |

## Decisions Made

1. **The abort-shape guard accepts `Error` OR `DOMException`.** The plan specified `err instanceof Error && (name === "AbortError" \|\| name === "TimeoutError")`. Node's `DOMException` extends `Error`, so that reads correct — but **jsdom's does not**, and jsdom is the vitest environment. Implemented literally it broke the pre-existing `:385` regression test, which is precisely the acceptance criterion that says that test must pass unmodified. See Deviation 1.
2. **`analyticsRequest`'s options parameter is now required.** `budgetKey` has no defensible default: guessing one would silently re-introduce the single blanket budget SEAM-02 exists to end. The function is module-private (only `__INTERNAL_analyticsRequest` escapes, for OBSERV-01 tests), so no public signature moved.
3. **`runPortfolioOptimizer` keeps its `timeoutMs` parameter.** Dropping it would change a public signature this plan froze. It is threaded as `timeoutMsOverride`; the route's value happens to equal the table's, so behaviour is identical today and 140-05 removes the route-side constant.
4. **The core spy WRAPS the real `resilientFetch` by default in `process-key-client.test.ts`.** A replacing mock would have forced edits to the two pre-existing header tests (they read `global.fetch.mock.calls`), which the plan forbids. Wrapping lets the old tests keep exercising the full path while the new ones read the budgetKey.
5. **Passthrough asserted by identity, not `instanceof`.** `expect(caught).toBe(tripped)` cannot be satisfied by a re-wrapped look-alike, and it sidesteps the post-`vi.resetModules()` class-duplication artifact 140-01 documented.
6. **The core's own `deadlineExceeded` log classifier was NOT touched.** It has the same `instanceof Error` narrowness, but there it selects only a LOG STRING — both branches record the failure and rethrow identically — and it is correct in the Node production runtime. Editing 140-01's file to fix a test-environment log label is scope creep against 24 passing tests. Noted here so it is a recorded choice rather than an oversight.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's literal abort-shape guard broke the regression test the plan requires to stay green**

- **Found during:** Task 1 (GREEN)
- **Issue:** The plan's action specifies `err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")`. jsdom's `DOMException` does not extend `Error`, so `new DOMException("aborted", "TimeoutError")` — the shape `AbortSignal.timeout` rejects with, and the shape the pre-existing test at `analytics-client.test.ts:385` uses — fell through to the generic "not reachable" arm. The pre-140 code caught it via `err instanceof DOMException`. Under the plan as written, the retrofit was a NARROWING for the exact case the original check existed to handle, and it looked correct in production (Node's DOMException does extend Error) while failing only under test.
- **Fix:** `(err instanceof Error || err instanceof DOMException) && (name === "AbortError" || name === "TimeoutError")` — a strict superset of both the old check and the plan's. The same widening was applied to `process-key-client`'s `isAbort` for consistency (it had the same latent narrowness, pre-existing).
- **Files modified:** `src/lib/analytics-client.ts`, `src/lib/process-key-client.ts`
- **Verification:** the untouched `:385` DOMException test and the new plain-`AbortError` test both pass. The rationale is comment-documented at the call site so a future reviewer does not "simplify" it back.
- **Committed in:** `4239d2b2`, `0082d535`

**2. [Rule 3 - Blocking issue] SD-CRITICAL-01's file-scanning guard asserted the deadline lived in a file it no longer lives in**

- **Found during:** Task 3 (full-suite run)
- **Issue:** `src/__tests__/critical-regressions.test.ts:103` reads `analytics-client.ts` from disk and requires `/AbortSignal\.timeout|new AbortController|signal\s*:/`. Moving the deadline into the core is the whole point of SEAM-01, so the guard failed — but the INVARIANT it encodes ("no seam call may be unbounded") is still exactly right and still worth guarding. Deleting it, or weakening it to a substring that happens to survive, would have retired a CRITICAL-audit guard as collateral.
- **Fix:** Relocated the assertion to `src/lib/resilient-fetch.ts` (which does own the abort signal) and ADDED a per-client check that both clients call `resilientFetch(` and contain no raw `fetch(`. The guard is now strictly stronger than before: it catches both "the deadline vanished" and "a client bypassed the core", where previously it caught only the first, and only for one of the two clients.
- **Files modified:** `src/__tests__/critical-regressions.test.ts`
- **Verification:** 124/124 green. The bypass regex was unit-checked against five inputs including `globalThis.fetch(` (must match) and `resilientFetch(` / `installFetchMock(` (must not).
- **Committed in:** `16871f2a`

---

**Total deviations:** 2 auto-fixed (1× Rule 1, 1× Rule 3). No Rule 4 architectural decisions, no scope creep — both are correctness fixes inside files this plan already owns or already broke.

## Issues Encountered

- **Mutation verification, both directions.** The SC-1c test is the plan's "test the wiring, not just the helper" artifact, so a passing run is not evidence it would catch a bypass. Each client was temporarily rewritten to call `fetch()` directly against a hardcoded URL; each mutant failed 3 of the 5 wiring tests (a different 3, correctly partitioned by client, with the "both clients route through the SAME core" test failing under either). Both were restored from pre-mutation copies; `grep -c MUTANT` = 0 in both files and `git status` showed no modified tracked files.
- **CI-parity run performed.** `PATH=/opt/homebrew/opt/node@22/bin` (Node v22.22.1, the CI version): 193/193 green across the five seam-touching test files, matching local Node 25. Every new describe unstubs globals in `afterEach`, addressing this repo's known CI-only failure cause.
- **A `[resilient-fetch] Upstash not configured` notice now appears in the stderr of `analytics-client.test.ts` and `process-key-client.test.ts`.** Expected and harmless: UPSTASH env vars are unset under vitest, so `redis` is `null`, the breaker is inert and no network call is made. The core emits exactly one notice per module load, never per request.
- **No client-bundle risk from the new import.** `analytics-client` and `process-key-client` now transitively import `@upstash/*` via the core. Every `"use client"` file mentioning either module was checked: both hits (`CsvValidationEnvelope.tsx`, `usage-events-client.ts`) are comment references, not imports. This is exactly why `CircuitOpenError` lives in the dependency-free leaf and why 140-04 must import it from there.

## Threat Flags

None. All security-relevant surface is already enumerated in the plan's `<threat_model>`:

- **T-140-07** (header forwarding) — mitigated and now TESTED: the wiring test asserts `X-Service-Key`, `X-User-Id`, `Authorization: Bearer …` and `cache: "no-store"` reach the core byte-for-byte.
- **T-140-08** (envelope copy) — mitigated: `CIRCUIT_OPEN_HUMAN_MESSAGE` is a named static constant, and a test asserts the rendered `human_message` matches none of `/circuit|upstash|railway|http|localhost/i`.
- **T-140-09** (log lines) — mitigated: the new log lines carry `routeTag`, `correlation_id` and `retry_after_s` only. No request body, no header value, no `args.context`.
- **T-140-10** (signature drift) — mitigated: `git diff | grep "^[-+]export.*function"` is empty, `PostProcessKeyArgs`/`PostProcessKeyResult` are byte-identical, and all 16 mock-based route tests pass untouched.

No new endpoint, auth path, file-access pattern or schema change was introduced.

## Known Stubs

None. Every arm of both clients is implemented and test-pinned.

Two items are deliberately deferred to later plans in this phase, per the plan's own scope, and are NOT stubs:

- The five Mechanism-B routes inherit `CIRCUIT_OPEN` automatically, but the nine Mechanism-A routes still surface `CircuitOpenError` as an unhandled throw → **140-05** owns their error mapping.
- `wizardErrors.ts` does not yet classify `CIRCUIT_OPEN` → **140-04** owns it (import the class from `@/lib/seam-errors`, never from `analytics-client` or `resilient-fetch`).

## Next Phase Readiness

**Ready.**

- **140-04** — `CircuitOpenError` is importable from `@/lib/seam-errors` with zero transitive deps. Do NOT import it from `analytics-client` (that re-export drags `@upstash/*` in) nor from `resilient-fetch`.
- **140-05** — `runPortfolioOptimizer`'s `timeoutMs` parameter and `portfolio-optimizer/route.ts:14 OPTIMIZER_TIMEOUT_MS` are both still present and both now redundant with `SEAM_BUDGETS["portfolio-optimizer"]`; deleting the pair is a clean two-line change. Nine Mechanism-A routes need the `CircuitOpenError` → 503 arm.
- **140-06** — the third seam has its budget key (`keys-permissions`) waiting in the table; the wiring-test shape in `resilient-fetch.wiring.test.ts` is directly reusable.
- **140-07** — the `no-raw-analytics-fetch` ESLint rule now has zero pre-existing violations in either client to grandfather. `critical-regressions.test.ts` already enforces a coarse version of the same rule on those two files, which is a useful backstop if the lint rule is ever disabled.
- **Carry-over note for a reviewer:** `resilient-fetch.ts:548`'s `deadlineExceeded` classifier retains the `instanceof Error`-only narrowness described in Decision 6. It affects a log string only. If 140-06 or 141 touches that file for another reason, widening it to `(Error || DOMException)` is a one-line freebie.

---
*Phase: 140-seam-shared-resilience-core-circuit-breaker*
*Completed: 2026-07-25*

## Self-Check: PASSED

- All 3 source artifacts exist on disk (`src/lib/analytics-client.ts`, `src/lib/process-key-client.ts`, `src/lib/resilient-fetch.wiring.test.ts`).
- All 5 task commits exist in git (`51acdd6c`, `4239d2b2`, `c86d2b60`, `0082d535`, `16871f2a`) on `feat/v1.16-production-resilience`.
- `git diff --diff-filter=D --name-only 5a6e11a1 HEAD` → empty: no file deletions in this plan.
- Working tree clean apart from one pre-existing untracked file (`analytics-service/scripts/nautilus_factsheet.py`) that predates this plan and was not touched.
- `npm test` → 690 files / 8755 tests green, 0 failed. `npm run typecheck` → exit 0. `npm run lint` → 0 errors.
- Node 22 CI-parity run on the 5 seam files → 193/193 green.
- `.planning/**` intentionally NOT staged (gitignored; main-tree execution mode).
