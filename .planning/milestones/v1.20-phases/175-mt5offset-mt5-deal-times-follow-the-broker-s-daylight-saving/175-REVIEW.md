---
phase: 175-mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving
reviewed: 2026-10-27T12:27:12Z
round: 3
depth: deep
files_reviewed: 17
files_reviewed_list:
  - analytics-service/services/mt5_server_clock.py
  - analytics-service/services/mt5_deals.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/broker_dailies.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/mt5offset_dry_run.py
  - analytics-service/tests/conftest.py
  - analytics-service/tests/test_equity_reconstruction.py
  - analytics-service/tests/test_mt5_deal_reconstruction.py
  - analytics-service/tests/test_mt5_deal_timing.py
  - analytics-service/tests/test_mt5_derive_branch.py
  - analytics-service/tests/test_mt5_server_clock.py
  - analytics-service/tests/test_mt5offset_dry_run.py
  - analytics-service/tests/test_reconstruct_whole_account.py
  - analytics-service/tests/test_broker_dailies.py
  - analytics-service/tests/test_allocator_equity_dropped_day_pnl.py
  - analytics-service/tests/test_allocator_equity_realized_basis.py
findings:
  critical: 0
  warning: 1
  info: 11
  total: 12
status: issues_found
---

# Phase 175: Code Review Report

**Reviewed:** 2026-10-27T11:20:04Z
**Depth:** deep
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Scope: `git diff 53f25ac3..HEAD -- . ':!.planning'` on `feat/175-mt5offset`, 14 files under `analytics-service/`.

**The DST rule math is correct.** I checked it with an independent harness in the scratchpad, not with the phase's tests. For both rules, at 10-minute steps over true UTC through March, October and November of 2007-2099 (every 7th year, plus 2026 and 2027), I built a deal whose `time` is the broker wall clock from `zoneinfo` (`Europe/Helsinki`; `America/New_York` + 7 h) and fed it through `deal_utc_day` / `deal_utc_instant_ms`. Results:

- 0 cases where the true offset was not among `candidates()`.
- 0 cases where a non-`None` instant differed from the true instant.
- 0 cases where a dated instant fell on the wrong UTC day.

The candidate formulation behaves as documented:

- A repeated hour has two candidates and the instant is `None`.
- A skipped hour has no candidates; it is dated with the standard offset and the instant is `None`.
- Both candidates of a repeated hour fall on the same UTC day, because no transition is within an hour of a UTC midnight.

**Clock threading and test runs:**

- Every offset site in the derive (six) and in the backfill (one) takes the single resolved clock.
- No production path still reads the environment variables inline.
- The phase test files pass locally: 407 + 259 passed.
- The CI mypy strict line passes on 124 source files.

**Tests can fail.** The `zoneinfo` oracle test pins an exact count of 48 `None` instants. The golden vectors are hand-written. The WR-02 control asserts the defect value (+54.98%) under the fixed 10800.

**Findings:**

- **WR-01 (user-facing):** a clock configuration fault in the derive reaches users' strategies. The comments and plan 06 say it does not.
- **WR-02 (latent data-integrity):** the three public fold functions still default silently to offset 0.

Everything else is LOW/INFO.

## Warnings

### WR-01: A clock configuration fault in the derive is shown on users' strategies, and the "no stamp" claim is false

**Severity:** MEDIUM. User-facing.

**File:** `analytics-service/services/job_worker.py:5921-5942` (the same claim is in `175-03-PLAN.md` T-175-10 and `175-06-PLAN.md` Task 3 step 1)

**Issue:** The derive returns `DispatchResult(FAILED, error_kind="permanent")` on `Mt5ServerClockConfigError`. Its comment says it "writes NO strategy_analytics stamp", and plan 06 tells the operator that an instance booted with both variables set "failed loud as permanent with no stamp".

The worker does skip `_stamp_strategy_analytics_failed`. But `main_worker` then calls `mark_compute_job_failed` (`DispatchOutcome` docstring, `job_worker.py:780-790`). That RPC runs the status bridge (`supabase/migrations/20260826120000_computation_error_curated_copy.sql`):

- **Branch (b):** a non-protected job (for example a user-initiated first-connect or resync derive of an MT5 strategy) sets `strategy_analytics.computation_status = 'failed'`.
- **Branch (b-prime):** a protected nightly refresh still writes the curated `permanent` sentence into the user-visible `computation_error`.

The curated sentence reads: "Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support…".

So an operator's mistake is shown on users' strategies, which T-175-10 / Pitfall 3 says must never happen. The text is also false here: a fixed variable plus the next run resolves it.

The same fault in the backfill is classified `transient` ("must retry once the variable is fixed", `equity_reconstruction.py:4488-4496, 4807`). The two paths disagree for one operator fault (CLAUDE.md Rule 7).

**Fix:** Pick one classification for the operator fault in both paths.

- **Minimal option:** make the derive arm `transient`, like the backfill. Retries with backoff then cover the time it takes the operator to fix the variable, and the bridge writes nothing user-visible until retries run out.
- **Alternative:** defer the job (`DispatchOutcome.DEFERRED` via the existing defer path), which never reaches `mark_compute_job_failed`.

In both cases, correct the comment at `job_worker.py:5921-5929` and plan 06's step-1 recovery note. Either name what the bridge writes, or state that nothing is written. Also update `test_a_clock_configuration_fault_fails_permanent_with_no_stamp_and_no_terminal_read` to the chosen kind.

```python
except Mt5ServerClockConfigError as _clock_exc:
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=f"derive_broker_dailies: {_clock_exc}",
        error_kind="transient",  # operator fault: retry once fixed, never a permanent verdict on the user's strategy
    )
```

### WR-02: The three public fold functions still default silently to UTC (offset 0)

**Severity:** MEDIUM. Latent data-integrity; no current caller is affected.

**File:** `analytics-service/services/broker_dailies.py:814, 963, 1081`

**Issue:** D-01 removes "the silent `"0"` default". But `combine_mt5_deal_ledger`, `reconstruct_mt5_nav_levels` and `mt5_day_pnl` still declare `server_utc_offset_s: int | Mt5ServerClock = 0`. A new caller that leaves out the argument buckets every MT5 deal as if the broker ran on UTC: 2-3 hours off, silently, with no fault raised.

The AST pins do not close this:

- `test_one_clock_per_derive` and `test_one_clock_per_backfill` inspect only `run_derive_broker_dailies_job` and `_mt5_fetch_window`.
- `test_single_reader` looks only for the variable-name constants.

A call such as `combine_mt5_deal_ledger(deals, eq, bal, floors=…)` added in `allocator_equity_derive.py`, a router or a new job therefore passes every gate.

Today every production caller passes the clock (job_worker x6, equity_reconstruction x1). RESEARCH kept the defaults on purpose as a "surgical" choice, so this is a trade-off already recorded, but it leaves a silent wrong-offset path that a future caller can hit.

**Fix:** Make the argument keyword-only with no default on the three public functions, so a missing clock is a `TypeError` at the call site. Tests that relied on 0 then pass `server_utc_offset_s=0` explicitly. This is a mechanical change: mypy catches every production call site, and the test call sites fail on their first run.

```python
def combine_mt5_deal_ledger(deals, account_equity, account_balance, *,
                            server_utc_offset_s: int | Mt5ServerClock,
                            floors: UnitFloors = USD_FLOORS): ...
```

## Info

### IN-01: A DST-rule clock rejects deals outside 2007-2099 as a user-attributed classification error

**File:** `analytics-service/services/mt5_server_clock.py:204-211`, `analytics-service/services/mt5_deals.py:236-247`

Under `eu`/`us`, a deal whose wall year is outside 2007-2099 raises `Mt5DealClassificationError`. Examples are a `time` of 0 or any negative epoch. The derive stamps that on the user's strategy as PERMANENT ("deal ledger could not be classified"). The fixed form accepts the same deal.

This is unlikely for real MT5 ledgers (MT5 post-dates 2007). It is still a behaviour change that only appears once the rule is switched on, and the only check before then is the dry run (which would report `not measured`).

### IN-02: The dry run does not bound-check its offsets

**File:** `analytics-service/scripts/mt5offset_dry_run.py:241-260`

`--fixed-offset-s` goes straight to `fixed_server_clock` and `--legacy-offset-s` straight to the folds. Neither gets the resolver's +/-13 h check or a whole-number check. A seconds-for-hours slip (`--legacy-offset-s 3`) yields a plausible `rebuild` verdict for every key and inflates the forced-rebuild candidate list.

The captured file's own `offset_s` is also ignored and never cross-checked against `--legacy-offset-s`.

### IN-03: The dry run renders the capture file's `error_class` verbatim

**File:** `analytics-service/scripts/mt5offset_dry_run.py:175-182`

For an uncaptured key, `str(entry["error_class"])` is rendered, and the only filter is `_scrub` (UUIDs, emails, home paths, long digit runs). A broker server name or a message string in that field would reach the report, although the docstring promises "the exception CLASS … never its message".

The redaction test plants `"Broker-Live"` only in the `server` field, which is never rendered, so that plant cannot fail.

### IN-04: The read-only import pin checks direct imports only

**File:** `analytics-service/tests/test_mt5offset_dry_run.py:247-261`, `analytics-service/scripts/mt5offset_dry_run.py:30-31`

The script transitively loads `psycopg`, `requests` and `socket` (through third-party libraries reached via `services.metrics` and `services.allocator_equity_derive`). It does not load `supabase` or `services.db`. In practice nothing in the script calls them, but the docstring's "imports no supabase or HTTP client" and the test's "read-only by construction" are claims about direct imports only.

### IN-05: The `Mt5ServerClock` dataclass accepts inconsistent instances

**File:** `analytics-service/services/mt5_server_clock.py:107-116`

The dataclass accepts the following:

- `Mt5ServerClock(rule="eu", fixed_offset_s=3600)`: the offset is silently ignored.
- `Mt5ServerClock(rule="fixed", fixed_offset_s=10**9)`: no bound check.
- An unknown `rule` string: `Literal` is not enforced at runtime, and `_dst_window_utc` raises `ValueError`. The seam maps that to "deal time is out of the datable epoch range", which is the wrong diagnosis, and it is user-attributed.

Only the resolver and the dry run build instances today. A `__post_init__` check would close this.

### IN-06: One worker-wide clock for every admitted MT5 server

**File:** `analytics-service/services/mt5_server_clock.py:175-201`

`MT5_KNOWN_SERVERS` admits a comma-separated list. If a second broker with a different clock is admitted, its deals are bucketed by the first broker's rule, silently.

This is inside D-01's scope (a rule id, not a server table), and the old integer had the same limit. Recommend booking a tripwire for when a second broker is admitted rather than fixing it here.

### IN-07: The US-rule flip instant is assumed to be New York 02:00 (A2 / Pitfall 6)

**File:** `analytics-service/services/mt5_deals.py:318-320`

A broker whose server OS switches at its own local 02:00 dates deals stamped between that moment and New York 02:00 an hour wrong. That window is a Sunday early morning, but weekend crypto CFDs trade then. This is already documented as residual assumption A2. It is listed here so plan 06's live reading after the switch looks at that window.

---

_Reviewed: 2026-10-27T11:20:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Silent-failure hunter (round 1, parallel review)


## SFH-01 MEDIUM (data-integrity) — dry run can print "none"/"0 of N" when it measured nothing
analytics-service/scripts/mt5offset_dry_run.py:225 (tally), :172 (`captured.get("keys") or {}`), :275 (`return 0`), header :8 documents `offset_s`.
- Footer counts only `rebuild`; all-`not measured` (incl. a regression caught by broad `except Exception` at :150) prints "0 of N", exit 0. Plan 06 operator unions `rebuild` keys; "0" reads as nothing to rebuild.
- Missing/empty `keys` -> zero rows, "0 of 0", exit 0.
- Capture's `offset_s` never compared with `--legacy-offset-s`; wrong legacy offset silently makes BEFORE fold wrong.
Suggested: footer `not measured: K`; non-zero exit or loud line when K>0 or no rows; refuse (or loudly report) capture `offset_s` != `--legacy-offset-s`.

## SFH-02 MEDIUM (observability, possibly user-facing) — derive clock config fault is permanent with no log line
analytics-service/services/job_worker.py:5932-5942.
- Returns FAILED permanent with no logger call (backfill logs a WARNING at equity_reconstruction.py:4799-4805). Missing/conflicting env fails every MT5 derive silently.
- UNVERIFIED: a permanent failure reaches mark_compute_job_failed -> status bridge sync_strategy_analytics_status (migration 20261023120000_sync_status_runner_stamps_computed_at.sql branch (b) ~:872, INSERT ~:890) which may write computation_status='failed' with canned copy for non-protected strategies — an operator typo could flip every MT5 strategy to failed, against CONTEXT/RESEARCH Pitfall 3 / T-175-10. Trace which rows the bridge protects, or test the post-mark status.
Suggested: logger.error naming the two settings; verify the bridge behaviour.

## SFH-03 MEDIUM (data-integrity) — `= 0` default survives on public functions
analytics-service/services/broker_dailies.py:814 combine_mt5_deal_ledger, :963 reconstruct_mt5_nav_levels, :1081 mt5_day_pnl keep `server_utc_offset_s=0`-style defaults; a future caller omitting it silently buckets by raw broker time. Either make required or confirm a source pin covers callers.

## SFH-04 MEDIUM (user-facing, edge) — out-of-span deal times blame the user's strategy
analytics-service/services/mt5_deals.py _deal_offsets (~236-246) fed by mt5_server_clock.py:204-211 (_wall_year raises ValueError outside 2007-2099) -> Mt5DealClassificationError("MT5 deal time is out of the datable epoch range"), stamped as "deal ledger could not be classified". Under a rule clock a deal with time 0 / pre-2007 now fails the strategy permanently; under fixed it was datable. Message also misleading. Either distinct message/handling or confirm MT5 never returns such times.

---

## Fix round 1 (topic A): derive/backfill clock faults and defaults

Worktree branch `wt/175-fa`, off `7f7011e20`. Scope: WR-01, WR-02, SFH-02, SFH-03, SFH-04. LOW/INFO untouched.

| Finding | Status | Commit | What changed |
|---|---|---|---|
| WR-01 + SFH-02 | partly fixed; disposition is a FOUNDER QUESTION | `9bb7960df` | One `logger.error` (`arm=server_clock_config`, job id, the resolver's value-free text) on the derive's clock-fault arm. The comment, the fault test's docstring and plan 06's recovery note no longer claim "no stamp"; they say the handler writes none but the status bridge does. The test now asserts the single ERROR line and that no planted value reaches it. `error_kind` is still `permanent`. |
| WR-02 + SFH-03 | fixed | `5113a593d` | `server_utc_offset_s` has no default on `combine_mt5_deal_ledger`, `reconstruct_mt5_nav_levels` and `mt5_day_pnl` (already keyword-only). 55 test call sites that relied on the default now pass `server_utc_offset_s=0`. New `test_a_missing_broker_clock_is_a_type_error_not_a_utc_default` (3 cases). |
| SFH-04 | fixed (message only) | `5834cf68f` | `_deal_offsets` now raises "MT5 deal time is outside the dates the broker server-clock rule covers (2007-2099) — fail loud" instead of the generic datable-epoch text. The fixed-offset path keeps its own text. The two rule-clock tests pin the new text. The user-visible stamp sentence is the existing generic one and was not changed (new user copy is out of scope). |

### WR-01 trace: why the disposition was not changed

The review's premise, that `transient` leaves nothing user-visible, does not hold for the derive. The two paths differ on one fact: the derive job carries a `strategy_id`, the allocator backfill job does not, so only the derive reaches the bridge.

Path through `mark_compute_job_failed` (latest definition, `20261009120000`) and `sync_strategy_analytics_status` (`20261023120000`):

- `permanent`: `failed_final` at once. Bridge branch (b) sets `computation_status='failed'` with the curated sentence "retrying alone will not resolve it. Contact support" for an unprotected job. Branch (b-prime) writes the same sentence into `computation_error` of a healthy row for a protected nightly refresh. The sentence is false for this fault.
- `transient`, `max_attempts` default 3: `failed_retry` after attempt 1 (+30 s) and attempt 2 (+2 min). While a retry is pending the bridge's branch (a) shows `computing`, and a protected healthy row stays `complete`. Attempt 3 is `failed_final` with `error_kind='transient'`, and branches (b) and (b-prime) stamp with the "automatic retries exhausted" sentence. So `transient` delays the stamp by about 2.5 minutes and makes the sentence true. It does not remove it. An operator fix inside 2.5 minutes is the only way to avoid it.
- `DEFERRED` (no `mark_compute_job_failed`): needs a new in-handler `defer_compute_job` call (cap 3600 s, attempts decremented, so it loops hourly with no end). The row sits at `computing` until the 16 h stuck-computing reaper terminalizes it. That is new machinery plus a different stamp later.

No available disposition avoids a user-visible stamp without new machinery, so none was built.

**Founder question: how should a derive clock configuration fault be classified?**

- A. Keep `permanent` (today). Immediate stamp with the false "retrying will not resolve it" copy. Zero change.
- B. `transient`, like the backfill (recommended). One word. About 2.5 minutes of retries, then a stamp whose sentence ("automatic retries exhausted") is true. Consistent with the backfill's `server_clock_config` arm. Not stamp-free.
- C. New machinery (a defer-in-handler or a dedicated operator-fault kind that skips the mark). Genuinely stamp-free only with a migration or an unbounded defer loop. Not recommended.

Recommendation: B. If chosen, the change is `error_kind="transient"` in `job_worker.py` at the clock-fault return, the parametrized fault test's kind assertion, and the "failed loud as permanent" words in 175-06-PLAN.md step 1. T-175-10 in `175-03-PLAN.md` still says "no stamp" and was left as historical plan text.

### RED proofs

Backups in the scratchpad `fa/` directory, restored with `cp`, `cmp` exit 0 each time.

- Log line: renamed the arm in the log format string, `-k clock_configuration_fault` gave 3 failed; restored, 3 passed.
- Required argument: restored the `= 0` defaults on the folds (5 lines), the new test gave 3 failed; restored, 3 passed.
- Rule-span text: restored the original `mt5_deals.py`, `tests/test_mt5_deal_timing.py` gave 6 failed, 68 passed; restored, 74 passed.

### Results

- Phase test files plus `test_reconstruct_whole_account.py`, `test_broker_dailies.py`, `test_allocator_equity_dropped_day_pnl.py`, `test_allocator_equity_realized_basis.py`, `test_mt5offset_dry_run.py` (read, not edited): 832 passed.
- CI mypy strict line: `Success: no issues found in 124 source files` before each commit.

---

## Re-review round 2

**Reviewed:** 2026-10-27T11:44:02Z, head `ea1a9e05e`, by Claude (gsd-code-reviewer), depth deep.
**Scope:** `git diff 7f7011e20..HEAD -- . ':!.planning'` (topic B `0a98cae0a`, topic A `9bb7960df`, `5113a593d`, `5834cf68f`) plus the `175-06-PLAN.md` step-1 edit. The 11 changed source and test files are listed in the frontmatter.

### Verification run at HEAD (worktree, `analytics-service/`)

- CI mypy strict line: `Success: no issues found in 124 source files`.
- Phase and caller test files: 967 passed. These are `test_mt5_server_clock`, `test_mt5_deal_timing`, `test_mt5_deal_reconstruction`, `test_mt5_derive_branch`, `test_mt5offset_dry_run`, `test_broker_dailies`, `test_allocator_equity_dropped_day_pnl`, `test_allocator_equity_realized_basis`, `test_reconstruct_whole_account`, `test_equity_reconstruction`, `test_mt5_soak`, `test_flowtiming_dry_run` and `test_ingestion_mt5`.
- Full analytics suite (`-n auto`): 13032 passed, 96 skipped, 0 failed.

### Caller census for the three folds (WR-02 / SFH-03)

`grep` of `analytics-service/` (excluding `.venv`) for `combine_mt5_deal_ledger`, `reconstruct_mt5_nav_levels` and `mt5_day_pnl`. Every call passes `server_utc_offset_s` explicitly.

| Site | Function | Clock passed |
|---|---|---|
| `services/job_worker.py:6613` | `combine_mt5_deal_ledger` | `_mt5_clock` |
| `services/job_worker.py:6622` | `mt5_day_pnl` | `_mt5_clock` |
| `services/job_worker.py:6639` | `reconstruct_mt5_nav_levels` | `_mt5_clock` |
| `services/job_worker.py:7567` | `mt5_day_pnl` | `_mt5_clock` |
| `services/equity_reconstruction.py:5057` | `reconstruct_mt5_nav_levels` | `mt5_clock` |
| `scripts/mt5_soak.py:428` | `combine_mt5_deal_ledger` | `server_utc_offset_s` |
| `scripts/flowtiming_dry_run.py:193` | `combine_mt5_deal_ledger` | `offset` |
| `scripts/mt5offset_dry_run.py:141-151` (4 calls) | `reconstruct_mt5_nav_levels` and `combine_mt5_deal_ledger` | `legacy_offset_s` / `target` |

- The CI mypy line does not cover the `scripts/` callers. They were checked by hand, and the full test suite exercises them.
- In tests, the only calls without the clock are the three deliberate ones in `test_a_missing_broker_clock_is_a_type_error_not_a_utc_default`.
- No other `services/`, `scripts/` or `routers/` signature gives an MT5 offset or clock a silent default. `_fold_mt5_deals`, `deal_utc_day` and `deal_utc_instant_ms` are already required-positional.
- The one remaining default is `Mt5ServerClock.fixed_offset_s = 0`, which is IN-05 territory.

### Per-finding status

| Finding | Status | Evidence |
|---|---|---|
| WR-01 (disposition) | **OPEN, founder decision pending** (known, not re-raised) | `error_kind="permanent"` unchanged at `job_worker.py:5949-5953`. |
| WR-01 / SFH-02 (corrected texts) | **Resolved. The texts are now true.** | See the trace below. One residual sentence is listed as IN-08. |
| SFH-02 (log line) | **Resolved** | `logger.error` at `job_worker.py:5944-5948` carries the arm, the job id and the resolver's closed-set text. The test asserts exactly one ERROR line containing `arm=server_clock_config` with no planted value. It can fail: the fixer's rename proof gave 3 failed, and the line is the only producer of that arm string. |
| WR-02 / SFH-03 | **Resolved** | The defaults are removed at `broker_dailies.py:814, 963, 1081`, and the arguments stay keyword-only. All callers pass the clock (census above). `test_a_missing_broker_clock_is_a_type_error_not_a_utc_default` asserts a `TypeError` that names `server_utc_offset_s`. Restoring any default makes that call succeed or raise something else, so the test can fail. |
| SFH-04 | **Resolved (message only, as recorded)** | `mt5_deals.py:246-249` gives the rule-span text. That text is reached only for a rule clock: on a fixed clock both methods return the integer and cannot raise, so `_utc_day_of_server_epoch` keeps the old text there. The user-visible stamp is still the curated sentence. The new text goes only to `detail` and `error_message`, which `_stamp_strategy_analytics_failed` keeps off `computation_error` (`job_worker.py:4390-4396`). Two pins in `test_mt5_deal_timing.py` cover it. |
| SFH-01 | **Resolved** | See the notes below. IN-10 is a minor residual. |
| IN-01 to IN-07 | Unchanged by design (LOW/INFO are not fixed) | IN-01 is mitigated by SFH-04's text. IN-05's unknown-rule `ValueError` now surfaces as the rule-span text, which is still the wrong diagnosis. |

**SFH-01 notes** (`mt5offset_dry_run.py:229-236, 277-286, 296-303`):

- The footer adds a "Keys not measured: K of N." line, plus an INCOMPLETE line when K > 0 or the capture has no keys.
- `main` returns 1 in both of those cases, after the report is written.
- When the capture's `offset_s` differs from `--legacy-offset-s`, the script writes a stderr WARNING and adds a report note. It does not refuse to run, which is deliberate and documented in the module docstring.
- Three new tests cover these: not-measured or empty gives exit 1, complete gives exit 0, and a mismatch is named. Each fails if its mechanism is removed.
- Plan 06 step 5 already records `not_measured=N` for each run, so the non-zero exit does not break the procedure.

### WR-01 trace: are the corrected texts true?

I checked them against the LATEST definitions. One citation in the fix record needs updating: the latest `mark_compute_job_failed` is `20261024120000_fan_in_graph_and_decision_cascade.sql`, not `20261009120000`. The relevant arm is unchanged.

- **"A `permanent` kind is failed_final at once":** true. `IF p_error_kind = 'permanent' THEN v_new_status := 'failed_final'`.
- **"The bridge runs on every terminal failure that carries a strategy_id":** true. `mark_compute_job_failed` bridges its own strategy and every failed descendant's strategy through `sync_strategy_analytics_status`. A key-mode derive has no strategy, so nothing is bridged for it.
- **"An unprotected job sets `computation_status='failed'`":** true. This is branch (b) in `20261023120000`: an INSERT ... ON CONFLICT with `'failed'` and `computation_error_copy(v_latest_kind)`.
- **"A protected nightly refresh writes the curated permanent sentence into `computation_error`":** true. Branch (b-prime) is an UPDATE of `computation_error` only, so the status stays `complete`.
- **Plan 06 step 1, "the next nightly derive heals them, and any `failed` row it leaves is cleared by that derive's success":** true for single-key MT5 strategies, for three reasons:
  - The bridge's partition drops a `failed_final` that a strictly later `done` job of the same (strategy, kind) supersedes. Branch (c) then writes `complete` (or `complete_with_warnings`) and NULLs `computation_error`, because a derive is not a side kind.
  - `ledger_refresh_staleness.is_stale` is TRUE for any status outside the complete pair, so a `failed` row is a fan-out candidate again once the 20-hour attempt cooldown in `enqueue_ledger_refresh_for_strategies` (`20260924120000`) has passed.
  - Composite strategies with an MT5 member are excluded by the view's `deferred_venues`, which is unrelated to this phase.
- **Residual:** one sentence still says the opposite. It is listed as IN-08.

### New findings (round 2)

No new BLOCKER, WARNING or MEDIUM. Three INFO items:

#### IN-08: Two texts still say an operator's clock fault never reaches the user

**Files:**
- `analytics-service/services/mt5_server_clock.py:99-104`
- `analytics-service/tests/test_mt5_derive_branch.py:2685, 2690`

**Issue:**
- The `Mt5ServerClockConfigError` docstring justifies the class choice with "an operator's mistake must never be shown to a user". Under today's `permanent` disposition the bridge does show it, as the generic curated sentence. The class choice keeps the *classification* sentence off the strategy, not every stamp.
- The fault test is still named `..._fails_permanent_with_no_stamp_...`. Its docstring's first sentence also still says "writes NO `strategy_analytics` stamp (a stamp is shown to the user)". The added paragraph does qualify it.

This belongs to the WR-01 text family, and the fix depends on the founder's disposition.

**Fix:** When WR-01 is decided:
- Reword the docstring to "keeps the user-attributed classification sentence off the strategy; the status bridge still marks it (WR-01)".
- Rename the test to match the chosen kind.

#### IN-09: The rule-span text hard-codes the years, and it also covers faults that are not about the span

**File:** `analytics-service/services/mt5_deals.py:246-249`

**Issue:** `"... covers (2007-2099) ..."` restates `_FIRST_RULE_YEAR` / `_LAST_RULE_YEAR` (`mt5_server_clock.py:67-68`) as a literal, so a span change would leave the message wrong. Two pins test the literal; no parity pin ties it to the constants. The same `except` arm also catches:
- an epoch that `datetime` cannot represent (arguably also "outside the span");
- IN-05's unknown-rule `ValueError` from `_dst_window_utc`, which this text now misdiagnoses as a date-span problem.

**Fix:** Build the text from the two constants, imported or exported from the clock module. Optionally, closing IN-05 with a `__post_init__` check removes the unknown-rule path.

#### IN-10: The dry run is silent when the capture has no `offset_s`

**File:** `analytics-service/scripts/mt5offset_dry_run.py:277-278`

**Issue:**
- The mismatch check is skipped when `offset_s` is absent (`None`), although the docstring's capture format requires it.
- A non-int value is compared raw. A string `"10800"` warns spuriously, and any value is echoed into the report through `_scrub` only (IN-03 class).
- Impact is low. The BEFORE fold always uses `--legacy-offset-s`, which is required, and the report header names it.

**Fix:** Write a WARNING when `offset_s` is absent or not an int, the same way as for a mismatch.

### Round-2 verdict

- WR-02, SFH-01, SFH-02, SFH-03 and SFH-04 are resolved. Each new test can fail, and I found no regressions: mypy is clean and the full suite is green.
- WR-01 stays open on the founder's disposition. Its corrected texts are true against the latest SQL, apart from residual IN-08.
- The new findings are INFO only. Frontmatter counts are now the open set: WR-01, IN-01 to IN-07, and IN-08 to IN-10.

_Re-reviewed: 2026-10-27T11:44:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

### Silent-failure hunter, round 2

SFH-01 resolved (report is written before the exit-1 return; the offset_s mismatch is a stderr WARNING plus a report note, by design for plan 06's per-offset runs). SFH-02 resolved for observability (one ERROR line, no configured value); the permanent-vs-transient disposition stays with WR-01 for the founder. SFH-03 resolved (no default; every non-test caller passes the clock). SFH-04 resolved for the operator message; the user-visible stamp copy is unchanged (LOW, not fixed). No new silent failure at MEDIUM or above.

## Fix round 2

Scope: WR-01 (disposition per D-04, founder 2026-10-27, "Transient, like backfill (Recommended)") and the IN-08 texts. IN-09 and IN-10 untouched.

| Finding | Status | Commit | What changed |
|---|---|---|---|
| WR-01 | fixed | `40d70f1f0` | The derive's clock-configuration-fault return in `job_worker.py` uses `error_kind="transient"`; the adjacent comment states the disposition (retries, then the status bridge stamps the "automatic retries exhausted" sentence, not the permanent "Contact support" one). Plan 06 step 1's recovery note says "failed loud as transient (D-04)" with the same consequence. |
| IN-08 | fixed | `40d70f1f0` | The fault test is renamed `test_a_clock_configuration_fault_fails_transient_and_makes_no_terminal_read` and expects `transient`; its docstring no longer claims "permanent" or "no stamp", and keeps the no-`strategy_analytics`-write, no-terminal-read and one-ERROR-line assertions. The `Mt5ServerClockConfigError` docstring now says an operator's mistake "must not carry that user-attributed sentence". |

**RED proof (WR-01).** With the kind temporarily reverted to `permanent` in `job_worker.py` (byte backup, restored with `cp`, `cmp` exit 0), `pytest tests/test_mt5_derive_branch.py -k clock_configuration_fault` ended `3 failed, 53 deselected` (all three parametrized cases: neither-variable-set, unknown-rule-id, both-variables-set). With the fix: `tests/test_mt5_derive_branch.py`, `tests/test_mt5_server_clock.py` and `tests/test_mt5_deal_reconstruction.py` together: 379 passed. CI mypy line (`--strict`, 124 source files): no issues.

## Re-review round 3

**Reviewed:** 2026-10-27T12:27:12Z, head `51af78b04`, by Claude (gsd-code-reviewer), depth deep.
**Scope:** `git diff 416215737..HEAD`. That covers `423c5f788` (D-04 record), `40d70f1f0` (fix round 2) and `51af78b04` (REVIEW record). Changed source and test files: `services/job_worker.py`, `services/mt5_server_clock.py` and `tests/test_mt5_derive_branch.py`. Changed records: `175-06-PLAN.md` step 1, `175-CONTEXT.md` D-04 and the `ROADMAP.md` D-04 note.

### Verification run at HEAD (worktree, `analytics-service/`)

- CI mypy strict line: `Success: no issues found in 124 source files`.
- `tests/test_mt5_derive_branch.py tests/test_mt5_server_clock.py tests/test_mt5_deal_reconstruction.py tests/test_equity_reconstruction.py tests/test_mt5offset_dry_run.py`: **526 passed**.
- **The test can fail, reproduced independently.** I did not touch the worktree. I copied `analytics-service/` (without `.venv`) to `<scratchpad>/r3/as`. In that copy only, I changed the derive's clock-fault return to `error_kind="permanent"`. Then I ran `pytest tests/test_mt5_derive_branch.py -k clock_configuration_fault` with the worktree's interpreter. The result was `3 failed, 53 deselected`, and each failure was on `assert 'permanent' == 'transient'`. The worktree is clean (`git status --short` is empty).

### WR-01 / D-04 trace: is the new comment true against the latest SQL?

Latest definitions, re-grepped on this tree:
- `mark_compute_job_failed`: `20261024120000_fan_in_graph_and_decision_cascade.sql`.
- `sync_strategy_analytics_status`: `20261023120000_sync_status_runner_stamps_computed_at.sql`.
- `computation_error_copy`: `20260826120000_computation_error_curated_copy.sql`.
- `compute_jobs.max_attempts`: `DEFAULT 3` in `20260411144407`. No enqueue path or Python caller overrides it.

The derive is enqueued in strategy mode (`20260825130000`, `routers/cron.py`), so its job carries a `strategy_id` and the bridge runs for it.

| Claim (`job_worker.py:5926-5932`, plan 06 step 1, CONTEXT D-04) | Verdict | Evidence |
|---|---|---|
| "fails the derive TRANSIENT" | True | `error_kind="transient"` at `job_worker.py:5949`. `main_worker.py:1031` passes it through unchanged as `p_error_kind`. |
| "The job retries" | True | `mark_compute_job_failed` sends a non-`permanent` kind with `attempts < max_attempts` to `failed_retry`, with backoff of 30 s after attempt 1 and 2 min after attempt 2. With the default of 3 this is about 2.5 minutes over three attempts, as D-04 says. |
| An intermediate retry stamps nothing user-visible as a failure | True, with one nuance | The bridge loop at the end of `mark_compute_job_failed` runs on **every** call, including `failed_retry`, not only on terminal failure. Each retry therefore reaches `sync_strategy_analytics_status`. The derive is a counting kind, so the side-trigger early return does not apply, and the job is in flight, so branch (a) runs. For an unmarked derive, the row reads `computing` (or keeps `complete_with_warnings`). For a marked nightly refresh over a healthy row, `v_refresh_keep` keeps `complete` and holds the sentence. Branch (a) writes no failure sentence: its `VALUES` tuple carries `computation_error NULL`. So during the retries the user sees the normal in-flight state, never a failure. This matches the comment's "The job retries; if the fault persists...". |
| "if the fault persists, mark_compute_job_failed runs the bridge, which stamps the true 'automatic retries exhausted' sentence, not the permanent 'Contact support' one" | True | At `attempts >= max_attempts` the job goes to `failed_final` with `error_kind='transient'`. If the job is unprotected, branch (b) writes `computation_status='failed'` and `computation_error_copy('transient')`, which reads "Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing." If the job is a protected marked refresh, branch (b-prime) writes the same sentence into `computation_error` only, and the status stays `complete`. The permanent sentence ("...retrying alone will not resolve it. Contact support...") is no longer reachable from this arm. |
| "THIS handler writes no strategy_analytics stamp, persists no row and makes no terminal call" | True | The return is placed before every write and every terminal read. The test asserts no `strategy_analytics` or `csv_daily_returns` upsert and `transport.calls == []`. |
| "The next nightly derive is a new job, so a corrected variable heals the row" (and plan 06 step 1, "any `failed` row it leaves is cleared by that derive's success") | True | The live-failure partition drops a `failed_final` that a strictly later `done` of the same (strategy, kind) supersedes. Branch (c), with a counting trigger, then writes `complete` (or `complete_with_warnings`) and NULLs `computation_error`. On a protected row the sentence stays (held by `v_refresh_keep`) while the chained `compute_analytics_from_csv` is in flight, and it is cleared when that job finishes. A config fault that lasts only through a deploy heals sooner: the retry 30 s later can be claimed by a correctly configured instance and succeed, and then nothing is stamped. Enqueue dedup is in-flight-only, so a nightly fan-out during the retry window folds onto the retrying job and does not create a second one. |
| CONTEXT D-04: "the backfill's `transient` has no stamp only because its job carries no strategy id" | True | `reconstruct_allocator_history` is enqueued with `p_strategy_id := NULL` (plan 06 step 3), so `v_strategy_id` is NULL and the bridge loop selects no row. |

### Remaining text census (phase source, tests, plan 06)

- **`job_worker.py`**: the clock-arm comment no longer says "permanent" or "no stamp".
- **The renamed fault test**: its docstring states the retry-then-stamp consequence correctly.
- **The `Mt5ServerClockConfigError` docstring**: it is scoped to the classification sentence and is now true.
- **Plan 06 step 1**: true, per the table above.
- **The remaining "permanent" hits in `test_mt5_derive_branch.py`** all belong to other arms: the kill switch, unclassifiable deals, malformed currency, and the transient-arm docstrings that contrast with permanent.
- **One residual**: a test *name* in `test_mt5_server_clock.py` still claims "never stamped". This is IN-11 below.
- **`175-03-PLAN.md` (T-175-10 "`permanent` result, no stamp") and `175-03-SUMMARY.md`** keep the old disposition. D-04 makes them lineage. Note for the security auditor: T-175-10's mitigation is now D-04's. Do not verify it against plan 03's register row.

### Per-finding status

| Finding | Status |
|---|---|
| WR-01 (disposition) | **Resolved per D-04.** Transient, and the comment and plan text are true against the latest SQL (trace above). The test can fail (reproduced). |
| IN-08 | **Resolved.** The renamed test, its docstring and the class docstring are correct. One overbroad test name in the sibling file remains as IN-11. |
| IN-01 to IN-07, IN-09, IN-10 | Unchanged, as intended (INFO/LOW are not fixed). |

### New findings (round 3)

No new BLOCKER, WARNING or MEDIUM. No regression: mypy is clean, the five files are green, and the diff touches only the arm's kind, comments, docstrings and the one test.

#### IN-11: A sibling test name still says a configuration error "can never be stamped on a user's strategy"

**File:** `analytics-service/tests/test_mt5_server_clock.py:431`

**Issue:** The test is named `test_a_configuration_error_can_never_be_stamped_on_a_users_strategy`. What it asserts is narrower: the class is not an `Mt5DealClassificationError`, so it never gets the "deal ledger could not be classified" sentence. Its docstring says exactly that. Under D-04, a persisting fault IS stamped on the strategy, with the retries-exhausted sentence, through the bridge. The name is in the IN-08 text family and was missed by fix round 2. Text only; no behaviour depends on it.

**Fix:** Rename the test to `test_a_configuration_error_is_never_the_classification_error`, or something with the same scope.

#### IN-12: Plan 06 step 2 queries a `compute_jobs` column that does not exist, and its by-status count predates D-04

**File:** `.planning/phases/175-mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving/175-06-PLAN.md:147`

**Issue:**
- Step 2 counts jobs "whose `error_message` equals 'derive_broker_dailies: ' followed by a member of `MT5_SERVER_CLOCK_CONFIG_MESSAGES`". `error_message` is the Python `DispatchResult` field. The DB column it lands in is `compute_jobs.last_error` (`p_error` in `mark_compute_job_failed`). In `supabase/schema/baseline.sql`, `compute_jobs` has no `error_message`; the only table with that column is `verification_requests_legacy`. A query written as specified fails with 42703. That is loud, not silent.
- Under D-04, a config-faulted derive spends about 2.5 minutes in `failed_retry`/`pending` before `failed_final`. The `failed=N` bucket in `first-derive: done=N failed=N config_fault=N` is ambiguous until every counted job is terminal. The `config_fault` count still catches a retrying job, because `last_error` is written on every failed attempt.

**Fix:**
- Say `last_error` in step 2.
- Either wait until every counted job is terminal (`done` / `failed_final`), or count `failed_retry` explicitly, for example `first-derive: done=N failed_final=N retrying=N config_fault=N`.

### Round-3 verdict

- WR-01 is resolved per founder decision D-04. The corrected comment, plan 06 step 1, CONTEXT D-04 and the ROADMAP note are all true against the latest `mark_compute_job_failed`, `sync_strategy_analytics_status` and `computation_error_copy`.
  - Intermediate retries show only the in-flight state, never a failure sentence.
  - An exhausted fault stamps the retries-exhausted sentence: `failed` if unprotected, sentence-only if a protected refresh.
  - The next successful derive supersedes the failure and clears it.
- No MEDIUM or above is open. The open set is INFO/LOW only: IN-01 to IN-07 and IN-09 to IN-12. Frontmatter status is `clean`.

_Re-reviewed: 2026-10-27T12:27:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

### Silent-failure hunter, round 3

No CRITICAL/HIGH. The transient flip swallows nothing: retries are bounded (max_attempts 3, about 2.5 minutes), no reaper clears the rows, exhaustion is stamped through the same bridge branches as before with a true sentence, and the ERROR line fires on every attempt.

**SFH-05 MEDIUM (operator-facing evidence, not user-facing or data-integrity): OPEN, not fixed in this phase by rule (no fixer for a non-user-facing MEDIUM).** `175-06-PLAN.md` Task 3 steps 1-2: a clock fault that a retry heals ends `done` with no error text (the claim path clears `last_error`/`error_kind` on a `failed_retry` re-claim), so the step-2 `config_fault=0` gate and step 1's "Record how many" cannot see it; under `permanent` the same fault ended `failed_final` and was visible. Recommendation for whoever runs plan 06: count MT5 `derive_broker_dailies` jobs created after the switch with `attempts > 1` (`retried=N`, require 0 or an explained value), read the `arm=server_clock_config` ERROR log per worker service for the window since the switch, and reword "failed loud" to the retry behaviour. Overlaps IN-12 (the step-2 query names `error_message`; the column is `last_error`).
