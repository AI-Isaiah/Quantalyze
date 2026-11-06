---
phase: 163-harden-fail-safe-closed-and-loud
plan: 05
subsystem: api
tags: [next-route-handlers, supabase, service-role, vercel-cron, sentry, vitest, discriminated-union, anti-vacuity]

requires:
  - phase: 141.2
    provides: "the getDenominator read-error/unusable-count split this plan makes LOUD, and the close-out record that the integration harness carried an option no test passed"
  - phase: 146.2
    provides: "the csv-finalize forensic emission (strategy.csv_finalize) whose construction site is the WR-01 headline defect"
provides:
  - "Four hoisted createAdminClient() call sites across three route files — a missing-env throw is now loud AND pre-commit"
  - "checkStuckNotifications returns a discriminated union: `ok`/`indeterminate` instead of a zero that meant both"
  - "Flag-monitor terminal denominator arms answer 503 + Sentry capture, so a failed read registers as a FAILED Vercel cron run"
  - "tests/integration/cron-flag-monitor.test.ts can actually fail — three falsifier runs, proven RED under all three mutations"
affects: [ops, monitoring, audit, gdpr-intake, csv-wizard]

actuals:
  tokens: 16830   # chars/4 over the realized diff (67,320 chars across 3 commits)
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Construct the service-role client ABOVE the irreversible commit — sequencing, not error handling"
    - "One repo-wide idiom for zero-versus-unknown: a discriminated union mirroring DenominatorResult"
    - "Cron honesty: the HTTP status IS the page channel; a distinguished failure state must not be reported at 200"
    - "Ordering defects need ordering oracles — an interleaved call log, not two independent call counts"

key-files:
  created:
    - src/lib/observability.test.ts
  modified:
    - src/app/api/strategies/csv-finalize/route.ts
    - src/app/api/preferences/route.ts
    - src/app/api/account/deletion-request/route.ts
    - src/lib/observability.ts
    - src/app/api/cron/flag-monitor/route.ts
    - tests/integration/cron-flag-monitor.test.ts
    - src/__tests__/observ12-fixtures-presence.test.ts

key-decisions:
  - "Hoisted the constructor at all FOUR measured occurrences, not the roadmap's three — preferences had grown a second one on the RPC error branch"
  - "No try/catch around the constructor and no non-throwing variant: the symbol appears nowhere in code (only in planning docs, as a prohibition)"
  - "Deleted the vacuous `auditLogRows` option rather than exercising it — the route no longer materialises rows, so there is no live path to override"
  - "The flag-monitor email channel stays with the streak machinery; only status + Sentry were added, because the SEV-2 email's diagnosis is false for a failed read"
  - "Dropped a planned csv-finalize case that made the audit double throw synchronously — the real logAuditEventAsUser is total by construction, so it would have pinned an unreachable fault"

patterns-established:
  - "Half-fix killers: identity + call-count assertions defeat a 'hoist the client but still construct one at the emit site' near-miss that every ordering assertion would pass"
  - "Both-directions falsification: every collapse fix carries a control proving the honest answer survives (an empty queue is still ok:0; a quiet cron window is still 200)"

requirements-completed: [OPS-06, OPS-07]

coverage:
  - id: D1
    description: "createAdminClient() is constructed before the irreversible commit at all four occurrences; a missing service-role key throws pre-commit with nothing landed"
    requirement: OPS-06
    verification:
      - kind: unit
        ref: "src/app/api/strategies/csv-finalize/route.test.ts#[OPS-06] csv-finalize: a missing service-role key fails LOUD and PRE-COMMIT"
        status: pass
      - kind: unit
        ref: "src/app/api/preferences/route.test.ts#[OPS-06] a missing service-role key fails LOUD and PRE-COMMIT"
        status: pass
      - kind: unit
        ref: "src/app/api/account/deletion-request/route.test.ts#[OPS-06] a missing service-role key fails LOUD and PRE-COMMIT"
        status: pass
    human_judgment: false
  - id: D2
    description: "checkStuckNotifications distinguishes 'nothing stuck' from 'could not tell' via a discriminated union"
    requirement: OPS-06
    verification:
      - kind: unit
        ref: "src/lib/observability.test.ts#[OPS-06] checkStuckNotifications distinguishes zero from unknown"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed denominator read ends the flag-monitor run non-200 with a Sentry capture, so the Vercel cron run registers FAILED"
    requirement: OPS-07
    verification:
      - kind: unit
        ref: "src/app/api/cron/flag-monitor/route.test.ts#(D1/SC-I), (D1b/SC-I), (D1c/SC-I), (D2/SC-I control)"
        status: pass
      - kind: integration
        ref: "tests/integration/cron-flag-monitor.test.ts#OPS-07: ... ends the run NON-200 with reason denominator_read_failed, and PAGES"
        status: pass
    human_judgment: false
  - id: D4
    description: "The integration test falsifies both monitor behaviours — proven RED under the status revert and under both historical denominator mutations"
    requirement: OPS-07
    verification:
      - kind: integration
        ref: "mutation runs recorded verbatim in this SUMMARY (RED-proof evidence) and in the file's own docstrings"
        status: pass
    human_judgment: false
  - id: D5
    description: "The 503 cron-history semantics change (green -> failed on persistent read failure) is a real operational change to the founder's Vercel dashboard"
    verification: []
    human_judgment: true
    rationale: "Whether a red cron run every 15 minutes during a Supabase read outage is the desired signal is an operator's call, not something a test can assert. The plan and the TODOS entry priced the change in; the founder sees it first on the next real read failure."

duration: 62min
completed: 2026-08-26
status: complete
---

# Phase 163 Plan 05: Fail-safe, closed and loud — createAdminClient sequencing + monitor honesty Summary

**Committed work can no longer 500 (four hoists, three route files), and the flag monitor can no longer log a green run while blind — with an integration suite that now fails on exactly the arms it exists to guard.**

## Performance

- **Duration:** 62 min
- **Tasks:** 3 of 3
- **Files modified:** 12 (11 modified, 1 created)
- **Full vitest suite:** 807 files passed, 19 skipped; 12,614 tests passed, 281 skipped

## Accomplishments

- **All four measured `logAuditEventAsUser(createAdminClient(), ...)` occurrences hoisted above their irreversible commits.** The roadmap said three; the research measured four, and the fourth (the preferences RPC *error* branch) fails in a different direction from the other three — it commits nothing, but a throw there replaced a classified 400/401/500 with an opaque 500.
- **`checkStuckNotifications` now returns a discriminated union.** `0` used to mean both "healthy queue" and "the read failed", and `count ?? 0` re-imported the same collapse on a path the error branch could not see.
- **Both flag-monitor terminal denominator arms answer 503 plus a Sentry capture.** The classification was already correct before this phase and paged nobody, because both arms returned at the default 200 and Vercel cron history keys success off the status code.
- **The integration harness's vacuous `auditLogRows` option is deleted and replaced by two options the new cases actually pass.** The file was entirely green under both shipped denominator mutations; it no longer is.

## Task Commits

1. **Task 1: Hoist createAdminClient above the irreversible commit — four occurrences, three files** — `07e33ca51` (fix)
2. **Task 2: checkStuckNotifications — "nothing stuck" is not "could not tell"** — `78ce08def` (fix)
3. **Task 3: The denominator read PAGES — and the integration test can actually fail** — `3c18bc4d1` (fix)

## The four sites fixed

| # | File | Position relative to the commit | What the throw used to do |
|---|------|--------------------------------|---------------------------|
| 1 | `src/app/api/strategies/csv-finalize/route.ts` (hoist now at the top of `finalizeAtomicOrErrorResponse`, above the `finalize_csv_strategy_with_returns` fold) | AFTER the fold committed a strategy, its verification row and its whole daily-returns series in one transaction | 500 over a live track record — the exact inverse of the emit docblock's own promise that "a failed emission … must NOT change this response" |
| 2 | `src/app/api/preferences/route.ts` — success emit (`mandate_preference.update`) | AFTER `update_allocator_mandates` UPSERTed the row, bumped `mandate_edited_at` and enqueued a rescore | 500 over a saved mandate |
| 3 | `src/app/api/preferences/route.ts` — error-branch emit (`mandate_preference.update.failed`) | On the RPC error branch; nothing committed | Converted the route's classified 400 / 401 / 500 answers into one opaque 500 — the failure-audit path swallowing the classification it exists to record |
| 4 | `src/app/api/account/deletion-request/route.ts` | AFTER the GDPR Art. 17 intake row INSERTed | 500 for an erasure request that IS on file, with the 30-day SLA clock already running |

One hoist per handler covers sites 2 and 3, so the diff is three `const admin = createAdminClient()` lines. `git grep "logAuditEventAsUser(createAdminClient(),"` now returns zero code hits (three prose mentions remain in the new explanatory comments and one in a pre-existing test comment).

**Out of scope, deliberately left alone:** csv-finalize's two `after()`-epilogue admin usages. They are already try/catch-wrapped dynamic imports, and the plan named them as out of scope. They are still visible in a grep for `const admin = createAdminClient()` at that file's lines 1875 and 1991 — that is expected, not a missed site.

**Not done, per the locked decision:** no `…OrNull` variant, no try/catch around the constructor, no class-wide source-scan gate. The forbidden symbol appears nowhere in `src/`, `tests/` or `analytics-service/` — only in this phase's three planning documents, where it is named as a prohibition.

## What happened to `auditLogRows`

**Deleted.** The plan allowed either exercising it or removing it; removal is correct here because the option has no live path left to override. The route stopped materialising rows in 141.2 (D-02 replaced the distinct-`correlation_id` dedup with a server-side COUNT), so an override of the row-materialising answer can only ever configure a branch the route no longer takes. Exercising it would have manufactured coverage of a dead path — the same shape of dishonesty the option itself was an instance of.

Two things were preserved and one thing was added:

- **Preserved: the shape-distinguishing default.** The double still answers the COUNT chain and a row-materialising select *differently* (`{count}` vs `{data, count: null}`). That is what lets the suite disagree with a route that silently regressed to row materialisation — such a route now gets `count: null` back and terminates. Deleting the override did not delete the disagreement.
- **Preserved: the max_rows-capped page**, so the truncation shape is still what deployed PostgREST would return.
- **Added: `auditLogError` and `auditLogCount`**, both passed by the new cases. `auditLogCount` is read with a `hasOwnProperty` check rather than `??`, because `auditLogCount: null` is a *meaningful* value here (the absent-content-range shape) and `??` would silently swap it for the healthy total — reintroducing the exact collapse these cases exist to falsify, inside the double meant to falsify it.

## RED-proof evidence

Every mutation below was applied to the source, measured, and reverted; each restore was verified by `shasum` against a pre-mutation byte backup, and each is recorded in the relevant test's own docstring.

### Falsifier 1 — the createAdminClient sequencing (OPS-06)

| Mutation | Result |
|---|---|
| **deletion-request:** remove the hoist, construct inline at the emit site | `× throws BEFORE the intake row is INSERTed` — `AssertionError: expected 1 to be +0` (the row landed *and* the request threw) |
| **preferences:** remove the hoist, restore both inline constructions | 2 failures: `AssertionError: expected construction before the commit; got ["rpc:update_allocator_mandates","createAdminClient"]: expected 1 to be less than 0`, and `AssertionError: the mandate UPSERT ran before the throw — the pre-fix behaviour: expected { …(2) } to be undefined` |
| **csv-finalize:** remove the hoist, restore the inline construction | 2 failures: `expected construction before the commit; got ["rpc:finalize_csv_strategy_with_returns","createAdminClient"]`, and `the fold committed before the throw — the pre-fix behaviour: expected [ …(2) ] to be undefined` |
| **csv-finalize HALF-FIX:** keep the hoist *and* construct inline at the emit site | `× the emit receives the SAME instance that was built pre-commit` — `expected "vi.fn()" to be called 1 times, but got 2 times` |

The half-fix mutation is the one worth noting: it passes every ordering assertion (a client *was* built before the fold) while leaving the original post-commit throw exactly where it was. Only the identity + call-count assertion kills it.

### Falsifier 2 — checkStuckNotifications (OPS-06)

| Mutation | Result |
|---|---|
| (a) collapse the error arm back to a zero-count success | 1 failure: `expected 'ok' to be 'indeterminate'` |
| (b) replace the usable-count guard with `count ?? 0` | **3** failures — null, NaN *and* negative all return `kind: "ok"`. The spread is the point: `?? 0` is not a partial fix, it is the same collapse on three paths the error branch cannot see |
| (c) answer `indeterminate` unconditionally | 2 failures: `expected 'indeterminate' to be 'ok'` and `expected { kind: 'indeterminate', …(1) } to deeply equal { kind: 'ok', stuck: 7 }` |

Mutation (c) exists because a fix that answered "could not tell" to everything would satisfy (a) and (b) while being exactly as useless as the collapse it replaced. The distinction has to hold in both directions.

### Falsifier 3 — the paging denominator (OPS-07)

| Mutation | Result |
|---|---|
| (a) revert the terminal status to 200 | **All three** falsifier runs fail on `expected 200 to be 503` — and *only* on that. Every `reason` assertion still passes, which is precisely why status is asserted separately from classification |
| (b) **M1** — collapse the read-error arm to `{ kind: "ok", total: 0 }` | the read-error run fails: `expected 'zero_denominator' to be 'denominator_read_failed'` |
| (c) **M2** — disarm the usable-count guard, restore `count ?? 0` | **2** runs fail: `count: null` on the same reason mismatch, and `count: NaN` on `expected true to be false` (NaN passed straight through as a rate with both alert arms disarmed) |

**This file was entirely green under M1 and M2 before today.** Both mutations are now killed, satisfying the plan's requirement that the new cases kill both.

Two controls guard the other direction: a genuinely empty window still returns 200, still routes to the H-2 streak, and does *not* capture to Sentry; a healthy window is still a plain 200. Without them, "return 503 more often" would pass every falsifier while destroying the zero-traffic escalation — replacing a no-page with a permanent page, which is the 141.2 trade in reverse.

## Files Created/Modified

- `src/app/api/strategies/csv-finalize/route.ts` — hoist above the fold RPC (+ rationale comment)
- `src/app/api/preferences/route.ts` — one hoist above `update_allocator_mandates`, covering both emit sites
- `src/app/api/account/deletion-request/route.ts` — hoist above the intake INSERT, below the idempotency branch
- `src/lib/observability.ts` — `StuckNotificationsResult` discriminated union; null/NaN/negative counts are indeterminate
- `src/lib/observability.test.ts` — **new**; 7 cases covering all arms plus the threshold-window argument
- `src/__tests__/observ12-fixtures-presence.test.ts` — byte pin re-recorded 927 → 3003 in the same commit, plus a scope note saying this file is a *deletion gate*, not a contract test
- `src/app/api/cron/flag-monitor/route.ts` — `denominatorReadFailed()` helper: 503 + awaited Sentry capture, shared by both terminal arms
- `src/app/api/cron/flag-monitor/route.test.ts` — status + capture assertions on D1/D1b/D1c, and a no-page assertion on the D2 control
- `tests/integration/cron-flag-monitor.test.ts` — `auditLogRows` deleted; `auditLogError`/`auditLogCount` added and exercised; three table-driven falsifier runs + two controls
- Three route test files gained hoisted `createAdminClient` doubles (promoted from inline arrows so the constructor can throw) and interleaved call-order oracles

## Decisions Made

1. **Ordering assertions, not call counts.** "Constructed" and "constructed early enough" are different claims, and only the second is the fix. The preferences and csv-finalize suites now keep an interleaved `callOrder` log so the assertion is about sequence directly rather than inferred from two independent counters.
2. **`hasOwnProperty` over `??` in the integration double.** Detailed above — using `??` there would have put the bug inside the test harness.
3. **The flag-monitor email channel was left alone.** Only status + Sentry were added. A failed read is not a zero window, and the SEV-2 email asserts a diagnosis ("no traffic OR the audit-write is failing") that is false for a read failure and would send the operator to the Python audit path for a fault living in this query.
4. **The OBSERV-12 `minBytes` floor stayed at 700** while `recordedBytes` moved to the measured 3003. The pin is a deletion gate; raising the floor in lockstep with every edit would quietly turn it into a size ratchet.

## Deviations from Plan

### 1. [Rule 1 — Test correctness] Dropped a planned csv-finalize case that would have pinned an unreachable fault

- **Found during:** Task 1
- **Issue:** The plan's second behaviour bullet asked each route to prove "with a working client whose audit emission fails, the handler's response is unchanged". Implemented literally for csv-finalize — whose test file mocks `@/lib/audit` wholesale — this meant making the `logAuditEventAsUser` double throw synchronously. It did, and the throw escaped the handler, which initially looked like a second live bug.
- **Why it is not:** the real `logAuditEventAsUser` cannot throw synchronously. It wraps its `after()` scheduling in try/catch, falls back to `queueMicrotask`, and `emitAsUser`'s rejection is swallowed by `.catch(() => {})`. It is total by construction, so no production input produces the fault the double was simulating. Pinning it would have manufactured a failure rather than guarded a real one.
- **Fix:** replaced that case with one that pins something real — the emit must receive the *same instance* built pre-commit, with exactly one construction per request. That case is what kills the half-fix mutation. The half of the plan's behaviour spec that *is* reachable (a failing emission must not change the response) is covered where the real audit module runs: preferences TC13 (pre-existing) and a new deletion-request case that drives the service-role RPC to throw. A comment in the csv-finalize file records why the third arm is absent there, so the gap is visible rather than silent.
- **Files modified:** `src/app/api/strategies/csv-finalize/route.test.ts`
- **Verification:** full vitest suite green; the substitute case demonstrated RED under the half-fix mutation.
- **Committed in:** `07e33ca51`

### 2. [Rule 2 — Missing critical coverage] Added controls the plan did not ask for

- **Found during:** Tasks 2 and 3
- **Issue:** The plan's falsifiers all pointed one way (a failure must be reported as a failure). A fix that reported *everything* as a failure would have passed all of them.
- **Fix:** added `checkStuckNotifications`'s honest-zero cases and the flag-monitor's empty-window / healthy-window controls, and demonstrated the over-fix mutation RED against them.
- **Files modified:** `src/lib/observability.test.ts`, `tests/integration/cron-flag-monitor.test.ts`
- **Committed in:** `78ce08def`, `3c18bc4d1`

---

**Total deviations:** 2 (1× Rule 1, 1× Rule 2). **Impact:** no scope creep — deviation 1 removed a fabricated oracle and replaced it with a stronger real one; deviation 2 closed a one-directional falsifier.

## Issues Encountered

- **The worktree had no `node_modules`.** Symlinked to the main checkout's (`/node_modules` is gitignored, so the link is not committed and `git status` stays clean). Without it, `npx` downloads a *different* vitest instead of failing, which would have made every run above unattributable.
- **First attempt at the M2 mutation broke the route file syntactically** rather than mutating it — every test failed, for the wrong reason. Discarded and redone surgically (disarm the guard condition, restore `?? 0`), which produced the two clean, attributable failures reported above. A mutation that reddens everything proves nothing.

## User Setup Required

None.

## Next Phase Readiness

- OPS-06 and OPS-07 are closed at the measured coordinates. SC-2's remaining surface is nil for this plan.
- **Operational note for whoever watches the dashboard:** the flag-monitor cron will now show FAILED runs during a persistent Supabase read failure, where it previously showed green. That is the point of the change, and it was priced in when the TODOS entry was filed — but it is the first time this cron can go red, so the first occurrence should not be mistaken for a regression in the cron itself.
- `checkStuckNotifications` still has no runtime caller. Wiring one was explicitly declined as new scope (research open question 5). The contract is now pinned by its own unit test, so a future consumer can rely on the union shape.

---
*Phase: 163-harden-fail-safe-closed-and-loud*
*Completed: 2026-08-26*

## Self-Check: PASSED

- All 9 claimed files verified present on disk (`src/lib/observability.test.ts` created; 8 modified).
- All 3 claimed commit hashes verified in `git log`: `07e33ca51`, `78ce08def`, `3c18bc4d1`.
- No file deletions across the three commits (`git diff --diff-filter=D` over the range: empty).
- `createAdminClientOrNull` appears in zero code files; only in this phase's three planning documents, as a prohibition.
- Leak scan of this SUMMARY: no local absolute paths, no username, no production URL, no email, no uid.
