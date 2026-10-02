---
phase: 140-seam-shared-resilience-core-circuit-breaker
plan: 04
subsystem: wizard
tags: [seam, circuit-breaker, wizard-errors, error-classification, client-bundle-boundary, tdd, mutation-testing]

# Dependency graph
requires:
  - phase: 140-01
    provides: "CircuitOpenError — the dependency-free leaf at @/lib/seam-errors"
  - phase: 140-02
    provides: "validateKey/encryptKey propagate CircuitOpenError unwrapped from the resilience core"
provides:
  - "SERVICE_UNAVAILABLE_RETRY wizard error code + honest, retryable copy"
  - "classifyKeyValidationError(error: unknown) — TYPE-checked CircuitOpenError branch ahead of the substring cascade"
  - "Both wizard key-connect routes thread the caught error OBJECT and emit 503 + Retry-After on a breaker trip"
  - "maxDuration = 300 pinned in-repo on create-with-key and composite/add-key"
affects: [140-05 Mechanism-A route error mapping, 140-07 no-raw-analytics-fetch lint rule, 141 retry]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies — locked constraint honoured
  patterns:
    - "Type-before-substring classification: an instanceof branch placed ahead of a message-matching cascade, with the ordering itself pinned by a collision-regression test rather than by comment alone"
    - "Grep-guard hygiene: prose that would trip an acceptance grep is spelled out (c-i-r-c-u-i-t) so the guard cannot be defeated by the very comment explaining it"
    - "Dynamic same-registry import of a class under test in files that call vi.resetModules(), so instanceof compares against the class the SUT actually threw"

key-files:
  created: []
  modified:
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/api/strategies/composite/add-key/route.ts
    - src/app/api/strategies/composite/add-key/route.test.ts

key-decisions:
  - "classifyKeyValidationError's parameter widened string -> unknown rather than adding an overload: both call sites already had the object in hand, and a widened parameter means zero pre-existing call sites or tests changed"
  - "String(error) fallback keeps the classifier TOTAL for `throw {}` / `throw undefined`, so a catch block can never throw a second time"
  - "Retry-After is attached ONLY on the CircuitOpenError path and asserted ABSENT on other 5xx paths, so the header stays a meaningful breaker signal rather than decoration"
  - "route.audit.test.ts required NO changes — its expectations survived the signature change untouched, so no audit assertion was weakened"
  - "Both fixes mutation-verified: reverting object-threading kills 2 route tests; moving the instanceof branch below the cascade kills the collision test"

patterns-established:
  - "The acceptance grep and the explanatory comment must not collide — verify guard greps against the finished file, not the intended file"

requirements-completed: [SEAM-04]

# Metrics
duration: 13min
completed: 2026-07-25
---

# Phase 140 Plan 04: Wizard Class-2 Cascade-500 Closure Summary

**A circuit-breaker trip during wizard key-connect now surfaces as an honest, retryable 503 `SERVICE_UNAVAILABLE_RETRY` with a `Retry-After` header instead of the terminal "something went wrong, our team has been notified" 500 — classified by error TYPE ahead of the substring cascade, with the class imported from the zero-import leaf so the ten `"use client"` wizard components gain no bundle weight.**

## Performance

- **Duration:** ~13 min
- **Tasks:** 2/2 (both TDD: RED → GREEN)
- **Files created:** 0 · **Files modified:** 6
- **Tests:** 8781 passing (+13 net new), 0 failing

## Accomplishments

- **The Class-2 cascade-500 is closed at the type level.** `classifyKeyValidationError` now takes the caught value (`unknown`) and branches on `error instanceof CircuitOpenError` at line 959 — ten lines ahead of the first `lower.includes` at 969. A breaker trip can no longer reach the terminal `{code:"UNKNOWN", status:500}` no matter what its message says.
- **The collision regression is pinned, not assumed.** A `CircuitOpenError` whose message carries `timeout`, `rate`, or `signature` tokens still classifies as `SERVICE_UNAVAILABLE_RETRY`. This is the test that actually encodes the ordering invariant — and it is the one that dies when the branch is moved (see Mutation Verification).
- **The branch is provably type-driven, not text-driven.** A test asserts that the breaker's own message *as a plain string* stays `UNKNOWN`. That negative assertion is what makes a future `lower.includes("circuit")` "simplification" impossible to land silently — research Pitfall 2 names exactly that substring branch as the warning sign.
- **B-1 satisfied at the strongest available level.** `wizardErrors.ts` has exactly ONE runtime import: `@/lib/seam-errors`, which itself has ZERO import statements. The `./strategyGate` import is `import type` and erases at compile time. So the entire runtime import closure of the module reachable from ten `"use client"` components is a single dependency-free leaf — `@upstash/*` and `Redis.fromEnv()` cannot reach the wizard bundle.
- **`route.audit.test.ts` stayed green with zero edits.** The plan flagged it as the file that breaks with no owner; in practice its expectations (status codes + `{ code }`-only bodies) were orthogonal to the signature change. No audit assertion was touched, let alone weakened.
- **Both routes remain byte-identical in the catch arm**, preserving the "single-key and + Add another key can never drift" property the shared classifier exists to guarantee.

## Task Commits

1. **Task 1 (TDD): wizardErrors type-first classification** — `5d909559` (test, RED — 6 failing) → `5625549f` (feat, GREEN — 71/71)
2. **Task 2 (TDD): thread the object through both routes + maxDuration** — `1756482f` (test, RED — 4 failing, all `expected 500 to be 503`) → `454917e6` (feat, GREEN — 176/176)

**Plan metadata:** not committed — `.planning/**` is gitignored (`.gitignore:52`); this SUMMARY lives in the working tree only, per the main-tree execution mode for this run.

## Files Modified

- `src/lib/wizardErrors.ts` — `SERVICE_UNAVAILABLE_RETRY` added to the union and to `WIZARD_ERROR_COPY`; classifier signature widened to `unknown` with the `instanceof` branch first. The import carries an 18-line load-bearing comment naming both constraints (browser bundle, mock survival) so a future refactor cannot "simplify" it into the seam graph.
- `src/lib/wizardErrors.test.ts` — 7 new tests in a dedicated SEAM-04 describe.
- `src/app/api/strategies/create-with-key/route.ts` — `classifyKeyValidationError(err)`, conditional `Retry-After`, `maxDuration = 300`.
- `src/app/api/strategies/create-with-key/route.test.ts` — 3 new tests (validateKey trip, encryptKey trip, non-breaker negative control), inserted BEFORE the `vi.resetModules()`-using H-0306 describe.
- `src/app/api/strategies/composite/add-key/route.ts` — the same three changes, deliberately mirroring the sibling.
- `src/app/api/strategies/composite/add-key/route.test.ts` — the same 3 tests.

## Acceptance Criteria

| Criterion | Result |
|---|---|
| `grep -c "SERVICE_UNAVAILABLE_RETRY" src/lib/wizardErrors.ts` ≥ 3 | 3 |
| `grep -cE 'includes\("circuit' src/lib/wizardErrors.ts` = 0 | 0 |
| `grep -c 'from "@/lib/seam-errors"' src/lib/wizardErrors.ts` = 1 | 1 |
| `grep -cE 'from "@/lib/(analytics-client\|resilient-fetch)"' src/lib/wizardErrors.ts` = 0 | 0 |
| `instanceof CircuitOpenError` precedes first `lower.includes` | 959 < 969 |
| `grep -c "export const maxDuration = 300"` (both routes) | 1 and 1 |
| `grep -cE 'classifyKeyValidationError\((err\|error)\.message\)'` (both routes) | 0 and 0 |
| Both route tests: CircuitOpenError → 503 AND code ≠ UNKNOWN | asserted, green |
| `route.audit.test.ts` green | green, UNMODIFIED |
| `npm test` | 691 files, 8781 passed, 0 failed (287 skipped) |
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors (1 pre-existing `EquityChart.tsx` warning, untouched) |
| Node 22 CI parity | 176/176 green on the 4 touched suites |

## Mutation Verification

A passing test is not evidence it would catch the regression it names, so both load-bearing claims were mutated:

| Mutation | Expected kill | Actual |
|---|---|---|
| `classifyKeyValidationError(err)` → `(message)` in create-with-key | route SC-5b tests | **2 failed** (both breaker tests); the negative control correctly stayed green |
| `instanceof` branch moved BELOW the substring cascade | collision regression | **1 failed** — exactly the "TYPE wins over SUBSTRING" test |

The second result is the informative one: the plain `new CircuitOpenError(30)` test still PASSED under that mutation, because the class's static message collides with no branch. Without the collision test, the ordering invariant would have been silently unguarded. Both files were restored via a path-scoped `git checkout --`; `git status` shows no modified tracked files.

## Decisions Made

1. **Widened the parameter rather than adding an overload.** `(error: unknown)` accepts every existing `string` call site unchanged, so all pre-existing classifier tests and both call sites compiled without edits — `npm run typecheck` was green after Task 1 alone. An overload would have added surface for no behavioural gain.
2. **`String(error)` rather than a narrow `Error`-only path.** `throw {}` / `throw undefined` are legal JS; a `message.toLowerCase()` on a non-string throws a SECOND error from inside a catch block, which surfaces as an unhandled 500 — the exact failure mode this plan exists to remove. Both non-Error shapes are test-pinned to `UNKNOWN`.
3. **`Retry-After` only on the breaker path, and its ABSENCE asserted elsewhere.** Attaching it to every 5xx would make it noise; the negative control (`ETIMEDOUT` → `KEY_NETWORK_TIMEOUT`, no `Retry-After`) keeps the header meaningful and doubles as proof the routes did not collapse every error into the breaker arm.
4. **Copy asserts "your key has not been saved."** The breaker short-circuits *before* any request is issued, so this is literally true, and it is the fact that makes retrying feel safe (a user who fears a duplicate key will not retry). The honesty is test-enforced, alongside a T-140-14 assertion that the copy matches none of `/circuit|breaker|upstash|redis|railway|http|localhost/i`.
5. **Dynamic `import("@/lib/seam-errors")` inside the route tests.** `create-with-key/route.test.ts` calls `vi.resetModules()` in a later describe; a static import would bind to a class object that a reset can orphan, reproducing the class-duplication artifact 140-01 documented. Taking the class from the same registry as `importPost()` makes the tests order-independent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] My own explanatory comment tripped two of the plan's acceptance greps**

- **Found during:** Task 1 (post-GREEN verification)
- **Issue:** The comment warning future maintainers never to write `lower.includes("circuit")` contained that literal, so `grep -cE 'includes\("circuit'` returned 1 instead of the required 0, and the ordering check (`instanceof` must precede the first `lower.includes`) reported the comment's line 949 ahead of the branch at 957. The guards were reporting a violation that did not exist — and worse, would have gone on reporting it forever, training a future reader to ignore them.
- **Fix:** Reworded to spell the word out (`c-i-r-c-u-i-t`) with an inline note saying exactly why. Both greps now return the required values and the ordering check reads real code lines only.
- **Files modified:** `src/lib/wizardErrors.ts`
- **Verification:** `includes("circuit` → 0; `instanceof` at 959 < first `lower.includes` at 969.
- **Committed in:** `5625549f`

### Out of Scope — Not Actioned

**Vercel plugin recommendation: adopt Workflow DevKit for `create-with-key/route.ts:240`.** A PostToolUse hook flagged pre-existing "manual retry logic" and recommended replacing it with Workflow DevKit steps. Not actioned, for three reasons: retry is explicitly excluded from this phase (it is 141's scope), the plan locks "zero new npm dependencies", and the flagged line is pre-existing code outside this plan's change surface. Recorded here rather than in a new tracker file, per the project's single-source-of-truth backlog rule (root `TODOS.md`).

---

**Total deviations:** 1 auto-fixed (Rule 3). No Rule 4 architectural decisions. No scope creep.

## Issues Encountered

- **None blocking.** The plan predicted the two route call sites would break typecheck after the signature change; they did not, because widening `string` → `unknown` is source-compatible. Task 1 was independently typecheck-green, which made the two-task split cleaner than planned rather than messier.
- **`route.audit.test.ts` needed no changes**, contrary to the plan's contingency. Its assertions are about status codes and body shape, both of which the change preserves exactly.
- **Node 22 CI-parity run performed** (`PATH=/opt/homebrew/opt/node@22/bin`, v22.22.1): 176/176 green across the four touched suites, matching local Node 25. Every new test that spies on `console.error` restores it in-test; no new `vi.stubGlobal("fetch")` was introduced, so this repo's known CI-only failure cause is not in play.

## Threat Flags

None. All security-relevant surface is enumerated in the plan's `<threat_model>`:

- **T-140-14** (copy leaking internals) — mitigated and TESTED: the new copy is static and a test asserts it matches none of `/circuit|breaker|upstash|redis|railway|http|localhost/i` and carries no un-interpolated `{placeholder}` tokens.
- **T-140-15** (4xx misclassified as outage) — mitigated: the new branch fires ONLY on `instanceof CircuitOpenError`, which 140-01's SC-3c guarantees a 4xx never produces. The negative-control tests confirm `KEY_NETWORK_TIMEOUT`/`KEY_AUTH_FAILED`/`KEY_PROBE_FAILED` semantics are untouched.
- **T-140-16** (secrets in classifier/logs) — mitigated: the classifier receives the error only, never the request body. No new log line was added; the pre-existing server-side `console.error(message)` is unchanged and H-0305's "raw message never reaches the client" is re-asserted by the `Object.keys(json) === ["code"]` test on the new 503 path.
- **T-140-31** (server-only seam graph in the browser bundle, B-1) — mitigated and mechanically proven: `wizardErrors.ts`'s only runtime import is `@/lib/seam-errors`, which has 0 import statements. Neither file contains an actual `import "server-only"` statement (the matches are comment references to the convention).

No new endpoint, auth path, file-access pattern, or schema change was introduced. `maxDuration = 300` cannot raise the routes' worst-case lambda hold — the Vercel project setting already exceeds it; the export exists so the headroom invariant has an in-repo source of truth.

## Known Stubs

None. Every arm of the new classification path is implemented and test-pinned in both routes.

## Next Phase Readiness

**Ready.**

- **140-05** — `SERVICE_UNAVAILABLE_RETRY` is now available as a shared wizard code if any Mechanism-A route wants the same wizard-facing envelope. The `Retry-After` construction in both routes (`{ ...NO_STORE_HEADERS, "Retry-After": String(err.retryAfterS) }`) is the reusable shape. Note the nine Mechanism-A routes still surface `CircuitOpenError` as an unhandled throw — 140-05 owns them.
- **140-07** — no new raw `fetch` was introduced; the `no-raw-analytics-fetch` rule has nothing to grandfather here.
- **Carry-over note for a reviewer:** `classifyKeyValidationError` is still a substring cascade for every non-breaker path, and its collision-invariant comment (`wizardErrors.ts:936-946`) remains the contract any new branch must be checked against. This plan added the FIRST type-checked branch; if a future phase adds a second error class, it belongs alongside the `instanceof` block at the top, not in the cascade.

---
*Phase: 140-seam-shared-resilience-core-circuit-breaker*
*Completed: 2026-07-25*

## Self-Check: PASSED

- All 6 modified source artifacts exist on disk; 0 files created (this plan modifies only).
- All 4 task commits exist in git (`5d909559`, `5625549f`, `1756482f`, `454917e6`) on `feat/v1.16-production-resilience`.
- `git diff --diff-filter=D --name-only df7771ca..HEAD` → empty: no file deletions in this plan.
- Working tree clean apart from one pre-existing untracked file (`analytics-service/scripts/nautilus_factsheet.py`) that predates this plan and was not touched. Both mutation-test files fully restored.
- `npm test` → 691 files / 8781 tests green, 0 failed. `npm run typecheck` → exit 0. `npm run lint` → 0 errors.
- Node 22 CI-parity run on the 4 touched suites → 176/176 green.
- `.planning/**` intentionally NOT staged (gitignored; main-tree execution mode). STATE.md / ROADMAP.md left to the orchestrator.
</content>
