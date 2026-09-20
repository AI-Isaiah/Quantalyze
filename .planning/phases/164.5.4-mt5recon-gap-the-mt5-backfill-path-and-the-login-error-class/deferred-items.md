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
