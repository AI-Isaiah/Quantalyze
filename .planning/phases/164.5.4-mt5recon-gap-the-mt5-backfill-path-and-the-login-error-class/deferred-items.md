# Phase 164.5.4 — deferred items (out of scope, discovered during execution)

Logged under the executor SCOPE BOUNDARY rule: discovered while running a plan's own
`<verify>`, NOT caused by that plan's changes, and therefore not fixed here.

## [164.5.4-SESSIONMONITOR-ORDER-FLAKE] — order-dependent failure in `test_mt5_session_monitor.py`

- **Found during:** plan 01, task 3 `<verify>`
  (`pytest tests/ -q -x -k "mt5 or ingestion_mt5 or job_worker"`).
- **Symptom:** `test_CRITERION_2_a_dark_reading_drives_the_heal_with_no_human_and_no_restart`
  failed once, logging
  `mt5 session monitor: the tick did not complete inside its own 0.0s cadence`.
  A **0.0s** cadence is the tell: the assertion is racing a wall-clock budget that
  had already been consumed, not observing a behavioural defect.
- **Not caused by plan 01, measured rather than assumed:**
  `grep -ac 'mt5_validation\|classify_mt5_login_error\|_PHRASES\|_TOKENS'` returns
  **0** for BOTH `tests/test_mt5_session_monitor.py` and
  `services/mt5_session_monitor.py`. Neither the test nor its module can reach
  anything this plan changed.
- **Reproduction is order/timing dependent:** the case PASSES in isolation
  (`-k` on its own name, 1 passed); it FAILED on one whole-file run and PASSED
  (78/78) on the immediately following whole-file run; the full `-k` selection then
  went green at **1060 passed, 4 skipped**.
- **Why it is not fixed here:** a pre-existing timing flake in an unrelated module.
  Fixing it would mean re-deriving that monitor's cadence budget, which is outside
  plan 01's files and outside the phase's subject.
- **Suggested owner:** whichever phase next touches `services/mt5_session_monitor.py`.
  The durable fix is a cadence budget the test controls rather than one it races.

---

## From plan 02 (D-03, the rotate-secret half of defect 3)

### D-164.5.4-02-1 — `npm run test` is NOT green on this machine, and none of the failures is this plan's

**Measured, twice, at this plan's HEAD:**

| run | scope | result |
|---|---|---|
| full suite | `npm run test` | 11 files failed, 54 tests failed, 14929 passed |
| re-run of the 10 failing files, alone | targeted | 7 files failed, **36 failed, 0 assertion failures** |

**Every one of the 36 is `Error: Test timed out` (33 × 5000ms, 2 × 30000ms,
1 × 20000ms). ZERO are assertion failures.** The failing suites are the ones
that `spawnSync` bash/node subprocesses — `drift-check-scripts`,
`lint-sql-gates`, `mutation-annotation-parser`, `mutation-runner-floors`,
`mutation-runner-neuter` — plus two heavy compute/RTL suites
(`scenario-montecarlo`, `ScenarioComposer.save`). None of them imports any file
this plan touched.

⚠️ **Why this is recorded rather than fixed.** The cause is an oversubscribed
box: three worktree agents were executing this phase's wave concurrently, and
these suites shell out per assertion. Raising `testTimeout` would be a change
to gates this plan has no mandate over, and would trade a loud environmental
signal for a quiet one.

⛔ **Do NOT read this as "the suite is green".** It is not green here. What IS
measured green, alone and at exit 0, is the plan's own verification scope:
`npx vitest run src/lib/ src/app/api/keys/` → **207 files, 4450 passed, 0
failed**.

For the ledger, post-merge, from the main checkout (deliberately NOT appended
from a worktree — WINDOWS.md entries 19 and 20 are both records of a
concurrent-append race losing entries):

```
gsd-tools windows append --kind unrun-verify --phase 164.5.4 \
  --file package.json \
  --description "npm run test does not complete green on a loaded dev box: 36/36 failures are subprocess-spawning suite TIMEOUTS (drift-check-scripts, lint-sql-gates, mutation-*, scenario-montecarlo, ScenarioComposer.save), zero assertion failures, none in files plan 164.5.4-02 touched. CI is the authority; re-read there."
```

### D-164.5.4-02-2 — two PRE-EXISTING time-dependent flakes, observed both green and red at the same HEAD

Both were observed passing alone and failing under load **at the same commit**,
so they are non-deterministic rather than broken by this plan:

1. `src/app/api/keys/[id]/permissions/route.seam.test.ts` →
   *"cache MISS + breaker open … NOTHING is cached"*, `expected '18' to be
   '19'`. The case seeds a breaker lock with a TTL of **19** and then asserts
   the `Retry-After` header equals 19. The assertion reads the OBSERVED
   remaining TTL, so one second of wall clock between the seed and the response
   turns it red. Nothing about the code path is involved.
2. `src/lib/seam-venue-vocabulary.invariant.test.ts` → *"every SCAN EXCLUSION
   is PINNED by what it removes"*, `Test timed out in 5000ms` (observed at
   5295 ms). The case re-runs the real `analytics-service/**` emitter scanner
   once per exclusion; it has no per-test timeout override and rides the 5 s
   default.

⛔ Neither was touched. A fix for (1) would have to compare against the
observed TTL rather than the seeded literal, which is a change to somebody
else's gate and needs its own decision.

```
gsd-tools windows append --kind deviation --phase 164.5.4 \
  --file "src/app/api/keys/[id]/permissions/route.seam.test.ts" \
  --description "PRE-EXISTING time-dependent flake: the case seeds a breaker TTL of 19 and asserts Retry-After == '19', so one second of wall clock between seed and response yields '18' and reds. Observed green alone and red under load at the SAME commit during 164.5.4-02."
```

### D-164.5.4-02-3 — `verify-plan-anchors` is RED on this tree for a structural reason, not a stale claim

`node scripts/verify-plan-anchors.mjs --pending` reports exactly two misses,
both in `164.5.4-06-PLAN.md`: it `@`-references `164.5.4-04-SUMMARY.md` and
`164.5.4-05-SUMMARY.md`, which do not exist because plans 04 and 05 have not
executed yet. 39 claims checked, and **every anchor and symbol plan 02 asserts
resolves**. This clears itself when wave 2 lands; it is recorded so the red is
not mistaken for a stale claim of this plan's.

---

## [164.5.4-SUITE-TIMEOUT-CONTENTION] the full `npm run test` suite is not green in a parallel worktree

**Found during:** plan 03, task 2 verification (`npm run test`).
**Status:** open, NOT fixed, NOT caused by plan 03.

**MEASURED, twice, in worktree `agent-a412b7aa8f26e6606`:**

| run | test files failed | tests failed | duration |
|---|---|---|---|
| 1 | 8 | 45 | 951 s |
| 2 | 12 | 58 | ~1000 s |

The verdict is **non-deterministic between two runs of the same tree**, which is itself the tell.

**Failure-mode census of run 2 (58 failures):**

| reason | count |
|---|---|
| `Test timed out in 5000ms` | 53 |
| `Test timed out in 30000ms` | 2 |
| `Test timed out in 20000ms` | 1 |
| `AssertionError` (plan-anchor, see below) | 2 |

**56 of 58 are timeouts.** The heaviest offender, `src/__tests__/drift-check-scripts.test.ts`,
still reports 13–14 timeouts when run ENTIRELY ALONE (301 s wall, 581 tests) — these are
subprocess-spawning harness tests measured against a 5 s default while the box is shared with the
other executors of this wave. `scenario-montecarlo.test.ts` failed in the suite and **passes in
isolation**, which is the same story in one file.

**⭐ ATTRIBUTION, measured rather than asserted.** Every one of the 12 failing files was grepped
for `KeyPermissionBadge`, `probe-vocabulary` and `probe_vocabulary`: **0 hits in all 12**. None
imports, scans or reads either file plan 03 changed, and a timeout cannot be produced by a
250-line client-component edit in a file the test never loads. Plan 03's own two files are GREEN
inside the failing suite run and green standing alone (67/67).

⚠️ The plan's own `<verify>` says *"Run this alone — the full suite must not share the box with
another heavy run."* A wave executor **cannot honour that**: it is dispatched concurrently with its
wave siblings by construction. That is a property of parallel dispatch, not of this phase.

---

## [164.5.4-ANCHOR-PENDING-SUMMARY] plan 06 @-references SUMMARYs that do not exist yet

**Found during:** plan 03, task 2 verification.
**Status:** open, NOT fixed, NOT caused by plan 03, and **expected to self-resolve**.

`node scripts/verify-plan-anchors.mjs --pending` exits 1 with exactly two misses, both
`[context-ref-missing]` in `164.5.4-06-PLAN.md`:

- `:64` → `@…/164.5.4-04-SUMMARY.md`
- `:65` → `@…/164.5.4-05-SUMMARY.md`

Plan 06 is a later wave and correctly declares that it reads the summaries of plans 04 and 05.
Those plans have not executed, so the files do not exist yet. The two `AssertionError`s in
`src/__tests__/verify-plan-anchors.test.ts` are this same fact reaching the suite.

⚠️ This clears itself the moment plans 04 and 05 write their SUMMARYs. ⛔ Do NOT "fix" it by
stripping the @-references from plan 06 — they are the correct declaration and removing them would
send that executor in blind.

---

## [164.5.4-SHARED-SCRATCHPAD-COLLISION] parallel executors share one scratchpad directory

**Found during:** plan 03, task 2 commit.
**Status:** worked around in plan 03, NOT fixed. ⚠️ **Real correctness hazard, worth a phase.**

Plan 03 wrote its commit message to `<scratchpad>/msg2.txt` and committed with `git commit -F`.
The commit landed carrying **plan 02's commit message verbatim**
(`test(164.5.4-02): move both EXPECTED_TABLE_SIZE pins…`): the parallel plan-02 executor had
written its own `msg2.txt` to the SAME path between the write and the commit.

The worktrees are isolated; **the scratchpad is not**. Caught only because the message was read
back after committing; amended to the correct text (`01ae6f74`) and the content was never wrong —
but a commit attributed to the wrong plan is exactly the kind of ledger corruption that is
invisible later.

⭐ **Interim rule, applied for the rest of plan 03:** never use a generic scratchpad filename from
a wave executor. Use a plan-scoped, PID-suffixed name (`gsd-<phase>-<plan>-<task>-$$.txt`), and
read the subject line back before and after committing.

---

## [164.5.4-WINDOWS-ROW61-DESYNC] the broken-windows ledger refuses every append

**Found during:** plan 03, SUMMARY step.
**Status:** open, NOT fixed, NOT caused by plan 03. ⛔ **Deliberately not repaired here.**

`gsd-tools windows append` refuses with:

> Ledger table in `.planning/WINDOWS.md` disagrees with the fenced JSON entries (the sole source
> of truth) for row id(s): **61**. … never hand-edit the rendered table.

So plan 03's `unrun-verify` entry for `[164.5.4-SUITE-TIMEOUT-CONTENTION]` above **could not be
recorded in the ledger**, and neither can anyone else's until row 61 is reconciled.

⚠️ Row **61** is the entry `CLAUDE.md` itself names — the gitleaks full-history / skip-trailer
pair. Its rendered table row and its fenced JSON have drifted apart.

**Why plan 03 did not repair it:** `git status .planning/WINDOWS.md` is clean in this worktree, so
the desync is pre-existing; the tool's own message forbids hand-editing the table; and the file is
a SHARED cross-phase ledger being read by wave siblings executing concurrently in other worktrees,
so reconciling it from here invites a conflict on a ledger whose whole value is that it is
trustworthy. It needs one owner on a quiet tree, not a drive-by fix from a parallel executor.

---

## From plan 06 (D-01, the `venue == "mt5"` backfill branch)

### D-164.5.4-06-1 — `test_feedback_engine::test_lazy_import_not_triggered_at_module_load` is a subprocess-spawn TIMEOUT, in the same class already booked above

**Found during:** plan 06's FULL-suite baseline and its FULL-suite re-run
(`pytest tests/ -q -p no:randomly`, from `analytics-service/`).
**Status:** open, NOT fixed, NOT caused by plan 06.

**MEASURED on this tree, both sides of the change:**

| run | verdict |
|---|---|
| BASELINE, taken before any edit | **2 failed**, 5966 passed, 90 skipped |
| after plan 06 | **1 failed**, 5988 passed, 90 skipped |

The surviving failure is the same one in both, and its error is not an assertion:

```
subprocess.TimeoutExpired: Command '[... python, -c, "import sys\nimport routers.match\n..."]'
timed out after 15 seconds
```

It spawns a child interpreter to prove `services.feedback_engine` is NOT imported at
`routers.match` module load, and the child does not finish inside a 15 s budget on a box
where several executors are running full suites concurrently. **Zero assertion failures.**

**Not caused by plan 06, measured rather than assumed:** neither `services/feedback_engine.py`
nor `routers/match.py` reaches `equity_reconstruction`, `mt5_read`, `broker_dailies` or
`mt5_concurrency` — this plan's only changed modules — and a timeout in a spawned
`import routers.match` cannot be produced by a branch added to a job that file never loads.

**Same class as `[164.5.4-SUITE-TIMEOUT-CONTENTION]` / `D-164.5.4-02-1` above**, which
recorded 56 of 58 frontend failures as subprocess-spawn timeouts with zero assertion
failures. This is the Python half of the identical story. ⛔ Do NOT "fix" it by raising the
15 s budget: that trades a loud environmental signal for a quiet one, on a gate this plan
has no mandate over. The durable fix is a budget the test controls rather than one it races
against a shared box.

⭐ The OTHER baseline failure —
`test_mt5_session_monitor.py::test_CRITERION_2_a_dark_reading_drives_the_heal_with_no_human_and_no_restart`,
already booked above as `[164.5.4-SESSIONMONITOR-ORDER-FLAKE]` — **failed in the baseline and
PASSES after this plan's change.** It flipped to green with nothing about it touched, which
is further evidence it is load-dependent rather than a verdict on any SHA.

**Not appended to `.planning/WINDOWS.md`:** that ledger still refuses every append for the
row-61 desync recorded directly above. For whoever routes it post-merge from a quiet tree:

```
gsd-tools windows append --kind unrun-verify --phase 164.5.4 \
  --file analytics-service/tests/test_feedback_engine.py \
  --description "test_lazy_import_not_triggered_at_module_load spawns a child interpreter to prove a lazy import and races a 15s budget; it fails under concurrent-executor load with zero assertion failures. Observed red in the 164.5.4-06 baseline AND after, on a tree whose only changes are in modules routers.match never loads."
```

### D-164.5.4-06-2 — the MT5 telemetry's omitted anchor keys are flattened by the SHARED audit emit

**Found during:** plan 06, task 3.
**Status:** recorded, NOT fixed, and deliberately NOT routed to a phase.

`_mt5_telemetry` omits `anchor_partial_ticker_symbols`, `anchor_offset_implausible`,
`anchor_replay_unreliable` and `anchor_offset_skipped_usd` because MT5 attempts **no anchor
step at all** — `reconstruct_mt5_nav_levels` is anchored to the account's own realized
balance by construction, so there is no offset to spread and no skip verdict to report.
Emitting `anchor_offset_skipped_usd: 0.0` would imply an anchor was attempted and declined.

⚠️ The SHARED audit emit in `run_reconstruct_allocator_history_job` reads all four through
`.get(..., default)`, so the emitted `reconstruct_complete` metadata carries the defaults
anyway. An operator therefore cannot distinguish "no anchor attempted" (mt5) from "anchor
attempted and clean" (a healthy ccxt account) by reading that event.

**Why it is recorded rather than filed as work:** fixing it means changing the ccxt path's
own emit, which is outside this plan's files, and the consequence is an observability
nuance with **no data-integrity and no user-facing effect** — no persisted row, no verdict
and no user-visible copy depends on it. Under the standing rule that a deferral must name a
phase only for data-integrity or user-facing items, this is fix-or-drop. Recorded so the
residual is visible rather than smuggled.
