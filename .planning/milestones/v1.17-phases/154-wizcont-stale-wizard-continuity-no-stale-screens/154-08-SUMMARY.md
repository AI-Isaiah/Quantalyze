---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 08
subsystem: ui
tags: [react, wizard, polling, stale-read, semantic-color, mutation-testing, twin-register, a11y]

# Dependency graph
requires:
  - phase: 154-01
    provides: "the PROD verdict M2(ii)/M1 and the four deliberately-RED pins T1/T1b/T2b/T3 this plan greens, plus T3b as the symmetry control"
  - phase: 154-04
    provides: "GET /api/strategies/[id]/sync-progress projecting jobStatus for SINGLE-KEY strategies (jobStatus:null == zero compute_jobs rows), and the poller ladder arm that no longer fabricates 'pending'"
  - phase: 154-05
    provides: "SC-1 mutation evidence transcribed into the falsifiability ledger"
  - phase: 154-06
    provides: "SC-3 mutation evidence transcribed into the falsifiability ledger"
provides:
  - "the single-key wizard has every exit from waiting_for_complete the composite arm had — TWIN-2 (render gate) and TWIN-5 (client fetch gate) closed"
  - "the kickoff's `queued` flag is honoured: a 200 that enqueued nothing is no longer rendered as work in flight (M4)"
  - "the single-key R2-5 twin (TWIN-1): a terminal status over a series that measures zero repolls instead of refusing"
  - "UI-SPEC State Contract 3 — the amber `wizard-sync-recomputing` block, gated on in-flight EVIDENCE"
  - "the in-flight claim line renders only while the claim is current (UI-SPEC §2 hard rule)"
  - "heavyFetchErrorsRef's 'never needs a reset' invariant retired and both non-throwing repolls reset it (RESEARCH A6)"
  - "154-VALIDATION.md closed: zero pending ledger rows, nyquist_compliant: true"
affects: [156-connect-refactor, SyncPreviewStep, useStrategySyncPoller]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A guard added for one arm belongs to the CLASS: the twin is cloned by its READING, not by its line — the single-key predicate is deliberately narrower than the composite's because the arms measure different things"
    - "A claim about the present is rendered only while a datum supports it; where it does not, an honest state block renders instead and the sentence is withheld rather than re-copywritten"
    - "A closed set derived from an existing union (FINISHED_JOB_STATUSES over StitchJobStatus) instead of a new threshold"
    - "A test that pins a defect changes PREMISE when the defect is fixed, and says so in its own comment — the 154-04 precedent, applied to SINGLE-KEY NEUTRALITY"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.progress.render.test.tsx
    - src/app/api/strategies/create-with-key/route.ts
    - .planning/phases/154-wizcont-stale-wizard-continuity-no-stale-screens/154-VALIDATION.md

key-decisions:
  - "The single-key repoll predicate is `tradeCount === 0 && csvRowCount === 0 && analytics != null`, NOT the composite's literal `series.length === 0`. A bare csvRowCount check would hang every trades-backed onboarding forever, and it would ALSO have reddened readfailure's genuinely-empty positive counterpart — which says in its own message that a fix over-reaching onto accounts it CAN measure is a defect."
  - "The repoll is NOT bounded by a count — the SCREEN is bounded instead. Bounding the loop would have required a new threshold, which the phase forbids; the existing SF-1 patience clock already surfaces the interrupted banner and its idempotent Retry."
  - "`missingRowGracePolls` was deliberately NOT wired from the wizard, against the plan's optional suggestion. The analytics row genuinely does not exist for the whole early part of a first sync, so MAX_CONSECUTIVE_POLL_ERRORS (3) as a grace would terminally refuse a healthy first sync about nine seconds in."
  - "The in-flight claim line is WITHHELD rather than replaced when it is not current. UI-SPEC authorises exactly two new strings and neither is a status-line replacement; rendering nothing invents nothing, and another honest block carries the state."
  - "No new WizardErrorCode was minted — GATE 1's verdict is M2(ii), which surfaces existing affordances. Both EXPECTED_TABLE_SIZE pins stay at 75 and wizardErrors.* is byte-untouched."
  - "A6 is resolved by resetting heavyFetchErrorsRef on BOTH non-throwing repolls, not just the new one: the composite guard had already falsified the invariant, so an instance-fix would have left the class open."

patterns-established:
  - "A mutation is re-applied to the FIXED tree, not only observed against the pre-fix one — a fix that greens a test by weakening the test is otherwise indistinguishable from one that works"
  - "The second-member mutation is the acceptance check on a class fix: removing the composite R2-5 guard must redden T3b and ONLY T3b"

requirements-completed: [STALE-01]

# Metrics
duration: ~95min
completed: 2026-08-12
---

# Phase 154 Plan 08: STALE-01 fix side Summary

**The wizard stopped telling single-key users that their trades were being fetched by a job that had already finished, and stopped telling them their strategy has no track record while the table holding it was mid-replacement — one class, four gates, closed together and proven by mutations re-applied to the fixed tree.**

## Preflight (verbatim, as required)

```
$ git rev-parse HEAD
54a0d26dd3b56708e2daa8bd494ed6eed22bde5b        # NOT the expected base — worktree forked from main
$ git fetch origin && git reset --hard 555fb78f6a12a0cd3ee4b7cb961c86cc4937d217
HEAD is now at 555fb78f docs(phase-154): tracking after 154-06
$ git rev-parse HEAD
555fb78f6a12a0cd3ee4b7cb961c86cc4937d217
$ test -f .../154-06-SUMMARY.md && echo BASE_OK
BASE_OK
$ ls node_modules/.bin/vitest && echo DEPS_OK
node_modules/.bin/vitest
DEPS_OK
```

⚠️ **The worktree DID fork from `main`.** Without the reset this plan would have re-implemented or
clobbered 154-01 through 154-07. Every command below ran against `555fb78f` or a descendant, and
every test invocation used `node_modules/.bin/vitest` (never `npx`, which in this repo resolves an
unrelated package).

## Performance

- **Duration:** ~95 min
- **Tasks:** 3 of 3
- **Files modified:** 5 (0 created)
- **Commits:** 3

## Per-label test verdicts (the deliverable)

Run: `node_modules/.bin/vitest run --no-file-parallelism --reporter=verbose <the two pin files>`

| Label | Before (`555fb78f`) | After (`116397ad`) |
|---|---|---|
| **T1** — a status frozen at pending past the patience window stops claiming trades are being fetched | ❌ **FAIL** | ✅ **PASS** |
| **T1b** — a single-key strategy gets the interrupted-sync affordance the composite arm already gets | ❌ **FAIL** | ✅ **PASS** |
| **T2b** — a kickoff 200 whose body says `queued:false` does not put the wizard in the in-flight claim | ❌ **FAIL** | ✅ **PASS** |
| **T3** — the single-key arm does NOT render a terminal refusal from a mid-re-derive empty series | ❌ **FAIL** | ✅ **PASS** |
| **T3b** — the composite arm in the IDENTICAL empty-series state repolls instead of refusing | ✅ PASS | ✅ **PASS (unchanged)** |
| WAITING-CTRL (positive counterpart) | ✅ PASS | ✅ PASS |
| REFUSAL-CTRL (positive counterpart) | ✅ PASS | ✅ PASS |

Baseline, measured before any edit: `Tests 4 failed | 3 passed (7)`.
After: `Tests 7 passed (7)`, then `Tests 8 passed (8)` once the new cases landed.

⭐ **`SyncPreviewStep.stale.runtime.test.tsx` has a ZERO-LINE diff against the base**
(`git diff 555fb78f..HEAD -- <file>` is empty), so T1/T1b/T2b were greened with their 154-01
oracles byte-untouched. In `stale-refusal` the diff is 248 added / 11 removed, and
`git diff … | grep "^-" | grep -c "expect("` → **0**: every removed line is harness plumbing
(function signatures, the analytics-row literal, a docblock). No assertion was modified.

New cases added by this plan, all green: `AMBER`, `NO-RED-WHILE-IN-FLIGHT`, `NO-EVIDENCE`,
`NUMBERS`, `A6`.

## Task Commits

1. **Tasks 1 + 2: the class fix (TWIN-2, TWIN-5, M4, TWIN-1, UI-SPEC state 3, A6) + its tests** — `116397ad` (fix)
2. **Task 3 (prerequisite): symbol-anchor four `file:line` citations** — `3dd63220` (docs)
3. **Task 3: close the falsifiability ledger** — `5c12ed71` (docs)

## What changed, gate by gate

**TWIN-2 — the render gate.** `showInterruptedBanner` was `isComposite && (…)`. The banner markup,
its `data-testid`, its `role="status"` and its Retry handler all already existed, and the SF-1
backstop clock was never composite-aware. One conjunct withheld the only exit from
`waiting_for_complete` from the users with no other one. That is **M1** — why the 2026-08-04 stall
was *unbounded* rather than merely wrong, and why the founder's only available action was to re-run
a chain that had already succeeded, three times.

**TWIN-5 — the client fetch gate.** 154-04 widened the route; the client never asked. The
`if (isComposite)` around the sync-progress piggyback is gone. A shape check (`Array.isArray(json.memberProgress)`)
now refuses a 2xx that is not the projection — added because widening the fetch exposes the arm to
bodies it never used to see, and the previous code would have thrown from **inside a `setState`
updater**, where React may re-run it during render and take the whole step down.

**M4 — kickoff honesty.** `queued` is read additively beside `composite`, on the RESPONSE only.
`process-key-onboard-contract.ts` (which has a bidirectional pytest oracle) is untouched, and
nothing about what we *send* changed. Only the explicit `queued === false` acts; an absent field —
which is what the composite branch emits — keeps the prior meaning. The retry path reads its own
body for the same fact rather than inferring it from the 2xx, which is the finding itself.

**TWIN-1 — the single-key R2-5 twin.** A `return "repoll"` placed **before** `checkStrategyGate`.
The existing null-count throws are untouched: this is a third state, not a fourth `??`.

**UI-SPEC State Contract 3.** `wizard-sync-recomputing`: `role="status"`,
`rounded-md border border-warning/40 bg-warning/5 px-4 py-3` — byte-identical tokens to the
`wizard-sync-interrupted` banner it clones — with the two verbatim UI-SPEC strings. Inline branch,
**no new component file** (`git diff --diff-filter=A` is empty). Red renders only on a verdict that
is current.

## Decisions Made

### 1. The single-key predicate is narrower than the composite's, on purpose

The composite guard is `series.length === 0`, and a composite has zero trades *by construction*.
A single-key strategy does not. Cloning the line rather than the reading would have meant
`csvRowCount === 0` → repoll, which

- hangs every trades-backed onboarding (a Binance strategy legitimately has 500 trades and 0 daily
  rows) in an unbounded repoll — the T-154-08-A threat, self-inflicted, and
- reddens `readfailure.runtime.test.tsx`'s *"a GENUINELY EMPTY account still renders the
  measured-zero sentence"* positive counterpart, whose own failure message says: *"the fix
  over-reached and is now refusing to answer for accounts it CAN measure."*

The guarded reading is therefore the **incoherent** one, not merely the empty one:
`tradeCount === 0 && csvRowCount === 0 && analytics != null`. A producer wrote a terminal analytics
row (so a computation ran to completion) and yet both sources that computation could have run on
measure zero. A completed producer had data; the one process that manufactures this reading is the
`run_derive_broker_dailies_job` heal-delete. A strategy that genuinely has nothing has no analytics
row to read and still earns its honest refusal.

### 2. `missingRowGracePolls` was NOT wired — a deliberate departure from the plan's optional step

The plan offered it as "verdict-dependent". Wiring it with the only available existing constant
(`MAX_CONSECUTIVE_POLL_ERRORS` = 3) would escalate to the terminal `SYNC_FAILED` envelope after
three absent-row polls — about **nine seconds**. But the analytics row is written by the worker, so
an absent row is the *normal* state for the whole opening stretch of a first sync. That is a
first-sync outage, not a backstop. Recorded rather than silently skipped; the mechanism 154-04 built
is ready and `GRACE-ladder` proves it terminates, so a future plan can wire it once the wizard has a
constant that means "how long a first sync may legitimately have no row".

### 3. RESEARCH A6 — my disposition

**The invariant is retired, and both repoll sites reset the counter.**

`heavyFetchErrorsRef`'s docblock claimed it "never needs a reset — every non-throwing heavy outcome
stops the loop, so the only path that repolls is a throw." Measured: that was **already false before
this plan** — R2-5's composite `return "repoll"` is non-throwing and has been there since Phase 89.
So A6's hazard was live on the composite arm and 154-08 would have added a second instance of it.

Under the stale invariant, a run that blipped twice, then read cleanly into the heal window, then
blipped once more would reach 3 and be escalated to `SYNC_FAILED` — "consecutive" would have stopped
meaning consecutive, and a healthy run would be terminated. Both non-throwing repolls now reset the
ref; the `catch` arm's own `return "repoll"` deliberately does **not**, because that is the throw
the counter exists to count. The old invariant is quoted in the docblock rather than deleted, so
nobody re-derives it.

Pinned by the new `A6` case (read ordinals 1,2 fail → 3 succeeds into the repoll → 4 fails) and
mutation-proven: removing the reset renders `data-error-code="SYNC_FAILED"`.

### 4. Amber requires evidence; the claim line requires evidence too — but different evidence

The amber block needs **both** halves: the arm is repolling *and* `isJobInFlight(jobStatus)`. With
no evidence it is withheld and the existing SF-1 clock provides the exit — the screen never claims a
recomputation it cannot see (`NO-EVIDENCE`, mutation-proven).

The **claim line** is suppressed on the weaker condition: any state in which "Fetching trades…" is
*known* to be false — the backstop fired, the kickoff said it queued nothing, or a repoll is running
under a terminal status. Those are different bars because they answer different questions
("what is happening?" needs evidence; "is this sentence still true?" does not).

`FINISHED_JOB_STATUSES` = `["done", "failed_final"]`, a partition of the existing `StitchJobStatus`
union — no new vocabulary. `done_pending_children` counts as in-flight, since its successors are
exactly the derive/analytics steps that perform the delete→re-upsert.

## Deviations from Plan

### 1. [Rule 1 — the test pinned the defect] `SINGLE-KEY NEUTRALITY` changed premise

- **Found during:** Task 1, running the wizard-steps directory.
- **Issue:** `SyncPreviewStep.progress.render.test.tsx` asserted `progressFetches.toHaveLength(0)`
  under the title *"no new traffic on the single-key path"*. That is TWIN-5's third gate, asserted
  as a virtue. Failing output: `AssertionError: expected [ [ …(2) ], [ …(2) ], [ …(2) ] ] to have a
  length of +0 but got 3`.
- **Fix:** the case now asserts the fetch fires and the banner reaches single-key users, *and* holds
  down the half that did **not** widen — the per-key panel stays composite-only even when the
  response body carries three member rows. Its comment records what it used to assert and why that
  was the cost being paid. Same shape as 154-04's deviation #2.

### 2. [Rule 3 — Blocking] Four `file:line` citations, two of them 154-06's, broke a repo-wide gate

- **Found during:** Task 3, the full-suite run.
- **Issue:** `src/lib/seam-citations.invariant.test.ts` is a blocking gate forbidding bare
  `file.ext:NN` on the seam surface. Two failures were mine (`route.ts:660,676`,
  `job_worker.py:2539-2560`). **Two pre-existed at the phase base** — `git show
  555fb78f:src/app/api/strategies/create-with-key/route.ts | grep …` finds
  `finalize-wizard/route.ts:1223` and `adapter.py:98-123`, landed by 154-06.
- **Fix:** all four converted to symbol-anchored references (`3dd63220`). Comment-only in both
  files — no behaviour, no control flow, no exported symbol.
- **Why I crossed the scope boundary:** ordinarily 154-06's are out of scope and would go to
  `deferred-items.md`. But this plan's own acceptance criterion is a **green full suite**, and it
  could not be met while they stood. Flagged loudly rather than fixed quietly.

### 3. [Structural] Tasks 1 and 2 landed in ONE commit

- The render's claim-line condition spans both twins (`!showInterruptedBanner && !showRecomputing`),
  and the coverage ratchet requires every new branch to ship with its test in the same commit. A
  Task-1-only commit would have compiled but split one class fix — the exact shape this phase exists
  to argue against. The commit message separates the twins explicitly.

## Constraint compliance

| Binding constraint | Evidence |
|---|---|
| ⛔ No new/moved timeout or threshold constant | `git diff … \| grep '^+' \| grep -v comment \| grep '[0-9]'` yields only `=== 0` / `> 0` / `= 0` comparisons and Tailwind classes copied verbatim from the existing banner (`h-2 w-2`, `border-warning/40`, `bg-warning/5`, `px-4 py-3`, `mt-4`). `SLOW_HINT_MS` / `WARN_THRESHOLD_MS` / `RETRY_THRESHOLD_MS` / `POLL_BACKOFF_MS` / `MAX_CONSECUTIVE_POLL_ERRORS` are referenced, never moved. |
| ⛔ Wizard error copy via `buildEnvelope()`/`wizardErrors.ts` only | No envelope was authored. `grep -c "Recomputing" src/lib/wizardErrors.ts` → **0**; the amber block is a status line, not an error envelope. |
| ⛔ No new `WizardErrorCode` | `git diff 555fb78f..HEAD --stat -- src/lib/wizardErrors.ts src/lib/wizardErrors.test.ts` → **empty**. Both `EXPECTED_TABLE_SIZE` pins still read `75`. |
| Both `isComposite` gates gone | `grep -n "isComposite"` shows 14 hits: the state declaration, two comments naming the removed gates, and the rest are **copy / member-panel / review-CTA rendering only**. Neither the render gate nor the fetch gate is keyed on it. |
| `queued` read in the kickoff arm | `grep -c "queued"` → **13** |
| Amber copy verbatim, exactly once | `grep -c "Recomputing this strategy's analytics"` → **1** (written as a JS string, not JSX text, so the apostrophe stays literal and grep-checkable against the UI-SPEC) |
| No new component file | `git diff 555fb78f..HEAD --diff-filter=A --name-only` → **empty** |
| `vi.spyOn` + `restoreAllMocks`, never `vi.stubGlobal` | the extended file's `afterEach` already calls `vi.restoreAllMocks()`; no `stubGlobal` added |
| Next.js semantics assumed from training data | Not applicable — `SyncPreviewStep.tsx` is a `"use client"` component; no framework API was added. The `next-cache-components` hook fired on a Read of this file; cache directives have no bearing on a client component and none were introduced. |

## Verification (real numbers)

```
node_modules/.bin/vitest run --no-file-parallelism <the two pin files>
#  Tests  7 passed (7)        (baseline before any edit: 4 failed | 3 passed)

node_modules/.bin/vitest run --no-file-parallelism "src/app/(dashboard)/strategies/new/wizard/steps"
#  Test Files  22 passed (22)     Tests  483 passed (483)

node_modules/.bin/vitest run --no-file-parallelism "src/app/(dashboard)/strategies/new/wizard" \
    src/hooks src/components/strategy/SyncProgress.poll.test.tsx
#  Test Files  36 passed (36)     Tests  636 passed (636)

npm run test:coverage
#  Test Files  779 passed | 19 skipped (798)
#  Tests  11759 passed | 287 skipped (12046)     ← 0 failed
#  Statements 86.48% · Branches 80.95% · Functions 83.41% · Lines 88.52%
#  gates 82/80/74/72 — all CLEAR, no threshold error emitted

node_modules/.bin/tsc --noEmit        # clean
npm run lint                          # 0 errors, 2 warnings (both pre-existing, in files not touched)
grep -rn MUTANT src/                  # 0
git status --short                    # clean after the mutation quartet
```

`wizardErrors.test.ts` is inside the full run and is green; its two `EXPECTED_TABLE_SIZE` pins are
byte-unchanged.

## SC-2 falsifiability quartet (re-applied to the FIXED tree)

Each was applied to production source at `116397ad`, observed RED, and reverted.

| Mutation | Reddened | Key assertion |
|---|---|---|
| Re-add `isComposite &&` on `showInterruptedBanner` | **T1, T1b, T2b** (3) | `expected null not to be null`; and T1 received `"…Fetching trades...1000sSync is taking much longer than expected…"` |
| Restore `?? "pending"` in the poller ladder arm | **T2, GRACE-ladder** (2) | `expected [ 'pending', 'pending', …(11) ] to not include 'pending'` |
| Remove the single-key repoll guard | **T3, AMBER, NO-RED, NO-EVIDENCE, NUMBERS, A6** (6) | `The wizard rendered a TERMINAL red envelope during the series heal-delete window …: expected <div role="alert" …> to be null` |
| **Remove the COMPOSITE R2-5 guard (2nd member)** | **T3b, and ONLY T3b** (1) | `Losing it closes TWIN-1 in the wrong direction: two arms agreeing on the WRONG answer is not symmetry.` |

⭐ The second-member row is the one that matters: it reddened **exactly one** case. The single-key
twin did not make the composite arm redundant, so this is a class fix and not an instance fix
wearing class-fix clothes — the failure mode that scrapped 37 commits on Phase 140.

Two further mutations added by this plan, both observed RED and reverted: the A6 reset, and the
amber block's `isJobInFlight` conjunct.

## What I could NOT verify (stated plainly, not omitted)

1. **No browser, and no live database.** Everything above is jsdom under fake timers with hand-built
   PostgREST doubles. Real tick scheduling, real React concurrency and real payloads are outside it.
2. **The Playwright e2e specs did not run here** (`e2e/wizard-resume.spec.ts` and the rest). They
   need the shared TEST DB and seeded fixtures; they run in CI's `e2e-seeded` batch. Recorded in the
   ledger as authored-and-CI-wired rather than as verified.
3. **The SQL gate did not run here** (`supabase/tests/test_api_keys_venue_identity_uniq.sql`) — no
   Postgres in this worktree. It is the one ledger row marked **skipped-with-reason**.
4. **The un-gated sync-progress fetch adds one request per poll tick for every single-key
   strategy.** It is fire-and-forget, cosmetic, and follows the existing `POLL_BACKOFF_MS` cadence
   (no new timer), but I did not measure its load against the route's rate limiter on PROD.
5. **`stalled` is `false` for every single-key job by construction** (154-04 gated it on `isStitch`),
   so on PROD the single-key banner will come from the SF-1 backstop, not from the route. The
   `stalled === true` single-key path is exercised only by the double.
6. **The amber block has not been seen by a human.** It matches the UI-SPEC tokens and clones a
   shipped banner's shape, but no visual pass was run.
7. **The em-dash half of the Numbers Contract is discharged by ABSENCE, not by a rendered `—`.** The
   recomputing screen renders no metric cell at all, so there is no cell to put an em-dash in. The
   `NUMBERS` case asserts six hand-typed stale renderings and both fabricated-zero sentences are
   absent, with the amber heading as the non-vacuity fence — but a reviewer looking for a literal
   `—` assertion will not find one, and should not.

## Known Stubs

None. Every branch added here is wired end to end: the fetch reaches a real route, the flag comes
from a real response body, and every new render path has a test that drives the real component.

## Threat register dispositions

| Threat ID | Disposition | Discharged by |
|---|---|---|
| T-154-08-A (self-inflicted DoS: infinite spinner / unbounded repoll) | mitigated | The repoll is bounded by evidence, not by a count: in-flight → amber; no evidence → the interrupted banner + the existing idempotent Retry, via the SF-1 clock. The predicate is narrow enough that no trades-backed strategy can enter the state at all. |
| T-154-08-B (stale number presented as fresh) | mitigated | `NUMBERS` — six hand-computed stale renderings asserted absent from the recomputing screen |
| T-154-08-C (screen claims a state the backend has left) | mitigated | The claim line renders only while it is current; `NO-EVIDENCE` pins the other direction (no claim of recomputation without a job to point at) |
| T-154-SC (package installs) | accepted | none installed |

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. The one new outbound request is to
an existing owner-scoped route (`GET /api/strategies/[id]/sync-progress`, whose
`auth.uid()`-scoped SECURITY DEFINER read and top-level key whitelist 154-04 pinned), issued for a
`strategyId` the component already holds. The added `Array.isArray` check narrows what the client
will act on rather than widening it.

## Self-Check: PASSED

Files (all exist on disk):
- FOUND: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (modified)
- FOUND: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx` (modified)
- FOUND: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.progress.render.test.tsx` (modified)
- FOUND: `src/app/api/strategies/create-with-key/route.ts` (modified)
- FOUND: `.planning/phases/154-wizcont-stale-wizard-continuity-no-stale-screens/154-VALIDATION.md` (modified)

Commits (all resolve in `git log`): `116397ad`, `3dd63220`, `5c12ed71`.

No file deletions in any commit (`git diff --diff-filter=D HEAD~1 HEAD` empty at each step). No
untracked files left behind. `STATE.md` and `ROADMAP.md` NOT modified — the orchestrator owns those.
