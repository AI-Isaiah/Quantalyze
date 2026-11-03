---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 02
status: checkpoint
gate: founder decision
---

# 185-02 SUMMARY: the read-only dry run of the options bases (keys A and C)

Run 2026-11-01, 17:45Z to 17:55Z, by the orchestrator session, never a dispatched executor.
Read-only: Supabase SELECTs and Deribit read endpoints only. Nothing was enqueued and nothing
was written to any database. Keys are letters; every value is an ISO date, a count, a boolean,
seconds, an error class name or a 4-decimal ratio. The scratch script, its raw output and the
tag-to-letter map stay in the orchestrator's scratchpad and are not in the repo.

## Task 1: the scratch script

- One crawl per key: `services.deribit_ingest._crawl_deribit_ledger` wrapped in a per-exchange
  memo. The run printed `crawls=2 (one per key expected)`. The memo hands each later build a
  deep copy of the crawl's report, because every build writes fields onto it; the rows are shared.
- Three builds per key with `build_deribit_native_ledger(account_state=<read once>,
  exclude_spot_extraction=False)`, bases `cash_settlement`, `mark_to_market`, `smoothed_mtm`,
  then `combine_native_ledger(ledger, report.indexable_currencies)`. Keys A and C ran
  concurrently, each under a 560 s budget, inside the `timeout 600` wrapper.
- Offline self-test, no network and no environment variables, both lines verbatim:
  `self-test: cash=-0.4839,0.0279,3.3342 options=0.0000,0.1740,0.9585 cum=1.2993,1.2993` and
  `self-test-memo: calls=1`.
- Static scan (`\.(insert|update|upsert|delete|rpc)\(|enqueue`): no match. The first draft
  matched on `sys.path.insert(`, a list insert and not a write. It was rewritten as a slice
  assignment so the scan reads clean, not waived. `git ls-files -- '*dry185.py'` prints nothing.
- Deviation from Task 1 step 1: the tag-to-letter map is embedded in the script, because the
  container has no copy of `tags.txt`. The script prints only the letters.
- Library logging was disabled in the script, because a library warning can name an instrument.

## Task 2: readings

marker: PRODUCTION

dry-path: ii (founder-approved; start command restored and read back)

The founder approved the start-command swap on the backfill worker on 2026-11-01
(AskUserQuestion, "Approve this run (Recommended)"). The script went up as a gzip+base64 service
variable with `--skip-deploys`, and `cmp` confirmed the round trip. The start command ran it
beside `python -m main_worker`, and one redeploy from source at 17:45Z ran it. The restore is
recorded under "Restore" below.

dry-env: smoothed_mtm_enabled=true retention_days=unset

Both the analytics service (claim role interactive) and the backfill service (claim role
backfill) read `SMOOTHED_MTM_ENABLED=true`, and neither sets
`DERIBIT_OPTION_MARK_RETENTION_DAYS`. Inside the container the script read the same flag
(`true`) and an effective retention of 913 days (the code default). RESEARCH assumption (3)
said the flag "ships dark" with its PROD value unmeasured. It is ON in PROD.

dry-baseline: book_days_gt_0.5=6 dates=2025-04-22,2025-07-13,2025-07-16,2025-08-03,2025-08-04,2025-08-05 cum_all=x3516.0746 cum_2025=x1007.5844 cum_2026=x2.0680 per_key=A:6,B:0,C:4,D:0,E:0,F:0

The baseline is the founder's book's `equity_curve` row, `payload.version` 2, computed
2026-11-01 about 01Z: 897 days from 2023-06-28 to 2026-10-31. Cumulatives are products of
(1 + r). `per_key` counts each drawn key's `csv_daily_returns` rows in this book with |r| > 0.5.
Letters: A, B and C are the Deribit keys, D and E are MT5 keys, F is a Bybit key.

dry-keys: deribit_key_mode_keys=11 book_keys=A:option_activity=true,B:option_activity=unread,C:option_activity=true

`deribit_key_mode_keys` counts distinct Deribit keys with key-mode `csv_daily_returns` rows.
There are 11 of them, across 3 books.

### Per key (verbatim)

dry-key: key=A marks_since=2026-10-26 crawl_s=109 cash_s=11 smoothed_s=83 mtm_s=11 n_held=864 pre_retention_days=0 pre_coverage_days=33 smoothed_error=none mtm_error=none cum_pre_s_cash=xnull cum_pre_s_smoothed=xnull cum_pre_s_mtm=xnull cum_pre_s_stored=x52.1785 cash_error=none option_activity=True state_s=0
dry-key: key=C marks_since=2026-10-26 crawl_s=436 cash_s=27 smoothed_s=1 mtm_s=28 n_held=error:LedgerValuationError pre_retention_days=na pre_coverage_days=51 smoothed_error=LedgerValuationError mtm_error=none cum_pre_s_cash=xnull cum_pre_s_smoothed=null cum_pre_s_mtm=xnull cum_pre_s_stored=x44032.9926 cash_error=none option_activity=True state_s=0

**Not measured, stated rather than skipped:**
- `cum_pre_s_<basis>` printed `xnull` on every basis that built. The product was not finite, so
  each rebuilt series has at least one NaN or infinite value before 2026-10-26. The defect is in
  the script's summation: it multiplied every value without skipping non-finite ones. The rerun
  approval covered one run, so the pre-mark cumulatives per basis are unmeasured. The stored
  cumulatives are measured: A x52.1785, C x44032.9926.
- Key C `n_held`: `replay_option_positions` itself raised `LedgerValuationError` on key C's rows.
  This is the same class the smoothed build raised after 1 s. So the smoothed basis fails on key
  C in the option-book replay, before any marks fetch. The likely causes are a missing or
  non-numeric `position` on an option event row, or an option `exercise` row. Both are refusals
  the docstring names, and the run printed the class only.
- Key A `pre_retention_days=0`: all 864 held instruments of key A have marks inside the 913-day
  window.

Wall times. Key A: crawl 109 s, smoothed assembly 83 s. Key C: crawl 436 s, against the derive's
810 s per-crawl bound. The cash and mark-to-market assemblies took 11 to 28 s.

### Days with |stored r| > 0.3 (verbatim; every one, none left out)

dry-day: key=A day=2025-04-11 stored_r=0.3334 cash_r=0.3334 smoothed_r=-0.0341 mtm_r=0.1041 marked=false
dry-day: key=A day=2025-04-22 stored_r=0.5138 cash_r=0.5138 smoothed_r=0.0143 mtm_r=0.0569 marked=false
dry-day: key=A day=2025-07-02 stored_r=-0.4774 cash_r=-0.4774 smoothed_r=0.2218 mtm_r=0.0001 marked=false
dry-day: key=A day=2025-07-11 stored_r=-0.4840 cash_r=-0.4840 smoothed_r=0.0523 mtm_r=0.0782 marked=false
dry-day: key=A day=2025-07-13 stored_r=3.3360 cash_r=3.3360 smoothed_r=0.6234 mtm_r=0.0204 marked=false
dry-day: key=A day=2025-07-16 stored_r=0.6539 cash_r=0.6539 smoothed_r=0.3796 mtm_r=-0.0810 marked=false
dry-day: key=A day=2025-08-03 stored_r=-0.7828 cash_r=-0.7828 smoothed_r=0.0642 mtm_r=-0.0488 marked=false
dry-day: key=A day=2025-08-04 stored_r=5.2934 cash_r=5.2934 smoothed_r=0.2846 mtm_r=-0.0544 marked=false
dry-day: key=A day=2025-08-05 stored_r=0.6663 cash_r=0.6663 smoothed_r=0.6475 mtm_r=0.4709 marked=false
dry-day: key=A day=2025-08-20 stored_r=0.3891 cash_r=0.3891 smoothed_r=0.3601 mtm_r=0.0061 marked=false
dry-day: key=A day=2025-08-27 stored_r=0.4959 cash_r=0.4959 smoothed_r=0.4959 mtm_r=-0.1705 marked=false
dry-day: key=C day=2023-11-20 stored_r=0.4583 cash_r=0.4583 smoothed_r=null mtm_r=0.4583 marked=false
dry-day: key=C day=2025-12-17 stored_r=-0.3604 cash_r=-0.3604 smoothed_r=null mtm_r=-0.1824 marked=false
dry-day: key=C day=2026-01-05 stored_r=0.3654 cash_r=0.3654 smoothed_r=null mtm_r=0.0543 marked=false
dry-day: key=C day=2026-02-02 stored_r=0.3880 cash_r=0.3880 smoothed_r=null mtm_r=0.5249 marked=false
dry-day: key=C day=2026-02-04 stored_r=0.3175 cash_r=0.3175 smoothed_r=null mtm_r=-0.0993 marked=false
dry-day: key=C day=2026-02-18 stored_r=0.3259 cash_r=0.3259 smoothed_r=null mtm_r=0.1144 marked=false
dry-day: key=C day=2026-02-24 stored_r=0.3283 cash_r=0.3283 smoothed_r=null mtm_r=0.1117 marked=false
dry-day: key=C day=2026-02-28 stored_r=1.6885 cash_r=1.6885 smoothed_r=null mtm_r=-0.8099 marked=false
dry-day: key=C day=2026-03-02 stored_r=0.7076 cash_r=0.7076 smoothed_r=null mtm_r=0.1990 marked=false
dry-day: key=C day=2026-03-03 stored_r=0.4366 cash_r=0.4366 smoothed_r=null mtm_r=1.4680 marked=false
dry-day: key=C day=2026-03-17 stored_r=0.3322 cash_r=0.3322 smoothed_r=null mtm_r=0.7857 marked=false
dry-day: key=C day=2026-03-24 stored_r=0.3411 cash_r=0.3411 smoothed_r=null mtm_r=0.0681 marked=false
dry-day: key=C day=2026-03-31 stored_r=0.3470 cash_r=0.3470 smoothed_r=null mtm_r=-0.0037 marked=false
dry-day: key=C day=2026-04-01 stored_r=0.3676 cash_r=0.3676 smoothed_r=null mtm_r=0.4744 marked=false
dry-day: key=C day=2026-06-29 stored_r=0.3787 cash_r=0.3787 smoothed_r=null mtm_r=-0.0101 marked=false
dry-day: key=C day=2026-08-26 stored_r=0.4285 cash_r=0.4285 smoothed_r=null mtm_r=0.0108 marked=false
dry-day: key=C day=2026-09-06 stored_r=0.7116 cash_r=0.7116 smoothed_r=null mtm_r=-0.0060 marked=false
dry-day: key=C day=2026-10-27 stored_r=0.4698 cash_r=-0.5562 smoothed_r=null mtm_r=-0.5407 marked=true
dry-day: key=C day=2026-10-28 stored_r=-0.5267 cash_r=-0.0122 smoothed_r=null mtm_r=0.2111 marked=true

Railway's log stream interleaved the two keys' lines; they are sorted here by key and day. The
counts match the book reading: key A has 11 days with |r| > 0.3 and key C has 19.

## Task 3: verdict and gate

- Reconstruction: on all 28 unmarked days with |stored r| > 0.3, `cash_r` equals `stored_r` to
  4 decimals (28/28). On the 2 marked days (key C 2026-10-27 and 2026-10-28) the stored return
  is the mark-based one, and the cash rebuild differs, as RESEARCH Q6 expects.
- `N` = 9 unmarked days with |stored r| > 0.5: key A 2025-04-22, 07-13, 07-16, 08-03, 08-04,
  08-05, and key C 2026-02-28, 03-02, 09-06.
- Smoothed basis: 5 of 9 remain. On key A, 2 of 6 remain: 2025-07-13 (0.6234) and 2025-08-05
  (0.6475). On key C all 3 remain, because the smoothed build failed (`LedgerValuationError`), so
  `smoothed_r` is null.
- Mark-to-market basis: 1 of 9 remains, key C 2026-02-28 (-0.8099, against +1.6885 stored).
  Among the printed days whose stored return was under 0.5, it creates large days on key C:
  2026-03-03 (1.4680), 03-17 (0.7857) and 02-02 (0.5249). A day that was under 0.3 stored is not
  printed, so new large days on such days are unmeasured on every basis.

dry-verdict: n=9 remain_smoothed=5 remain_mtm=1 reconstruction=ok smoothed_errors=A:none,C:LedgerValuationError

dry-gate: proceed (founder)

dry-answer: proceed (smoothed where it builds, cash plus the amber flag where it does not; key C's replay refusal is diagnosed in plan 185-03)

The gate as first written, kept as lineage: `founder decision (key C smoothed_error=LedgerValuationError; mark-to-market passes while smoothed does not: 2*5 > 9 on smoothed, 2*1 < 9 on mark-to-market)`

## CHECKPOINT REACHED

The gate does not read `proceed`. No options-basis code plan (185-07, 185-08, 185-09) may start
until the founder answers. Options, per Task 3:

- **(a) Proceed anyway, with the days named.** On key A the smoothed basis removes 4 of its 6
  large days. 2025-07-13 (0.6234) and 2025-08-05 (0.6475) remain. Key C cannot use the smoothed
  basis at all until its option-book replay refusal is understood. Its 3 large days (2026-02-28,
  03-02, 09-06) stay on cash.
- **(b) Replan the phase.** Mark-to-market clears 8 of the 9 days. It builds on both keys, but it
  moves key C 2026-02-28 to -0.8099 and creates new large days on key C (2026-03-03 at 1.4680,
  03-17 at 0.7857). The smoothed failure on key C would also need its own diagnosis.

The answer is recorded by the orchestrator as `dry-answer:` here and as a `Dry-run gate` D-line
in `185-CONTEXT.md`, per the plan's "Recording a founder answer". Neither answer departs from a
ROADMAP success criterion.

## Restore

- The start command was set back to exactly `python -m main_worker` at 17:55Z, right after the
  `d185-exit` line. Read back with the service config: `startCommand: "python -m main_worker"`,
  and nothing staged.
- The script variable was deleted without `--skip-deploys`. A JSON variable listing read back
  `D185_B64 present: False`. The delete triggered no deployment within about 10 minutes, so the
  running deployment still carried the swapped command. Its script had exited and the worker
  was running beside it.
- A redeploy from source at 18:07Z (the same main commit as the run's
  deployment) reached `SUCCESS`. Its log shows the worker starting, KEK validation passing, the
  healthz server listening, and job claims answering 200. It shows no D185 line.
- The saved run output contains no UUID (checked with a UUID-shaped grep).
