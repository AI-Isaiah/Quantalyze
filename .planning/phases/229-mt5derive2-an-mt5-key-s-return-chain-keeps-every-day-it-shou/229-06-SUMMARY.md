---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
plan: 06
status: complete
tasks_complete: [1, 2]
tasks_pending: []
requirements: [MT5D-04, MT5D-05, MT5D-06, MT5D-07, HOLD-03]
---

# 229-06 SUMMARY: phase gate on the merged head and the founder's live soak (Tasks 1 and 2 complete)

**Status: COMPLETE (2026-11-25).** Task 1 (the autonomous merged-head gate) is complete and green. Task 2
(226's live soak against the changed derive) was run by the founder on 2026-11-25 inside the deployed
analytics container and exited 0; its reading is under "Task 2" below. Until then this plan was PARTIAL
with Task 2 pending the founder.

## Merged head

- Phase head: `337ed52b3`
- analytics-service tree hash: **`4d6d1b215`** (Task 2 must run on a checkout whose
  `git rev-parse --short HEAD:analytics-service` prints exactly this; the tree hash, not the commit SHA,
  is the comparison)
- `git status --porcelain -- analytics-service`: empty

## Task 1 gate readings (verbatim tails)

Full suite, the CI python job's command
(`pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80 -q -p no:cacheprovider`, run from `analytics-service/`):

```
TOTAL                                       32579   1721    95%
Required test coverage of 80% reached. Total coverage: 94.72%
15583 passed, 93 skipped, 1188 warnings in 130.99s (0:02:10)
exit=0
```

mypy strict (`--strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`):

```
Success: no issues found in 142 source files
```

Vitest literal pins (`tiny-base-literal-pin`, `options-cash-basis-literal-pin`, `nav-marks-start-literal-pin`):

```
 Test Files  3 passed (3)
      Tests  30 passed (30)
```

Frozen spine: `git diff --quiet e5759fa76 -- analytics-service/tests/fixtures/` -> exit 0 (no fixture
changed; `regen_golden.py` not run).

`read_writer_basis` hash: `acd576aa4b645c00` (byte-unchanged across the phase).

PROOF-01 ledger: each of `229-01` to `229-05` SUMMARY carries a PROOF-01 section with RED and GREEN
output (grep counts of `PROOF-01`: 2, 3, 6, 2, 12; plan 04's GREEN is its `cmp silent: restored` /
`passed` re-runs). Missing count: 0.

Soak entry check (five `MT5_SPIKE_*` unset, `MT5_SOAK_LOG_DIR` under `${TMPDIR:-/tmp}`):

```
ERROR: missing required env vars: MT5_SPIKE_LOGIN, MT5_SPIKE_INVESTOR_PASSWORD, MT5_SPIKE_SERVER, MT5_SPIKE_HOST, MT5_SPIKE_PORT (env only; values are never printed).
exit=3
```

`git status --porcelain -- analytics-service/docs`: empty.

## Task 2: the founder's live soak (COMPLETE, 2026-11-25, exit 0)

Until 2026-11-25 this section read "PENDING founder". The run below closes it.

**Where and on what code it ran.** The founder ran the soak inside the deployed `quantalyze-analytics`
Railway container, not from a phase checkout:

```
railway ssh --service quantalyze-analytics -- sh -c 'MT5_SOAK_LOG_DIR=/tmp/mt5soak python -m scripts.mt5_soak; echo exit=$?'
```

- Deployed commit: `549f3d9775cb517f54f9317cf62255b74043a125` (v0.133.74.0, #1334; Railway deployment
  `75e7e56c`, deployed 2026-11-25T08:02Z). It contains this phase's merge `2761b04be` (#1328):
  `git merge-base --is-ancestor 2761b04be 549f3d97` exits 0.
- `soak_run_at`: 2026-11-25T12:17:10Z. `MT5_SOAK_LOG_DIR` was `/tmp/mt5soak` inside the container, so the
  raw JSON record never touched a tracked path.
- Server offset knob: the run used `server_utc_offset_min_assumed` 180.

**The tree hash differs from the one Task 1 pinned. That is a deviation from this plan's letter, recorded
here rather than hidden.** Task 2's acceptance line says a different analytics-service tree hash voids the
run. Measured with git:

| commit | what it is | `git rev-parse --short <commit>:analytics-service` |
|---|---|---|
| `337ed52b3` | phase head at Task 1 (the tree the verifier pinned) | `4d6d1b215` |
| `0771f1f3f` | phase head at the final re-verification | `4e05033e3` |
| `2761b04be` | squash merge on `main` (#1328) | `4b87fec4f` |
| `549f3d97` | the deployed commit the soak ran on | `91161c544` |

Note that the pinned `4d6d1b215` was already stale on the phase branch: the stamp-race fix and the
departed-key exemption (`156c56a08`, `5839f0f8b`, `b3b034f8b`) landed after Task 1 and moved the tree to
`4e05033e3`. `main` between the merge and the deployed commit carries Phases 232 (#1330), 238 PR-1
(#1331), 239 (#1332), 231 plan 06 (#1333) and 240 (#1334); only 232, 231-06 and 240 touch
`analytics-service`.

**Why the run still judges this phase's code.** The soak's whole import closure is byte-identical across
all four trees. The closure was measured by importing `scripts.mt5_soak` plus the modules `mt5_spike.py`
imports inside functions (`services.mt5_probe`, `services.mt5_server_clock`, `services.mt5_deals`) from a
`git archive` of `549f3d97` and listing `sys.modules`: `scripts.mt5_soak`, `scripts.mt5_spike`,
`scripts.deribit_ground_truth` and 23 `services.*` modules (among them `nav_twr`, `broker_dailies`,
`allocator_equity_derive`, `transforms`, `mt5_client`, `mt5_deals`, `account_unit`). `git diff --stat`
over exactly those files is empty from `4d6d1b215`, from `4e05033e3` and from `4b87fec4f` to `91161c544`.
None of the 13 non-test files that changed between `2761b04be` and `549f3d97` is in the closure
(`job_worker.py`, `exchange.py`, `rate_limit.py` and the rest are not loaded by the soak). So the derive
the soak ran (`combine_mt5_deal_ledger` with this phase's cohort rule and day-0 flag) and the oracle that
judged it are the merged code, byte for byte.

**Not measured.** `git status --porcelain -- analytics-service` cannot be run in the container (the image
has no git checkout). The deployed commit stands in for it. The reading below is the founder's run as
relayed by the coordinator: counts only, not pasted stdout. No login, server string, account number or
balance is recorded.

**Reading (one account, unnamed):**

```
exit=0
top-level verdict: INCONCLUSIVE (solely from server_time_offset)
  unattended_login:     GO (10/10)
  read_only_proof:      GO (partial: true)
  deal_reconstruction:  GO (108 deals)
  server_time_offset:   INCONCLUSIVE (founder_confirmation_required; latest deal is stale,
                        raw_offset_minutes -2435; server_utc_offset_min_assumed 180)
parity: parity_ok true, recon_ok true, recon_level_ok true, return_check_ok true; account unit USD (not native)
return_check: ok true, vacuous false, checked 26, timed 0, timed_verified 0, guarded 0, flat 48,
              flow_only 10, indeterminate 0, mismatch_count 0, certified_share 1.0 (min 0.5),
              max_abs_err 1.006e-16, tolerance 1e-9
attribution_check: ok, days_compared 36, mismatch_count 0
wedge_within_materiality: true
```

**Why exit 0 with an INCONCLUSIVE top line is a pass.** Exit 0 is this plan's pass condition, and the
soak's own contract (`mt5_soak.py` EXIT CODES) gives exit 0 only when parity holds, the wedge is within
materiality, the spike verdict is not NO-GO and the read-only leg is GO. Spike leg 4
(`_leg4_server_time_offset` in `scripts/mt5_spike.py`) always carries `founder_confirmation_required`
and "never reads GO" by construction, so every soak run's top line is at best INCONCLUSIVE. The
`raw_offset_minutes` of -2435 (about 40 hours) measures how old the latest deal is, not the broker clock:
the account had no deal near the run time.

**Limit of this reading: no timed day was exercised live.** `timed` is 0 on this account, so the
timed-key branches this phase changed (the refund cohort rule on a timed day, MT5D-04's timed path,
MT5D-07's writer-basis token on a timed key) did not run against live data here. The untimed path
and the soak's own walk were exercised (26 checked days, 0 mismatches, max error
1.006e-16). The timed branches stay proven by the PROOF-01 RED/GREEN records in 229-01 to 229-05 and the
frozen fixtures, not by this live run. Neither ROADMAP SC-5 nor this plan asks for a timed day in the
live run; SC-5 asks that the soak against the changed derive be recorded beside the merge.

`analytics-service/docs` in the tracked tree is untouched by the run (it wrote to `/tmp/mt5soak` in the
container).

## Closing notes for the ship step

- TODOS entries this phase closes (delete in the ship PR, name in the CHANGELOG):
  `[164.6.6.2.3-EMPTY-COHORT0-REFUND]` (MT5D-04), `[164.6.6.2.3-INCEPTION-DAY0-PNL]` (MT5D-05),
  `[164.6.6.2.3-D15-THRESHOLD-BAND]` (MT5D-06, closed by the founder's acceptance),
  `[164.6.6.2.3-MT5-BASIS-SILENT-NONE]` (MT5D-07), and the section `167.1.2.2.1-WRITER-BASIS-VALUES`
  (HOLD-03).
- Entries that stay open: `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]` (the D-15 root fix) and
  `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY` (`read_writer_basis` was not touched).
- CHANGELOG facts: published MT5 returns move (a re-fund day into an emptied account is now measured);
  the `inception_day_pnl_dropped` annotation can appear on MT5, Deribit and ccxt full-history keys at
  their next derive with no number moving; a timed MT5 key with no writer basis and a stale key_inputs
  row beside fresh returns now block the book as `key_inputs_mismatch`; known limits from plans 229-03
  and 229-05 (the marks-era over-block, the transient compose race).
- 155.2 freeze: this phase moves published MT5 returns, so it merges before 155.2 plan 12's recapture or
  after plan 14, never in between; re-check `155.2-12-SUMMARY.md` on origin/main at ship.
