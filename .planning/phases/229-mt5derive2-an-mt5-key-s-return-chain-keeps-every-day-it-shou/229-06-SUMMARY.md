---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
plan: 06
status: partial
tasks_complete: [1]
tasks_pending: [2]
requirements: [MT5D-04, MT5D-05, MT5D-06, MT5D-07, HOLD-03]
---

# 229-06 SUMMARY: phase gate on the merged head (Task 1 complete; Task 2 awaiting founder)

**Status: PARTIAL.** Task 1 (the autonomous merged-head gate) is complete and green. Task 2 (226's live
soak against the changed derive) needs the founder's private MT5 gateway and broker credentials and has
NOT been run. It is PENDING founder.

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

## Task 2: PENDING founder

The founder runs `-m scripts.mt5_soak` from `analytics-service/` of a phase checkout whose
analytics-service tree hash is `4d6d1b215`, with `MT5_SOAK_LOG_DIR` outside the repository, and pastes
back only the tree hash, the empty porcelain, the `exit=` line and the sanitized verdict lines (parity
verdict; return_check checked, timed_verified, guarded, indeterminate, mismatch_count, certified_share,
ok). Exit 0 is a pass; any other exit is recorded red. Steps: `229-06-PLAN.md` Task 2.

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
