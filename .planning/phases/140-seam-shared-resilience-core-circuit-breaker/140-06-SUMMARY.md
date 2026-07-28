---
phase: 140-seam-shared-resilience-core-circuit-breaker
plan: 06
subsystem: api
tags: [seam, circuit-breaker, unstable-cache, fail-closed, maxDuration, vitest, mutation-testing]

# Dependency graph
requires:
  - phase: 140-01
    provides: "CircuitOpenError leaf (@/lib/seam-errors), SEAM_BUDGETS['keys-permissions'], SEAM_ROUTE_BUDGETS (expectedMaxDurationS 300, platform-verified), fake-Upstash doubles + seedBreakerOpen"
  - phase: 140-02
    provides: "postProcessKey() delegating to the core; CircuitOpenError arm FIRST; the typed UPSTREAM_TIMEOUT / CIRCUIT_OPEN envelopes the five Mechanism-B routes inherit"
  - phase: 140-03
    provides: "the *.seam.test.ts template (hoisted store + @upstash wiring + env-before-import beforeEach) and the spread-importOriginal partial-mock pattern"
provides:
  - "SEAM-01 complete at the call-site level: the THIRD seam's two duplicated AbortSignal.timeout(15_000) copies are gone; every live Railway fetch flows through the core or is a documented SEAM_EXCLUSIONS row"
  - "SEAM-02: all five Mechanism-B routes export maxDuration=300, VERIFIED present in the build's functions-config-manifest (15/15 SEAM_ROUTE_BUDGETS routes now pinned)"
  - "T-140-32 closed and REGRESSION-TESTED against the real fork boundary: a breaker trip inside the 60s unstable_cache callback leaves NO cache entry"
  - "T-140-22 preserved: finalize-wizard still fails CLOSED on an unrunnable probe, now with an actionable 503 CIRCUIT_OPEN + Retry-After"
  - "src/app/api/keys/sync/route.seam.test.ts — SC-1a, the Mechanism-B end-to-end proof on the money-onboarding chokepoint"
  - "src/app/api/keys/[id]/permissions/route.seam.test.ts — the phase's only test that exercises the REAL next/cache boundary"
affects: [140-07 (ESLint no-raw-analytics-fetch rule now has zero legitimate violations to grandfather), SC-4a seam-budgets.invariant.test which will now find all 15 routes pinned]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies — locked constraint honoured
  patterns:
    - "Running the REAL unstable_cache under vitest: install globalThis.AsyncLocalStorage inside vi.hoisted (next captures it once at module eval, jsdom lacks it) + a Map-backed globalThis.__incrementalCache with the fork's generateSimpleCacheKey/get/set surface"
    - "A cache double with a FAITHFUL memoizing mode — writes only AFTER the callback resolves — so 'the error is not cached' is falsifiable instead of a tautology of a passthrough mock"
    - "Redis read COUNTER in the fake-Upstash wiring, which makes 'a cache HIT never consults the breaker' observable (a status assertion alone cannot see it)"
    - "Non-default Retry-After values (17 / 23 / 19 / 13) in every breaker test, because 30 is simultaneously BREAKER_COOLDOWN_S and DEFAULT_RETRY_AFTER_S and would let a hardcoded constant pass"

key-files:
  created:
    - src/app/api/keys/[id]/permissions/route.seam.test.ts
    - src/app/api/keys/sync/route.seam.test.ts
  modified:
    - src/app/api/keys/[id]/permissions/route.ts
    - src/app/api/keys/[id]/permissions/route.test.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
    - src/app/api/verify-strategy/route.ts
    - src/app/api/strategies/csv-validate/route.ts
    - src/app/api/strategies/csv-finalize/route.ts

key-decisions:
  - "instanceof SURVIVES the fork's cache boundary — the name-check fallback was NOT needed. Established from the fork's compiled source AND a real test, not from the doc (which is silent on error semantics)."
  - "The route THROWS out of the cached callback rather than returning the error as a value, and a dedicated regression asserts no cache entry results — a 60s cached breaker error would outlive the 30s cooldown."
  - "The breaker check deliberately lives INSIDE the cached callback, so a cache HIT performs zero Redis round-trips."
  - "finalize-wizard's breaker arm returns 503 CIRCUIT_OPEN but stays on the BLOCKING side of the fail-closed branch — only the envelope changed, never the disposition."
  - "A second seam test file was added for the permissions route (not in the plan's files_modified) because the mocked next/cache in route.test.ts structurally cannot answer the plan's own W-4 question."

patterns-established:
  - "When a plan asks whether a third-party boundary preserves a behaviour, read the SHIPPED implementation in node_modules and then pin it with a test that runs it — a doc that is silent and a mock that assumes are both non-answers"
  - "Mutation-verify a seam integration test in three directions (drop the deadline / bypass the core / hoist the breaker above auth) and require each mutant to redden a DIFFERENT case"

requirements-completed: [SEAM-01, SEAM-02]

# Metrics
duration: 25min
completed: 2026-07-25
---

# Phase 140 Plan 06: Third Seam + Mechanism-B maxDuration + SC-1a Summary

**The last two raw Railway fetches — both verbatim copies of the `/internal/keys/{id}/permissions` probe, one of them buried inside a 60s `unstable_cache` callback — now flow through the shared resilience core, with the cache boundary's error semantics read out of the fork's shipped source and pinned by a test that runs the real boundary rather than a mock of it.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3/3
- **Files created:** 2 · **Files modified:** 7

## Accomplishments

- **SEAM-01 is complete at the call-site level.** `grep -c "AbortSignal.timeout"` is 0 in both permissions routes; the two local `ANALYTICS_URL` constants are deleted; the whole-repo scan (`ANALYTICS_SERVICE_URL` minus the documented exclusions) returns two **comment-only** hits and zero fetch call sites. No live path can hammer a dying Railway while the breaker is open.
- **The cache-boundary question was answered with evidence, both halves.** See "The cache boundary" below — `instanceof` survives, nothing is cached on a throw, and both facts are now regression-tested against the real `unstable_cache`.
- **T-140-32 is closed with a falsifiable oracle, not a comment.** The Next layer caches for 60s; the breaker's cooldown is 30s. A breaker error returned as a *value* would keep answering 503 for half a minute after Railway recovered — the mitigation becoming the outage. The route throws instead, and two tests (one against a faithful memoizing double, one against the real boundary) assert the next call re-attempts.
- **T-140-22 fail-closed preserved.** finalize-wizard's force-refresh probe bypasses both caches deliberately, so it crosses the seam on every submit. A breaker trip lands on the *blocking* side of its fail-closed branch — the finalize RPC is asserted never to run — and only the envelope improves (503 + `CIRCUIT_OPEN` + `Retry-After`, i.e. "retry in ~13s", versus a 502 that tells the wizard nothing).
- **SEAM-02 finished for Mechanism B.** verify-strategy, csv-validate and csv-finalize gained the pin; finalize-wizard's arrived with Task 1; keys/sync already had one. `npm run build` emits `{"maxDuration":300}` for all five in `.next/server/functions-config-manifest.json` — the pin demonstrably reaches the deployment adapter.
- **SC-1a green on the money path.** `keys/sync/route.seam.test.ts` runs the REAL `process-key-client` and REAL core: a hanging Railway yields the typed 504 `UPSTREAM_TIMEOUT` envelope with a correlation id, and the round-trip itself is asserted (core-owned base URL, `/process-key`, an `AbortSignal`, the CT-4 `X-User-Id` header, the `resync` body) — none of which is observable under the wholesale client mock the sibling test uses.

## The cache boundary (the plan's W-4 decision, and what reality said)

**Outcome: `instanceof` survives. The documented name-check fallback was NOT needed and is NOT in the code.**

Three sources, in increasing order of authority:

1. **The fork's own doc** (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md`) is *silent* on what happens when the callback throws. It documents parameters, returns and revalidation only. Reading it was necessary (AGENTS.md) but not sufficient — treating silence as confirmation would have been exactly the assumption the plan forbade.
2. **The fork's shipped implementation** (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js`, next 16.2.11) settles it. On a miss the code is `const result = await workUnitAsyncStorage.run(innerCacheStore, cb, ...args);` followed by `cacheNewResult(result, ...)`. There is no `try`/`catch` around the callback — only a `finally` that ends a cache-signal read. So a rejection (a) propagates out of `cachedCb` **unwrapped, same realm, same object**, and (b) never reaches `cacheNewResult`, so **no entry is written**.
3. **A test that runs it.** `src/app/api/keys/[id]/permissions/route.seam.test.ts` executes the real `unstable_cache` against a Map-backed incremental cache and asserts all three properties end to end: the 503 arm fires (which only happens if `instanceof CircuitOpenError` matched), the incremental store is empty afterwards, and the next call re-attempts and *then* writes one entry.

Two host details were required to run the real boundary under vitest, both documented in the file:

- `globalThis.AsyncLocalStorage` — `next/dist/server/app-render/async-local-storage.js` reads it **once at module evaluation** and otherwise substitutes a stub whose every method throws. jsdom does not expose it. It must be installed in `vi.hoisted`, not `beforeEach`: with a `beforeEach` the file's own `next/server` import has already captured `undefined`, `unstable_cache` throws an invariant, and the handler's catch faithfully reports it as a generic 502 — every case in the file then fails for a reason that has nothing to do with the seam. This was observed, not theorised (it was the first RED).
- `globalThis.__incrementalCache` — outside a render `unstable_cache` throws an invariant without one.

## Task Commits

1. **Task 1 (TDD): third seam through the core** — `4fbb3f33` (test, RED: 6 failed / 69 passed) → `57b11813` (feat, GREEN: 75/75)
2. **Task 2: maxDuration pins** — `65cb711d`
3. **Task 3: SC-1a seam integration test** — `e213c2db` (3/3 + three mutants)

**Plan metadata:** not committed — `.planning/**` is gitignored (`.gitignore:52`); this SUMMARY lives in the working tree only, per the main-tree execution mode for this run.

## Files Created

- `src/app/api/keys/[id]/permissions/route.seam.test.ts` — 3 tests. Header states in one paragraph what the mocked-`next/cache` sibling structurally cannot prove, and documents both host-global hazards.
- `src/app/api/keys/sync/route.seam.test.ts` — 3 tests (SC-1a, breaker-open, T-140-12 oracle). Mutation-verified.

## Files Modified

- `src/app/api/keys/[id]/permissions/route.ts` — core call inside the cached callback, `CircuitOpenError` arm first in the catch, static copy, `maxDuration`.
- `src/app/api/keys/[id]/permissions/route.test.ts` — memoizing mode on the `next/cache` double, spread-`importOriginal` partial mock of the core, 3 new cases.
- `src/app/api/strategies/finalize-wizard/route.ts` — `fetchLivePermissions` via the core, `CircuitOpenError` arm inside `runScopeBroadeningProbe` (so BOTH call sites — single-key and per-composite-member — inherit it), `maxDuration`.
- `src/app/api/strategies/finalize-wizard/route.test.ts` — same partial mock, 2 new cases.
- `src/app/api/verify-strategy/route.ts`, `src/app/api/strategies/csv-validate/route.ts`, `src/app/api/strategies/csv-finalize/route.ts` — export + comment only (`git diff --stat`: 14 insertions each, 0 deletions).

## Acceptance Criteria

| Criterion | Result |
|---|---|
| `grep -c "AbortSignal.timeout"` × 2 permissions routes | 0, 0 |
| `grep -c "resilientFetch"` × 2 routes (budgetKey `keys-permissions`) | 2, 2 |
| `grep -c "export const maxDuration = 300"` × 5 Mechanism-B routes | 1 each |
| permissions test covers cache-MISS-breaker-open (not cached) AND cache-HIT (no fetch, no redis) | yes — twice, once against the real boundary |
| finalize-wizard test asserts finalize BLOCKED on breaker open | yes (`finalize_wizard_strategy` never called) |
| `grep -c 'vi.mock("@/lib/process-key-client"'` in the SC-1a file | 0 |
| `grep -c "upstash-breaker"` / `"unstubAllGlobals"` in the SC-1a file | 3 / 1 |
| `git diff --stat` on the three Task-2 files | +14 each, 0 deletions (no behaviour edits) |
| Whole-repo `ANALYTICS_SERVICE_URL` scan minus exclusions | 2 comment hits, **0 fetch call sites** |
| `npm test` | 713 files, 8808 passed, 287 skipped, **0 failed** |
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors (1 pre-existing `EquityChart.tsx` warning, untouched) |
| `npm run build` | success; all five B routes carry `{"maxDuration":300}` in the manifest |
| Node 22 CI parity (7 seam-touching files) | 124/124 green |

## Decisions Made

1. **A second seam test file for the permissions route**, beyond the plan's `files_modified`. The plan asked for the cache boundary to be established by a *real* test; `route.test.ts` replaces `next/cache` wholesale (it needs deterministic hit/miss/stale control), so anything asserted there is an assertion *about* the fork rather than a reading of it. Rule 2 addition, and it is where the whole W-4 answer actually lives.
2. **The breaker check stays inside the cached callback.** Hoisting it into the handler would consult Redis on every cache hit — a per-render-pass round-trip on the wizard's busiest badge — to protect a call that is not going to be made. The Redis read counter in the seam test pins this.
3. **`CircuitOpenError` is matched FIRST in both catch blocks.** The permissions handler classifies by sniffing `err.message`, and the breaker error's message is static text that matches none of its patterns — it would have been reported as a generic `PROBE_FAILED` 502, and the `Retry-After` hint would never reach the client.
4. **Partial mock, not a full factory, in both route tests.** The spread-`importOriginal` form keeps the core's real base URL, budget and `AbortSignal` in play for the ~45 existing fetch-spy assertions in finalize-wizard and the existing cache-honesty cases in permissions; only the breaker decision is driven. A full factory would have re-implemented the transport and become blind to regressions in it.
5. **The `next/cache` double gained a *faithful* memoizing mode** rather than a convenient one. It writes the entry only after the callback resolves — mirroring `cacheNewResult`'s position after the `await` — so returning the error as a value would cache it and redden the "second call re-attempts" assertion. A double that cached eagerly would have made that assertion unfalsifiable.
6. **Every breaker test uses a non-default `Retry-After`** (17, 23, 19, 13). 30 is simultaneously `BREAKER_COOLDOWN_S`, `DEFAULT_RETRY_AFTER_S` and the value every other test uses, so a hardcoded `"30"` would pass everywhere — the 140-03 lesson, applied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] The plan's own W-4 question could not be answered inside the file it assigned**

- **Found during:** Task 1 (before writing any production code)
- **Issue:** `permissions/route.test.ts` replaces `next/cache` with a hand-written double. Any "instanceof survives / nothing is cached" assertion written there tests the double, not the fork — and the plan explicitly forbade settling this by assumption. Constraint 1 of the run brief demanded "a real test (not assumption)".
- **Fix:** Added `src/app/api/keys/[id]/permissions/route.seam.test.ts`, which runs the REAL `unstable_cache` (plus the real core) over a Map-backed incremental cache, covering both cache-miss and cache-hit as the brief required.
- **Files modified:** new file only.
- **Verification:** 3/3 green; it was RED for the right reason before the implementation landed (502 → 503).
- **Committed in:** `4fbb3f33` (RED) / `57b11813` (GREEN)

**2. [Rule 3 - Blocking issue] `AsyncLocalStorage` install had to move from `beforeEach` into `vi.hoisted`**

- **Found during:** Task 1 (first RED run of the new seam file)
- **Issue:** All three cases returned 502 regardless of breaker state. Cause: `next/dist/server/app-render/async-local-storage.js` captures `globalThis.AsyncLocalStorage` **once, at module evaluation**, and substitutes a throwing stub when it is absent. jsdom does not provide it, and the file's static `next/server` import evaluated the chain before `beforeEach` ran, so `unstable_cache` threw an invariant that the handler's catch dutifully classified as a generic proxy failure — a green-looking harness measuring nothing.
- **Fix:** Install it in `vi.hoisted` (the only hook that runs before the file's imports), with the hazard written down in the file.
- **Files modified:** `route.seam.test.ts`
- **Verification:** the remaining RED failures became exactly the two breaker cases, and all three pass post-implementation.
- **Committed in:** `4fbb3f33`

**3. [Rule 2 - Missing critical functionality] Byte-for-byte call-shape assertions added to both route tests**

- **Found during:** Task 1
- **Issue:** The plan's threat register carries T-140-23 (header drift through the core rewiring) with mitigation "init passed byte-for-byte" — but the existing tests observe only the *outbound fetch*, which cannot distinguish "the caller passed the right init" from "the core happened to fill it in". A dropped `X-Internal-Token` or a lost `?force_refresh=true` would not have reddened anything.
- **Fix:** Both route tests now capture the arguments the route hands the core and assert budget key, exact path (query included), method, headers and `cache`, plus that the caller passes **no** `signal` (the core owns the deadline).
- **Files modified:** both `route.test.ts`
- **Verification:** green; each was RED pre-implementation (`RF.lastCall` null).
- **Committed in:** `4fbb3f33`, `57b11813`

**4. [Rule 2 - Missing critical functionality] T-140-12 oracle case added to the SC-1a file**

- **Found during:** Task 3
- **Issue:** The plan specified two cases for `keys/sync/route.seam.test.ts`. 140-03 established that "the breaker check sits after the auth gate" must be an automated test rather than a diff-read; without it, keys/sync — the *unauthenticated-adjacent* onboarding chokepoint — would have had that property verified by reading only.
- **Fix:** Third case: unauthenticated caller with the breaker open must get 401, no `Retry-After`, no breaker vocabulary, and no seam call.
- **Files modified:** `keys/sync/route.seam.test.ts`
- **Verification:** it is the case that reddens under the hoist-breaker-above-auth mutant.
- **Committed in:** `e213c2db`

---

**Total deviations:** 4 auto-fixed (1× Rule 3, 3× Rule 2). No Rule 4 architectural decisions. No package installs. All changes are inside files this plan owns plus two new test files.

## Issues Encountered

- **The SC-1a test passed on its first run, which is not evidence.** Mutation-verified in three directions, each mutant reverted from a pre-mutation copy:

  | Mutant | Where | Case that failed |
  |---|---|---|
  | `signal: AbortSignal.timeout(...)` deleted | `resilient-fetch.ts` | case 1 (SC-1a typed 504) |
  | `postProcessKey` bypasses the core with a raw `fetch` | `process-key-client.ts` | case 2 (breaker open → `fetch` never called) |
  | Breaker check hoisted ABOVE the auth gate | `keys/sync/route.ts` | case 3 (T-140-12 oracle) |

  Case 3 reddens **only** under the hoist mutant, which is the partition that matters. The hoist mutant also tripped case 2, because the crude mutant emits a body without `human_message` — an artefact of the mutant's shape, not test overlap. `grep -rn MUTANT src/` is 0 and `git status` shows no modified tracked files.

- **A near-miss on the timeout classification, worth recording.** Before the `AsyncLocalStorage` fix, the permissions seam test reported `PROBE_FAILED` instead of `PROBE_TIMEOUT` and it looked like the route's message-sniffing classifier was jsdom-fragile. It was not: the string being sniffed was the `AsyncLocalStorage` invariant, not the abort. With the harness fixed, a real `DOMException("aborted","TimeoutError")` classifies as `PROBE_TIMEOUT` under both Node 22 and Node 25. No production change was warranted — a fix here would have been a bandaid over a broken test harness.

- **The `[resilient-fetch] Upstash not configured` notice now appears in `finalize-wizard/route.test.ts` stderr.** Expected: the partial mock means that file now loads the real core. One notice per module load, no network call.

- **CI-parity run performed.** `PATH=/opt/homebrew/opt/node@22/bin` (Node v22.22.1, the CI version): 124/124 green across the seven seam-touching files. Every new `describe` unstubs globals in `afterEach`.

- **Still open, and deliberately so:** `src/lib/seam-budgets.invariant.test.ts` (SC-4a) does not exist yet. All five Task-1/2 `maxDuration` comments name it as a forward reference, matching the convention 140-03 established. All 15 `SEAM_ROUTE_BUDGETS` routes now carry the export, so the test will find a complete set of counterparties when written.

## Threat Flags

None. All security-relevant surface is enumerated in the plan's `<threat_model>`:

- **T-140-21** (internal token in probe logs) — mitigated: the breaker arms log only the budget-free short-circuit line plus `retryAfterS`; `scrubInternalToken`/`safeErrorString` still guard the generic probe-failure log; the core never logs headers, path or body.
- **T-140-22** (finalize proceeding on probe failure) — mitigated and TESTED: the breaker arm returns from the `{ ok: false, response }` branch of `runScopeBroadeningProbe`, and the test asserts `finalize_wizard_strategy` is never called.
- **T-140-23** (header drift through the rewiring) — mitigated and now DIRECTLY tested via the call-shape assertions (deviation 3); all pre-existing success-path tests are unmodified and green.
- **T-140-24** (breaker-state oracle above auth) — mitigated: `resilientFetch` is reached only inside handler bodies after `withAuth`; automated in the SC-1a oracle case.
- **T-140-32** (breaker error cached for 60s) — mitigated and REGRESSION-TESTED twice, including against the real boundary.
- **T-140-SC** (package installs) — accepted: zero installs.

No new endpoint, auth path, file-access pattern or schema change. Both handlers' auth surface is byte-identical to before this plan; the diffs touch the transport call, one catch arm each, and two module-scope exports.

## Known Stubs

None. Every arm of both routes is implemented and test-pinned in both the mocked and the real-boundary harnesses.

## Next Phase Readiness

**Ready.**

- **140-07** — the ESLint `no-raw-analytics-fetch` rule can be written as a hard error with no grandfathered violations: the whole-repo scan returns comment-only hits. The three `SEAM_EXCLUSIONS` rows are the complete allowlist.
- **SC-4a still has no owner.** `src/lib/seam-budgets.invariant.test.ts` remains unwritten; all 15 routes are now pinned and five route comments name the test by filename.
- The `route.seam.test.ts` harness in `keys/[id]/permissions/` is the reusable recipe for any future test that needs the real Next cache under vitest.

---
*Phase: 140-seam-shared-resilience-core-circuit-breaker*
*Completed: 2026-07-25*

## Self-Check: PASSED

- All 9 source artifacts exist on disk (2 created, 7 modified).
- All 4 task commits exist in git (`4fbb3f33`, `57b11813`, `65cb711d`, `e213c2db`) on `feat/v1.16-production-resilience`.
- `git diff --diff-filter=D --name-only 4fbb3f33~1 HEAD` → empty: no file deletions in this plan.
- Working tree clean apart from one pre-existing untracked file (`analytics-service/scripts/nautilus_factsheet.py`) that predates this plan and was not touched.
- `npm test` → 8808 passed / 0 failed. `npm run typecheck` → exit 0. `npm run lint` → 0 errors. `npm run build` → success with all five Mechanism-B `maxDuration` pins in the functions-config manifest.
- Node 22 CI-parity run → 124/124 green.
- `.planning/**` intentionally NOT staged (gitignored; main-tree execution mode). STATE.md / ROADMAP.md left to the orchestrator.
