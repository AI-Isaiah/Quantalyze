---
status: passed
verified_at_sha: 41da793806bc4ab67c5cc121cfefec0deada4711
drift_subjects:
  - analytics-service/services/mt5_server_clock.py
  - analytics-service/services/mt5_deals.py
  - analytics-service/services/broker_dailies.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/mt5offset_dry_run.py
  - analytics-service/tests/test_mt5_server_clock.py
  - analytics-service/tests/test_mt5_deal_timing.py
  - analytics-service/tests/test_mt5_derive_branch.py
  - analytics-service/tests/test_mt5_deal_reconstruction.py
  - analytics-service/tests/test_equity_reconstruction.py
  - analytics-service/tests/test_mt5offset_dry_run.py
---

# Phase 175 MT5OFFSET: Verification Report

**Phase goal:** MT5 deal days and instants use the broker's real UTC offset on each date, including daylight-saving changes, so a deposit near a nightly mark read is never placed on the wrong day.
**Verified:** 2026-11-03 (re-verification, after the operator work), worktree `feat/175-mt5offset`, head `41da79380`.
**Verdict:** `passed`. The three ROADMAP success criteria hold. The code half is reproduced against the code as shipped on `main` (#1135, v0.133.3.0), not only against this branch. SC-1 and SC-3 rest on recorded operator readings, and the production job table agrees with them. D-06 (founder, 2026-11-03) departs from the history before/after of D-03; that departure is reported below as **passed by founder override**, and it is not a gap.
**Score:** 3/3 ROADMAP success criteria verified (SC-1, SC-2, SC-3); 0 behavior-unverified; the D-03 before/after is carried by founder override (D-06).

## Re-verification delta (what changed since the 2026-10-27 reading)

| Item | 2026-10-27 | Now |
|---|---|---|
| Plan 02 (R1/R2, interim offset, runbooks) | not done | done: R1 +3 h (2026-10-27), R2 +2 h (2026-11-02), `SC-1: config=us`, interim 7200 set on both worker services 2026-11-01 07:11Z; runbook P6 and the Step 2 note are in the diff, additive only |
| Plan 06 (switch) | not done | done 2026-11-03: rule `us` on both worker services, `MT5_SERVER_UTC_OFFSET_S` deleted, first derive `done` with `config_fault=0` |
| Legacy forced rebuild (D-03 step 3) | open | void: D-05, Phase 176 dropped `allocator_equity_snapshots` and retired the rebuild kind |
| Live before/after count (D-03 step 1) | open | not run: D-06, founder choice after the platform SSH path failed |
| Code | head `57cb909ba` | unchanged since; the `services/job_worker.py` differences between `04f5568a9` and this head are later `main` content that the branch picked up, not Phase 175 changes |

## Evidence base (run by the verifier, 2026-11-03)

| Check | Result |
|---|---|
| The shipped code is on `main` | commit `04f5568a9` (#1135) added the clock module, seam, derive wiring, dry-run script, tests and both runbook edits. `git show origin/main:` shows `mt5_server_clock.py`, `mt5_deals.py`, `broker_dailies.py` and `job_worker.py` carrying the clock; `job_worker.py` has one `resolve_mt5_server_clock()` per derive and six `_mt5_clock` sites (combine, day P&L, native-key levels, flow day, flow instant, apply-marks day P&L). Production Python outside `mt5_server_clock.py` does not name `MT5_SERVER_UTC_OFFSET_S` or `MT5_SERVER_TIME_RULE`; only tests do. |
| Tests, run on an extract of `origin/main` | `test_mt5_server_clock`, `test_mt5_deal_timing`, `test_mt5_derive_branch`, `test_mt5_deal_reconstruction`, `test_mt5offset_dry_run`, `test_broker_dailies`, `test_mt5_server_known`: `533 passed`, 0 failed |
| mypy strict on the two core modules of `main` | `Success: no issues found in 2 source files` |
| Independent `zoneinfo` oracle against the shipped `main` code (scratch script, not the phase's tests): every ten-minute true-UTC instant in March, October and November for every fifth year 2008-2098, rules `eu` (Helsinki) and `us` (New York plus 7 h) | 443,232 instants, 0 wrong days, 0 wrong instants; 324 instants are `None`, exactly the repeated or skipped broker hours (D-07) |
| Mutation of a scratch copy of `main` (`_deal_offsets` forced to the fixed 10800 pair) | RED: `test_mark_placement_winter_deposit_follows_the_dst_rule[us]` and `[eu]`, `test_a_winter_deposit_after_the_read_reaches_apply_marks_on_its_true_day_under_the_us_rule`, `test_a_ledger_straddling_the_us_fall_change_is_bucketed_per_deal_by_the_rule_and_by_no_integer`; 110 failed across the four SC-2 files. The worktree was not touched. |
| PROD marker query, run alone first | named PRODUCTION |
| PROD `compute_jobs`, `derive_broker_dailies` created since 2026-11-03T13:30Z (read only, counts) | exactly 1 job, on an `mt5` key: `done`, `attempts=1`, `error_kind` null, no `last_error`, claimed 13:41:03Z, finished 13:41:18Z. No job of any kind since 13:30Z carries a clock-configuration text. This matches the plan 06 SUMMARY (one key, enqueued 13:40Z, done 13:41Z). |
| PROD, MT5 derives per day, 2026-10-30 to 2026-11-03 | every day `done`, no `error_kind`; 8 keys per night through 2026-11-02, 11 keys on 2026-11-03 (the 00:40Z run, which still ran under the interim integer 7200, plus the one manual derive under the rule). No MT5 derive failed across the 2026-11-01 change or the switch. |
| Time of this reading | 2026-11-03 about 13:46Z. The next 00:40Z run (2026-11-04) has not happened yet. |

## Per-criterion evidence

### SC-1: the broker's offset rule is measured and recorded: VERIFIED

- Plan 02 SUMMARY records the two readings and the decision: R1 2026-10-27 `+3h`, R2 2026-11-02 `+2h`, line `SC-1: config=us R1=2026-10-27 +3h R2=2026-11-02 +2h`.
- The logic is sound and I checked it against the rule dates: the EU clocks changed on 2026-10-25, so a +3 h reading on 2026-10-27 excludes `eu` (which would read +2); the US clocks changed on 2026-11-01, so a +2 h reading on 2026-11-02 excludes a fixed +3. Only `us` gives +3 then +2.
- The first reading on 2026-11-02 was +1 h, which is a comparison against CET, not UTC. It was not accepted; the founder re-read against UTC. That is the correct handling of an out-of-table reading.
- The history offsets are recorded: 10800 from go-live to 2026-11-01 07:11Z, 7200 after, never 0 (no service was found unset).
- The runbook edits (pre-flight P6, the Step 2 note naming both variables) are on `main` via #1135, additive only.
- The record names no broker server, id or home path.

### SC-2: day bucketing and D-23 instants use the offset in force on the deal's date; tests RED under the fixed offset: VERIFIED

Reproduced on the shipped `main` code (evidence table): the oracle finds no wrong day and no wrong instant over 443,232 instants, and forcing the fixed 10800 turns the SC-2 tests RED. The structure is unchanged from the 2026-10-27 reading (see Lineage): one resolver call per derive, six sites, required-argument folds, the closed-text fault classification (D-04, `transient`), and the AST pins `test_single_reader` and `test_one_clock_per_derive`, which pass on `main`.

- **Backfill site, changed by a later phase.** The 2026-10-27 reading counted a seventh site in `equity_reconstruction._mt5_fetch_window` and a pin `test_one_clock_per_backfill`. Phase 176 (#1172, v0.133.15.0) deleted that engine. On `main`, `services/equity_reconstruction.py` carries no MT5 clock reference and the backfill pin is gone with it; `test_single_reader` still passes and still finds no inline read. This is not a gap in 175: the goal is met by the sites that remain, and the allocator curve is the derived one recomposed from the per-key dailies, which the derive buckets by the rule.
- **Tooling.** `scripts/mt5offset_dry_run.py` and its tests are on `main` and pass. The tool was not run on a live ledger (D-06).

### SC-3: interim offset measured and set before the first nightly marks: VERIFIED

- Plan 02 SUMMARY: before and after read-backs on both worker services, `offset=3h` (read back 2026-10-27 12:39Z), with the role of each service recorded. No service was unset, so the fail-loud resolver could not break a derive at deploy (T-175-11 operator half).
- After the US change the offset was moved to 7200 on both services at 2026-11-01 07:11Z (about 70 minutes after the 06:00Z change, on a Sunday, before the 2026-11-02 00:10Z chain) and confirmed unchanged by R2. Production shows every MT5 derive `done` on each night around the change, so no night was lost.
- Reading note: the 10800 value was already in force when the 2026-10-27 reading was taken (production had relied on it), so the measurement confirmed the value in force rather than correcting it.

### Operator switch (plan 06 Task 3): VERIFIED

- Plan 06 SUMMARY records both switch lines (`rule=us offset=null`) at 13:38:28Z and 13:38:36Z, the order of operations (rule set with deploys skipped, offset deleted, one rule-only deployment, then a redeploy, so no instance booted with both settings), both services `SUCCESS`, and no clock-configuration message in their logs.
- The PROD job table independently shows the one MT5 derive after the switch ended `done` on attempt 1 with no error text. `attempts=1` also rules out the SFH-05 blind spot (a fault that a retry heals ends `done` with no error text): there was no retry to hide one.
- Scope of this evidence: one MT5 key derived under the rule. A clock fault is global to a derive (the clock is resolved once, before any terminal read), so one clean derive shows the claiming service's configuration is valid; the other keys re-bucket at the next 00:40Z run.

## Founder override (D-06): reported as passed by founder override

D-06 (CONTEXT, founder 2026-11-03, "Switch 175 without the count") replaced D-05's count: the live ledger capture and the before/after did not run, because Railway SSH into both analytics services fails after authentication (the home-directory change #1190 did not fix it). D-05 had already voided the forced rebuild of the legacy allocator snapshots (Phase 176 dropped the table).

No ROADMAP success criterion text is departed from: SC-1, SC-2 and SC-3 are verified on their own wording. The override touches these statements, each **passed by founder override**:

1. **CONTEXT D-03, "a read-only before/after on the live ledger records which days move", and the ROADMAP note that repeats it** ("CONTEXT D-03 note (2026-10-27): the history before/after runs after the integer-only deploy and before the rule id is switched on"). Not met: D-06. The "before" count does not exist. The fallback that Task 1 step 0 names was used: the evidence is the first derive after the switch.
2. **CONTEXT D-03, "allocator-history snapshots are rebuilt by a named forced rebuild only for keys whose days actually moved".** Void: D-05 (the table no longer exists; the derived curve recomposes by itself), and D-06 removed the count that would have named the keys.
3. **ROADMAP plan line 175-06** ("post-deploy live capture, dry run, rule switch, forced rebuild of approved keys only"). Only the rule switch ran. Capture and dry run: D-06. Forced rebuild: D-05.
4. **The history-effect half of SC-2** (that the stored history re-buckets as the rule says). The code and the oracle prove the arithmetic; the number of days that moved on the live ledger is unmeasured, by D-06. It is observable afterwards in the derived curves (plan 06 SUMMARY, "Known limits").

Plan 02 and the D-02 wording ("set by hand ... re-checked after 2026-11-01") ran as written, plus the founder choice of 7200 after the flip. That is not an override.

Records PR: add a dated CORRECTED note to the ROADMAP `### Phase 175` entry covering items 1 to 4, tick 175-02 and 175-06, and set the plans count to 6/6 (it still reads `4/6 plans executed`).

## Gaps

None blocking. Notes for the records PR and the next reading:

- **Pending reading, non-blocking.** The 2026-11-04 00:40Z nightly run is not in the data yet (this reading is about 13:46Z on 2026-11-03). It is the first run that derives all MT5 keys under the rule. Check then that every MT5 `derive_broker_dailies` job is `done` with `attempts=1`, and that no `compute_jobs.last_error` carries a clock-configuration text; a retried-then-done job (`attempts > 1`) would hide a healed fault (SFH-05). The status stays `passed`: D-06 chose to judge from the first derive, and that derive is clean.
- **Stale text in the plan lineage.** `175-03-PLAN.md` T-175-10 and `175-03-SUMMARY.md` still say "permanent, no stamp"; CONTEXT D-04 and the ROADMAP note supersede them and the code follows D-04.
- **175-SECURITY.md** lists operator-pending rows (T-175-05 to T-175-08, T-175-17 to T-175-20) from before the operator work. Their operator halves are now done or void: T-175-06 and T-175-19 have read-backs; T-175-17, T-175-18 and T-175-20 did not occur (no capture, no rebuild: D-06, D-05). The audit verdict, `threats_open: 0`, is not changed; the records PR may close the rows.
- **Known limits, unchanged.** A2 (a broker that changes clocks at another weekend moment than the US rule is an hour off for deals stamped in between; IN-07), the transition-hour flow keeping its day with no instant (D-07), and the live server-clock tripwire, which stays with Phase 155 / MT5-06.

---

# Lineage: the 2026-10-27 reading (status then: `human_needed`)

The text below is the prior verification, kept as lineage. Its SC-1, SC-3, plan 02 and plan 06 items were open then and are closed above.

**Phase goal:** MT5 deal days and instants use the broker's real UTC offset on each date, including daylight-saving changes, so a deposit near a nightly mark read is never placed on the wrong day.
**Verified:** 2026-10-27, worktree `feat/175-mt5offset`, head `57cb909ba`.
**Verdict:** the code half of the goal is achieved and independently reproduced. The measurement and deploy half (SC-1, SC-3, plans 02 and 06) is operator work that has not happened, so the status is `human_needed`, not `passed`. No code gap was found.

### Evidence base (run by the verifier, not read from SUMMARYs)

| Check | Result |
|---|---|
| CI mypy strict line from `analytics-service/` | `Success: no issues found in 124 source files` |
| The ten named test files (`test_mt5_server_clock`, `test_mt5_deal_timing`, `test_mt5_derive_branch`, `test_mt5_deal_reconstruction`, `test_equity_reconstruction`, `test_reconstruct_whole_account`, `test_mt5offset_dry_run`, `test_flowtiming_dry_run`, `test_broker_dailies`, `test_mt5_soak`) | `812 passed`, 0 failed |
| Independent zoneinfo oracle (scratchpad script, not the phase's tests): 508,896 ten-minute true-UTC instants around March, October and November for every fifth year 2008-2098, rules `eu` (Helsinki) and `us` (New York plus 7 h), via `deal_utc_day` and `deal_utc_instant_ms` | 0 wrong days, 0 wrong instants; 456 instants are `None`, which are exactly the repeated or skipped broker hours (D-07) |
| Winter deposit at true 2026-12-10T00:20Z, broker wall UTC+2 | `us` and `eu` give day 2026-12-10 and the true instant; fixed 10800 gives day 2026-12-09 and an instant one hour early. The WR-02 defect reproduces on the old arithmetic and is gone under the rule. |
| Mutation of a scratch copy (rule clocks forced to behave as fixed 10800; the worktree was not touched) | The SC-2 tests go RED: `test_a_winter_deposit_after_the_read_reaches_apply_marks_on_its_true_day_under_the_us_rule`, `test_a_ledger_straddling_the_us_fall_change_is_bucketed_per_deal_by_the_rule_and_by_no_integer`, and the rule-clock cases in `test_mt5_deal_timing.py` (13 failed in the targeted selection) |

### Per-criterion evidence

#### SC-2: day bucketing and D-23 instants use the offset in force on the deal's date; tests RED under the fixed offset: VERIFIED

- **Clock module and rule math.** `services/mt5_server_clock.py` is a stdlib-only leaf. `Mt5ServerClock` has `eu`, `us` and `fixed` forms. The `eu` window is 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October. The `us` window is 07:00 UTC on the second Sunday of March to 06:00 UTC on the first Sunday of November (02:00 New York time, plus 7 h gives UTC+2 and UTC+3). The candidate formulation tries both offsets and keeps those consistent with the window: one candidate is an ordinary instant, two is a repeated hour, none is a skipped hour. The day uses the first candidate (or the standard offset in a skipped hour); the instant is `None` in an ambiguous hour. My oracle run above confirms this.
- **The seam.** `services/mt5_deals.py`: `_server_clock` accepts an `Mt5ServerClock` or a bare int, rejects bool and non-int, and wraps ints as the fixed form. `_deal_offsets` looks up the day offset and instant offset once per deal, so the day and the instant always come from one clock. `deal_utc_instant_ms` returns `None` when the instant offset is `None`, and keeps the day-agreement check.
- **Every MT5 offset site is threaded with one resolved clock.**
  - Derive (`job_worker.py`): `resolve_mt5_server_clock()` is called once in `run_derive_broker_dailies_job`, before the first terminal read. Six sites receive `_mt5_clock`: `combine_mt5_deal_ledger` (6614), `mt5_day_pnl` (6621), `reconstruct_mt5_nav_levels` (6640), `deal_utc_day` for the flow day (6741), `deal_utc_instant_ms` for the D-23 flow instant (6755), and the apply-marks `mt5_day_pnl` (7566).
  - Backfill (`equity_reconstruction.py` `_mt5_fetch_window`): the clock is resolved once after the go-dark gate and before the terminal lease, and passed to the one `reconstruct_mt5_nav_levels` call (5061).
  - A census of every `deal_utc_day`, `deal_utc_instant_ms`, `_fold_mt5_deals` and fold call in `services/`, `routers/` and `scripts/` shows no other production site. `scripts/mt5_soak.py` and `scripts/flowtiming_dry_run.py` pass an explicit operator-supplied integer.
  - A repo-wide grep finds the two setting names only in `mt5_server_clock.py` (outside tests). The AST pins `test_single_reader`, `test_one_clock_per_derive` (exactly 6 sites, all `_mt5_clock`) and `test_one_clock_per_backfill` (exactly 1 site) enforce it.
- **Required-argument folds.** `combine_mt5_deal_ledger`, `reconstruct_mt5_nav_levels` and `mt5_day_pnl` declare `server_utc_offset_s: int | Mt5ServerClock` with no default (keyword-only). `test_a_missing_broker_clock_is_a_type_error_not_a_utc_default` pins the TypeError. This closes review WR-02 / SFH-03.
- **Failure classification (D-04).** Derive: a `Mt5ServerClockConfigError` returns `FAILED` with `error_kind="transient"` and one ERROR log line carrying the arm and job id and no configured value; it makes no write and no terminal read. The test `test_a_clock_configuration_fault_fails_transient_and_makes_no_terminal_read` covers three cases (neither variable set, unknown rule id, both set), and the review reproduced it going RED when the kind is `permanent`. Backfill: `_fail("server_clock_config", "transient", ...)` with a fixed value-free message, decided before the terminal lease; `test_mt5_backfill_clock_configuration_fault_is_transient_and_touches_nothing` asserts no terminal call, nothing persisted, and one audit event. The two paths agree (CLAUDE.md Rule 7).
- **Tests can fail under the fixed offset across a DST change.** `test_a_winter_deposit_after_the_read_reaches_apply_marks_on_its_true_day_under_the_us_rule` asserts the flow day 2025-11-11 and the true instant 00:30Z after the mark's 00:10Z read. Its control `test_the_same_deposit_under_the_fixed_10800_is_filed_on_the_mark_day` asserts the defective 2025-11-10 and 23:30Z, so the pair separates the rule from the integer. `test_a_ledger_straddling_the_us_fall_change_...` buckets a ledger across the 2026-11-01 change. The mutation run above shows these go RED.

#### Dry-run tool and exit contract (plan 04): VERIFIED

`scripts/mt5offset_dry_run.py` is read-only (no supabase or HTTP imports, no DB or socket). It folds each captured ledger under the legacy integer and the target clock, and gives a per-key row with counts only, ordinals in place of ids, and `_scrub` on all output. The verdict is `rebuild` when any NAV-level day changes, `none` when nothing does, and `not measured` (exception class only) when a key cannot be folded. The footer reports "Keys needing a forced rebuild" and "Keys not measured". `main` writes the report first, then returns 1 when the capture holds no keys or any key is `not measured`, else 0. A capture `offset_s` that differs from `--legacy-offset-s` is a stderr WARNING and a report note, not a refusal (by design). `test_mt5offset_dry_run.py` passes.

#### SC-1: the broker's offset rule is measured and recorded: HUMAN-NEEDED (not a code failure)

The code can carry either rule and fails loud on an unset or contradictory configuration. Which rule the broker follows has not been measured: plan 02 (Tasks 1 and 3) and plan 06 Task 1 are unexecuted.

#### SC-3: interim offset set before the first nightly marks: HUMAN-NEEDED (not a code failure)

Plan 02 is unexecuted. The code delivers the mechanism (`MT5_SERVER_UTC_OFFSET_S` alone resolves as the fixed form), but nothing has been set or recorded on Railway, and the runbook edits of plan 02 Task 2 are absent from the diff (`git diff` shows no `docs/runbooks` change).

### Human-needed items

1. **Plan 02 Task 1 (R1), BEFORE the Phase 175 code deploys.**
   - The founder reads the broker server clock in the MT5 terminal.
   - The orchestrator first records the current `MT5_SERVER_UTC_OFFSET_S` and `WORKER_CLAIM_ROLE` on both worker services (the backfill service and the main analytics service), then sets the interim offset on every worker service (the value is +3 h, that is 10800, while the US and EU rules agree).
   - Why it blocks: `resolve_mt5_server_clock` has no silent "0" default any more. A worker service that carries neither variable fails every MT5 derive (transient, then stamped "automatic retries exhausted") and every MT5 backfill after deploy. Production has relied on the integer being set, and a service found unset has been bucketing at 0, which the plan says to record as a finding.
2. **Plan 02 Task 2.** Add the measurement as pre-flight P6 of `docs/runbooks/navmtm-chain-move-go-live.md` and name the two variables in `docs/runbooks/mt5-go-live.md` Step 2 (additive only). Not in the diff.
3. **Plan 02 Task 3 (R2), after 2026-11-01 06:00Z on a trading day.** The founder re-reads the clock; the interim value is confirmed or corrected (7200 if the `us` rule), the rule is decided and recorded (closes SC-1), and the SUMMARY names every offset the stored MT5 history was written under (10800 from go-live, each interim value with its dates, and 0 for any service found unset). Two readings, one on each side of the 2026-11-01 change, separate the `us` rule from a fixed +3; a +2 reading before the change already means `eu`.
4. **Plan 06 Task 1, after the code deploy and before the rule id is switched on (D-03 timing reading).** Capture the live MT5 ledgers read-only on the worker host, and run `scripts/mt5offset_dry_run.py` once per legacy offset the history was written under. The exit code is 1 if any key is `not measured`; record `not_measured=N` per run.
5. **Plan 06 Task 2.** The founder approves the switch and the forced-rebuild key list from the counts.
6. **Plan 06 Task 3.**
   - Step 1: switch both worker services to the measured rule (set `MT5_SERVER_TIME_RULE` and remove `MT5_SERVER_UTC_OFFSET_S`; both set is a fault).
   - Step 2: prove the first derive is clean. Apply the open review item SFH-05 here: a fault that a retry heals ends `done` with no error text, so the `config_fault=0` gate cannot see it. Also count MT5 `derive_broker_dailies` jobs created after the switch with `attempts > 1` (`retried=N`), read the `arm=server_clock_config` ERROR log per service since the switch, use `compute_jobs.last_error` and not `error_message` (IN-12), and wait until every counted job is terminal.
   - Step 3: force-rebuild allocator history for the approved keys only.
   - Also look at the Sunday window between the broker's own 02:00 flip and the New York 02:00 flip (IN-07, residual assumption A2).

### Review status at this head

- Rounds 1-3 are done. WR-01 (derive fault classification) was decided by the founder as D-04 and fixed (`40d70f1f0`); WR-02 / SFH-03 (silent default), SFH-01 (dry-run silence), SFH-02 (log line) and SFH-04 (span text) are fixed and verified above. No CRITICAL or user-facing item is open.
- Open and non-blocking: SFH-05 (MEDIUM, operator-facing evidence wording in plan 06, handled in human item 6), and INFO items IN-01 to IN-07 and IN-09 to IN-12 (for example IN-05, the dataclass accepts inconsistent instances, and IN-09, the hard-coded span years in the message). None changes an offset the code computes.

### Gaps

None in code. Two bookkeeping notes, both INFO:

- ROADMAP's `**Plans:** 2/6 plans executed` line lags its own checklist (four plans ticked).
- `175-03-PLAN.md` T-175-10 and `175-03-SUMMARY.md` still say "permanent, no stamp". CONTEXT D-04 and the ROADMAP note supersede them, and the code and tests follow D-04.
