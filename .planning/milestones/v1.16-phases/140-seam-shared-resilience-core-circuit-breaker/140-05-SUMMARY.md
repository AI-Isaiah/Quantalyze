---
phase: 140-seam-shared-resilience-core-circuit-breaker
plan: 05
subsystem: api
tags: [seam, circuit-breaker, class-3-cascade, maxDuration, budget-single-source, vitest, mutation-testing]

# Dependency graph
requires:
  - phase: 140-01
    provides: "CircuitOpenError leaf (@/lib/seam-errors), resilientFetch(budgetKey, path, init), SEAM_BUDGETS + SEAM_ROUTE_BUDGETS (expectedMaxDurationS 300, platform-verified)"
  - phase: 140-02
    provides: "analyticsRequest()/postProcessKey() delegating to the core; CircuitOpenError propagated unwrapped; runPortfolioOptimizer's timeoutMs left in place for this plan to remove"
  - phase: 140-03
    provides: "The Class-1 retrofit shape: breaker arm first, Retry-After spread onto NO_STORE_HEADERS, maxDuration comment block"
provides:
  - "SEAM-04 Class-3 CLOSED: all five routes (bridge, simulator, scenario/optimize, portfolio-optimizer, keys/validate-and-encrypt) map CircuitOpenError→503+Retry-After with static copy in their own body shape"
  - "portfolio-optimizer refunds its rate-limit token on the breaker arm (R-0002 consistency)"
  - "SEAM-02: the LAST route-local seam budget is gone — runPortfolioOptimizer's timeoutMs parameter deleted with its only caller; SEAM_BUDGETS is now the sole owner of every production deadline"
  - "The last timeout-LESS Vercel→Railway fetch (the dormant _unifiedValidateAndEncryptHandler) routed through the core"
  - "src/app/api/scenario/optimize/route.test.ts — first-ever coverage for a route that shipped in Phase 28 with none"
  - "Five more maxDuration=300 pins, VERIFIED present in the build's functions-config manifest"
affects: [140-06 third seam, 140-07 no-raw-analytics-fetch ESLint rule (now zero violations to grandfather), SC-4a seam-budgets.invariant.test which will find 9 of 15 routes pinned]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies — locked constraint honoured
  patterns:
    - "When the new arm shares a status with an existing one, assert the DISCRIMINATOR (Retry-After header + distinct copy), never the status alone — portfolio-optimizer's generic arm is already a 503, so a status-only test would have passed before the arm existed"
    - "Breaker arm placed FIRST in the catch also hardens the test file: under a missing-shim mutant the CIRCUIT_OPEN case still passes because it returns before reaching an undefined instanceof"
    - "Prose that quotes the token a guard grep forbids defeats the guard — comments now name removed constants descriptively and say why the literal is withheld"

key-files:
  created:
    - src/app/api/scenario/optimize/route.test.ts
  modified:
    - src/app/api/bridge/route.ts
    - src/app/api/bridge/route.test.ts
    - src/app/api/simulator/route.ts
    - src/app/api/simulator/route.test.ts
    - src/app/api/scenario/optimize/route.ts
    - src/app/api/portfolio-optimizer/route.ts
    - src/app/api/portfolio-optimizer/route.test.ts
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/lib/analytics-client.ts

key-decisions:
  - "runPortfolioOptimizer's timeoutMs PARAMETER was deleted, not just the route's constant — the plan's prose said 'replace the constant with a read of SEAM_BUDGETS', which would have kept a redundant override alive; 140-02's own code comment had already scheduled the parameter for deletion here"
  - "The breaker arm is placed FIRST among the typed arms (140-03's convention and process-key-client's), which also satisfies the plan's 'before the generic arm'"
  - "No captureToSentry on any breaker arm: a trip is one shared infrastructure fact, so capturing would emit an event per request for the whole cooldown window. console.error is the operator channel"
  - "CIRCUIT_OPEN_COPY is a per-route local constant, byte-identical across all five and to process-key-client's CIRCUIT_OPEN_HUMAN_MESSAGE — 140-03's decision 5 carried forward"
  - "Both dormant/dead exports were preserved per operator decisions 5 and 6 (_unifiedValidateAndEncryptHandler, computePortfolioAnalytics); only the unread base-URL constant was removed"

patterns-established:
  - "Two-mutant verification for a from-scratch test file: remove the feature (expect exactly the feature's case to fail) AND remove the harness assumption the file header claims is load-bearing (expect the cascade the header predicts)"

requirements-completed: [SEAM-02, SEAM-04]

# Metrics
duration: 18min
completed: 2026-07-25
---

# Phase 140 Plan 05: Class-3 Cascade Retrofit Summary

**All five Class-3 routes now answer a tripped Railway breaker with a typed 503 + `Retry-After` instead of cascading into their generic 500/502/503 arms, the optimizer's route-local budget and its now-orphaned client parameter are gone so `SEAM_BUDGETS` owns every production deadline, and the codebase's last timeout-less Vercel→Railway fetch was routed through the core — 8797 tests green.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 3/3
- **Files created:** 1 · **Files modified:** 10

## Accomplishments

- **SEAM-04 Class-3 closed (SC-5c).** Five routes, five typed arms: `CircuitOpenError` → 503, `Retry-After: String(err.retryAfterS)`, static copy in each route's own body shape (`{error}` for four, `{status, suggestions, error}` for the optimizer). Every arm sits INSIDE its handler, after that handler's auth/approval/ownership gates, so breaker state never becomes an unauthenticated oracle (T-140-20).
- **The optimizer's breaker arm needed more than a status.** Its pre-existing generic arm ALSO returns 503, so a status-only test would have passed before the arm existed. What actually separates the two — a `Retry-After` cooldown and distinct copy — is what the test asserts, and the RED run confirmed it (`expected null to be '9'`).
- **The token refund follows the route's own documented policy, not a new one.** portfolio-optimizer already refunds its 5/min token on both upstream-failure arms under red-team R-0002. A breaker trip is the purest instance of "the failure is upstream of the caller" — the request never left Vercel — so charging for it would burn a legitimate user's entire budget during a Railway outage. Spy-asserted.
- **SEAM-02's last production leak sealed.** The route-local 15s optimizer constant is gone AND so is `runPortfolioOptimizer`'s `timeoutMs` parameter, whose only caller it was. A route-local value silently WINS over the table whenever the two disagree, which is exactly the drift the table exists to end; a test now pins that the route passes no override at all (`optimizerCalls[0].ms` is `undefined`).
- **The last unbounded seam call is bounded.** `_unifiedValidateAndEncryptHandler`'s raw `fetch` had no timeout of any kind. It is dormant (zero callers), which is *why* it was worth routing through the core rather than ignoring: whoever revives it now inherits a budget and the breaker automatically instead of re-introducing a hang that holds a Vercel concurrency slot to the function ceiling. The handler itself is preserved (operator decision 5); only its unread base-URL constant went.
- **On validate-and-encrypt the cascade was worse than a wrong status.** A breaker trip surfaced as `"Key validation failed. Please try again."` — telling a user their CREDENTIALS are at fault during an outage in which no request was ever issued. The new copy is asserted to match neither infrastructure vocabulary nor `/key validation failed/i`.
- **scenario/optimize has coverage for the first time.** It shipped in Phase 28 and none of its four catch arms nor its happy path had ever been exercised. Ten cases now pin all of them plus CSRF, the B15 limiter ordering, malformed-point rejection and invalid JSON.
- **Five `maxDuration = 300` pins are platform-verified, not merely compiled.** `npm run build` emits `300` for all five routes into `.next/server/functions-config-manifest.json`.

## Task Commits

1. **Task 1 (TDD): bridge + simulator + scenario/optimize routes** — `f33cf542` (test, RED: 2 failed / 34 passed) → `18e9b377` (feat, GREEN: 36/36)
2. **Task 2: scenario/optimize route test (new file)** — `e4b2122c` (test, 10/10 + two mutants)
3. **Task 3 (TDD): portfolio-optimizer + validate-and-encrypt** — `c33a6aac` (test, RED: 3 failed / 60 passed) → `d732c3d1` (feat, GREEN: 63/63)

**Plan metadata:** not committed — `.planning/**` is gitignored (`.gitignore:52`); this SUMMARY lives in the working tree only, per the main-tree execution mode for this run.

## Files Created

- `src/app/api/scenario/optimize/route.test.ts` — 10 tests. The header states the file's reason for existing (a Phase-28 route with zero coverage) and carries a **MOCK-FACTORY NOTE** explaining why the hand-written `AnalyticsTimeoutError`/`AnalyticsUpstreamError` shims are load-bearing rather than decorative, with the 502/504 cases named as the guards that keep that true.

## Files Modified

- `src/app/api/bridge/route.ts`, `simulator/route.ts`, `scenario/optimize/route.ts` — leaf import, breaker arm, `CIRCUIT_OPEN_COPY`, `maxDuration = 300`. No auth, limiter, validation or existing-arm lines touched.
- `src/app/api/portfolio-optimizer/route.ts` — same, plus the refund call on the breaker arm and removal of the route-local timeout constant and its pass site.
- `src/app/api/keys/validate-and-encrypt/route.ts` — same, plus the dormant handler's fetch routed through `resilientFetch` and its base-URL constant removed.
- `src/lib/analytics-client.ts` — `runPortfolioOptimizer`'s dead `timeoutMs` parameter removed; `analyticsRequest`'s doc comment updated (it named the optimizer route as a live override user, which is no longer true).
- Four `route.test.ts` files — one leaf import and 1–3 new cases each. **No existing mock factory or hand-written class shim was modified anywhere**, exactly as the plan required.

## Acceptance Criteria

| Criterion | Result |
|---|---|
| `grep -c "instanceof CircuitOpenError"` × 5 routes | 1 each |
| `grep -c 'from "@/lib/seam-errors"'` × 5 routes | 1 each |
| `grep -cE "import.*CircuitOpenError.*analytics-client"` × 5 routes | 0 each |
| `grep -c "export const maxDuration = 300"` × 5 routes | 1 each |
| `maxDuration` in `.next/server/functions-config-manifest.json` | 300 for all five |
| `grep -c "OPTIMIZER_TIMEOUT_MS"` (portfolio-optimizer) | 0 |
| `grep -cE "fetch\(.*ANALYTICS"` (validate-and-encrypt) | 0 |
| `grep -c "ANALYTICS_URL"` (validate-and-encrypt) | 0 |
| `grep -c "_unifiedValidateAndEncryptHandler"` (NOT deleted) | 1 |
| `computePortfolioAnalytics` export (NOT deleted) | present |
| `grep -c "unstubAllGlobals"` (new test file) | 1 |
| optimizer test asserts refund on the CIRCUIT_OPEN arm | yes (spy) |
| `npx vitest run` (5 route test files) | 109/109 green |
| `npm test` | 692 files, **8797 passed**, 287 skipped, 0 failed |
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors (1 pre-existing `EquityChart.tsx` warning, untouched) |
| `npm run build` | success |
| Node 22 CI parity (6 touched files) | 140/140 green |

## Decisions Made

1. **`runPortfolioOptimizer`'s `timeoutMs` parameter was deleted, not retained.** The plan's action text says to replace the route constant with *a read of* `SEAM_BUDGETS[...]` and notes "the wrapper still accepts it as timeoutMsOverride". That would have kept a redundant override path alive whose only effect is to let a future caller out-vote the table — the precise failure SEAM-02 exists to prevent. 140-02's own inline comment had already scheduled the parameter for deletion in this plan, and the route was its only caller. See Deviation 1.
2. **The breaker arm is FIRST among the typed arms**, matching 140-03 and `process-key-client`, rather than literally "immediately before the generic arm". The classes are disjoint so ordering is behaviour-neutral; consistency across the phase's nine retrofitted routes is worth more than the literal placement. It also turned out to harden the tests (see Issues).
3. **No `captureToSentry` on any breaker arm.** Bridge, simulator and validate-and-encrypt all capture on their generic arm. A breaker trip is one shared infrastructure fact affecting every concurrent caller, so capturing it would emit an event per request for the entire cooldown window. `console.error` with the retry TTL is the operator signal; the tests assert `captureSpy` was NOT called, so a future author cannot quietly add it back.
4. **`Retry-After` fixtures deliberately avoid 30.** 30 is simultaneously `BREAKER_COOLDOWN_S`, `DEFAULT_RETRY_AFTER_S` and the value most other tests use, so a hardcoded `"30"` in a route would pass a 30-second fixture. The four new breaker cases use 7, 11, 13, 9 and 5 — each only passes if the route forwards `err.retryAfterS`.
5. **Copy constants stay per-route**, byte-identical, per 140-03 decision 5. A shared export is the obvious follow-up but would touch nine files across three completed plans; it belongs to whoever writes the SC-4a invariant test, not here.
6. **The dormant handler and the dead `computePortfolioAnalytics` export were both preserved** (operator decisions 5 and 6). Only `ANALYTICS_URL` was removed, and only because nothing read it once the fetch moved to the core — leaving an unread env-reading constant behind would be a second, quieter kind of dead code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] The plan's wording would have left the redundant timeout override alive**

- **Found during:** Task 3
- **Issue:** The plan says to replace the route's local constant with a read of `SEAM_BUDGETS["portfolio-optimizer"].timeoutMs` and explicitly notes the wrapper "still accepts it as timeoutMsOverride". Implemented literally, the route would still hand the client a per-call override — identical in value today, but a standing invitation for the two to diverge, and a route-local override silently WINS over the table. That is the exact ownership split SEAM-02 exists to end, so satisfying the letter of the plan would have missed its stated purpose. The orchestrator's brief and 140-02's own code comment ("Plan 140-05 deletes the route-side constant and this parameter becomes dead weight") both call for deleting the pair.
- **Fix:** Deleted the route constant, the pass site, AND `runPortfolioOptimizer`'s `timeoutMs` parameter (the route was its only caller, repo-wide grep confirmed). The deadline now reaches the core solely through `budgetKey`.
- **Files modified:** `src/app/api/portfolio-optimizer/route.ts`, `src/lib/analytics-client.ts`
- **Verification:** A new test pins `optimizerCalls[0].ms === undefined`; it failed RED with `expected 15000 to be undefined`. Full suite green — no other caller existed.
- **Committed in:** `c33a6aac` (test), `d732c3d1` (feat)

**2. [Rule 1 - Bug] My own doc comments defeated two of the plan's acceptance greps**

- **Found during:** Task 3 (acceptance-criteria check)
- **Issue:** The criteria are `grep -c "OPTIMIZER_TIMEOUT_MS = 15_000"` = 0 and `grep -cE "fetch\(.*ANALYTICS"` = 0. My `maxDuration` comment explained the change by quoting the removed constant verbatim, so the first grep returned 1 against a fully compliant file. This is precisely the trap 140-03 hit (its Deviation 1) and the lesson carried into this plan's brief — and I walked into it anyway, which is evidence the failure mode is about *writing* the comment, not about *knowing* the rule. Worse than a false failure: the same grep is the mechanism that would catch a future author genuinely re-introducing the constant, so prose contamination makes the guard permanently un-runnable.
- **Fix:** Both comments now describe the removed identifiers ("a route-local 15s timeout constant", "a route-local analytics base-URL constant") and state explicitly that the literal name is withheld so the guard grep stays meaningful.
- **Files modified:** `src/app/api/portfolio-optimizer/route.ts`, `src/app/api/keys/validate-and-encrypt/route.ts`
- **Verification:** Both greps return 0 against the finished files; `grep -c "ANALYTICS_URL"` is also 0 (a coarser guard, and the Wave-4 ESLint rule, would otherwise have matched the comment too).
- **Committed in:** `d732c3d1`

**3. [Rule 2 - Missing critical functionality] Extra cases beyond the plan's stated minimum**

- **Found during:** Tasks 1–3
- **Issue:** The plan's minimum for the new file is four cases, and one breaker case per existing file. Two gaps were worth closing while the harness was open: the T-140-20 oracle (breaker arm placement) had no automated guard on scenario/optimize, and the optimizer's `Retry-After`/copy discrimination is what distinguishes the new arm from its existing 503 — status alone proves nothing there.
- **Fix:** Added the unauthenticated+breaker-primed oracle case, a 502-upstream case (which is also what keeps the `AnalyticsUpstreamError` shim honest), CSRF/limiter/validation cases on the new file, and the separate refund + no-override cases on the optimizer.
- **Files modified:** `src/app/api/scenario/optimize/route.test.ts`, `src/app/api/portfolio-optimizer/route.test.ts`
- **Verification:** 16 new cases total, all green; the whole suite went 8781 → 8797, matching exactly.
- **Committed in:** `e4b2122c`, `c33a6aac`

---

**Total deviations:** 3 auto-fixed (1× Rule 1, 2× Rule 2). No Rule 4 architectural decisions. Deviation 1 is a conflict between the plan's prose and its own stated purpose, resolved toward the purpose and recorded here rather than averaged.

## Issues Encountered

- **The new test file passed on its first run, which is not evidence.** Two mutants, each reverted from a pre-mutation copy:

  | Mutant | Where | Result |
  |---|---|---|
  | Breaker arm removed from the catch | `scenario/optimize/route.ts` | exactly 1 case fails (the 503), 9 pass — correctly partitioned |
  | Both class shims dropped from the mock factory | `scenario/optimize/route.test.ts` | 3 cases fail, including the generic-error case that never mentions an analytics error — the exact cascade the file header predicts |

  `git status` confirmed both files restored byte-identical afterwards.
- **An instructive detail from mutant 2:** the CIRCUIT_OPEN case still PASSED with both shims missing, because the breaker arm returns before the catch ever evaluates an `undefined` `instanceof`. Placing the breaker arm first is therefore not merely stylistic — it makes the breaker path immune to the shim defect. The 502/504 cases are what actually detect it, which is why they are named in the header as the guards.
- **The RED run on the optimizer confirmed the status-only trap was real:** the breaker case failed with `expected null to be '9'` (a missing `Retry-After`), NOT with a status mismatch — because the request had fallen into the pre-existing generic 503. A test asserting only `status === 503` would have been green before the feature existed.
- **CI-parity run performed.** `PATH=/opt/homebrew/opt/node@22/bin` (Node v22.22.1, the CI version): 140/140 green across the six touched test files, matching local Node 25. The new file unstubs globals in `afterEach`.
- **`npm run build` verified the pins reach the adapter,** not just the type checker: all five routes carry `"maxDuration": 300` in `.next/server/functions-config-manifest.json`.
- **The `[resilient-fetch] Upstash not configured` notice now also appears in `validate-and-encrypt/route.test.ts` stderr**, because that route file now imports the core directly for the dormant path. Expected and harmless — one notice per module load, no network call, breaker inert with `redis === null`.

## Threat Flags

None. All security-relevant surface is enumerated in the plan's `<threat_model>`:

- **T-140-17** (breaker detail via generic arms) — mitigated: five static copies, each asserted against `/circuit|breaker|upstash|railway|http/i`; detail goes to `console.error` only. The pre-existing H-1062 / M-0333 non-leak arms were not touched.
- **T-140-18** (optimizer token not refunded on a trip) — mitigated and spy-asserted.
- **T-140-19** (dormant handler revived unbounded) — mitigated: the fetch now runs on the `process-key-unified-dormant` budget with breaker coverage; 140-07's ESLint rule backstops it and has zero violations left to grandfather in this file.
- **T-140-20** (breaker check above auth) — mitigated: no gate line was touched on any of the five routes, and scenario/optimize now has an AUTOMATED unauthenticated+breaker-primed case (401, no `Retry-After`, wrapper never called) rather than a diff-read.
- **T-140-30** (`instanceof` TypeError under fully-mocked clients) — mitigated: `CircuitOpenError` from the never-mocked leaf in all five routes and all five test files; no existing shim modified; mutation-demonstrated on the new file.

No new endpoint, auth path, file-access pattern or schema change. Credential handling on validate-and-encrypt (the sfox/mt5 carve-outs, the presence gates, the validate-then-encrypt ordering) is byte-identical — all 40 of that file's pre-existing cases pass unmodified.

## Known Stubs

None. Every arm of all five routes is implemented and test-pinned.

Two items are preserved-by-decision rather than stubs, and both are recorded so they are not mistaken for oversights:

- `_unifiedValidateAndEncryptHandler` remains dormant (zero callers) pending `/process-key` gaining an encrypt branch. Operator decision 5: deletion needs its own decision. It is now bounded and breaker-covered either way.
- `computePortfolioAnalytics` remains exported with zero callers (operator decision 6), its budget row already annotated in `SEAM_BUDGETS`.

## Next Phase Readiness

**Ready.**

- **140-06** — the third seam (`keys-permissions`) is the only budget row without a route retrofit. The arm shape is now established across nine routes; copy it verbatim.
- **140-07** — the `no-raw-analytics-fetch` rule now has **zero** pre-existing violations anywhere: the last raw seam fetch (the dormant one) was the final holdout. `critical-regressions.test.ts` already enforces a coarse version on both clients.
- **⚠️ SC-4a still has no owner.** `src/lib/seam-budgets.invariant.test.ts` does not exist. Nine of the fifteen `SEAM_ROUTE_BUDGETS` routes now export `maxDuration` (`keys/sync`, the two admin/match routes, `create-with-key`, `composite/add-key`, plus this plan's five); the remaining six pins and the source-scan assertion are unassigned. All nine already carry the comment naming the test.
- **SC-1a is still open** — `src/app/api/keys/sync/route.seam.test.ts` (the Mechanism-B twin of 140-03's seam test) is in 140-VALIDATION.md but in no executed plan's `files_modified`.
- **Cheap follow-up for whoever writes the invariant test:** the five `CIRCUIT_OPEN_COPY` constants (plus `process-key-client`'s `CIRCUIT_OPEN_HUMAN_MESSAGE` and the two admin ones) are byte-identical by convention only. An assertion that they match, or a single shared export, would make the convention enforceable.

---
*Phase: 140-seam-shared-resilience-core-circuit-breaker*
*Completed: 2026-07-25*

## Self-Check: PASSED

- All 11 artifacts exist on disk (5 `route.ts`, 5 `route.test.ts`, `analytics-client.ts`).
- All 5 task commits exist in git (`f33cf542`, `18e9b377`, `e4b2122c`, `c33a6aac`, `d732c3d1`) on `feat/v1.16-production-resilience`.
- `git diff --diff-filter=D --name-only 454917e6 HEAD` → empty: no file deletions in this plan.
- Working tree clean apart from one pre-existing untracked file (`analytics-service/scripts/nautilus_factsheet.py`) that predates this plan and was not touched.
- `npm test` → 8797 passed / 0 failed. `npm run typecheck` → exit 0. `npm run lint` → 0 errors. `npm run build` → success, all five `maxDuration` pins present in the functions-config manifest.
- Node 22 CI-parity run → 140/140 green.
- Branch unchanged throughout (`feat/v1.16-production-resilience`); no branch created, switched or deleted.
- `.planning/**` intentionally NOT staged (gitignored; main-tree execution mode). STATE.md / ROADMAP.md left to the orchestrator.
