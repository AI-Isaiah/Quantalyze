---
phase: 140-seam-shared-resilience-core-circuit-breaker
plan: 03
subsystem: api
tags: [seam, circuit-breaker, info-disclosure, admin-match, maxDuration, vitest, mutation-testing]

# Dependency graph
requires:
  - phase: 140-01
    provides: "CircuitOpenError leaf (@/lib/seam-errors), SEAM_ROUTE_BUDGETS (expectedMaxDurationS 300, platform-verified), fake-Upstash doubles + seedBreakerOpen"
  - phase: 140-02
    provides: "analyticsRequest() delegating to the core; CircuitOpenError propagated unwrapped and FIRST; AnalyticsTimeoutError still owned by analytics-client"
provides:
  - "SEAM-04 Class-1 closed: admin/match/eval + admin/match/recompute map CircuitOpenError→503+Retry-After, AnalyticsTimeoutError→504, everything else→500, all with STATIC bodies"
  - "T-140-11 pre-existing info-disclosure leak closed on both routes (err.message no longer echoed; detail is console.error-only)"
  - "SEAM-02: both routes export maxDuration=300, VERIFIED present in the build's functions-config-manifest"
  - "src/app/api/admin/match/recompute/route.seam.test.ts — SC-1b, the phase's FIRST end-to-end proof on Mechanism A with the real client"
  - "T-140-12 breaker-after-auth oracle is now an AUTOMATED test in two files, not a diff-read"
  - "Reusable pattern: spread-importActual partial mock that preserves the pre-existing hand-rolled implementation"
affects: [140-05 (same retrofit shape for the five Class-3 routes), 140-06 (third seam), SC-4a seam-budgets.invariant.test which will now find 2 more pinned routes]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies — locked constraint honoured
  patterns:
    - "Spread-importActual partial mock that copies the pre-existing factory implementation VERBATIM: the spread restores real error-class identity for instanceof while the copied body keeps every pre-existing assertion driving the same state object"
    - "Same-registry dynamic error-class import inside the test body, so a vi.resetModules() in beforeEach cannot silently mint a second class object and turn a real 503 into a false 500"
    - "Companion *.seam.test.ts alongside a mock-based route.test.ts, with a header that states in one paragraph what the mock-based file structurally cannot prove"
    - "Leak-closure tests assert BOTH the absence of the detail from the body AND its presence in the server log, so 'static body' cannot be satisfied by discarding the diagnostic"

key-files:
  created:
    - src/app/api/admin/match/recompute/route.seam.test.ts
  modified:
    - src/app/api/admin/match/eval/route.ts
    - src/app/api/admin/match/eval/route.test.ts
    - src/app/api/admin/match/recompute/route.ts
    - src/app/api/admin/match/recompute/route.test.ts

key-decisions:
  - "The two pre-existing 500 tests were INVERTED, not extended: they asserted the leak (body.error === 'analytics service unavailable' / 'Unknown error'). Closing T-140-11 necessarily changes that contract, so they now pin the leak's absence."
  - "CIRCUIT_OPEN_COPY is byte-identical to process-key-client's CIRCUIT_OPEN_HUMAN_MESSAGE so a breaker trip reads the same whichever seam mechanism the user hits; the 504/500 copies are route-specific."
  - "Per-route local copy constants rather than a shared export — 140-05 specifies 'static copy in the route's own body shape' for the five Class-3 routes, so a premature shared constant would fight that plan."
  - "The 503 arm logs a single interpolated line (budget-free, detail-free) rather than the error object: CircuitOpenError carries no diagnosable payload beyond retryAfterS."
  - "Retry-After is spread onto NO_STORE_HEADERS, matching the route's own existing 429 arm rather than replacing the cache headers."

patterns-established:
  - "Three-direction mutation verification for a seam integration test: hoist-breaker-above-auth, bypass-the-core, drop-the-deadline — each must fail a DIFFERENT case"
  - "Grep-asserted negatives must not be defeated by the file's own prose: the seam test deliberately avoids writing the forbidden literal even inside a comment"

requirements-completed: [SEAM-02, SEAM-04]

# Metrics
duration: 20min
completed: 2026-07-25
---

# Phase 140 Plan 03: Class-1 Cascade-500 Retrofit Summary

**Both `admin/match` routes now emit the typed 503/504/500 taxonomy with static bodies — closing an information-disclosure leak that had been fixed twice elsewhere but never here — and `route.seam.test.ts` is the phase's first end-to-end proof that a hanging Railway produces a typed 504 through the REAL client, mutation-verified in three directions.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3/3
- **Files created:** 1 · **Files modified:** 4

## Accomplishments

- **SEAM-04 Class-1 closed.** The two literal `return NextResponse.json({ error: err.message }, {status:500})` escapes identified in research §5.2 are gone. Both handlers now branch `CircuitOpenError` → 503 + `Retry-After: String(err.retryAfterS)` → `AnalyticsTimeoutError` → 504 → static generic 500, in that order, inside the handler and after the admin gate.
- **T-140-11 closed — a real, pre-existing defect, not new-code hygiene.** These two routes echoed upstream `err.message` to an admin browser. On this seam that string carries the multi-line Zod issue list `parseResponse()` throws on contract drift, FastAPI 5xx `detail`, and the analytics service's base URL. The identical defect was closed on `bridge` as H-1062 and on `portfolio-optimizer` as M-0333; both precedents are cited in the route comments so a reviewer does not re-litigate the static copy as unhelpful UX.
- **SEAM-02 pins are platform-verified, not just compiled.** `npm run build` emits `/api/admin/match/eval {"maxDuration":300}` and `/api/admin/match/recompute {"maxDuration":300}` into `.next/server/functions-config-manifest.json` — the pin demonstrably reaches the deployment adapter rather than merely type-checking.
- **SC-1b green — the first Mechanism-A end-to-end proof in this phase.** `route.seam.test.ts` runs the real `analytics-client` and the real `resilient-fetch`, faking only `fetch` and `@upstash/*`. It asserts the round-trip actually happened (`http://analytics.invalid/api/match/recompute` with an `AbortSignal`), which is invisible under the wholesale mock the sibling `route.test.ts` uses.
- **T-140-12 upgraded from a human diff-read to two automated tests.** The plan's checker flagged "no gate lines in the diff" as a PARTIAL. There is now an unauthenticated-caller-with-open-breaker case in both `route.test.ts` (mocked) and `route.seam.test.ts` (real breaker seeded via `seedBreakerOpen`), each asserting 401, no `Retry-After`, no breaker vocabulary in the body, and no seam call.
- **Both bare mock factories converted without touching their behaviour.** `evalState` and `recomputeCalls` are still driven by the same code; only the `...(await importOriginal())` spread is new. All eleven pre-existing cases across the two files still pass (the two leak tests excepted, by design).

## Task Commits

1. **Task 1 (TDD): admin/match/eval** — `a2c963a4` (test, RED: 5 failed / 6 passed) → `68b3c438` (feat, GREEN: 11/11)
2. **Task 2 (TDD): admin/match/recompute** — `8f0a2cda` (test, RED: 5 failed / 6 passed) → `f2aa5bf3` (feat, GREEN: 11/11)
3. **Task 3: SC-1b seam integration test** — `df7771ca` (test, 3/3 + three mutants)

**Plan metadata:** not committed — `.planning/**` is gitignored (`.gitignore:52`); this SUMMARY lives in the working tree only, per the main-tree execution mode for this run.

## Files Created

- `src/app/api/admin/match/recompute/route.seam.test.ts` — 3 tests. The header spends a paragraph on *why the file exists* (the sixteen mock-based route tests prove nothing about SEAM-01/03, which is how the third unbudgeted seam survived), documents the env-before-import hazard on the core's module body, and explains why the hoisted store is load-bearing.

## Files Modified

- `src/app/api/admin/match/eval/route.ts` — leaf import, three typed arms, three static copy constants, `maxDuration = 300`.
- `src/app/api/admin/match/recompute/route.ts` — the identical retrofit; auth gate, CSRF guard, body validation and the B15b rate-limit ordering all untouched.
- `src/app/api/admin/match/eval/route.test.ts` — partial mock conversion, console spy, 5 new/rewritten cases (11 total).
- `src/app/api/admin/match/recompute/route.test.ts` — same, in a second `describe` so the C-PR5-01 actor-binding block stays visually intact (11 total).

## Acceptance Criteria

| Criterion | Result |
|---|---|
| `err.message` in a `NextResponse` body, either route | 0 (one hit each, inside the doc comment that explains the fix) |
| `grep -c "export const maxDuration = 300"` × 2 routes | 1, 1 |
| `grep -c 'from "@/lib/seam-errors"'` × 2 routes | 1, 1 |
| `grep -c 'vi.mock("@/lib/analytics-client"' route.seam.test.ts | 0 |
| `grep -c "upstash-breaker"` route.seam.test.ts | 3 |
| `grep -c "unstubAllGlobals"` route.seam.test.ts | 1 |
| `npx vitest run` (3 plan files) | 25/25 green |
| `npm test` | 710 files, 8768 passed, 287 skipped, **0 failed** |
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors (1 pre-existing `EquityChart.tsx` warning, untouched) |
| `npm run build` | success; both routes carry `{"maxDuration":300}` in the functions-config manifest |
| Node 22 CI parity (8 seam-touching files) | 218/218 green |

## Decisions Made

1. **The two pre-existing 500 tests were inverted, not extended.** `eval/route.test.ts` asserted `body.error === "analytics service unavailable"` and `"Unknown error"` — i.e. it *pinned the leak as the contract*. Closing T-140-11 makes that assertion false by construction, so those cases now assert the opposite (message text absent, static copy present). The file header records the reversal so a future reader does not read it as a weakened test.
2. **Leak-closure tests assert the log too.** `expect(errorSpy).toHaveBeenCalledWith(expect.any(String), leaky)` — otherwise "the body is static" would be satisfiable by simply discarding the diagnostic, which trades one defect for another (operators lose the only signal for Python contract drift).
3. **The 503 arm logs an interpolated line, not the error object.** `CircuitOpenError`'s message is static and its only payload is `retryAfterS`, so `console.error(err)` would add noise without diagnostic value.
4. **`Retry-After` is spread onto `NO_STORE_HEADERS`.** Mirrors the recompute route's own 429 arm at `:74-79`; replacing the headers object would silently drop the route's cache contract on exactly the path a client is most likely to retry.
5. **Copy constants stay per-route.** 140-05 specifies "static copy in the route's own body shape" for the five Class-3 routes, so hoisting a shared constant now would pre-empt a plan that has already decided otherwise. Only `CIRCUIT_OPEN_COPY` is deliberately byte-identical across routes (and to `process-key-client`'s `CIRCUIT_OPEN_HUMAN_MESSAGE`), because a breaker trip is one infrastructure fact and should read identically wherever a user meets it.
6. **Error classes are imported dynamically, inside the test, in BOTH test files.** `eval/route.test.ts` calls `vi.resetModules()` and genuinely requires it (140-01 deviation 3: a statically imported `CircuitOpenError` is a different class object after a reset, so the route's `instanceof` misses and the 503 assertion fails as a 500). `recompute/route.test.ts` does not reset today, so a static import would work — it uses the dynamic form anyway, with a comment, so that adding a reset later cannot re-open the trap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's grep acceptance criterion was defeated by the seam test's own header comment**

- **Found during:** Task 3 (acceptance-criteria check)
- **Issue:** The criterion is `grep -c 'vi.mock("@/lib/analytics-client"' route.seam.test.ts` = 0. The file's header originally explained the rule by quoting the forbidden call verbatim, so the grep returned 1. A checker running the criterion literally would have failed a compliant file — and, worse, the same grep is the mechanism that would catch a future author actually adding the mock, so a prose false-positive makes the guard un-runnable.
- **Fix:** Reworded to "must never mock the analytics client module", with an explicit note that the literal is deliberately absent from the file including comments.
- **Files modified:** `src/app/api/admin/match/recompute/route.seam.test.ts`
- **Verification:** grep returns 0; the three tests still pass.
- **Committed in:** `df7771ca`

**2. [Rule 1 - Bug] A vacuous assertion of the exact shape 140-01 deviation 5 flagged**

- **Found during:** Task 3 (self-review before commit)
- **Issue:** The oracle test's first draft ended with `expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(0)` — unfalsifiable, and it existed only because `warnSpy` was otherwise unread. 140-01 hit and documented the identical anti-pattern.
- **Fix:** Removed the assertion; the warn spy is now created without being bound to a variable (its only job is suppressing the core's unconfigured notice from test output).
- **Files modified:** `src/app/api/admin/match/recompute/route.seam.test.ts`
- **Verification:** the test still fails under the hoist-breaker-above-auth mutant, so its falsifiability is demonstrated rather than assumed.
- **Committed in:** `df7771ca`

**3. [Rule 2 - Missing critical functionality] Extra breaker-after-auth case added to `eval/route.test.ts`**

- **Found during:** Task 1
- **Issue:** The plan puts the T-140-12 oracle test only in Task 3's seam file, which covers `recompute`. `eval` would then have had its breaker arm's placement verified by diff-reading alone — the exact "PARTIAL" the checker downgraded.
- **Fix:** Added the unauthenticated + `CircuitOpenError`-primed case to `eval/route.test.ts` as well (401, no `Retry-After`, `evalMatch` never called).
- **Files modified:** `src/app/api/admin/match/eval/route.test.ts`
- **Verification:** green; the same case exists in `recompute/route.test.ts`.
- **Committed in:** `a2c963a4` (and `8f0a2cda` for recompute)

**4. [Rule 2 - Missing critical functionality] `Retry-After` value-fidelity cases added to both route tests**

- **Found during:** Task 1
- **Issue:** Asserting only `Retry-After: "30"` against `new CircuitOpenError(30)` cannot distinguish "forwards the breaker's TTL" from "hardcodes 30" — and 30 is simultaneously `BREAKER_COOLDOWN_S`, `DEFAULT_RETRY_AFTER_S`, and the value used in every other test, so a hardcoded constant would pass everywhere.
- **Fix:** A second case per route using a non-default cooldown (`7` for eval, `11` for recompute).
- **Files modified:** both `route.test.ts`
- **Verification:** green; a hardcoded `"30"` would now fail one case per route.
- **Committed in:** `a2c963a4`, `8f0a2cda`

---

**Total deviations:** 4 auto-fixed (2× Rule 1, 2× Rule 2). No Rule 4 architectural decisions, no scope creep — all four are inside files this plan already owns.

## Issues Encountered

- **The SC-1b test passed on its very first run, which is not evidence.** It was mutation-verified in three directions, each mutant reverted from a pre-mutation copy:

  | Mutant | Where | Case that failed |
  |---|---|---|
  | Breaker check hoisted ABOVE the auth gate | `recompute/route.ts` | case 3 (T-140-12 oracle) |
  | `analyticsRequest` bypasses the core with a raw `fetch` | `analytics-client.ts` | case 2 (breaker open → `fetch` never called) |
  | `signal: AbortSignal.timeout(...)` deleted | `resilient-fetch.ts` | case 1 (SC-1b typed 504) |

  Each mutant failed exactly one case and no others — the three tests are correctly partitioned rather than redundantly overlapping. `grep -c MUTANT` is 0 in all three files and `git status` shows no modified tracked files.

- **Env ordering is a real hazard in the seam test, not a theoretical one.** The core decides whether the breaker exists at all inside its MODULE BODY (`UPSTASH_* → Redis.fromEnv()`), and captures `ANALYTICS_URL` there too. Setting those env vars after the dynamic `import("./route")` leaves `redis === null`, the breaker permanently inert, and cases 2 and 3 passing for entirely the wrong reason. `beforeEach` sets env → `vi.resetModules()` → the test body imports; the ordering is comment-documented.

- **CI-parity run performed.** `PATH=/opt/homebrew/opt/node@22/bin` (Node v22.22.1, the CI version): 218/218 green across the eight seam-touching test files, matching local Node 25. Every new `describe` unstubs globals in `afterEach`.

- **The `[resilient-fetch] Upstash not configured` notice now appears in both `admin/match` route tests' stderr.** Expected: the spread-`importActual` conversion means those files now load the real `analytics-client` → real core. It is one notice per module load, no network call is made, and the seam test suppresses it via a `console.warn` spy.

- **Not verified, and deliberately so:** the plan's `maxDuration` comment references `seam-budgets.invariant.test.ts` (SC-4a), which does not exist yet — 140-01's "affects" note assigned it to Wave 2 but 140-02's actual scope was client adaptation only. The comment is a forward reference; the assertion it names still needs a home. See Next Phase Readiness.

## Threat Flags

None. All security-relevant surface is enumerated in the plan's `<threat_model>`:

- **T-140-11** (err.message echoed in 500 bodies, PRE-EXISTING) — mitigated and TESTED on both routes: static body, detail to `console.error` only, and a regression case asserting the message text and `localhost` are absent from the raw response while the log still receives the error object.
- **T-140-12** (breaker-state oracle above auth) — mitigated and AUTOMATED in three tests across two files; mutation-verified by hoisting the check above the gate and watching the oracle test go red.
- **T-140-13** (Retry-After cooldown precision) — accepted, unchanged: the same class of information `rateLimitDenyJson` already publishes.
- **T-140-30** (`instanceof` TypeError under bare mock factories) — mitigated: `CircuitOpenError` from the never-mocked leaf, `AnalyticsTimeoutError` via spread-`importActual`, both exercised by a passing 503 and a passing 504 case in each file.

No new endpoint, auth path, file-access pattern or schema change. The two handlers' auth surface (CSRF guard → 401 → 403 → body validation → rate limit) is byte-identical to before this plan; only the catch block and two module-scope exports changed.

## Known Stubs

None. Every arm of both routes is implemented and test-pinned in both the mocked and the real-client harness.

## Next Phase Readiness

**Ready.**

- **140-05** — the retrofit shape is now established twice; copy the arm ordering, the `Retry-After`-on-`NO_STORE_HEADERS` spread, and the `maxDuration` comment block. Note its Task 1 explicitly says NOT to convert bridge/simulator factories to `importActual` (they carry hand-written class shims); that is the correct call for those files and does not contradict what this plan did here.
- **⚠️ SC-4a has no owner yet.** `src/lib/seam-budgets.invariant.test.ts` does not exist. Four of the fifteen `SEAM_ROUTE_BUDGETS` routes now export `maxDuration` (`keys/sync`, `debug-key-flow` — the latter is in `SEAM_EXCLUSIONS` — plus this plan's two); the remaining pins and the source-scan assertion are unassigned between 140-05 (pins five more) and whatever lands the invariant test. Both routes in this plan already carry the comment that names it, so the test will find its declared counterparties when written.
- **140-06** — `route.seam.test.ts` is a directly reusable template for the third seam: the `vi.hoisted` store + `@upstash/*` wiring + env-before-import `beforeEach` is ~60 lines that transplant unchanged.
- **SC-1a is still open.** `src/app/api/keys/sync/route.seam.test.ts` (the Mechanism-B twin of what this plan built) is listed in 140-VALIDATION.md but is not in any plan's `files_modified` that has run so far.

---
*Phase: 140-seam-shared-resilience-core-circuit-breaker*
*Completed: 2026-07-25*

## Self-Check: PASSED

- All 5 artifacts exist on disk (both `route.ts`, both `route.test.ts`, and `route.seam.test.ts`).
- All 5 task commits exist in git (`a2c963a4`, `68b3c438`, `8f0a2cda`, `f2aa5bf3`, `df7771ca`) on `feat/v1.16-production-resilience`.
- `git diff --diff-filter=D --name-only 16871f2a HEAD` → empty: no file deletions in this plan.
- Working tree clean apart from one pre-existing untracked file (`analytics-service/scripts/nautilus_factsheet.py`) that predates this plan and was not touched.
- `npm test` → 8768 passed / 0 failed. `npm run typecheck` → exit 0. `npm run lint` → 0 errors. `npm run build` → success with both `maxDuration` pins in the functions-config manifest.
- Node 22 CI-parity run → 218/218 green.
- `.planning/**` intentionally NOT staged (gitignored; main-tree execution mode).
