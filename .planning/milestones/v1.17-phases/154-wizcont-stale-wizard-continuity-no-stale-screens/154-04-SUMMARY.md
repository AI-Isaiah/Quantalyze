---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 04
subsystem: frontend
tags: [react-hook, polling, postgrest, nextjs, route-handler, projection, absence-is-not-a-value]

# Dependency graph
requires:
  - phase: 154-01
    provides: "the PROD verdict (M2(ii)) and the RED pin T2 this plan greens"
  - phase: 95
    provides: "useStrategySyncPoller (the two-arm hook) + the sync-progress route, its projection contract and its RT-1 invariant"
provides:
  - "useStrategySyncPoller ladder arm: a zero-rows read reports NO status and consumes missingRowGracePolls (TWIN-3 closed)"
  - "missingRowGracePolls is consumed by BOTH arms — the option declared at :61 is no longer half-dead"
  - "GET /api/strategies/[id]/sync-progress projects jobStatus for SINGLE-KEY strategies (stitch-preferring selection)"
  - "SyncProgressResponse.jobStatus null now means 'zero compute_jobs rows for this strategy'"
  - "route.test.ts byte-identity pins for the composite response (serialized, key order included)"
affects: [154-08, SyncPreviewStep, SyncProgress]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-file donor: the defective arm is repaired by mirroring its own sibling arm's semantics, not by inventing a rule"
    - "Two counters for two facts — an absent row and a failed read never share an escalation counter"
    - "Byte-identity pin written and observed green BEFORE the diff it guards (serialized-string assertion, not toEqual)"
    - "Stitch-preferring fallback: widen a filter only where the old code returned the empty answer, so the widening cannot move the existing arm"

key-files:
  created: []
  modified:
    - src/hooks/useStrategySyncPoller.ts
    - src/hooks/useStrategySyncPoller.test.ts
    - src/components/strategy/SyncProgress.poll.test.tsx
    - src/app/api/strategies/[id]/sync-progress/route.ts
    - src/app/api/strategies/[id]/sync-progress/route.test.ts
    - src/lib/sync-progress.ts

key-decisions:
  - "Job selection is stitch-PREFERRING (latest stitch, else latest of any kind), NOT the plan's literal 'latest across all kinds'. The literal form contradicts the plan's own acceptance criterion that composite expectations be unchanged: PIN-COMPOSITE-WINS and the pre-existing ':483' case both drive a composite strategy whose newest job is not the stitch, and both would have had to be rewritten. The chosen form is additive by construction — the fallback is reachable only where the route previously answered IDLE."
  - "stalled is stitch-ONLY, computed behind an isStitch flag rather than left to fall through to claimed_at. claimed_at never refreshes, so the fall-through would emit a false stalled:true on a long healthy single-key crawl and invite the user to abort working work."
  - "The absent-row counter is separate from consecutiveErrors and resets on a present row (consecutive absences, not cumulative), mirroring the ladder arm's own reset-on-clean-read discipline."
  - "console.warn fires ONCE per effect run, not per poll — a 15-minute wait must not bury the console it was added to inform."
  - "StitchJobStatus was NOT renamed despite now carrying non-stitch statuses. The CHECK constraint (migration 20260411144407) is table-wide, so the union is already exact for every kind; a rename would churn 154-08's imports for a docblock's worth of clarity."

patterns-established:
  - "A test that pins a defect is labelled as such and replaced by the commit that fixes it — the 'before' is measured so the change is legible instead of asserted"

requirements-completed: []

# Metrics
duration: 20min
completed: 2026-08-12
---

# Phase 154 Plan 04: STALE-01a shared layer Summary

**The poller's ladder arm no longer answers "pending" when it read nothing, and the sync-progress route no longer hides a single-key strategy's in-flight job behind a composite-only filter — 154-01's T2 goes green and composite responses are provably byte-identical across the widening.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-12T08:20:00Z
- **Completed:** 2026-08-12T08:40:00Z
- **Tasks:** 2 (3 commits — the route task is a pin commit followed by the widening, by design)
- **Files modified:** 6

## The 154-01 verdict this plan executed against

`154-INVESTIGATION.md` settles the supplier as **M2(ii)**, from PROD evidence rather than from code
reading: Alpha Centauri's `compute_analytics_from_csv` job reached `done` at **11:39:35.342759**,
all 22 job rows terminal, `attempts = 1`, `last_error` null — the backend had finished while the
wizard still rendered "Fetching trades…". M2(ii) *is* the null-coercion arm at
`useStrategySyncPoller.ts:228-229`, i.e. the exact line Task 1 removes. **M3, M4 and M2(i) are ruled
out by that evidence**, so this plan's fix is evidence-backed rather than speculative, and it was
not widened beyond what M2(ii) supports. (154-07's backend arm is the NO-OP arm as a result.)

## RED → GREEN transition (the deliverable)

**At 154-01's HEAD**, `src/hooks/useStrategySyncPoller.test.ts` reported:

```
 ❯ |jsdom| src/hooks/useStrategySyncPoller.test.ts (5 tests | 1 failed) 34ms
     × T2: a zero-rows read is NEVER reported as the fabricated "pending" status

AssertionError: The poll read NOTHING — PostgREST's { data: null, error: null } zero-rows answer —
and the hook reported "pending", a value no writer ever wrote. …
  expected [ 'pending', 'pending', …(11) ] to not include 'pending'
```

**After Task 1** (`1aa83aee`), with the test's oracle unedited:

```
 ✓ src/hooks/useStrategySyncPoller.test.ts > T2: a zero-rows read is NEVER reported as the fabricated "pending" status 4ms
 ✓ … > LADDER-CTRL: a real terminal row IS reported and reaches onTerminal (positive counterpart)
 ✓ … > GRACE-ladder: a persistently absent row escalates via onError at the grace boundary
 ✓ … > INTERVAL-CTRL: the interval arm DOES report a real row through this double
 ✓ … > SYM-interval: the interval arm reports NOTHING for the identical zero-rows read
 ✓ … > DOUBLE: the zero-rows double is PostgREST's real shape, not an invention
 Test Files  2 passed (2)   Tests  18 passed (18)
```

**Thirteen fabrications from thirteen empty reads → none.** Every control 154-01 wrote to keep T2
from passing vacuously (LADDER-CTRL, INTERVAL-CTRL, SYM-interval, DOUBLE) is still green, unedited.

**The three surface cases 154-01 left RED are STILL RED, unchanged**, and that is correct — they
belong to 154-08:

```
 × T1: a status frozen at pending past the patience window stops claiming trades are being fetched
 × T1b: a single-key strategy gets the interrupted-sync affordance the composite arm already gets
 × T2b: a kickoff 200 whose body says queued:false does not put the wizard in the in-flight claim
 × T3: the single-key arm does NOT render a terminal refusal from a mid-re-derive empty series
 (WAITING-CTRL, REFUSAL-CTRL, T3b green — the properties a fix must not break)
```

Same four before and after this plan: 576 passed / 4 failed across the wizard-steps suite. This plan
moved nothing at the surface, by design — see the TWIN-5 note below.

## Accomplishments

- **TWIN-3 closed.** The ladder arm meets `{data:null,error:null}` the way the interval arm 70 lines
  up always has: it reports no status at all. `grep -c '?? "pending"'` → **0**.
- **The half-dead option is now real.** `missingRowGracePolls` was declared at `:61` and read by one
  arm; it is consumed by both (`:163` interval, `:268` ladder). No new option, no new threshold — the
  plan's instruction to check whether a "missing row" concept was being re-invented was the right
  one.
- **The clean-null read is observable** (Rule 12). It logged *nothing* before, which is precisely why
  M2(ii)'s two internal candidates (RLS-filtered vs genuinely absent) cannot be distinguished from
  the 2026-08-04 incident. It now warns once per run, naming the strategy id and both possible facts.
- **The in-flight datum reaches single-key callers.** A single-key strategy produces no
  `stitch_composite` job, so the route discarded every row it had and answered IDLE while
  `process_key_long` ran. `jobStatus` is now available to it, and `jobStatus: null` carries the
  stronger meaning "zero compute_jobs rows".
- **Composite behaviour is pinned as bytes, not as shape**, and the pins were observed green against
  the unmodified route before the widening existed.

## Task Commits

1. **Task 1: Close TWIN-3 — the ladder arm stops fabricating "pending"** — `1aa83aee` (fix)
2. **Task 2 step 1: byte-identity pins, measured pre-widening** — `cc11534f` (test)
3. **Task 2 step 2: widen the kind filter** — `cbb65517` (feat)

The pin commit provably precedes the widening (`git log --oneline`: `cbb65517` → `cc11534f` →
`1aa83aee`), and `git diff HEAD -- route.test.ts | grep '^[-+].*PIN-COMPOSITE'` over the widening
commit is **empty** — the composite expectations were not touched to make the widening pass.

## Files Created/Modified

- `src/hooks/useStrategySyncPoller.ts` — ladder arm: `if (!statusRow)` consumes a separate
  `consecutiveAbsentRows` counter, warns once, escalates through the existing `escalate()`/`onError`
  sink at the grace boundary, otherwise `scheduleNext()` silently. The status read afterwards is
  `statusRow.computation_status` with no coalesce. Docblocks updated for both arms.
- `src/hooks/useStrategySyncPoller.test.ts` — adds `GRACE-ladder` (the positive half: reporting
  nothing is not an exit — the grace window must terminate the wait) and a `console.warn` spy. T2's
  oracle is untouched.
- `src/components/strategy/SyncProgress.poll.test.tsx` — adds `PIN 9`: the OTHER consumer of the
  shared hook, driven with the exact `{data:null,error:null}` shape the ladder fix is about (PIN 2
  drives PGRST116, an error-as-value — a different branch). Grace consumed unchanged, escalation
  once at poll 11, no consecutive-error escalation, and 11 reads actually happened. PINs 1-8 are
  byte-untouched.
- `src/app/api/strategies/[id]/sync-progress/route.ts` — two-pass stitch-preferring selection, an
  `isStitch` flag gating `memberProgress` and `stalled`, and the false-stall hazard written into the
  code rather than left in a plan.
- `src/app/api/strategies/[id]/sync-progress/route.test.ts` — 27 cases (was 19): 2 byte-identity
  pins, 6 widened-arm cases, 1 changed premise.
- `src/lib/sync-progress.ts` — docblocks only: `jobStatus`'s new meaning, `stalled`'s stitch-only
  derivation, and the note that the status union is table-wide (so the widening did not widen a
  domain). No type changed.

## Decisions Made

1. **Stitch-preferring selection instead of the plan's literal "latest across all kinds."** See
   Deviations #1 — the literal form contradicts the plan's own acceptance criteria.
2. **`stalled` gated on `isStitch` rather than left to the `claimed_at` fall-through.** The plan
   named the hazard; the code now names it too. `claimed_at` is stamped once at claim and never
   refreshed, so a long healthy single-key crawl would cross the 12-minute threshold and be reported
   stalled — and the stall affordance invites a retry, i.e. it would push users to abort work that
   is fine. `WIDEN-NO-FALSE-STALL` drives a 13-minute-old claim and asserts `false`.
3. **Separate counter, consecutive semantics.** An absent row and a failed read are different facts
   (the file's own C-3 rule), so `consecutiveErrors` is untouched by an absent row and vice versa.
   The absent counter resets on a present row, matching the arm's existing reset-on-clean-read
   discipline. Both counters stay effect-local, so a re-activation restarts the grace exactly as the
   interval arm's `attempts` does.
4. **Warn once per run, not per poll.** A 15-minute ladder would otherwise emit hundreds of lines
   and bury the signal the warning exists to provide.
5. **`StitchJobStatus` not renamed.** The `compute_jobs.status` CHECK (migration `20260411144407`,
   verified in the migration file) is table-wide, so the union is already exact for `process_key_long`
   and friends. Renaming would churn 154-08's imports to buy what a docblock buys.

## Deviations from Plan

### Auto-fixed / design deviations

**1. [Rule 7 — conflicting instructions, surfaced not blended] Job selection is stitch-preferring, not "latest across all kinds"**

- **Found during:** Task 2, reading `route.test.ts` before writing the pins.
- **Issue:** The plan's action step says "select the latest row across ALL kinds (by created_at, as
  today) instead of only `stitch_composite`". Its acceptance criteria say "Composite test
  expectations are UNCHANGED by the widening (git diff of the pin cases between the two commits is
  empty)". These cannot both hold: the pre-existing case at `route.test.ts:483` ("picks the LATEST
  stitch_composite by created_at and ignores other kinds") drives a composite strategy whose newest
  row overall is a `sync_trades`, and a global-latest rule flips its expectation from `running` to
  `done` and empties its `memberProgress`.
- **Fix:** Two passes — latest stitch, else latest of any kind. The fallback is reachable *only*
  where the old code returned IDLE, so the widening is additive by construction and every composite
  expectation survives untouched. I wrote `PIN-COMPOSITE-WINS` specifically to hold this property
  down, since it is the one a future "simplification" would delete.
- **Also better on the merits:** a composite strategy's stitch row is the only row carrying member
  progress or a heartbeat, so displacing it with an unrelated newer job would degrade the composite
  panel to answer from a job that knows nothing about members.
- **Files modified:** `src/app/api/strategies/[id]/sync-progress/route.ts`
- **Commit:** `cbb65517`

**2. [Rule 1 — the existing test pinned the defect] One existing case changed premise**

- **Found during:** Task 2.
- **Issue:** `"returns {jobStatus:null, stalled:false, memberProgress:[]} 200 when no stitch_composite
  job exists"` drove a **running** `sync_trades` row. It was pinning the hiding itself — a job in
  flight, answered "nothing running".
- **Fix:** its premise is now an empty job list (IDLE means what it says); the old premise's new
  answer is asserted by `WIDEN-SINGLE-KEY-RUNNING`, and `PIN-SINGLE-KEY-BEFORE` recorded the old
  answer against the unmodified route in the preceding commit so the change is measured rather than
  asserted. Its expectation object is unchanged — only what it feeds the route changed.
- **Commit:** `cbb65517`

**3. [Doc-only] `src/lib/sync-progress.ts` touched, though not in the plan's `files_modified`**

- **Issue:** the contract module's docblocks stated "null = no `stitch_composite` job visible" and
  described `StitchJobStatus` as the stitch-only domain. After the widening both sentences were
  false, and 154-08 reads this module to build its screens.
- **Fix:** docblocks corrected. No type, constant or exported value changed.
- **Commit:** `cbb65517`

### Not deviations, recorded for the reader

- **TWIN-5 is only one-third closed and nothing is observable yet.** This plan owns the route filter
  (`sync-progress/route.ts:185`). `SyncPreviewStep.tsx:910` still gates the *fetch* behind
  `if (isComposite)` and `:2290` still gates the *render* — both are 154-08's. The client therefore
  never asks, so the widened answer changes no screen today. Deliberate, and stated so the next
  reader does not mistake a green route test for a fixed wizard.
- **The wizard passes no `missingRowGracePolls` yet**, so its ladder still polls indefinitely on an
  absent row — silently now, instead of while claiming the computation is queued. Wiring the caller
  is 154-08's (`GRACE-ladder` proves the mechanism is ready and terminates).

## Constraint compliance

| Binding constraint | Evidence |
|---|---|
| No new timeout/threshold literal in production code | The only numeric literals added to the hook are `= 0` / `+= 1` on a counter, matching the file's existing `consecutiveErrors`. `git diff … \| grep '^+' \| grep '[0-9]'` shows no constant. `STALL_THRESHOLD_MS` and the ladder constants are referenced, never moved. |
| Oracle independence | `TERMINAL_STATUSES` stays hand-typed (never `isComputedAnalytics`); `GRACE-ladder`'s grace value is a hand-typed `2`; the route pins are hand-typed serialized strings. |
| PostgREST double shape | `ZERO_ROWS` = `{data:null,error:null}` exactly, still guarded by the `DOUBLE:` case. |
| `vi.spyOn` + `restoreAllMocks`, never `vi.stubGlobal` | The added `console.warn` spy uses `vi.spyOn`; `afterEach` already calls `vi.restoreAllMocks()`. No `stubGlobal` anywhere in the touched files. |
| Terminal set / `isComputedAnalytics` untouched (Pitfall 1) | The terminal check at the ladder arm is byte-unchanged. |
| Ref/deps discipline survives | `git diff` over the deps array lines (`enabled, strategyId, schedule, isLadder, maxConsecutiveErrors, maxAttempts, missingRowGracePolls`) is empty; both new counters live inside the effect closure. |
| RT-1 | `grep -c "strategy_analytics" route.ts` → **0** (the docblock says "the analytics table" in prose). `WIDEN-RT-1` asserts it structurally on the new arm too. |
| The other two `isComposite` gates untouched | `SyncPreviewStep.tsx` is not in this plan's diff at all. |

## Verification

```
node_modules/.bin/vitest run src/hooks src/components/strategy/SyncProgress.poll.test.tsx \
  "src/app/api/strategies/[id]/sync-progress" src/lib/sync-progress --no-file-parallelism
#  Test Files  6 passed (6)      Tests  85 passed (85)

node_modules/.bin/tsc --noEmit          # clean
node_modules/.bin/eslint <6 touched files>   # clean

node_modules/.bin/vitest run "src/app/(dashboard)/strategies/new/wizard/steps" \
  src/lib/seam-poll-disjointness.pin.test.ts src/__tests__/contracts --no-file-parallelism
#  Tests  4 failed | 576 passed (580)  — the SAME four 154-01 left RED for 154-08

node_modules/.bin/vitest run "src/app/api/og/factsheet/[id]/route.test.tsx" \
  src/components/strategy/ApiKeyManager.test.tsx src/lib/api/limiter-ordering.test.ts
#  Tests  31 passed (31)   — adjacent consumers of the touched modules
```

⚠️ Run from the worktree with `node_modules` symlinked from the main checkout, and via
`node_modules/.bin/*` rather than `npx` (in this repo `npx tsc` resolves an unrelated package).

## Known Stubs

None. No placeholder, empty-value or TODO path was introduced.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. The widened projection stays inside
the existing `get_user_compute_jobs` trust boundary (auth.uid()-scoped SECURITY DEFINER, no new
caller-supplied input), and `WIDEN-REDACTION` extends the T-95-07 no-blob assertions — metadata,
all five ciphertext column names, `last_error` and `claimed_at` — to the new arm.

## Threat register dispositions

| Threat ID | Disposition | Discharged by |
|---|---|---|
| T-154-04-A (redaction bypass via widened projection) | mitigated | `WIDEN-REDACTION` — exact top-level key whitelist + 12 forbidden substrings on the non-stitch arm, with a rogue `member_progress` planted on a kind that has no members and dropped |
| T-154-04-B (zero-rows-under-RLS read as a domain value) | mitigated | T2 + `GRACE-ladder` + the once-per-run `console.warn` |
| T-154-04-C (cross-tenant job read) | mitigated | ownership untouched — same `auth.uid()`-scoped RPC, same ownership pre-check, no new input; the diff adds no argument to `supabase.rpc` |
| T-154-04-D (false `stalled:true` aborting healthy long jobs) | mitigated | `stalled` gated on `isStitch`; `WIDEN-NO-FALSE-STALL` drives a 13-min-old `claimed_at` and asserts `false` |
| T-154-SC (package installs) | accepted | no package installed |

## Self-Check: PASSED

All six modified files exist on disk; all three commit hashes resolve in `git log --all`
(`1aa83aee`, `cc11534f`, `cbb65517`). No file deletions in any commit
(`git diff --diff-filter=D HEAD~1 HEAD` empty at each step). STATE.md and ROADMAP.md were not
touched — the orchestrator owns those writes.

## For 154-08

- `jobStatus` is now available for single-key strategies, but **only after `SyncPreviewStep.tsx:910`
  stops gating the fetch behind `if (isComposite)`** — the datum exists and nobody asks for it.
- `jobStatus === null` from a real (non-`degraded`) read means **zero compute_jobs rows** — the
  branch-(d)/M4 tell, i.e. "nothing was ever enqueued", distinct from `degraded: true` ("we could not
  read").
- `stalled` will be `false` for every single-key job by construction. The single-key stall story has
  to come from the wizard's own SF-1 backstop clock, not from this route.
- The ladder poller now accepts `missingRowGracePolls`; wiring it gives the wizard a bounded exit
  from a permanently-absent analytics row through the existing `failPolling` → `SYNC_FAILED` sink.
  Choose the value from an EXISTING constant — this plan added none.
